import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  editDistance1,
  estimateVideoLevel,
  formatDuration,
  getSynonyms,
  normArabic,
  stemWord,
} from "../src/lib/arabic.ts";
import {
  getCatalogSummary,
  getChannelPageData,
  getDb,
  getFeedVideos,
  getRoom,
  getVideoDetail,
  saveViewerLabel,
  searchVideos,
  upsertRoom,
} from "../src/lib/db.ts";
import {
  CAIRO_LOCATION,
  calculatePrayerTimes,
} from "../src/lib/client/prayer.ts";

describe("Arabic normalization, stemming, synonyms & level estimation", () => {
  it("normalizes diacritics, alef variants, ta marbuta, and ya maqsura", () => {
    assert.equal(normArabic("الصَّلَاةُ"), "الصلاه");
    assert.equal(normArabic("إسلام وأحكام"), "اسلام واحكام");
    assert.equal(normArabic("الهدى"), "الهدي");
  });

  it("stems Arabic prefixes and suffixes and English plurals", () => {
    assert.equal(stemWord("والصلوات"), "صلو");
    assert.equal(stemWord("المسلمين"), "مسلم");
    assert.equal(stemWord("computers"), "computer");
  });

  it("expands bilingual synonyms between Arabic and English", () => {
    const pySyns = getSynonyms("بايثون");
    assert.ok(pySyns.includes("python"));
    const woodSyns = getSynonyms("woodworking");
    assert.ok(woodSyns.includes(stemWord("نجارة")));
  });

  it("computes 1-edit typo distance accurately", () => {
    assert.equal(editDistance1("بيثون", "بايثون"), true);
    assert.equal(editDistance1("بايثون", "بايثون"), false);
    assert.equal(editDistance1("بايثون", "جافا"), false);
  });

  it("matches English 'easy' word boundary in estimateVideoLevel (fixing old \\x08easy\\x08 bug)", () => {
    const easyLv = estimateVideoLevel(
      "Easy Python Tutorial",
      "برمجة",
      "كورسات",
      1200
    );
    const hardLv = estimateVideoLevel(
      "Advanced Python Internals & Architecture",
      "برمجة",
      "كورسات",
      1200
    );
    assert.ok(
      easyLv < hardLv,
      `Expected easy level (${easyLv}) < advanced level (${hardLv})`
    );
    assert.equal(easyLv, 1.2);
  });

  it("formats durations cleanly", () => {
    assert.equal(formatDuration(125), "2:05");
    assert.equal(formatDuration(3665), "1:01:05");
  });
});

describe("SQLite + FTS5 Catalog & Search Engine", () => {
  it("seeds over 13,000 curated videos and 100,000+ total searchable videos", () => {
    const db = getDb();
    const total = (
      db.prepare("SELECT COUNT(*) as c FROM videos").get() as { c: number }
    ).c;
    const curated = (
      db
        .prepare("SELECT COUNT(*) as c FROM videos WHERE is_curated = 1")
        .get() as { c: number }
    ).c;
    assert.ok(curated >= 13400, `Expected >= 13400 curated, got ${curated}`);
    assert.ok(total >= 100500, `Expected >= 100500 total, got ${total}`);
  });

  it("excludes blocked channels from catalog summary and videos", () => {
    const summary = getCatalogSummary();
    assert.ok(summary.channels.length >= 240);
    assert.ok(
      !summary.channels.some((c) => c.id === "UCqqJ_Jipt3CoF-dW09kQFNQ"),
      "Blocked channel should not be present"
    );
  });

  it("returns paginated feed and fun category slices", () => {
    const home = getFeedVideos({ category: "all", limit: 24, offset: 0 });
    assert.equal(home.videos.length, 24);
    assert.ok(home.total >= 13400);

    const fun = getFeedVideos({ category: "fun", limit: 24, offset: 0 });
    assert.equal(fun.videos.length, 24);
    assert.ok(
      fun.videos.every(
        (v) =>
          v.g === "اصنعها بنفسك" || v.g === "رياضة" || v.g === "بودكاست"
      )
    );
  });

  it("searches 100k+ videos with Arabic normalization, synonyms, and typo tolerance", () => {
    const res1 = searchVideos("بايثون", { limit: 20 });
    assert.ok(res1.length > 0, "Should find Python videos via Arabic query");

    const resTypo = searchVideos("بيثون", { limit: 20 });
    assert.ok(
      resTypo.length > 0,
      "Should find Python videos even with 1-char typo 'بيثون'"
    );

    const resTafsir = searchVideos("تفسير", { limit: 20 });
    assert.ok(resTafsir.length > 0, "Should find Tafsir videos");
  });

  it("loads video details with series, server-computed related videos, and comments", () => {
    const sample = getFeedVideos({ limit: 1 }).videos[0];
    assert.ok(sample);
    const detail = getVideoDetail(sample.id);
    assert.ok(detail);
    assert.equal(detail.video.id, sample.id);
    assert.ok(detail.related.length > 0, "Should compute related videos server-side");
  });

  it("loads channel page data with videos and series", () => {
    const ch = getChannelPageData("الشيخ سعيد الكملي");
    assert.ok(ch);
    assert.ok(ch.videos.length > 0);
  });

  it("validates watch-together rooms and viewer labels against invalid input", () => {
    const sample = getFeedVideos({ limit: 1 }).videos[0];
    const badRoom = upsertRoom({
      code: "<script>",
      vid: "nonexistent_video_id",
      t: 10,
      playing: true,
      by: "user1",
    });
    assert.equal(badRoom, null);

    const goodRoom = upsertRoom({
      code: "ROOM42",
      vid: sample.id,
      t: 45,
      playing: true,
      by: "user1",
    });
    assert.ok(goodRoom);
    assert.equal(goodRoom.code, "ROOM42");
    assert.equal(getRoom("ROOM42")?.vid, sample.id);

    assert.equal(
      saveViewerLabel({
        vid: sample.id,
        ch: sample.c,
        q: "invalid_q",
        a: ["الشباب"],
      }),
      false
    );
    assert.equal(
      saveViewerLabel({
        vid: sample.id,
        ch: sample.c,
        q: "aud",
        a: ["الشباب"],
      }),
      true
    );
  });
});

describe("Astronomical Prayer Times Calculator", () => {
  it("computes chronological Fajr < Dhuhr < Asr < Maghrib < Isha for Cairo", () => {
    const times = calculatePrayerTimes(new Date(2026, 10, 4, 12, 0, 0), CAIRO_LOCATION);
    assert.ok(times.fajr < times.dhuhr);
    assert.ok(times.dhuhr < times.asr);
    assert.ok(times.asr < times.maghrib);
    assert.ok(times.maghrib < times.isha);
  });
});
