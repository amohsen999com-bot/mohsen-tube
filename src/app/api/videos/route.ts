import { NextRequest, NextResponse } from "next/server";
import {
  getAggregatedLabels,
  getCatalogSummary,
  getFeedVideos,
  getVideosByChannels,
  getVideosByIds,
} from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;

    if (sp.get("summary") === "1") {
      const summary = getCatalogSummary();
      const labels = getAggregatedLabels();
      return NextResponse.json({ ...summary, labels });
    }

    const idsParam = sp.get("ids");
    if (idsParam !== null) {
      const ids = idsParam
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const videos = getVideosByIds(ids);
      return NextResponse.json({ videos });
    }

    const channelsParam = sp.get("channels");
    if (channelsParam !== null) {
      const channelNames = channelsParam
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean);
      const limit = Math.min(Math.max(Number(sp.get("limit")) || 200, 1), 500);
      const videos = getVideosByChannels(channelNames, limit);
      return NextResponse.json({ videos });
    }

    const category = sp.get("category") === "fun" ? "fun" : "all";
    const topic = sp.get("topic") || undefined;
    const limit = Math.min(Math.max(Number(sp.get("limit")) || 300, 1), 1500);
    const offset = Math.max(Number(sp.get("offset")) || 0, 0);

    const data = getFeedVideos({ category, topic, limit, offset });
    return NextResponse.json(data);
  } catch (err) {
    console.error("GET /api/videos error:", err);
    return NextResponse.json(
      { error: "Failed to load videos" },
      { status: 500 }
    );
  }
}
