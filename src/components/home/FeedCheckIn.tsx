"use client";

/**
 * "مبسوط باللي بيظهرلك؟": a short check-in inside "مقترح لك" and "ترفيه".
 * Pick as many answers as you like and/or write in your own words. The answers that change something
 * (more variety, shorter/longer, more religious lessons) apply right away on this device; everything is
 * also sent to the site owner (Supabase → feedback). Shows from the 3rd visit, at most once every 4 days,
 * and "مش دلوقتي" puts it away for 4 days.
 */
import React, { useEffect, useState } from "react";
import { AlgoEngine } from "@/lib/client/algo";
import { readLocal, writeLocal } from "@/lib/client/store";

type Page = "home" | "fun";

const COPY: Record<Page, { q: string; opts: string[] }> = {
  home: {
    q: "مبسوط باللي بيظهرلك هنا؟",
    opts: [
      "مبسوط جدًا",
      "فيه تكرار كتير",
      "بعيد عن اهتماماتي",
      "عايز فيديوهات أقصر",
      "عايز فيديوهات أطول",
      "عايز علم شرعي أكتر",
    ],
  },
  fun: {
    q: "الترفيه هنا عاجبك؟",
    opts: ["عاجبني", "فيه تكرار كتير", "عايز أنواع تانية", "مش ممتع كفاية", "عايز فيديوهات أقصر", "عايز فيديوهات أطول"],
  },
};

const GAP = 4 * 86400_000;

export function FeedCheckIn({ page }: { page: Page }) {
  const [show, setShow] = useState(false);
  const [picks, setPicks] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const key = `nt_checkin_${page}`;

  useEffect(() => {
    const s = readLocal<{ visits: number; at: number }>(key, { visits: 0, at: 0 });
    const visits = s.visits + 1;
    writeLocal(key, { ...s, visits });
    setShow(visits >= 3 && Date.now() - s.at > GAP);
  }, [key]);

  const close = () => {
    writeLocal(key, { ...readLocal<{ visits: number; at: number }>(key, { visits: 0, at: 0 }), at: Date.now() });
    setShow(false);
  };

  const send = () => {
    if (!picks.length && !text.trim()) return;
    AlgoEngine.applyFeedback(picks);
    fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page, picks, text: text.trim() }),
    }).catch(() => {});
    setSent(true);
    writeLocal(key, { ...readLocal<{ visits: number; at: number }>(key, { visits: 0, at: 0 }), at: Date.now() });
    window.setTimeout(() => setShow(false), 3200);
  };

  if (!show) return null;
  const c = COPY[page];
  const toggle = (o: string) => setPicks((p) => (p.includes(o) ? p.filter((x) => x !== o) : [...p, o]));

  return (
    <div className="checkin" role="region" aria-label="رأيك">
      {sent ? (
        <div className="ask done" role="status">
          <svg className="ask-check" viewBox="0 0 52 52" aria-hidden="true">
            <circle cx="26" cy="26" r="23" />
            <path d="M15 27l7.5 7.5L37 19" />
          </svg>
          <div>
            <b>جزاك الله خيرًا</b>
            <span>وصلنا كلامك، وترشيحاتك هتتظبط على طول.</span>
          </div>
        </div>
      ) : (
        <div className="ask">
          <div className="checkin-head">
            <div className="ask-head">
              <small className="ask-eyebrow">رأيك يفرق · اختار براحتك</small>
              <b>{c.q}</b>
            </div>
            <button type="button" className="checkin-x" onClick={close} aria-label="مش دلوقتي">
              مش دلوقتي
            </button>
          </div>
          <div className="ob-chips checkin-opts">
            {c.opts.map((o) => (
              <button
                key={o}
                type="button"
                className={`ob-chip ${picks.includes(o) ? "chosen" : ""}`}
                aria-pressed={picks.includes(o)}
                onClick={() => toggle(o)}
              >
                {o}
              </button>
            ))}
          </div>
          <textarea
            className="checkin-text"
            rows={2}
            maxLength={600}
            placeholder="قولّنا بكلامك: إيه اللي عاجبك؟ إيه اللي مضايقك؟ (اختياري)"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="button" className="btn gold checkin-send" disabled={!picks.length && !text.trim()} onClick={send}>
            ابعت
          </button>
        </div>
      )}
    </div>
  );
}
