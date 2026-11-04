"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePlayer } from "./PlayerContext";
import {
  onYouTubeReady,
  YTPlayerInstance,
  YTPlayerState,
} from "@/lib/client/youtube-api";
import { ClientStore } from "@/lib/client/store";
import { AlgoEngine } from "@/lib/client/algo";
import {
  calculatePrayerTimes,
  isPrayerPauseEnabled,
  PRAYER_NAMES,
  recordWirdWatchSeconds,
} from "@/lib/client/prayer";
import { formatDuration } from "@/lib/arabic";

const PLAY_PATH =
  "M8 5.2v13.6c0 .8.9 1.3 1.6.8l10.3-6.8c.6-.4.6-1.2 0-1.6L9.6 4.4C8.9 3.9 8 4.4 8 5.2z";
const PAUSE_PATH = "M7 5h3.4v14H7zM13.6 5H17v14h-3.4z";
const NEXT_PATH = "M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z";
const BACK10_PATH = "M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z";
const FWD10_PATH = "M12 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z";
/** Two taps closer than this on a phone = seek 10s (like YouTube) instead of showing/hiding the controls */
const DOUBLE_TAP_MS = 280;
const VOL_PATH =
  "M4 9.5v5h3.5L12 19V5L7.5 9.5H4zm11.5 2.5a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM13 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z";
const MUTE_PATH =
  "M4 9.5v5h3.5L12 19V5L7.5 9.5H4zm12.6 2.5 2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4-2.7-2.7z";
const HEART_PATH =
  "M12 20.6 10.6 19.3C5.6 14.8 2.3 11.8 2.3 8.1 2.3 5.1 4.6 2.8 7.6 2.8c1.7 0 3.3.8 4.4 2.1 1.1-1.3 2.7-2.1 4.4-2.1 3 0 5.3 2.3 5.3 5.3 0 3.7-3.3 6.7-8.3 11.2L12 20.6z";
const LOOP_PATH =
  "M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z";
const MOON_PATH = "M14.5 3A9 9 0 1 0 21 15.3 7.5 7.5 0 0 1 14.5 3z";
const THEATER_PATH = "M3 6h18v12H3V6zm2 2v8h14V8H5z";
const FULL_PATH =
  "M5 5h5V3H3v7h2V5zm14 0v5h2V3h-7v2h5zM5 14H3v7h7v-2H5v-5zm14 5h-5v2h7v-7h-2v5z";
const UNFULL_PATH =
  "M8 8H3v2h7V3H8v5zm8 0V3h-2v7h7V8h-5zM8 16v5h2v-7H3v2h5zm8 0h5v-2h-7v7h2v-5z";

const SPEEDS = [1, 1.25, 1.5, 1.75, 2, 0.75];

export function VideoDock() {
  const router = useRouter();
  const {
    currentVideo,
    isPlaying,
    currentTime,
    duration,
    bufferedFraction,
    isMini,
    chapters,
    clipRange,
    sleepMode,
    sleepRemainingMinutes,
    roomCode,
    startAt,
    upNext,
    playVideo,
    toastMessage,
    closePlayer,
    cycleSleepTimer,
    showToast,
    leaveWatchRoom,
    registerPlayerControls,
    updatePlaybackState,
    slotElement,
  } = usePlayer();

  const dockRef = useRef<HTMLDivElement | null>(null);
  const iframeHostRef = useRef<HTMLDivElement | null>(null);
  const progRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayerInstance | null>(null);

  const [controlsVisible, setControlsVisible] = useState(true);
  /** Cover image only until the first frame plays and after the end; a normal pause keeps the frozen frame */
  const [showCover, setShowCover] = useState(true);
  const [volume, setVolume] = useState(100);
  const [isMuted, setIsMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [isLoop, setIsLoop] = useState(false);
  const [isTheater, setIsTheater] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLiked, setIsLiked] = useState(false);
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekPreviewTime, setSeekPreviewTime] = useState(0);
  const [adhanAlertName, setAdhanAlertName] = useState<string | null>(null);
  const [breakAlertOpen, setBreakAlertOpen] = useState(false);
  const [boxPosition, setBoxPosition] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);

  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLoopRef = useRef(isLoop);
  isLoopRef.current = isLoop;
  const clipRangeRef = useRef(clipRange);
  clipRangeRef.current = clipRange;
  const sleepModeRef = useRef(sleepMode);
  sleepModeRef.current = sleepMode;
  const currentVideoRef = useRef(currentVideo);
  currentVideoRef.current = currentVideo;
  const startAtRef = useRef(startAt);
  startAtRef.current = startAt;
  const upNextRef = useRef(upNext);
  upNextRef.current = upNext;
  const isMiniRef = useRef(isMini);
  isMiniRef.current = isMini;
  const playerReadyRef = useRef(false);
  const speedAppliedRef = useRef(false);
  /** When the current video started, to tell "closed it right away" apart from real watching. */
  const openedAtRef = useRef(0);
  const handledPrayersRef = useRef<Set<string>>(new Set());
  const continuousWatchSecRef = useRef<number>(0);

  const wakeControls = useCallback(() => {
    setControlsVisible(true);
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      if (
        playerRef.current?.getPlayerState?.() === YTPlayerState.PLAYING &&
        !isSeeking
      ) {
        setControlsVisible(false);
      }
    }, 2500);
  }, [isSeeking]);

  // Position dock over the watch-page `#player` slot when attached
  const syncPosition = useCallback(() => {
    if (!slotElement || !slotElement.isConnected || isFullscreen) {
      setBoxPosition(null);
      return;
    }
    const r = slotElement.getBoundingClientRect();
    setBoxPosition({
      top: r.top + window.scrollY,
      left: r.left + window.scrollX,
      width: r.width,
      height: r.height,
    });
  }, [slotElement, isFullscreen]);

  useEffect(() => {
    syncPosition();
    if (!slotElement) return;
    const ro = new ResizeObserver(syncPosition);
    ro.observe(slotElement);
    ro.observe(document.body);
    window.addEventListener("resize", syncPosition);
    window.addEventListener("scroll", syncPosition, { passive: true });
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", syncPosition);
      window.removeEventListener("scroll", syncPosition);
    };
  }, [slotElement, syncPosition]);

  // Theater mode class on body
  useEffect(() => {
    document.body.classList.toggle("theater", isTheater);
  }, [isTheater]);

  // Register imperative player controls with context
  useEffect(() => {
    registerPlayerControls({
      seek: (sec: number) => {
        playerRef.current?.seekTo(sec, true);
        playerRef.current?.playVideo();
        wakeControls();
      },
      toggle: () => {
        const p = playerRef.current;
        if (!p?.getPlayerState) return;
        const st = p.getPlayerState();
        if (st === YTPlayerState.PLAYING || st === YTPlayerState.BUFFERING) {
          p.pauseVideo();
          updatePlaybackState({ playing: false });
        } else {
          p.playVideo();
          updatePlaybackState({ playing: true });
        }
        wakeControls();
      },
      pause: () => {
        playerRef.current?.pauseVideo();
        updatePlaybackState({ playing: false });
      },
      play: () => {
        playerRef.current?.playVideo();
        updatePlaybackState({ playing: true });
      },
      getTime: () => playerRef.current?.getCurrentTime?.() || 0,
    });
  }, [registerPlayerControls, updatePlaybackState, wakeControls]);

  // Where a video should start: an explicit start (?s=, clip) or the saved resume point
  const startFor = (video: { id: string }) => {
    if (startAtRef.current !== null && startAtRef.current !== undefined) return Math.max(0, startAtRef.current);
    const savedProg = ClientStore.getProgress(video.id);
    return savedProg && savedProg[1] < 0.92 ? Math.max(0, savedProg[0] - 2) : 0;
  };

  // The video ended: loop / sleep-at-end / queue / series next / first suggestion, with no gap
  const handleEnded = (p: YTPlayerInstance) => {
    if (isLoopRef.current) {
      p.seekTo(0, true);
      p.playVideo();
      return;
    }
    if (sleepModeRef.current === "end") {
      p.pauseVideo();
      updatePlaybackState({ playing: false });
      showToast("مؤقّت النوم وقّف التشغيل في آخر الفيديو", 5000);
      return;
    }
    const next = ClientStore.shiftQueue() || upNextRef.current;
    if (!next || next.id === currentVideoRef.current?.id) return;
    if (isMiniRef.current) playVideo(next); // keep going in the floating player
    else router.push(`/watch/${encodeURIComponent(next.id)}`); // the watch page reuses this same player
  };
  const handleEndedRef = useRef(handleEnded);
  handleEndedRef.current = handleEnded;

  // "اللي بعده" by hand: same order the auto-play uses (queue, then series next / first suggestion)
  const skipToNext = () => {
    const next = ClientStore.shiftQueue() || upNextRef.current;
    if (!next || next.id === currentVideoRef.current?.id) {
      showToast("مفيش فيديو بعده دلوقتي");
      return;
    }
    if (isMiniRef.current) playVideo(next);
    else router.push(`/watch/${encodeURIComponent(next.id)}`);
  };

  const togglePlay = () => {
    const p = playerRef.current;
    if (!p?.getPlayerState) return;
    if (isPlaying) {
      p.pauseVideo();
      updatePlaybackState({ playing: false });
    } else {
      p.playVideo();
      updatePlaybackState({ playing: true });
    }
  };

  const seekBy = (delta: number) => {
    const p = playerRef.current;
    if (!p?.getCurrentTime) return;
    const t = Math.max(0, p.getCurrentTime() + delta);
    p.seekTo(t, true);
    showToast(delta > 0 ? "+١٠ ثواني" : "−١٠ ثواني", 900);
  };

  // Phones: a tap shows/hides the controls (it never pauses by itself), a double tap on a side seeks 10s.
  // Mouse: a click still plays/pauses, like before.
  const pointerTypeRef = useRef("mouse");
  const lastTapRef = useRef<{ at: number; timer: ReturnType<typeof setTimeout> | null }>({ at: 0, timer: null });
  const onVideoTap = (e: React.MouseEvent<HTMLDivElement>) => {
    if (pointerTypeRef.current === "mouse") {
      togglePlay();
      wakeControls();
      return;
    }
    const tap = lastTapRef.current;
    const now = Date.now();
    if (now - tap.at < DOUBLE_TAP_MS) {
      if (tap.timer) clearTimeout(tap.timer);
      tap.timer = null;
      tap.at = 0;
      const box = e.currentTarget.getBoundingClientRect();
      seekBy(e.clientX - box.left < box.width / 2 ? -10 : 10);
      return;
    }
    tap.at = now;
    const wasVisible = controlsVisible;
    tap.timer = setTimeout(() => {
      tap.timer = null;
      if (wasVisible && isPlaying) {
        if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
        setControlsVisible(false);
      } else {
        wakeControls();
      }
    }, DOUBLE_TAP_MS);
  };

  // One player for the whole session: created once, then every new video is swapped in with
  // loadVideoById, so switching (including auto-advance) never shows a black frame or YouTube's UI.
  useEffect(() => {
    const video = currentVideo;
    if (!video || !iframeHostRef.current) return;

    setIsLiked(ClientStore.hasInList("liked", video.id));
    setShowCover(true);
    setSpeed(ClientStore.getSpeedForChannel(video.c));
    speedAppliedRef.current = false;
    const startSec = startFor(video);

    const existing = playerRef.current;
    if (existing && playerReadyRef.current) {
      try {
        existing.loadVideoById({ videoId: video.id, startSeconds: Math.floor(startSec) });
        existing.unloadModule("captions");
      } catch {}
      openedAtRef.current = Date.now();
      return;
    }
    if (existing) return; // still booting: onReady loads whatever is current by then

    const host = iframeHostRef.current;
    host.innerHTML = "";
    const iframe = document.createElement("iframe");
    const params = new URLSearchParams({
      autoplay: "1",
      controls: "0",
      disablekb: "1",
      fs: "0",
      iv_load_policy: "3",
      modestbranding: "1",
      rel: "0",
      playsinline: "1",
      cc_load_policy: "0",
      enablejsapi: "1",
      start: String(Math.floor(startSec)),
      origin: window.location.origin,
    });
    iframe.src = `https://www.youtube-nocookie.com/embed/${video.id}?${params.toString()}`;
    iframe.allow =
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen";
    iframe.title = video.t;
    // Overscan crop + pointer-events: none so zero YouTube branding or hover UI can appear
    iframe.className = "yt-cropped-iframe";
    host.appendChild(iframe);
    openedAtRef.current = Date.now();
    const bootId = video.id;

    const unsubscribe = onYouTubeReady(() => {
      if (!window.YT?.Player || playerRef.current) return;
      const p = new window.YT.Player(iframe, {
        events: {
          onReady: () => {
            playerReadyRef.current = true;
            try {
              p.unloadModule("captions");
            } catch {}
            setVolume(p.getVolume?.() ?? 100);
            setIsMuted(p.isMuted?.() ?? false);
            // The viewer moved on while the player was booting
            const cur = currentVideoRef.current;
            if (cur && cur.id !== bootId) {
              try {
                p.loadVideoById({ videoId: cur.id, startSeconds: Math.floor(startFor(cur)) });
              } catch {}
            }
          },
          onStateChange: (e) => {
            const st = e.data;
            if (st === YTPlayerState.PLAYING) setShowCover(false);
            if (st === YTPlayerState.ENDED) {
              setShowCover(true);
              handleEndedRef.current(p);
              if (isLoopRef.current) return;
            }
            const playingNow = st === YTPlayerState.PLAYING;
            if (st !== YTPlayerState.BUFFERING) {
              updatePlaybackState({ playing: playingNow });
            }
            const cur = currentVideoRef.current;
            if (playingNow && cur && !speedAppliedRef.current) {
              speedAppliedRef.current = true;
              const chSpeed = ClientStore.getSpeedForChannel(cur.c);
              try {
                p.setPlaybackRate(chSpeed);
                setSpeed(chSpeed);
              } catch {}
            }
          },
        },
      });
      playerRef.current = p;
    });
    return () => {
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentVideo?.id]);

  // Closed the player entirely: tear it down
  useEffect(() => {
    if (currentVideo) return;
    try {
      playerRef.current?.destroy?.();
    } catch {}
    playerRef.current = null;
    playerReadyRef.current = false;
    if (iframeHostRef.current) iframeHostRef.current.innerHTML = "";
  }, [currentVideo]);

  // Switching away from a video: closing it within 45s and before 10% teaches the algorithm "not for me"
  useEffect(() => {
    const v = currentVideo;
    if (!v) return;
    return () => {
      const p = ClientStore.getProgress(v.id);
      AlgoEngine.recordClose(v, p?.[1] ?? 0, (Date.now() - openedAtRef.current) / 1000);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentVideo?.id]);

  // Unmount (navigating away from the app shell)
  useEffect(
    () => () => {
      try {
        playerRef.current?.destroy?.();
      } catch {}
      playerRef.current = null;
      playerReadyRef.current = false;
    },
    []
  );

  // 250ms progress & clip-range & 5-second learning/wird tick
  useEffect(() => {
    if (!currentVideo) return;
    let tickCount = 0;
    const id = setInterval(() => {
      const p = playerRef.current;
      if (!p?.getCurrentTime) return;
      const t = p.getCurrentTime() || 0;
      const d = p.getDuration() || currentVideo.d || 0;
      const buf = p.getVideoLoadedFraction?.() || 0;

      if (!isSeeking) {
        updatePlaybackState({
          currentTime: t,
          duration: d,
          buffered: buf,
        });
      }

      // Clip loop enforcement
      const cr = clipRangeRef.current;
      if (cr && t >= cr[1]) {
        p.seekTo(cr[0], true);
      }

      // Every 5 seconds (20 ticks), save watch progress, train Two-Tower model, and update Daily Wird
      tickCount++;
      if (tickCount % 20 === 0 && p.getPlayerState?.() === YTPlayerState.PLAYING) {
        const frac = d > 0 ? Math.min(1, t / d) : 0;
        ClientStore.saveProgress(currentVideo.id, t, frac);
        AlgoEngine.recordWatch(currentVideo, t, frac);
        const wirdRes = recordWirdWatchSeconds(currentVideo, 5);
        if (wirdRes.completedNow) {
          showToast(
            `ما شاء الله، خلّصت وردك النهارده${
              wirdRes.streakDays > 1 ? ` (${wirdRes.streakDays} أيام ورا بعض)` : ""
            }`,
            5000
          );
        }
        continuousWatchSecRef.current += 5;
        if (continuousWatchSecRef.current >= 3600) {
          continuousWatchSecRef.current = 0;
          setBreakAlertOpen(true);
        }
      }
    }, 250);
    return () => clearInterval(id);
  }, [currentVideo, isSeeking, showToast, updatePlaybackState]);

  // Prayer-time automatic pause check every 20s
  useEffect(() => {
    const id = setInterval(() => {
      if (!isPrayerPauseEnabled()) return;
      const now = new Date();
      const times = calculatePrayerTimes(now);
      for (const [k, t] of Object.entries(times)) {
        const key = `${k}_${t.toDateString()}`;
        const diff = now.getTime() - t.getTime();
        if (handledPrayersRef.current.has(key) || diff < 0 || diff > 180_000) {
          continue;
        }
        handledPrayersRef.current.add(key);
        if (playerRef.current?.getPlayerState?.() === YTPlayerState.PLAYING) {
          playerRef.current.pauseVideo();
          updatePlaybackState({ playing: false });
          setAdhanAlertName(PRAYER_NAMES[k] || k);
        }
      }
    }, 20_000);
    return () => clearInterval(id);
  }, [updatePlaybackState]);

  // Keyboard shortcuts (Space/K play/pause, Arrows +-5s, J/L +-10s, M mute, F fullscreen)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!currentVideo || isMini) return;
      if (e.key === "Escape" && isFullscreen) {
        setIsFullscreen(false);
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        }
        return;
      }
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target?.closest?.(
          "input, textarea, select, button, a, [contenteditable]"
        )
      ) {
        return;
      }
      const p = playerRef.current;
      if (!p?.getCurrentTime) return;
      const k = e.key.toLowerCase();
      if (k === " " || k === "k") {
        e.preventDefault();
        const st = p.getPlayerState();
        if (st === YTPlayerState.PLAYING || st === YTPlayerState.BUFFERING) {
          p.pauseVideo();
          updatePlaybackState({ playing: false });
        } else {
          p.playVideo();
          updatePlaybackState({ playing: true });
        }
        wakeControls();
      } else if (k === "arrowright" || k === "l") {
        e.preventDefault();
        const step = k === "l" ? 10 : 5;
        p.seekTo(p.getCurrentTime() + step, true);
        wakeControls();
      } else if (k === "arrowleft" || k === "j") {
        e.preventDefault();
        const step = k === "j" ? -10 : -5;
        p.seekTo(Math.max(0, p.getCurrentTime() + step), true);
        wakeControls();
      } else if (k === "m") {
        e.preventDefault();
        const nextMute = !p.isMuted();
        if (nextMute) p.mute();
        else p.unMute();
        setIsMuted(nextMute);
      } else if (k === "f") {
        e.preventDefault();
        toggleFullscreen();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const toggleFullscreen = () => {
    const next = !isFullscreen;
    setIsFullscreen(next);
    if (next) {
      dockRef.current?.requestFullscreen?.().catch(() => {});
    } else if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    }
    wakeControls();
  };

  const handleCycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    try {
      playerRef.current?.setPlaybackRate(next);
    } catch {}
    if (currentVideo) {
      ClientStore.setSpeedForChannel(currentVideo.c, next);
    }
  };

  const handleToggleLike = () => {
    if (!currentVideo) return;
    const on = ClientStore.toggleList("liked", currentVideo.id);
    setIsLiked(on);
    AlgoEngine.recordLike(currentVideo, on);
  };

  const handlePointerDownSeek = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!progRef.current || !duration) return;
    setIsSeeking(true);
    progRef.current.setPointerCapture(e.pointerId);
    const rect = progRef.current.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setSeekPreviewTime(frac * duration);
  };

  const handlePointerMoveSeek = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isSeeking || !progRef.current || !duration) return;
    const rect = progRef.current.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setSeekPreviewTime(frac * duration);
  };

  const handlePointerUpSeek = () => {
    if (!isSeeking) return;
    setIsSeeking(false);
    playerRef.current?.seekTo(seekPreviewTime, true);
    updatePlaybackState({ currentTime: seekPreviewTime });
  };

  const effectiveTime = isSeeking ? seekPreviewTime : currentTime;
  const fillPercent = duration > 0 ? Math.min(100, (effectiveTime / duration) * 100) : 0;
  const activeChapter =
    chapters.length > 0
      ? [...chapters].reverse().find((c) => c.t <= effectiveTime)
      : null;

  const dockStyle: React.CSSProperties = isFullscreen
    ? {
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        zIndex: 90,
        borderRadius: 0,
      }
    : isMini
      ? {}
      : boxPosition
        ? {
            position: "absolute",
            top: `${boxPosition.top}px`,
            left: `${boxPosition.left}px`,
            width: `${boxPosition.width}px`,
            height: `${boxPosition.height}px`,
          }
        : { display: "none" };

  return (
    <>
      <div
        ref={dockRef}
        hidden={!currentVideo}
        className={`dock ${isMini ? "mini" : ""} ${
          controlsVisible ? "ctl-on" : ""
        } ${!isPlaying ? "is-paused" : ""}`}
        style={dockStyle}
        onPointerMove={wakeControls}
        onPointerLeave={() => {
          if (isPlaying && !isSeeking) setControlsVisible(false);
        }}
      >
        <div className="dock-video">
          {/* Overscan crop wrapper hides YouTube top title bar and bottom watermark */}
          <div ref={iframeHostRef} className="yt-crop-mask" />

          {/* Thumbnail shield covers YouTube's loading frame and end-screens (before the first frame and after the end) */}
          {currentVideo && !isPlaying && showCover && (
            <div
              className="yt-brand-shield"
              style={{
                backgroundImage: `url(https://i.ytimg.com/vi/${currentVideo.id}/${
                  currentVideo.hd ? "maxresdefault" : "hqdefault"
                }.jpg), url(https://i.ytimg.com/vi/${currentVideo.id}/hqdefault.jpg)`,
              }}
            />
          )}
        </div>

        {/* Center tap area + wine-and-gold play indicator */}
        <div
          className={`dock-tap ${!isPlaying ? "paused" : ""}`}
          onPointerDown={(e) => {
            pointerTypeRef.current = e.pointerType || "mouse";
          }}
          onClick={onVideoTap}
          onDoubleClick={() => {
            if (pointerTypeRef.current === "mouse") toggleFullscreen();
          }}
        >
          <span className="tap-big" aria-hidden="true">
            <svg className="tap-ico" viewBox="0 0 24 24">
              <path d={PLAY_PATH} />
            </svg>
          </span>
        </div>

        {/* Phones: big middle controls like YouTube (back 10s · play/pause · next) */}
        <div className="dock-mid" dir="ltr">
          <button type="button" aria-label="رجّع ١٠ ثواني" onClick={() => { seekBy(-10); wakeControls(); }}>
            <svg viewBox="0 0 24 24"><path d={BACK10_PATH} /></svg>
          </button>
          <button type="button" className="mid-play" aria-label={isPlaying ? "إيقاف" : "تشغيل"} onClick={() => { togglePlay(); wakeControls(); }}>
            <svg viewBox="0 0 24 24"><path d={isPlaying ? PAUSE_PATH : PLAY_PATH} /></svg>
          </button>
          <button type="button" aria-label="قدّم ١٠ ثواني" onClick={() => { seekBy(10); wakeControls(); }}>
            <svg viewBox="0 0 24 24"><path d={FWD10_PATH} /></svg>
          </button>
          <button type="button" className="mid-next" aria-label="الفيديو اللي بعده" onClick={skipToNext}>
            <svg viewBox="0 0 24 24"><path d={NEXT_PATH} /></svg>
          </button>
        </div>

        {/* Custom Wine & Gold Control Bar */}
        <div className="ctl" dir="ltr">
          <div
            ref={progRef}
            className="ctl-prog"
            onPointerDown={handlePointerDownSeek}
            onPointerMove={handlePointerMoveSeek}
            onPointerUp={handlePointerUpSeek}
          >
            <div
              className="ctl-buf"
              style={{ width: `${Math.min(100, bufferedFraction * 100)}%` }}
            />
            <div className="ctl-fill" style={{ width: `${fillPercent}%` }}>
              <span className="ctl-knob" />
            </div>
            {duration > 0 &&
              chapters.slice(1).map((ch, idx) => (
                <i
                  key={idx}
                  className="ctl-mark"
                  style={{ left: `${(ch.t / duration) * 100}%` }}
                />
              ))}
          </div>

          <div className="ctl-row">
            <button
              type="button"
              aria-label="تشغيل/إيقاف"
              onClick={togglePlay}
            >
              <svg viewBox="0 0 24 24">
                <path d={isPlaying ? PAUSE_PATH : PLAY_PATH} />
              </svg>
            </button>

            <button type="button" className="ctl-next" aria-label="الفيديو اللي بعده" title="الفيديو اللي بعده" onClick={skipToNext}>
              <svg viewBox="0 0 24 24">
                <path d={NEXT_PATH} />
              </svg>
            </button>

            <span className="ctl-volbox">
              <button
                type="button"
                aria-label="الصوت"
                onClick={() => {
                  const p = playerRef.current;
                  if (!p) return;
                  const nextMute = !isMuted;
                  if (nextMute) p.mute();
                  else p.unMute();
                  setIsMuted(nextMute);
                }}
              >
                <svg viewBox="0 0 24 24">
                  <path d={isMuted || volume === 0 ? MUTE_PATH : VOL_PATH} />
                </svg>
              </button>
              <input
                className="ctl-vol"
                type="range"
                min={0}
                max={100}
                value={isMuted ? 0 : volume}
                aria-label="مستوى الصوت"
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setVolume(val);
                  playerRef.current?.setVolume(val);
                  if (val === 0) {
                    playerRef.current?.mute();
                    setIsMuted(true);
                  } else if (isMuted) {
                    playerRef.current?.unMute();
                    setIsMuted(false);
                  }
                }}
              />
            </span>

            <span className="ctl-time">
              {formatDuration(effectiveTime)} / {formatDuration(duration)}
            </span>
            {activeChapter && (
              <span className="ctl-chap">• {activeChapter.title}</span>
            )}
            <span className="ctl-sp" />

            <button
              type="button"
              className={`ctl-like ${isLiked ? "on" : ""}`}
              aria-label="استفدت منه"
              title="استفدت منه"
              onClick={handleToggleLike}
            >
              <svg viewBox="0 0 24 24">
                <path d={HEART_PATH} />
              </svg>
            </button>

            <button
              type="button"
              className={isLoop ? "on" : ""}
              aria-label="تكرار"
              title="تكرار الفيديو"
              onClick={() => setIsLoop(!isLoop)}
            >
              <svg viewBox="0 0 24 24">
                <path d={LOOP_PATH} />
              </svg>
            </button>

            <button
              type="button"
              className={`ctl-sleep ${sleepMode !== null ? "on" : ""}`}
              aria-label="مؤقّت النوم"
              title="مؤقّت النوم"
              onClick={cycleSleepTimer}
            >
              <svg viewBox="0 0 24 24">
                <path d={MOON_PATH} />
              </svg>
              <small>
                {sleepMode === "end"
                  ? "آخره"
                  : sleepRemainingMinutes
                    ? `${sleepRemainingMinutes}د`
                    : ""}
              </small>
            </button>

            <button
              type="button"
              className="ctl-txt"
              aria-label="السرعة"
              title="السرعة"
              onClick={handleCycleSpeed}
            >
              {speed}×
            </button>

            <button
              type="button"
              aria-label="وضع المسرح"
              title="وضع المسرح"
              onClick={() => setIsTheater(!isTheater)}
            >
              <svg viewBox="0 0 24 24">
                <path d={THEATER_PATH} />
              </svg>
            </button>

            <button
              type="button"
              aria-label="ملء الشاشة"
              title="ملء الشاشة"
              onClick={toggleFullscreen}
            >
              <svg viewBox="0 0 24 24">
                <path d={isFullscreen ? UNFULL_PATH : FULL_PATH} />
              </svg>
            </button>
          </div>
        </div>

        {/* Mini-player bottom bar when navigating outside the watch page */}
        {currentVideo && (
          <div className="dock-bar">
            <a
              className="dock-title"
              onClick={() => router.push(`/watch/${currentVideo.id}`)}
            >
              {currentVideo.t}
            </a>
            <button
              type="button"
              aria-label="إيقاف/تشغيل"
              onClick={() => {
                const p = playerRef.current;
                if (!p) return;
                if (isPlaying) {
                  p.pauseVideo();
                  updatePlaybackState({ playing: false });
                } else {
                  p.playVideo();
                  updatePlaybackState({ playing: true });
                }
              }}
            >
              {isPlaying ? "⏸" : "▶"}
            </button>
            <button
              type="button"
              aria-label="كبّر"
              onClick={() => router.push(`/watch/${currentVideo.id}`)}
            >
              ⤢
            </button>
            <button type="button" aria-label="اقفل" onClick={closePlayer}>
              ✕
            </button>
          </div>
        )}
      </div>

      {/* Watch-Together Floating Pill */}
      {roomCode && (
        <div className="room-pill">
          <span>
            بتتفرج مع صحابك · <b>{roomCode}</b>
          </span>
          <button
            type="button"
            onClick={() => {
              const url = `${window.location.origin}/watch/${
                currentVideo?.id || ""
              }?room=${encodeURIComponent(roomCode)}`;
              navigator.clipboard?.writeText(url).catch(() => {});
              showToast("اتنسخ لينك الأوضة");
            }}
          >
            اللينك
          </button>
          <button type="button" onClick={leaveWatchRoom}>
            خروج
          </button>
        </div>
      )}

      {/* Prayer-Time Automatic Pause Modal */}
      {adhanAlertName && (
        <div className="break adhan">
          <b>حان الآن وقت صلاة {adhanAlertName}</b>
          <p>
            وقّفنالك الفيديو. كمّل بعد الصلاة إن شاء الله، هتلاقيه مستنيك من
            نفس المكان.
          </p>
          <div>
            <button
              type="button"
              className="btn gold"
              onClick={() => setAdhanAlertName(null)}
            >
              تمام
            </button>
          </div>
        </div>
      )}

      {/* 60-Minute Break Reminder */}
      {breakAlertOpen && (
        <div className="break">
          <b>بقالك ساعة بتتفرج</b>
          <p>
            خد استراحة صغيرة: قوم اتحرك، اشرب مية، وريّح عينك. الدرس مستنيك.
          </p>
          <div>
            <button
              type="button"
              className="btn gold"
              onClick={() => setBreakAlertOpen(false)}
            >
              تمام
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setBreakAlertOpen(false)}
            >
              ذكّرني بعدين
            </button>
          </div>
        </div>
      )}

      {/* Global Toast */}
      {toastMessage && <div className="toast-pill">{toastMessage}</div>}
    </>
  );
}
