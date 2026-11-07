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
import { PageSkeleton } from "@/components/ui/Skeleton";

const FEED_BATCH = 24;

function getGreeting(): string {
  const h = new Date().getHours();
  return h >= 4 && h < 12 ? "صباح الخير" : h >= 12 && h < 17 ? "نهارك سعيد" : h >= 17 && h < 20 ? "مساء الخير" : "مساء النور";
}

/**
 * The feed as you left it. Coming back to the home page (e.g. after shrinking a video into the floating
 * window) shows the same cards at the same spot right away, with no loading screen, like YouTube.
 */
type HomeMemory = {
  at: number;
  pool: VideoItem[];
  feed: VideoItem[];
  resume: VideoItem[];
  topic: string;
  used: Set<string>;
  recent: string[];
  y: number;
};
let homeMemory: HomeMemory | null = null;
const HOME_MEMORY_TTL = 30 * 60_000;

export default function HomePage() {
  const [mem] = useState<HomeMemory | null>(() =>
    homeMemory && Date.now() - homeMemory.at < HOME_MEMORY_TTL ? homeMemory : null
  );
  const [pool, setPool] = useState<VideoItem[]>(mem?.pool ?? []);
  const [loading, setLoading] = useState(!mem);
  const [selectedTopic, setSelectedTopic] = useState<string>(mem?.topic ?? "");
  const [displayedFeed, setDisplayedFeed] = useState<VideoItem[]>(mem?.feed ?? []);
  const [resumeVideos, setResumeVideos] = useState<VideoItem[]>(mem?.resume ?? []);
  const skipRebuildRef = useRef(!!mem);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [, setStoreTick] = useState(0);

  const usedIdsRef = useRef<Set<string>>(mem?.used ?? new Set());
  const recentChannelsRef = useRef<string[]>(mem?.recent ?? []);

  // Remember the feed and where you were in it, and put you back there when you return
  const latest = useRef({ pool, feed: displayedFeed, resume: resumeVideos, topic: selectedTopic, y: 0 });
  latest.current = { ...latest.current, pool, feed: displayedFeed, resume: resumeVideos, topic: selectedTopic };
  useEffect(() => {
    if (mem) requestAnimationFrame(() => window.scrollTo(0, mem.y));
    // (only while this page is the one showing: leaving it scrolls the window to the top first)
    const onScroll = () => {
      if (window.location.pathname === "/") latest.current.y = window.scrollY;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      const l = latest.current;
      if (l.pool.length && l.feed.length) {
        homeMemory = { at: Date.now(), pool: l.pool, feed: l.feed, resume: l.resume, topic: l.topic, used: usedIdsRef.current, recent: recentChannelsRef.current, y: l.y };
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const chipsBarRef = useRef<HTMLDivElement | null>(null);
  const chipsRowRef = useRef<HTMLDivElement | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const [chipEdges, setChipEdges] = useState({ prev: false, next: false });

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
    if (mem) return; // came back: the remembered feed is already on screen
    let active = true;
    async function loadInitial() {
      setLoading(true);
      try {
        const [videosRes, summaryRes] = await Promise.all([
          fetch(`/api/videos?limit=2200&interests=${encodeURIComponent(AlgoEngine.interests().join("|"))}${AlgoEngine.wantsSchool() ? "&school=1" : ""}`),
          fetch("/api/videos?summary=1"),
        ]);
        if (!active) return;
        const videosData = await videosRes.json();
        const summaryData = await summaryRes.json();
        if (summaryData.labels) {
          AlgoEngine.setLabels(summaryData.labels);
        }
        const list: VideoItem[] = videosData.videos || [];

        // "Watched together" graph for what you finished or liked recently (feeds relatedScores)
        const recent = ClientStore.getList("history").slice(0, 40);
        if (recent.length) {
          try {
            const g = await fetch(`/api/videos?related_for=${encodeURIComponent(recent.join(","))}`).then((r) => r.json());
            if (g?.graph) AlgoEngine.setRelatedGraph(g.graph);
          } catch {}
        }
        if (!active) return;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (skipRebuildRef.current) {
      skipRebuildRef.current = false; // keep the remembered cards instead of shuffling a new feed
      return;
    }
    if (filteredPool.length > 0) {
      rebuildFeed();
    } else {
      setDisplayedFeed([]);
    }
  }, [filteredPool, rebuildFeed]);

  // Infinite scroll observer. Re-attached once loading ends (the sentinel only exists then) and after every
  // batch, so it fires again even if the end of the feed is still on screen (short feeds, tall phones).
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || loading) return;
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
  }, [filteredPool, loading, displayedFeed.length]);

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

  // Topic strip: arrows and edge fades only appear on the side that has hidden topics
  useEffect(() => {
    const row = chipsRowRef.current;
    if (!row) return;
    const paint = () => {
      const x = Math.abs(row.scrollLeft);
      const max = row.scrollWidth - row.clientWidth;
      setChipEdges({ prev: x > 4, next: x < max - 4 });
    };
    paint();
    row.addEventListener("scroll", paint, { passive: true });
    window.addEventListener("resize", paint);
    return () => {
      row.removeEventListener("scroll", paint);
      window.removeEventListener("resize", paint);
    };
  }, [topTopics, loading]);

  const scrollChips = (dir: 1 | -1) => {
    const row = chipsRowRef.current;
    // RTL: "previous" topics are to the right (positive), more topics to the left (negative)
    if (row) row.scrollBy({ left: dir * row.clientWidth * 0.7, behavior: "smooth" });
  };

  const pickTopic = (tp: string, btn: HTMLButtonElement) => {
    if (tp === selectedTopic) return;
    setSelectedTopic(tp);
    btn.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    const feed = feedRef.current;
    if (feed) {
      feed.classList.remove("swap");
      void feed.offsetWidth;
      feed.classList.add("swap");
      // Scrolled down? go back to the top of the new suggestions (just under the sticky strip)
      const header = document.querySelector<HTMLElement>(".top");
      const top =
        feed.getBoundingClientRect().top + window.scrollY -
        (chipsBarRef.current?.offsetHeight || 0) - (header?.offsetHeight || 0) - 8;
      if (window.scrollY > top) window.scrollTo({ top, behavior: "smooth" });
    }
  };

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
  const greetingTitle = getGreeting();

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
    return <PageSkeleton kind="home" />;
  }

  const remainingResume = resumeVideos
    .filter((v) => v.id !== heroVideo?.id && ClientStore.isAllowed(v))
    .slice(0, 2); // at most 2 here: the feed below is the point of the page

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

      <div
        ref={chipsBarRef}
        className={`chips-bar ${chipEdges.prev ? "can-prev" : ""} ${chipEdges.next ? "can-next" : ""}`}
      >
        <button type="button" className="chips-nav prev" aria-label="المواضيع اللي قبل" tabIndex={-1} onClick={() => scrollChips(1)}>
          ›
        </button>
        <div className="topic-chips" ref={chipsRowRef}>
          <button
            type="button"
            className={selectedTopic === "" ? "on" : ""}
            onClick={(e) => pickTopic("", e.currentTarget)}
          >
            الكل
          </button>
          {topTopics.map((tp) => (
            <button
              key={tp}
              type="button"
              className={selectedTopic === tp ? "on" : ""}
              onClick={(e) => pickTopic(tp, e.currentTarget)}
            >
              {tp}
            </button>
          ))}
        </div>
        <button type="button" className="chips-nav next" aria-label="مواضيع أكتر" tabIndex={-1} onClick={() => scrollChips(-1)}>
          ‹
        </button>
      </div>

      <div className="grid" id="feed" ref={feedRef}>
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
            // The first pool loaded before the picks: fetch again with plenty of what was just picked
            const picks = AlgoEngine.interests();
            if (!picks.length) return rebuildFeed();
            fetch(`/api/videos?limit=2200&interests=${encodeURIComponent(picks.join("|"))}${AlgoEngine.wantsSchool() ? "&school=1" : ""}`)
              .then((r) => r.json())
              .then((d) => (d?.videos?.length ? setPool(d.videos) : rebuildFeed()))
              .catch(() => rebuildFeed());
          }}
        />
      )}
    </>
  );
}
