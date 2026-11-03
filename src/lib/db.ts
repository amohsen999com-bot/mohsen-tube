import path from "node:path";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type {
  ChannelInfo,
  CommentItem,
  LabelsAggregate,
  RoomState,
  SeriesItem,
  VideoDetailResponse,
  VideoItem,
} from "./types.ts";
import {
  editDistance1,
  getSynonyms,
  normArabic,
  stemWord,
  tokenizeWords,
} from "./arabic.ts";

let _db: DatabaseSync | null = null;
let _vocabCache: string[] | null = null;

export function getDb(): DatabaseSync {
  if (_db) return _db;
  const dbPath =
    process.env.MOHSEN_DB_PATH || path.join(process.cwd(), "data", "mohsen.db");
  if (!fs.existsSync(dbPath)) {
    throw new Error(
      `Database file not found at ${dbPath}. Run "npm run seed" first.`
    );
  }
  _db = new DatabaseSync(dbPath);
  _db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
  return _db;
}

interface RawVideoRow {
  id: string;
  t: string;
  c: string;
  d: number;
  tp: string;
  g: string;
  r: number;
  s: number | null;
  q: number | null;
  o: number | null;
  lv: number;
  hd: number;
  dt: number | null;
  y: number | null;
  pl: number | null;
}

function mapRowToVideo(row: RawVideoRow): VideoItem {
  const v: VideoItem = {
    id: row.id,
    t: row.t,
    c: row.c,
    d: row.d,
    tp: row.tp,
    g: row.g,
    r: row.r,
    lv: row.lv,
  };
  if (row.s !== null && row.s !== undefined) v.s = row.s;
  if (row.q !== null && row.q !== undefined) v.q = row.q;
  if (row.o !== null && row.o !== undefined) v.o = row.o;
  if (row.hd) v.hd = 1;
  if (row.dt) v.dt = row.dt;
  if (row.y) v.y = row.y;
  if (row.pl !== null && row.pl !== undefined) v.pl = row.pl;
  return v;
}

const VIDEO_COLS =
  "id, t, c, d, tp, g, r, s, q, o, lv, hd, dt, y, pl";

export function getCatalogSummary() {
  const db = getDb();
  const topics = db
    .prepare(
      `SELECT tp, g, COUNT(*) as count
       FROM videos
       WHERE is_curated = 1
       GROUP BY tp, g
       ORDER BY count DESC`
    )
    .all() as Array<{ tp: string; g: string; count: number }>;

  const channels = db
    .prepare(
      `SELECT name, id, grp as "group", field, priority
       FROM channels
       ORDER BY priority DESC, name ASC`
    )
    .all() as Array<{
    name: string;
    id: string;
    group: string;
    field: string | null;
    priority: number;
  }>;

  return {
    topics,
    channels: channels.map((c) => ({
      name: c.name,
      id: c.id,
      group: c.group,
      field: c.field || undefined,
      priority: !!c.priority,
    })),
  };
}

export function getFeedVideos(options: {
  topic?: string;
  category?: "all" | "fun";
  limit?: number;
  offset?: number;
}): { videos: VideoItem[]; total: number } {
  const db = getDb();
  const limit = Math.min(Math.max(options.limit || 240, 1), 1500);
  const offset = Math.max(options.offset || 0, 0);

  if (options.category === "fun") {
    const whereClause = `is_curated = 1 AND g IN ('اصنعها بنفسك', 'رياضة') OR (is_curated = 1 AND g = 'بودكاست' AND tp != 'بيزنس')`;
    const totalRow = db
      .prepare(`SELECT COUNT(*) as cnt FROM videos WHERE ${whereClause}`)
      .get() as { cnt: number };
    const rows = db
      .prepare(
        `SELECT ${VIDEO_COLS}
         FROM videos
         WHERE ${whereClause}
         ORDER BY (0.3 * COALESCE(dt, 20200101) / 20261231.0 + 0.25 * hd + 0.25 * COALESCE(q, 0.4) + 0.2 * COALESCE(s, r)) DESC
         LIMIT ? OFFSET ?`
      )
      .all(limit, offset) as unknown as RawVideoRow[];
    return { videos: rows.map(mapRowToVideo), total: totalRow.cnt };
  }

  if (options.topic) {
    const totalRow = db
      .prepare(
        `SELECT COUNT(*) as cnt FROM videos WHERE is_curated = 1 AND tp = ?`
      )
      .get(options.topic) as { cnt: number };
    const rows = db
      .prepare(
        `SELECT ${VIDEO_COLS}
         FROM videos
         WHERE is_curated = 1 AND tp = ?
         ORDER BY COALESCE(s, r) DESC, COALESCE(dt, 0) DESC
         LIMIT ? OFFSET ?`
      )
      .all(options.topic, limit, offset) as unknown as RawVideoRow[];
    return { videos: rows.map(mapRowToVideo), total: totalRow.cnt };
  }

  // Balanced pool across وعظ, عمل, ترفيه so client Two-Tower & rhythm engine has rich candidates
  const totalRow = db
    .prepare(`SELECT COUNT(*) as cnt FROM videos WHERE is_curated = 1`)
    .get() as { cnt: number };

  const rows = db
    .prepare(
      `SELECT ${VIDEO_COLS}
       FROM videos
       WHERE is_curated = 1
       ORDER BY (0.55 * COALESCE(s, r) + 0.25 * COALESCE(q, 0.5) + 0.2 * hd) DESC
       LIMIT ? OFFSET ?`
    )
    .all(limit, offset) as unknown as RawVideoRow[];

  return { videos: rows.map(mapRowToVideo), total: totalRow.cnt };
}

export function getVideosByIds(ids: string[]): VideoItem[] {
  if (!ids.length) return [];
  const db = getDb();
  const cleanIds = ids.slice(0, 200).filter((id) => /^[A-Za-z0-9_-]{6,16}$/.test(id));
  if (!cleanIds.length) return [];
  const placeholders = cleanIds.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT ${VIDEO_COLS} FROM videos WHERE id IN (${placeholders})`)
    .all(...cleanIds) as unknown as RawVideoRow[];
  const byId = new Map(rows.map((r) => [r.id, mapRowToVideo(r)]));
  return cleanIds.map((id) => byId.get(id)).filter((v): v is VideoItem => !!v);
}

export function getVideosByChannels(channelNames: string[], limit = 200): VideoItem[] {
  if (!channelNames.length) return [];
  const db = getDb();
  const clean = channelNames.slice(0, 100);
  const placeholders = clean.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT ${VIDEO_COLS}
       FROM videos
       WHERE is_curated = 1 AND c IN (${placeholders})
       ORDER BY COALESCE(dt, 0) DESC, COALESCE(s, r) DESC
       LIMIT ?`
    )
    .all(...clean, limit) as unknown as RawVideoRow[];
  return rows.map(mapRowToVideo);
}

export function getVideoDetail(videoId: string): VideoDetailResponse | null {
  if (!/^[A-Za-z0-9_-]{6,16}$/.test(videoId)) return null;
  const db = getDb();
  const row = db
    .prepare(`SELECT ${VIDEO_COLS} FROM videos WHERE id = ?`)
    .get(videoId) as unknown as RawVideoRow | undefined;
  if (!row) return null;

  const video = mapRowToVideo(row);

  const chRow = db
    .prepare(
      `SELECT name, id, grp as "group", field, priority FROM channels WHERE name = ?`
    )
    .get(video.c) as
    | {
        name: string;
        id: string;
        group: string;
        field: string | null;
        priority: number;
      }
    | undefined;

  const channel: ChannelInfo | null = chRow
    ? {
        name: chRow.name,
        id: chRow.id,
        group: chRow.group,
        field: chRow.field || undefined,
        priority: !!chRow.priority,
      }
    : null;

  let series: VideoDetailResponse["series"] = null;
  if (video.pl !== undefined && video.pl !== null) {
    const serRow = db
      .prepare(`SELECT id, t, videos_json FROM series WHERE id = ?`)
      .get(video.pl) as { id: number; t: string; videos_json: string } | undefined;
    if (serRow) {
      const vidIds = JSON.parse(serRow.videos_json) as string[];
      const epVideos = getVideosByIds(vidIds);
      const idx = vidIds.indexOf(video.id);
      const nextId = idx >= 0 && idx + 1 < vidIds.length ? vidIds[idx + 1] : null;
      const nextVideo = nextId
        ? epVideos.find((x) => x.id === nextId) || null
        : null;
      series = {
        id: serRow.id,
        title: serRow.t,
        videos: epVideos,
        nextVideo,
      };
    }
  }

  // Compute related videos server-side using indexed lookups (channel + topic + title word overlap)
  const relatedCandidates = db
    .prepare(
      `SELECT ${VIDEO_COLS}
       FROM videos
       WHERE is_curated = 1 AND id != ? AND (c = ? OR tp = ?)
       ORDER BY (CASE WHEN c = ? THEN 1.5 ELSE 0 END + CASE WHEN tp = ? THEN 1.2 ELSE 0 END + COALESCE(s, r)) DESC
       LIMIT 60`
    )
    .all(video.id, video.c, video.tp, video.c, video.tp) as unknown as RawVideoRow[];

  const titleWords = new Set(
    normArabic(video.t)
      .split(/\s+/)
      .filter((w) => w.length > 3)
  );
  const scoredRelated = relatedCandidates
    .map((cand) => {
      const item = mapRowToVideo(cand);
      const overlap = normArabic(item.t)
        .split(/\s+/)
        .filter((w) => titleWords.has(w)).length;
      const score =
        (item.c === video.c ? 2.0 : 0) +
        (item.tp === video.tp ? 1.5 : 0) +
        overlap * 1.1 +
        (item.s ?? item.r);
      return { score, item };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map((x) => x.item);

  if (series?.nextVideo && !scoredRelated.some((x) => x.id === series!.nextVideo!.id)) {
    scoredRelated.unshift(series.nextVideo);
  }

  // Comments
  const cmtRow = db
    .prepare(`SELECT comments_json FROM comments WHERE video_id = ?`)
    .get(video.id) as { comments_json: string } | undefined;
  const comments: CommentItem[] = cmtRow ? JSON.parse(cmtRow.comments_json) : [];

  // Description & chapters
  const infoRow = db
    .prepare(
      `SELECT description, chapters_json FROM video_info WHERE video_id = ?`
    )
    .get(video.id) as { description: string; chapters_json: string } | undefined;

  // Transcript
  const trRow = db
    .prepare(
      `SELECT lang, is_auto, lines_json FROM transcripts WHERE video_id = ?`
    )
    .get(video.id) as
    | { lang: string | null; is_auto: number; lines_json: string }
    | undefined;

  return {
    video,
    channel,
    series,
    related: scoredRelated.slice(0, 20),
    comments,
    description: infoRow?.description || "",
    chapters: infoRow ? JSON.parse(infoRow.chapters_json) : [],
    transcript: trRow
      ? {
          lang: trRow.lang,
          auto: !!trRow.is_auto,
          lines: JSON.parse(trRow.lines_json),
        }
      : null,
  };
}

function getVocabulary(db: DatabaseSync): string[] {
  if (_vocabCache) return _vocabCache;
  const rows = db
    .prepare(`SELECT t, c FROM videos WHERE is_curated = 1`)
    .all() as Array<{ t: string; c: string }>;
  const set = new Set<string>();
  for (const r of rows) {
    for (const w of tokenizeWords(`${r.t} ${r.c}`)) {
      if (w.length >= 3) set.add(w);
      const s = stemWord(w);
      if (s.length >= 3) set.add(s);
    }
  }
  _vocabCache = [...set];
  return _vocabCache;
}

export function searchVideos(
  query: string,
  options?: {
    limit?: number;
    duration?: "short" | "mid" | "long" | "";
    channel?: string;
    sort?: "rel" | "new" | "short";
    suggestOnly?: boolean;
  }
): VideoItem[] {
  const db = getDb();
  const qNorm = normArabic(query).trim();
  const raws = [...new Set(tokenizeWords(query))].filter((t) => t.length > 1);
  if (!raws.length) return [];

  const limit = Math.min(Math.max(options?.limit || 80, 1), 160);
  const terms = raws.map(stemWord).filter(Boolean);
  const vocab = getVocabulary(db);

  // Build expanded FTS5 query groups per term (term + stem + synonyms + prefix + 1-edit typo fallback)
  const termClauses: string[] = [];
  const expandedScoringTerms = new Set<string>([
    ...terms,
    ...raws,
    ...terms.flatMap(getSynonyms),
  ]);

  for (let i = 0; i < terms.length; i++) {
    const t = terms[i];
    const raw = raws[i];
    const variants = new Set<string>([t, raw]);
    for (const syn of getSynonyms(t)) variants.add(syn);
    for (const syn of getSynonyms(raw)) variants.add(syn);

    // Check if raw or stem exists as an exact token in vocab; if not, check 1-edit typo in vocab
    const hasExact = vocab.includes(raw) || vocab.includes(t);
    if (!hasExact && (raw.length >= 4 || t.length >= 3)) {
      let typoMatches = 0;
      for (const v of vocab) {
        if (editDistance1(raw, v) || (t.length >= 3 && editDistance1(t, v))) {
          variants.add(v);
          for (const syn of getSynonyms(v)) variants.add(syn);
          if (++typoMatches >= 8) break;
        }
      }
    }

    const safeTokens = [...variants]
      .map((x) => x.replace(/[^a-z0-9\u0621-\u064A+#]/gi, ""))
      .filter((x) => x.length >= 2);

    for (const tok of safeTokens) {
      expandedScoringTerms.add(tok);
    }

    if (safeTokens.length) {
      const sub = [...new Set(safeTokens)]
        .slice(0, 14)
        .map((tok) => (tok.length >= 3 ? `"${tok}"*` : `"${tok}"`))
        .join(" OR ");
      termClauses.push(`(${sub})`);
    }
  }

  if (!termClauses.length) return [];

  // First try AND across term groups, then OR fallback for broader recall
  const andMatch = termClauses.join(" AND ");
  const orMatch = termClauses.join(" OR ");

  let candidateIds = db
    .prepare(
      `SELECT id FROM videos_fts WHERE videos_fts MATCH ? LIMIT 300`
    )
    .all(andMatch) as Array<{ id: string }>;

  if (candidateIds.length < 30 && termClauses.length > 1) {
    const more = db
      .prepare(
        `SELECT id FROM videos_fts WHERE videos_fts MATCH ? LIMIT 300`
      )
      .all(orMatch) as Array<{ id: string }>;
    const seen = new Set(candidateIds.map((r) => r.id));
    for (const m of more) {
      if (!seen.has(m.id)) {
        seen.add(m.id);
        candidateIds.push(m);
      }
    }
  }

  if (!candidateIds.length) return [];

  const ids = candidateIds.slice(0, 300).map((r) => r.id);
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT ${VIDEO_COLS}, is_curated, norm_t, norm_c
       FROM videos
       WHERE id IN (${placeholders})`
    )
    .all(...ids) as unknown as Array<
    RawVideoRow & { is_curated: number; norm_t: string; norm_c: string }
  >;

  const arabicQ = /[\u0600-\u06FF]/.test(query);
  const allSearchTerms = expandedScoringTerms;

  const scored: Array<{ score: number; video: VideoItem }> = [];
  for (const r of rows) {
    if (options?.channel && r.c !== options.channel) continue;
    if (options?.duration === "short" && r.d >= 600) continue;
    if (options?.duration === "mid" && (r.d < 600 || r.d > 1800)) continue;
    if (options?.duration === "long" && r.d <= 1800) continue;

    let score = 0;
    let termHits = 0;
    for (const st of allSearchTerms) {
      if (r.norm_t.includes(st)) {
        score += 2.2;
        termHits++;
      }
      if (r.norm_c.includes(st)) {
        score += 2.5;
        termHits++;
      }
    }
    const cover = Math.min(1, termHits / Math.max(terms.length, 1));
    score *= 0.4 + 0.6 * cover;
    if (r.norm_t.includes(qNorm)) score += 3.5;
    if (r.norm_c.includes(qNorm)) score += 4.0;
    score += 0.6 * (r.r || 0);
    if (r.is_curated) score += 0.8 + 0.4 * (r.s ?? r.r ?? 0.5);
    if (arabicQ === /[\u0600-\u06FF]/.test(r.t)) score += 1.0;

    scored.push({ score, video: mapRowToVideo(r) });
  }

  scored.sort((a, b) => b.score - a.score);
  const cut = scored.length ? scored[0].score * 0.35 : 0;
  let filtered = scored.filter((x) => x.score >= cut).map((x) => x.video);

  if (options?.sort === "new") {
    filtered = [...filtered].sort((a, b) => (b.dt || 0) - (a.dt || 0));
  } else if (options?.sort === "short") {
    filtered = [...filtered].sort((a, b) => (a.d || 0) - (b.d || 0));
  }

  return filtered.slice(0, options?.suggestOnly ? 8 : limit);
}

export function getChannelPageData(channelName: string) {
  const db = getDb();
  const chRow = db
    .prepare(
      `SELECT name, id, grp as "group", field, priority FROM channels WHERE name = ?`
    )
    .get(channelName) as
    | {
        name: string;
        id: string;
        group: string;
        field: string | null;
        priority: number;
      }
    | undefined;

  const videoRows = db
    .prepare(
      `SELECT ${VIDEO_COLS}
       FROM videos
       WHERE c = ? AND is_curated = 1
       ORDER BY COALESCE(s, r) DESC, COALESCE(dt, 0) DESC`
    )
    .all(channelName) as unknown as RawVideoRow[];

  if (!videoRows.length && !chRow) return null;

  const videos = videoRows.map(mapRowToVideo);

  const seriesRows = db
    .prepare(`SELECT id, t, videos_json FROM series WHERE c = ?`)
    .all(channelName) as Array<{ id: number; t: string; videos_json: string }>;

  const series: SeriesItem[] = seriesRows.map((s) => ({
    id: s.id,
    t: s.t,
    v: JSON.parse(s.videos_json),
    channel: channelName,
  }));

  return {
    channel: {
      name: channelName,
      id: chRow?.id || "",
      group: chRow?.group || videos[0]?.g || "علماء",
      field: chRow?.field || undefined,
      priority: !!chRow?.priority,
      videoCount: videos.length,
    },
    videos,
    series,
  };
}

const VALID_QUESTIONS: Record<string, "video" | "channel"> = {
  aud: "video",
  trait: "channel",
  edge: "channel",
  similar: "channel",
};

export function saveViewerLabel(input: {
  vid: string;
  ch: string;
  q: string;
  a: string[];
}): boolean {
  if (!VALID_QUESTIONS[input.q]) return false;
  if (!/^[A-Za-z0-9_-]{6,16}$/.test(input.vid)) return false;
  const answers = (input.a || [])
    .map((x) => String(x).trim().slice(0, 60))
    .filter(Boolean)
    .slice(0, 3);
  if (!answers.length) return false;
  const db = getDb();
  db.prepare(
    `INSERT INTO labels (vid, ch, q, answers_json, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run(
    input.vid.slice(0, 20),
    String(input.ch || "").slice(0, 120),
    input.q,
    JSON.stringify(answers),
    Math.floor(Date.now() / 1000)
  );
  return true;
}

export function getAggregatedLabels(): LabelsAggregate {
  const db = getDb();
  const rows = db
    .prepare(`SELECT vid, ch, q, answers_json FROM labels`)
    .all() as Array<{
    vid: string;
    ch: string;
    q: string;
    answers_json: string;
  }>;

  const out: LabelsAggregate = { v: {}, c: {} };
  for (const r of rows) {
    const kind = VALID_QUESTIONS[r.q];
    if (!kind) continue;
    const bucket = kind === "video" ? out.v : out.c;
    const key = kind === "video" ? r.vid : r.ch;
    const qMap = ((bucket[key] = bucket[key] || {})[r.q] =
      bucket[key][r.q] || {});
    const answers = JSON.parse(r.answers_json) as string[];
    for (const ans of answers) {
      qMap[ans] = (qMap[ans] || 0) + 1;
    }
  }
  return out;
}

export function getRoom(code: string): RoomState | null {
  const cleanCode = String(code || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);
  if (!cleanCode) return null;
  const db = getDb();
  const now = Date.now() / 1000;
  db.prepare(`DELETE FROM rooms WHERE ? - updated_at > 21600`).run(now);
  const row = db
    .prepare(
      `SELECT code, vid, t, playing, by_user, updated_at FROM rooms WHERE code = ?`
    )
    .get(cleanCode) as
    | {
        code: string;
        vid: string;
        t: number;
        playing: number;
        by_user: string;
        updated_at: number;
      }
    | undefined;
  if (!row) return null;
  return {
    code: row.code,
    vid: row.vid,
    t: row.t,
    playing: !!row.playing,
    by: row.by_user,
    ts: row.updated_at,
    now,
  };
}

export function upsertRoom(input: {
  code: string;
  vid: string;
  t: number;
  playing: boolean;
  by: string;
}): RoomState | null {
  const cleanCode = String(input.code || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);
  const cleanVid = String(input.vid || "").trim();
  const cleanBy = String(input.by || "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 20);
  if (!cleanCode || !/^[A-Za-z0-9_-]{6,16}$/.test(cleanVid) || !cleanBy) {
    return null;
  }
  const db = getDb();
  // Verify the video exists in our catalog
  const exists = db
    .prepare(`SELECT 1 FROM videos WHERE id = ?`)
    .get(cleanVid);
  if (!exists) return null;

  const now = Date.now() / 1000;
  const safeTime = Math.max(0, Math.min(Number(input.t) || 0, 86400));
  db.prepare(
    `INSERT OR REPLACE INTO rooms (code, vid, t, playing, by_user, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(cleanCode, cleanVid, safeTime, input.playing ? 1 : 0, cleanBy, now);

  return getRoom(cleanCode);
}
