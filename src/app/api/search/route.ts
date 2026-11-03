import { NextRequest, NextResponse } from "next/server";
import { searchVideos } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const q = (sp.get("q") || "").trim().slice(0, 120);
    if (!q) {
      return NextResponse.json({ results: [] });
    }

    const durParam = sp.get("dur") || "";
    const duration =
      durParam === "short" || durParam === "mid" || durParam === "long"
        ? durParam
        : "";
    const channel = sp.get("c") || undefined;
    const sortParam = sp.get("sort") || "rel";
    const sort =
      sortParam === "new" || sortParam === "short" ? sortParam : "rel";
    const suggestOnly = sp.get("suggest") === "1";
    const limit = Math.min(Math.max(Number(sp.get("limit")) || 80, 1), 160);

    const results = searchVideos(q, {
      limit,
      duration,
      channel,
      sort,
      suggestOnly,
    });

    return NextResponse.json({ results });
  } catch (err) {
    console.error("GET /api/search error:", err);
    return NextResponse.json(
      { error: "Search failed", results: [] },
      { status: 500 }
    );
  }
}
