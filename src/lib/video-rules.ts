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
