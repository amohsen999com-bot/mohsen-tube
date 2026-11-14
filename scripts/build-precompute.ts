/**
 * خطوة في البناء (Vercel / Render): بتحسب النتايج التقيلة اللي واحدة لكل الزوار مرة واحدة وتخزّنها جوه قاعدة البيانات،
 * وتعمل الفهارس اللي بتسرّع "فيديوهات مشابهة"، وترجّع القاعدة لوضع يتفتح للقراية بس من غير ملفات جانبية.
 * كده أي سيرفر جديد بيصحى بيقرا النتايج جاهزة بدل ما يلف على 157 ألف فيديو.
 *   node --experimental-strip-types scripts/build-precompute.ts
 * لازم تشتغل بعد import-channels (عشان الفيديوهات الجديدة تدخل في الحساب) وقبل next build.
 */
export {};
process.env.MOHSEN_DB_READONLY = "0";
process.env.MOHSEN_LIVE_FRESH = "off";

const { getDb, writePrebuilt } = await import("../src/lib/db.ts");

const t0 = performance.now();
const keys = writePrebuilt();
const db = getDb();
db.exec("ANALYZE;");
// Back from WAL to a plain journal, so the deployed file opens read-only with no -wal/-shm files
db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE;");
db.close();
console.log(`prebuilt ${keys.length} results (${keys.join(", ")}) in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
