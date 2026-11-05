/**
 * يضيف فيديوهات قنوات جديدة لقاعدة البيانات مباشرة (من غير إعادة بناء الكتالوج كله).
 * المدخل: ملف jsonl فيه {id,title,duration,views,channel,channel_id,group,field}، كل سطر فيديو عدّى الفحص.
 * الاستخدام: node --experimental-strip-types scripts/import-channels.ts <videos.jsonl>
 */
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { estimateVideoLevel, normArabic, stemWord, tokenizeWords } from "../src/lib/arabic.ts";

type Row = { id: string; title: string; duration: number; views?: number; channel: string; channel_id: string; group: string; field: string };

function tokens(title: string, channel: string, topic: string): string {
  const out = new Set<string>();
  for (const w of tokenizeWords(`${title} ${channel} ${topic}`)) {
    out.add(w);
    const s = stemWord(w);
    if (s) out.add(s);
  }
  return [...out].join(" ");
}

const rows: Row[] = fs.readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const db = new DatabaseSync("data/mohsen.db");
const blocked = new Set(Object.values(JSON.parse(fs.readFileSync("data/blocked_channels.json", "utf8")) as Record<string, string>));

const upChannel = db.prepare(`INSERT OR IGNORE INTO channels (name, id, grp, field, priority, norm_name) VALUES (?, ?, ?, ?, 0, ?)`);
const exists = db.prepare(`SELECT is_curated FROM videos WHERE id = ?`);
const markCurated = db.prepare(`UPDATE videos SET is_curated = 1 WHERE id = ?`);
const insVideo = db.prepare(`INSERT INTO videos (id, t, c, d, tp, g, r, s, q, o, lv, hd, dt, y, pl, is_curated, norm_t, norm_c)
  VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, 0, NULL, NULL, NULL, 1, ?, ?)`);
const insFts = db.prepare(`INSERT INTO videos_fts (id, tokens, norm_title, norm_channel) VALUES (?, ?, ?, ?)`);

let added = 0, promoted = 0;
db.exec("BEGIN");
const seenCh = new Set<string>();
for (const v of rows) {
  if (!v.id || !v.title || blocked.has(v.channel)) continue;
  if (!seenCh.has(v.channel)) {
    upChannel.run(v.channel, v.channel_id, v.group, v.field, normArabic(v.channel));
    seenCh.add(v.channel);
  }
  const have = exists.get(v.id) as { is_curated: number } | undefined;
  if (have) {
    if (!have.is_curated) { markCurated.run(v.id); promoted++; }
    continue;
  }
  const r = Math.round(Math.min(1, Math.log10((v.views || 0) + 1) / 7) * 1000) / 1000;
  const normT = normArabic(v.title), normC = normArabic(v.channel);
  insVideo.run(v.id, v.title, v.channel, Math.round(v.duration || 0), v.field, v.group, r,
    estimateVideoLevel(v.title, v.field, v.group, v.duration || 0, undefined), normT, normC);
  insFts.run(v.id, tokens(v.title, v.channel, v.field), normT, normC);
  added++;
}
db.exec("COMMIT");
db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
console.log(`added ${added}, promoted ${promoted}, channels ${seenCh.size}`);
