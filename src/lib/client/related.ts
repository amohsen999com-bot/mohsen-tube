"use client";

import type { VideoItem } from "../types.ts";
import { AlgoEngine } from "./algo.ts";
import { ClientStore } from "./store.ts";

/** At most this many suggestions under a video may be "the same kind" (same channel or same topic). */
export const SIMILAR_MAX = 3;

const isSame = (base: VideoItem, x: VideoItem) =>
  x.c === base.c || (!!x.tp && x.tp === base.tp && x.tp !== "دروس عامة");

/**
 * Suggestions under a video: the next episode, then the closest matches until there are 3 of the same
 * kind, then the "مقترح لك" engine itself (rhythm, sheikhs, balance, exploration, variety) for the rest.
 */
export function composeRelated(
  video: VideoItem,
  serverRelated: VideoItem[],
  nextEpisode: VideoItem | null,
  feedPool: VideoItem[],
  total = 20
): VideoItem[] {
  const out: VideoItem[] = [];
  const used = new Set<string>([video.id]);
  let same = 0;
  const add = (x: VideoItem | null | undefined) => {
    if (!x || used.has(x.id) || !ClientStore.isAllowed(x)) return;
    if (isSame(video, x)) {
      if (same >= SIMILAR_MAX) return;
      same++;
    }
    used.add(x.id);
    out.push(x);
  };
  add(nextEpisode);
  for (const x of serverRelated) {
    if (out.length >= SIMILAR_MAX) break;
    add(x);
  }
  const pool = feedPool.filter((x) => !used.has(x.id) && !(same >= SIMILAR_MAX && isSame(video, x)));
  for (const x of AlgoEngine.buildFeedBatch(pool, total, new Set(used), [video.c])) {
    if (out.length >= total) break;
    add(x);
  }
  // Not enough catalog loaded yet: top up with the server list (still respecting the cap)
  for (const x of serverRelated) {
    if (out.length >= total) break;
    add(x);
  }
  return out;
}

let poolPromise: Promise<VideoItem[]> | null = null;
/** The candidate pool the feed engine picks from (loaded once per session). */
export function loadFeedPool(): Promise<VideoItem[]> {
  if (!poolPromise) {
    poolPromise = fetch("/api/videos?limit=1200")
      .then((r) => (r.ok ? r.json() : { videos: [] }))
      .then((d: { videos?: VideoItem[] }) => d.videos || [])
      .catch(() => {
        poolPromise = null;
        return [];
      });
  }
  return poolPromise;
}

/** The series the viewer opened (a video can belong to several playlists). */
export const SERIES_CTX_KEY = "nt_pl";
export function rememberSeries(id: number | null | undefined): void {
  if (id === null || id === undefined) return;
  try {
    window.sessionStorage.setItem(SERIES_CTX_KEY, String(id));
  } catch {}
}
export function activeSeries(): number | null {
  try {
    const v = window.sessionStorage.getItem(SERIES_CTX_KEY);
    return v !== null && /^\d+$/.test(v) ? Number(v) : null;
  } catch {
    return null;
  }
}
