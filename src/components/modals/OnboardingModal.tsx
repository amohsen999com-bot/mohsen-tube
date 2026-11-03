"use client";

import React, { useState } from "react";
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

  const handleFinish = () => {
    if (selectedTopics.length || selectedWho.length) {
      AlgoEngine.seedInterests(selectedTopics, selectedWho);
    }
    writeLocal("nt_onboarded", 1);
    onDone();
  };

  return (
    <div className="modal">
      <div className="modal-box ob-box">
        <h2>إيه اللي يهمك؟</h2>
        <p className="muted">
          اختار اللي بتحب تشوفه عشان نظبطلك «مقترح لك» من أول لحظة.
        </p>

        {SECTIONS.map(([title, items]) => (
          <div key={title} className="ob-sec">
            <h4>{title}</h4>
            <div className="ob-chips">
              {items.map((tp) => (
                <button
                  key={tp}
                  type="button"
                  className={`ob-chip ${selectedTopics.includes(tp) ? "on" : ""}`}
                  onClick={() => toggleTopic(tp)}
                >
                  {tp}
                </button>
              ))}
            </div>
          </div>
        ))}

        <div className="ob-sec">
          <h4>إنت مين؟ (اختياري)</h4>
          <div className="ob-chips">
            {WHO_OPTIONS.map(([label, val]) => (
              <button
                key={val}
                type="button"
                className={`ob-chip ${selectedWho.includes(val) ? "on" : ""}`}
                onClick={() => toggleWho(val)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="modal-bar">
          <button type="button" className="btn gold" onClick={handleFinish}>
            ابدأ ({selectedTopics.length + selectedWho.length})
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              writeLocal("nt_onboarded", 1);
              onDone();
            }}
          >
            تخطي
          </button>
        </div>
      </div>
    </div>
  );
}
