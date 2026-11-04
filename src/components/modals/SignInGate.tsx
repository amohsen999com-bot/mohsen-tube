"use client";

import React, { useEffect, useState } from "react";
import { LogoMark } from "@/components/layout/LogoMark";
import { cloudConfigured, currentUser, signInWithGoogle } from "@/lib/client/sync";

const LATER_KEY = "nt__signin_later";

/**
 * أول شاشة لما تفتح الموقع: تسجيل دخول بزرار واحد (جوجل)، عشان حاجتك (المحفوظات، الورد، الذوق) تفضل معاك
 * على أي جهاز. فيه رابط صغير "بعدين" لو حد مش عاوز دلوقتي، والسؤال ده مش بيرجع تاني في نفس الجهاز.
 */
export function SignInGate() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!cloudConfigured() || currentUser()) return;
    try {
      if (window.localStorage.getItem(LATER_KEY)) return;
    } catch {}
    // The sign-in just came back in the URL: startSync is storing it, don't flash the gate
    if (window.location.hash.includes("access_token=")) return;
    setOpen(true);
  }, []);

  if (!open) return null;

  const later = () => {
    try {
      window.localStorage.setItem(LATER_KEY, String(Date.now()));
    } catch {}
    setOpen(false);
  };

  return (
    <div className="sg-overlay" role="dialog" aria-modal="true" aria-labelledby="sg-title">
      <div className="sg-card">
        <LogoMark className="sg-mark" />
        <h2 id="sg-title" className="sg-title">
          <span>محسن</span> <span className="sg-gold">تيوب</span>
        </h2>
        <p className="sg-sub">فيديوهات تنفعك في دينك ودنيتك</p>
        <button
          type="button"
          className="sg-google"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setFailed(false);
            const leaving = await signInWithGoogle();
            if (!leaving) {
              setBusy(false);
              setFailed(true);
            }
          }}
        >
          <svg viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 38.4 44 33 44 24c0-1.3-.1-2.4-.4-3.5z" />
          </svg>
          {busy ? "ثواني…" : "ادخل بحساب جوجل"}
        </button>
        {failed && <p className="sg-err">تسجيل الدخول بجوجل مش متاح دلوقتي. جرّب كمان شوية، أو اضغط "بعدين".</p>}
        <p className="sg-note">بنحفظ بيه محفوظاتك وذوقك على أي جهاز. مش بنبعت حاجة باسمك.</p>
        <button type="button" className="sg-later" onClick={later}>
          بعدين
        </button>
      </div>
    </div>
  );
}
