import { NextResponse } from "next/server";

/**
 * Lets the CDN keep a response that's the same for everyone who asks the same URL, so repeat visits are
 * served without running the server (that's what used up the free CPU quota). The browser revalidates;
 * the CDN keeps it for `seconds` and may serve it a while longer while it fetches a fresh copy.
 */
export function cachedJson(body: unknown, seconds: number, init?: { status?: number }): NextResponse {
  const res = NextResponse.json(body, init);
  res.headers.set(
    "Cache-Control",
    `public, max-age=0, s-maxage=${seconds}, stale-while-revalidate=${Math.max(seconds, 86400)}`
  );
  return res;
}
