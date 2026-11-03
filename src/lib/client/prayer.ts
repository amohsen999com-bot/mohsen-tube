"use client";

import type { VideoItem } from "../types.ts";
import { getVideoCategory } from "./algo.ts";
import { readLocal, writeLocal, type WirdState } from "./store.ts";

export interface PrayerLocation {
  lat: number;
  lng: number;
  name: string;
}

export const CAIRO_LOCATION: PrayerLocation = {
  lat: 30.0444,
  lng: 31.2357,
  name: "القاهرة",
};

export const PRAYER_NAMES: Record<string, string> = {
  fajr: "الفجر",
  dhuhr: "الظهر",
  asr: "العصر",
  maghrib: "المغرب",
  isha: "العشاء",
};

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const fix = (a: number, b: number) => ((a % b) + b) % b;

function sunPosition(jd: number) {
  const D = jd - 2451545.0;
  const g = rad(fix(357.529 + 0.98560028 * D, 360));
  const q = fix(280.459 + 0.98564736 * D, 360);
  const L = rad(fix(q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g), 360));
  const e = rad(23.439 - 0.00000036 * D);
  const RA = deg(Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L))) / 15;
  return {
    decl: Math.asin(Math.sin(e) * Math.sin(L)),
    eqt: q / 15 - fix(RA, 24),
  };
}

/**
 * Computes the 5 daily Islamic prayer times using the Egyptian General Authority of Survey
 * (Fajr 19.5°, Isha 17.5°, Shafi'i Asr).
 */
export function calculatePrayerTimes(
  date = new Date(),
  where: PrayerLocation = getPrayerLocation()
): Record<"fajr" | "dhuhr" | "asr" | "maghrib" | "isha", Date> {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const A = Math.floor((14 - m) / 12);
  const Y = y + 4800 - A;
  const M = m + 12 * A - 3;
  const jd =
    d +
    Math.floor((153 * M + 2) / 5) +
    365 * Y +
    Math.floor(Y / 4) -
    Math.floor(Y / 100) +
    Math.floor(Y / 400) -
    32045 -
    where.lng / 360;

  const { decl, eqt } = sunPosition(jd);
  const lat = rad(where.lat);
  const tz = -new Date(y, m - 1, d, 12).getTimezoneOffset() / 60;
  const noon = 12 + tz - where.lng / 15 - eqt;

  const H = (h: number) =>
    deg(
      Math.acos(
        (Math.sin(rad(h)) - Math.sin(lat) * Math.sin(decl)) /
          (Math.cos(lat) * Math.cos(decl))
      )
    ) / 15;

  const asrAlt = deg(Math.atan(1 / (1 + Math.tan(Math.abs(lat - decl)))));
  const hours = {
    fajr: noon - H(-19.5),
    dhuhr: noon + 2 / 60,
    asr: noon + H(asrAlt),
    maghrib: noon + H(-0.833) + 1 / 60,
    isha: noon + H(-17.5),
  };

  return {
    fajr: new Date(y, m - 1, d, 0, Math.round(hours.fajr * 60)),
    dhuhr: new Date(y, m - 1, d, 0, Math.round(hours.dhuhr * 60)),
    asr: new Date(y, m - 1, d, 0, Math.round(hours.asr * 60)),
    maghrib: new Date(y, m - 1, d, 0, Math.round(hours.maghrib * 60)),
    isha: new Date(y, m - 1, d, 0, Math.round(hours.isha * 60)),
  };
}

export function getPrayerLocation(): PrayerLocation {
  return readLocal<PrayerLocation>("nt_loc", CAIRO_LOCATION);
}

export function setPrayerLocation(loc: PrayerLocation): void {
  writeLocal("nt_loc", loc);
}

export function isPrayerPauseEnabled(): boolean {
  return readLocal<boolean>("nt_prayer_pause", true);
}

export function setPrayerPauseEnabled(enabled: boolean): void {
  writeLocal("nt_prayer_pause", enabled);
}

// ---------- Daily Learning Goal (الورد اليومي) ----------
const WIRD_KEY = "nt_wird";

export function getDayKey(d = new Date()): string {
  return d.toLocaleDateString("en-CA");
}

export function getWird(): WirdState {
  return readLocal<WirdState>(WIRD_KEY, { goal: 20, days: {} });
}

export function setWirdGoal(goalMinutes: number): void {
  const w = getWird();
  w.goal = goalMinutes;
  writeLocal(WIRD_KEY, w);
}

export function recordWirdWatchSeconds(
  video: VideoItem | null,
  deltaSec: number
): { completedNow: boolean; streakDays: number } {
  if (!video || getVideoCategory(video) === "ترفيه") {
    return { completedNow: false, streakDays: getWirdStreak() };
  }
  const w = getWird();
  if (!w.goal) return { completedNow: false, streakDays: 0 };
  const k = getDayKey();
  const before = w.days[k] || 0;
  w.days[k] = before + deltaSec;
  Object.keys(w.days)
    .sort()
    .slice(0, -60)
    .forEach((oldKey) => delete w.days[oldKey]);
  writeLocal(WIRD_KEY, w);

  const completedNow = before < w.goal * 60 && w.days[k] >= w.goal * 60;
  return { completedNow, streakDays: getWirdStreak() };
}

export function getWirdStreak(): number {
  const w = getWird();
  if (!w.goal) return 0;
  let n = 0;
  const today = getDayKey();
  const cursor = new Date();
  for (;;) {
    const k = getDayKey(cursor);
    if ((w.days[k] || 0) >= w.goal * 60) {
      n++;
    } else if (k !== today) {
      break;
    }
    if (n > 365) break;
    cursor.setDate(cursor.getDate() - 1);
  }
  return n;
}
