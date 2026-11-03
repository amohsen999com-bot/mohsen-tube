"use client";

import type { LabelsAggregate, VideoItem } from "../types.ts";
import { normArabic } from "../arabic.ts";
import { ClientStore, readLocal, writeLocal } from "./store.ts";

const HALF_LIFE = 4 * 86400_000; // 4 days
const MAX_KEYS = 4000;
const MODEL_KEY = "nt_model";

const STOP_WORDS = new Set(
  (
    "من في على عن الى الي إلى ما هو هي هذا هذه ذلك تلك التي الذي الذين مع كل او أو ثم قد لا لم لن ان أن إن كان كانت " +
    "الشيخ الشيخة الدكتور العلامة شرح درس دروس الدرس الحلقة حلقة الجزء جزء مجلس المجلس رقم سلسلة كامل كاملة " +
    "the and for with how what you your this that from part episode video"
  ).split(" ")
);

const STORY_RE =
  /قصة|قصص|حكاية|حكايات|سيرة|السيرة|موقف|مواقف|عبرة|رقائق|قصه|story|stories/i;
const CALM_TOPICS = new Set(["سيرة وتاريخ", "رقائق"]);

export type CategoryKind = "وعظ" | "عمل" | "ترفيه";

export function getVideoCategory(v: VideoItem): CategoryKind {
  if (
    v.g === "علماء" ||
    v.g === "أنا السلفي" ||
    v.g === "القرآن الكريم"
  ) {
    return "وعظ";
  }
  if (
    v.g === "كورسات" ||
    v.g === "طلبك" ||
    (v.g === "بودكاست" && v.tp === "بيزنس")
  ) {
    return "عمل";
  }
  return "ترفيه";
}

const RHYTHM: Record<"morning" | "afternoon" | "night", CategoryKind[]> = {
  morning: ["وعظ", "عمل", "عمل", "ترفيه", "عمل", "وعظ"],
  afternoon: ["وعظ", "عمل", "ترفيه", "وعظ", "عمل", "ترفيه"],
  night: ["وعظ", "ترفيه", "وعظ", "عمل", "ترفيه", "وعظ"],
};

export function getRhythmSlots(hour = new Date().getHours()): CategoryKind[] {
  if (hour >= 5 && hour < 13) return RHYTHM.morning;
  if (hour >= 13 && hour < 20) return RHYTHM.afternoon;
  return RHYTHM.night;
}

interface ModelData {
  f: Record<string, [number, number]>;
  imp: Record<string, number>;
  impAt: Record<string, number>;
}

let modelCache: ModelData | null = null;
let labelsCache: LabelsAggregate = { v: {}, c: {} };

function getModel(): ModelData {
  if (modelCache) return modelCache;
  const raw = readLocal<Partial<ModelData>>(MODEL_KEY, {});
  modelCache = {
    f: raw.f || {},
    imp: raw.imp || {},
    impAt: raw.impAt || {},
  };
  return modelCache;
}

function saveModel(): void {
  const m = getModel();
  const keys = Object.keys(m.f);
  if (keys.length > MAX_KEYS) {
    keys
      .sort((a, b) => Math.abs(featureValue(a)) - Math.abs(featureValue(b)))
      .slice(0, keys.length - MAX_KEYS)
      .forEach((k) => delete m.f[k]);
  }
  writeLocal(MODEL_KEY, m);
}

function featureValue(key: string): number {
  const m = getModel();
  const entry = m.f[key];
  if (!entry) return 0;
  return entry[0] * Math.pow(0.5, (Date.now() - entry[1]) / HALF_LIFE);
}

function bumpFeature(key: string, delta: number): void {
  const m = getModel();
  const nextVal = Math.max(-6, Math.min(6, featureValue(key) + delta));
  m.f[key] = [nextVal, Date.now()];
}

const isNight = (h = new Date().getHours()) => h >= 20 || h < 5;
const slotPrefix = () => (isNight() ? "n" : "d");

const REST_HOURS = [0, 12, 24, 72, 168, 720];

export function getSkips(id: string): [number, number] {
  const m = getModel();
  const n = m.imp[id] || 0;
  if (n && !m.impAt[id]) m.impAt[id] = Date.now();
  const at = m.impAt[id] || 0;
  if (n && Date.now() - at > 30 * 86400_000) {
    delete m.imp[id];
    delete m.impAt[id];
    return [0, 0];
  }
  return [n, at];
}

export function isResting(id: string): boolean {
  const [n, at] = getSkips(id);
  return n > 0 && Date.now() - at < REST_HOURS[Math.min(n, 5)] * 3600_000;
}

function topAnswers(map?: Record<string, number>): string[] {
  if (!map) return [];
  const total = Object.values(map).reduce((a, b) => a + b, 0);
  if (!total) return [];
  return Object.entries(map)
    .filter(([, n]) => n / total >= 0.25)
    .sort((a, b) => b[1] - a[1])
    .map(([a]) => a);
}

const durBucket = (d: number) =>
  d < 600 ? "s" : d < 1800 ? "m" : d < 3600 ? "l" : "x";

export function extractFeatures(v: VideoItem): Array<[string, number]> {
  const words = [
    ...new Set(
      normArabic(v.t)
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
    ),
  ].slice(0, 8);
  const style = [
    ...topAnswers(labelsCache.c[v.c]?.trait),
    ...topAnswers(labelsCache.c[v.c]?.edge),
  ].slice(0, 4);
  const aud = topAnswers(labelsCache.v[v.id]?.aud).slice(0, 2);

  return [
    ["c:" + v.c, 1],
    ["t:" + v.tp, 0.6],
    ["g:" + getVideoCategory(v), 0.3],
    ["d:" + durBucket(v.d || 0), 0.4],
    ...words.map(
      (w): [string, number] => ["w:" + w, 0.9 / Math.max(words.length, 3)]
    ),
    ...style.map((x): [string, number] => ["s:" + x, 0.3]),
    ...aud.map((x): [string, number] => ["a:" + x, 0.35]),
  ];
}

export function learnFromVideo(v: VideoItem, reward: number): void {
  if (!v || !reward) return;
  const s = slotPrefix();
  for (const [k, w] of extractFeatures(v)) {
    bumpFeature(k, reward * w);
    bumpFeature(`${s}:${k}`, reward * w * 0.7);
  }
  saveModel();
}

export function getVideoAffinity(v: VideoItem): number {
  const s = slotPrefix();
  const priors = readLocal<Record<string, number>>("nt_prior", {});
  let a = 0;
  for (const [k, w] of extractFeatures(v)) {
    a +=
      w *
      Math.tanh(
        (featureValue(k) + 0.6 * featureValue(`${s}:${k}`) + (priors[k] || 0)) /
          2
      );
  }
  const sims = topAnswers(labelsCache.c[v.c]?.similar);
  if (sims.length) {
    a += 0.35 * Math.max(...sims.map((c) => Math.tanh(featureValue("c:" + c) / 2)));
  }
  return a;
}

export function getTimeFit(v: VideoItem): number {
  const mins = (v.d || 0) / 60;
  if (isNight()) {
    let fit =
      mins <= 15 ? 0.6 : mins <= 25 ? 0.15 : -0.5 - Math.min((mins - 25) / 60, 0.6);
    if (STORY_RE.test(v.t)) fit += 0.8;
    if (CALM_TOPICS.has(v.tp)) fit += 0.45;
    if (v.g === "كورسات") fit -= 0.25;
    return fit;
  }
  return mins >= 25 ? 0.45 + Math.min((mins - 25) / 120, 0.25) : mins >= 12 ? 0.15 : -0.2;
}

const ABOUT_TOPIC: Record<string, string> = {
  تفسير: "تدبّر في كلام الله",
  حديث: "من هدي النبي ﷺ",
  عقيدة: "تثبيت للعقيدة",
  فقه: "تفقّه في دينك",
  فتاوى: "إجابة عن سؤال بيشغل ناس كتير",
  "سيرة وتاريخ": "قصة من التاريخ فيها عبرة",
  رقائق: "كلام يرقّق القلب",
  "أصول وعلوم": "أساس متين لطالب العلم",
  "ردود وشبهات": "ردّ على شبهة بالحجة",
  "القرآن الكريم": "تلاوة تريّح القلب",
};

export function getWhyLabel(v: VideoItem): string {
  const subs = ClientStore.getSubs();
  if (subs.includes(v.c)) return `من اشتراكاتك • ${v.c}`;
  if (featureValue("c:" + v.c) > 1.2) return `بتسمع ${v.c} كتير`;
  if (featureValue("t:" + v.tp) > 1.0 && ABOUT_TOPIC[v.tp]) {
    return ABOUT_TOPIC[v.tp];
  }
  if (isNight() && (STORY_RE.test(v.t) || CALM_TOPICS.has(v.tp))) {
    return "قصة هادية لآخر اليوم";
  }
  return ABOUT_TOPIC[v.tp] || v.tp || "مقترح لك";
}

export const AlgoEngine = {
  setLabels(labels: LabelsAggregate) {
    if (labels) labelsCache = labels;
  },

  cat: getVideoCategory,

  topicScore(tp: string): number {
    return featureValue("t:" + tp);
  },

  seedInterests(topics: string[], whoLabels: string[] = []): void {
    for (const tp of topics) {
      bumpFeature("t:" + tp, 2.2);
      for (const w of normArabic(tp).split(/\s+/).filter(Boolean)) {
        if (w.length > 2) bumpFeature("w:" + w, 1.5);
      }
    }
    const priors = readLocal<Record<string, number>>("nt_prior", {});
    for (const aud of whoLabels) {
      priors["a:" + aud] = 1.8;
    }
    writeLocal("nt_prior", priors);
    saveModel();
  },

  recordWatch(v: VideoItem, seconds: number, fraction: number): void {
    if (seconds < 15 && fraction < 0.08) return;
    const m = getModel();
    delete m.imp[v.id];
    delete m.impAt[v.id];
    learnFromVideo(v, 0.14);
  },

  recordLike(v: VideoItem, liked: boolean): void {
    learnFromVideo(v, liked ? 1.8 : -0.8);
  },

  recordSearch(query: string): void {
    for (const w of normArabic(query).split(/\s+/).filter((x) => x.length > 2)) {
      if (!STOP_WORDS.has(w)) bumpFeature("w:" + w, 0.9);
    }
    saveModel();
  },

  recordSkip(v: VideoItem): void {
    const m = getModel();
    m.imp[v.id] = (m.imp[v.id] || 0) + 1;
    m.impAt[v.id] = Date.now();
    learnFromVideo(v, -0.08);
  },

  buildFeedBatch(
    pool: VideoItem[],
    count: number,
    usedIds: Set<string>,
    recentChannels: string[]
  ): VideoItem[] {
    const progress = ClientStore.getAllProgress();
    const subs = new Set(ClientStore.getSubs());
    const candidates = pool.filter((v) => {
      if (usedIds.has(v.id)) return false;
      if (!ClientStore.isAllowed(v)) return false;
      if (isResting(v.id)) return false;
      const p = progress[v.id];
      if (p && p[1] >= 0.9) return false;
      return true;
    });

    if (!candidates.length) return [];

    const scored = candidates.map((v) => {
      const aff = getVideoAffinity(v);
      const tFit = getTimeFit(v);
      const quality = 0.55 * (v.s ?? v.r ?? 0.5) + 0.25 * (v.q ?? 0.5) + 0.2 * (v.hd ? 1 : 0);
      const subBoost = subs.has(v.c) ? 0.65 : 0;
      const skipPenalty = (getSkips(v.id)[0] || 0) * 0.35;
      const score = 1.35 * aff + 0.45 * tFit + 0.75 * quality + subBoost - skipPenalty;
      return { v, score, cat: getVideoCategory(v) };
    });

    scored.sort((a, b) => b.score - a.score);

    const pattern = getRhythmSlots();
    const out: VideoItem[] = [];

    for (let i = 0; i < count && scored.length > 0; i++) {
      const wantCat = pattern[i % pattern.length];
      const recentSlice = recentChannels.slice(-3);
      let pickIdx = scored.findIndex(
        (x) =>
          x.cat === wantCat &&
          !usedIds.has(x.v.id) &&
          !recentSlice.includes(x.v.c)
      );
      if (pickIdx < 0) {
        pickIdx = scored.findIndex(
          (x) => !usedIds.has(x.v.id) && !recentSlice.includes(x.v.c)
        );
      }
      if (pickIdx < 0) {
        pickIdx = scored.findIndex((x) => !usedIds.has(x.v.id));
      }
      if (pickIdx < 0) break;

      const chosen = scored.splice(pickIdx, 1)[0].v;
      usedIds.add(chosen.id);
      recentChannels.push(chosen.c);
      out.push(chosen);
    }

    return out;
  },
};
