import { NextRequest, NextResponse } from "next/server";
import { createRoom, getRoom, joinRoom, updateRoom } from "@/lib/db";
import { allowRequest, clientIp } from "@/lib/rate-limit";

// Polling every 1.5s ≈ 40/min per viewer; leave headroom for a couple of tabs.
const GET_PER_MIN = 120;
const POST_PER_MIN = 90;
const CREATE_JOIN_PER_MIN = 10;

export async function GET(request: NextRequest) {
  if (!allowRequest("room-get", clientIp(request), GET_PER_MIN)) {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }
  const code = request.nextUrl.searchParams.get("code") || "";
  const room = getRoom(code);
  if (!room) {
    return NextResponse.json({ error: "no room" }, { status: 404 });
  }
  return NextResponse.json(room);
}

/**
 * POST { action: "create", vid, t, playing, by }      → { room, token }
 * POST { action: "join", code }                       → { room, token }
 * POST { action: "update", code, token, vid, t, playing, by } → room   (token required)
 */
export async function POST(request: NextRequest) {
  const ip = clientIp(request);
  if (!allowRequest("room-post", ip, POST_PER_MIN)) {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }

  let body: {
    action?: string;
    code?: string;
    token?: string;
    vid?: string;
    t?: number;
    playing?: boolean;
    by?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad" }, { status: 400 });
  }

  if (body.action === "create" || body.action === "join") {
    if (!allowRequest("room-create-join", ip, CREATE_JOIN_PER_MIN)) {
      return NextResponse.json({ error: "rate limited" }, { status: 429 });
    }
    const res =
      body.action === "create"
        ? createRoom({
            vid: String(body.vid || ""),
            t: Number(body.t || 0),
            playing: Boolean(body.playing),
            by: String(body.by || ""),
          })
        : joinRoom(String(body.code || ""));
    if (!res) {
      return NextResponse.json({ error: body.action === "join" ? "no room" : "bad" }, { status: body.action === "join" ? 404 : 400 });
    }
    return NextResponse.json(res);
  }

  const room = updateRoom({
    code: String(body.code || ""),
    token: String(body.token || ""),
    vid: String(body.vid || ""),
    t: Number(body.t || 0),
    playing: Boolean(body.playing),
    by: String(body.by || ""),
  });
  if (!room) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return NextResponse.json(room);
}
