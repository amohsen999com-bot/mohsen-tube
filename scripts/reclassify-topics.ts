/**
 * يوزّع فيديوهات الكورسات على مواضيعها الحقيقية من العنوان. كل قناة متسجّلة تحت موضوع واحد،
 * فقنوات البرمجة مثلًا كان فيها شبكات وأمن وإكسل وتصميم كله تحت "برمجة".
 * بيلمس بس فيديوهات موضوعها "برمجة" أو "زراعة" (الأخيرة بتتدمج في "زراعة وتربية").
 * الاستخدام: node --experimental-strip-types scripts/reclassify-topics.ts [--dry]
 */
import { DatabaseSync } from "node:sqlite";

const RULES: Array<[string, RegExp]> = [
  ["أمن معلومات", /hack|اختراق|هكر|تهكير|هاكر|cyber|سيبراني|kali|كالي|penetration|pentest|\bctf\b|security\+|أمن المعلومات|امن المعلومات|الأمن السيبراني|ethical hacking|malware|ثغر/i],
  ["ذكاء اصطناعي", /machine learning|deep learning|تعلم الآلة|تعلم الاله|تعلم الآله|الذكاء الاصطناعي|ذكاء اصطناعي|neural network|شبكات عصبية|chatgpt|\bllm|computer vision|رؤية الحاسوب|\bnlp\b|tensorflow|pytorch|generative ai/i],
  ["شبكات", /ccna|ccnp|ccie|network\+|networking|شبكات|الشبكات|راوتر|router|mikrotik|ميكروتك|سويتش|subnet|ospf|\bvlan|cisco|سيسكو/i],
  ["تحليل بيانات", /power ?bi|data analy|تحليل البيانات|تحليل بيانات|tableau|data science|علم البيانات|pandas|data visuali/i],
  ["إكسل وأوفيس", /excel|اكسل|إكسل|الاكسل|الإكسل|microsoft word|مايكروسوفت وورد|\bوورد\b|powerpoint|بوربوينت|باوربوينت|microsoft office|اوفيس|أوفيس|\baccess\b|اكسس|أكسس|الأكسس|الاكسس/i],
  ["تصميم", /photoshop|فوتوشوب|فوتو شوب|illustrator|اليستريتور|الستريتور|figma|فيجما|ui ?\/ ?ux|تصميم جرافيك|جرافيك ديزاين|graphic design|canva|كانفا|indesign/i],
  ["مونتاج", /premiere|بريمير|after effects|افتر افكت|أفتر إفكت|مونتاج|davinci|دافنشي|final cut|فاينال كت|video editing/i],
  ["رياضيات", /رياضيات|الرياضيات|تفاضل|تكامل|calculus|جبر خطي|linear algebra|discrete math|رياضة متقطعة|احصاء|إحصاء|probability|احتمالات/i],
  ["هندسة", /autocad|اوتوكاد|أوتوكاد|revit|ريفيت|solidworks|سوليد ووركس|sap2000|etabs|ايتابس|plc|بي ال سي|matlab|ماتلاب|proteus|بروتس/i],
];

const dry = process.argv.includes("--dry");
const db = new DatabaseSync("data/mohsen.db");
const rows = db.prepare(`SELECT id, t FROM videos WHERE tp = 'برمجة'`).all() as Array<{ id: string; t: string }>;
const upd = db.prepare(`UPDATE videos SET tp = ? WHERE id = ?`);
const counts: Record<string, number> = {};
const samples: Record<string, string[]> = {};
db.exec("BEGIN");
for (const r of rows) {
  const hit = RULES.find(([, re]) => re.test(r.t));
  if (!hit) continue;
  counts[hit[0]] = (counts[hit[0]] || 0) + 1;
  (samples[hit[0]] ||= []).length < 4 && samples[hit[0]].push(r.t.slice(0, 60));
  if (!dry) upd.run(hit[0], r.id);
}
const farm = dry ? 0 : Number(db.prepare(`UPDATE videos SET tp = 'زراعة وتربية' WHERE tp = 'زراعة'`).run().changes);
if (!dry) db.prepare(`UPDATE channels SET field = 'زراعة وتربية' WHERE field = 'زراعة'`).run();
db.exec(dry ? "ROLLBACK" : "COMMIT");
console.log(dry ? "(dry run)" : "", counts, "farm merged", farm);
for (const [k, v] of Object.entries(samples)) console.log(k, "|", v.join(" ‖ "));
