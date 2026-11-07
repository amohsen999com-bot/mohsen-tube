import { NextRequest, NextResponse } from "next/server";
import { getVideoDetail } from "@/lib/db";
import { loadLiveFresh } from "@/lib/live-fresh";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await loadLiveFresh();
    const { id } = await context.params;
    const plRaw = request.nextUrl.searchParams.get("pl");
    const pl = plRaw !== null && /^\d{1,6}$/.test(plRaw) ? Number(plRaw) : undefined;
    const detail = getVideoDetail(id, pl);
    if (!detail) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }
    return NextResponse.json(detail);
  } catch (err) {
    console.error("GET /api/videos/[id] error:", err);
    return NextResponse.json(
      { error: "Failed to load video detail" },
      { status: 500 }
    );
  }
}
