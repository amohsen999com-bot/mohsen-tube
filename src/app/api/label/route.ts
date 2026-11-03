import { NextRequest, NextResponse } from "next/server";
import { getAggregatedLabels, saveViewerLabel } from "@/lib/db";

const labelRate = new Map<string, { count: number; resetAt: number }>();

export async function GET() {
  return NextResponse.json(getAggregatedLabels());
}

export async function POST(request: NextRequest) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const now = Date.now();
  const entry = labelRate.get(ip);
  if (!entry || now > entry.resetAt) {
    labelRate.set(ip, { count: 1, resetAt: now + 60_000 });
  } else if (entry.count >= 30) {
    return NextResponse.json({ ok: false }, { status: 429 });
  } else {
    entry.count++;
  }

  try {
    const body = (await request.json()) as {
      vid?: string;
      ch?: string;
      q?: string;
      a?: string[];
    };
    const ok = saveViewerLabel({
      vid: String(body.vid || ""),
      ch: String(body.ch || ""),
      q: String(body.q || ""),
      a: Array.isArray(body.a) ? body.a.map(String) : [],
    });
    return NextResponse.json({ ok }, { status: ok ? 200 : 400 });
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
