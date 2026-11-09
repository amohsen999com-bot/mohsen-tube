/**
 * الفيديوهات اللي يوتيوب بلّغنا بيها حالًا (إشعارات WebSub)، عشان تظهر على الموقع بعد دقايق من نزولها.
 *
 * يوتيوب بيبعت لـ /api/websub، واللي بيستقبل بيسجّل رقم الفيديو وقناته في Supabase (push_add).
 * هنا السيرفر بيقرا التنبيهات دي، ويتأكد من كل فيديو بنفسه من YouTube Data API الرسمي قبل ما يعرضه:
 * القناة لازم تكون من قنوات الموقع (ومش ممنوعة)، دقيقتين على الأقل (من غير Shorts)، مش بث جاي،
 * والعنوان عدّى قواعد الموقع. أي تنبيه مزيف أو فيديو ما عدّاش القواعد مش بيظهر.
 * بعد كده السحب الدوري والنشر اليومي بيدخّلوا نفس الفيديوهات في القاعدة عادي.
 */
import type { VideoItem } from "./types.ts";
import { estimateVideoLevel } from "./arabic.ts";
import { MIN_SECONDS, titleAllowed } from "./video-rules.ts";
import { getDb } from "./db.ts";

const SB_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
const enabled = () =>
  !!(SB_URL && SB_KEY) &&
  (process.env.MOHSEN_LIVE_FRESH === "on" || (!!process.env.VERCEL && process.env.MOHSEN_LIVE_FRESH !== "off"));

const TTL = 20_000;
const MAX_TRIES = 3;

type Hint = { id: string; ch: string; at: number };
let hints: Hint[] = [];
let loadedAt = 0;
let inflight: Promise<void> | null = null;
const verified = new Map<string, VideoItem | null>(); // null = checked and rejected
const tries = new Map<string, number>();

async function rpc<T>(fn: string, args: Record<string, unknown>, ms: number): Promise<T> {
  const res = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
    cache: "no-store",
    signal: AbortSignal.timeout(ms),
  });
  if (!res.ok) throw new Error(`supabase ${fn} ${res.status}`);
  return (await res.json()) as T;
}

/** A site channel by its YouTube id (blocked channels are deleted from the table, so they don't match). */
export function siteChannel(chId: string): { name: string; grp: string; field: string } | undefined {
  if (!/^UC[A-Za-z0-9_-]{22}$/.test(chId)) return undefined;
  return getDb().prepare("SELECT name, grp, field FROM channels WHERE id = ?").get(chId) as
    | { name: string; grp: string; field: string }
    | undefined;
}

/** Called by /api/websub for each new upload YouTube tells us about. */
export async function recordPush(id: string, chId: string): Promise<boolean> {
  if (!enabled() || !/^[A-Za-z0-9_-]{11}$/.test(id) || !siteChannel(chId)) return false;
  try {
    await rpc("push_add", { p_id: id, p_ch: chId }, 4000);
    loadedAt = 0; // pick it up on the next request
    return true;
  } catch {
    return false;
  }
}

const dayNum = (ms: number) => {
  const d = new Date(ms);
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
};

type Info = { seconds: number; channelId: string; upcoming: boolean; views: number; title: string; publish: string };

/** ISO 8601 duration (PT1H2M3S) to seconds. */
function isoSeconds(iso: string): number {
  const m = /^P(?:(d+)D)?T?(?:(d+)H)?(?:(d+)M)?(?:(d+)S)?$/.exec(iso || "");
  return m ? +(m[1] || 0) * 86400 + +(m[2] || 0) * 3600 + +(m[3] || 0) * 60 + +(m[4] || 0) : 0;
}

/**
 * Video facts from the official YouTube Data API: one videos.list call (1 quota unit) for up to 50 videos.
 * Needs YOUTUBE_API_KEY in the server settings; without it the alerts wait for the regular sync instead.
 * Returns null when the call itself failed (try again later).
 */
export async function videoFacts(ids: string[]): Promise<Map<string, Info> | null> {
  const key = process.env.YOUTUBE_API_KEY || "";
  if (!key || !ids.length) return null;
  const qs = new URLSearchParams({ part: "snippet,contentDetails,statistics", id: ids.slice(0, 50).join(","), key });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?${qs}`, { cache: "no-store", signal: AbortSignal.timeout(3500) });
  if (!res.ok) return null;
  const j = (await res.json()) as {
    items?: Array<{
      id?: string;
      snippet?: { channelId?: string; title?: string; publishedAt?: string; liveBroadcastContent?: string };
      contentDetails?: { duration?: string };
      statistics?: { viewCount?: string };
    }>;
  };
  const out = new Map<string, Info>();
  for (const v of j.items || []) {
    if (!v.id || !v.snippet?.channelId) continue;
    out.set(v.id, {
      seconds: isoSeconds(v.contentDetails?.duration || ""),
      channelId: v.snippet.channelId,
      upcoming: !!v.snippet.liveBroadcastContent && v.snippet.liveBroadcastContent !== "none",
      views: Number(v.statistics?.viewCount || 0),
      title: v.snippet.title || "",
      publish: v.snippet.publishedAt || "",
    });
  }
  return out;
}

function judge(h: Hint, info: Info | undefined): void {
  const ch = siteChannel(h.ch);
  const ok =
    !!ch && !!info && info.channelId === h.ch && !info.upcoming && info.seconds >= MIN_SECONDS && titleAllowed(info.title, ch.grp);
  if (!ok || !ch || !info) return void verified.set(h.id, null);
  const published = Date.parse(info.publish);
  verified.set(h.id, {
    id: h.id,
    t: info.title,
    c: ch.name,
    d: info.seconds,
    tp: ch.field,
    g: ch.grp,
    r: Math.round(Math.min(1, Math.log10(info.views + 1) / 7) * 1000) / 1000,
    lv: estimateVideoLevel(info.title, ch.field, ch.grp, info.seconds, undefined),
    dt: dayNum(Number.isFinite(published) ? published : h.at * 1000),
  });
}

/** Refresh the alerts (at most every 20s) and check the new ones in one API call. Never throws, waits a few seconds at most. */
export async function loadLivePush(): Promise<void> {
  if (!enabled() || Date.now() - loadedAt < TTL) return;
  inflight ||= (async () => {
    try {
      hints = await rpc<Hint[]>("push_recent", {}, 2000);
      const keep = new Set(hints.map((h) => h.id));
      for (const id of verified.keys()) if (!keep.has(id)) verified.delete(id);
      for (const id of tries.keys()) if (!keep.has(id)) tries.delete(id);
      const todo: Hint[] = [];
      for (const h of hints) {
        if (verified.has(h.id)) continue;
        if (!siteChannel(h.ch)) verified.set(h.id, null); // not ours (or blocked): never shown, no API call
        else if (todo.length < 50) todo.push(h);
      }
      if (todo.length && process.env.YOUTUBE_API_KEY) {
        const facts = await videoFacts(todo.map((h) => h.id)).catch(() => null);
        for (const h of todo) {
          if (facts) judge(h, facts.get(h.id));
          else {
            // the call failed; try again on a later request, then leave it to the regular sync
            const n = (tries.get(h.id) || 0) + 1;
            tries.set(h.id, n);
            if (n >= MAX_TRIES) verified.set(h.id, null);
          }
        }
      }
    } catch {}
    loadedAt = Date.now();
  })().finally(() => (inflight = null));
  await inflight;
}

/** Checked videos, newest alert first. */
export function livePushed(): VideoItem[] {
  const out: VideoItem[] = [];
  for (const h of hints) {
    const v = verified.get(h.id);
    if (v) out.push(v);
  }
  return out;
}
