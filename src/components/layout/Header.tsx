"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { VideoItem } from "@/lib/types";
import { AlgoEngine } from "@/lib/client/algo";
import { usePlayer } from "@/components/player/PlayerContext";

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const { showToast } = usePlayer();

  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<VideoItem[]>([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const [hasSpeech, setHasSpeech] = useState(false);
  const [listening, setListening] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

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
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Scroll glass effect
  useEffect(() => {
    const onScroll = () => {
      document.body.classList.toggle("scrolled", window.scrollY > 8);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Debounced search autocomplete suggestions
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(q)}&suggest=1`
        );
        if (!res.ok) return;
        const data = await res.json();
        setSuggestions(data.results || []);
      } catch {}
    }, 180);
    return () => clearTimeout(timer);
  }, [query]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setShowSuggest(false);
    AlgoEngine.recordSearch(q);
    router.push(`/search?q=${encodeURIComponent(q)}`);
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
        setShowSuggest(false);
        AlgoEngine.recordSearch(text.trim());
        router.push(`/search?q=${encodeURIComponent(text.trim())}`);
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
    <header className="top">
      <div className="hdr-start">
        <Link href="/" className="logo" aria-label="محسن تيوب">
          <span className="logo-mark">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 5.2v13.6c0 .8.9 1.3 1.6.8l10.3-6.8c.6-.4.6-1.2 0-1.6L9.6 4.4C8.9 3.9 8 4.4 8 5.2z" />
            </svg>
          </span>
          <span className="logo-txt">
            محسن<span>تيوب</span>
          </span>
        </Link>

        <nav className="tabs">
          <Link href="/" className={isHome ? "on" : ""}>
            مقترح لك
          </Link>
          <Link href="/fun" className={isFun ? "on" : ""}>
            ترفيه
          </Link>
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
          placeholder="ابحث عن درس، شيخ، أو مهارة…"
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

        {showSuggest && suggestions.length > 0 && (
          <div className="suggest">
            {suggestions.map((v) => (
              <Link
                key={v.id}
                href={`/watch/${v.id}`}
                onClick={() => setShowSuggest(false)}
              >
                <span className="s-ico">⌕</span>
                <span>{v.t}</span>
              </Link>
            ))}
          </div>
        )}
      </form>

      <div className="hdr-end">
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
