"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { ChapterItem, VideoItem } from "@/lib/types";
import { ClientStore } from "@/lib/client/store";

export type SleepOption = 15 | 30 | 60 | "end" | null;

interface PlayerContextValue {
  currentVideo: VideoItem | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  bufferedFraction: number;
  isMini: boolean;
  chapters: ChapterItem[];
  clipRange: [number, number] | null;
  sleepMode: SleepOption;
  sleepRemainingMinutes: number | null;
  roomCode: string | null;
  toastMessage: string | null;
  playVideo: (video: VideoItem, startSeconds?: number) => void;
  togglePlay: () => void;
  pause: () => void;
  seekTo: (seconds: number) => void;
  setChapters: (chapters: ChapterItem[]) => void;
  setClipRange: (range: [number, number] | null) => void;
  attachSlot: (el: HTMLElement | null) => void;
  closePlayer: () => void;
  cycleSleepTimer: () => void;
  showToast: (msg: string, ms?: number) => void;
  createWatchRoom: (video: VideoItem) => Promise<string | null>;
  joinWatchRoom: (code: string) => Promise<string | null>;
  leaveWatchRoom: () => void;
  registerPlayerControls: (controls: {
    seek: (sec: number) => void;
    toggle: () => void;
    pause: () => void;
    play: () => void;
    getTime: () => number;
  }) => void;
  updatePlaybackState: (state: {
    playing?: boolean;
    currentTime?: number;
    duration?: number;
    buffered?: number;
  }) => void;
  slotElement: HTMLElement | null;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const [currentVideo, setCurrentVideo] = useState<VideoItem | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedFraction, setBufferedFraction] = useState(0);
  const [slotElement, setSlotElement] = useState<HTMLElement | null>(null);
  const [chapters, setChapters] = useState<ChapterItem[]>([]);
  const [clipRange, setClipRange] = useState<[number, number] | null>(null);
  const [sleepMode, setSleepMode] = useState<SleepOption>(null);
  const [sleepAt, setSleepAt] = useState<number>(0);
  const [sleepRemainingMinutes, setSleepRemainingMinutes] = useState<
    number | null
  >(null);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const controlsRef = useRef<{
    seek: (sec: number) => void;
    toggle: () => void;
    pause: () => void;
    play: () => void;
    getTime: () => number;
  } | null>(null);

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const myUserIdRef = useRef<string>(
    typeof window !== "undefined"
      ? Math.random().toString(36).slice(2, 10)
      : "user1"
  );
  const lastRoomTsRef = useRef<number>(0);
  const muteRoomPushUntilRef = useRef<number>(0);

  const showToast = useCallback((msg: string, ms = 2600) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(msg);
    if (ms > 0) {
      toastTimerRef.current = setTimeout(() => {
        setToastMessage(null);
      }, ms);
    }
  }, []);

  const playVideo = useCallback((video: VideoItem, startSeconds?: number) => {
    setCurrentVideo(video);
    setChapters([]);
    setClipRange(null);
    if (startSeconds !== undefined) {
      setCurrentTime(startSeconds);
    } else {
      const saved = ClientStore.getProgress(video.id);
      const start =
        saved && saved[1] < 0.92 ? Math.max(0, saved[0] - 2) : 0;
      setCurrentTime(start);
    }
    setDuration(video.d || 0);
  }, []);

  const togglePlay = useCallback(() => {
    controlsRef.current?.toggle();
  }, []);

  const pause = useCallback(() => {
    controlsRef.current?.pause();
  }, []);

  const seekTo = useCallback((seconds: number) => {
    controlsRef.current?.seek(seconds);
    setCurrentTime(seconds);
  }, []);

  const attachSlot = useCallback((el: HTMLElement | null) => {
    setSlotElement(el);
  }, []);

  const closePlayer = useCallback(() => {
    controlsRef.current?.pause();
    setCurrentVideo(null);
    setIsPlaying(false);
    setClipRange(null);
  }, []);

  const cycleSleepTimer = useCallback(() => {
    const order: SleepOption[] = [15, 30, 60, "end", null];
    const next = order[(order.indexOf(sleepMode) + 1) % order.length];
    setSleepMode(next);
    if (typeof next === "number") {
      const target = Date.now() + next * 60_000;
      setSleepAt(target);
      setSleepRemainingMinutes(next);
      showToast(`هيقف بعد ${next === 60 ? "ساعة" : `${next} دقيقة`}`);
    } else if (next === "end") {
      setSleepAt(0);
      setSleepRemainingMinutes(null);
      showToast("هيقف في آخر الفيديو ده");
    } else {
      setSleepAt(0);
      setSleepRemainingMinutes(null);
      showToast("مؤقّت النوم اتقفل");
    }
  }, [sleepMode, showToast]);

  useEffect(() => {
    if (!sleepAt) return;
    const id = setInterval(() => {
      const rem = Math.ceil((sleepAt - Date.now()) / 60_000);
      if (Date.now() >= sleepAt) {
        setSleepMode(null);
        setSleepAt(0);
        setSleepRemainingMinutes(null);
        controlsRef.current?.pause();
        showToast("مؤقّت النوم وقّف التشغيل. تصبح على خير", 5000);
      } else {
        setSleepRemainingMinutes(Math.max(1, rem));
      }
    }, 5000);
    return () => clearInterval(id);
  }, [sleepAt, showToast]);

  const registerPlayerControls = useCallback(
    (controls: {
      seek: (sec: number) => void;
      toggle: () => void;
      pause: () => void;
      play: () => void;
      getTime: () => number;
    }) => {
      controlsRef.current = controls;
    },
    []
  );

  const pushRoomState = useCallback(
    async (code: string, vid: string, t: number, playing: boolean) => {
      if (Date.now() < muteRoomPushUntilRef.current) return;
      try {
        const res = await fetch("/api/room", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code,
            vid,
            t,
            playing,
            by: myUserIdRef.current,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.ts) lastRoomTsRef.current = data.ts;
        }
      } catch {}
    },
    []
  );

  const updatePlaybackState = useCallback(
    (state: {
      playing?: boolean;
      currentTime?: number;
      duration?: number;
      buffered?: number;
    }) => {
      if (state.playing !== undefined) {
        setIsPlaying((prev) => {
          if (prev !== state.playing && roomCode && currentVideo) {
            const t =
              state.currentTime ?? controlsRef.current?.getTime() ?? 0;
            pushRoomState(roomCode, currentVideo.id, t, state.playing!);
          }
          return state.playing!;
        });
      }
      if (state.currentTime !== undefined) setCurrentTime(state.currentTime);
      if (state.duration !== undefined && state.duration > 0)
        setDuration(state.duration);
      if (state.buffered !== undefined) setBufferedFraction(state.buffered);
    },
    [roomCode, currentVideo, pushRoomState]
  );

  const createWatchRoom = useCallback(
    async (video: VideoItem): Promise<string | null> => {
      const code = Math.random()
        .toString(36)
        .slice(2, 7)
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "A");
      setRoomCode(code);
      const t = controlsRef.current?.getTime() || 0;
      await pushRoomState(code, video.id, t, isPlaying);
      return code;
    },
    [isPlaying, pushRoomState]
  );

  const joinWatchRoom = useCallback(
    async (rawCode: string): Promise<string | null> => {
      const code = rawCode
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 12);
      if (!code) return null;
      try {
        const res = await fetch(`/api/room?code=${encodeURIComponent(code)}`);
        if (!res.ok) return null;
        const data = await res.json();
        if (data.error || !data.vid) return null;
        setRoomCode(code);
        showToast("دخلت الأوضة. هتتفرجوا مع بعض");
        return data.vid as string;
      } catch {
        return null;
      }
    },
    [showToast]
  );

  const leaveWatchRoom = useCallback(() => {
    setRoomCode(null);
  }, []);

  useEffect(() => {
    if (!roomCode) return;
    const id = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/room?code=${encodeURIComponent(roomCode)}`
        );
        if (!res.ok) return;
        const r = await res.json();
        if (
          r.error ||
          r.ts <= lastRoomTsRef.current ||
          r.by === myUserIdRef.current
        )
          return;
        lastRoomTsRef.current = r.ts;
        muteRoomPushUntilRef.current = Date.now() + 2000;
        const want = r.t + (r.playing ? r.now - r.ts : 0);
        const curT = controlsRef.current?.getTime() || 0;
        if (Math.abs(curT - want) > 2.5) {
          controlsRef.current?.seek(want);
        }
        if (r.playing) controlsRef.current?.play();
        else controlsRef.current?.pause();
      } catch {}
    }, 1500);
    return () => clearInterval(id);
  }, [roomCode]);

  const isMini = !!currentVideo && !slotElement;

  return (
    <PlayerContext.Provider
      value={{
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
        toastMessage,
        playVideo,
        togglePlay,
        pause,
        seekTo,
        setChapters,
        setClipRange,
        attachSlot,
        closePlayer,
        cycleSleepTimer,
        showToast,
        createWatchRoom,
        joinWatchRoom,
        leaveWatchRoom,
        registerPlayerControls,
        updatePlaybackState,
        slotElement,
      }}
    >
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) {
    throw new Error("usePlayer must be used within PlayerProvider");
  }
  return ctx;
}
