"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { VideoItem } from "@/lib/types";
import { formatDuration, formatRelativeArabicDate } from "@/lib/arabic";
import { ClientStore } from "@/lib/client/store";
import { AlgoEngine, getWhyLabel } from "@/lib/client/algo";
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

  const thumbUrl = `https://i.ytimg.com/vi/${video.id}/${
    video.hd ? "maxresdefault" : "hqdefault"
  }.jpg`;

  const handleMoreClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuOpen((prev) => !prev);
  };

  return (
    <div className="card-wrap" ref={wrapRef} onMouseLeave={() => setMenuOpen(false)}>
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
          {showWhy && <div className="card-why">{getWhyLabel(video)}</div>}
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
        <div className="card-menu" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => {
              const added = ClientStore.toggleList("later", video.id);
              showToast(added ? "اتحفظ في شاهد لاحقًا" : "اتشال من شاهد لاحقًا");
              setMenuOpen(false);
            }}
          >
            {ClientStore.hasInList("later", video.id)
              ? "✓ في شاهد لاحقًا"
              : "شاهد لاحقًا"}
          </button>
          <button
            type="button"
            onClick={() => {
              ClientStore.addToQueue(video);
              showToast("اتضاف لقائمة الانتظار");
              setMenuOpen(false);
            }}
          >
            شغّله بعد ده (قائمة الانتظار)
          </button>
          <button
            type="button"
            onClick={() => {
              ClientStore.hideVideo(video.id);
              showToast("مش هنعرض الفيديو ده تاني");
              setMenuOpen(false);
              onHidden?.(video.id);
            }}
          >
            مش مهتم بالفيديو ده
          </button>
          <button
            type="button"
            onClick={() => {
              ClientStore.hideChannel(video.c);
              showToast(`مش هنعرض فيديوهات ${video.c} تاني`);
              setMenuOpen(false);
              onHidden?.(video.id);
            }}
          >
            ما تعرضليش القناة دي
          </button>
        </div>
      )}
    </div>
  );
}
