import { NextRequest, NextResponse } from "next/server";
import { allowRequest, clientIp } from "@/lib/rate-limit";
import {
  getAggregatedLabels,
  getCatalogSummary,
  getFeedVideos,
  getRelatedGraph,
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

    // "Watched together" graph for the viewer's recent history (client-side relatedScores)
    const relatedFor = sp.get("related_for");
    if (relatedFor !== null) {
      if (!allowRequest("related", clientIp(request), 30)) {
        return NextResponse.json({ error: "rate limited" }, { status: 429 });
      }
      return NextResponse.json({ graph: getRelatedGraph(relatedFor.split(",").map((s) => s.trim()).filter(Boolean)) });
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
