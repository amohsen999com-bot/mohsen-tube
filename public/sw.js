// محسن تيوب: الحد الأدنى اللي المتصفح محتاجه عشان يعرض "تثبيت التطبيق".
// مش بنخزّن حاجة: كل طلب بيروح للإنترنت عادي، فالموقع دايمًا آخر نسخة.
// لو النت فاصل وفتحت صفحة، بتظهر رسالة بسيطة بدل صفحة الخطأ.
const OFFLINE =
  '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
  '<body dir="rtl" style="background:#19171b;color:#eee;font-family:sans-serif;text-align:center;padding:30vh 20px">' +
  "<h2>مفيش إنترنت</h2><p>اتأكد من الاتصال وارجع تاني.</p></body>";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return;
  e.respondWith(
    fetch(e.request).catch(() => new Response(OFFLINE, { headers: { "Content-Type": "text/html; charset=utf-8" } }))
  );
});
