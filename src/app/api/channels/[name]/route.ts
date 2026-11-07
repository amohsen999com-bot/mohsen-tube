import { NextRequest, NextResponse } from "next/server";
import { getChannelPageData } from "@/lib/db";
import { loadLiveFresh } from "@/lib/live-fresh";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ name: string }> }
) {
  try {
    await loadLiveFresh();
    const { name } = await context.params;
    const decoded = decodeURIComponent(name);
    const data = getChannelPageData(decoded);
    if (!data) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }
    return NextResponse.json(data);
  } catch (err) {
    console.error("GET /api/channels/[name] error:", err);
    return NextResponse.json(
      { error: "Failed to load channel" },
      { status: 500 }
    );
  }
}
