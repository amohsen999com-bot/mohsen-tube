/**
 * Removes a channel from the catalog completely and remembers it, so a future re-seed keeps it out.
 *   node --experimental-strip-types scripts/block-channel.ts "beIN SPORTS"
 * Deletes its videos everywhere (videos, search index, series, comments, info, transcripts, labels,
 * related lists), then records it in data/blocked_channels.json and compacts the database.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const name = process.argv[2];
if (!name) {
  console.error('Usage: block-channel.ts "<channel name>"');
  process.exit(1);
}

const dbPath = path.join(process.cwd(), "data", "mohsen.db");
const db = new DatabaseSync(dbPath);

const channel = db.prepare("SELECT id FROM channels WHERE name = ?").get(name) as { id: string } | undefined;
const ids = (db.prepare("SELECT id FROM videos WHERE c = ?").all(name) as Array<{ id: string }>).map((r) => r.id);
if (!channel && !ids.length) {
  console.error(`No channel or videos named "${name}"`);
  process.exit(1);
}
const gone = new Set(ids);

db.exec("BEGIN");
const byVideo: Array<[string, string]> = [
  ["videos", "id"],
  ["videos_fts", "id"],
  ["comments", "video_id"],
  ["video_info", "video_id"],
  ["transcripts", "video_id"],
  ["labels", "vid"],
  ["related", "vid"],
];
for (const [table, col] of byVideo) {
  const del = db.prepare(`DELETE FROM ${table} WHERE ${col} = ?`);
  for (const id of ids) del.run(id);
}
db.prepare("DELETE FROM labels WHERE ch = ?").run(name);
db.prepare("DELETE FROM series WHERE c = ?").run(name);
db.prepare("DELETE FROM channels WHERE name = ?").run(name);

// Other videos' related lists may still point at the removed ones
const relRows = db.prepare("SELECT vid, ids_json FROM related").all() as Array<{ vid: string; ids_json: string }>;
const upd = db.prepare("UPDATE related SET ids_json = ? WHERE vid = ?");
let relFixed = 0;
for (const r of relRows) {
  const list = JSON.parse(r.ids_json) as string[];
  const kept = list.filter((id) => !gone.has(id));
  if (kept.length !== list.length) {
    upd.run(JSON.stringify(kept), r.vid);
    relFixed++;
  }
}
db.exec("COMMIT");
db.exec("VACUUM");
db.close();

const listPath = path.join(process.cwd(), "data", "blocked_channels.json");
const blocked = fs.existsSync(listPath) ? (JSON.parse(fs.readFileSync(listPath, "utf8")) as Record<string, string>) : {};
blocked[channel?.id || `name:${name}`] = name;
fs.writeFileSync(listPath, JSON.stringify(blocked, null, 2) + "\n");

console.log(`Removed "${name}": ${ids.length} videos, ${relFixed} related lists cleaned.`);
