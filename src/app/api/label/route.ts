import { NextRequest, NextResponse } from "next/server";
import { getAggregatedLabels, saveViewerLabel, voterId } from "@/lib/db";
import { allowRequest, clientIp } from "@/lib/rate-limit";

export async function GET() {
  return NextResponse.json(getAggregatedLabels());
}

export async function POST(request: NextRequest) {
  const ip = clientIp(request);
  if (!allowRequest("label", ip, 30)) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }

  try {
    const body = (await request.json()) as {
      vid?: string;
      q?: string;
      a?: string[];
    };
    // Only allowlisted answers are stored, the channel comes from the catalog, and each voter
    // (hashed IP) counts once per video/channel question.
    const ok = saveViewerLabel({
      vid: String(body.vid || ""),
      q: String(body.q || ""),
      a: Array.isArray(body.a) ? body.a.map(String) : [],
      voter: voterId(ip),
    });
    return NextResponse.json({ ok }, { status: ok ? 200 : 400 });
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
