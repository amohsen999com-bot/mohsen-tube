import type { NextRequest } from "next/server";

/** Fixed-window, in-memory rate limiter keyed by bucket + client IP. */
const windows = new Map<string, { count: number; resetAt: number }>();

export function clientIp(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
}

export function allowRequest(bucket: string, ip: string, maxPerMin: number): boolean {
  const now = Date.now();
  const key = bucket + "|" + ip;
  const entry = windows.get(key);
  if (!entry || now > entry.resetAt) {
    if (windows.size > 10_000) {
      for (const [k, v] of windows) if (now > v.resetAt) windows.delete(k);
    }
    windows.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= maxPerMin) return false;
  entry.count++;
  return true;
}
