"use client";

/**
 * صفحة الترفيه: "متعة بتفيد".
 * الفكرة إن الترفيه نفسه يشدّ الناس للشغل والصنعة ولدينهم من غير وعظ مباشر:
 * - رفوف واضحة (بإيدك، عقل المخترع، حكايات، من الأرض للسفرة، مهارة في ربع ساعة، دقايق للقلب، رياضة).
 * - ترتيب الفيديوهات جوه كل رف = جودة + ذوق المستخدم + جديد + لمسة تتغير كل يوم، ومن غير تكرار نفس القناة.
 * - ترتيب الرفوف بيتبع ذوقك، بس الصنعة والحكايات دايمًا فوق، والرياضة عمرها ما تيجي في الأول.
 * - تحت الرفوف "كمّل اتفرج" بتوزيع ثابت: أغلبه صنعة ومهارة وحكايات، والرياضة نصيبها صغير.
 */
import { VideoItem } from "@/lib/types";
import { getVideoAffinity, isResting, getSkips } from "@/lib/client/algo";
import { ClientStore } from "@/lib/client/store";

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
    match: (v) => ["نجارة", "ورشة ومعادن", "بناء وتشطيب", "صيانة وسباكة", "ميكانيكا سيارات"].includes(v.tp),
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
    match: (v) => ["زراعة", "طبخ", "بدائي وبقاء"].includes(v.tp),
  },
  {
    key: "heart",
    title: "دقايق للقلب",
    hook: "كلام قصير يرجّعك لربنا",
    base: 0.78,
    match: (v) => DEEN_GROUPS.has(v.g) && v.tp === "رقائق",
  },
  {
    key: "sport",
    title: "رياضة",
    hook: "ملخصات سريعة، من غير ما تضيّع يومك",
    base: 0.3,
    match: (v) => v.g === "رياضة",
  },
];

const SHELF_SIZE = 14;
const PER_CHANNEL = 2;
/** توزيع "كمّل اتفرج": ١٠ خانات تتكرر، الرياضة خانة واحدة بس */
const MIX_PATTERN = ["hands", "stories", "inventor", "skills", "hands", "heart", "land", "stories", "inventor", "sport"];

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

export function funScore(v: VideoItem, day: string): number {
  let score = 0.9 * quality(v) + 1.3 * getVideoAffinity(v) + 0.25 * freshness(v) + 0.18 * hash01(v.id + day);
  const progress = ClientStore.getProgress(v.id);
  if (progress && progress[1] >= 0.85) score -= 1.5;
  const [skips] = getSkips(v.id);
  score -= 0.25 * Math.min(skips, 4);
  return score;
}

function pickDiverse(list: VideoItem[], take: number, used: Set<string>, perChannelMax = PER_CHANNEL): VideoItem[] {
  const perChannel = new Map<string, number>();
  const out: VideoItem[] = [];
  for (const v of list) {
    if (out.length >= take) break;
    if (used.has(v.id)) continue;
    const n = perChannel.get(v.c) || 0;
    if (n >= perChannelMax) continue;
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

export function buildFunLayout(pool: VideoItem[], now = new Date()): FunLayout {
  const day = now.toISOString().slice(0, 10);
  const allowed = pool.filter((v) => ClientStore.isAllowed(v) && !isResting(v.id));
  const scored = new Map<string, number>();
  for (const v of allowed) scored.set(v.id, funScore(v, day));
  const byScore = (a: VideoItem, b: VideoItem) => (scored.get(b.id) || 0) - (scored.get(a.id) || 0);

  const buckets = new Map<string, VideoItem[]>();
  for (const def of SHELVES) buckets.set(def.key, allowed.filter(def.match).sort(byScore));

  const used = new Set<string>();

  // "مختارات النهارده": أحسن فيديو من كل رف (من غير رياضة) عشان أول شاشة تبان متنوعة
  const picks: VideoItem[] = [];
  for (const def of SHELVES) {
    if (def.key === "sport") continue;
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
  // الصنعة والحكايات أول رفين دايمًا، والرياضة ما تطلعش قبل الرف الرابع
  const pinned = ["hands", "stories"];
  const order = [
    ...pinned.map((k) => ranked.find((r) => r.def.key === k)!),
    ...ranked.filter((r) => !pinned.includes(r.def.key)),
  ];
  const sportAt = order.findIndex((r) => r.def.key === "sport");
  if (sportAt > -1 && sportAt < 4) {
    const [sport] = order.splice(sportAt, 1);
    order.splice(Math.min(4, order.length), 0, sport);
  }

  const shelves: FunShelf[] = [];
  for (const { def } of order) {
    // الملخصات الرياضية كلها من قناة أو اتنين، فمفيش سقف للقناة هنا، والرف نفسه صغير
    const isSport = def.key === "sport";
    const videos = pickDiverse(buckets.get(def.key) || [], isSport ? 8 : SHELF_SIZE, used, isSport ? 8 : PER_CHANNEL);
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

  return { picks, shelves, mix };
}
