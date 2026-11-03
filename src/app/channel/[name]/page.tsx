"use client";

import React, { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChannelInfo, SeriesItem, VideoItem } from "@/lib/types";
import { VideoCard } from "@/components/video/VideoCard";
import { ClientStore } from "@/lib/client/store";
import { usePlayer } from "@/components/player/PlayerContext";
import { rememberSeries } from "@/lib/client/related";

export default function ChannelPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = use(params);
  const channelName = decodeURIComponent(name);
  const { showToast } = usePlayer();

  const [channel, setChannel] = useState<ChannelInfo | null>(null);
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [series, setSeries] = useState<SeriesItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"videos" | "series">("videos");
  const [selectedTopic, setSelectedTopic] = useState<string>("");
  const [isSubscribed, setIsSubscribed] = useState(false);

  useEffect(() => {
    setIsSubscribed(ClientStore.isSubscribed(channelName));
    setLoading(true);
    fetch(`/api/channels/${encodeURIComponent(channelName)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        setChannel(data.channel);
        setVideos(data.videos || []);
        setSeries(data.series || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [channelName]);

  const topics = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const v of videos) {
      if (v.tp) counts[v.tp] = (counts[v.tp] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([tp]) => tp);
  }, [videos]);

  const visibleVideos = useMemo(() => {
    if (!selectedTopic) return videos;
    return videos.filter((v) => v.tp === selectedTopic);
  }, [videos, selectedTopic]);

  if (loading) {
    return <p className="muted pad">جاري التحميل...</p>;
  }

  if (!videos.length && !channel) {
    return <p className="pad">القناة غير موجودة.</p>;
  }

  return (
    <div className="channel">
      <div className="ch-head">
        <span className="avatar big">{channelName.slice(0, 1)}</span>
        <div className="ch-meta">
          <h1>{channelName}</h1>
          <p className="muted">
            {channel?.group || "قناة"} • {videos.length} فيديو
          </p>
          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
            <button
              type="button"
              className={`btn subscribe ${isSubscribed ? "on" : ""}`}
              onClick={() => {
                const on = ClientStore.toggleSub(channelName);
                setIsSubscribed(on);
                showToast(on ? `اشتركت في ${channelName}` : "ألغيت الاشتراك");
              }}
            >
              {isSubscribed ? "مشترك ✓" : "اشترك"}
            </button>
          </div>
        </div>
      </div>

      {series.length > 0 && (
        <div className="topic-chips" style={{ marginBottom: 16 }}>
          <button
            type="button"
            className={tab === "videos" ? "on" : ""}
            onClick={() => setTab("videos")}
          >
            الفيديوهات ({videos.length})
          </button>
          <button
            type="button"
            className={tab === "series" ? "on" : ""}
            onClick={() => setTab("series")}
          >
            السلاسل ({series.length})
          </button>
        </div>
      )}

      {tab === "videos" ? (
        <>
          {topics.length > 1 && (
            <div className="topic-chips" style={{ marginBottom: 16 }}>
              <button
                type="button"
                className={selectedTopic === "" ? "on" : ""}
                onClick={() => setSelectedTopic("")}
              >
                الكل
              </button>
              {topics.map((tp) => (
                <button
                  key={tp}
                  type="button"
                  className={selectedTopic === tp ? "on" : ""}
                  onClick={() => setSelectedTopic(tp)}
                >
                  {tp}
                </button>
              ))}
            </div>
          )}

          <div className="grid">
            {visibleVideos.map((v) => (
              <VideoCard key={v.id} video={v} />
            ))}
          </div>
        </>
      ) : (
        <div className="ch-series">
          {series.map((s) => (
            <div key={s.id} className="series">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <b>{s.t}</b>
                <span className="muted">{s.v.length} حلقة</span>
              </div>
              {s.v[0] && (
                <div style={{ marginTop: 10 }}>
                  <Link className="btn gold" href={`/watch/${s.v[0]}`} onClick={() => rememberSeries(s.id)}>
                    ▶ ابدأ السلسلة
                  </Link>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
