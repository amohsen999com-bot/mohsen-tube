"use client";

import React, { useEffect, useState } from "react";
import { AlgoEngine } from "@/lib/client/algo";
import { writeLocal } from "@/lib/client/store";
import { LogoMark } from "@/components/layout/LogoMark";

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
  ["تعلّم مهارة", ["ذكاء اصطناعي", "برمجة", "إنجليزي", "أمن معلومات", "طب", "تطوير الذات"]],
  ["مذاكرة", ["كيمياء", "فيزياء", "أحياء", "لغة عربية"]],
  ["اصنعها بنفسك", ["نجارة", "اختراعات", "كهرباء وإلكترونيات"]],
  ["حكايات", ["قصص"]],
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
          <LogoMark className="ob-mark" />
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
