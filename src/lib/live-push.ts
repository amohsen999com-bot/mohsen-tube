/**
 * الفيديوهات اللي يوتيوب بلّغنا بيها حالًا (إشعارات WebSub)، عشان تظهر على الموقع بعد دقايق من نزولها.
 *
 * يوتيوب بيبعت لـ /api/websub، واللي بيستقبل بيسجّل رقم الفيديو وقناته في Supabase (push_add).
 * هنا السيرفر بيقرا التنبيهات دي، ويتأكد من كل فيديو بنفسه من صفحة يوتيوب قبل ما يعرضه:
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
const VERIFY_PER_LOAD = 6;

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

/** What YouTube's own watch page says about a video (no API key needed). */
export function parseWatchPage(html: string) {
  const at = html.indexOf('"videoDetails":{');
  if (at < 0) return null;
  const d = html.slice(at, at + 6000);
  const get = (r: RegExp) => (d.match(r) || [])[1];
  let title = "";
  try {
    title = JSON.parse('"' + (get(/"title":"((?:[^"\\]|\\.)*)"/) || "") + '"');
  } catch {}
  const publish = (html.match(/"publishDate":"([^"]+)"/) || [])[1] || "";
  return {
    seconds: Number(get(/"lengthSeconds":"(\d+)"/) || 0),
    channelId: get(/"channelId":"(UC[\w-]{22})"/) || "",
    upcoming: /"isUpcoming":true/.test(d) || /"isLive":true/.test(d),
    views: Number(get(/"viewCount":"(\d+)"/) || 0),
    title,
    publish,
  };
}

const dayNum = (ms: number) => {
  const d = new Date(ms);
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
};

type Info = NonNullable<ReturnType<typeof parseWatchPage>>;

/** YouTube's own player data (same as the site's player asks for); works from servers more often than the page. */
async function fromPlayer(id: string): Promise<Info | null> {
  const res = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
    body: JSON.stringify({ context: { client: { clientName: "WEB", clientVersion: "2.20241101.00.00", hl: "ar", gl: "EG" } }, videoId: id }),
    cache: "no-store",
    signal: AbortSignal.timeout(3500),
  });
  if (!res.ok) return null;
  const j = (await res.json()) as {
    videoDetails?: { lengthSeconds?: string; channelId?: string; title?: string; isLive?: boolean; isUpcoming?: boolean; viewCount?: string };
    microformat?: { playerMicroformatRenderer?: { publishDate?: string } };
  };
  const v = j.videoDetails;
  if (!v?.channelId) return null;
  return {
    seconds: Number(v.lengthSeconds || 0),
    channelId: v.channelId,
    upcoming: !!(v.isLive || v.isUpcoming),
    views: Number(v.viewCount || 0),
    title: v.title || "",
    publish: j.microformat?.playerMicroformatRenderer?.publishDate || "",
  };
}

async function fromPage(id: string): Promise<Info | null> {
  const res = await fetch(`https://www.youtube.com/watch?v=${id}&hl=ar&gl=EG`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
      "Accept-Language": "ar,en;q=0.8",
      Cookie: "SOCS=CAI; CONSENT=YES+1",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(3500),
  });
  return res.ok ? parseWatchPage(await res.text()) : null;
}

/** Video facts from YouTube: player data first, the watch page if that fails. */
export async function videoFacts(id: string): Promise<(Info & { via: string }) | null> {
  for (const [via, get] of [["player", fromPlayer], ["page", fromPage]] as const) {
    try {
      const info = await get(id);
      if (info?.channelId) return { ...info, via };
    } catch {}
  }
  return null;
}

async function verify(h: Hint): Promise<void> {
  const ch = siteChannel(h.ch);
  if (!ch) return void verified.set(h.id, null);
  const info = await videoFacts(h.id);
  if (!info || !info.channelId) {
    // couldn't read it now; try again on a later request, then leave it to the regular sync
    const n = (tries.get(h.id) || 0) + 1;
    tries.set(h.id, n);
    if (n >= MAX_TRIES) verified.set(h.id, null);
    return;
  }
  const ok =
    info.channelId === h.ch && !info.upcoming && info.seconds >= MIN_SECONDS && titleAllowed(info.title, ch.grp);
  if (!ok) return void verified.set(h.id, null);
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

/** Refresh the alerts (at most every 20s) and check a few new ones. Never throws, waits a few seconds at most. */
export async function loadLivePush(): Promise<void> {
  if (!enabled() || Date.now() - loadedAt < TTL) return;
  inflight ||= (async () => {
    try {
      hints = await rpc<Hint[]>("push_recent", {}, 2000);
      const keep = new Set(hints.map((h) => h.id));
      for (const id of verified.keys()) if (!keep.has(id)) verified.delete(id);
      for (const id of tries.keys()) if (!keep.has(id)) tries.delete(id);
      const todo = hints.filter((h) => !verified.has(h.id)).slice(0, VERIFY_PER_LOAD);
      await Promise.all(todo.map((h) => verify(h).catch(() => {})));
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
