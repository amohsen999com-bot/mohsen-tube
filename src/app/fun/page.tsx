"use client";

import React, { useEffect, useRef, useState } from "react";
import { VideoItem } from "@/lib/types";
import { VideoCard } from "@/components/video/VideoCard";
import { ClientStore } from "@/lib/client/store";

const PAGE_SIZE = 48;

export default function FunPage() {
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [shownCount, setShownCount] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const moreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/videos?category=fun&limit=600")
      .then((r) => r.json())
      .then((data) => {
        if (!active) return;
        const list = (data.videos || []).filter((v: VideoItem) =>
          ClientStore.isAllowed(v)
        );
        setVideos(list);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const el = moreRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setShownCount((prev) => Math.min(prev + PAGE_SIZE, videos.length));
        }
      },
      { rootMargin: "800px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [videos.length]);

  if (loading) {
    return <p className="muted pad">جاري التحميل...</p>;
  }

  return (
    <div>
      <h2 className="sec">ترفيه نافع (حرف، رياضة، وقصص)</h2>
      <div className="grid">
        {videos.slice(0, shownCount).map((v) => (
          <VideoCard
            key={v.id}
            video={v}
            onHidden={(id) =>
              setVideos((prev) => prev.filter((x) => x.id !== id))
            }
          />
        ))}
      </div>
      <div ref={moreRef} style={{ height: 32 }} />
    </div>
  );
}
