"use client";

import React, { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { VideoItem } from "@/lib/types";
import { formatDuration, formatRelativeArabicDate } from "@/lib/arabic";
import { ClientStore } from "@/lib/client/store";

function SearchContent() {
  const searchParams = useSearchParams();
  const q = (searchParams.get("q") || "").trim();

  const [results, setResults] = useState<VideoItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [durFilter, setDurFilter] = useState<"" | "short" | "mid" | "long">("");
  const [channelFilter, setChannelFilter] = useState<string>("");
  const [sortBy, setSortBy] = useState<"rel" | "new" | "short">("rel");

  useEffect(() => {
    if (!q) {
      setResults([]);
      return;
    }
    let active = true;
    setLoading(true);
    const params = new URLSearchParams({
      q,
      dur: durFilter,
      c: channelFilter,
      sort: sortBy,
      limit: "100",
    });
    fetch(`/api/search?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        if (!active) return;
        const list = (data.results || []).filter((v: VideoItem) =>
          ClientStore.isAllowed(v)
        );
        setResults(list);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [q, durFilter, channelFilter, sortBy]);

  const channelsInResults = useMemo(() => {
    return [...new Set(results.map((r) => r.c))];
  }, [results]);

  return (
    <div className="search-page">
      <h2 className="sec">نتائج البحث: {q}</h2>

      <div className="topic-chips" style={{ marginBottom: 18, flexWrap: "wrap" }}>
        <button
          type="button"
          className={durFilter === "" ? "on" : ""}
          onClick={() => setDurFilter("")}
        >
          كل المدد
        </button>
        <button
          type="button"
          className={durFilter === "short" ? "on" : ""}
          onClick={() => setDurFilter("short")}
        >
          أقل من 10 دقايق
        </button>
        <button
          type="button"
          className={durFilter === "mid" ? "on" : ""}
          onClick={() => setDurFilter("mid")}
        >
          10 - 30 دقيقة
        </button>
        <button
          type="button"
          className={durFilter === "long" ? "on" : ""}
          onClick={() => setDurFilter("long")}
        >
          أطول من 30 دقيقة
        </button>

        <select
          className="btn"
          value={sortBy}
          onChange={(e) =>
            setSortBy(e.target.value as "rel" | "new" | "short")
          }
        >
          <option value="rel">الأقرب للبحث</option>
          <option value="new">الأحدث</option>
          <option value="short">الأقصر</option>
        </select>

        {channelsInResults.length > 1 && (
          <select
            className="btn"
            value={channelFilter}
            onChange={(e) => setChannelFilter(e.target.value)}
          >
            <option value="">كل القنوات</option>
            {channelsInResults.map((ch) => (
              <option key={ch} value={ch}>
                {ch}
              </option>
            ))}
          </select>
        )}
      </div>

      {loading ? (
        <p className="muted pad">بيبحث في أكتر من 100 ألف درس وفيديو…</p>
      ) : results.length === 0 ? (
        <p className="muted pad">مفيش نتايج. جرّب كلمة تانية.</p>
      ) : (
        <div className="results">
          {results.map((v) => {
            const prog = ClientStore.getProgress(v.id);
            return (
              <Link key={v.id} className="res-row" href={`/watch/${v.id}`}>
                <div className="thumb">
                  <img
                    loading="lazy"
                    className="ld"
                    src={`https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`}
                    alt=""
                  />
                  <span className="dur">{formatDuration(v.d)}</span>
                  {prog && (
                    <span className="bar">
                      <i style={{ width: `${Math.max(prog[1] * 100, 4)}%` }} />
                    </span>
                  )}
                </div>
                <div className="res-info">
                  <h3>{v.t}</h3>
                  <div className="meta">
                    {v.c} • {v.tp}
                    {v.dt ? ` • ${formatRelativeArabicDate(v.dt)}` : ""}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<p className="muted pad">جاري التحميل...</p>}>
      <SearchContent />
    </Suspense>
  );
}
