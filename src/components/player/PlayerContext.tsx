"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChapterItem, VideoItem } from "@/lib/types";
import { ClientStore } from "@/lib/client/store";
import { startSync } from "@/lib/client/sync";
import { miniHandoff } from "./MiniFloat";

export type SleepOption = 15 | 30 | 60 | "end" | null;

interface PlayerContextValue {
  currentVideo: VideoItem | null;
  /** Where the current video should start (from ?s=, a clip, or resume); null = resume from saved progress. */
  startAt: number | null;
  /** What plays right after this video ends (series next or first suggestion); set by the watch page. */
  upNext: VideoItem | null;
  setUpNext: (video: VideoItem | null) => void;
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

const ROOM_TOKEN_PREFIX = "nt_room_token:";
const roomTokenFor = (code: string) => {
  try {
    return window.sessionStorage.getItem(ROOM_TOKEN_PREFIX + code) || "";
  } catch {
    return "";
  }
};
const saveRoomToken = (code: string, token: string) => {
  try {
    window.sessionStorage.setItem(ROOM_TOKEN_PREFIX + code, token);
  } catch {}
};

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [currentVideo, setCurrentVideo] = useState<VideoItem | null>(null);
  const [startAt, setStartAt] = useState<number | null>(null);
  const [upNext, setUpNext] = useState<VideoItem | null>(null);
  const currentVideoRef = useRef<VideoItem | null>(null);
  currentVideoRef.current = currentVideo;
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedFraction, setBufferedFraction] = useState(0);
  const [slotElement, setSlotElement] = useState<HTMLElement | null>(null);
  // Landed on a page that isn't a video page: the player goes to the floating window (if its spot is gone)
  const pagePath = usePathname();
  useEffect(() => {
    if (pagePath.startsWith("/watch")) return;
    setSlotElement((cur) => (cur && cur.isConnected ? cur : null));
  }, [pagePath]);
  const [chapters, setChapters] = useState<ChapterItem[]>([]);
  const [clipRange, setClipRange] = useState<[number, number] | null>(null);
  const [sleepMode, setSleepMode] = useState<SleepOption>(null);
  const [sleepAt, setSleepAt] = useState<number>(0);
  const [sleepRemainingMinutes, setSleepRemainingMinutes] = useState<
    number | null
  >(null);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const roomCodeRef = useRef<string | null>(null);
  roomCodeRef.current = roomCode;
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

  // Cross-device sync (and nt__ts write tracking for backups); reload once if the cloud brought new data
  useEffect(() => {
    startSync(() => window.location.reload());
  }, []);

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
    // Same video asked to start somewhere specific (timestamp link / clip): just seek
    if (currentVideoRef.current?.id === video.id) {
      if (startSeconds !== undefined) {
        controlsRef.current?.seek(startSeconds);
        setCurrentTime(startSeconds);
      }
      return;
    }
    setCurrentVideo(video);
    setStartAt(startSeconds ?? null);
    setUpNext(null);
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
    if (el) {
      setSlotElement(el);
      return;
    }
    // Shrinking the video on purpose (swipe down / ⌄): straight to the floating window, no in-between frame
    if (miniHandoff.from) {
      setSlotElement(null);
      return;
    }
    // Leaving a watch page. Going to another video (a suggestion): the player stays where it is and the next
    // page takes it over, with no trip to the floating window and back. Going anywhere else: floating window.
    window.setTimeout(() => {
      if (window.location.pathname.startsWith("/watch")) return;
      setSlotElement((cur) => (cur && cur.isConnected ? cur : null));
    }, 0);
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
      const token = roomTokenFor(code);
      if (!token) return;
      try {
        const res = await fetch("/api/room", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "update",
            code,
            token,
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

  // The server generates the room code and a secret token; only token holders can steer the room
  const createWatchRoom = useCallback(
    async (video: VideoItem): Promise<string | null> => {
      try {
        const res = await fetch("/api/room", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "create",
            vid: video.id,
            t: controlsRef.current?.getTime() || 0,
            playing: isPlaying,
            by: myUserIdRef.current,
          }),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { room?: { code: string; ts: number }; token?: string };
        if (!data.room || !data.token) return null;
        saveRoomToken(data.room.code, data.token);
        lastRoomTsRef.current = data.room.ts;
        setRoomCode(data.room.code);
        return data.room.code;
      } catch {
        return null;
      }
    },
    [isPlaying]
  );

  // Joining with the code gets a member token from the server, so the friend can steer playback too
  const joinWatchRoom = useCallback(
    async (rawCode: string): Promise<string | null> => {
      const code = rawCode
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 12);
      if (!code) return null;
      try {
        const res = await fetch("/api/room", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "join", code }),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { room?: { vid: string }; token?: string };
        if (!data.room?.vid || !data.token) return null;
        saveRoomToken(code, data.token);
        if (roomCodeRef.current !== code) showToast("دخلت الأوضة. هتتفرجوا مع بعض");
        setRoomCode(code);
        return data.room.vid;
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
        // Someone in the room moved to another video: everyone follows
        if (r.vid && r.vid !== currentVideoRef.current?.id) {
          router.push(`/watch/${encodeURIComponent(r.vid)}?room=${encodeURIComponent(roomCode)}`);
          return;
        }
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
  }, [roomCode, router]);

  const isMini = !!currentVideo && !slotElement;

  return (
    <PlayerContext.Provider
      value={{
        currentVideo,
        startAt,
        upNext,
        setUpNext,
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
