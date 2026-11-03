/**
 * Arabic & Bilingual Text Normalization, Stemming, Synonym Expansion, and Typo Matching.
 * Also fixes the broken `\x08easy\x08` regex from the original `pipeline/build_site_data.py`.
 */

const DIACRITICS_RE = /[\u064B-\u0652\u0640]/g;
const ALEF_RE = /[أإآٱ]/g;
const TA_MARBUTA_RE = /ة/g;
const YA_MAQSURA_RE = /ى/g;
const WAW_HAMZA_RE = /ؤ/g;
const YA_HAMZA_RE = /ئ/g;

export function normArabic(input: string): string {
  if (!input) return "";
  return String(input)
    .toLowerCase()
    .replace(DIACRITICS_RE, "")
    .replace(ALEF_RE, "ا")
    .replace(TA_MARBUTA_RE, "ه")
    .replace(YA_MAQSURA_RE, "ي")
    .replace(WAW_HAMZA_RE, "و")
    .replace(YA_HAMZA_RE, "ي");
}

export function tokenizeWords(input: string): string[] {
  return normArabic(input)
    .split(/[^\p{L}\p{N}+#]+/u)
    .filter(Boolean);
}

const ARABIC_PREFIXES = ["وال", "بال", "فال", "كال", "لل", "ال"];
const ARABIC_SUFFIXES = ["ات", "ين", "ون", "يه", "ها"];

export function stemWord(word: string): string {
  let w = normArabic(word).trim();
  if (!w) return "";
  if (/^[a-z0-9+#]+$/.test(w)) {
    return w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;
  }
  for (const p of ARABIC_PREFIXES) {
    if (w.startsWith(p) && w.length - p.length >= 2) {
      w = w.slice(p.length);
      break;
    }
  }
  if (w.length > 4 && w.startsWith("و")) {
    w = w.slice(1);
  }
  for (const s of ARABIC_SUFFIXES) {
    if (w.length - s.length >= 3 && w.endsWith(s)) {
      w = w.slice(0, -s.length);
      break;
    }
  }
  return w;
}

export const SYN_GROUPS: string[] = [
  "بايثون python",
  "جافا java",
  "جافاسكريبت javascript js",
  "برمجه programming coding كود code",
  "اكسل excel",
  "ورد word",
  "باوربوينت powerpoint",
  "فوتوشوب photoshop",
  "اليستريتور illustrator",
  "تصميم design",
  "مونتاج editing بريمير premiere",
  "ذكاء اصطناعي ai",
  "تعلم الاله machine learning",
  "شبكات networking network",
  "امن معلومات cybersecurity security هكر hacking",
  "محاسبه accounting",
  "تسويق marketing",
  "اداره management",
  "اقتصاد economics",
  "رياضيات math mathematics",
  "فيزياء physics",
  "كيمياء chemistry",
  "طب medicine medical",
  "انجليزي english",
  "تصوير photography كاميرا camera",
  "نجاره woodworking خشب wood",
  "كهربا كهرباء electrical electricity electric",
  "الكترونيات electronics",
  "سباكه plumbing",
  "عربيه سياره car cars",
  "ميكانيكا mechanic mechanics",
  "طبخ cooking اكل food",
  "زراعه gardening farming",
  "لحام welding",
  "سباحه swimming",
  "جري running",
  "خيل horse horses فروسيه",
  "كوره football",
  "صلاه صلوات",
  "صيام صوم",
  "زكاه",
  "حج عمره",
  "قران مصحف تلاوه",
  "تفسير",
  "حديث سنه",
  "سيره نبويه",
  "صحابه صحابي",
  "توبه",
  "دعاء ادعيه",
  "رقيه",
  "زواج نكاح",
  "طلاق",
  "ميراث مواريث",
  "ربا فوائد بنوك",
  "عقيده توحيد",
];

const SYN_MAP = new Map<string, string[]>();
for (const group of SYN_GROUPS) {
  const stems = [...new Set(group.split(/\s+/).map(stemWord).filter(Boolean))];
  for (const w of stems) {
    const existing = SYN_MAP.get(w) || [];
    SYN_MAP.set(
      w,
      [...new Set([...existing, ...stems.filter((x) => x !== w)])]
    );
  }
}

export function getSynonyms(term: string): string[] {
  const s = stemWord(term);
  return SYN_MAP.get(s) || [];
}

/**
 * Returns true if `a` and `b` have Levenshtein edit distance === 1
 */
export function editDistance1(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1 || a === b) return false;
  let i = 0;
  let j = 0;
  let diff = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++diff > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return diff + (a.length - i) + (b.length - j) <= 1;
}

/**
 * Fixed difficulty level estimator (fixes the `\x08easy\x08` backspace bug in build_site_data.py)
 */
const LV_BEGIN =
  /للمبتدئين|مبتدئين|المبتدئ|من الصفر|من البداية|أساسيات|اساسيات|مقدمة|مقدمه|مدخل|تمهيد|مبسط|ببساطة|بسهولة|خطوة بخطوة|الدرس الأول|الدرس الاول|الحلقة الأولى|الحلقة الاولى|المجلس الأول|المجلس الاول|beginner|basics|basic|introduction|intro to|101|from scratch|getting started|first steps|for dummies|\beasy\b|simple|explained|crash course/i;
const LV_MID =
  /متوسط|تطبيق عملي|مشروع|عملي|intermediate|project|practical|hands-on|build a|how to build/i;
const LV_ADV =
  /متقدم|متقدمة|احتراف|احترافي|للمحترفين|خبير|تعمق|بالتفصيل|حاشية|متن|مسائل|الخلاف|أصول الفقه|اصول الفقه|مصطلح الحديث|علل|advanced|expert|deep dive|in depth|in-depth|masterclass|internals|under the hood|optimization|architecture|proof|derivation|research/i;
const LV_EPISODE =
  /(?:الدرس|الحلقة|حلقة|المجلس|مجلس|المحاضرة|محاضرة|الجزء|part|lesson|lecture|episode|ep\.?|#)\s*\(?(\d{1,3})/i;

const LV_TOPIC: Record<string, number> = {
  "القرآن الكريم": 1.0,
  رقائق: 1.3,
  فتاوى: 1.6,
  "سيرة وتاريخ": 1.6,
  "دروس عامة": 2.0,
  تفسير: 2.4,
  فقه: 2.5,
  حديث: 2.6,
  عقيدة: 2.8,
  "ردود وشبهات": 3.2,
  "أصول وعلوم": 3.8,
};

const LV_GROUP: Record<string, number> = {
  كورسات: 2.3,
  "اصنعها بنفسك": 1.8,
  رياضة: 1.5,
  بودكاست: 1.8,
};

export function estimateVideoLevel(
  title: string,
  topic: string,
  group: string,
  durationSec: number,
  seriesPositionRatio?: number
): number {
  let lv = LV_TOPIC[topic] ?? LV_GROUP[group] ?? 2.0;
  if (LV_BEGIN.test(title)) {
    lv = Math.min(lv, 1.5) - 0.3;
  }
  if (LV_MID.test(title)) {
    lv += 0.6;
  }
  if (LV_ADV.test(title)) {
    lv += 1.4;
  }
  const m = LV_EPISODE.exec(title);
  if (m && parseInt(m[1], 10) > 1) {
    lv += Math.min(0.35 * Math.log2(parseInt(m[1], 10)), 1.4);
  }
  if (seriesPositionRatio !== undefined) {
    lv += 1.2 * seriesPositionRatio;
  }
  const mins = (durationSec || 0) / 60;
  if (mins > 90) lv += 0.4;
  else if (mins < 10) lv -= 0.3;
  return Math.round(Math.min(Math.max(lv, 1), 5) * 10) / 10;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = s % 60;
  return (
    (h ? `${h}:${String(m).padStart(2, "0")}` : String(m)) +
    `:${String(x).padStart(2, "0")}`
  );
}

export function formatRelativeArabicDate(dt?: number): string {
  if (!dt) return "";
  const y = Math.floor(dt / 10000);
  const m = (Math.floor(dt / 100) % 100) - 1;
  const day = dt % 100;
  const d = new Date(y, m, day);
  const days = Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
  const say = (n: number, one: string, two: string, few: string, many: string) =>
    n === 1 ? one : n === 2 ? two : n <= 10 ? `${n} ${few}` : `${n} ${many}`;
  if (days < 1) return "النهارده";
  if (days < 7) return "منذ " + say(days, "يوم", "يومين", "أيام", "يومًا");
  if (days < 30)
    return "منذ " + say(Math.floor(days / 7), "أسبوع", "أسبوعين", "أسابيع", "أسبوعًا");
  if (days < 365)
    return "منذ " + say(Math.floor(days / 30), "شهر", "شهرين", "أشهر", "شهرًا");
  return "منذ " + say(Math.floor(days / 365), "سنة", "سنتين", "سنوات", "سنة");
}
