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

  useEffect(() => {
    return subscribeStore(() => setTick((n) => n + 1));
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

  return (
    <div>
      <div className="lib-top">
        <h1>مكتبتك</h1>
      </div>

      {/* Watch Later */}
      <section style={{ marginBottom: 28 }}>
        <h2 className="sec">شاهد لاحقًا ({laterVideos.length})</h2>
        {laterVideos.length === 0 ? (
          <p className="muted">لسه ما حفظتش حاجة في «شاهد لاحقًا».</p>
        ) : (
          <div className="grid">
            {laterVideos.slice(0, 8).map((v) => (
              <VideoCard key={v.id} video={v} />
            ))}
          </div>
        )}
      </section>

      {/* Liked Videos */}
      <section style={{ marginBottom: 28 }}>
        <h2 className="sec">استفدت منه ({likedVideos.length})</h2>
        {likedVideos.length === 0 ? (
          <p className="muted">لما تضغط «استفدت منه» على فيديو هيظهر هنا.</p>
        ) : (
          <div className="grid">
            {likedVideos.slice(0, 8).map((v) => (
              <VideoCard key={v.id} video={v} />
            ))}
          </div>
        )}
      </section>

      {/* Saved Clips */}
      {clips.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <h2 className="sec">مقاطعك ({clips.length})</h2>
          <div className="grid">
            {clips.map((c) => (
              <div key={c.id} className="series">
                <b>{c.name}</b>
                <p className="muted" style={{ margin: "4px 0 10px" }}>
                  {c.c} • من {formatDuration(c.s)} إلى {formatDuration(c.e)}
                </p>
                <div style={{ display: "flex", gap: 8 }}>
                  <Link
                    className="btn gold"
                    href={`/watch/${c.vid}?s=${c.s}&e=${c.e}`}
                  >
                    ▶ شغّل المقطع
                  </Link>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => ClientStore.deleteClip(c.id)}
                  >
                    حذف
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Watch History */}
      <section style={{ marginBottom: 28 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h2 className="sec">السجل ({historyVideos.length})</h2>
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
            {historyVideos.slice(0, 8).map((v) => (
              <VideoCard key={v.id} video={v} />
            ))}
          </div>
        )}
      </section>

      {/* Account: cloud sync + backup */}
      <AccountSection />

      {/* Daily Wird Settings */}
      <section className="settings">
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
    </div>
  );
}
