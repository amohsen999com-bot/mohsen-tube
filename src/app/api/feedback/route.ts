import { NextRequest, NextResponse } from "next/server";
import { voterId } from "@/lib/db";
import { saveFeedback } from "@/lib/shared-store";
import { allowRequest, clientIp } from "@/lib/rate-limit";

/** "مبسوط باللي بيظهرلك؟": what the viewer picked and wrote, kept for the site owner (Supabase → feedback). */
export async function POST(request: NextRequest) {
  const ip = clientIp(request);
  if (!allowRequest("feedback", ip, 3)) return NextResponse.json({ ok: false }, { status: 429 });
  try {
    const body = (await request.json()) as { page?: string; picks?: unknown; text?: string };
    const ok = await saveFeedback({
      page: String(body.page || ""),
      picks: Array.isArray(body.picks) ? body.picks.map(String) : [],
      body: String(body.text || ""),
      voter: voterId(ip),
    });
    return NextResponse.json({ ok }, { status: ok ? 200 : 400 });
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
