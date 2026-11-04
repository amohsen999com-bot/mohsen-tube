// شاشة التحميل: بدل "جاري التحميل…" بنرسم شكل الصفحة نفسها (كروت/مشغّل) بلمعة بتعدّي عليها،
// زي التطبيقات الكبيرة. العين بتفهم إن المحتوى جاي وبتحس إنه أسرع.
import React from "react";

function CardSkeleton() {
  return (
    <div className="sk-card" aria-hidden="true">
      <div className="sk sk-thumb" />
      <div className="sk-row">
        <div className="sk sk-avatar" />
        <div className="sk-lines">
          <div className="sk sk-line" />
          <div className="sk sk-line short" />
        </div>
      </div>
    </div>
  );
}

export function PageSkeleton({ kind = "feed" }: { kind?: "feed" | "home" | "watch" | "channel" }) {
  if (kind === "watch") {
    return (
      <div className="sk-page" role="status" aria-label="بيحمّل">
        <div className="sk sk-player" />
        <div className="sk sk-title" />
        <div className="sk sk-title short" />
        <div className="sk-row">
          <div className="sk sk-avatar big" />
          <div className="sk-lines">
            <div className="sk sk-line" />
            <div className="sk sk-line short" />
          </div>
        </div>
        <div className="sk-pills">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="sk sk-pill" />
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="sk-page" role="status" aria-label="بيحمّل">
      {kind === "home" && <div className="sk sk-hero" />}
      {kind === "channel" && (
        <div className="sk-row sk-channel">
          <div className="sk sk-avatar huge" />
          <div className="sk-lines">
            <div className="sk sk-title" />
            <div className="sk sk-line short" />
          </div>
        </div>
      )}
      <div className="grid">
        {Array.from({ length: 6 }, (_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
