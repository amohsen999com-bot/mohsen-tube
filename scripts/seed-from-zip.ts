import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import { estimateVideoLevel, normArabic, stemWord, tokenizeWords } from "../src/lib/arabic.ts";

const ZIP_CANDIDATES = [
  process.env.MOHSEN_ZIP_PATH || "",
  "C:\\Users\\ansah\\Downloads\\Telegram Desktop\\mohsen-tube (2).zip",
  "C:\\Users\\ansah\\Downloads\\Telegram Desktop\\mohsen-tube.zip",
].filter(Boolean);

interface ZipEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

function parseZipCentralDirectory(buf: Buffer): Map<string, ZipEntry> {
  // Locate End of Central Directory (EOCD) signature 0x06054b50
  let eocdOffset = -1;
  const minOffset = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= minOffset; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error("Invalid ZIP file: End of Central Directory not found");
  }

  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);

  const entries = new Map<string, ZipEntry>();
  let ptr = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) {
      throw new Error(`Invalid Central Directory header at offset ${ptr}`);
    }
    const compressionMethod = buf.readUInt16LE(ptr + 10);
    const compressedSize = buf.readUInt32LE(ptr + 20);
    const uncompressedSize = buf.readUInt32LE(ptr + 24);
    const fileNameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localHeaderOffset = buf.readUInt32LE(ptr + 42);
    const rawName = buf
      .subarray(ptr + 46, ptr + 46 + fileNameLen)
      .toString("utf8")
      .replace(/\\/g, "/");
    // Strip optional top-level `mohsen-tube/` prefix so both zip layouts map identically
    const normalizedName = rawName.replace(/^mohsen-tube\//, "");

    entries.set(normalizedName, {
      name: normalizedName,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });

    ptr += 46 + fileNameLen + extraLen + commentLen;
  }

  return entries;
}

function readZipEntryBuffer(buf: Buffer, entry: ZipEntry): Buffer {
  const lh = entry.localHeaderOffset;
  if (buf.readUInt32LE(lh) !== 0x04034b50) {
    throw new Error(`Invalid local file header for ${entry.name}`);
  }
  const fileNameLen = buf.readUInt16LE(lh + 26);
  const extraLen = buf.readUInt16LE(lh + 28);
  const dataStart = lh + 30 + fileNameLen + extraLen;
  const slice = buf.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.compressionMethod === 0) {
    return Buffer.from(slice);
  }
  if (entry.compressionMethod === 8) {
    return zlib.inflateRawSync(slice);
  }
  throw new Error(`Unsupported compression method ${entry.compressionMethod} for ${entry.name}`);
}

function buildSearchIndexTokens(title: string, channel: string, topic: string): string {
  const words = tokenizeWords(`${title} ${channel} ${topic}`);
  const expanded = new Set<string>();
  for (const w of words) {
    expanded.add(w);
    const s = stemWord(w);
    if (s) expanded.add(s);
  }
  return [...expanded].join(" ");
}

function main() {
  const zipPath = ZIP_CANDIDATES.find((p) => fs.existsSync(p));
  if (!zipPath) {
    throw new Error(`Could not find mohsen-tube zip at any of: ${ZIP_CANDIDATES.join(", ")}`);
  }

  console.log(`Reading archive: ${zipPath}`);
  const zipBuf = fs.readFileSync(zipPath);
  const entries = parseZipCentralDirectory(zipBuf);

  const readJson = <T>(entryPath: string, fallback: T): T => {
    const e = entries.get(entryPath);
    if (!e) return fallback;
    const txt = readZipEntryBuffer(zipBuf, e).toString("utf8").trim();
    if (!txt) return fallback;
    return JSON.parse(txt) as T;
  };

  // Extract PWA icons and manifest into public/
  const publicDir = path.join(process.cwd(), "public");
  const iconsDir = path.join(publicDir, "icons");
  fs.mkdirSync(iconsDir, { recursive: true });
  for (const iconName of ["icon-192.png", "icon-512.png", "maskable-512.png"]) {
    const entry = entries.get(`site/icons/${iconName}`);
    if (entry) {
      fs.writeFileSync(path.join(iconsDir, iconName), readZipEntryBuffer(zipBuf, entry));
    }
  }
  const manifestEntry = entries.get("site/manifest.webmanifest");
  if (manifestEntry) {
    fs.writeFileSync(
      path.join(publicDir, "manifest.webmanifest"),
      readZipEntryBuffer(zipBuf, manifestEntry)
    );
  }

  const dataDir = path.join(process.cwd(), "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, "mohsen.db");
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }

  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE channels (
      name TEXT PRIMARY KEY,
      id TEXT NOT NULL,
      grp TEXT NOT NULL,
      field TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      norm_name TEXT NOT NULL
    );
    CREATE INDEX idx_channels_id ON channels(id);
    CREATE INDEX idx_channels_grp ON channels(grp);

    CREATE TABLE videos (
      id TEXT PRIMARY KEY,
      t TEXT NOT NULL,
      c TEXT NOT NULL,
      d INTEGER NOT NULL DEFAULT 0,
      tp TEXT NOT NULL,
      g TEXT NOT NULL,
      r REAL NOT NULL DEFAULT 0.5,
      s REAL,
      q REAL,
      o REAL,
      lv REAL NOT NULL DEFAULT 2.0,
      hd INTEGER NOT NULL DEFAULT 0,
      dt INTEGER,
      y INTEGER,
      pl INTEGER,
      is_curated INTEGER NOT NULL DEFAULT 0,
      norm_t TEXT NOT NULL,
      norm_c TEXT NOT NULL
    );
    CREATE INDEX idx_videos_curated ON videos(is_curated, s DESC);
    CREATE INDEX idx_videos_channel ON videos(c, is_curated DESC, dt DESC);
    CREATE INDEX idx_videos_topic ON videos(tp, is_curated DESC, s DESC);
    CREATE INDEX idx_videos_group ON videos(g, is_curated DESC, dt DESC);

    CREATE VIRTUAL TABLE videos_fts USING fts5(
      id UNINDEXED,
      tokens,
      norm_title,
      norm_channel,
      tokenize = 'unicode61'
    );

    CREATE TABLE series (
      id INTEGER PRIMARY KEY,
      t TEXT NOT NULL,
      c TEXT NOT NULL,
      videos_json TEXT NOT NULL
    );
    CREATE INDEX idx_series_channel ON series(c);

    CREATE TABLE comments (
      video_id TEXT PRIMARY KEY,
      comments_json TEXT NOT NULL
    );

    CREATE TABLE video_info (
      video_id TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      chapters_json TEXT NOT NULL
    );

    CREATE TABLE transcripts (
      video_id TEXT PRIMARY KEY,
      lang TEXT,
      is_auto INTEGER NOT NULL DEFAULT 1,
      lines_json TEXT NOT NULL
    );

    CREATE TABLE labels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vid TEXT NOT NULL,
      ch TEXT NOT NULL,
      q TEXT NOT NULL,
      answers_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE rooms (
      code TEXT PRIMARY KEY,
      vid TEXT NOT NULL,
      t REAL NOT NULL DEFAULT 0,
      playing INTEGER NOT NULL DEFAULT 0,
      by_user TEXT NOT NULL,
      updated_at REAL NOT NULL
    );
  `);

  // 1. Load blocked channels
  const blockedMap = readJson<Record<string, string>>("data/blocked_channels.json", {});
  const blockedNames = new Set(Object.values(blockedMap));
  const blockedIds = new Set(Object.keys(blockedMap));

  // 2. Seed channels
  const siteChannels = readJson<
    Record<string, { id: string; group: string; field?: string; p?: number }>
  >("site/channels.json", {});
  const dataChannels = readJson<
    Array<{ id: string; name: string; group: string; field?: string; priority?: boolean }>
  >("data/channels.json", []);

  const mergedChannels = new Map<
    string,
    { name: string; id: string; group: string; field?: string; priority: number }
  >();
  for (const [name, ch] of Object.entries(siteChannels)) {
    if (blockedIds.has(ch.id) || blockedNames.has(name)) continue;
    mergedChannels.set(name, {
      name,
      id: ch.id || "",
      group: ch.group || "علماء",
      field: ch.field,
      priority: ch.p ? 1 : 0,
    });
  }
  for (const ch of dataChannels) {
    if (blockedIds.has(ch.id) || blockedNames.has(ch.name)) continue;
    if (!mergedChannels.has(ch.name)) {
      mergedChannels.set(ch.name, {
        name: ch.name,
        id: ch.id || "",
        group: ch.group || "علماء",
        field: ch.field,
        priority: ch.priority ? 1 : 0,
      });
    }
  }

  const insertChannel = db.prepare(
    "INSERT OR REPLACE INTO channels (name, id, grp, field, priority, norm_name) VALUES (?, ?, ?, ?, ?, ?)"
  );
  db.exec("BEGIN");
  for (const ch of mergedChannels.values()) {
    insertChannel.run(
      ch.name,
      ch.id,
      ch.group,
      ch.field ?? null,
      ch.priority,
      normArabic(ch.name)
    );
  }
  db.exec("COMMIT");
  console.log(`Seeded ${mergedChannels.size} channels.`);

  // 3. Read series so we know each video's series index (pl) and position
  const rawSeries = readJson<Array<{ t: string; v: string[] }>>("site/series.json", []);
  const videoSeriesIndex = new Map<string, { pl: number; posRatio: number }>();
  rawSeries.forEach((s, idx) => {
    const len = s.v.length;
    s.v.forEach((vid, i) => {
      if (!videoSeriesIndex.has(vid)) {
        videoSeriesIndex.set(vid, {
          pl: idx,
          posRatio: i / Math.max(len - 1, 1),
        });
      }
    });
  });

  // 4. Seed curated videos from site/videos.json
  interface RawCuratedVideo {
    id: string;
    t: string;
    c: string;
    d: number;
    tp: string;
    g: string;
    r: number;
    s?: number;
    q?: number;
    o?: number;
    lv?: number;
    hd?: number;
    dt?: number;
    y?: number;
    pl?: number;
  }
  const curatedVideos = readJson<RawCuratedVideo[]>("site/videos.json", []);
  const seenIds = new Set<string>();
  const videoChannelById = new Map<string, string>();

  const insertVideo = db.prepare(`
    INSERT OR REPLACE INTO videos (
      id, t, c, d, tp, g, r, s, q, o, lv, hd, dt, y, pl, is_curated, norm_t, norm_c
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertFts = db.prepare(`
    INSERT INTO videos_fts (id, tokens, norm_title, norm_channel) VALUES (?, ?, ?, ?)
  `);

  db.exec("BEGIN");
  for (const v of curatedVideos) {
    if (!v.id || blockedNames.has(v.c)) continue;
    seenIds.add(v.id);
    videoChannelById.set(v.id, v.c);
    const sInfo = videoSeriesIndex.get(v.id);
    const pl = v.pl ?? sInfo?.pl ?? null;
    const lv =
      v.lv ??
      estimateVideoLevel(v.t, v.tp, v.g, v.d || 0, sInfo?.posRatio);
    const normT = normArabic(v.t);
    const normC = normArabic(v.c);
    insertVideo.run(
      v.id,
      v.t,
      v.c,
      v.d || 0,
      v.tp || "دروس عامة",
      v.g || "علماء",
      v.r ?? 0.5,
      v.s ?? null,
      v.q ?? null,
      v.o ?? null,
      lv,
      v.hd ? 1 : 0,
      v.dt ?? null,
      v.y ?? (v.dt ? Math.floor(v.dt / 10000) : null),
      pl,
      1,
      normT,
      normC
    );
    insertFts.run(
      v.id,
      buildSearchIndexTokens(v.t, v.c, v.tp || ""),
      normT,
      normC
    );
  }
  db.exec("COMMIT");
  console.log(`Seeded ${seenIds.size} curated videos from site/videos.json.`);

  // 5. Seed remaining search index videos from site/search.json
  interface RawSearchIndex {
    c: string[];
    tp: string[];
    g: string[];
    v: Array<[string, string, number, number, number, number, number, number]>;
  }
  const searchData = readJson<RawSearchIndex>("site/search.json", {
    c: [],
    tp: [],
    g: [],
    v: [],
  });
  let extraSearchCount = 0;
  db.exec("BEGIN");
  for (const row of searchData.v) {
    const [id, title, cIdx, dur, tpIdx, gIdx, pop, dt] = row;
    if (!id || seenIds.has(id)) continue;
    const channelName = searchData.c[cIdx] || "";
    if (!channelName || blockedNames.has(channelName)) continue;
    const topicName = searchData.tp[tpIdx] || "دروس عامة";
    const groupName = searchData.g[gIdx] || "علماء";
    seenIds.add(id);
    videoChannelById.set(id, channelName);
    const sInfo = videoSeriesIndex.get(id);
    const lv = estimateVideoLevel(title, topicName, groupName, dur || 0, sInfo?.posRatio);
    const normT = normArabic(title);
    const normC = normArabic(channelName);
    const r = Math.round(((pop || 0) / 99) * 1000) / 1000;
    const validDt = dt && dt > 19900000 ? dt : null;
    insertVideo.run(
      id,
      title,
      channelName,
      dur || 0,
      topicName,
      groupName,
      r,
      null,
      null,
      null,
      lv,
      0,
      validDt,
      validDt ? Math.floor(validDt / 10000) : null,
      sInfo?.pl ?? null,
      0,
      normT,
      normC
    );
    insertFts.run(
      id,
      buildSearchIndexTokens(title, channelName, topicName),
      normT,
      normC
    );
    extraSearchCount++;
  }
  db.exec("COMMIT");
  console.log(`Seeded ${extraSearchCount} additional search-index videos (total: ${seenIds.size}).`);

  // 5b. Seed any additional videos from data/found.jsonl
  const foundEntry = entries.get("data/found.jsonl");
  if (foundEntry) {
    const lines = readZipEntryBuffer(zipBuf, foundEntry)
      .toString("utf8")
      .split(/\r?\n/)
      .filter(Boolean);
    let foundCount = 0;
    db.exec("BEGIN");
    for (const line of lines) {
      const rec = JSON.parse(line) as {
        id: string;
        title: string;
        channel: string;
        duration?: number;
        q?: string;
      };
      if (!rec.id || seenIds.has(rec.id) || blockedNames.has(rec.channel)) continue;
      seenIds.add(rec.id);
      const normT = normArabic(rec.title);
      const normC = normArabic(rec.channel);
      const tp = rec.q || "دروس عامة";
      insertVideo.run(
        rec.id,
        rec.title,
        rec.channel,
        rec.duration || 0,
        tp,
        "بحث",
        0.4,
        0.5,
        null,
        null,
        estimateVideoLevel(rec.title, tp, "بحث", rec.duration || 0),
        0,
        null,
        null,
        null,
        0,
        normT,
        normC
      );
      insertFts.run(
        rec.id,
        buildSearchIndexTokens(rec.title, rec.channel, tp),
        normT,
        normC
      );
      foundCount++;
    }
    db.exec("COMMIT");
    if (foundCount > 0) {
      console.log(`Seeded ${foundCount} extra found.jsonl videos.`);
    }
  }

  // 6. Seed series table
  const insertSeries = db.prepare(
    "INSERT INTO series (id, t, c, videos_json) VALUES (?, ?, ?, ?)"
  );
  db.exec("BEGIN");
  rawSeries.forEach((s, idx) => {
    const firstChannel =
      s.v.map((vid) => videoChannelById.get(vid)).find(Boolean) || "";
    insertSeries.run(idx, s.t, firstChannel, JSON.stringify(s.v));
  });
  db.exec("COMMIT");
  console.log(`Seeded ${rawSeries.length} series.`);

  // 7. Seed comments, video_info, and transcripts
  const insertComment = db.prepare(
    "INSERT OR REPLACE INTO comments (video_id, comments_json) VALUES (?, ?)"
  );
  const insertInfo = db.prepare(
    "INSERT OR REPLACE INTO video_info (video_id, description, chapters_json) VALUES (?, ?, ?)"
  );
  const insertTranscript = db.prepare(
    "INSERT OR REPLACE INTO transcripts (video_id, lang, is_auto, lines_json) VALUES (?, ?, ?, ?)"
  );

  let commentCount = 0;
  let infoCount = 0;
  let transcriptCount = 0;
  db.exec("BEGIN");
  for (const [entryName, entry] of entries.entries()) {
    if (entryName.startsWith("site/comments/") && entryName.endsWith(".json")) {
      if (entry.uncompressedSize <= 4) continue;
      const vid = path.basename(entryName, ".json");
      const rawTxt = readZipEntryBuffer(zipBuf, entry).toString("utf8").trim();
      if (rawTxt && rawTxt !== "[]") {
        insertComment.run(vid, rawTxt);
        commentCount++;
      }
    } else if (entryName.startsWith("data/info/") && entryName.endsWith(".json")) {
      const vid = path.basename(entryName, ".json");
      const parsed = JSON.parse(
        readZipEntryBuffer(zipBuf, entry).toString("utf8")
      ) as { desc?: string; chapters?: Array<{ t: number; title: string }> };
      insertInfo.run(
        vid,
        parsed.desc || "",
        JSON.stringify(parsed.chapters || [])
      );
      infoCount++;
    } else if (
      entryName.startsWith("data/transcripts/") &&
      entryName.endsWith(".json")
    ) {
      const vid = path.basename(entryName, ".json");
      const parsed = JSON.parse(
        readZipEntryBuffer(zipBuf, entry).toString("utf8")
      ) as {
        lang?: string | null;
        auto?: boolean;
        lines?: Array<{ t: number; x: string }>;
      };
      if (parsed.lines?.length) {
        insertTranscript.run(
          vid,
          parsed.lang || "ar",
          parsed.auto ? 1 : 0,
          JSON.stringify(parsed.lines)
        );
        transcriptCount++;
      }
    }
  }
  db.exec("COMMIT");
  console.log(
    `Seeded ${commentCount} comment files, ${infoCount} video info files, ${transcriptCount} transcripts.`
  );
  db.close();
  console.log(`Database ready at ${dbPath}`);
}

main();
