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

/** Topics by kind, to read what someone picked at the start. */
const FUN_TOPICS = new Set(
  "نجارة|اختراعات|كهرباء وإلكترونيات|زراعة وتربية|زراعة|قصص|طبخ|ترميم|ميكانيكا سيارات|بدائي وبقاء|بناء وتشطيب|صيانة وسباكة|ورشة ومعادن".split("|")
);
const DEEN_TOPICS = new Set(
  "تفسير|سيرة وتاريخ|فقه|فتاوى|حديث|عقيدة|رقائق|ردود وشبهات|القرآن الكريم|أصول وعلوم|دروس عامة".split("|")
);
/** School study subjects: shown only to someone who picked them on purpose (never learned from a stray watch) */
export const STUDY_TOPICS = new Set(["كيمياء", "فيزياء", "أحياء", "لغة عربية"]);
const pickedStudy = (tp: string) => readLocal<string[]>("nt_interests", []).includes(tp);

export const topicKind = (tp: string): CategoryKind =>
  DEEN_TOPICS.has(tp) ? "وعظ" : FUN_TOPICS.has(tp) ? "ترفيه" : "عمل";

/**
 * The feed's rhythm: 8 slots that repeat. Religious content gets 2 of every 8 at any hour, in the 4th and
 * 8th place (never the first cards). The goal is to make people love the deen gently over years, not to
 * fill their screen with it. The other 6 lean on what the viewer picked (skills vs. hands-on/fun), then
 * on the time of day (more learning in the morning, lighter at night).
 */
export function getRhythmSlots(hour = new Date().getHours(), picks: string[] = readLocal<string[]>("nt_interests", [])): CategoryKind[] {
  let work = hour >= 5 && hour < 13 ? 0.6 : hour >= 13 && hour < 20 ? 0.5 : 0.35;
  const kinds = picks.map(topicKind).filter((k) => k !== "وعظ");
  if (kinds.length) work = 0.75 * (kinds.filter((k) => k === "عمل").length / kinds.length) + 0.25 * work;
  const nWork = Math.max(1, Math.min(5, Math.round(6 * work)));
  const major: CategoryKind = nWork >= 3 ? "عمل" : "ترفيه";
  const minor: CategoryKind = major === "عمل" ? "ترفيه" : "عمل";
  const nMinor = major === "عمل" ? 6 - nWork : nWork;
  const six = Array.from({ length: 6 }, (_, i) =>
    Math.floor(((i + 1) * nMinor) / 6) > Math.floor((i * nMinor) / 6) ? minor : major
  );
  return [six[0], six[1], six[2], "وعظ", six[3], six[4], six[5], "وعظ"];
}

/**
 * What this viewer is into: the topics they picked + the ones they've clearly come to love, and how much
 * they care for religious content (none / some / main). Empty topics = we know nothing yet (new visitor).
 */
export type InterestProfile = { topics: Set<string>; deen: "none" | "some" | "main"; kinds: Record<CategoryKind, number> };

export function interestProfile(pool: VideoItem[] = [], subs: Set<string> = new Set()): InterestProfile {
  const picked = readLocal<string[]>("nt_interests", []);
  const loved = Object.keys(getModel().f)
    .filter((k) => k.startsWith("t:") && k !== "t:دروس عامة" && featureValue(k) > 0.8)
    .map((k) => k.slice(2));
  const topics = new Set([...picked, ...loved.filter((tp) => !STUDY_TOPICS.has(tp))]);
  const kinds: Record<CategoryKind, number> = { "وعظ": 0, "عمل": 0, "ترفيه": 0 };
  for (const tp of topics) kinds[topicKind(tp)]++;
  // Subscribed to (or clearly loving) a religious channel also counts as caring for religious content
  const deenChannels = new Set(pool.filter((v) => getVideoCategory(v) === "وعظ").map((v) => v.c));
  const deenLove =
    [...subs].filter((c) => deenChannels.has(c)).length + (featureValue("g:وعظ") > 0.6 ? 1 : 0);
  kinds["وعظ"] += deenLove;
  const total = kinds["وعظ"] + kinds["عمل"] + kinds["ترفيه"];
  const deen = kinds["وعظ"] === 0 ? "none" : kinds["وعظ"] * 2 >= total ? "main" : "some";
  return { topics, deen, kinds };
}

/**
 * The repeating order of kinds for someone whose interests we know:
 * - not into religious content: 1 card in 12 (a gentle one), the rest from their own kinds of interests
 * - some: 2 in 8 (4th and 8th), like before
 * - mainly: about their share of it (at least half), the rest from their other interests if they have any
 */
export function profilePattern(p: InterestProfile, hour = new Date().getHours()): CategoryKind[] {
  if (!p.topics.size && p.deen === "none") return getRhythmSlots(hour);
  const work = p.kinds["عمل"];
  const fun = p.kinds["ترفيه"];
  const other = (n: number): CategoryKind[] => {
    if (!work && !fun) return Array(n).fill("وعظ");
    const nWork = Math.round((n * work) / Math.max(1, work + fun));
    return Array.from({ length: n }, (_, i) =>
      Math.floor(((i + 1) * nWork) / n) > Math.floor((i * nWork) / n) ? "عمل" : "ترفيه"
    );
  };
  if (p.deen === "none") {
    const o = other(11);
    return [...o.slice(0, 7), "وعظ", ...o.slice(7)];
  }
  if (p.deen === "some") {
    const o = other(6);
    return [o[0], o[1], o[2], "وعظ", o[3], o[4], o[5], "وعظ"];
  }
  // main: religious first, but their other interests keep a place so it never feels like one long sermon
  const nonDeen = work + fun;
  if (!nonDeen) return Array(8).fill("وعظ");
  const share = p.kinds["وعظ"] / (p.kinds["وعظ"] + nonDeen);
  const nDeen = Math.max(4, Math.min(6, Math.round(8 * share)));
  const o = other(8 - nDeen);
  const out: CategoryKind[] = [];
  for (let i = 0, j = 0; i < 8; i++) {
    const deenHere = Math.floor(((i + 1) * nDeen) / 8) > Math.floor((i * nDeen) / 8);
    out.push(deenHere || j >= o.length ? "وعظ" : o[j++]);
  }
  return out;
}

/**
 * "رزانة": how far apart similar things must be in the feed, whatever the scores say. A subscription,
 * a like or "عايز أشوف حاجات زي دي أكتر" raises a channel or topic, but never lets it flood the screen.
 */
export const CALM = {
  /** The same channel doesn't come back within this many cards... */
  channelGap: 8,
  /** ...and shows at most this many times in any 20 cards. */
  channelPer20: 2,
  /** Subscribed channels together: at most 1 in any 4 cards. */
  subsWindow: 4,
  /** The same topic never twice in a row, and at most 3 in any 12 cards. */
  topicGap: 1,
  topicPer12: 3,
  /** Religious content: at most 2 in any 8 cards. */
  deenWindow: 8,
  deenMax: 2,
};

/** What a running feed already showed, keyed by its recentChannels list (which lives as long as the feed). */
const trails = new WeakMap<string[], VideoItem[]>();


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
  // The mood nudges; it doesn't take over the screen
  return a + 0.6 * getSessionAffinity(v);
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

/** Days since a video came out (from its YYYYMMDD date), or null when unknown. */
export function ageDays(v: VideoItem, now = Date.now()): number | null {
  if (!v.dt) return null;
  const y = Math.floor(v.dt / 10000);
  const m = Math.floor(v.dt / 100) % 100;
  const d = v.dt % 100;
  return Math.max(0, (now - new Date(y, m - 1, d).getTime()) / 86400_000);
}

/**
 * New uploads come first: anything out in the last day gets a big lift, fading to nothing after two
 * weeks. The calm rules still spread them out, and a kind the viewer clearly dislikes keeps less of it.
 */
export function freshBoost(v: VideoItem, aff: number, now = Date.now()): number {
  const a = ageDays(v, now);
  if (a === null || a > 14) return 0;
  const lift = a < 1.5 ? 2.4 : a < 3.5 ? 1.8 : a < 7.5 ? 1.0 : 0.4 * (1 - (a - 7.5) / 6.5);
  return aff < -0.3 ? lift * 0.3 : lift;
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

/**
 * Channels that are good but very prolific: a small fixed nudge down in "مقترح لك" so they show up less
 * often. They still come up for people who watch or subscribe to them (affinity/subs outweigh this).
 */
const CHANNEL_DAMP: Record<string, number> = {
  "الشيخ وليد إسماعيل (الدافع)": 0.3,
  "د. هيثم طلعت": 0.15,
};

export const AlgoEngine = {
  setLabels(labels: LabelsAggregate) {
    if (labels) labelsCache = labels;
  },

  cat: getVideoCategory,

  topicScore(tp: string): number {
    return featureValue("t:" + tp);
  },

  /** What the viewer picked at the start, then the topics they've clearly come to love (at most 8). */
  interests(): string[] {
    const picked = readLocal<string[]>("nt_interests", []);
    const loved = Object.keys(getModel().f)
      .filter((k) => k.startsWith("t:") && k !== "t:دروس عامة")
      .map((k) => [k.slice(2), featureValue(k)] as const)
      .filter(([tp, val]) => val > 0.8 && !STUDY_TOPICS.has(tp))
      .sort((a, b) => b[1] - a[1])
      .map(([tp]) => tp);
    return [...new Set([...picked, ...loved])].slice(0, 8);
  },

  /** School lessons (primary → secondary) only for someone who chose a study subject on purpose */
  wantsSchool(): boolean {
    return readLocal<string[]>("nt_interests", []).some((tp) => STUDY_TOPICS.has(tp));
  },

  seedInterests(topics: string[], whoLabels: string[] = []): void {
    writeLocal("nt_interests", topics.slice(0, 12));
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
    learnFromVideo(v, liked ? 1.2 : -0.8);
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
    const picked = new Set(readLocal<string[]>("nt_interests", []));
    const profile = interestProfile(pool, subs);
    const knowsUs = profile.topics.size > 0 || profile.deen !== "none";
    // (a topic button tapped on purpose, e.g. كيمياء: the pool is just that topic, so it shows)
    const chipTopic = pool.length > 0 && pool.every((v) => v.tp === pool[0].tp) ? pool[0].tp : null;
    const studyOk = (tp: string) => !STUDY_TOPICS.has(tp) || pickedStudy(tp) || tp === chipTopic;
    const inInterest = (v: VideoItem) =>
      studyOk(v.tp) &&
      (!knowsUs ||
      getVideoCategory(v) === "وعظ" ||
      profile.topics.has(v.tp) ||
      subs.has(v.c) ||
      featureValue("c:" + v.c) > 0.8);

    const scored = candidates.map((v) => {
      const damp = CHANNEL_DAMP[v.c] || 0;
      const aff = getVideoAffinity(v);
      const mood = learned ? getSessionAffinity(v) : 0;
      const tFit = getTimeFit(v);
      const quality = 0.55 * (v.s ?? v.r ?? 0.5) + 0.25 * (v.q ?? 0.5) + 0.2 * (v.hd ? 1 : 0);
      const subBoost = subs.has(v.c) ? 0.3 : 0;
      const skipPenalty = (getSkips(v.id)[0] || 0) * 0.35;
      const relScore = rel.get(v.id) || 0;
      const fresh = newFromLoved(v, subs, now);
      const isNew = freshBoost(v, aff, now);
      const pickedBoost = picked.has(v.tp) ? 0.8 : 0;
      // Someone not into religious content gets the rare one as a gentle story or a few heart-softening minutes
      const gentle =
        profile.deen === "none" && getVideoCategory(v) === "وعظ" && (CALM_TOPICS.has(v.tp) || STORY_RE.test(v.t)) && (v.d || 0) <= 1500
          ? 0.9
          : 0;
      const [gb, gwhy, step] = Growth.bonus(v, aff, ctx);
      const score =
        1.35 * aff + 0.45 * tFit + 0.75 * quality + subBoost - skipPenalty +
        1.1 * Math.tanh(relScore) + fresh + isNew + pickedBoost + gentle + gb - damp;
      const why =
        fresh > 0.3 || isNew >= 1.8 ? "جديد من " + v.c
        : mood > 0.6 ? "على مزاجك دلوقتي"
        : gwhy && (gb > 0.6 || ctx.season) ? gwhy
        : step && getVideoCategory(v) !== "ترفيه" ? step
        : relScore > 0.5 ? "شبه حاجة كمّلتها"
        : null;
      return { v, score, cat: getVideoCategory(v), why, mine: inInterest(v), gentle: gentle > 0 };
    });

    scored.sort((a, b) => b.score - a.score);

    const pattern = profilePattern(profile);
    // How much religious content may show in a row of cards: rare for the uninterested, their share for the rest
    const deenCap =
      profile.deen === "none" && knowsUs
        ? { window: 12, max: 1 }
        : profile.deen === "main"
          ? { window: 8, max: pattern.filter((k) => k === "وعظ").length }
          : { window: CALM.deenWindow, max: CALM.deenMax };
    const out: VideoItem[] = [];
    const trail = trails.get(recentChannels) || [];
    trails.set(recentChannels, trail);
    const last = (n: number) => (n > 0 ? trail.slice(-n) : []);
    const isTopic = (tp?: string) => !!tp && tp !== "دروس عامة";

    // Level 0 = every calm rule + the rhythm slot. Each level up relaxes one thing, only when nothing fits
    // (e.g. a topic chip that leaves only one kind of video).
    const fits = (x: (typeof scored)[number], wantCat: CategoryKind, level: number): boolean => {
      const v = x.v;
      if (usedIds.has(v.id)) return false;
      // Religious content only in its own places in the rhythm (never filling someone else's slot)
      if (x.cat === "وعظ" && wantCat !== "وعظ" && knowsUs && level < 4) return false;
      // For someone not into it: only the gentle kind (a story, a few heart-softening minutes)
      if (x.cat === "وعظ" && profile.deen === "none" && knowsUs && !x.gentle && level < 3) return false;
      // For those who love it: a long lesson, then something lighter, so it never gets heavy
      if (x.cat === "وعظ" && level < 2) {
        const lastDeen = [...trail].reverse().find((p) => getVideoCategory(p) === "وعظ");
        if (lastDeen && (lastDeen.d || 0) > 2400 && (v.d || 0) > 2400) return false;
      }
      // Religious content never goes over this viewer's share, whatever else gets relaxed
      if (
        x.cat === "وعظ" &&
        wantCat !== "وعظ" &&
        last(deenCap.window - 1).filter((p) => getVideoCategory(p) === "وعظ").length >= deenCap.max
      ) {
        return false;
      }
      if (level >= 5) return true; // (nothing else left: anything, so the feed never stops)
      if (recentChannels.slice(-(level >= 4 ? 2 : level >= 3 ? 3 : CALM.channelGap)).includes(v.c)) return false;
      // One channel never more than twice in 20 cards (a subscription or a lot of likes included)
      if (last(19).filter((p) => p.c === v.c).length >= CALM.channelPer20) return false;
      if (level >= 3) return true;
      if (subs.has(v.c) && last(CALM.subsWindow - 1).some((p) => subs.has(p.c))) return false;
      if (level >= 2) return true;
      if (isTopic(v.tp)) {
        if (last(CALM.topicGap).some((p) => p.tp === v.tp)) return false;
        if (last(11).filter((p) => p.tp === v.tp).length >= CALM.topicPer12) return false;
      }
      return level >= 1 || x.cat === wantCat;
    };

    for (let i = 0; i < count && scored.length > 0; i++) {
      const wantCat = pattern[trail.length % pattern.length];
      let pickIdx = -1;
      // Only what this viewer is into; outside their interests only as a last resort (same kind), so the feed never runs dry
      for (let level = 0; level <= 4 && pickIdx < 0; level++) {
        pickIdx = scored.findIndex((x) => x.mine && fits(x, wantCat, level));
      }
      // (then: the same kind from outside their interests, then anything that keeps the channel limits,
      // and only when nothing at all is left, no limits, so the feed never stops)
      const okStudy = (x: (typeof scored)[number]) => studyOk(x.v.tp);
      if (pickIdx < 0) pickIdx = scored.findIndex((x) => okStudy(x) && x.cat === wantCat && fits(x, wantCat, 3));
      if (pickIdx < 0) pickIdx = scored.findIndex((x) => okStudy(x) && fits(x, wantCat, 4));
      if (pickIdx < 0) pickIdx = scored.findIndex((x) => okStudy(x) && fits(x, wantCat, 5));
      if (pickIdx < 0) break;

      const pick = scored.splice(pickIdx, 1)[0];
      const chosen = pick.v;
      if (pick.why) whyById.set(chosen.id, pick.why);
      else whyById.delete(chosen.id);
      usedIds.add(chosen.id);
      recentChannels.push(chosen.c);
      trail.push(chosen);
      out.push(chosen);
    }

    return out;
  },
};
