"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { VideoItem } from "@/lib/types";
import { VideoCard } from "@/components/video/VideoCard";
import {
  ClientStore,
  SavedClip,
  subscribeStore,
} from "@/lib/client/store";
import {
  calculatePrayerTimes,
  getPrayerLocation,
   getWird,
  isPrayerPauseEnabled,
  PRAYER_NAMES,
  setPrayerLocation,
  setPrayerPauseEnabled,
  setWirdGoal,
} from "@/lib/client/prayer";
import { formatDuration } from "@/lib/arabic";
import { usePlayer } from "@/components/player/PlayerContext";
import { AccountSection } from "@/components/library/AccountSection";
import { Glyph } from "@/components/ui/Glyph";
import { currentUser } from "@/lib/client/sync";

type View = "history" | "later" | "liked" | "clips" | null;
const VIEWS = ["history", "later", "liked", "clips"] as const;

export default function LibraryPage() {
  const { showToast } = usePlayer();
  const [historyVideos, setHistoryVideos] = useState<VideoItem[]>([]);
  const [laterVideos, setLaterVideos] = useState<VideoItem[]>([]);
  const [likedVideos, setLikedVideos] = useState<VideoItem[]>([]);
  const [clips, setClips] = useState<SavedClip[]>([]);
  const [wirdGoalState, setWirdGoalState] = useState<number>(20);
  const [prayerPause, setPrayerPause] = useState<boolean>(true);
  const [locName, setLocName] = useState<string>("القاهرة");
  const [tick, setTick] = useState(0);

  // YouTube-style "أنت" page: profile on top, history shelf, then the library as rows.
  // A row opens its full list in place, and the phone's back button closes it.
  const [view, setView] = useState<View>(null);
  const [who, setWho] = useState<{ email: string; name?: string; avatar?: string } | null>(null);
  const [avatarOk, setAvatarOk] = useState(true);

  useEffect(() => {
    return subscribeStore(() => setTick((n) => n + 1));
  }, []);

  useEffect(() => {
    setWho(currentUser());
    const fromHash = () => {
      const h = window.location.hash.slice(1) as (typeof VIEWS)[number];
      setView(VIEWS.includes(h) ? h : null);
    };
    fromHash();
    window.addEventListener("popstate", fromHash);
    return () => window.removeEventListener("popstate", fromHash);
  }, []);

  useEffect(() => {
    setClips(ClientStore.getClips());
    setWirdGoalState(getWird().goal);
    setPrayerPause(isPrayerPauseEnabled());
    setLocName(getPrayerLocation().name);

    const histIds = ClientStore.getList("history").slice(0, 24);
    const laterIds = ClientStore.getList("later").slice(0, 24);
    const likedIds = ClientStore.getList("liked").slice(0, 24);
    const allIds = [...new Set([...histIds, ...laterIds, ...likedIds])];

    if (!allIds.length) {
      setHistoryVideos([]);
      setLaterVideos([]);
      setLikedVideos([]);
      return;
    }

    fetch(`/api/videos?ids=${encodeURIComponent(allIds.join(","))}`)
      .then((r) => r.json())
      .then((data) => {
        const byId = new Map<string, VideoItem>(
          (data.videos || []).map((v: VideoItem) => [v.id, v])
        );
        setHistoryVideos(
          histIds.map((id) => byId.get(id)).filter((v): v is VideoItem => !!v)
        );
        setLaterVideos(
          laterIds.map((id) => byId.get(id)).filter((v): v is VideoItem => !!v)
        );
        setLikedVideos(
          likedIds.map((id) => byId.get(id)).filter((v): v is VideoItem => !!v)
        );
      })
      .catch(() => {});
  }, [tick]);

  const prayerTimes = calculatePrayerTimes();
  const fmtTime = (d: Date) =>
    d.toLocaleTimeString("ar-EG", { hour: "numeric", minute: "2-digit" });

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      showToast("المتصفح مش بيدعم تحديد الموقع");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPrayerLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          name: "موقعك الحالي",
        });
        setLocName("موقعك الحالي");
        showToast("اتحدّثت مواقيت الصلاة حسب موقعك");
      },
      () => {
        showToast("تعذّر الحصول على موقعك");
      }
    );
  };

  const openView = (v: Exclude<View, null>) => {
    window.history.pushState(null, "", "#" + v);
    setView(v);
    window.scrollTo(0, 0);
  };
  const closeView = () => {
    if (window.location.hash) window.history.back();
    else setView(null);
  };
  const jump = (id: string) =>
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  const name = who ? who.name || who.email.split("@")[0] : "ضيف محسن تيوب";
  const initial = who ? name.charAt(0).toUpperCase() : "م";
  const handle = who ? who.email : "بياناتك محفوظة على الجهاز ده";
  const thumb = (id?: string) => (id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : "");

  const rows: Array<{ key: Exclude<View, null>; title: string; sub: string; icon: string; img: string }> = [
    { key: "liked", title: "استفدت منه", sub: `${likedVideos.length} فيديو · خاص`, icon: LIB_ICONS.heart, img: thumb(likedVideos[0]?.id) },
    { key: "later", title: "شاهد لاحقًا", sub: `${laterVideos.length} فيديو · خاص`, icon: LIB_ICONS.clock, img: thumb(laterVideos[0]?.id) },
    { key: "clips", title: "مقاطعك", sub: `${clips.length} مقطع · خاص`, icon: LIB_ICONS.scissors, img: thumb(clips[0]?.vid) },
  ];
  const viewTitle = { history: "السجل", later: "شاهد لاحقًا", liked: "استفدت منه", clips: "مقاطعك" };

  return (
    <div className="you">
      {view === null ? (
        <>
          <header className="you-head">
            <div className="you-av" aria-hidden="true">
              {who?.avatar && avatarOk ? (
                <img src={who.avatar} alt="" referrerPolicy="no-referrer" onError={() => setAvatarOk(false)} />
              ) : (
                initial
              )}
            </div>
            <div className="you-id">
              <h1>{name}</h1>
              <p dir={who ? "ltr" : undefined}>{handle}</p>
            </div>
          </header>
          <div className="you-pills">
            <button type="button" className="you-pill main" onClick={() => jump("acct")}>
              حسابك
            </button>
            <button type="button" className="you-pill" onClick={() => jump("you-settings")}>
              الورد والصلاة
            </button>
          </div>

          <section className="you-sec">
            <button type="button" className="you-h" onClick={() => openView("history")}>
              السجل <Chev />
            </button>
            {historyVideos.length === 0 ? (
              <p className="muted">سجل المشاهدة فاضي.</p>
            ) : (
              <div className="you-shelf">
                {historyVideos.slice(0, 12).map((v) => (
                  <MiniCard key={v.id} v={v} prog={ClientStore.getProgress(v.id)} />
                ))}
              </div>
            )}
          </section>

          <section className="you-sec">
            <h2 className="you-h">المكتبة</h2>
            <div className="you-rows">
              {rows.map((r) => (
                <button key={r.key} type="button" className="you-row" onClick={() => openView(r.key)}>
                  <span className="you-stack">
                    {r.img ? <img src={r.img} alt="" loading="lazy" /> : null}
                    <span className="you-badge">
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d={r.icon} />
                      </svg>
                    </span>
                  </span>
                  <span className="you-row-txt">
                    <b>{r.title}</b>
                    <small>{r.sub}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>
        </>
      ) : (
        <div className="you-view-top">
          <button type="button" className="you-back" onClick={closeView} aria-label="رجوع">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z" transform="rotate(180 12 12)" />
            </svg>
          </button>
          <h1>{viewTitle[view]}</h1>
        </div>
      )}

      {/* Watch Later */}
      {view === "later" && (
        <section style={{ marginBottom: 28 }}>
          {laterVideos.length === 0 ? (
            <p className="muted">لسه ما حفظتش حاجة في «شاهد لاحقًا».</p>
          ) : (
            <div className="grid">
              {laterVideos.map((v) => (
                <VideoCard key={v.id} video={v} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Liked Videos */}
      {view === "liked" && (
        <section style={{ marginBottom: 28 }}>
          {likedVideos.length === 0 ? (
            <p className="muted">لما تضغط «استفدت منه» على فيديو هيظهر هنا.</p>
          ) : (
            <div className="grid">
              {likedVideos.map((v) => (
                <VideoCard key={v.id} video={v} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Saved Clips: play, copy a share link, delete; and keep them as a file on the device */}
      {view === "clips" && (
        <section style={{ marginBottom: 28 }}>
          <div className="clips-head">
            <span className="muted">{clips.length} مقطع</span>
            <div className="clips-file">
              <button
                type="button"
                className="btn"
                disabled={!clips.length}
                onClick={() => {
                  const blob = new Blob([ClientStore.exportClips()], { type: "application/json" });
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(blob);
                  a.download = `مقاطع-محسن-تيوب-${new Date().toISOString().slice(0, 10)}.json`;
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
                  showToast("نزل ملف مقاطعك على جهازك");
                }}
              >
                <Glyph name="download" /> نزّل مقاطعك
              </button>
              <label className="btn">
                <Glyph name="upload" /> ارفع ملف مقاطع
                <input
                  type="file"
                  accept="application/json,.json"
                  hidden
                  onChange={async (ev) => {
                    const file = ev.target.files?.[0];
                    ev.target.value = "";
                    if (!file) return;
                    const n = ClientStore.importClips(await file.text());
                    setClips(ClientStore.getClips());
                    showToast(n < 0 ? "الملف ده مش ملف مقاطع من محسن تيوب" : n ? `اتضاف ${n} مقطع` : "المقاطع دي موجودة عندك أصلًا");
                  }}
                />
              </label>
            </div>
          </div>
          {clips.length === 0 ? (
            <p className="muted">لسه ما حفظتش مقاطع. افتح أي فيديو واضغط "قص".</p>
          ) : (
            <div className="grid">
              {clips.map((c) => (
                <div key={c.id} className="series">
                  <b>{c.name}</b>
                  <p className="muted" style={{ margin: "4px 0 10px" }}>
                    {c.c} • من {formatDuration(c.s)} إلى {formatDuration(c.e)}
                  </p>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <Link className="btn gold" href={`/watch/${c.vid}?s=${c.s}&e=${c.e}`}>
                      <Glyph name="play" /> شغّل المقطع
                    </Link>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        const url = `${window.location.origin}/watch/${encodeURIComponent(c.vid)}?s=${c.s}&e=${c.e}`;
                        navigator.clipboard
                          ?.writeText(url)
                          .then(() => showToast("اتنسخ رابط المقطع"))
                          .catch(() => showToast(url, 6000));
                      }}
                    >
                      🔗 انسخ الرابط
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        ClientStore.deleteClip(c.id);
                        setClips(ClientStore.getClips());
                      }}
                    >
                      حذف
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Watch History */}
      {view === "history" && (
        <section style={{ marginBottom: 28 }}>
          <div className="clips-head">
            <span className="muted">{historyVideos.length} فيديو</span>
            {historyVideos.length > 0 && (
              <button
                type="button"
                className="btn"
                onClick={() => ClientStore.clearHistory()}
              >
                امسح السجل كله
              </button>
            )}
          </div>
          {historyVideos.length === 0 ? (
            <p className="muted">سجل المشاهدة فاضي.</p>
          ) : (
            <div className="grid">
              {historyVideos.map((v) => (
                <VideoCard key={v.id} video={v} />
              ))}
            </div>
          )}
        </section>
      )}

      {view === null && (
        <>
          {/* Account: cloud sync + backup */}
          <div id="acct" className="you-anchor">
            <AccountSection />
          </div>

          {/* Daily Wird Settings */}
          <section className="settings you-anchor" id="you-settings">
            <h2 className="sec">الورد اليومي</h2>
            <p className="muted">كام دقيقة علم عايز تتعلم كل يوم؟</p>
            <div className="topic-chips">
              {(
                [
                  [0, "مقفول"],
                  [10, "10 دقايق"],
                  [20, "20 دقيقة"],
                  [30, "نص ساعة"],
                  [60, "ساعة"],
                ] as Array<[number, string]>
              ).map(([mins, label]) => (
                <button
                  key={mins}
                  type="button"
                  className={wirdGoalState === mins ? "on" : ""}
                  onClick={() => {
                    setWirdGoal(mins);
                    setWirdGoalState(mins);
                    showToast(
                      mins === 0
                        ? "اتقفل الورد اليومي"
                        : `الورد اليومي بقى ${label}`
                    );
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>

          {/* Prayer Times Settings */}
          <section className="settings" style={{ marginTop: 24 }}>
            <h2 className="sec">مواقيت الصلاة</h2>
            <label className="pl-row">
              <input
                type="checkbox"
                checked={prayerPause}
                onChange={(e) => {
                  setPrayerPauseEnabled(e.target.checked);
                  setPrayerPause(e.target.checked);
                }}
              />{" "}
              وقّف الفيديو تلقائيًا وقت الأذان
            </label>
            <div className="pr-times" style={{ margin: "12px 0" }}>
              {(
                Object.entries(PRAYER_NAMES) as Array<
                  [keyof typeof prayerTimes, string]
                >
              ).map(([k, name]) => (
                <span key={k}>
                  <small>{name}</small>
                  <b>{fmtTime(prayerTimes[k])}</b>
                </span>
              ))}
            </div>
            <p className="muted">
              المواقيت حسب {locName}.{" "}
              <button
                type="button"
                className="link-btn"
                onClick={handleUseMyLocation}
              >
                استخدم موقعي
              </button>
            </p>
          </section>
        </>
      )}
    </div>
  );
}

const LIB_ICONS = {
  heart: "M12 21.2 10.6 20C5.4 15.3 2 12.2 2 8.4 2 5.3 4.4 3 7.5 3c1.7 0 3.4.8 4.5 2.1C13.1 3.8 14.8 3 16.5 3 19.6 3 22 5.3 22 8.4c0 3.8-3.4 6.9-8.6 11.6z",
  clock: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm.5-13H11v6l5.2 3.2.8-1.3-4.5-2.7V7z",
  scissors: "M9.6 8.1A3.5 3.5 0 1 0 8 9.9L10.1 12 8 14.1a3.5 3.5 0 1 0 1.6 1.8L12 13.4l7 7h3v-1L9.6 8.1zM6 8a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm0 11a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm13-16-6 6 2 2 7-7V3z",
};

/** The "›" next to a shelf title, pointing the reading direction (RTL: left). */
function Chev() {
  return (
    <svg className="you-chev" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z" />
    </svg>
  );
}

/** Small card for the history shelf, like YouTube's "أنت" page. */
function MiniCard({ v, prog }: { v: VideoItem; prog?: [number, number] }) {
  const pct = prog ? Math.min(100, Math.max(0, prog[1] * 100)) : 0; // [seconds, fraction watched]
  return (
    <Link href={`/watch/${v.id}`} className="you-mini">
      <span className="you-mini-th">
        <img src={`https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`} alt="" loading="lazy" />
        {v.d ? <span className="you-dur">{formatDuration(v.d)}</span> : null}
        {pct > 0 ? <span className="you-prog" style={{ width: `${pct}%` }} /> : null}
      </span>
      <b>{v.t}</b>
      <small>{v.c}</small>
    </Link>
  );
}
