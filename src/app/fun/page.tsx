"use client";

import React, { useEffect, useRef, useState } from "react";
import { VideoItem } from "@/lib/types";
import { VideoCard } from "@/components/video/VideoCard";
import { buildFunLayout, FunLayout } from "@/lib/client/fun";

const MIX_PAGE = 24;

function Shelf({ title, hook, videos, onHidden }: { title: string; hook: string; videos: VideoItem[]; onHidden: (id: string) => void }) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ prev: false, next: true });

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const paint = () => {
      const x = Math.abs(row.scrollLeft);
      const max = row.scrollWidth - row.clientWidth;
      setEdges({ prev: x > 4, next: x < max - 4 });
    };
    paint();
    row.addEventListener("scroll", paint, { passive: true });
    window.addEventListener("resize", paint);
    return () => {
      row.removeEventListener("scroll", paint);
      window.removeEventListener("resize", paint);
    };
  }, [videos.length]);

  // RTL: "اللي بعده" يعني نروح ناحية الشمال
  const scroll = (dir: 1 | -1) => {
    const row = rowRef.current;
    if (row) row.scrollBy({ left: -dir * row.clientWidth * 0.8, behavior: "smooth" });
  };

  return (
    <section className="shelf">
      <header className="shelf-head">
        <div>
          <h2 className="shelf-title">{title}</h2>
          <p className="shelf-hook">{hook}</p>
        </div>
        <div className="shelf-nav">
          <button type="button" aria-label="اللي قبل" disabled={!edges.prev} onClick={() => scroll(-1)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
          </button>
          <button type="button" aria-label="اللي بعده" disabled={!edges.next} onClick={() => scroll(1)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
          </button>
        </div>
      </header>
      <div className="shelf-row" ref={rowRef}>
        {videos.map((v) => (
          <div className="shelf-cell" key={v.id}>
            <VideoCard video={v} onHidden={onHidden} />
          </div>
        ))}
      </div>
    </section>
  );
}

export default function FunPage() {
  const [layout, setLayout] = useState<FunLayout | null>(null);
  const [shownMix, setShownMix] = useState(MIX_PAGE);
  const moreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/videos?category=fun&limit=1500")
      .then((r) => r.json())
      .then((data) => {
        if (active) setLayout(buildFunLayout(data.videos || []));
      })
      .catch(() => {
        if (active) setLayout({ picks: [], shelves: [], mix: [] });
      });
    return () => {
      active = false;
    };
  }, []);

  const mixLength = layout?.mix.length || 0;
  useEffect(() => {
    const el = moreRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) setShownMix((prev) => Math.min(prev + MIX_PAGE, mixLength));
      },
      { rootMargin: "800px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [mixLength]);

  if (!layout) {
    return <p className="muted pad">جاري التحميل...</p>;
  }

  const hide = (id: string) =>
    setLayout((prev) =>
      prev && {
        picks: prev.picks.filter((v) => v.id !== id),
        shelves: prev.shelves.map((s) => ({ ...s, videos: s.videos.filter((v) => v.id !== id) })),
        mix: prev.mix.filter((v) => v.id !== id),
      }
    );

  return (
    <div className="fun">
      {layout.picks.length > 0 && (
        <section className="shelf">
          <header className="shelf-head">
            <div>
              <h2 className="shelf-title">مختارات النهارده</h2>
              <p className="shelf-hook">من كل لون حاجة، على ذوقك</p>
            </div>
          </header>
          <div className="grid">
            {layout.picks.map((v) => (
              <VideoCard key={v.id} video={v} onHidden={hide} />
            ))}
          </div>
        </section>
      )}

      {layout.shelves.map((s) => (
        <Shelf key={s.key} title={s.title} hook={s.hook} videos={s.videos} onHidden={hide} />
      ))}

      {layout.mix.length > 0 && (
        <section className="shelf">
          <header className="shelf-head">
            <div>
              <h2 className="shelf-title">كمّل اتفرج</h2>
              <p className="shelf-hook">خليط متوازن: صنعة وحكايات ومهارات</p>
            </div>
          </header>
          <div className="grid">
            {layout.mix.slice(0, shownMix).map((v) => (
              <VideoCard key={v.id} video={v} onHidden={hide} />
            ))}
          </div>
          <div ref={moreRef} style={{ height: 32 }} />
        </section>
      )}
    </div>
  );
}
