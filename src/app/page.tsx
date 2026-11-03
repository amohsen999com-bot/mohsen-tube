"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { VideoItem } from "@/lib/types";
import { HeroBanner } from "@/components/home/HeroBanner";
import { VideoCard } from "@/components/video/VideoCard";
import { OnboardingModal } from "@/components/modals/OnboardingModal";
import { AlgoEngine } from "@/lib/client/algo";
import { ClientStore, readLocal, subscribeStore } from "@/lib/client/store";
import { getDayKey, getWird, getWirdStreak } from "@/lib/client/prayer";

const FEED_BATCH = 24;

function getGreeting(): [string, string] {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) {
    return ["صباح الهمة والعمل", "اخترنالك بداية تفتح النفس وتزودك علم وإنجاز"];
  }
  if (h >= 12 && h < 17) {
    return ["طاب يومك", "تشكيلة متوازنة بين العلم والعمل والترويح المباح"];
  }
  if (h >= 17 && h < 21) {
    return ["مساء الخير والبركة", "دروس نافعة ومهارات عملية تناسب وقت المساء"];
  }
  return ["مساء السكينة", "مقاطع هادية ورقائق وقصص تريّح القلب آخر اليوم"];
}

export default function HomePage() {
  const [pool, setPool] = useState<VideoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTopic, setSelectedTopic] = useState<string>("");
  const [displayedFeed, setDisplayedFeed] = useState<VideoItem[]>([]);
  const [resumeVideos, setResumeVideos] = useState<VideoItem[]>([]);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [, setStoreTick] = useState(0);

  const usedIdsRef = useRef<Set<string>>(new Set());
  const recentChannelsRef = useRef<string[]>([]);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return subscribeStore(() => setStoreTick((n) => n + 1));
  }, []);

  useEffect(() => {
    if (!readLocal<number>("nt_onboarded", 0)) {
      setShowOnboarding(true);
    }
  }, []);

  // Load curated candidate pool and summary
  useEffect(() => {
    let active = true;
    async function loadInitial() {
      setLoading(true);
      try {
        const [videosRes, summaryRes] = await Promise.all([
          fetch("/api/videos?limit=1200"),
          fetch("/api/videos?summary=1"),
        ]);
        if (!active) return;
        const videosData = await videosRes.json();
        const summaryData = await summaryRes.json();
        if (summaryData.labels) {
          AlgoEngine.setLabels(summaryData.labels);
        }
        const list: VideoItem[] = videosData.videos || [];
        setPool(list);

        // Fetch any partially watched videos from history
        const histIds = ClientStore.getList("history").slice(0, 30);
        if (histIds.length > 0) {
          const prog = ClientStore.getAllProgress();
          const resIds = histIds.filter(
            (id) => prog[id] && prog[id][1] > 0.05 && prog[id][1] < 0.9
          );
          if (resIds.length > 0) {
            const histRes = await fetch(
              `/api/videos?ids=${encodeURIComponent(resIds.slice(0, 6).join(","))}`
            );
            const histData = await histRes.json();
            if (active && histData.videos) {
              setResumeVideos(histData.videos);
            }
          }
        }
      } catch (err) {
        console.error("Failed to load home feed:", err);
      } finally {
        if (active) setLoading(false);
      }
    }
    loadInitial();
    return () => {
      active = false;
    };
  }, []);

  const filteredPool = useMemo(() => {
    const allowed = pool.filter((v) => ClientStore.isAllowed(v));
    if (!selectedTopic) return allowed;
    return allowed.filter((v) => v.tp === selectedTopic);
  }, [pool, selectedTopic]);

  const rebuildFeed = useCallback(() => {
    usedIdsRef.current = new Set();
    recentChannelsRef.current = [];
    const firstBatch = AlgoEngine.buildFeedBatch(
      filteredPool,
      FEED_BATCH,
      usedIdsRef.current,
      recentChannelsRef.current
    );
    setDisplayedFeed(firstBatch);
  }, [filteredPool]);

  useEffect(() => {
    if (filteredPool.length > 0) {
      rebuildFeed();
    } else {
      setDisplayedFeed([]);
    }
  }, [filteredPool, rebuildFeed]);

  // Infinite scroll observer
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && filteredPool.length > 0) {
          const nextBatch = AlgoEngine.buildFeedBatch(
            filteredPool,
            FEED_BATCH,
            usedIdsRef.current,
            recentChannelsRef.current
          );
          if (nextBatch.length > 0) {
            setDisplayedFeed((prev) => [...prev, ...nextBatch]);
          }
        }
      },
      { rootMargin: "800px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [filteredPool]);

  const topTopics = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const v of pool) {
      if (v.tp && v.tp !== "دروس عامة") {
        counts[v.tp] = (counts[v.tp] || 0) + 1;
      }
    }
    const score = (tp: string) =>
      AlgoEngine.topicScore(tp) + Math.log(counts[tp] || 1) * 0.05;
    return Object.keys(counts)
      .filter((tp) => counts[tp] >= 6)
      .sort((a, b) => score(b) - score(a))
      .slice(0, 14);
  }, [pool]);

  const heroTarget = useMemo((): [VideoItem | null, boolean] => {
    if (resumeVideos.length > 0) {
      return [resumeVideos[0], true];
    }
    if (displayedFeed.length > 0) {
      return [displayedFeed[0], false];
    }
    return [null, false];
  }, [resumeVideos, displayedFeed]);

  const [heroVideo, isResumingHero] = heroTarget;
  const [greetingTitle, greetingSub] = getGreeting();

  // Daily Wird ring stats
  const wird = getWird();
  const wirdMins = Math.floor((wird.days[getDayKey()] || 0) / 60);
  const wirdPct = wird.goal ? Math.min(100, (wirdMins / wird.goal) * 100) : 0;
  const wirdLeft = Math.max(0, (wird.goal || 0) - wirdMins);
  const streak = getWirdStreak();
  const C = 2 * Math.PI * 17;
  const wirdLabel =
    wirdPct >= 100
      ? "خلّصت وردك"
      : !wirdMins
        ? `وردك ${wird.goal} دقيقة`
        : `فاضل ${wirdLeft} ${
            wirdLeft > 2 && wirdLeft < 11 ? "دقايق" : "دقيقة"
          }`;

  if (loading) {
    return <p className="muted pad">جاري التحميل...</p>;
  }

  const remainingResume = resumeVideos
    .filter((v) => v.id !== heroVideo?.id && ClientStore.isAllowed(v))
    .slice(0, 4);

  const gridVideos = displayedFeed.filter((v) => v.id !== heroVideo?.id);

  return (
    <>
      {heroVideo && <HeroBanner video={heroVideo} resuming={isResumingHero} />}

      {remainingResume.length > 0 && (
        <section>
          <h2 className="sec">كمّل المشاهدة</h2>
          <div className="grid">
            {remainingResume.map((v) => (
              <VideoCard
                key={v.id}
                video={v}
                onHidden={() =>
                  setResumeVideos((prev) => prev.filter((x) => x.id !== v.id))
                }
              />
            ))}
          </div>
        </section>
      )}

      <div className="feed-head">
        <div className="fh-title">
          <small>{greetingTitle}</small>
          <h2>مقترح لك</h2>
          <p>{greetingSub}</p>
        </div>

        {wird.goal > 0 && (
          <Link
            href="/library"
            className={`wird ${wirdPct >= 100 ? "full" : ""}`}
            title="وردك اليومي من العلم (تقدر تغيّره من المكتبة)"
          >
            <svg className="wird-ring" viewBox="0 0 40 40" aria-hidden="true">
              <circle cx="20" cy="20" r="17" />
              <circle
                className="wird-p"
                cx="20"
                cy="20"
                r="17"
                style={{
                  strokeDasharray: C,
                  strokeDashoffset: C * (1 - wirdPct / 100),
                }}
              />
              {wirdPct >= 100 ? (
                <path className="wird-ok" d="M13.5 20.5l4.2 4.2 8.8-9" />
              ) : (
                <text x="20" y="24.5">
                  {Math.min(wirdMins, wird.goal)}
                </text>
              )}
            </svg>
            <span className="wird-txt">
              <b>{wirdLabel}</b>
            </span>
            {streak > 1 && (
              <span className="wird-streak" title={`${streak} أيام ورا بعض`}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M13.5 2s.9 3.2-1.5 6.1C9.6 11 7 12.6 7 16a5 5 0 0 0 10 0c0-1.6-.6-3-1.4-4 .1 1.4-.6 2.6-1.8 2.6 0 0 1.7-3.2.3-6.7C13.2 6 13.5 2 13.5 2z" />
                </svg>
                {streak}
              </span>
            )}
          </Link>
        )}
      </div>

      <div className="chips-bar">
        <div className="topic-chips">
          <button
            type="button"
            className={selectedTopic === "" ? "on" : ""}
            onClick={() => setSelectedTopic("")}
          >
            الكل
          </button>
          {topTopics.map((tp) => (
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
      </div>

      <div className="grid" id="feed">
        {gridVideos.map((v) => (
          <VideoCard
            key={v.id}
            video={v}
            showWhy
            onHidden={(id) =>
              setDisplayedFeed((prev) => prev.filter((x) => x.id !== id))
            }
          />
        ))}
      </div>

      <div ref={loadMoreRef} id="more" style={{ height: 32 }} />

      {showOnboarding && (
        <OnboardingModal
          onDone={() => {
            setShowOnboarding(false);
            rebuildFeed();
          }}
        />
      )}
    </>
  );
}
