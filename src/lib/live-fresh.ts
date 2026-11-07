/**
 * الفيديوهات اللي لسه نازلة على يوتيوب، من غير ما نستنى نشر جديد للموقع.
 *
 * السحب اللي بيشتغل كل 10 دقايق (scripts/sync-new.ts) بيضيفها لـ data/fresh.jsonl على GitHub.
 * السيرفر بيقرا الملف ده من GitHub كل دقيقة على الأكتر، ويعرضه جنب قاعدة البيانات: في "مقترح لك"،
 * وصفحة القناة، وصفحة الفيديو. ومرة في اليوم بيحصل نشر كامل بيدخّلها في قاعدة البيانات نفسها (والبحث).
 *
 * شغال على Vercel بس (أو MOHSEN_LIVE_FRESH=on)، عشان الاختبارات ما تحتاجش إنترنت.
 */
import type { VideoItem } from "./types.ts";
import { estimateVideoLevel } from "./arabic.ts";

const source = () =>
  process.env.MOHSEN_FRESH_URL ||
  "https://raw.githubusercontent.com/amohsen999com-bot/mohsen-tube/main/data/fresh.jsonl";
const TTL = 60_000;

const enabled = () => process.env.MOHSEN_LIVE_FRESH === "on" || (!!process.env.VERCEL && process.env.MOHSEN_LIVE_FRESH !== "off");

let list: VideoItem[] = [];
let byId = new Map<string, VideoItem>();
let loadedAt = 0;
let inflight: Promise<void> | null = null;

type Row = { id: string; title: string; duration: number; views?: number; channel: string; group: string; field: string; dt?: number };

export function parseFresh(text: string): VideoItem[] {
  const out: VideoItem[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as Row;
      if (!/^[A-Za-z0-9_-]{6,16}$/.test(r.id) || !r.title || !r.channel) continue;
      out.push({
        id: r.id,
        t: r.title,
        c: r.channel,
        d: Math.round(r.duration || 0),
        tp: r.field,
        g: r.group,
        r: Math.round(Math.min(1, Math.log10((r.views || 0) + 1) / 7) * 1000) / 1000,
        lv: estimateVideoLevel(r.title, r.field, r.group, r.duration || 0, undefined),
        dt: r.dt,
      });
    } catch {}
  }
  return out.sort((a, b) => (b.dt || 0) - (a.dt || 0));
}

/** Refresh from GitHub if the copy is older than a minute (waits at most ~2.5s, never throws). */
export async function loadLiveFresh(): Promise<void> {
  if (!enabled() || Date.now() - loadedAt < TTL) return;
  inflight ||= (async () => {
    try {
      const res = await fetch(source(), { cache: "no-store", signal: AbortSignal.timeout(2500) });
      if (res.ok) {
        list = parseFresh(await res.text());
        byId = new Map(list.map((v) => [v.id, v]));
      }
    } catch {}
    loadedAt = Date.now();
  })().finally(() => (inflight = null));
  await inflight;
}

export const liveFresh = (): VideoItem[] => list;
export const liveFreshById = (id: string): VideoItem | undefined => byId.get(id);
