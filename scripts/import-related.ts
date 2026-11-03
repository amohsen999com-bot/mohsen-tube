// Loads the "watched together" graph (site/related.json from the old stack: { videoId: [relatedIds...] })
// into the `related` table, keeping only videos that exist in the catalog.
// Usage: node --experimental-strip-types scripts/import-related.ts <path/to/related.json>
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const src = process.argv[2] || process.env.MOHSEN_RELATED_PATH;
if (!src || !fs.existsSync(src)) {
  console.error("Pass the path to related.json");
  process.exit(1);
}
const dbPath = process.env.MOHSEN_DB_PATH || path.join(process.cwd(), "data", "mohsen.db");
const db = new DatabaseSync(dbPath);
db.exec(`CREATE TABLE IF NOT EXISTS related (vid TEXT PRIMARY KEY, ids_json TEXT NOT NULL);`);

const graph = JSON.parse(fs.readFileSync(src, "utf8")) as Record<string, unknown>;
const known = new Set(
  (db.prepare(`SELECT id FROM videos`).all() as Array<{ id: string }>).map((r) => r.id)
);
const insert = db.prepare(`INSERT OR REPLACE INTO related (vid, ids_json) VALUES (?, ?)`);
let n = 0;
db.exec("BEGIN");
for (const [vid, list] of Object.entries(graph)) {
  if (!known.has(vid) || !Array.isArray(list)) continue;
  const ids = list.filter((x): x is string => typeof x === "string" && known.has(x)).slice(0, 12);
  if (!ids.length) continue;
  insert.run(vid, JSON.stringify(ids));
  n++;
}
db.exec("COMMIT");
db.close();
console.log(`Imported related lists for ${n} videos.`);
