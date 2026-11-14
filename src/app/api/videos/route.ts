import { NextRequest, NextResponse } from "next/server";
import { allowRequest, clientIp } from "@/lib/rate-limit";
import { getAggregatedLabels } from "@/lib/shared-store";
import {
  getCatalogSummary,
  getFeedVideos,
  getRelatedGraph,
  getVideosByChannels,
  getVideosByIds,
} from "@/lib/db";
import { loadLiveFresh } from "@/lib/live-fresh";
import { cachedJson } from "@/lib/http-cache";

export async function GET(request: NextRequest) {
  try {
    await loadLiveFresh();
    const sp = request.nextUrl.searchParams;

    if (sp.get("summary") === "1") {
      const summary = getCatalogSummary();
      const labels = await getAggregatedLabels();
      return cachedJson({ ...summary, labels }, 600);
    }

    // "Watched together" graph for the viewer's recent history (client-side relatedScores)
    const relatedFor = sp.get("related_for");
    if (relatedFor !== null) {
      if (!allowRequest("related", clientIp(request), 30)) {
        return NextResponse.json({ error: "rate limited" }, { status: 429 });
      }
      return cachedJson({ graph: getRelatedGraph(relatedFor.split(",").map((s) => s.trim()).filter(Boolean)) }, 3600);
    }

    const idsParam = sp.get("ids");
    if (idsParam !== null) {
      const ids = idsParam
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const videos = getVideosByIds(ids);
      return cachedJson({ videos }, 600);
    }

    const channelsParam = sp.get("channels");
    if (channelsParam !== null) {
      const channelNames = channelsParam
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean);
      const limit = Math.min(Math.max(Number(sp.get("limit")) || 200, 1), 500);
      const videos = getVideosByChannels(channelNames, limit);
      return cachedJson({ videos }, 600);
    }

    const category = sp.get("category") === "fun" ? "fun" : "all";
    const topic = sp.get("topic") || undefined;
    const limit = Math.min(Math.max(Number(sp.get("limit")) || 300, 1), 2500);
    const interests = (sp.get("interests") || "").split("|").map((s) => s.trim()).filter(Boolean).slice(0, 10);
    const offset = Math.max(Number(sp.get("offset")) || 0, 0);

    const data = getFeedVideos({ category, topic, limit, offset, interests, seed: (sp.get("seed") || "").slice(0, 40), school: sp.get("school") === "1" });
    return cachedJson(data, 300);
  } catch (err) {
    console.error("GET /api/videos error:", err);
    return NextResponse.json(
      { error: "Failed to load videos" },
      { status: 500 }
    );
  }
}
