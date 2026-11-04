"use client";

import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { VideoItem } from "@/lib/types";
import { formatDuration, formatRelativeArabicDate } from "@/lib/arabic";
import { ClientStore } from "@/lib/client/store";
import { PageSkeleton } from "@/components/ui/Skeleton";

function SearchContent() {
  const searchParams = useSearchParams();
  const q = (searchParams.get("q") || "").trim();

  const [results, setResults] = useState<VideoItem[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!q) {
      setResults([]);
      return;
    }
    let active = true;
    setLoading(true);
    // No filter chips: results always come best-match first
    const params = new URLSearchParams({ q, sort: "rel", limit: "100" });
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
  }, [q]);

  return (
    <div className="search-page">
      <h2 className="sec">نتائج البحث: {q}</h2>

      {loading ? (
        <PageSkeleton kind="feed" />
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
    <Suspense fallback={<PageSkeleton kind="feed" />}>
      <SearchContent />
    </Suspense>
  );
}
