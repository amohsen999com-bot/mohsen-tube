"use client";

/**
 * "حمّل التطبيق": installs محسن تيوب on the phone or computer.
 * - Android / Chrome / Edge: the browser's own install dialog (one tap).
 * - iPhone / iPad (Safari has no install dialog): a short sheet with the 2 steps.
 * - Hidden once installed: when opened as the app, right after installing, or after "خلاص ثبّته" on iPhone.
 */
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Glyph } from "@/components/ui/Glyph";
import { readLocal, writeLocal } from "@/lib/client/store";

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

const DONE_KEY = "nt_app_installed";

const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export function InstallButton() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [ios, setIos] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (isStandalone()) {
      writeLocal(DONE_KEY, 1);
      return;
    }
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    if (readLocal<number>(DONE_KEY, 0)) return;
    if (isIOS()) {
      setIos(true);
      setHidden(false);
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPrompt);
      setHidden(false);
    };
    const onInstalled = () => {
      writeLocal(DONE_KEY, 1);
      setHidden(true);
      setPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (hidden) return null;

  const install = async () => {
    if (prompt) {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      setPrompt(null);
      // Accepted: gone for good. Dismissed: gone until the browser offers it again on a later visit.
      if (outcome === "accepted") writeLocal(DONE_KEY, 1);
      setHidden(true);
      return;
    }
    if (ios) setSheet(true);
  };

  const finishIos = () => {
    writeLocal(DONE_KEY, 1);
    setSheet(false);
    setHidden(true);
  };

  return (
    <>
      <button type="button" className="app-get" onClick={install} aria-label="حمّل التطبيق" title="حمّل محسن تيوب كتطبيق">
        <Glyph name="download" size="18px" />
        <span>حمّل التطبيق</span>
      </button>
      {sheet &&
        createPortal(
          <div className="app-sheet-bg" role="dialog" aria-modal="true" aria-labelledby="app-sheet-t" onClick={() => setSheet(false)}>
            <div className="app-sheet" onClick={(e) => e.stopPropagation()}>
              <img src="/icons/icon-192.png" alt="" className="app-sheet-icon" />
              <h3 id="app-sheet-t">ثبّت محسن تيوب على الآيفون</h3>
              <ol>
                <li>
                  <span className="app-step">١</span>
                  <span>
                    اضغط زرار المشاركة <Glyph name="share" size="20px" /> في سفاري
                  </span>
                </li>
                <li>
                  <span className="app-step">٢</span>
                  <span>
                    اختار «إضافة إلى الشاشة الرئيسية» <Glyph name="addBox" size="20px" />
                  </span>
                </li>
              </ol>
              <div className="app-sheet-btns">
                <button type="button" className="app-sheet-ok" onClick={finishIos}>
                  خلاص ثبّته
                </button>
                <button type="button" className="app-sheet-later" onClick={() => setSheet(false)}>
                  بعدين
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
