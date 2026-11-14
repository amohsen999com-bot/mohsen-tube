import { NextRequest, NextResponse } from "next/server";
import { searchSuggestions, searchVideos } from "@/lib/db";
import { cachedJson } from "@/lib/http-cache";

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const q = (sp.get("q") || "").trim().slice(0, 120);
    if (!q) {
      return NextResponse.json({ results: [] });
    }

    // Autocomplete: short completions (YouTube-style), not video titles
    if (sp.get("complete") === "1") {
      return cachedJson({ suggestions: searchSuggestions(sp.get("q") || "") }, 86400);
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

    return cachedJson({ results }, 3600);
  } catch (err) {
    console.error("GET /api/search error:", err);
    return NextResponse.json(
      { error: "Search failed", results: [] },
      { status: 500 }
    );
  }
}
