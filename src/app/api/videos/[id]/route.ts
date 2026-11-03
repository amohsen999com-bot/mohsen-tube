import { NextRequest, NextResponse } from "next/server";
import { getVideoDetail } from "@/lib/db";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const detail = getVideoDetail(id);
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
