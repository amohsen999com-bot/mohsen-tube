"use client";

/**
 * شاشة فتح التطبيق، زي يوتيوب: اللوجو في النص على خلفية الموقع، بيظهر بهدوء،
 * وأول ما الموقع يجهز (ومش قبل ~0.65 ثانية من بداية الفتح) اللوجو بيكبر سنة ويختفي والصفحة تبان.
 * لو الجافاسكريبت اتأخر أو وقع، الـCSS بيخفيها لوحده بعد 4 ثواني، فعمرها ما تفضل قافلة الموقع.
 */
import { useEffect, useState } from "react";
import { LogoMark } from "./LogoMark";

const MIN_MS = 650;

export function Splash() {
  const [phase, setPhase] = useState<"on" | "out" | "gone">("on");

  useEffect(() => {
    // (time since the page started opening, so a slow start doesn't add more waiting on top)
    const wait = Math.max(0, MIN_MS - performance.now());
    const t1 = window.setTimeout(() => setPhase("out"), wait);
    const t2 = window.setTimeout(() => setPhase("gone"), wait + 420);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);

  if (phase === "gone") return null;
  return (
    <div className={`nt-splash ${phase === "out" ? "out" : ""}`} aria-hidden="true">
      <div className="sp-in">
        <LogoMark className="sp-mark" />
        <div className="sp-name">
          <b>محسن</b> <b>تيوب</b>
        </div>
      </div>
    </div>
  );
}
