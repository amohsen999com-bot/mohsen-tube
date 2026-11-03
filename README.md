# محسن تيوب (Mohsen Tube — Next.js + TypeScript + SQLite FTS5)

نسخة مبنية بـ **Next.js (App Router) + TypeScript + Tailwind CSS + SQLite (FTS5)**، جاهزة بالتشغيل المباشر وبدون أي علامات أو شعارات يوتيوب على المشغّل.

## طريقة التشغيل السريعة (Windows)

1. تأكد من وجود **Node.js 22.5+** (أو Node.js 24) على الجهاز: https://nodejs.org
2. اضغط مرتين على **`start.bat`** (أو شغّل الأوامر بالأسفل).
3. افتح المتصفح على: **http://localhost:3000**

## التشغيل من الـ Terminal (ويندوز / لينكس / ماك)

```bash
npm install
npm run dev
```

للإنتاج (Production):

```bash
npm install
npm run build
npm start
```

## محتويات المشروع

- `data/mohsen.db` — قاعدة بيانات SQLite جاهزة ومفهرسة بـ FTS5 (تحتوي على 13,414 فيديو مختار، و100,589 فيديو في فهرس البحث، و246 قناة، و189 سلسلة، والتعليقات).
- `src/` — كود الواجهة والخوارزميات والسيرفر (Next.js + TypeScript).
- `scripts/seed-from-zip.ts` — سكريبت إعادة بناء قاعدة البيانات لو احتجت تحديثها مستقبلاً (`npm run seed`).
- `tests/mohsen-tube.test.ts` — اختبارات البحث والبيانات ومواقيت الصلاة (`npm test`).
