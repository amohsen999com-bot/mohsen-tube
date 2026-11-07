"use client";

/**
 * الشباك العايم على الموبايل، زي يوتيوب:
 * - بيتحرك تحت صباعك بالظبط (transform بس، متزامن مع ريفريش الشاشة، فناعم).
 * - لما تسيبه بيكمّل بنفس سرعة رميتك ويقف في أقرب ركن بحركة سوستة خفيفة.
 * - لو رميته برّه الشاشة (يمين/شمال/تحت) بيطير ويتقفل.
 * - لمسة عليه: يفتح الفيديو على طول. زرار ✕ صغير في الركن بيقفله.
 * - وهو واقف: صورة الفيديو بدل شاشة يوتيوب (زرار التشغيل الكبير واللوجو).
 * - طول ما هو ظاهر، المتصفح ما يعملش "تحديث" لما تشد الصفحة لتحت (عشان الفيديو ما يقفش).
 * - لما ييجي من صفحة الفيديو (سحب لتحت) بيصغر من مكانه لحد الركن (FLIP).
 */
import React, { useCallback, useEffect, useRef } from "react";
import { Glyph } from "@/components/ui/Glyph";

type Corner = "tl" | "tr" | "bl" | "br";
const CORNER_KEY = "nt_mini_corner";
const MARGIN = 10;
const SPRING = "transform 480ms cubic-bezier(.18,.89,.32,1.12)";

/** Where the floating window was when it came from the watch page (set by the swipe-down). */
export const miniHandoff: { from: DOMRect | null } = { from: null };

function readCorner(): Corner {
  try {
    const c = localStorage.getItem(CORNER_KEY) as Corner | null;
    if (c && ["tl", "tr", "bl", "br"].includes(c)) return c;
  } catch {}
  return "bl";
}

function bounds(w: number, h: number) {
  const vv = window.visualViewport;
  const vw = vv?.width || window.innerWidth;
  const vh = vv?.height || window.innerHeight;
  return { minX: MARGIN, maxX: vw - w - MARGIN, minY: 64, maxY: vh - h - MARGIN - 6, vw, vh };
}

function cornerPoint(c: Corner, w: number, h: number) {
  const b = bounds(w, h);
  return { x: c[1] === "l" ? b.minX : b.maxX, y: c[0] === "t" ? b.minY : b.maxY };
}

export function MiniFloat({
  dockRef,
  coverUrl,
  onExpand,
  onClose,
}: {
  dockRef: React.RefObject<HTMLDivElement | null>;
  /** Thumbnail shown over YouTube's paused screen while the video is paused */
  coverUrl: string | null;
  onExpand: () => void;
  onClose: () => void;
}) {
  const pos = useRef({ x: 0, y: 0 });
  const corner = useRef<Corner>("bl");
  const frame = useRef(0);
  const drag = useRef<{ id: number; sx: number; sy: number; ox: number; oy: number; t0: number; moved: boolean; samples: Array<[number, number, number]> } | null>(null);

  const apply = useCallback((x: number, y: number, transition: string | null) => {
    const el = dockRef.current;
    if (!el) return;
    pos.current = { x, y };
    el.style.transition = transition || "none";
    el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }, [dockRef]);

  // Arrive: from the watch page's video (shrinks into the corner), or just slide into the saved corner
  useEffect(() => {
    const el = dockRef.current;
    if (!el) return;
    corner.current = readCorner();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const p = cornerPoint(corner.current, w, h);
    const from = miniHandoff.from;
    miniHandoff.from = null;
    el.style.willChange = "transform";
    // No pull-to-refresh while the window floats: a reload would stop the video
    const root = document.documentElement;
    const prevOver = root.style.overscrollBehaviorY;
    root.style.overscrollBehaviorY = "none";
    document.body.style.overscrollBehaviorY = "none";
    el.style.transformOrigin = "0 0";
    if (from && from.width > 0) {
      apply(p.x, p.y, null);
      el.animate(
        [
          { transform: `translate3d(${from.left}px, ${from.top}px, 0) scale(${from.width / w})`, borderRadius: "0px" },
          { transform: `translate3d(${p.x}px, ${p.y}px, 0) scale(1)`, borderRadius: "12px" },
        ],
        { duration: 420, easing: "cubic-bezier(.2,.8,.2,1)" }
      );
    } else {
      apply(p.x, p.y + 40, null);
      el.style.opacity = "0";
      requestAnimationFrame(() => {
        el.style.opacity = "1";
        apply(p.x, p.y, `${SPRING}, opacity .25s ease`);
      });
    }
    const onResize = () => {
      const q = cornerPoint(corner.current, el.offsetWidth, el.offsetHeight);
      apply(q.x, q.y, SPRING);
    };
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
      cancelAnimationFrame(frame.current);
      root.style.overscrollBehaviorY = prevOver;
      document.body.style.overscrollBehaviorY = "";
      // Hand the element back clean (the watch page positions it again)
      el.style.transform = "";
      el.style.transition = "";
      el.style.opacity = "";
      el.style.willChange = "";
      el.style.transformOrigin = "";
    };
  }, [dockRef, apply]);

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: pos.current.x, oy: pos.current.y, t0: performance.now(), moved: false, samples: [[e.clientX, e.clientY, performance.now()]] };
  };

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < 6) return;
    d.moved = true;
    d.samples.push([e.clientX, e.clientY, performance.now()]);
    if (d.samples.length > 6) d.samples.shift();
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => apply(d.ox + dx, d.oy + dy, null));
  };

  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    const el = dockRef.current;
    if (!el) return;
    if (!d.moved) {
      onExpand(); // a tap opens the video
      return;
    }
    cancelAnimationFrame(frame.current);
    const [x0, y0, t0] = d.samples[0];
    const [x1, y1, t1] = d.samples[d.samples.length - 1];
    const dt = Math.max(16, t1 - t0);
    const vx = (x1 - x0) / dt; // px per ms
    const vy = (y1 - y0) / dt;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const b = bounds(w, h);
    const cur = { x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) };
    // Where the throw would carry it
    const px = cur.x + vx * 220;
    const py = cur.y + vy * 220;

    // Thrown (or pushed) out of the screen: it flies away and closes
    // (pushed half out of the screen, or a throw that's mostly sideways/down and fast enough to leave it)
    // (a mouse doesn't "throw": on a computer it closes only when dragged half out, or with ✕)
    const touch = e.pointerType !== "mouse";
    const sideways = touch && Math.abs(vx) > 0.9 && Math.abs(vx) > Math.abs(vy) * 1.4;
    const downward = touch && vy > 0.9 && vy > Math.abs(vx) * 1.4;
    // A throw only closes it when it's already near that edge (a long fast drag across the screen just moves it)
    const outLeft = cur.x < -w * 0.45 || (sideways && vx < 0 && px < -w * 0.3 && cur.x < w * 0.25);
    const outRight = cur.x > b.vw - w * 0.55 || (sideways && vx > 0 && px > b.vw - w * 0.7 && cur.x > b.vw - w * 1.25);
    const outDown = cur.y > b.vh - h * 0.5 || (downward && py > b.vh - h * 0.4 && cur.y > b.vh - h * 1.6);
    if (outLeft || outRight || outDown) {
      const speed = Math.max(0.8, Math.hypot(vx, vy));
      const tx = outDown && !outLeft && !outRight ? cur.x + vx * 120 : vx < 0 || outLeft ? -w - 30 : b.vw + 30;
      const ty = outDown && !outLeft && !outRight ? b.vh + 30 : cur.y + vy * 150;
      const dist = Math.hypot(tx - cur.x, ty - cur.y);
      const ms = Math.min(320, Math.max(160, dist / speed));
      el.style.opacity = "0";
      apply(tx, ty, `transform ${ms}ms cubic-bezier(.3,.7,.4,1), opacity ${ms}ms ease`);
      setTimeout(onClose, ms);
      return;
    }

    // Lands in the nearest corner of where the throw was heading, with a little spring
    const c: Corner = `${py + h / 2 < b.vh / 2 ? "t" : "b"}${px + w / 2 < b.vw / 2 ? "l" : "r"}` as Corner;
    corner.current = c;
    try {
      localStorage.setItem(CORNER_KEY, c);
    } catch {}
    const p = cornerPoint(c, w, h);
    apply(p.x, p.y, SPRING);
  };

  return (
    <>
      <div
        className="mini-grab"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      />
      {coverUrl && <div className="mini-cover" style={{ backgroundImage: coverUrl }} aria-hidden="true" />}
      <button
        type="button"
        className="mini-x"
        aria-label="اقفل"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <Glyph name="close" size="16px" />
      </button>
    </>
  );
}
