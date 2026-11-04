import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
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
  let dbPath =
    process.env.MOHSEN_DB_PATH || path.join(process.cwd(), "data", "mohsen.db");
  if (!fs.existsSync(dbPath)) {
    throw new Error(
      `Database file not found at ${dbPath}. Run "npm run seed" first.`
    );
  }
  // Serverless hosts (Vercel) ship the bundle read-only; SQLite needs a writable file (WAL, rooms, labels),
  // so each instance works on its own copy in /tmp. Those writes are per-instance and short-lived.
  if (process.env.VERCEL) {
    const tmp = path.join(os.tmpdir(), "mohsen.db");
    if (!fs.existsSync(tmp)) fs.copyFileSync(dbPath, tmp);
    dbPath = tmp;
  }
  _db = new DatabaseSync(dbPath);
  _db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
  ensureSchema(_db);
  return _db;
}

/** Additive migrations for databases seeded before these columns/tables existed. */
function ensureSchema(db: DatabaseSync): void {
  const cols = (table: string) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
  if (!cols("rooms").includes("token_hash")) {
    db.exec(`ALTER TABLE rooms ADD COLUMN token_hash TEXT NOT NULL DEFAULT ''`);
  }
  if (!cols("labels").includes("voter")) {
    db.exec(`ALTER TABLE labels ADD COLUMN voter TEXT NOT NULL DEFAULT ''`);
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS labels_vote_idx ON labels (vid, ch, q, voter);
    CREATE TABLE IF NOT EXISTS related (vid TEXT PRIMARY KEY, ids_json TEXT NOT NULL);
  `);
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
    const videos = getFunPool();
    return { videos: videos.slice(offset, offset + limit), total: videos.length };
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

/**
 * مخزون صفحة الترفيه: متعة بتفيد. كل نوع ليه سقف عشان الكورة متاكلش الصفحة:
 * حِرف واختراعات وطبخ وزراعة كلها، حكايات (بودكاست + قصص السيرة القصيرة)، دقايق رقائق قصيرة،
 * مهارات في ربع ساعة، ورياضة بسقف صغير. الترتيب والتوزيع على الرفوف بيحصل عند المستخدم.
 */
// الترفيه مش مكان أخبار وسياسة ومناظرات: أي عنوان فيه الكلام ده بيتشال من رفوف الدين هنا
const NO_NEWS = ["غزة", "هدنة", "سياس", "انتخاب", "الرئيس", "الحكومة", "حرب", "إسرائيل", "الشيعة", "شيعي", "الدحيح"]
  .map((w) => `t NOT LIKE '%${w}%'`)
  .join(" AND ");
const FUN_BUCKETS: Array<{ where: string; limit: number }> = [
  { where: `g = 'اصنعها بنفسك'`, limit: 400 },
  { where: `g = 'بودكاست' AND tp != 'بيزنس'`, limit: 80 },
  { where: `g IN ('علماء', 'أنا السلفي') AND tp = 'سيرة وتاريخ' AND d BETWEEN 180 AND 1500 AND ${NO_NEWS}`, limit: 160 },
  { where: `g IN ('علماء', 'أنا السلفي') AND tp = 'رقائق' AND d BETWEEN 120 AND 1080 AND ${NO_NEWS}`, limit: 90 },
  { where: `g = 'كورسات' AND tp IN ('تصميم', 'تصوير', 'خط عربي', 'مونتاج', 'ذكاء اصطناعي', 'إكسل وأوفيس') AND d BETWEEN 120 AND 960`, limit: 120 },
  { where: `g = 'رياضة'`, limit: 40 },
];
// قصص وحكايات بتشد أكتر من المناظرات والردود، فبنقدّمها جوه نفس النوع
const STORY_BOOST = `(CASE WHEN t LIKE '%قصة%' OR t LIKE '%قصص%' OR t LIKE '%حكاية%' OR t LIKE '%سيرة%' THEN 0.25 ELSE 0 END)`;
let funCache: VideoItem[] | null = null;

export function getFunPool(): VideoItem[] {
  if (funCache) return funCache;
  const db = getDb();
  const seen = new Set<string>();
  const out: VideoItem[] = [];
  for (const b of FUN_BUCKETS) {
    const rows = db
      .prepare(
        `SELECT ${VIDEO_COLS} FROM videos
         WHERE is_curated = 1 AND (${b.where})
         ORDER BY (0.4 * COALESCE(s, r) + 0.25 * COALESCE(q, 0.4) + 0.15 * hd + 0.2 * COALESCE(dt, 20200101) / 20261231.0 + ${STORY_BOOST}) DESC
         LIMIT ?`
      )
      .all(b.limit) as unknown as RawVideoRow[];
    for (const r of rows) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(mapRowToVideo(r));
    }
  }
  funCache = out;
  return out;
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

/** "Watched together" graph: YouTube's related list for each given video (from site/related.json). */
export function getRelatedGraph(ids: string[]): Record<string, string[]> {
  const cleanIds = ids.slice(0, 60).filter((id) => /^[A-Za-z0-9_-]{6,16}$/.test(id));
  if (!cleanIds.length) return {};
  const db = getDb();
  const rows = db
    .prepare(`SELECT vid, ids_json FROM related WHERE vid IN (${cleanIds.map(() => "?").join(",")})`)
    .all(...cleanIds) as Array<{ vid: string; ids_json: string }>;
  const out: Record<string, string[]> = {};
  for (const r of rows) {
    try {
      const list: unknown = JSON.parse(r.ids_json);
      if (Array.isArray(list)) out[r.vid] = list.filter((x): x is string => typeof x === "string").slice(0, 12);
    } catch {}
  }
  // No YouTube list for a video (most of the catalog): fall back to its content-based related list
  const missing = cleanIds.filter((id) => !out[id]);
  for (const v of getVideosByIds(missing)) out[v.id] = computeRelated(v, 12).map((x) => x.id);
  return out;
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

/** Content-based related videos (same channel/topic + title-word overlap), via indexed lookups. */
function computeRelated(video: VideoItem, limit: number): VideoItem[] {
  const db = getDb();
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
  return relatedCandidates
    .map((cand) => {
      const item = mapRowToVideo(cand);
      const overlap = normArabic(item.t)
        .split(/\s+/)
        .filter((w) => titleWords.has(w)).length;
      const score =
        (item.c === video.c ? 2.0 : 0) + (item.tp === video.tp ? 1.5 : 0) + overlap * 1.1 + (item.s ?? item.r);
      return { score, item };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.item);
}

export function getVideoDetail(videoId: string, preferredSeries?: number): VideoDetailResponse | null {
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
  // The series the viewer actually opened wins (a video can sit in several playlists), else its main one
  const seriesRow = (sid: number) =>
    db.prepare(`SELECT id, t, videos_json FROM series WHERE id = ?`).get(sid) as
      | { id: number; t: string; videos_json: string }
      | undefined;
  let serRow =
    preferredSeries !== undefined && Number.isInteger(preferredSeries) && preferredSeries >= 0
      ? seriesRow(preferredSeries)
      : undefined;
  if (serRow && !(JSON.parse(serRow.videos_json) as string[]).includes(video.id)) serRow = undefined;
  if (!serRow && video.pl !== undefined && video.pl !== null) serRow = seriesRow(video.pl);
  {
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

  const scoredRelated = computeRelated(video, 20);

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

/**
 * The only answers each question accepts (the same chips the viewer is shown).
 * "similar" answers must be real channel names from the catalog (checked against the DB).
 */
export const LABEL_ANSWERS: Record<"aud" | "trait" | "edge", ReadonlySet<string>> = {
  aud: new Set([
    "أي حد", "المبتدئ في الموضوع", "طالب العلم", "الشباب", "الآباء والأمهات", "المتخصص", "الأطفال", "المتزوجين",
  ]),
  trait: new Set(["هادي", "حماسي", "مبسّط", "عميق", "عملي"]),
  edge: new Set([
    "بيبسّط الصعب", "أمثلة من الواقع", "دليل وتأصيل", "بيحرّك القلب", "بيجاوب على أسئلة الناس",
    "تطبيق خطوة بخطوة", "مختصر ومركّز", "شرح عميق",
  ]),
};
const MAX_VOTES_PER_TARGET = 500; // per (video or channel, question)

/** Stable, non-reversible voter fingerprint (e.g. from the client IP) so one person counts once per question. */
export function voterId(raw: string): string {
  return crypto.createHash("sha256").update("mohsen-label:" + raw).digest("hex").slice(0, 24);
}

export function saveViewerLabel(input: {
  vid: string;
  ch?: string;
  q: string;
  a: string[];
  voter?: string;
}): boolean {
  const kind = VALID_QUESTIONS[input.q];
  if (!kind) return false;
  if (!/^[A-Za-z0-9_-]{6,16}$/.test(input.vid)) return false;
  const db = getDb();
  const video = db.prepare(`SELECT c FROM videos WHERE id = ?`).get(input.vid) as { c: string } | undefined;
  if (!video) return false;
  // The channel always comes from the catalog, never from the caller
  const ch = video.c;

  const raw = [...new Set((input.a || []).map((x) => String(x).trim()))].filter(Boolean).slice(0, 3);
  let answers: string[];
  if (input.q === "similar") {
    const known = new Set(
      (raw.length
        ? (db
            .prepare(`SELECT name FROM channels WHERE name IN (${raw.map(() => "?").join(",")})`)
            .all(...raw) as Array<{ name: string }>)
        : []
      ).map((r) => r.name)
    );
    answers = raw.filter((x) => known.has(x) && x !== ch);
  } else {
    const allowed = LABEL_ANSWERS[input.q as "aud" | "trait" | "edge"];
    answers = raw.filter((x) => allowed.has(x));
  }
  if (!answers.length) return false;

  // Video questions are keyed by video, channel questions by channel (so one vote per channel, not per video)
  const keyVid = kind === "video" ? input.vid : "";
  const keyCh = kind === "video" ? "" : ch;
  const voter = input.voter || "";
  if (voter) {
    const dup = db
      .prepare(`SELECT 1 FROM labels WHERE vid = ? AND ch = ? AND q = ? AND voter = ? LIMIT 1`)
      .get(keyVid, keyCh, input.q, voter);
    if (dup) return false;
  }
  const count = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM labels WHERE vid = ? AND ch = ? AND q = ?`)
      .get(keyVid, keyCh, input.q) as { n: number }
  ).n;
  if (count >= MAX_VOTES_PER_TARGET) return false;

  db.prepare(
    `INSERT INTO labels (vid, ch, q, answers_json, created_at, voter) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(keyVid, keyCh, input.q, JSON.stringify(answers), Math.floor(Date.now() / 1000), voter);
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
    if (!key) continue;
    let answers: unknown;
    try {
      answers = JSON.parse(r.answers_json);
    } catch {
      continue;
    }
    if (!Array.isArray(answers)) continue;
    const qMap = ((bucket[key] = bucket[key] || {})[r.q] = bucket[key][r.q] || {});
    for (const ans of answers) {
      if (typeof ans !== "string") continue;
      // Rows saved before the allowlist existed only count if the answer is still valid
      if (r.q !== "similar" && !LABEL_ANSWERS[r.q as "aud" | "trait" | "edge"].has(ans)) continue;
      qMap[ans] = (qMap[ans] || 0) + 1;
    }
  }
  return out;
}

// ---------- Watch-together rooms ----------
// Codes and tokens come from the server's CSPRNG. Only a token holder (the creator, or someone who joined
// with the code) can change the room. The creator token is stored only as a SHA-256 hash; member tokens
// are an HMAC of the room code keyed by that hash, so they never need to be stored.
const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
const ROOM_CODE_LEN = 8; // 32^8 ≈ 1.1e12 codes
const ROOM_TTL_SEC = 6 * 3600;

const cleanRoomCode = (code: string) =>
  String(code || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);
const hashToken = (token: string) => crypto.createHash("sha256").update(String(token)).digest("hex");
const memberToken = (code: string, tokenHash: string) =>
  "m." + crypto.createHmac("sha256", tokenHash).update("member:" + code).digest("base64url");

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function newRoomCode(): string {
  const bytes = crypto.randomBytes(ROOM_CODE_LEN);
  let out = "";
  for (let i = 0; i < ROOM_CODE_LEN; i++) out += ROOM_ALPHABET[bytes[i] % ROOM_ALPHABET.length];
  return out;
}

function roomRow(cleanCode: string) {
  if (!cleanCode) return undefined;
  const db = getDb();
  db.prepare(`DELETE FROM rooms WHERE ? - updated_at > ?`).run(Date.now() / 1000, ROOM_TTL_SEC);
  return db
    .prepare(`SELECT code, vid, t, playing, by_user, updated_at, token_hash FROM rooms WHERE code = ?`)
    .get(cleanCode) as
    | {
        code: string;
        vid: string;
        t: number;
        playing: number;
        by_user: string;
        updated_at: number;
        token_hash: string;
      }
    | undefined;
}

export function getRoom(code: string): RoomState | null {
  const row = roomRow(cleanRoomCode(code));
  if (!row) return null;
  return {
    code: row.code,
    vid: row.vid,
    t: row.t,
    playing: !!row.playing,
    by: row.by_user,
    ts: row.updated_at,
    now: Date.now() / 1000,
  };
}

function cleanRoomInput(input: { vid: string; t: number; by: string }) {
  const vid = String(input.vid || "").trim();
  const by = String(input.by || "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 20);
  if (!/^[A-Za-z0-9_-]{6,16}$/.test(vid) || !by) return null;
  if (!getDb().prepare(`SELECT 1 FROM videos WHERE id = ?`).get(vid)) return null;
  return { vid, by, t: Math.max(0, Math.min(Number(input.t) || 0, 86400)) };
}

/** Creates a room with a server-generated code; returns the room plus the creator's secret token. */
export function createRoom(input: {
  vid: string;
  t: number;
  playing: boolean;
  by: string;
}): { room: RoomState; token: string } | null {
  const clean = cleanRoomInput(input);
  if (!clean) return null;
  const token = crypto.randomBytes(24).toString("base64url");
  let code = newRoomCode();
  for (let i = 0; i < 5 && roomRow(code); i++) code = newRoomCode();
  getDb()
    .prepare(
      `INSERT INTO rooms (code, vid, t, playing, by_user, updated_at, token_hash) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(code, clean.vid, clean.t, input.playing ? 1 : 0, clean.by, Date.now() / 1000, hashToken(token));
  const room = getRoom(code);
  return room ? { room, token } : null;
}

/** Joining with the code hands out a member token, so the friend can also play/pause/seek. */
export function joinRoom(code: string): { room: RoomState; token: string } | null {
  const row = roomRow(cleanRoomCode(code));
  if (!row || !row.token_hash) return null;
  const room = getRoom(row.code);
  return room ? { room, token: memberToken(row.code, row.token_hash) } : null;
}

/** Updates a room; requires the creator token or a member token. */
export function updateRoom(input: {
  code: string;
  token: string;
  vid: string;
  t: number;
  playing: boolean;
  by: string;
}): RoomState | null {
  const row = roomRow(cleanRoomCode(input.code));
  if (!row || !row.token_hash) return null;
  const token = String(input.token || "");
  if (!safeEqual(hashToken(token), row.token_hash) && !safeEqual(token, memberToken(row.code, row.token_hash))) {
    return null;
  }
  const clean = cleanRoomInput(input);
  if (!clean) return null;
  getDb()
    .prepare(`UPDATE rooms SET vid = ?, t = ?, playing = ?, by_user = ?, updated_at = ? WHERE code = ?`)
    .run(clean.vid, clean.t, input.playing ? 1 : 0, clean.by, Date.now() / 1000, row.code);
  return getRoom(row.code);
}
