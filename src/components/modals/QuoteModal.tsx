"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { VideoItem } from "@/lib/types";
import { usePlayer } from "@/components/player/PlayerContext";

export function QuoteModal({
  video,
  initialText = "",
  onClose,
}: {
  video: VideoItem;
  initialText?: string;
  onClose: () => void;
}) {
  const { showToast } = usePlayer();
  const [text, setText] = useState(initialText);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const drawQuote = useCallback(
    (quoteText: string) => {
      const cv = canvasRef.current;
      if (!cv) return;
      const c = cv.getContext("2d");
      if (!c) return;
      const W = 1080;
      const g = c.createLinearGradient(0, 0, W, W);
      g.addColorStop(0, "#2a0510");
      g.addColorStop(0.55, "#19171b");
      g.addColorStop(1, "#19171b");
      c.fillStyle = g;
      c.fillRect(0, 0, W, W);

      c.strokeStyle = "#d29f22";
      c.lineWidth = 3;
      c.strokeRect(48, 48, W - 96, W - 96);

      c.fillStyle = "#d29f22";
      c.font = "700 180px 'Noto Sans Arabic', serif";
      c.textAlign = "center";
      c.direction = "rtl";
      c.fillText("”", W / 2, 260);

      const display = quoteText.trim() || "اكتب الفايدة هنا";
      let size = display.length > 160 ? 46 : display.length > 90 ? 54 : 64;
      let lines: string[] = [];
      const wrap = () => {
        c.font = `500 ${size}px 'Noto Sans Arabic', sans-serif`;
        lines = [];
        let line = "";
        for (const w of display.split(/\s+/)) {
          const t = line ? `${line} ${w}` : w;
          if (c.measureText(t).width > W - 220 && line) {
            lines.push(line);
            line = w;
          } else {
            line = t;
          }
        }
        if (line) lines.push(line);
      };
      wrap();
      while (lines.length * size * 1.7 > 520 && size > 30) {
        size -= 4;
        wrap();
      }

      c.fillStyle = "#f2ede2";
      const top = 560 - (lines.length * size * 1.7) / 2 + size;
      lines.forEach((l, i) => c.fillText(l, W / 2, top + i * size * 1.7));

      c.fillStyle = "#e8c468";
      // Channel name, shrunk to stay inside the frame when it's long
      let chSize = 34;
      do {
        c.font = `500 ${chSize}px 'Noto Sans Arabic', sans-serif`;
      } while (c.measureText(`— ${video.c}`).width > W - 240 && (chSize -= 2) > 20);
      c.fillText(`— ${video.c}`, W / 2, 872);

      // Mohsen Tube signature: the site's logo mark + "محسن" (cream) "تيوب" (gold), centred as one group
      const LOGO = 58;
      const GAP = 14;
      const SPACE = 11;
      const midY = 962;
      c.save();
      c.direction = "ltr";
      c.textAlign = "left";
      c.textBaseline = "middle";
      c.font = "800 42px 'Cairo', 'Noto Sans Arabic', sans-serif";
      const wM = c.measureText("محسن").width;
      const wT = c.measureText("تيوب").width;
      const total = wT + SPACE + wM + GAP + LOGO;
      const x0 = W / 2 - total / 2;
      // RTL reading order: logo on the right, then محسن, then تيوب on the left
      c.fillStyle = "#e2b54a";
      c.fillText("تيوب", x0, midY + 3);
      c.fillStyle = "#f4efe4";
      c.fillText("محسن", x0 + wT + SPACE, midY + 3);
      // Logo mark (same drawing as LogoMark.tsx, a 48-unit box scaled to LOGO px)
      c.translate(x0 + wT + SPACE + wM + GAP, midY - LOGO / 2);
      c.scale(LOGO / 48, LOGO / 48);
      c.fillStyle = "#4f0c1f";
      c.beginPath();
      c.roundRect(2, 2, 44, 44, 13);
      c.fill();
      c.strokeStyle = "rgba(214, 176, 98, .35)";
      c.lineWidth = 0.8;
      c.beginPath();
      c.roundRect(4.5, 4.5, 39, 39, 10.5);
      c.stroke();
      c.fillStyle = "#d6b062";
      c.fill(new Path2D("M19.5 17.6v12.8c0 1 1.1 1.6 1.9 1.1l10-6.4c.8-.5.8-1.7 0-2.2l-10-6.4c-.8-.5-1.9.1-1.9 1.1z"));
      c.restore();
    },
    [video.c]
  );

  useEffect(() => {
    drawQuote(text);
    document.fonts?.ready.then(() => drawQuote(text));
  }, [text, drawQuote]);

  const toBlob = (): Promise<Blob | null> =>
    new Promise((resolve) => canvasRef.current?.toBlob(resolve, "image/png"));

  const handleDownload = async () => {
    const b = await toBlob();
    if (!b) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b);
    a.download = "فايدة - محسن تيوب.png";
    a.click();
  };

  const handleShare = async () => {
    const b = await toBlob();
    if (!b) return;
    const file = new File([b], "faida.png", { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      navigator
        .share({
          files: [file],
          text: `${video.t}\n${window.location.origin}/watch/${video.id}`,
        })
        .catch(() => {});
    } else {
      showToast("المشاركة مش متاحة هنا، نزّل الصورة وابعتها");
    }
  };

  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-box quote-box">
        <h3>اقتبس فايدة</h3>
        <textarea
          maxLength={280}
          placeholder="اكتب الفايدة اللي عايز تشاركها…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
        />
        <canvas ref={canvasRef} width={1080} height={1080} />
        <div className="modal-bar">
          <button type="button" className="btn gold" onClick={handleDownload}>
            نزّل الصورة
          </button>
          <button type="button" className="btn" onClick={handleShare}>
            مشاركة
          </button>
          <button type="button" className="btn" onClick={onClose}>
            قفل
          </button>
        </div>
      </div>
    </div>
  );
}
