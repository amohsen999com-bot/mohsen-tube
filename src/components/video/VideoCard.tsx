"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { VideoItem } from "@/lib/types";
import { formatDuration, formatRelativeArabicDate } from "@/lib/arabic";
import { ClientStore } from "@/lib/client/store";
import { AlgoEngine, learnFromVideo } from "@/lib/client/algo";

const ICONS = {
  later: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm.5-13H11v6l5.2 3.2.8-1.3-4.5-2.7V7z",
  queue: "M3 6h12v2H3zm0 4h12v2H3zm0 4h8v2H3zm14-4v8l6-4z",
  share: "M18 16a3 3 0 0 0-2.4 1.2l-6.7-3.4a3 3 0 0 0 0-1.6l6.7-3.4A3 3 0 1 0 15 7l-6.7 3.4a3 3 0 1 0 0 3.2L15 17a3 3 0 1 0 3-1z",
  more: "M2 21h4V9H2v12zm20-11a2 2 0 0 0-2-2h-6.3l1-4.6v-.3c0-.4-.2-.8-.4-1.1L13.2 1 6.6 7.6C6.2 8 6 8.5 6 9v10a2 2 0 0 0 2 2h9c.8 0 1.5-.5 1.8-1.2l3-7.1c.1-.2.2-.5.2-.7v-2z",
  less: "M22 3h-4v12h4V3zM2 14a2 2 0 0 0 2 2h6.3l-1 4.6v.3c0 .4.2.8.4 1.1l1.1 1 6.6-6.6c.4-.4.6-.9.6-1.4V5a2 2 0 0 0-2-2H7c-.8 0-1.5.5-1.8 1.2l-3 7.1c-.1.2-.2.5-.2.7v2z",
  hide: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM4 12a8 8 0 0 1 12.9-6.3L5.7 16.9A7.9 7.9 0 0 1 4 12zm8 8a7.9 7.9 0 0 1-4.9-1.7L18.3 7.1A8 8 0 0 1 12 20z",
  channel: "M21 6h-7.6l3.3-3.3-.7-.7L12 6 8 2l-.7.7L10.6 6H3a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h18a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2zm0 14H3V8h18v12zM8 10.6 15.4 18H8z",
};
const Ico = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d={d} />
  </svg>
);
import { usePlayer } from "@/components/player/PlayerContext";

export function VideoCard({
  video,
  showWhy = false,
  onHidden,
}: {
  video: VideoItem;
  showWhy?: boolean;
  onHidden?: (id: string) => void;
}) {
  const { showToast } = usePlayer();
  const [menuOpen, setMenuOpen] = useState(false);
  const prog = ClientStore.getProgress(video.id);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const openedRef = useRef(false);

  // Feed cards: shown for 1s+ and scrolled past (or left on screen when leaving the page) without opening
  // counts as one skip, so the engine rests it and shows it less.
  useEffect(() => {
    const el = wrapRef.current;
    if (!showWhy || !el) return;
    let shownAt = 0;
    let counted = false;
    const passed = () => {
      if (shownAt && !counted && !openedRef.current && Date.now() - shownAt > 1000) {
        counted = true;
        AlgoEngine.recordSkip(video);
      }
      shownAt = 0;
    };
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) shownAt = Date.now();
        else passed();
      },
      { threshold: 0.6 }
    );
    io.observe(el);
    return () => {
      io.disconnect();
      passed();
    };
  }, [showWhy, video]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !wrapRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    window.addEventListener("scroll", () => setMenuOpen(false), { once: true, passive: true });
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menuOpen]);

  const thumbUrl = `https://i.ytimg.com/vi/${video.id}/${
    video.hd ? "maxresdefault" : "hqdefault"
  }.jpg`;

  const handleMoreClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuOpen((prev) => !prev);
  };

  return (
    <div className={`card-wrap ${menuOpen ? "menu-open" : ""}`} ref={wrapRef}>
      <Link className="card in" href={`/watch/${video.id}`} onClick={() => (openedRef.current = true)}>
        <div className="thumb">
          <img
            loading="lazy"
            className="ld"
            src={thumbUrl}
            onError={(e) => {
              const img = e.currentTarget;
              if (!img.src.includes("hqdefault.jpg")) {
                img.src = `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`;
              }
            }}
            alt=""
          />
          <span className="dur">{formatDuration(video.d)}</span>
          {prog && (
            <span className="bar">
              <i style={{ width: `${Math.max(prog[1] * 100, 4)}%` }} />
            </span>
          )}
        </div>
        <div className="card-info">
          <h3>{video.t}</h3>
          <div className="meta">
            {video.c}
            {video.dt ? ` • ${formatRelativeArabicDate(video.dt)}` : ""}
          </div>
          <button
            type="button"
            className="card-more"
            aria-label="المزيد"
            title="المزيد"
            onClick={handleMoreClick}
          >
            ⋮
          </button>
        </div>
      </Link>

      {menuOpen && (
        <div className="pop-menu card-pop" role="menu" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const added = ClientStore.toggleList("later", video.id);
              showToast(added ? "اتحفظ في شاهد لاحقًا" : "اتشال من شاهد لاحقًا");
              setMenuOpen(false);
            }}
          >
            <Ico d={ICONS.later} />
            {ClientStore.hasInList("later", video.id) ? "شيله من شاهد لاحقًا" : "شاهد لاحقًا"}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              ClientStore.addToQueue(video);
              showToast("اتضاف لقائمة الانتظار");
              setMenuOpen(false);
            }}
          >
            <Ico d={ICONS.queue} />
            شغّله بعد ده
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const url = `${window.location.origin}/watch/${encodeURIComponent(video.id)}`;
              navigator.clipboard
                ?.writeText(url)
                .then(() => showToast("اتنسخ الرابط"))
                .catch(() => showToast(url, 6000));
              setMenuOpen(false);
            }}
          >
            <Ico d={ICONS.share} />
            مشاركة
          </button>
          <hr />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              learnFromVideo(video, 1.6);
              showToast("تمام، هنوريك حاجات زي دي أكتر");
              setMenuOpen(false);
            }}
          >
            <Ico d={ICONS.more} />
            عايز أشوف حاجات زي دي أكتر
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              learnFromVideo(video, -1.2);
              showToast("تمام، هنقلّل الحاجات اللي زي دي");
              setMenuOpen(false);
            }}
          >
            <Ico d={ICONS.less} />
            عايز أشوف حاجات زي دي أقل
          </button>
          <hr />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              ClientStore.hideVideo(video.id);
              learnFromVideo(video, -0.5);
              showToast("مش هنعرض الفيديو ده تاني");
              setMenuOpen(false);
              onHidden?.(video.id);
            }}
          >
            <Ico d={ICONS.hide} />
            مش مهتم بالفيديو ده
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              ClientStore.hideChannel(video.c);
              showToast(`مش هنعرض فيديوهات ${video.c} تاني`);
              setMenuOpen(false);
              onHidden?.(video.id);
            }}
          >
            <Ico d={ICONS.channel} />
            ما تعرضليش القناة دي
          </button>
        </div>
      )}
    </div>
  );
}
