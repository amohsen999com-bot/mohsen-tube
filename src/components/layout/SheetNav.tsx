"use client";

/**
 * فتح فيديو زي تطبيق يوتيوب: صفحة الفيديو بتطلع من تحت لفوق كأنها لوح، فوق الصفحة اللي كنت فيها
 * (وهي بتغمق شوية)، بمنحنى يوتيوب نفسه cubic-bezier(.05, 0, 0, 1) اللي اتقاس من ملفات يوتيوب.
 * على الكمبيوتر نفس الفكرة بس أخف (طلعة قصيرة مع ظهور).
 * بيشتغل بس لما تفتح فيديو من برّه صفحة الفيديو؛ الاقتراحات جوه صفحة الفيديو ليها انتقالها الخاص.
 */
import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

type VTDocument = Document & { startViewTransition?: (cb: () => Promise<void>) => { finished: Promise<void> } };

export function SheetNav() {
  const router = useRouter();
  const pathname = usePathname();
  const landed = useRef<(() => void) | null>(null);

  // The new page is on screen: let the sheet start sliding (one frame later, so it's painted)
  useEffect(() => {
    const done = landed.current;
    if (!done) return;
    landed.current = null;
    requestAnimationFrame(() => done());
  }, [pathname]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || !url.pathname.startsWith("/watch/")) return;
      if (window.location.pathname.startsWith("/watch")) return;
      const doc = document as VTDocument;
      if (typeof doc.startViewTransition !== "function") return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      e.preventDefault();
      const root = document.documentElement;
      root.classList.add("vt-sheet");
      const vt = doc.startViewTransition(
        () =>
          new Promise<void>((resolve) => {
            // (never hold the screen if the page is slow: slide in whatever is there)
            const t = window.setTimeout(() => {
              landed.current = null;
              resolve();
            }, 700);
            landed.current = () => {
              window.clearTimeout(t);
              resolve();
            };
            router.push(url.pathname + url.search);
          })
      );
      vt.finished.finally(() => root.classList.remove("vt-sheet"));
    };
    window.addEventListener("click", onClick, true);
    return () => window.removeEventListener("click", onClick, true);
  }, [router]);

  return null;
}
