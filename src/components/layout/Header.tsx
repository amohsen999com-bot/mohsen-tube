"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AlgoEngine } from "@/lib/client/algo";
import { normArabic } from "@/lib/arabic";
import { usePlayer } from "@/components/player/PlayerContext";
import { LogoMark } from "./LogoMark";
import { InstallButton } from "./InstallButton";

const SEARCH_HINTS = [
  "ابحث عن درس، شيخ، أو مهارة…",
  "جرّب: تفسير سورة الكهف",
  "جرّب: قصص الصحابة",
  "جرّب: تعلّم Excel من الصفر",
  "جرّب: أحكام الصلاة",
  "جرّب: نجارة للمبتدئين",
  "جرّب: السيرة النبوية",
];

const RECENT_KEY = "nt_recent_searches";
const CLOCK_PATH = "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm.5-13H11v6l5.2 3.2.8-1.3-4.5-2.7V7z";
const LENS_PATH = "M15.5 14h-.8l-.3-.3A6.5 6.5 0 1 0 14 15.5l.3.3v.8l5 5 1.5-1.5-5-5zm-6 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9z";

/** Suggestions already fetched in this visit (typing back and forth doesn't ask the server again). */
const suggestMemo = new Map<string, string[]>();

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const { showToast } = usePlayer();

  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const [hasSpeech, setHasSpeech] = useState(false);
  const [listening, setListening] = useState(false);

  const [hint, setHint] = useState(0);
  const [hintOut, setHintOut] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const tabsRef = useRef<HTMLElement | null>(null);
  const inkRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const SR =
        (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown })
          .SpeechRecognition ||
        (window as unknown as { webkitSpeechRecognition?: unknown })
          .webkitSpeechRecognition;
      setHasSpeech(Boolean(SR));
    }
  }, []);

  // "/" keyboard shortcut focuses search input
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "/" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !(e.target as HTMLElement | null)?.closest?.(
          "input, textarea, select, [contenteditable]"
        )
      ) {
        e.preventDefault();
        document.body.classList.remove("hdr-hide");
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Glass when scrolled; hides while scrolling down (content gets the screen), back on any scroll up.
  // --hdr-h lets the sticky topic chips sit right under it (it's taller on phones).
  useEffect(() => {
    let lastY = window.scrollY;
    const measure = () => {
      if (headerRef.current) {
        document.documentElement.style.setProperty("--hdr-h", headerRef.current.offsetHeight + "px");
      }
    };
    const onScroll = () => {
      const y = window.scrollY;
      const b = document.body;
      b.classList.toggle("scrolled", y > 8);
      if (Math.abs(y - lastY) < 6) return;
      // Stay put only while typing a search (keyboard open); a tapped tab or icon keeps focus too, but must not pin the header
      const searching = document.activeElement === inputRef.current;
      b.classList.toggle("hdr-hide", y > lastY && y > 140 && !searching);
      lastY = y;
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", onScroll);
      document.body.classList.remove("hdr-hide");
    };
  }, []);

  // Sliding gold capsule behind the active tab
  useEffect(() => {
    const place = () => {
      const ink = inkRef.current;
      const on = tabsRef.current?.querySelector<HTMLElement>("a.on");
      if (!ink) return;
      ink.style.opacity = on ? "1" : "0";
      if (on) {
        ink.style.left = on.offsetLeft + "px";
        ink.style.width = on.offsetWidth + "px";
      }
    };
    place();
    document.fonts?.ready.then(place).catch(() => {});
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [pathname]);

  // Rotating placeholder ideas (a blank box makes people hesitate), only while empty and unfocused
  useEffect(() => {
    const id = setInterval(() => {
      if (query || document.activeElement === inputRef.current || document.hidden) return;
      setHintOut(true);
      setTimeout(() => {
        setHint((h) => (h + 1) % SEARCH_HINTS.length);
        setHintOut(false);
      }, 380);
    }, 4200);
    return () => clearInterval(id);
  }, [query]);

  // Autocomplete like YouTube: short completions of the typed words (channels, common phrases), plus your recent searches
  useEffect(() => {
    try {
      setRecent(JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"));
    } catch {}
  }, [showSuggest]);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    const known = suggestMemo.get(query);
    if (known) {
      setSuggestions(known);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&complete=1`);
        if (!res.ok) return;
        const data = await res.json();
        const list: string[] = data.suggestions || [];
        if (suggestMemo.size > 300) suggestMemo.clear();
        suggestMemo.set(query, list);
        setSuggestions(list);
      } catch {}
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const runSearch = (text: string) => {
    const q = text.trim();
    if (!q) return;
    setQuery(q);
    setShowSuggest(false);
    inputRef.current?.blur();
    AlgoEngine.recordSearch(q);
    try {
      const prev: string[] = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
      localStorage.setItem(RECENT_KEY, JSON.stringify([q, ...prev.filter((x) => x !== q)].slice(0, 12)));
    } catch {}
    router.push(`/search?q=${encodeURIComponent(q)}`);
  };
  const forgetRecent = (text: string) => {
    const next = recent.filter((x) => x !== text);
    setRecent(next);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {}
  };
  // what the list shows: matching recent searches first (clock icon), then completions
  const typed = query.trim();
  const recentShown = recent.filter((r) => !typed || r.startsWith(typed)).slice(0, typed ? 3 : 8);
  const suggestShown = typed.length >= 2 ? suggestions.filter((s) => !recentShown.includes(s)).slice(0, 10 - recentShown.length) : [];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runSearch(query);
  };

  const handleVoiceSearch = () => {
    const w = window as unknown as {
      SpeechRecognition?: new () => {
        lang: string;
        interimResults: boolean;
        onresult: (e: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void;
        onend: () => void;
        onerror: () => void;
        start: () => void;
      };
      webkitSpeechRecognition?: new () => {
        lang: string;
        interimResults: boolean;
        onresult: (e: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void;
        onend: () => void;
        onerror: () => void;
        start: () => void;
      };
    };
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = "ar-EG";
    rec.interimResults = true;
    setListening(true);
    showToast("اتكلم… بسمعك", 0);
    rec.onresult = (e) => {
      const results = Array.from(e.results);
      const text = results.map((x) => x[0].transcript).join(" ");
      setQuery(text);
      if (results[results.length - 1]?.isFinal && text.trim()) {
        runSearch(text);
      }
    };
    rec.onend = () => {
      setListening(false);
    };
    rec.onerror = () => {
      setListening(false);
      showToast("ما سمعتش حاجة، جرّب تاني", 2000);
    };
    rec.start();
  };

  const isHome = pathname === "/";
  const isFun = pathname === "/fun";
  const isSubs = pathname === "/subs";
  const isLibrary = pathname.startsWith("/library");

  return (
    <header className="top" ref={headerRef}>
      <div className="hdr-start">
        <Link href="/" className="logo" aria-label="محسن تيوب">
          <LogoMark className="logo-mark" />
          <span className="logo-txt">
            <b>محسن</b>
            <b>تيوب</b>
          </span>
        </Link>

        <nav className="tabs" ref={tabsRef}>
          <Link href="/" className={isHome ? "on" : ""}>
            مقترح لك
          </Link>
          <Link href="/fun" className={isFun ? "on" : ""}>
            ترفيه
          </Link>
          <span className="ink" ref={inkRef} />
        </nav>
      </div>

      <form
        ref={formRef}
        className={`search ${query.trim() ? "has-q" : ""}`}
        role="search"
        onSubmit={handleSubmit}
        onBlur={(e) => {
          if (!formRef.current?.contains(e.relatedTarget as Node)) {
            setTimeout(() => setShowSuggest(false), 150);
          }
        }}
      >
        <svg className="s-lens" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M10.5 3a7.5 7.5 0 0 1 5.96 12.05l4.25 4.24-1.42 1.42-4.24-4.25A7.5 7.5 0 1 1 10.5 3zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z" />
        </svg>
        <input
          ref={inputRef}
          id="q"
          type="search"
          placeholder={SEARCH_HINTS[hint]}
          className={hintOut ? "ph-out" : ""}
          autoComplete="off"
          aria-label="بحث"
          value={query}
          onFocus={() => setShowSuggest(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowSuggest(true);
          }}
        />
        <kbd className="s-key" title="اضغط / عشان تبحث على طول">
          /
        </kbd>
        {hasSpeech && (
          <button
            type="button"
            className={`mic ${listening ? "on" : ""}`}
            aria-label="بحث بالصوت"
            title="بحث بالصوت"
            onClick={handleVoiceSearch}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11h-2z" />
            </svg>
          </button>
        )}
        <button type="submit" className="s-go" aria-label="بحث">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z" />
          </svg>
        </button>

        {showSuggest && (recentShown.length > 0 || suggestShown.length > 0) && (
          <ul className="suggest yt-suggest" role="listbox">
            {[...recentShown.map((t) => ({ t, recent: true })), ...suggestShown.map((t) => ({ t, recent: false }))].map(({ t, recent: isRecent }) => {
              // the typed part stays regular, the completion is bold (compared without hamzas/diacritics)
              const head = typed && normArabic(t).startsWith(normArabic(typed)) ? t.slice(0, typed.length) : "";
              return (
                <li key={(isRecent ? "r:" : "s:") + t} role="option" aria-selected={false}>
                  <button type="button" className="sg-row" onMouseDown={(e) => e.preventDefault()} onClick={() => runSearch(t)}>
                    <svg className="sg-ico" viewBox="0 0 24 24" aria-hidden="true">
                      <path d={isRecent ? CLOCK_PATH : LENS_PATH} />
                    </svg>
                    <span className="sg-text">
                      {head}
                      <b>{t.slice(head.length)}</b>
                    </span>
                  </button>
                  {isRecent ? (
                    <button type="button" className="sg-side" aria-label="امسح من البحث السابق" onMouseDown={(e) => e.preventDefault()} onClick={() => forgetRecent(t)}>
                      ✕
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="sg-side"
                      aria-label="حطّها في خانة البحث"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setQuery(t + " ");
                        inputRef.current?.focus();
                      }}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M17 7H9.4l9.3 9.3-1.4 1.4L8 8.4V16H6V5h11z" />
                      </svg>
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </form>

      <div className="hdr-end">
        <InstallButton />
        <Link
          href="/subs"
          className={`lib-link subs-link ${isSubs ? "on" : ""}`}
          aria-label="اشتراكاتك"
          title="اشتراكاتك"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 6h16v2H4V6zm2-4h12v2H6V2zm-2 8h16v12H4V10zm6 2.5v7l6-3.5-6-3.5z" />
          </svg>
          <span>اشتراكاتك</span>
        </Link>
        <Link
          href="/library"
          className={`lib-link ${isLibrary ? "on" : ""}`}
          aria-label="مكتبتك"
          title="مكتبتك"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 5h2v14H4V5zm4 0h2v14H8V5zm4.3.6 1.9-.6 4.5 13.4-1.9.6L12.3 5.6z" />
          </svg>
          <span>مكتبتك</span>
        </Link>
      </div>
    </header>
  );
}
