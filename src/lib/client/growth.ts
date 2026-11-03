"use client";

// Long-term growth layer on top of "مقترح لك" (port of the old site's growth.js).
// The feed asks "what will you enjoy now?"; this layer asks "what makes you better a year from now?"
// with small, cumulative nudges rather than preaching:
//   1) Balance across 7 aspects (faith, worship, character, role models, work, helping people, knowledge),
//      bridging the missing aspect through something close to your taste.
//   2) A ladder per topic: every video has a level 1..5; we aim half a step above your level in that topic.
//   3) Knowledge → action: after a religious lesson, a practical video; after work, a reminder of intention.
//   4) Anti-binge: after 90 minutes in one sitting, shorter and practical content rises.
//   5) Rebuttals wait until the basics are built.
//   6) Seasons: Ramadan, the ten days of Dhul-Hijjah, Ashura, Friday, Monday/Thursday fasting eves.

import type { VideoItem } from "../types.ts";
import { readLocal, writeLocal } from "./store.ts";

const KEY = "nt_growth";
const DIET_HALF_LIFE = 30 * 86400_000;
const ar = (s: string) => new RegExp(s, "i");

interface Theme {
  name: string;
  say: string;
  share: number;
  topics: string[];
  groups?: string[];
  re: RegExp;
}

export const THEMES: Record<string, Theme> = {
  iman: { name: "الإيمان ومحبة الله", say: "يقرّب قلبك من الله", share: 0.18, topics: ["رقائق", "عقيدة"],
    re: ar("محبة الله|حب الله|التوبة|الايمان|الإيمان|اليقين|الاخلاص|الإخلاص|القلب|القلوب|الجنة|الرجاء|التوكل|الخشوع|الآخرة|الاخرة|الموت|الصبر|الشكر|الرضا") },
  ibada: { name: "العبادة", say: "يعينك على عبادة أحسن", share: 0.15, topics: ["فقه"],
    re: ar("القرآن|القران|الصلاة|صلاة|الصيام|صيام|الزكاة|الحج|العمرة|الذكر|الأذكار|الاذكار|قيام الليل|الدعاء|الوضوء|تلاوة|حفظ القرآن|الفجر") },
  akhlaq: { name: "الأخلاق والمعاملة", say: "لأخلاق أجمل مع أهلك والناس", share: 0.15, topics: [],
    re: ar("الأخلاق|الاخلاق|خلق|بر الوالدين|الوالدين|الأم|صلة الرحم|الجار|الصدق|الأمانة|الامانة|الحياء|الغضب|اللسان|الغيبة|الزوج|الزوجة|الأسرة|الاسرة|تربية|الأبناء|الابناء|الأولاد|المعاملة|الحسد|الكبر|التواضع") },
  qudwa: { name: "القدوة والسيرة", say: "قدوة من السلف تلهمك", share: 0.1, topics: ["سيرة وتاريخ"],
    re: ar("الصحاب|الصحابي|الصحابة|سيرة|السيرة|التابعين|السلف|الخلفاء|أبو بكر|ابو بكر|عمر بن|عثمان بن|علي بن|خالد بن|الأنبياء|الانبياء|قصص") },
  amal: { name: "العمل والإتقان", say: "مهارة تزوّد إنجازك", share: 0.15, topics: [], groups: ["كورسات", "اصنعها بنفسك"],
    re: ar("العمل|الإتقان|الاتقان|الكسب|الرزق|التجارة|الحرفة|الوقت|الهمة|الإنجاز|الانجاز|النجاح|الكسل|المهارة|المشروع") },
  nafa: { name: "نفع الناس والإصلاح", say: "عشان تنفع غيرك", share: 0.12, topics: [],
    re: ar("الأمر بالمعروف|الامر بالمعروف|النهي عن المنكر|الدعوة|الإصلاح|الاصلاح|نفع الناس|الصدقة|الإحسان|الاحسان|التعاون|الأمة|الامة|خدمة|حوائج|الشباب|المجتمع|اليتيم|الفقراء|الجماعة") },
  ilm: { name: "طلب العلم", say: "خطوة في طلب العلم", share: 0.15, topics: ["تفسير", "حديث", "أصول وعلوم"],
    re: ar("طلب العلم|العلم|التفسير|تفسير|شرح|متن|أصول|اصول|اللغة العربية|النحو|المصطلح") },
};
const RELIGIOUS = new Set(["علماء", "أنا السلفي"]);
const DIVISIVE_TOPIC = "ردود وشبهات";
const START_LEVEL = 1.2;
const STEP = 0.5;
const SPREAD = 0.6;

interface GrowthState {
  diet: Record<string, [number, number]>;
  relMin: number;
  sess: { at: number; secs: number };
  lvl: Record<string, number>;
  goals?: Record<string, number>;
}

let st: GrowthState | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function state(): GrowthState {
  if (st) return st;
  const raw = readLocal<Partial<GrowthState>>(KEY, {});
  st = {
    diet: raw.diet || {},
    relMin: raw.relMin || 0,
    sess: raw.sess || { at: 0, secs: 0 },
    lvl: raw.lvl || {},
    goals: raw.goals,
  };
  return st;
}
function persist() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => writeLocal(KEY, state()), 500);
}
const lvlOf = (tp: string) => state().lvl[tp] ?? START_LEVEL;
const dietVal = (k: string) => {
  const e = state().diet[k];
  return e ? e[0] * Math.pow(0.5, (Date.now() - e[1]) / DIET_HALF_LIFE) : 0;
};

const themeCache = new Map<string, string[]>();
export function themesOf(v: VideoItem): string[] {
  let t = themeCache.get(v.id);
  if (t) return t;
  t = Object.keys(THEMES).filter((k) => {
    const th = THEMES[k];
    return th.re.test(v.t) || th.topics.includes(v.tp) || (th.groups || []).includes(v.g);
  });
  themeCache.set(v.id, t);
  return t;
}

/** How far each aspect is below its target share of your viewing (null until ~20 minutes watched). */
function gaps(): Record<string, number> | null {
  const keys = Object.keys(THEMES);
  const vals = Object.fromEntries(keys.map((k) => [k, dietVal(k)]));
  const total = Object.values(vals).reduce((a, b) => a + b, 0);
  if (total < 20) return null;
  const goals = state().goals || {};
  const want = Object.fromEntries(keys.map((k) => [k, THEMES[k].share + 0.06 * (goals[k] || 0)]));
  const sum = Object.values(want).reduce((a, b) => a + b, 0);
  return Object.fromEntries(keys.map((k) => [k, Math.max(0, want[k] / sum - vals[k] / total)]));
}

function season(): { re: RegExp; why: string } | null {
  const now = new Date();
  const hour = now.getHours();
  const dow = now.getDay();
  let hm = 0;
  let hd = 0;
  try {
    const p = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", { month: "numeric", day: "numeric" }).formatToParts(now);
    hm = Number(p.find((x) => x.type === "month")?.value);
    hd = Number(p.find((x) => x.type === "day")?.value);
  } catch {}
  if (hm === 9) return { re: ar("رمضان|الصيام|صيام|القيام|ليلة القدر|القرآن|التراويح|الاعتكاف|الزكاة"), why: "مناسب لرمضان" };
  if (hm === 12 && hd <= 13) return { re: ar("الحج|العشر|ذي الحجة|الأضحية|الاضحية|عرفة|التكبير|العيد"), why: "مناسب للعشر من ذي الحجة" };
  if (hm === 1 && hd <= 10) return { re: ar("عاشوراء|محرم|موسى|الهجرة"), why: "مناسب لأيام عاشوراء" };
  if (dow === 5 || (dow === 4 && hour >= 18)) return { re: ar("الكهف|الجمعة|الصلاة على النبي|خطبة"), why: "مناسب ليوم الجمعة" };
  if ((dow === 0 || dow === 3) && hour >= 18) return { re: ar("صيام الاثنين|صيام الخميس|صيام التطوع|فضل الصيام"), why: "تفكير بصيام بكرة" };
  return null;
}

export interface GrowthContext {
  gaps: Record<string, number> | null;
  relMin: number;
  afterDeen: boolean;
  afterWork: boolean;
  longSession: boolean;
  season: { re: RegExp; why: string } | null;
}

export const Growth = {
  /** Called with every chunk of watching: records the "diet", minutes per channel and the sitting length. */
  record(v: VideoItem, seconds: number): void {
    if (!v || seconds <= 0) return;
    const s = state();
    const mins = seconds / 60;
    const now = Date.now();
    themesOf(v).forEach((k) => {
      s.diet[k] = [dietVal(k) + mins, now];
    });
    if (RELIGIOUS.has(v.g)) s.relMin += mins;
    if (now - s.sess.at > 30 * 60_000) s.sess.secs = 0;
    s.sess = { at: now, secs: s.sess.secs + seconds };
    persist();
  },
  /** Finished (>70%): your level in that topic rises gradually (~6-8 videos per level). */
  finish(v: VideoItem): void {
    if (!v?.lv || !v.tp) return;
    const cur = lvlOf(v.tp);
    if (v.lv >= cur - 0.3) {
      state().lvl[v.tp] = Math.min(5, cur + 0.12 + 0.1 * Math.max(0, Math.min(1, v.lv - cur)));
      persist();
    }
  },
  /** Closed quickly: if it was well above your level, ease off a little. */
  quit(v: VideoItem): void {
    if (!v?.lv || !v.tp) return;
    const cur = lvlOf(v.tp);
    if (v.lv > cur + 0.6) {
      state().lvl[v.tp] = Math.max(1, cur - 0.15);
      persist();
    }
  },
  levels: () => ({ ...state().lvl }),

  context(lastCompleted: VideoItem | null): GrowthContext {
    const s = state();
    const lastTh = lastCompleted ? themesOf(lastCompleted) : [];
    const fresh = Date.now() - s.sess.at < 30 * 60_000;
    return {
      gaps: gaps(),
      relMin: s.relMin,
      afterDeen: !!lastCompleted && RELIGIOUS.has(lastCompleted.g),
      afterWork: !!lastCompleted && lastTh.includes("amal") && !RELIGIOUS.has(lastCompleted.g),
      longSession: fresh && s.sess.secs > 90 * 60,
      season: season(),
    };
  },

  /** Extra score for a video, plus a "why" sentence when this layer is what surfaced it, and a ladder step. */
  bonus(v: VideoItem, aff: number, ctx: GrowthContext): [number, string | null, string | null] {
    const th = themesOf(v);
    const mins = (v.d || 0) / 60;
    let b = 0;
    let why: string | null = null;
    let step: string | null = null;

    if (ctx.gaps) {
      const g = th.reduce((a, k) => a + ctx.gaps![k], 0);
      const bridge = 0.45 + 0.55 * Math.max(0, Math.min(1, aff + 0.35));
      b += 3.2 * g * bridge;
      const top = th.filter((k) => ctx.gaps![k] > 0).sort((a, c) => ctx.gaps![c] - ctx.gaps![a])[0];
      if (g > 0.08 && top) why = THEMES[top].say;
    }
    if (v.lv && v.tp) {
      const cur = lvlOf(v.tp);
      const dist = v.lv - (cur + STEP);
      b += 0.8 * Math.exp(-(dist * dist) / (2 * SPREAD * SPREAD)) - 0.4;
      if (v.lv > cur + 1.6) b -= 0.6;
      if (Math.abs(dist) < 0.5 && v.tp !== "دروس عامة") {
        step = cur < 1.6 && v.lv <= 1.8 ? "بداية سهلة في " + v.tp : "خطوتك الجاية في " + v.tp;
      }
    }
    if (v.tp === DIVISIVE_TOPIC) b -= ctx.relMin < 600 ? 0.6 : 0.15;
    if (ctx.afterDeen && (th.includes("amal") || th.includes("nafa"))) {
      b += 0.35;
      why = why || "حوّل اللي اتعلمته لعمل";
    }
    if (ctx.afterWork && th.includes("iman") && /نية|النية|الإخلاص|الاخلاص|الإتقان|الاتقان|الرزق/.test(v.t)) {
      b += 0.5;
      why = why || "شغلك بنية صالحة عبادة";
    }
    if (ctx.longSession) {
      b += mins <= 12 ? 0.3 : mins > 30 ? -0.4 : 0;
      if (th.includes("amal") || th.includes("nafa")) b += 0.25;
    }
    if (ctx.season && ctx.season.re.test(v.t)) {
      b += 0.9;
      why = ctx.season.why;
    }
    return [b, why, step];
  },
};
