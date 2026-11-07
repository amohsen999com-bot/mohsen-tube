"use client";

/**
 * صفحة الترفيه: "متعة بتفيد".
 * الفكرة إن الترفيه نفسه يشدّ الناس للشغل والصنعة ولدينهم من غير وعظ مباشر:
 * - رفوف واضحة (بإيدك، عقل المخترع، حكايات، من الأرض للسفرة، مهارة في ربع ساعة، دقايق للقلب).
 * - كل زيارة خليط جديد: السيرفر بيسحب من مرشحين كتير، والترتيب فيه عشوائية محسوبة،
 *   واللي اتعرض عليك قريب ومافتحتوش بينزل لتحت، والجديد اللي لسه نازل بيطلع فوق.
 * - ترتيب الفيديوهات جوه كل رف = جودة + ذوق المستخدم + جديد + تغيير كل زيارة، ومن غير تكرار نفس القناة.
 * - ترتيب الرفوف بيتبع ذوقك، بس الصنعة والحكايات دايمًا فوق.
 * - تحت الرفوف "كمّل اتفرج" بتوزيع ثابت: صنعة ومهارة وحكايات وقلب.
 */
import type { VideoItem } from "../types.ts";
import { getVideoAffinity, isResting, getSkips, freshBoost } from "./algo.ts";
import { ClientStore, readLocal, writeLocal } from "./store.ts";

export interface FunShelf {
  key: string;
  title: string;
  hook: string;
  videos: VideoItem[];
}

interface ShelfDef {
  key: string;
  title: string;
  hook: string;
  /** أولوية ثابتة: الأعلى بيطلع فوق لو الذوق متساوي */
  base: number;
  match: (v: VideoItem) => boolean;
}

const DEEN_GROUPS = new Set(["علماء", "أنا السلفي"]);

const SHELVES: ShelfDef[] = [
  {
    key: "hands",
    title: "بإيدك",
    hook: "خشب وحديد وبنا… حاجات تتعمل بجد",
    base: 1.0,
    match: (v) => ["نجارة", "ورشة ومعادن", "بناء وتشطيب", "صيانة وسباكة", "ميكانيكا سيارات", "ترميم"].includes(v.tp),
  },
  {
    key: "stories",
    title: "حكايات تشدّك",
    hook: "قصص من السيرة والتاريخ والحياة، في دقايق",
    base: 0.95,
    match: (v) => v.g === "بودكاست" || (DEEN_GROUPS.has(v.g) && v.tp === "سيرة وتاريخ"),
  },
  {
    key: "inventor",
    title: "عقل المخترع",
    hook: "أفكار ذكية وكهربا وإلكترونيات",
    base: 0.85,
    match: (v) => ["اختراعات", "كهرباء وإلكترونيات"].includes(v.tp),
  },
  {
    key: "skills",
    title: "مهارة في ربع ساعة",
    hook: "اتعلم حاجة تنفعك قبل ما الشاي يبرد",
    base: 0.8,
    match: (v) => v.g === "كورسات",
  },
  {
    key: "land",
    title: "من الأرض للسفرة",
    hook: "زراعة وطبخ ومهارات البقاء",
    base: 0.75,
    match: (v) => ["زراعة", "زراعة وتربية", "طبخ", "بدائي وبقاء"].includes(v.tp),
  },
  {
    key: "heart",
    title: "دقايق للقلب",
    hook: "كلام قصير يرجّعك لربنا",
    base: 0.78,
    match: (v) => DEEN_GROUPS.has(v.g) && v.tp === "رقائق",
  },
];

const SHELF_SIZE = 14;
const PER_CHANNEL = 2;
/** توزيع "كمّل اتفرج": ١٠ خانات تتكرر، الصنعة والحكايات ليهم النصيب الأكبر */
const MIX_PATTERN = ["hands", "stories", "inventor", "skills", "hands", "heart", "land", "stories", "inventor", "skills"];

function hash01(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

function quality(v: VideoItem): number {
  return 0.5 * (v.s ?? v.r ?? 0.4) + 0.3 * (v.q ?? 0.4) + 0.2 * (v.hd ? 1 : 0);
}

function freshness(v: VideoItem): number {
  if (!v.dt) return 0;
  const y = Math.floor(v.dt / 10000);
  return Math.max(0, Math.min(1, (y - 2018) / 8));
}

/** One seed per visit: a new mix each time you open ترفيه, the same mix if you come back within 20 minutes. */
export function funVisitSeed(now = Date.now()): string {
  try {
    const raw = window.sessionStorage.getItem("nt_fun_seed");
    if (raw) {
      const [seed, at] = raw.split("|");
      if (now - Number(at) < 20 * 60_000) return seed;
    }
    const seed = Math.random().toString(36).slice(2, 10);
    window.sessionStorage.setItem("nt_fun_seed", seed + "|" + now);
    return seed;
  } catch {
    return String(Math.floor(now / 3600_000));
  }
}

const SEEN_KEY = "nt_fun_seen";
const SEEN_HALF = 2 * 86400_000;

/** How strongly you've already been shown a video here (each showing counts 1, half of it fades every 2 days). */
function seenWeight(seen: Record<string, [number, number]>, id: string, now: number): number {
  const e = seen[id];
  return e ? e[0] * Math.pow(0.5, (now - e[1]) / SEEN_HALF) : 0;
}

/** Remember what was on screen this visit, so the next visit shows other things. */
export function rememberShown(ids: string[], now = Date.now()): void {
  const seen = readLocal<Record<string, [number, number]>>(SEEN_KEY, {});
  for (const id of ids) seen[id] = [seenWeight(seen, id, now) + 1, now];
  const keys = Object.keys(seen);
  if (keys.length > 1500) {
    keys.sort((a, b) => seen[a][1] - seen[b][1]).slice(0, keys.length - 1500).forEach((k) => delete seen[k]);
  }
  writeLocal(SEEN_KEY, seen);
}

export function funScore(v: VideoItem, day: string, seen: Record<string, [number, number]> = {}, now = Date.now()): number {
  const aff = getVideoAffinity(v);
  let score =
    0.9 * quality(v) + 1.3 * aff + 0.25 * freshness(v) + 0.55 * hash01(v.id + day) +
    0.8 * freshBoost(v, aff, now) - 0.45 * Math.min(seenWeight(seen, v.id, now), 4);
  const progress = ClientStore.getProgress(v.id);
  if (progress && progress[1] >= 0.85) score -= 1.5;
  const [skips] = getSkips(v.id);
  score -= 0.25 * Math.min(skips, 4);
  return score;
}

function pickDiverse(list: VideoItem[], take: number, used: Set<string>): VideoItem[] {
  const perChannel = new Map<string, number>();
  const out: VideoItem[] = [];
  for (const v of list) {
    if (out.length >= take) break;
    if (used.has(v.id)) continue;
    const n = perChannel.get(v.c) || 0;
    if (n >= PER_CHANNEL) continue;
    perChannel.set(v.c, n + 1);
    out.push(v);
  }
  out.forEach((v) => used.add(v.id));
  return out;
}

export interface FunLayout {
  picks: VideoItem[];
  shelves: FunShelf[];
  mix: VideoItem[];
}

export function buildFunLayout(pool: VideoItem[], now = new Date(), seed = ""): FunLayout {
  const day = now.toISOString().slice(0, 10) + seed;
  const seen = readLocal<Record<string, [number, number]>>(SEEN_KEY, {});
  const allowed = pool.filter((v) => ClientStore.isAllowed(v) && !isResting(v.id));
  const scored = new Map<string, number>();
  for (const v of allowed) scored.set(v.id, funScore(v, day, seen, now.getTime()));
  const byScore = (a: VideoItem, b: VideoItem) => (scored.get(b.id) || 0) - (scored.get(a.id) || 0);

  const buckets = new Map<string, VideoItem[]>();
  for (const def of SHELVES) buckets.set(def.key, allowed.filter(def.match).sort(byScore));

  const used = new Set<string>();

  // "مختارات النهارده": أحسن فيديو من كل رف عشان أول شاشة تبان متنوعة
  const picks: VideoItem[] = [];
  for (const def of SHELVES) {
    const top = pickDiverse(buckets.get(def.key) || [], 1, used);
    picks.push(...top);
  }
  picks.sort(byScore);

  // ترتيب الرفوف: الأولوية الثابتة + متوسط ذوق المستخدم في أحسن ٥
  const ranked = SHELVES.map((def) => {
    const top = (buckets.get(def.key) || []).slice(0, 5);
    const taste = top.length ? top.reduce((a, v) => a + getVideoAffinity(v), 0) / top.length : 0;
    return { def, rank: def.base + 0.6 * taste };
  }).sort((a, b) => b.rank - a.rank);
  // الصنعة والحكايات أول رفين دايمًا
  const pinned = ["hands", "stories"];
  const order = [
    ...pinned.map((k) => ranked.find((r) => r.def.key === k)!),
    ...ranked.filter((r) => !pinned.includes(r.def.key)),
  ];

  const shelves: FunShelf[] = [];
  for (const { def } of order) {
    const videos = pickDiverse(buckets.get(def.key) || [], SHELF_SIZE, used);
    if (videos.length >= 4) shelves.push({ key: def.key, title: def.title, hook: def.hook, videos });
  }

  // "كمّل اتفرج": الباقي بالتوزيع الثابت، كل خانة بتاخد أحسن فيديو متبقّي من نوعها
  const rest = new Map<string, VideoItem[]>();
  for (const [k, list] of buckets) rest.set(k, list.filter((v) => !used.has(v.id)));
  const mix: VideoItem[] = [];
  let dry = 0;
  for (let i = 0; dry < MIX_PATTERN.length; i++) {
    const list = rest.get(MIX_PATTERN[i % MIX_PATTERN.length]) || [];
    const next = list.shift();
    if (!next || used.has(next.id)) {
      dry = next ? 0 : dry + 1;
      continue;
    }
    dry = 0;
    used.add(next.id);
    mix.push(next);
  }

  // What reached the screen: the picks, the first 6 of each shelf, the first 12 of the mix
  rememberShown([...picks, ...shelves.flatMap((s) => s.videos.slice(0, 6)), ...mix.slice(0, 12)].map((v) => v.id), now.getTime());
  return { picks, shelves, mix };
}
