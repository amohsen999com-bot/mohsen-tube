/**
 * يشترك (أو يجدد الاشتراك) في إشعارات يوتيوب الفورية لكل قنوات الموقع.
 * يوتيوب بعد كده بيبعت لـ /api/websub أول ما أي قناة تنزّل فيديو. الاشتراك بيخلص بعد ~10 أيام،
 * فـ GitHub Actions بيشغّل الملف ده مرة في اليوم.
 *   node --experimental-strip-types scripts/websub-subscribe.ts
 * طلب واحد لكل قناة لـ Google's hub (مش ليوتيوب نفسه)، 5 في نفس الوقت.
 */
import { DatabaseSync } from "node:sqlite";

const HUB = "https://pubsubhubbub.appspot.com/subscribe";
const CALLBACK = process.env.MOHSEN_WEBSUB_CALLBACK || "https://mohsen-tube.vercel.app/api/websub";
const LEASE = 10 * 24 * 3600;

const db = new DatabaseSync("data/mohsen.db");
const ids = (db.prepare("SELECT id FROM channels WHERE id LIKE 'UC%'").all() as Array<{ id: string }>).map((r) => r.id);
db.close();

let ok = 0;
const failed: string[] = [];
async function subscribe(id: string) {
  const body = new URLSearchParams({
    "hub.callback": CALLBACK,
    "hub.topic": `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${id}`,
    "hub.mode": "subscribe",
    "hub.verify": "async",
    "hub.lease_seconds": String(LEASE),
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(HUB, { method: "POST", body, signal: AbortSignal.timeout(15000) });
      if (res.status === 202 || res.status === 204) return void ok++;
    } catch {}
  }
  failed.push(id);
}

const queue = [...ids];
await Promise.all(
  Array.from({ length: 5 }, async () => {
    for (let id = queue.shift(); id; id = queue.shift()) await subscribe(id);
  })
);
console.log(`اشتركنا في إشعارات ${ok} قناة من ${ids.length}.` + (failed.length ? ` ما نفعش: ${failed.length}` : ""));
