"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { formatDuration } from "@/lib/arabic";

const MAX = 15 * 60;
const toSec = (s: string) => String(s).trim().split(":").reduce((a, x) => a * 60 + (Number(x) || 0), 0);

/**
 * "قص جزء": المحرر بيظهر تحت الفيديو. الشريط مكبّر على الحتة اللي إنت فيها (مش الفيديو كله)، وفيه طرفين
 * بتسحبهم بالماوس أو بالصباع: وإنت بتسحب الفيديو بيروح للثانية دي فتشوف بالظبط الصورة اللي هتبدأ أو تخلص عندها.
 * لو سحبت طرف لحد آخر الشريط، الشريط بيوسع في الاتجاه ده.
 */
export function ClipEditor({
  duration,
  startAt,
  currentTime,
  seekTo,
  onPreview,
  onSave,
  onCopyLink,
  onClose,
}: {
  duration: number;
  startAt: number;
  currentTime: number;
  seekTo: (t: number) => void;
  onPreview: (s: number, e: number) => void;
  onSave: (s: number, e: number, name: string) => void;
  onCopyLink: (s: number, e: number) => void;
  onClose: () => void;
}) {
  const dmax = duration || startAt + 600;
  const [s, setS] = useState(Math.floor(startAt));
  const [e, setE] = useState(Math.min(Math.floor(startAt) + 30, dmax));
  const [win, setWin] = useState<[number, number]>([0, 0]);
  const [name, setName] = useState("");
  const [sText, setSText] = useState("");
  const [eText, setEText] = useState("");
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<"s" | "e" | null>(null);
  const lastSeekRef = useRef(0);
  const [dragging, setDragging] = useState(false);

  // نافذة الشريط: المقطع في النص وحواليه هامش واسع، وبتفضل ثابتة وإنت بتسحب
  const frame = useCallback(
    (a: number, b: number) => {
      const pad = Math.max(150, (b - a) * 1.5);
      setWin([Math.max(0, a - pad), Math.min(dmax, b + pad)]);
    },
    [dmax]
  );
  useEffect(() => frame(s, e), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setSText(formatDuration(s)), [s]);
  useEffect(() => setEText(formatDuration(e)), [e]);

  const [w0, w1] = win;
  const span = Math.max(1, w1 - w0);
  const pos = (t: number) => ((t - w0) / span) * 100;
  const fit = (a: number, b: number) => {
    if (a < w0 || b > w1) frame(a, b);
  };

  const setEnd = (which: "s" | "e", t: number, show = true) => {
    t = Math.max(0, Math.min(dmax, Math.round(t)));
    if (which === "s") {
      const v = Math.min(t, e - 1);
      setS(v);
      if (show) seekTo(v);
      return v;
    }
    const v = Math.max(t, s + 1);
    setE(v);
    if (show) seekTo(v);
    return v;
  };

  const tAt = (clientX: number) => {
    const r = trackRef.current!.getBoundingClientRect();
    return w0 + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * span;
  };

  const onPointerDown = (ev: React.PointerEvent<HTMLDivElement>) => {
    const h = (ev.target as HTMLElement).closest<HTMLElement>("[data-h]")?.dataset.h as "s" | "e" | undefined;
    const t = tAt(ev.clientX);
    const which = h || (Math.abs(t - s) < Math.abs(t - e) ? "s" : "e");
    dragRef.current = which;
    trackRef.current?.setPointerCapture(ev.pointerId);
    setDragging(true);
    setEnd(which, t);
  };
  const onPointerMove = (ev: React.PointerEvent<HTMLDivElement>) => {
    const which = dragRef.current;
    if (!which) return;
    const now = Date.now();
    const show = now - lastSeekRef.current > 120; // ما نزحمش يوتيوب بطلبات
    if (show) lastSeekRef.current = now;
    // واصل لحافة الشريط ← الشريط يوسع في الاتجاه ده بالراحة
    const r = trackRef.current!.getBoundingClientRect();
    const step = span * 0.03;
    if (ev.clientX <= r.left + 4 && w0 > 0) setWin(([a, b]) => [Math.max(0, a - step), b]);
    if (ev.clientX >= r.right - 4 && w1 < dmax) setWin(([a, b]) => [a, Math.min(dmax, b + step)]);
    setEnd(which, tAt(ev.clientX), show);
  };
  const onPointerUp = () => {
    const which = dragRef.current;
    if (!which) return;
    seekTo(which === "s" ? s : e);
    dragRef.current = null;
    setDragging(false);
  };

  const len = e - s;
  const bad = len <= 0 || len > MAX;
  const lenText = len > MAX ? "لازم يكون 15 دقيقة أو أقل" : len <= 0 ? "النهاية لازم تكون بعد البداية" : `طوله ${formatDuration(len)}`;
  const nowVisible = currentTime >= w0 && currentTime <= w1;

  return (
    <div className="clip-box">
      <div className="clip-head">
        <b>✂ قص جزء</b>
        <span className={`clip-len ${bad ? "bad" : ""}`}>{lenText}</span>
        <button type="button" aria-label="قفل" onClick={onClose}>
          ✕
        </button>
      </div>

      <div
        className={`clip-track ${dragging ? "dragging" : ""}`}
        dir="ltr"
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <span className="clip-w0">{formatDuration(w0)}</span>
        <span className="clip-w1">{formatDuration(w1)}</span>
        <i className="clip-sel" style={{ left: `${pos(s)}%`, width: `${pos(e) - pos(s)}%` }} />
        <i className="clip-now" hidden={!nowVisible} style={{ left: `${pos(currentTime)}%` }} />
        <b className="clip-h" data-h="s" title="البداية" style={{ left: `${pos(s)}%` }}>
          <em>{formatDuration(s)}</em>
        </b>
        <b className="clip-h" data-h="e" title="النهاية" style={{ left: `${pos(e)}%` }}>
          <em>{formatDuration(e)}</em>
        </b>
      </div>

      <div className="clip-ctl">
        <div className="clip-end">
          <small>البداية</small>
          <span dir="ltr">
            <button type="button" onClick={() => setEnd("s", s - 1)}>−1</button>
            <input
              value={sText}
              onChange={(ev) => setSText(ev.target.value)}
              onBlur={() => {
                const v = setEnd("s", toSec(sText));
                fit(v, e);
              }}
            />
            <button type="button" onClick={() => setEnd("s", s + 1)}>+1</button>
          </span>
          <button
            type="button"
            className="btn"
            onClick={() => {
              const v = setEnd("s", currentTime, false);
              const ne = e <= v ? Math.min(v + 30, dmax) : e;
              if (ne !== e) setE(ne);
              fit(v, ne);
            }}
          >
            من هنا
          </button>
        </div>
        <div className="clip-end">
          <small>النهاية</small>
          <span dir="ltr">
            <button type="button" onClick={() => setEnd("e", e - 1)}>−1</button>
            <input
              value={eText}
              onChange={(ev) => setEText(ev.target.value)}
              onBlur={() => {
                const v = setEnd("e", toSec(eText));
                fit(s, v);
              }}
            />
            <button type="button" onClick={() => setEnd("e", e + 1)}>+1</button>
          </span>
          <button
            type="button"
            className="btn"
            onClick={() => {
              const v = setEnd("e", currentTime, false);
              fit(s, v);
            }}
          >
            لحد هنا
          </button>
        </div>
      </div>

      <div className="clip-bar">
        <input
          className="clip-name"
          maxLength={80}
          placeholder="سمّي المقطع (اختياري)"
          value={name}
          onChange={(ev) => setName(ev.target.value)}
        />
        <button type="button" className="btn" onClick={() => onPreview(s, e)}>
          ▶ شوف المقطع
        </button>
        <button type="button" className="btn" disabled={bad} onClick={() => onCopyLink(s, e)}>
          🔗 انسخ الرابط
        </button>
        <button type="button" className="btn gold" disabled={bad} onClick={() => onSave(s, e, name)}>
          احفظ
        </button>
      </div>
    </div>
  );
}
