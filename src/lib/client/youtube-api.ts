/**
 * Singleton YouTube IFrame API Manager.
 * Fixes the original race condition where both `app.js` (Hero) and `player.js` (Dock)
 * overwrote `window.onYouTubeIframeAPIReady`.
 */

export interface YTPlayerInstance {
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  setVolume(volume: number): void;
  getVolume(): number;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getVideoLoadedFraction(): number;
  setPlaybackRate(rate: number): void;
  getPlaybackRate(): number;
  loadModule(module: string): void;
  unloadModule(module: string): void;
  destroy(): void;
}

export interface YTPlayerOptions {
  host?: string;
  videoId?: string;
  playerVars?: Record<string, string | number>;
  events?: {
    onReady?: (event: { target: YTPlayerInstance }) => void;
    onStateChange?: (event: { data: number; target: YTPlayerInstance }) => void;
    onError?: (event: { data: number }) => void;
  };
}

export const YTPlayerState = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const;

declare global {
  interface Window {
    YT?: {
      Player: new (
        el: HTMLElement | string,
        options: YTPlayerOptions
      ) => YTPlayerInstance;
      PlayerState: typeof YTPlayerState;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

const readyQueue: Array<() => void> = [];
let scriptInjected = false;

export function onYouTubeReady(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  if (window.YT?.Player) {
    cb();
    return () => {};
  }

  readyQueue.push(cb);

  if (!scriptInjected) {
    scriptInjected = true;
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      while (readyQueue.length > 0) {
        const fn = readyQueue.shift();
        try {
          fn?.();
        } catch (err) {
          console.error("YouTube ready callback error:", err);
        }
      }
    };

    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      document.head.appendChild(script);
    }
  }

  return () => {
    const idx = readyQueue.indexOf(cb);
    if (idx >= 0) readyQueue.splice(idx, 1);
  };
}
