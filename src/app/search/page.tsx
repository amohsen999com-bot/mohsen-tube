"use client";

import React, { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { VideoItem } from "@/lib/types";
import { VideoCard } from "@/components/video/VideoCard";
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
        <div className="grid">
          {results.map((v) => (
            <VideoCard
              key={v.id}
              video={v}
              onHidden={(id) => setResults((prev) => prev.filter((x) => x.id !== id))}
            />
          ))}
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
