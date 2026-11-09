/**
 * عنوان إشعارات يوتيوب الفورية (WebSub / PubSubHubbub).
 * GET: يوتيوب بيتأكد إننا فعلًا طالبين نتابع القناة (بيرجّع hub.challenge) — بس لقنوات الموقع.
 * POST: يوتيوب بيبلّغ بفيديو جديد (Atom XML) → بنسجّل رقمه وقناته، والسيرفر بيتأكد منه قبل ما يعرضه.
 * الاشتراكات بتتجدد كل يوم من GitHub Actions (scripts/websub-subscribe.ts).
 */
import { recordPush, siteChannel, videoFacts } from "../../../lib/live-push.ts";

export const dynamic = "force-dynamic";

const TOPIC = /^https:\/\/www\.youtube\.com\/xml\/feeds\/videos\.xml\?channel_id=(UC[A-Za-z0-9_-]{22})$/;

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  // TEMP probe (remove after checking): can this server read YouTube's video facts?
  const probe = p.get("probe") || "";
  if (/^[A-Za-z0-9_-]{11}$/.test(probe)) {
    const f = await videoFacts(probe);
    return Response.json(f ? { via: f.via, seconds: f.seconds, channelId: f.channelId } : { via: null });
  }
  const mode = p.get("hub.mode");
  const challenge = p.get("hub.challenge") || "";
  const ch = (p.get("hub.topic") || "").match(TOPIC)?.[1];
  const ok = !!ch && !!challenge && (mode === "unsubscribe" || (mode === "subscribe" && !!siteChannel(ch)));
  if (!ok) return new Response("not ours", { status: 404 });
  return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
}

export async function POST(req: Request) {
  const xml = (await req.text()).slice(0, 200_000);
  const entries = xml.split("<entry>").slice(1, 11);
  await Promise.all(
    entries.map((e) => {
      const id = e.match(/<yt:videoId>([A-Za-z0-9_-]{11})<\/yt:videoId>/)?.[1];
      const ch = e.match(/<yt:channelId>(UC[A-Za-z0-9_-]{22})<\/yt:channelId>/)?.[1];
      return id && ch ? recordPush(id, ch) : Promise.resolve(false);
    })
  );
  // Always 204 so the hub doesn't keep retrying deletions or channels we don't carry
  return new Response(null, { status: 204 });
}
