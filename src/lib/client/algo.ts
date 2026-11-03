"use client";

import type { LabelsAggregate, VideoItem } from "../types.ts";
import { normArabic } from "../arabic.ts";
import { ClientStore, readLocal, writeLocal } from "./store.ts";
import { Growth, type GrowthContext } from "./growth.ts";

const HALF_LIFE = 4 * 86400_000; // 4 days
const MAX_KEYS = 4000;
const MODEL_KEY = "nt_model";
/** "مزاجك دلوقتي": short-term session memory, half of it fades every 40 minutes. */
export const SESSION_HALF = 40 * 60_000;
const SESSION_MAX_AGE = 6 * 3600_000;

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
  /** Session mood: { feature: [value, lastUpdate] } */
  ss: Record<string, [number, number]>;
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
    ss: raw.ss || {},
  };
  return modelCache;
}

function saveModel(): void {
  const m = getModel();
  const now = Date.now();
  for (const k of Object.keys(m.ss)) if (now - m.ss[k][1] > SESSION_MAX_AGE) delete m.ss[k];
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

export function sessionValue(key: string, now = Date.now()): number {
  const e = getModel().ss[key];
  return e ? e[0] * Math.pow(0.5, (now - e[1]) / SESSION_HALF) : 0;
}

function bumpSession(key: string, delta: number): void {
  const m = getModel();
  m.ss[key] = [Math.max(-4, Math.min(4, sessionValue(key) + delta)), Date.now()];
}

/** Test/maintenance hook: drop the in-memory model so the next read comes from localStorage. */
export function resetModelCache(): void {
  modelCache = null;
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
    if (!k.startsWith("d:")) bumpSession(k, reward * w * 1.5); // the mood moves faster
  }
  saveModel();
}

/**
 * How well a video matches this session's mood. Title words carry little weight in the long-term
 * features (they're split across the title), but in the mood they're the clearest signal.
 */
export function getSessionAffinity(v: VideoItem): number {
  let a = 0;
  for (const [k, w] of extractFeatures(v)) {
    if (k.startsWith("d:")) continue;
    a += (k.startsWith("w:") ? 3.5 : 1) * w * Math.tanh(sessionValue(k) / 0.8);
  }
  return 0.8 * a;
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
  return a + getSessionAffinity(v);
}

// ---------- "Watched together" graph ----------
let relatedGraph: Record<string, string[]> = {};

/** Related lists (by video) for the viewer's recent history, fetched from /api/videos?related_for=... */
export function setRelatedGraph(graph: Record<string, string[]>): void {
  relatedGraph = graph || {};
}

/**
 * Score for every video connected to what you finished or liked recently: weighted by how much you
 * watched it, likes count double, recent ones count more (0.93^i), and earlier slots in its list count more.
 */
export function relatedScores(
  history: string[],
  progress: Record<string, [number, number]>,
  liked: Set<string>,
  graph: Record<string, string[]> = relatedGraph
): Map<string, number> {
  const out = new Map<string, number>();
  history.slice(0, 40).forEach((id, i) => {
    const frac = progress[id]?.[1] ?? 0;
    const isLiked = liked.has(id);
    if (frac < 0.3 && !isLiked) return;
    const w = Math.min(1, frac + 0.2) * (isLiked ? 2 : 1) * Math.pow(0.93, i);
    (graph[id] || []).slice(0, 12).forEach((rid, j) => {
      out.set(rid, (out.get(rid) || 0) + w / (1 + 0.35 * j));
    });
  });
  return out;
}

/** Published in the last 21 days by a channel you're subscribed to or clearly love. */
export function newFromLoved(v: VideoItem, subs: Set<string>, now = Date.now()): number {
  if (!v.dt) return 0;
  const love = subs.has(v.c) ? 1 : Math.min(1, featureValue("c:" + v.c) / 1.5);
  if (love < 0.3) return 0;
  const y = Math.floor(v.dt / 10000);
  const m = Math.floor(v.dt / 100) % 100;
  const d = v.dt % 100;
  const ageDays = (now - new Date(y, m - 1, d).getTime()) / 86400_000;
  return ageDays < 0 || ageDays > 21 ? 0 : 0.9 * love * (1 - ageDays / 21);
}

/** Why each video in the last built feed is there (shown on the card). */
const whyById = new Map<string, string>();

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
  const fromFeed = whyById.get(v.id);
  if (fromFeed) return fromFeed;
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

const finished = new Set<string>();

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

  setRelatedGraph,

  recordWatch(v: VideoItem, seconds: number, fraction: number): void {
    if (seconds < 15 && fraction < 0.08) return;
    const m = getModel();
    delete m.imp[v.id];
    delete m.impAt[v.id];
    learnFromVideo(v, 0.14);
    Growth.record(v, 5);
    if (fraction > 0.7 && !finished.has(v.id)) {
      finished.add(v.id);
      Growth.finish(v);
    }
  },

  /** Left a video: closing it within 45s and before 10% is a clear "not for me". */
  recordClose(v: VideoItem, fraction: number, watchedSeconds: number): void {
    if (fraction < 0.1 && watchedSeconds < 45) {
      learnFromVideo(v, -0.7);
      Growth.quit(v);
    }
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

    const history = ClientStore.getList("history");
    const liked = new Set(ClientStore.getList("liked"));
    const rel = relatedScores(history, progress, liked);
    const lastDoneId = history.find((id) => (progress[id]?.[1] ?? 0) > 0.6);
    const ctx: GrowthContext = Growth.context(
      lastDoneId ? pool.find((x) => x.id === lastDoneId) || null : null
    );
    const learned = Object.keys(getModel().f).length > 0;
    const now = Date.now();

    const scored = candidates.map((v) => {
      const aff = getVideoAffinity(v);
      const mood = learned ? getSessionAffinity(v) : 0;
      const tFit = getTimeFit(v);
      const quality = 0.55 * (v.s ?? v.r ?? 0.5) + 0.25 * (v.q ?? 0.5) + 0.2 * (v.hd ? 1 : 0);
      const subBoost = subs.has(v.c) ? 0.65 : 0;
      const skipPenalty = (getSkips(v.id)[0] || 0) * 0.35;
      const relScore = rel.get(v.id) || 0;
      const fresh = newFromLoved(v, subs, now);
      const [gb, gwhy, step] = Growth.bonus(v, aff, ctx);
      const score =
        1.35 * aff + 0.45 * tFit + 0.75 * quality + subBoost - skipPenalty +
        1.1 * Math.tanh(relScore) + fresh + gb;
      const why =
        fresh > 0.3 ? "جديد من " + v.c
        : mood > 0.6 ? "على مزاجك دلوقتي"
        : gwhy && (gb > 0.6 || ctx.season) ? gwhy
        : step && getVideoCategory(v) !== "ترفيه" ? step
        : relScore > 0.5 ? "شبه حاجة كمّلتها"
        : null;
      return { v, score, cat: getVideoCategory(v), why };
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

      const pick = scored.splice(pickIdx, 1)[0];
      const chosen = pick.v;
      if (pick.why) whyById.set(chosen.id, pick.why);
      else whyById.delete(chosen.id);
      usedIds.add(chosen.id);
      recentChannels.push(chosen.c);
      out.push(chosen);
    }

    return out;
  },
};
