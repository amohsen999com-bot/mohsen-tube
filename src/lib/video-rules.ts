/**
 * قواعد الموقع لأي فيديو جديد جاي من يوتيوب (نفس rules.py):
 * من غير Shorts ولا بث مباشر، دقيقتين على الأقل، وعناوين الأغاني والأفلام بتتشال.
 * بيستخدمها السحب الدوري (scripts/sync-new.ts) والإشعارات الفورية من يوتيوب (src/lib/live-push.ts).
 */
export const MIN_SECONDS = 120;

const RELIGIOUS = new Set(["علماء", "أنا السلفي"]);
const BAD_TITLE = /أغنية|اغنية|اغاني|أغاني|موسيقى|موسيقي|مهرجان|كليب|ريمكس|remix|music|song|#shorts|#short|بنات|البنات|للنساء|نسائية/i;
const MEDIA = new RegExp(
  "فيلم|أفلام|افلام|الأفلام|الافلام|مسلسل|مسلسلات|سينما|السينما|سينمائي|نتفليكس|نتفلكس|هوليوود|هوليود|بوليوود|" +
    "أنمي|انمي|الأنمي|ممثل|ممثلة|الممثلين|تريلر|دراما|ديزني|مارفل|" +
    "\\bmovies?\\b|(?<!thin )\\bfilms?\\b|\\bcinema\\b|netflix|hollywood|bollywood|\\banime\\b|\\bactor|\\bactress|" +
    "trailer|disney|marvel|tv series|tv shows?|\\bdrama\\b|box office|\\boscars?\\b",
  "i"
);

export function titleAllowed(title: string, group: string): boolean {
  return !!title && !BAD_TITLE.test(title) && (RELIGIOUS.has(group) || !MEDIA.test(title));
}

/** ISO 8601 duration (PT1H2M3S) to seconds. */
export function isoSeconds(iso: string): number {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || "");
  if (!m) return 0;
  return (+(m[1] || 0)) * 86400 + (+(m[2] || 0)) * 3600 + (+(m[3] || 0)) * 60 + (+(m[4] || 0));
}
