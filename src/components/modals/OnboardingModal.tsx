"use client";

import React, { useEffect, useState } from "react";
import { AlgoEngine } from "@/lib/client/algo";
import { writeLocal } from "@/lib/client/store";

const SECTIONS: Array<[string, string[]]> = [
  [
    "دينك",
    [
      "تفسير",
      "سيرة وتاريخ",
      "فقه",
      "فتاوى",
      "حديث",
      "عقيدة",
      "رقائق",
      "ردود وشبهات",
      "القرآن الكريم",
    ],
  ],
  ["تعلّم مهارة", ["ذكاء اصطناعي", "برمجة", "إنجليزي", "أمن معلومات", "طب"]],
  ["اصنعها بنفسك", ["نجارة", "اختراعات", "كهرباء وإلكترونيات"]],
  ["رياضة وبودكاست", ["رياضة", "قصص"]],
];

const WHO_OPTIONS: Array<[string, string]> = [
  ["شاب", "الشباب"],
  ["طالب علم", "طالب العلم"],
  ["مبتدئ بتعلّم", "المبتدئ في الموضوع"],
  ["متخصص في مجالي", "المتخصص"],
  ["أب أو أم", "الآباء والأمهات"],
  ["متزوج", "المتزوجين"],
  ["كبير في السن", "كبار السن"],
];

/** Picking 3+ topics gives the engine enough to start from; the meter nudges toward it without forcing. */
const GOOD_START = 3;

function ArchMark() {
  return (
    <svg className="ob-mark" viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <linearGradient id="obBg" x1="0" y1="0" x2=".35" y2="1"><stop offset="0" stopColor="#8f1438" /><stop offset=".55" stopColor="#5d0018" /><stop offset="1" stopColor="#3a000f" /></linearGradient>
        <linearGradient id="obGold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#f6e2a4" /><stop offset=".45" stopColor="#e2b54a" /><stop offset="1" stopColor="#a87412" /></linearGradient>
      </defs>
      <path d="M6 41.5V22.5C6 13.2 13.4 7.2 24 2.2c10.6 5 18 11 18 20.3v19a3.5 3.5 0 0 1-3.5 3.5h-29A3.5 3.5 0 0 1 6 41.5z" fill="url(#obBg)" />
      <path d="M7.4 41.3V22.6C7.4 14 14.3 8.6 24 3.8c9.7 4.8 16.6 10.2 16.6 18.8v18.7a2.3 2.3 0 0 1-2.3 2.3H9.7a2.3 2.3 0 0 1-2.3-2.3z" fill="none" stroke="url(#obGold)" strokeOpacity=".75" strokeWidth="1.1" />
      <path d="M19.6 20.4v13.2c0 .9 1 1.4 1.7.9l10.3-6.6c.7-.4.7-1.4 0-1.8l-10.3-6.6c-.7-.5-1.7 0-1.7.9z" fill="url(#obGold)" stroke="url(#obGold)" strokeWidth="2.2" strokeLinejoin="round" />
    </svg>
  );
}

export function OnboardingModal({ onDone }: { onDone: () => void }) {
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [selectedWho, setSelectedWho] = useState<string[]>([]);

  const toggleTopic = (tp: string) => {
    setSelectedTopics((prev) =>
      prev.includes(tp) ? prev.filter((x) => x !== tp) : [...prev, tp]
    );
  };

  const toggleWho = (val: string) => {
    setSelectedWho((prev) =>
      prev.includes(val) ? prev.filter((x) => x !== val) : [...prev, val]
    );
  };

  const skip = () => {
    writeLocal("nt_onboarded", 1);
    onDone();
  };

  const handleFinish = () => {
    if (selectedTopics.length || selectedWho.length) {
      AlgoEngine.seedInterests(selectedTopics, selectedWho);
    }
    writeLocal("nt_onboarded", 1);
    onDone();
  };

  // The page behind doesn't scroll while this is open, and Esc skips
  useEffect(() => {
    document.body.classList.add("ob-open");
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") skip();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("ob-open");
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const picked = selectedTopics.length;
  const ready = picked >= GOOD_START;

  return (
    <div className="ob-overlay" role="dialog" aria-modal="true" aria-labelledby="ob-title">
      <div className="ob-card">
        <header className="ob-head">
          <button type="button" className="ob-skip-top" onClick={skip}>
            تخطي
          </button>
          <ArchMark />
          <small className="ob-eyebrow">أهلًا بيك في محسن تيوب</small>
          <h2 id="ob-title">إيه اللي يهمك؟</h2>
          <p>اختار اللي بتحب تتعلمه وتتفرج عليه، وإحنا نظبطلك «مقترح لك» على ذوقك من أول لحظة.</p>
          <div className={`ob-meter ${ready ? "full" : ""}`} aria-live="polite">
            <span className="ob-dots">
              {Array.from({ length: GOOD_START }, (_, i) => (
                <i key={i} className={i < picked ? "on" : ""} />
              ))}
            </span>
            {ready
              ? "ممتاز، كده نقدر نبدأ صح"
              : picked === 0
                ? `اختار ${GOOD_START} حاجات أو أكتر لترشيحات أدق`
                : `فاضل ${GOOD_START - picked} ${GOOD_START - picked === 1 ? "اختيار" : "اختيارات"}`}
          </div>
        </header>

        <div className="ob-body">
          {SECTIONS.map(([title, items]) => (
            <section key={title} className="ob-sec">
              <h4>{title}</h4>
              <div className="ob-chips">
                {items.map((tp) => {
                  const on = selectedTopics.includes(tp);
                  return (
                    <button
                      key={tp}
                      type="button"
                      aria-pressed={on}
                      className={`ob-chip ${on ? "on" : ""}`}
                      onClick={() => toggleTopic(tp)}
                    >
                      {tp}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}

          <section className="ob-sec">
            <h4>
              إنت مين؟ <span>(اختياري)</span>
            </h4>
            <div className="ob-chips">
              {WHO_OPTIONS.map(([label, val]) => {
                const on = selectedWho.includes(val);
                return (
                  <button
                    key={val}
                    type="button"
                    aria-pressed={on}
                    className={`ob-chip ${on ? "on" : ""}`}
                    onClick={() => toggleWho(val)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </section>
        </div>

        <footer className="ob-foot">
          <button type="button" className="ob-skip" onClick={skip}>
            تخطي
          </button>
          <button type="button" className="ob-go" onClick={handleFinish}>
            {picked + selectedWho.length > 0 ? `ابدأ (${picked + selectedWho.length})` : "ابدأ"}
          </button>
        </footer>
      </div>
    </div>
  );
}
