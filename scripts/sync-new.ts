/**
 * يسحب الفيديوهات اللي لسه نازلة على يوتيوب من قنوات الموقع، ويضيفها لـ data/fresh.jsonl.
 * البناء على Vercel بيدخّل الملف ده في قاعدة البيانات (scripts/import-channels.ts)، فكل فيديو جديد
 * بيظهر على الموقع بعد النشر التلقائي بدقايق.
 *
 * بيشتغل كل ساعة من GitHub Actions (.github/workflows/new-videos.yml) بمفتاح YouTube Data API الرسمي
 * (YOUTUBE_API_KEY). الحصة المجانية 10,000 وحدة في اليوم، وإحنا بنستعمل حوالي النص:
 * - القنوات النشيطة (نزّلت حاجة آخر 60 يوم) بتتفحص كل ساعة.
 * - باقي القنوات بتتفحص بالدور، كل قناة مرة كل 4 ساعات.
 * فحص القناة = وحدة واحدة، وتفاصيل كل 50 فيديو جديد = وحدة واحدة.
 *
 * نفس قواعد الموقع: من غير Shorts ولا بث مباشر، دقيقتين على الأقل، وعناوين الأغاني والأفلام بتتشال.
 * الاستخدام: YOUTUBE_API_KEY=... node --experimental-strip-types scripts/sync-new.ts
 */
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const KEY = process.env.YOUTUBE_API_KEY || "";
const FRESH = "data/fresh.jsonl";
const MAX_AGE_DAYS = 14;
const MIN_SECONDS = 120;
const ROTATE = 4;

// نفس rules.py
const RELIGIOUS = new Set(["علماء", "أنا السلفي"]);
const BAD_TITLE = /أغنية|اغنية|اغاني|أغاني|موسيقى|موسيقي|مهرجان|كليب|ريمكس|remix|music|song|#shorts|#short|بنات|البنات|للنساء|نسائية/i;
const MEDIA = new RegExp(
  "فيلم|أفلام|افلام|الأفلام|الافلام|مسلسل|مسلسلات|سينما|السينما|سينمائي|نتفليكس|نتفلكس|هوليوود|هوليود|بوليوود|" +
    "أنمي|انمي|الأنمي|ممثل|ممثلة|الممثلين|تريلر|دراما|ديزني|مارفل|" +
    "\\bmovies?\\b|(?<!thin )\\bfilms?\\b|\\bcinema\\b|netflix|hollywood|bollywood|\\banime\\b|\\bactor|\\bactress|" +
    "trailer|disney|marvel|tv series|tv shows?|\\bdrama\\b|box office|\\boscars?\\b",
  "i"
);

export function titleAllowed(title: string, group: string): boolean {
  return !!title && !BAD_TITLE.test(title) && (RELIGIOUS.has(group) || !MEDIA.test(title));
}

/** ISO 8601 duration (PT1H2M3S) to seconds. */
export function isoSeconds(iso: string): number {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || "");
  if (!m) return 0;
  return (+(m[1] || 0)) * 86400 + (+(m[2] || 0)) * 3600 + (+(m[3] || 0)) * 60 + (+(m[4] || 0));
}

const dayNum = (ms: number) => {
  const d = new Date(ms);
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
};

class QuotaError extends Error {}

async function api(path: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams({ ...params, key: KEY });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/${path}?${qs}`);
  if (res.status === 403) {
    const body = await res.text();
    if (/quota/i.test(body)) throw new QuotaError("quota");
    throw new Error(`403 ${body.slice(0, 200)}`);
  }
  if (res.status === 404) return { items: [] };
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

type Channel = { name: string; id: string; grp: string; field: string | null };

async function main() {
  if (!KEY) {
    console.log("مفيش YOUTUBE_API_KEY، مفيش سحب.");
    return;
  }
  const db = new DatabaseSync("data/mohsen.db", { readOnly: true });
  const now = Date.now();
  const since = dayNum(now - 60 * 86400_000);
  const cutoff = now - MAX_AGE_DAYS * 86400_000;

  const freshRows = fs.existsSync(FRESH)
    ? fs.readFileSync(FRESH, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];
  const freshIds = new Set<string>(freshRows.map((r) => r.id));
  const freshChannels = new Set<string>(freshRows.map((r) => r.channel));
  const blocked = new Set(Object.keys(JSON.parse(fs.readFileSync("data/blocked_channels.json", "utf8"))));

  const channels = (db.prepare(`SELECT name, id, grp, field FROM channels ORDER BY name`).all() as Channel[])
    .filter((c) => /^UC[\w-]{22}$/.test(c.id) && !blocked.has(c.id));
  const active = new Set(
    (db.prepare(`SELECT DISTINCT c FROM videos WHERE is_curated = 1 AND dt >= ?`).all(since) as Array<{ c: string }>).map((r) => r.c)
  );
  const turn = Math.floor(now / 3600_000) % ROTATE;
  const due = channels.filter((c, i) => active.has(c.name) || freshChannels.has(c.name) || i % ROTATE === turn);

  const topicOf = db.prepare(`SELECT tp FROM videos WHERE c = ? AND is_curated = 1 GROUP BY tp ORDER BY COUNT(*) DESC LIMIT 1`);
  const known = db.prepare(`SELECT 1 FROM videos WHERE id = ?`);

  // 1) آخر 10 فيديوهات من قايمة الرفع لكل قناة عليها الدور (3 طلبات في نفس الوقت)
  const found: Array<{ id: string; ch: Channel }> = [];
  let units = 0;
  let i = 0;
  let stop = false;
  const worker = async () => {
    while (!stop && i < due.length) {
      const ch = due[i++];
      try {
        const data = await api("playlistItems", {
          part: "contentDetails",
          playlistId: "UU" + ch.id.slice(2),
          maxResults: "10",
        });
        units++;
        for (const it of data.items || []) {
          const id = it.contentDetails?.videoId;
          const at = Date.parse(it.contentDetails?.videoPublishedAt || "");
          if (!id || !(at >= cutoff) || freshIds.has(id) || known.get(id)) continue;
          found.push({ id, ch });
        }
      } catch (e) {
        if (e instanceof QuotaError) stop = true;
        else console.log(`تخطي ${ch.name}: ${(e as Error).message}`);
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);

  // 2) التفاصيل (المدة، العنوان، المشاهدات) لكل 50 فيديو مرة واحدة
  const added: string[] = [];
  const out: string[] = [];
  for (let k = 0; k < found.length && !stop; k += 50) {
    const batch = found.slice(k, k + 50);
    let data: any;
    try {
      data = await api("videos", { part: "snippet,contentDetails,statistics", id: batch.map((b) => b.id).join(",") });
      units++;
    } catch (e) {
      if (e instanceof QuotaError) break;
      throw e;
    }
    const byId = new Map(batch.map((b) => [b.id, b.ch]));
    for (const v of data.items || []) {
      const ch = byId.get(v.id)!;
      const title = String(v.snippet?.title || "").trim();
      const duration = isoSeconds(v.contentDetails?.duration);
      if (v.snippet?.liveBroadcastContent && v.snippet.liveBroadcastContent !== "none") continue;
      if (duration < MIN_SECONDS || !titleAllowed(title, ch.grp)) continue;
      const field = ch.field || (topicOf.get(ch.name) as { tp: string } | undefined)?.tp || "دروس عامة";
      out.push(
        JSON.stringify({
          id: v.id,
          title,
          duration,
          views: Number(v.statistics?.viewCount || 0),
          channel: ch.name,
          channel_id: ch.id,
          group: ch.grp,
          field,
          dt: dayNum(Date.parse(v.snippet.publishedAt)),
        })
      );
      added.push(`${ch.name}: ${title}`);
    }
  }

  if (out.length) fs.appendFileSync(FRESH, out.join("\n") + "\n");
  console.log(`فحصنا ${due.length} قناة (${units} وحدة من الحصة)، ولقينا ${found.length} جديد، دخل منهم ${out.length}.`);
  for (const a of added) console.log("  + " + a);
  if (stop) console.log("الحصة اليومية خلصت، الباقي في الدورة الجاية.");
}

if (process.argv[1]?.endsWith("sync-new.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
