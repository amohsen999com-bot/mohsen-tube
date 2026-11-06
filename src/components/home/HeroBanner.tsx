"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { VideoItem } from "@/lib/types";
import { formatRelativeArabicDate } from "@/lib/arabic";
import { ClientStore } from "@/lib/client/store";
import {
  onYouTubeReady,
  YTPlayerInstance,
  YTPlayerState,
} from "@/lib/client/youtube-api";
import { usePlayer } from "@/components/player/PlayerContext";
import { Glyph } from "@/components/ui/Glyph";

export function HeroBanner({
  video,
  resuming,
}: {
  video: VideoItem;
  resuming: boolean;
}) {
  const { currentVideo } = usePlayer();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayerInstance | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);

  const prog = ClientStore.getProgress(video.id);
  const startSec =
    prog && prog[1] < 0.92 ? Math.max(0, prog[0] - 3) : 0;

  useEffect(() => {
    // Do not auto-play background hero if the user already has a video playing in the mini dock
    if (currentVideo || !hostRef.current) return;

    const host = hostRef.current;
    host.innerHTML = "";
    const targetDiv = document.createElement("div");
    host.appendChild(targetDiv);

    let disposed = false;
    const unsub = onYouTubeReady(() => {
      if (disposed || !window.YT?.Player) return;
      const p = new window.YT.Player(targetDiv, {
        host: "https://www.youtube-nocookie.com",
        videoId: video.id,
        playerVars: {
          autoplay: 1,
          mute: 1,
          controls: 0,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          disablekb: 1,
          fs: 0,
          iv_load_policy: 3,
          cc_load_policy: 0,
          start: Math.floor(startSec),
          origin: window.location.origin,
        },
        events: {
          onStateChange: (e) => {
            if (disposed) return;
            if (e.data === YTPlayerState.PLAYING) {
              setIsPlaying(true);
              try {
                p.unloadModule("captions");
              } catch {}
            } else if (
              e.data === YTPlayerState.PAUSED ||
              e.data === YTPlayerState.ENDED
            ) {
              setIsPlaying(false);
            }
          },
        },
      });
      playerRef.current = p;
    });

    return () => {
      disposed = true;
      unsub();
      try {
        playerRef.current?.destroy?.();
      } catch {}
      playerRef.current = null;
    };
  }, [video.id, startSec, currentVideo]);

  const togglePause = () => {
    const p = playerRef.current;
    if (!p?.getPlayerState) return;
    if (p.getPlayerState() === YTPlayerState.PLAYING) {
      p.pauseVideo();
      setIsPlaying(false);
    } else {
      p.playVideo();
      setIsPlaying(true);
    }
  };

  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    const p = playerRef.current;
    if (!p?.isMuted) return;
    if (p.isMuted()) {
      p.unMute();
      setIsMuted(false);
    } else {
      p.mute();
      setIsMuted(true);
    }
  };

  const handleGoWatch = () => {
    const p = playerRef.current;
    if (p?.getCurrentTime) {
      const t = p.getCurrentTime();
      const d = p.getDuration() || video.d || 1;
      if (t > startSec) {
        ClientStore.saveProgress(video.id, t, Math.min(1, t / d));
      }
    }
  };

  const thumbUrl = `https://i.ytimg.com/vi/${video.id}/${
    video.hd ? "maxresdefault" : "hqdefault"
  }.jpg`;

  return (
    <section className={`hero ${isPlaying ? "playing" : ""}`}>
      <div className="hero-media">
        <img
          src={thumbUrl}
          onError={(e) => {
            const img = e.currentTarget;
            if (!img.src.includes("hqdefault.jpg")) {
              img.src = `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`;
            }
          }}
          alt=""
        />
        <div ref={hostRef} className="hero-yt-wrap" />
      </div>
      <div className="hero-shade" onClick={togglePause} />
      <div className="hero-info">
        <div className="hero-tag">
          {resuming ? "كمّل من حيث وقفت" : "مقترح لك"}
        </div>
        <h1>{video.t}</h1>
        <div className="hero-ch">
          {video.c}
          {video.dt ? ` • ${formatRelativeArabicDate(video.dt)}` : ""}
        </div>
        {resuming && prog && (
          <div className="hero-bar">
            <i style={{ width: `${Math.max(prog[1] * 100, 3)}%` }} />
          </div>
        )}
        <div className="hero-btns">
          <Link
            className="hero-play"
            href={`/watch/${video.id}`}
            onClick={handleGoWatch}
          >
            <Glyph name="play" /> {resuming ? "كمّل المشاهدة" : "شاهد"}
          </Link>
          <Link
            className="hero-more"
            href={`/channel/${encodeURIComponent(video.c)}`}
          >
            القناة
          </Link>
        </div>
      </div>
      <div className="hero-ctrls">
        <button
          type="button"
          className="hero-mute"
          aria-label="إيقاف"
          onClick={togglePause}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d={isPlaying ? "M7 5h3.4v14H7zM13.6 5H17v14h-3.4z" : "M8 5.5v13c0 .8.9 1.3 1.6.8l10-6.5c.6-.4.6-1.2 0-1.6l-10-6.5C8.9 4.2 8 4.7 8 5.5z"} />
          </svg>
        </button>
        <button
          type="button"
          className="hero-mute"
          aria-label="الصوت"
          onClick={toggleMute}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d={
                isMuted
                  ? "M4 9v6h4l5 4V5L8 9H4zm12.6 3l2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4z"
                  : "M4 9v6h4l5 4V5L8 9H4zm11.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM13 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"
              }
            />
          </svg>
        </button>
      </div>
    </section>
  );
}
