"use client";

import React, { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChannelInfo, SeriesItem, VideoItem } from "@/lib/types";
import { VideoCard } from "@/components/video/VideoCard";
import { ClientStore } from "@/lib/client/store";
import { usePlayer } from "@/components/player/PlayerContext";
import { rememberSeries } from "@/lib/client/related";
import { formatDuration } from "@/lib/arabic";
import { PageSkeleton } from "@/components/ui/Skeleton";

type Sort = "new" | "best" | "old";
const SORTS: Array<[Sort, string]> = [
  ["new", "الأحدث"],
  ["best", "الأنفع"],
  ["old", "الأقدم"],
];

const thumb = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

/** Total length like YouTube's playlist cards */
function totalLength(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h >= 1) return m ? `${h} س ${m} د` : `${h} ساعة`;
  return `${Math.max(1, m)} دقيقة`;
}

/**
 * صفحة القناة بترتيب يوتيوب: راس القناة (صورة، اسم، عدد الفيديوهات، اشترك)، وتحتها تبويبين بس:
 * "الفيديوهات" (الأحدث / الأنفع / الأقدم) و"قوائم التشغيل" (كروت بغلاف وعدد الحلقات، ولما تفتح واحدة
 * بتظهر حلقاتها بالترتيب ومعاها "تشغيل الكل").
 */
export default function ChannelPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = use(params);
  const channelName = decodeURIComponent(name);
  const { showToast } = usePlayer();

  const [channel, setChannel] = useState<ChannelInfo | null>(null);
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [series, setSeries] = useState<SeriesItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"videos" | "lists">("videos");
  const [sort, setSort] = useState<Sort>("new");
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [openList, setOpenList] = useState<SeriesItem | null>(null);
  const [listVideos, setListVideos] = useState<VideoItem[] | null>(null);

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

  // Opening a playlist: its episodes in their real order (the API keeps the order of the ids it gets)
  useEffect(() => {
    if (!openList) return;
    setListVideos(null);
    const ids = openList.v.slice(0, 200);
    fetch(`/api/videos?ids=${encodeURIComponent(ids.join(","))}`)
      .then((r) => r.json())
      .then((d) => setListVideos((d.videos || []).filter((v: VideoItem) => ClientStore.isAllowed(v))))
      .catch(() => setListVideos([]));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [openList]);

  const sorted = useMemo(() => {
    const list = videos.filter((v) => ClientStore.isAllowed(v));
    if (sort === "best") return list;
    const date = (v: VideoItem) => v.dt || 0;
    return [...list].sort((a, b) => (sort === "new" ? date(b) - date(a) : date(a) - date(b)));
  }, [videos, sort]);

  if (loading) return <PageSkeleton kind="channel" />;
  if (!videos.length && !channel) return <p className="pad">القناة غير موجودة.</p>;

  return (
    <div className="channel ch-yt">
      <header className="ch-top">
        <span className="ch-avatar">{channelName.slice(0, 1)}</span>
        <div className="ch-info">
          <h1>{channelName}</h1>
          <p className="muted">
            {channel?.group || "قناة"} • {videos.length} فيديو
            {series.length ? ` • ${series.length} قائمة تشغيل` : ""}
          </p>
        </div>
        <button
          type="button"
          className={`ch-sub ${isSubscribed ? "on" : ""}`}
          onClick={() => {
            const on = ClientStore.toggleSub(channelName);
            setIsSubscribed(on);
            showToast(on ? `اشتركت في ${channelName}` : "ألغيت الاشتراك");
          }}
        >
          {isSubscribed ? "✓ تم الاشتراك" : "اشترك"}
        </button>
      </header>

      <nav className="ch-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "videos"}
          className={tab === "videos" ? "on" : ""}
          onClick={() => {
            setTab("videos");
            setOpenList(null);
          }}
        >
          الفيديوهات
        </button>
        {series.length > 0 && (
          <button
            type="button"
            role="tab"
            aria-selected={tab === "lists"}
            className={tab === "lists" ? "on" : ""}
            onClick={() => {
              setTab("lists");
              setOpenList(null);
            }}
          >
            قوائم التشغيل
          </button>
        )}
      </nav>

      {tab === "videos" && (
        <>
          <div className="ch-sort">
            {SORTS.map(([k, label]) => (
              <button key={k} type="button" className={sort === k ? "on" : ""} onClick={() => setSort(k)}>
                {label}
              </button>
            ))}
          </div>
          <div className="grid">
            {sorted.map((v) => (
              <VideoCard key={v.id} video={v} />
            ))}
          </div>
        </>
      )}

      {tab === "lists" && !openList && (
        <div className="grid pl-grid">
          {series.map((s) => (
            <button key={s.id} type="button" className="pl-card" onClick={() => setOpenList(s)}>
              <div className="pl-thumb">
                {s.first && <img loading="lazy" src={thumb(s.first)} alt="" />}
                <span className="pl-count">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M3 6h12v2H3zm0 4h12v2H3zm0 4h8v2H3zm14-4v8l6-4z" />
                  </svg>
                  {s.n} فيديو
                </span>
              </div>
              <b className="pl-title">{s.t}</b>
              <span className="pl-meta">
                {s.dur ? `${totalLength(s.dur)} • ` : ""}عرض القائمة كاملة
              </span>
            </button>
          ))}
        </div>
      )}

      {tab === "lists" && openList && (
        <section className="pl-view">
          <div className="pl-side">
            <button type="button" className="pl-back" onClick={() => setOpenList(null)}>
              → كل القوائم
            </button>
            {openList.first && <img className="pl-cover" src={thumb(openList.first)} alt="" />}
            <h2>{openList.t}</h2>
            <p className="muted">
              {openList.n} فيديو{openList.dur ? ` • ${totalLength(openList.dur)}` : ""}
            </p>
            <Link
              className="btn gold pl-play"
              href={`/watch/${listVideos?.[0]?.id || openList.v[0]}`}
              onClick={() => rememberSeries(openList.id)}
            >
              ▶ تشغيل الكل
            </Link>
          </div>
          <ol className="pl-list">
            {listVideos === null
              ? Array.from({ length: 6 }, (_, i) => <li key={i} className="sk" style={{ height: 84, borderRadius: 12 }} />)
              : listVideos.map((v, i) => (
                  <li key={v.id}>
                    <Link className="pl-item" href={`/watch/${v.id}`} onClick={() => rememberSeries(openList.id)}>
                      <span className="pl-num">{i + 1}</span>
                      <span className="pl-ithumb">
                        <img loading="lazy" src={thumb(v.id)} alt="" />
                        <span className="dur">{formatDuration(v.d)}</span>
                      </span>
                      <span className="pl-itext">
                        <b>{v.t}</b>
                        <small className="muted">{v.c}</small>
                      </span>
                    </Link>
                  </li>
                ))}
          </ol>
        </section>
      )}
    </div>
  );
}
