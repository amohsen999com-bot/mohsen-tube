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
      c.font = "500 34px 'Noto Sans Arabic', sans-serif";
      c.fillText(`— ${video.c}`, W / 2, 880);

      // Mohsen Tube emblem
      c.fillStyle = "#5d0018";
      c.beginPath();
      c.arc(W / 2 + 92, 960, 22, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = "#d29f22";
      c.lineWidth = 2;
      c.stroke();

      c.fillStyle = "#d29f22";
      c.beginPath();
      c.moveTo(W / 2 + 85, 950);
      c.lineTo(W / 2 + 85, 970);
      c.lineTo(W / 2 + 102, 960);
      c.fill();

      c.font = "700 30px 'Noto Sans Arabic', sans-serif";
      c.fillStyle = "#f2ede2";
      c.fillText("محسن تيوب", W / 2 - 10, 971);
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
