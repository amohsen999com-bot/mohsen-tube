import { NextRequest, NextResponse } from "next/server";
import { getRoom, upsertRoom } from "@/lib/db";

const rateWindow = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string, maxPerMin = 120): boolean {
  const now = Date.now();
  const entry = rateWindow.get(ip);
  if (!entry || now > entry.resetAt) {
    rateWindow.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= maxPerMin) return false;
  entry.count++;
  return true;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code") || "";
  const room = getRoom(code);
  if (!room) {
    return NextResponse.json({ error: "no room" }, { status: 404 });
  }
  return NextResponse.json(room);
}

export async function POST(request: NextRequest) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!checkRateLimit(ip, 120)) {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }

  try {
    const body = (await request.json()) as {
      code?: string;
      vid?: string;
      t?: number;
      playing?: boolean;
      by?: string;
    };
    const room = upsertRoom({
      code: String(body.code || ""),
      vid: String(body.vid || ""),
      t: Number(body.t || 0),
      playing: Boolean(body.playing),
      by: String(body.by || ""),
    });
    if (!room) {
      return NextResponse.json({ error: "bad" }, { status: 400 });
    }
    return NextResponse.json(room);
  } catch {
    return NextResponse.json({ error: "bad" }, { status: 400 });
  }
}
