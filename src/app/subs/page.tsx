"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { VideoItem } from "@/lib/types";
import { VideoCard } from "@/components/video/VideoCard";
import { ClientStore, subscribeStore } from "@/lib/client/store";
import { PageSkeleton } from "@/components/ui/Skeleton";

export default function SubsPage() {
  const [subs, setSubs] = useState<string[]>([]);
  const [selectedCh, setSelectedCh] = useState<string>("");
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const refresh = () => setSubs(ClientStore.getSubs());
    refresh();
    return subscribeStore(refresh);
  }, []);

  useEffect(() => {
    if (!subs.length) {
      setVideos([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch(
      `/api/videos?channels=${encodeURIComponent(subs.join("|"))}&limit=240`
    )
      .then((r) => r.json())
      .then((data) => {
        setVideos(data.videos || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [subs]);

  const visible = selectedCh
    ? videos.filter((v) => v.c === selectedCh)
    : videos;

  return (
    <div>
      <div className="lib-top">
        <h1>اشتراكاتك</h1>
      </div>

      {subs.length === 0 ? (
        <p className="muted pad">
          لسه ما اشتركتش في أي قناة. افتح أي درس واضغط «اشترك» جنب اسم الشيخ أو
          القناة.
        </p>
      ) : (
        <>
          <div className="topic-chips" style={{ marginBottom: 18 }}>
            <button
              type="button"
              className={selectedCh === "" ? "on" : ""}
              onClick={() => setSelectedCh("")}
            >
              الكل ({videos.length})
            </button>
            {subs.map((c) => (
              <button
                key={c}
                type="button"
                className={selectedCh === c ? "on" : ""}
                onClick={() => setSelectedCh(c)}
              >
                {c}
              </button>
            ))}
          </div>

          {selectedCh && (
            <div style={{ marginBottom: 16 }}>
              <Link
                className="btn"
                href={`/channel/${encodeURIComponent(selectedCh)}`}
              >
                افتح صفحة قناة {selectedCh} ←
              </Link>
            </div>
          )}

          {loading ? (
            <PageSkeleton kind="feed" />
          ) : (
            <div className="grid">
              {visible.map((v) => (
                <VideoCard key={v.id} video={v} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
