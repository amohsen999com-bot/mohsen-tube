"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  cloudConfigured,
  currentUser,
  exportBackup,
  importBackup,
  lastSyncedAt,
  push,
  sendMagicLink,
  signOut,
} from "@/lib/client/sync";
import { usePlayer } from "@/components/player/PlayerContext";

/** "حسابك": cloud sign-in when Supabase is configured, plus a backup file that always works. */
export function AccountSection() {
  const { showToast } = usePlayer();
  const [user, setUser] = useState<{ email: string } | null>(null);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState(0);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const cloud = cloudConfigured();

  useEffect(() => {
    setUser(currentUser());
    setLast(lastSyncedAt());
  }, []);

  const onSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const addr = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) return showToast("اكتب إيميل صحيح");
    setBusy(true);
    const ok = await sendMagicLink(addr).catch(() => false);
    setBusy(false);
    if (ok) setSent(addr);
    else showToast("ما قدرناش نبعت الرابط، جرّب تاني بعد دقيقة");
  };

  const onExport = () => {
    const blob = new Blob([exportBackup()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `mohsen-tube-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const changed = importBackup(await file.text());
      showToast(changed ? "اترجعت بياناتك" : "النسخة دي مفيهاش جديد");
      if (changed) setTimeout(() => window.location.reload(), 800);
    } catch {
      showToast("الملف ده مش نسخة احتياطية من محسن تيوب");
    }
  };

  return (
    <section className="settings acct" style={{ marginBottom: 24 }}>
      <h2 className="sec">حسابك</h2>
      {cloud && user ? (
        <>
          <p>
            داخل بـ <b dir="ltr">{user.email}</b>. سجلك وتقدّمك والترشيحات بتاعتك محفوظين في حسابك، وهترجعلك على أي جهاز تدخل منه.
          </p>
          <p className="muted">
            {last ? `آخر حفظ: ${new Date(last).toLocaleTimeString("ar-EG", { hour: "numeric", minute: "2-digit" })}` : "بيتحفظ…"}
            {" · "}
            <button type="button" className="link-btn" onClick={async () => { const ok = await push(); setLast(lastSyncedAt()); showToast(ok ? "اتحفظ" : "الحفظ ما نجحش"); }}>
              احفظ دلوقتي
            </button>
            {" · "}
            <button type="button" className="link-btn" onClick={async () => { if (confirm("تخرج من حسابك؟ بياناتك هتفضل محفوظة في الحساب وعلى الجهاز ده.")) { await signOut(); setUser(null); } }}>
              خروج
            </button>
          </p>
        </>
      ) : cloud ? (
        sent ? (
          <p>
            بعتنالك رابط على <b dir="ltr">{sent}</b>. افتحه من نفس المتصفح ده وهتدخل على طول.
          </p>
        ) : (
          <>
            <p className="muted">ادخل بإيميلك عشان سجلك وواقف لحد فين والترشيحات بتاعتك يتحفظوا، ويرجعولك من أي جهاز.</p>
            <form className="acct-form" onSubmit={onSend}>
              <input type="email" required dir="ltr" placeholder="you@gmail.com" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              <button className="btn gold" disabled={busy}>ابعتلي رابط الدخول</button>
            </form>
          </>
        )
      ) : (
        <p className="muted">بياناتك محفوظة في المتصفح ده. خد منها نسخة احتياطية عشان تنقلها لجهاز تاني أو ترجّعها لو اتمسحت.</p>
      )}
      <p className="acct-backup">
        <button type="button" className="btn" onClick={onExport}>نزّل نسخة احتياطية</button>
        <button type="button" className="btn" onClick={() => fileRef.current?.click()}>رجّع من نسخة</button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => onImport(e.target.files?.[0])} />
      </p>
    </section>
  );
}
