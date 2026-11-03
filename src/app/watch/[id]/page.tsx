"use client";

import React, { use, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { VideoDetailResponse } from "@/lib/types";
import {
  formatDuration,
  formatRelativeArabicDate,
  normArabic,
} from "@/lib/arabic";
import { usePlayer } from "@/components/player/PlayerContext";
import { VideoCard } from "@/components/video/VideoCard";
import { QuoteModal } from "@/components/modals/QuoteModal";
import { ClientStore, subscribeStore } from "@/lib/client/store";
import { AlgoEngine } from "@/lib/client/algo";

const DUAS = [
  "جزاك الله خيرًا",
  "نفعك الله به",
  "زادك الله علمًا",
  "بارك الله فيك",
  "جعله في ميزانك",
  "ربنا يكرمك",
];

const AUDIENCE_OPTS = [
  "المبتدئ في الموضوع",
  "طالب العلم",
  "الشباب",
  "المتزوجين",
  "الآباء والأمهات",
  "المتخصص",
];

export default function WatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const {
    playVideo,
    attachSlot,
    seekTo,
    setChapters,
    setClipRange,
    currentTime,
    showToast,
    createWatchRoom,
    joinWatchRoom,
  } = usePlayer();

  const [detail, setDetail] = useState<VideoDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [isLiked, setIsLiked] = useState(false);
  const [likeDua, setLikeDua] = useState<string | null>(null);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [descOpen, setDescOpen] = useState(false);
  const [clipPanelOpen, setClipPanelOpen] = useState(false);
  const [clipStart, setClipStart] = useState(0);
  const [clipEnd, setClipEnd] = useState(30);
  const [clipName, setClipName] = useState("");
  const [quoteModalOpen, setQuoteModalOpen] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareAtTime, setShareAtTime] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [transcriptQuery, setTranscriptQuery] = useState("");
  const [roomModalCode, setRoomModalCode] = useState<string | null>(null);
  const [askSubmitted, setAskSubmitted] = useState(false);
  const [, setStoreTick] = useState(0);

  const playerSlotRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return subscribeStore(() => setStoreTick((n) => n + 1));
  }, []);

  // Join watch-together room if `?room=CODE` is in URL
  useEffect(() => {
    const rm = searchParams.get("room");
    if (rm) {
      joinWatchRoom(rm);
    }
  }, [searchParams, joinWatchRoom]);

  // Apply clip start/end if `?s=...&e=...` is in URL
  useEffect(() => {
    const s = Number(searchParams.get("s"));
    const e = Number(searchParams.get("e"));
    if (!Number.isNaN(s) && !Number.isNaN(e) && e > s && s >= 0) {
      setClipStart(s);
      setClipEnd(e);
      setClipRange([s, e]);
      seekTo(s);
    }
  }, [searchParams, seekTo, setClipRange]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/videos/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: VideoDetailResponse | null) => {
        if (!active) return;
        setDetail(data);
        if (data?.video) {
          ClientStore.pushHistory(data.video.id);
          setIsLiked(ClientStore.hasInList("liked", data.video.id));
          setIsSubscribed(ClientStore.isSubscribed(data.video.c));
          playVideo(data.video);
          setChapters(data.chapters || []);
          setClipStart(0);
          setClipEnd(Math.min(data.video.d || 60, 60));
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id, playVideo, setChapters]);

  // Attach global VideoDock to `#player` slot on mount, detach to mini-player on unmount
  useEffect(() => {
    if (!detail?.video || !playerSlotRef.current) return;
    attachSlot(playerSlotRef.current);
    return () => {
      attachSlot(null);
    };
  }, [detail?.video, attachSlot]);

  const handleToggleLike = () => {
    if (!detail?.video) return;
    const on = ClientStore.toggleList("liked", detail.video.id);
    setIsLiked(on);
    AlgoEngine.recordLike(detail.video, on);
    if (on) {
      const dua = DUAS[Math.floor(Math.random() * DUAS.length)];
      setLikeDua(dua);
      setTimeout(() => setLikeDua(null), 1800);
    }
  };

  const handleToggleSubscribe = () => {
    if (!detail?.video) return;
    const on = ClientStore.toggleSub(detail.video.c);
    setIsSubscribed(on);
    showToast(on ? `اشتركت في ${detail.video.c}` : "ألغيت الاشتراك");
  };

  const handleSaveClip = () => {
    if (!detail?.video) return;
    const s = Math.max(0, Math.floor(clipStart));
    const e = Math.max(s + 3, Math.floor(clipEnd));
    ClientStore.saveClip({
      vid: detail.video.id,
      t: detail.video.t,
      c: detail.video.c,
      s,
      e,
      name: clipName.trim() || detail.video.t.slice(0, 50),
    });
    setClipRange([s, e]);
    seekTo(s);
    showToast("اتحفظ المقطع في مكتبتك");
    setClipPanelOpen(false);
  };

  const handleSubmitAudienceAnswer = async (ans: string) => {
    if (!detail?.video) return;
    setAskSubmitted(true);
    try {
      await fetch("/api/label", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vid: detail.video.id,
          ch: detail.video.c,
          q: "aud",
          a: [ans],
        }),
      });
    } catch {}
  };

  const queue = ClientStore.getQueue();
  const playlists = ClientStore.getPlaylists();

  const filteredTranscript = useMemo(() => {
    if (!detail?.transcript?.lines) return [];
    const q = normArabic(transcriptQuery.trim());
    if (!q) return detail.transcript.lines;
    return detail.transcript.lines.filter((l) =>
      normArabic(l.x).includes(q)
    );
  }, [detail?.transcript?.lines, transcriptQuery]);

  if (loading) {
    return <p className="muted pad">جاري التحميل...</p>;
  }

  if (!detail?.video) {
    return <p className="pad">الفيديو غير موجود.</p>;
  }

  const { video, series, related, comments, description, chapters, transcript } =
    detail;
  const shareUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/watch/${video.id}${
          shareAtTime ? `?s=${Math.floor(currentTime)}&e=${video.d || 3600}` : ""
        }`
      : "";

  const seriesDoneCount = series
    ? series.videos.filter(
        (ep) => (ClientStore.getProgress(ep.id)?.[1] ?? 0) >= 0.9
      ).length
    : 0;

  return (
    <div className="watch">
      <div>
        {/* VideoDock mounts directly over this 16:9 slot */}
        <div ref={playerSlotRef} className="player" id="player" />

        {/* Inline Clip Builder */}
        {clipPanelOpen && (
          <div className="clip-box">
            <div className="clip-head">
              <b>✂ قص جزء ومشاركته</b>
              <span className="clip-len">
                {formatDuration(Math.max(0, clipEnd - clipStart))}
              </span>
              <button
                type="button"
                aria-label="قفل"
                onClick={() => {
                  setClipPanelOpen(false);
                  setClipRange(null);
                }}
              >
                ✕
              </button>
            </div>
            <div className="clip-ctl" dir="ltr">
              <div className="clip-end">
                <small>البداية</small>
                <span>
                  <button
                    type="button"
                    onClick={() => setClipStart(Math.max(0, clipStart - 5))}
                  >
                    -5s
                  </button>
                  <input
                    type="text"
                    readOnly
                    value={formatDuration(clipStart)}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setClipStart(Math.min(clipEnd - 3, clipStart + 5))
                    }
                  >
                    +5s
                  </button>
                </span>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setClipStart(Math.floor(currentTime))}
                >
                  من اللحظة دي
                </button>
              </div>
              <div className="clip-end">
                <small>النهاية</small>
                <span>
                  <button
                    type="button"
                    onClick={() =>
                      setClipEnd(Math.max(clipStart + 3, clipEnd - 5))
                    }
                  >
                    -5s
                  </button>
                  <input type="text" readOnly value={formatDuration(clipEnd)} />
                  <button
                    type="button"
                    onClick={() =>
                      setClipEnd(Math.min(video.d || 3600, clipEnd + 5))
                    }
                  >
                    +5s
                  </button>
                </span>
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    setClipEnd(
                      Math.max(clipStart + 5, Math.floor(currentTime))
                    )
                  }
                >
                  للحظة دي
                </button>
              </div>
            </div>
            <div className="modal-bar clip-bar">
              <input
                className="clip-name"
                placeholder="عنوان للمقطع (اختياري)…"
                value={clipName}
                onChange={(e) => setClipName(e.target.value)}
              />
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setClipRange([clipStart, clipEnd]);
                  seekTo(clipStart);
                }}
              >
                ▶ معـاينة
              </button>
              <button
                type="button"
                className="btn gold"
                onClick={handleSaveClip}
              >
                احفظ في مقاطعك
              </button>
            </div>
          </div>
        )}

        <h1>{video.t}</h1>

        <div className="owner-row">
          <div className="owner">
            <Link
              className="owner-link"
              href={`/channel/${encodeURIComponent(video.c)}`}
            >
              <span className="avatar">{video.c.slice(0, 1)}</span>
              <span>
                <b>{video.c}</b>
                <small className="muted">{video.tp}</small>
              </span>
            </Link>
            <button
              type="button"
              className={`btn subscribe ${isSubscribed ? "on" : ""}`}
              onClick={handleToggleSubscribe}
            >
              {isSubscribed ? "مشترك ✓" : "اشترك"}
            </button>
          </div>

          <div className="actions">
            <button
              type="button"
              className={`btn like-btn ${isLiked ? "on" : ""} ${
                likeDua ? "pop" : ""
              }`}
              aria-pressed={isLiked}
              onClick={handleToggleLike}
            >
              <span className="lk-heart">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 20.6 10.6 19.3C5.6 14.8 2.3 11.8 2.3 8.1 2.3 5.1 4.6 2.8 7.6 2.8c1.7 0 3.3.8 4.4 2.1 1.1-1.3 2.7-2.1 4.4-2.1 3 0 5.3 2.3 5.3 5.3 0 3.7-3.3 6.7-8.3 11.2L12 20.6z" />
                </svg>
              </span>
              <span className="lk-lbl">استفدت منه</span>
              {likeDua && <span className="lk-toast">{likeDua}</span>}
            </button>

            <button
              type="button"
              className="btn icon-btn"
              onClick={() => setShareModalOpen(true)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M14 4l7 7-7 7v-4.1c-5 0-8.5 1.6-11 5.1 1-5 4-10 11-11V4z" />
              </svg>
              <span>مشاركة</span>
            </button>

            <button
              type="button"
              className="btn icon-btn"
              onClick={() => {
                setClipStart(Math.floor(currentTime));
                setClipEnd(
                  Math.min(video.d || 3600, Math.floor(currentTime) + 30)
                );
                setClipPanelOpen((prev) => !prev);
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9.6 7.6A3.5 3.5 0 1 0 8 9.3l2.4 2.7-2.4 2.7a3.5 3.5 0 1 0 1.6 1.7l2.4-2.7 6.6 7.3H22L9.6 7.6zM6.5 8a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm0 11a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM18.6 3l-5.2 5.8 1.6 1.7L22 3h-3.4z" />
              </svg>
              <span>قص</span>
            </button>

            <button
              type="button"
              className="btn icon-btn"
              onClick={() => setQuoteModalOpen(true)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 17h4l2-4V7H5v6h3l-2 4zm8 0h4l2-4V7h-6v6h3l-2 4z" />
              </svg>
              <span>اقتباس</span>
            </button>

            <button
              type="button"
              className="btn icon-btn"
              onClick={() => setSaveModalOpen(true)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 4h14v17l-7-4-7 4V4zm2 2v11.6l5-2.9 5 2.9V6H7z" />
              </svg>
              <span>حفظ</span>
            </button>

            <div className="more-wrap">
              <button
                type="button"
                className="btn icon-btn more-btn"
                aria-label="المزيد"
                onClick={() => setMoreMenuOpen((prev) => !prev)}
              >
                ⋯
              </button>
              {moreMenuOpen && (
                <div className="dl-menu more-menu">
                  <button
                    type="button"
                    onClick={() => {
                      setMoreMenuOpen(false);
                      setTranscriptOpen((prev) => !prev);
                    }}
                  >
                    <b>النص المكتوب</b>
                    <small>الكلام بالتوقيت وتدوّر جواه</small>
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      setMoreMenuOpen(false);
                      const code = await createWatchRoom(video);
                      if (code) setRoomModalCode(code);
                    }}
                  >
                    <b>اتفرج مع صاحبك</b>
                    <small>نفس الفيديو في نفس اللحظة</small>
                  </button>
                </div>
              )}
            </div>

            {series?.nextVideo && (
              <Link className="btn" href={`/watch/${series.nextVideo.id}`}>
                الحلقة اللي بعدها ←
              </Link>
            )}
          </div>
        </div>

        {/* Description & Chapters */}
        {(video.dt || description || chapters.length > 0) && (
          <div className={`desc ${descOpen ? "open" : ""}`} id="desc">
            {video.dt && <b>{formatRelativeArabicDate(video.dt)}</b>}
            {(description || chapters.length > 0) && (
              <div className="desc-body">
                {description && <div className="desc-text">{description}</div>}
                {chapters.length > 0 && (
                  <div className="chapters">
                    <h4>الفصول</h4>
                    {chapters.map((ch, idx) => (
                      <a
                        key={idx}
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          seekTo(ch.t);
                        }}
                      >
                        <span>{formatDuration(ch.t)}</span>
                        {ch.title}
                      </a>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  className="desc-more"
                  onClick={() => setDescOpen((prev) => !prev)}
                >
                  {descOpen ? "عرض أقل" : "المزيد"}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Viewer Feedback Card (ask) */}
        {!askSubmitted ? (
          <div className="ask">
            <div className="ask-head">
              <b>سؤال سريع: الفيديو ده مناسب أكتر لمين؟</b>
            </div>
            <div className="ob-chips" style={{ marginTop: 8 }}>
              {AUDIENCE_OPTS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  className="ob-chip"
                  onClick={() => handleSubmitAudienceAnswer(opt)}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="ask done">
            جزاك الله خيرًا. إجابتك هتساعد الفيديو ده يوصل للي محتاجه.
          </div>
        )}

        {/* Series Accordion */}
        {series && series.videos.length > 0 && (
          <details className="series" open>
            <summary>
              {series.title} ({seriesDoneCount} من {series.videos.length} مكتمل)
            </summary>
            <ol>
              {series.videos.map((ep) => (
                <li key={ep.id} className={ep.id === video.id ? "on" : ""}>
                  <Link href={`/watch/${ep.id}`}>
                    {ep.t} <small className="muted">({formatDuration(ep.d)})</small>
                  </Link>
                </li>
              ))}
            </ol>
          </details>
        )}

        {/* Pre-fetched Comments */}
        {comments.length > 0 && (
          <div id="comments">
            <h2 className="sec">التعليقات</h2>
            {comments.map((c, idx) => (
              <div key={idx} className="cmt">
                <b>{c.a.replace(/^@/, "")}</b>
                <p>{c.t}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sidebar: Transcript + Queue + Related Videos */}
      <div className="side-list">
        {transcriptOpen && (
          <div className="tr">
            <div className="tr-head">
              <b>النص المكتوب</b>
              <button
                type="button"
                aria-label="قفل"
                onClick={() => setTranscriptOpen(false)}
              >
                ✕
              </button>
            </div>
            {transcript?.lines?.length ? (
              <>
                <input
                  className="tr-find"
                  type="search"
                  placeholder="دوّر في النص…"
                  value={transcriptQuery}
                  onChange={(e) => setTranscriptQuery(e.target.value)}
                />
                <div className="tr-lines" dir="auto">
                  {filteredTranscript.map((l, idx) => (
                    <a
                      key={idx}
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        seekTo(l.t);
                      }}
                    >
                      <span>{formatDuration(l.t)}</span>
                      <p>{l.x}</p>
                    </a>
                  ))}
                </div>
              </>
            ) : (
              <p className="muted">الفيديو ده مفيهوش نص مكتوب محفوظ حالياً.</p>
            )}
          </div>
        )}

        {queue.length > 0 && (
          <div className="series" style={{ marginBottom: 16 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <b>قائمة الانتظار ({queue.length})</b>
              <button
                type="button"
                className="link-btn"
                onClick={() => ClientStore.clearQueue()}
              >
                مسح
              </button>
            </div>
            <ol>
              {queue.map((qv) => (
                <li key={qv.id}>
                  <Link href={`/watch/${qv.id}`}>{qv.t}</Link>
                </li>
              ))}
            </ol>
          </div>
        )}

        {related
          .filter((rv) => ClientStore.isAllowed(rv))
          .map((rv) => (
            <VideoCard key={rv.id} video={rv} />
          ))}
      </div>

      {/* Quote Generator Modal */}
      {quoteModalOpen && (
        <QuoteModal
          video={video}
          onClose={() => setQuoteModalOpen(false)}
        />
      )}

      {/* Share Modal */}
      {shareModalOpen && (
        <div
          className="modal"
          onClick={(e) =>
            e.target === e.currentTarget && setShareModalOpen(false)
          }
        >
          <div className="modal-box share-box">
            <h3>مشاركة</h3>
            <div className="share-link">
              <input readOnly dir="ltr" value={shareUrl} />
              <button
                type="button"
                className="btn gold"
                onClick={() => {
                  navigator.clipboard?.writeText(shareUrl).catch(() => {});
                  showToast("اتنسخ اللينك");
                }}
              >
                نسخ
              </button>
            </div>
            {currentTime > 5 && (
              <label className="pl-row" style={{ marginTop: 12 }}>
                <input
                  type="checkbox"
                  checked={shareAtTime}
                  onChange={(e) => setShareAtTime(e.target.checked)}
                />{" "}
                ابدأ من {formatDuration(currentTime)}
              </label>
            )}
            <div className="modal-bar">
              <button
                type="button"
                className="btn"
                onClick={() => setShareModalOpen(false)}
              >
                قفل
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save to Playlist Modal */}
      {saveModalOpen && (
        <div
          className="modal"
          onClick={(e) =>
            e.target === e.currentTarget && setSaveModalOpen(false)
          }
        >
          <div className="modal-box">
            <h3>احفظ في...</h3>
            <label className="pl-row">
              <input
                type="checkbox"
                checked={ClientStore.hasInList("later", video.id)}
                onChange={() => ClientStore.toggleList("later", video.id)}
              />{" "}
              شاهد لاحقًا
            </label>
            {Object.keys(playlists).map((plName) => (
              <label key={plName} className="pl-row">
                <input
                  type="checkbox"
                  checked={(playlists[plName] || []).includes(video.id)}
                  onChange={() =>
                    ClientStore.toggleInPlaylist(plName, video.id)
                  }
                />{" "}
                {plName}
              </label>
            ))}
            <div className="share-link" style={{ marginTop: 12 }}>
              <input
                placeholder="اسم قائمة جديدة…"
                value={newPlaylistName}
                onChange={(e) => setNewPlaylistName(e.target.value)}
              />
              <button
                type="button"
                className="btn gold"
                onClick={() => {
                  const name = newPlaylistName.trim();
                  if (!name) return;
                  ClientStore.toggleInPlaylist(name, video.id);
                  setNewPlaylistName("");
                }}
              >
                إضافة
              </button>
            </div>
            <div className="modal-bar">
              <button
                type="button"
                className="btn"
                onClick={() => setSaveModalOpen(false)}
              >
                تم
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Watch-Together Room Created Modal */}
      {roomModalCode && (
        <div
          className="modal"
          onClick={(e) =>
            e.target === e.currentTarget && setRoomModalCode(null)
          }
        >
          <div className="modal-box">
            <h3>اتفرج مع صاحبك</h3>
            <p className="muted">
              ابعت اللينك ده لصاحبك. أي حد فيكم يشغّل أو يوقف أو يقدّم، التاني
              بيمشي معاه.
            </p>
            <div className="share-link">
              <input
                readOnly
                dir="ltr"
                value={`${window.location.origin}/watch/${video.id}?room=${roomModalCode}`}
              />
              <button
                type="button"
                className="btn gold"
                onClick={() => {
                  navigator.clipboard
                    ?.writeText(
                      `${window.location.origin}/watch/${video.id}?room=${roomModalCode}`
                    )
                    .catch(() => {});
                  showToast("اتنسخ اللينك");
                }}
              >
                نسخ
              </button>
            </div>
            <div className="modal-bar">
              <button
                type="button"
                className="btn"
                onClick={() => setRoomModalCode(null)}
              >
                تمام
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
