/**
 * يضيف قوائم تشغيل قناة (series) بترتيبها، ويربط كل فيديو بأول قائمة هو فيها (pl).
 * المدخل: json = [{id, title, videos: [{id}]}] لقناة واحدة.
 * الاستخدام: node --experimental-strip-types scripts/import-playlists.ts <playlists.json> "<اسم القناة في الموقع>"
 */
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const lists = JSON.parse(fs.readFileSync(process.argv[2], "utf8")) as Array<{ title: string; videos: Array<{ id: string }> }>;
const channel = process.argv[3];
const db = new DatabaseSync("data/mohsen.db");
const inCatalog = db.prepare(`SELECT 1 FROM videos WHERE id = ? AND is_curated = 1`);
const sameTitle = db.prepare(`SELECT id FROM series WHERE c = ? AND t = ?`);
const ins = db.prepare(`INSERT INTO series (id, t, c, videos_json) VALUES (?, ?, ?, ?)`);
const upd = db.prepare(`UPDATE series SET videos_json = ? WHERE id = ?`);
const setPl = db.prepare(`UPDATE videos SET pl = ? WHERE id = ? AND pl IS NULL`);
let nextId = ((db.prepare(`SELECT MAX(id) AS m FROM series`).get() as { m: number | null }).m ?? -1) + 1;
let added = 0;
db.exec("BEGIN");
for (const l of lists) {
  const ids = [...new Set(l.videos.map((v) => v.id))].filter((id) => inCatalog.get(id));
  if (ids.length < 2 || !l.title) continue;
  const old = sameTitle.get(channel, l.title) as { id: number } | undefined;
  const sid = old ? old.id : nextId++;
  if (old) upd.run(JSON.stringify(ids), sid);
  else ins.run(sid, l.title, channel, JSON.stringify(ids));
  for (const id of ids) setPl.run(sid, id);
  added++;
}
db.exec("COMMIT");
db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
console.log(`${channel}: ${added} playlists`);
