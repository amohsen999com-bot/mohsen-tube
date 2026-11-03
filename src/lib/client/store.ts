"use client";

import type { VideoItem } from "../types.ts";

export interface SavedClip {
  id: string;
  vid: string;
  t: string;
  c: string;
  s: number;
  e: number;
  name: string;
  at: number;
}

export interface WirdState {
  goal: number;
  days: Record<string, number>;
}

const listeners = new Set<() => void>();

export function subscribeStore(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notifyStore(): void {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {}
  });
}

export function readLocal<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return (JSON.parse(raw) as T) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeLocal<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    notifyStore();
  } catch {}
}

export const ClientStore = {
  getList(name: "history" | "later" | "liked"): string[] {
    return readLocal<string[]>(`nt_${name}`, []);
  },

  hasInList(name: "history" | "later" | "liked", id: string): boolean {
    return this.getList(name).includes(id);
  },

  toggleList(name: "later" | "liked", id: string): boolean {
    const list = [...this.getList(name)];
    const idx = list.indexOf(id);
    if (idx >= 0) {
      list.splice(idx, 1);
      writeLocal(`nt_${name}`, list);
      return false;
    } else {
      list.unshift(id);
      writeLocal(`nt_${name}`, list);
      return true;
    }
  },

  pushHistory(id: string): void {
    const next = [id, ...this.getList("history").filter((x) => x !== id)].slice(
      0,
      500
    );
    writeLocal("nt_history", next);
  },

  removeFromList(name: "history" | "later" | "liked", id: string): void {
    writeLocal(
      `nt_${name}`,
      this.getList(name).filter((x) => x !== id)
    );
  },

  clearHistory(): void {
    writeLocal("nt_history", []);
  },

  // Progress: { [videoId]: [seconds, fraction0to1, savedAtMs] } (the timestamp lets two devices merge per video)
  getAllProgress(): Record<string, [number, number]> {
    return readLocal<Record<string, [number, number]>>("nt_progress", {});
  },

  getProgress(id: string): [number, number] | undefined {
    return this.getAllProgress()[id];
  },

  saveProgress(id: string, seconds: number, fraction: number): void {
    const all = { ...this.getAllProgress() };
    all[id] = [
      Math.max(0, Math.floor(seconds)),
      Math.round(Math.min(Math.max(fraction, 0), 1) * 100) / 100,
      Date.now(),
    ] as unknown as [number, number];
    const keys = Object.keys(all);
    if (keys.length > 1500) {
      keys.slice(0, keys.length - 1500).forEach((k) => delete all[k]);
    }
    writeLocal("nt_progress", all);
  },

  // Subscriptions
  getSubs(): string[] {
    return readLocal<string[]>("nt_subs", []);
  },

  isSubscribed(channelName: string): boolean {
    return this.getSubs().includes(channelName);
  },

  toggleSub(channelName: string): boolean {
    const list = [...this.getSubs()];
    const idx = list.indexOf(channelName);
    if (idx >= 0) {
      list.splice(idx, 1);
      writeLocal("nt_subs", list);
      return false;
    } else {
      list.unshift(channelName);
      writeLocal("nt_subs", list);
      return true;
    }
  },

  // Playlists
  getPlaylists(): Record<string, string[]> {
    return readLocal<Record<string, string[]>>("nt_playlists", {});
  },

  toggleInPlaylist(playlistName: string, videoId: string): boolean {
    const all = { ...this.getPlaylists() };
    const list = [...(all[playlistName] || [])];
    const idx = list.indexOf(videoId);
    if (idx >= 0) {
      list.splice(idx, 1);
      all[playlistName] = list;
      writeLocal("nt_playlists", all);
      return false;
    } else {
      list.unshift(videoId);
      all[playlistName] = list;
      writeLocal("nt_playlists", all);
      return true;
    }
  },

  deletePlaylist(playlistName: string): void {
    const all = { ...this.getPlaylists() };
    delete all[playlistName];
    writeLocal("nt_playlists", all);
  },

  // Blocked videos / channels ("مش مهتم" / "ما تعرضليش القناة دي")
  getBlockedVideos(): string[] {
    return readLocal<string[]>("nt_hide_v", []);
  },

  getBlockedChannels(): string[] {
    return readLocal<string[]>("nt_hide_c", []);
  },

  hideVideo(id: string): void {
    const set = new Set(this.getBlockedVideos());
    set.add(id);
    writeLocal("nt_hide_v", [...set]);
  },

  hideChannel(channelName: string): void {
    const set = new Set(this.getBlockedChannels());
    set.add(channelName);
    writeLocal("nt_hide_c", [...set]);
  },

  isAllowed(v: VideoItem): boolean {
    const bv = this.getBlockedVideos();
    const bc = this.getBlockedChannels();
    return !bv.includes(v.id) && !bc.includes(v.c);
  },

  // Clips
  getClips(): SavedClip[] {
    return readLocal<SavedClip[]>("nt_clips", []);
  },

  saveClip(clip: Omit<SavedClip, "id" | "at">): SavedClip {
    const item: SavedClip = {
      ...clip,
      id: `${clip.vid}_${clip.s}_${clip.e}`,
      at: Date.now(),
    };
    const next = [item, ...this.getClips().filter((x) => x.id !== item.id)].slice(
      0,
      200
    );
    writeLocal("nt_clips", next);
    return item;
  },

  deleteClip(id: string): void {
    writeLocal(
      "nt_clips",
      this.getClips().filter((c) => c.id !== id)
    );
  },

  // Per-channel speed memory
  getSpeedForChannel(channelName: string): number {
    const all = readLocal<Record<string, number>>("nt_speeds", {});
    return all[channelName] || 1;
  },

  setSpeedForChannel(channelName: string, speed: number): void {
    const all = { ...readLocal<Record<string, number>>("nt_speeds", {}) };
    if (speed === 1) delete all[channelName];
    else all[channelName] = speed;
    writeLocal("nt_speeds", all);
  },

  // Session playback queue
  getQueue(): VideoItem[] {
    return readLocal<VideoItem[]>("nt_queue", []);
  },

  addToQueue(video: VideoItem): void {
    const q = this.getQueue().filter((x) => x.id !== video.id);
    q.push(video);
    writeLocal("nt_queue", q);
  },

  shiftQueue(): VideoItem | undefined {
    const q = [...this.getQueue()];
    const first = q.shift();
    writeLocal("nt_queue", q);
    return first;
  },

  removeFromQueue(id: string): void {
    writeLocal(
      "nt_queue",
      this.getQueue().filter((x) => x.id !== id)
    );
  },

  clearQueue(): void {
    writeLocal("nt_queue", []);
  },
};
