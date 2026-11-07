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
  createRoom,
  getAggregatedLabels,
  getCatalogSummary,
  getChannelPageData,
  getDb,
  getFeedVideos,
  getRelatedGraph,
  getRoom,
  getVideoDetail,
  joinRoom,
  saveViewerLabel,
  searchVideos,
  updateRoom,
  voterId,
} from "../src/lib/db.ts";
import {
  getSessionAffinity,
  learnFromVideo,
  newFromLoved,
  relatedScores,
  resetModelCache,
  SESSION_HALF,
  sessionValue,
} from "../src/lib/client/algo.ts";
import { deepMerge, mergeSnapshots } from "../src/lib/client/sync.ts";
import type { VideoItem } from "../src/lib/types.ts";
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
    assert.ok(curated >= 13200, `Expected >= 13200 curated, got ${curated}`);
    assert.ok(total >= 100000, `Expected >= 100000 total, got ${total}`);
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
    assert.ok(home.total >= 13200);

    const fun = getFeedVideos({ category: "fun", limit: 24, offset: 0 });
    assert.equal(fun.videos.length, 24);
    const FUN_GROUPS = ["اصنعها بنفسك", "بودكاست", "علماء", "أنا السلفي", "كورسات"];
    assert.ok(fun.videos.every((v) => FUN_GROUPS.includes(v.g)));
  });

  it("keeps the fun pool varied: no sports, crafts lead, stories and short skills present", () => {
    const all = getFeedVideos({ category: "fun", limit: 1500, offset: 0 }).videos;
    const by = (p: (v: (typeof all)[number]) => boolean) => all.filter(p).length;
    assert.equal(by((v) => v.g === "رياضة" || v.c === "beIN SPORTS"), 0, "beIN SPORTS was removed from the site");
    assert.ok(by((v) => v.g === "اصنعها بنفسك") > 200);
    assert.ok(by((v) => v.tp === "سيرة وتاريخ") > 0, "faith stories belong in the fun pool");
    assert.ok(all.filter((v) => v.g === "كورسات").every((v) => v.d <= 960), "only short skills");
    assert.equal(new Set(all.map((v) => v.id)).size, all.length, "no duplicates across buckets");
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

  it("keeps the fun pool inside the curated catalog", () => {
    const fun = getFeedVideos({ category: "fun", limit: 1500, offset: 0 });
    assert.ok(fun.videos.length > 0);
    assert.ok(fun.videos.every((v) => !(v.g === "بودكاست" && v.tp === "بيزنس")));
    const db = getDb();
    const ids = fun.videos.map((v) => v.id);
    const uncurated = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM videos WHERE is_curated = 0 AND id IN (${ids.map(() => "?").join(",")})`)
        .get(...ids) as { n: number }
    ).n;
    assert.equal(uncurated, 0);
  });

  it("serves a related graph for history ids, falling back to content-based lists", () => {
    const sample = getFeedVideos({ limit: 2 }).videos;
    const g = getRelatedGraph([sample[0].id, sample[1].id, "<bad>"]);
    assert.ok(Array.isArray(g[sample[0].id]) && g[sample[0].id].length > 0);
    assert.ok(!("<bad>" in g));
  });
});

describe("Watch-together room security", () => {
  const sample = () => getFeedVideos({ limit: 1 }).videos[0];

  it("creates rooms with server-generated codes and a secret token", () => {
    const a = createRoom({ vid: sample().id, t: 12, playing: true, by: "user1" });
    const b = createRoom({ vid: sample().id, t: 12, playing: true, by: "user1" });
    assert.ok(a && b);
    assert.match(a.room.code, /^[A-HJ-NP-Z2-9]{8}$/);
    assert.notEqual(a.room.code, b.room.code);
    assert.ok(a.token.length >= 32);
    assert.equal(getRoom(a.room.code)?.vid, sample().id);
  });

  it("rejects invalid input on create", () => {
    assert.equal(createRoom({ vid: "nonexistent_video_id", t: 1, playing: true, by: "user1" }), null);
    assert.equal(createRoom({ vid: "<script>", t: 1, playing: true, by: "user1" }), null);
    assert.equal(createRoom({ vid: sample().id, t: 1, playing: true, by: "" }), null);
  });

  it("only lets token holders update a room", () => {
    const created = createRoom({ vid: sample().id, t: 5, playing: false, by: "host" })!;
    const code = created.room.code;
    const base = { code, vid: sample().id, t: 30, playing: true, by: "peer" };
    assert.equal(updateRoom({ ...base, token: "" }), null);
    assert.equal(updateRoom({ ...base, token: "guess-" + created.token.slice(6) }), null);
    assert.equal(updateRoom({ ...base, code: "ZZZZZZZZ", token: created.token }), null);

    const byHost = updateRoom({ ...base, token: created.token });
    assert.ok(byHost);
    assert.equal(byHost.t, 30);

    const joined = joinRoom(code);
    assert.ok(joined);
    assert.notEqual(joined.token, created.token);
    const byMember = updateRoom({ ...base, t: 45, token: joined.token });
    assert.equal(byMember?.t, 45);
    assert.equal(joinRoom("NOPE1234"), null);
  });
});

describe("Viewer label allowlist & deduplication", () => {
  it("accepts only allowlisted answers and real channels, once per voter", () => {
    const v = getFeedVideos({ limit: 1 }).videos[0];
    const voter = voterId("test-" + Date.now() + Math.random());

    assert.equal(saveViewerLabel({ vid: v.id, q: "invalid_q", a: ["الشباب"], voter }), false);
    assert.equal(saveViewerLabel({ vid: v.id, q: "aud", a: ["<img src=x onerror=alert(1)>"], voter }), false);
    assert.equal(saveViewerLabel({ vid: "nonexistent_video_id", q: "aud", a: ["الشباب"], voter }), false);
    assert.equal(saveViewerLabel({ vid: v.id, q: "aud", a: ["الشباب"], voter }), true);
    assert.equal(saveViewerLabel({ vid: v.id, q: "aud", a: ["طالب العلم"], voter }), false, "duplicate vote");

    assert.equal(saveViewerLabel({ vid: v.id, q: "trait", a: ["مش موجود"], voter }), false);
    assert.equal(saveViewerLabel({ vid: v.id, q: "trait", a: ["هادي"], voter }), true);

    const other = getCatalogSummary().channels.find((c) => c.name !== v.c)!.name;
    assert.equal(saveViewerLabel({ vid: v.id, q: "similar", a: ["قناة وهمية"], voter }), false);
    assert.equal(saveViewerLabel({ vid: v.id, q: "similar", a: [other], voter }), true);

    const agg = getAggregatedLabels();
    assert.ok((agg.v[v.id]?.aud?.["الشباب"] || 0) >= 1);
    assert.ok((agg.c[v.c]?.trait?.["هادي"] || 0) >= 1);
    for (const q of Object.values(agg.v)) {
      for (const ans of Object.keys(q.aud || {})) assert.ok(!ans.includes("<"), "no unlisted answers");
    }
  });
});

describe("Recommendation layers", () => {
  const vid = (over: Partial<VideoItem>): VideoItem => ({
    id: "AAAAAAAAAAA", t: "فضل الصبر على البلاء", c: "قناة أ", d: 900, tp: "رقائق", g: "علماء", r: 0.5, ...over,
  });

  it("session mood: learns fast, decays with a 40-minute half-life, and favors matching videos", () => {
    resetModelCache();
    const watched = vid({});
    learnFromVideo(watched, 1);
    const now = Date.now();
    const v0 = sessionValue("c:قناة أ", now);
    assert.ok(v0 > 1.4 && v0 <= 4, `session value ${v0}`);
    const half = sessionValue("c:قناة أ", now + SESSION_HALF);
    assert.ok(Math.abs(half - v0 / 2) < 0.01, "half-life");
    assert.equal(sessionValue("d:m", now), 0, "duration is not part of the mood");

    const similar = vid({ id: "BBBBBBBBBBB", t: "الصبر عند المصيبة" });
    const unrelated = vid({ id: "CCCCCCCCCCC", t: "Excel pivot tables", c: "قناة ب", tp: "برمجة", g: "كورسات" });
    assert.ok(getSessionAffinity(similar) > 0.6, "strong mood match");
    assert.ok(getSessionAffinity(similar) > getSessionAffinity(unrelated) + 0.5);
  });

  it("related graph: completion, likes (2x) and recency (0.93^i) weight the boost", () => {
    const graph = { h1: ["x", "y"], h2: ["x"], h3: ["z"] };
    const prog: Record<string, [number, number]> = { h1: [10, 1], h2: [10, 0.5], h3: [1, 0.05] };
    const s = relatedScores(["h1", "h2", "h3"], prog, new Set(), graph);
    assert.ok(Math.abs(s.get("x")! - (1 + 0.7 * 0.93)) < 1e-9);
    assert.ok(Math.abs(s.get("y")! - 1 / 1.35) < 1e-9);
    assert.equal(s.has("z"), false, "barely watched and not liked: no signal");
    const liked = relatedScores(["h1", "h2", "h3"], prog, new Set(["h3"]), graph);
    assert.ok(Math.abs(liked.get("z")! - 0.25 * 2 * 0.93 * 0.93) < 1e-9);
  });

  it("fresh from loved channels: only subscribed/loved, only the last 21 days", () => {
    const now = new Date(2026, 10, 4).getTime();
    const d = (daysAgo: number) => {
      const x = new Date(now - daysAgo * 86400_000);
      return x.getFullYear() * 10000 + (x.getMonth() + 1) * 100 + x.getDate();
    };
    const subs = new Set(["قناة مشترك"]);
    const v = (daysAgo: number, c = "قناة مشترك") => vid({ c, dt: d(daysAgo) });
    assert.ok(Math.abs(newFromLoved(v(0), subs, now) - 0.9) < 0.05);
    assert.ok(newFromLoved(v(10), subs, now) < newFromLoved(v(2), subs, now));
    assert.equal(newFromLoved(v(30), subs, now), 0);
    assert.equal(newFromLoved(v(1, "قناة غريبة"), subs, now), 0);
  });
});

describe("Cross-device sync merge", () => {
  it("merges model features and progress per entry by timestamp instead of wiping a device", () => {
    const local = {
      keys: {
        nt_model: JSON.stringify({ f: { "c:A": [2, 2_000_000_000_000], "c:B": [1, 1_700_000_000_000] } }),
        nt_progress: JSON.stringify({ v1: [100, 0.5, 1_800_000_000_000], v2: [5, 0.1, 1_800_000_000_000] }),
        nt_history: JSON.stringify(["v1", "v2"]),
      },
      ts: { nt_model: 2_000_000_000_000, nt_progress: 1_800_000_000_000, nt_history: 1_800_000_000_000 },
    };
    const remote = {
      keys: {
        nt_model: JSON.stringify({ f: { "c:B": [3, 1_900_000_000_000], "c:C": [1, 1_900_000_000_000] } }),
        nt_progress: JSON.stringify({ v2: [400, 0.9, 1_900_000_000_000], v3: [50, 0.2, 1_900_000_000_000] }),
        nt_history: JSON.stringify(["v3"]),
        nt__ts: "{}",
      },
      ts: { nt_model: 1_900_000_000_000, nt_progress: 1_900_000_000_000, nt_history: 1_900_000_000_000 },
    };
    const m = mergeSnapshots(local, remote);
    const model = JSON.parse(m.keys.nt_model);
    assert.deepEqual(model.f["c:A"], [2, 2_000_000_000_000], "local-only feature kept");
    assert.deepEqual(model.f["c:B"], [3, 1_900_000_000_000], "newer timestamp wins per feature");
    assert.deepEqual(model.f["c:C"], [1, 1_900_000_000_000], "remote-only feature added");
    const prog = JSON.parse(m.keys.nt_progress);
    assert.deepEqual(prog.v1, [100, 0.5, 1_800_000_000_000]);
    assert.deepEqual(prog.v2, [400, 0.9, 1_900_000_000_000], "newer device position wins per video");
    assert.ok(prog.v3, "other device's video kept");
    assert.deepEqual(JSON.parse(m.keys.nt_history), ["v3"], "arrays: newer side wins");
    assert.ok(!("nt__ts" in m.keys), "bookkeeping keys never sync");
    assert.equal(m.ts.nt_model, 2_000_000_000_000);
  });

  it("deepMerge stops at two levels and leaves non-objects to the newer side", () => {
    assert.deepEqual(deepMerge({ a: { b: { c: { d: 1 } } } }, { a: { b: { c: { e: 2 } } } }), { a: { b: { c: { e: 2 } } } });
    assert.equal(deepMerge("old", "new"), "new");
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

describe("Calm feed (رزانة)", () => {
  it("a subscribed, liked religious channel never floods the feed", async () => {
    const mem = new Map<string, string>();
    const g = globalThis as unknown as { window?: unknown };
    const hadWindow = "window" in g;
    g.window = {
      localStorage: {
        getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
        setItem: (k: string, v: string) => void mem.set(k, v),
        removeItem: (k: string) => void mem.delete(k),
      },
      sessionStorage: { getItem: () => null, setItem: () => {} },
    };
    try {
      const { AlgoEngine, CALM, getVideoCategory, learnFromVideo: learn, resetModelCache: reset } =
        await import("../src/lib/client/algo.ts");
      const { ClientStore } = await import("../src/lib/client/store.ts");
      reset();
      const pool: VideoItem[] = [];
      const mk = (i: number, c: string, g: string, tp: string, s: number): VideoItem => ({
        id: `v${String(i).padStart(10, "0")}`, t: `درس ${tp} رقم ${i}`, c, d: 1500, tp, g, r: s, s,
      });
      let n = 0;
      for (let i = 0; i < 120; i++) pool.push(mk(n++, "القناة السلفية", "أنا السلفي", "عقيدة", 0.95));
      for (let k = 0; k < 6; k++) for (let i = 0; i < 25; i++) pool.push(mk(n++, `شيخ ${k}`, "علماء", ["فقه", "رقائق", "تفسير"][k % 3], 0.8));
      for (let k = 0; k < 8; k++) for (let i = 0; i < 25; i++) pool.push(mk(n++, `كورس ${k}`, "كورسات", ["برمجة", "إنجليزي", "تطوير الذات", "فيزياء"][k % 4], 0.6));
      for (let k = 0; k < 8; k++) for (let i = 0; i < 25; i++) pool.push(mk(n++, `ورشة ${k}`, "اصنعها بنفسك", ["نجارة", "زراعة وتربية", "ترميم", "طبخ"][k % 4], 0.6));

      ClientStore.toggleSub("القناة السلفية");
      for (let i = 0; i < 6; i++) learn(pool[i], 1.8); // likes + "more like this" several times

      const used = new Set<string>();
      const recent: string[] = [];
      const feed = [
        ...AlgoEngine.buildFeedBatch(pool, 20, used, recent),
        ...AlgoEngine.buildFeedBatch(pool, 20, used, recent),
      ];
      assert.equal(feed.length, 40);
      const sub = feed.filter((v) => v.c === "القناة السلفية").length;
      assert.ok(sub >= 2 && sub <= 4, `subscribed channel shows but doesn't flood: ${sub}/40`);
      for (let i = 0; i < feed.length; i++) {
        // (this viewer subscribed to and liked a religious channel: religious content may lead, but the channel doesn't flood)
        void getVideoCategory;
        // (7 religious channels only in this made-up pool: the guaranteed minimum is 2 cards apart and 2 in any 20)
        const prev = feed.slice(Math.max(0, i - 2), i).map((v) => v.c);
        assert.ok(!prev.includes(feed[i].c), `channel gap at ${i}`);
        assert.ok(feed.slice(Math.max(0, i - 19), i + 1).filter((v) => v.c === feed[i].c).length <= CALM.channelPer20, `channel per 20 at ${i}`);
        if (i > 0) assert.notEqual(feed[i].tp, feed[i - 1].tp, `same topic twice at ${i}`);
      }

      // A topic chip with only one kind of video still fills (rules relax instead of leaving it empty)
      const onlyAqeeda = pool.filter((v) => v.tp === "عقيدة");
      assert.equal(AlgoEngine.buildFeedBatch(onlyAqeeda, 12, new Set(), []).length, 12);
    } finally {
      if (!hadWindow) delete g.window;
      resetModelCache();
    }
  });
});

describe("New first, and what you picked", () => {
  it("rhythm: religious only in the 4th and 8th place, the rest leans on the picks", async () => {
    const { getRhythmSlots } = await import("../src/lib/client/algo.ts");
    for (const h of [8, 15, 23]) {
      const r = getRhythmSlots(h, []);
      assert.deepEqual(r.map((k, i) => (k === "وعظ" ? i : -1)).filter((i) => i >= 0), [3, 7]);
    }
    const work = getRhythmSlots(23, ["برمجة", "إنجليزي", "ذكاء اصطناعي"]);
    const fun = getRhythmSlots(8, ["نجارة", "زراعة وتربية", "قصص"]);
    assert.equal(work[0], "عمل");
    assert.ok(work.filter((k) => k === "عمل").length >= 4);
    assert.equal(fun[0], "ترفيه");
    assert.ok(fun.filter((k) => k === "ترفيه").length >= 4);
  });

  it("fresh boost: today > this week > two weeks ago > older or undated", async () => {
    const { freshBoost } = await import("../src/lib/client/algo.ts");
    const now = new Date(2026, 10, 7, 12).getTime();
    const v = (dt?: number): VideoItem => ({ id: "x", t: "t", c: "c", d: 900, tp: "برمجة", g: "كورسات", r: 0.5, dt });
    const today = freshBoost(v(20261107), 0, now);
    const week = freshBoost(v(20261102), 0, now);
    const old = freshBoost(v(20261020), 0, now);
    assert.ok(today > week && week > 0 && old === 0, `${today} ${week} ${old}`);
    assert.equal(freshBoost(v(undefined), 0, now), 0);
    assert.ok(freshBoost(v(20261107), -1, now) < today);
  });

  it("home pool carries plenty of each picked topic and every recent upload", () => {
    const plain = getFeedVideos({ limit: 2500 }).videos;
    const picked = getFeedVideos({ limit: 2500, interests: ["نجارة"] }).videos;
    const n = (l: VideoItem[]) => l.filter((v) => v.tp === "نجارة").length;
    assert.ok(n(picked) >= Math.min(60, n(plain) + 30), `${n(plain)} -> ${n(picked)}`);
    const relig = plain.filter((v) => ["علماء", "أنا السلفي", "القرآن الكريم"].includes(v.g)).length;
    assert.ok(relig / plain.length < 0.4, `religious share ${relig}/${plain.length}`);
    const newest = Math.max(...plain.map((v) => v.dt || 0));
    assert.ok(plain.slice(0, 5).every((v) => (v.dt || 0) >= newest - 100), "newest uploads lead the pool");
  });
});

describe("Hourly new-video sync rules", () => {
  it("reads YouTube durations and keeps the site's title rules", async () => {
    const { isoSeconds, titleAllowed } = await import("../scripts/sync-new.ts");
    assert.equal(isoSeconds("PT1H2M3S"), 3723);
    assert.equal(isoSeconds("PT59S"), 59);
    assert.equal(isoSeconds("P0D"), 0);
    assert.ok(titleAllowed("شرح بايثون للمبتدئين", "كورسات"));
    assert.ok(!titleAllowed("أفضل فيلم رعب", "كورسات"));
    assert.ok(titleAllowed("حكم مشاهدة الأفلام", "علماء"));
    assert.ok(!titleAllowed("اغنية جديدة", "علماء"));
  });
});

describe("Live new uploads (before the catalog rebuild)", () => {
  it("shows a just-synced video in the fresh pool, by id, on its page and on its channel", async () => {
    const { loadLiveFresh } = await import("../src/lib/live-fresh.ts");
    const { getFreshVideos, getVideosByIds, getVideoDetail, getChannelPageData } = await import("../src/lib/db.ts");
    const d = new Date();
    const dt = d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
    const row = { id: "LIVEtest001", title: "شرح جديد لسه نازل", duration: 600, views: 10, channel: "Youssef Alkhodary", channel_id: "UCIvkyOth3_zSxE32OqQqjtg", group: "كورسات", field: "ذكاء اصطناعي", dt };
    process.env.MOHSEN_LIVE_FRESH = "on";
    process.env.MOHSEN_FRESH_URL = "data:text/plain;charset=utf-8," + encodeURIComponent(JSON.stringify(row) + "\n");
    try {
      await loadLiveFresh();
      assert.equal(getFreshVideos()[0].id, "LIVEtest001");
      assert.equal(getVideosByIds(["LIVEtest001"])[0]?.t, row.title);
      assert.equal(getVideoDetail("LIVEtest001")?.video.c, "Youssef Alkhodary");
      assert.equal(getChannelPageData("Youssef Alkhodary")?.videos[0].id, "LIVEtest001");
    } finally {
      delete process.env.MOHSEN_LIVE_FRESH;
      delete process.env.MOHSEN_FRESH_URL;
    }
  });
});

describe("ترفيه changes every visit", () => {
  it("different visits draw different mixes, and what you were shown moves down", async () => {
    const mem = new Map<string, string>();
    const g = globalThis as unknown as { window?: unknown };
    g.window = {
      localStorage: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
      sessionStorage: { getItem: () => null, setItem: () => {} },
    };
    const { getFunPool } = await import("../src/lib/db.ts");
    const { buildFunLayout } = await import("../src/lib/client/fun.ts");
    const a = getFunPool("visit-a");
    const b = getFunPool("visit-b");
    assert.deepEqual(getFunPool("visit-a").map((v) => v.id), a.map((v) => v.id), "same seed, same draw");
    const inB = new Set(b.map((v) => v.id));
    const overlap = a.filter((v) => inB.has(v.id)).length / a.length;
    assert.ok(overlap < 0.6, `two visits share ${Math.round(overlap * 100)}% of the pool`);
    const first = buildFunLayout(a, new Date(), "visit-a");
    const firstIds = new Set(first.shelves.flatMap((s) => s.videos.slice(0, 6)).map((v) => v.id));
    const again = buildFunLayout(a, new Date(), "visit-a2");
    const againTop = again.shelves.flatMap((s) => s.videos.slice(0, 6)).map((v) => v.id);
    const repeat = againTop.filter((id) => firstIds.has(id)).length / againTop.length;
    assert.ok(repeat < 0.35, `same pool, next visit repeats ${Math.round(repeat * 100)}% of the top cards`);
    assert.ok(first.shelves.some((s) => s.key === "land" && s.videos.some((v) => v.tp === "زراعة وتربية")));
  });
});

describe("School lessons stay out of suggestions", () => {
  it("home and fun pools carry no primary/preparatory/secondary videos unless asked", async () => {
    const { getFeedVideos, getFunPool, isSchoolVideo } = await import("../src/lib/db.ts");
    assert.ok(isSchoolVideo({ t: "مراجعة ليلة الامتحان كيمياء الصف الثالث الثانوي", c: "x" }));
    assert.ok(!isSchoolVideo({ t: "شرح بايثون للمبتدئين", c: "x" }));
    const home = getFeedVideos({ limit: 2500, interests: ["كيمياء", "إنجليزي"] }).videos;
    assert.equal(home.filter((v) => isSchoolVideo(v)).length, 0);
    const withSchool = getFeedVideos({ limit: 2500, interests: ["كيمياء"], school: true }).videos;
    assert.ok(withSchool.some((v) => isSchoolVideo(v)), "someone who chose a study subject still gets them");
    assert.equal(getFunPool("s").filter((v) => isSchoolVideo(v)).length, 0);
  });
});

describe("Only what you're into; religious content by interest", () => {
  it("someone into programming gets programming, and religious content only rarely and gently", async () => {
    const mem = new Map<string, string>();
    (globalThis as unknown as { window: unknown }).window = {
      localStorage: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
      sessionStorage: { getItem: () => null, setItem: () => {} },
    };
    const { AlgoEngine, getVideoCategory, resetModelCache } = await import("../src/lib/client/algo.ts");
    const feedFor = (picks: string[]) => {
      mem.clear();
      resetModelCache();
      AlgoEngine.seedInterests(picks, []);
      const pool = getFeedVideos({ limit: 2500, interests: AlgoEngine.interests() }).videos;
      const used = new Set<string>();
      const recent: string[] = [];
      return [...AlgoEngine.buildFeedBatch(pool, 24, used, recent), ...AlgoEngine.buildFeedBatch(pool, 24, used, recent)];
    };
    const coder = feedFor(["برمجة", "ذكاء اصطناعي"]);
    const deen = coder.filter((v) => getVideoCategory(v) === "وعظ");
    assert.equal(coder.filter((v) => getVideoCategory(v) !== "وعظ" && !["برمجة", "ذكاء اصطناعي"].includes(v.tp)).length, 0, "nothing outside the interests");
    assert.ok(deen.length >= 2 && deen.length <= 5, `religious stays rare: ${deen.length}/48`);
    assert.ok(deen.every((v) => (v.d || 0) <= 1500), "and gentle (short)");
    const devout = feedFor(["تفسير", "حديث", "عقيدة"]);
    const kinds = new Set(devout.map((v) => v.tp));
    assert.ok(devout.every((v) => getVideoCategory(v) === "وعظ"), "religious viewers get religious content");
    assert.ok(kinds.size >= 4, `with variety: ${[...kinds].join(", ")}`);
  });
});

describe("Religious content grows slowly over the years", () => {
  it("each kind of viewer starts gentle and deepens over two years", async () => {
    const { profilePattern } = await import("../src/lib/client/algo.ts");
    const share = (p: string[]) => p.filter((k) => k === "وعظ").length / p.length;
    const visitor = { topics: new Set<string>(), deen: "none" as const, kinds: { "وعظ": 0, "عمل": 0, "ترفيه": 0 } };
    const coder = { topics: new Set(["برمجة"]), deen: "none" as const, kinds: { "وعظ": 0, "عمل": 1, "ترفيه": 0 } };
    const some = { topics: new Set(["برمجة", "سيرة وتاريخ"]), deen: "some" as const, kinds: { "وعظ": 1, "عمل": 2, "ترفيه": 0 } };
    for (const p of [visitor, coder, some]) {
      const start = share(profilePattern(p, 10, 0));
      const later = share(profilePattern(p, 10, 1));
      assert.ok(later > start, `grows: ${start} -> ${later}`);
      assert.notEqual(profilePattern(p, 10, 0)[0], "وعظ", "never the first card");
    }
    assert.ok(share(profilePattern(visitor, 10, 0)) <= 0.13, "a new visitor starts at about 1 in 8");
    assert.ok(share(profilePattern(coder, 10, 0)) <= 0.09, "not interested: about 1 in 12");
  });
});

describe("A first-time visitor who skipped the picks", () => {
  it("gets mostly Arabic: 4 in 5 cards, 1 in 5 foreign", async () => {
    const mem = new Map<string, string>();
    (globalThis as unknown as { window: unknown }).window = {
      localStorage: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
      sessionStorage: { getItem: () => null, setItem: () => {} },
    };
    const { AlgoEngine, resetModelCache } = await import("../src/lib/client/algo.ts");
    mem.clear();
    resetModelCache();
    const pool = getFeedVideos({ limit: 2500 }).videos;
    const used = new Set<string>();
    const recent: string[] = [];
    const feed = [...AlgoEngine.buildFeedBatch(pool, 25, used, recent), ...AlgoEngine.buildFeedBatch(pool, 25, used, recent)];
    const ar = feed.filter((v) => /[؀-ۿ]/.test(v.t)).length;
    assert.equal(feed.length, 50);
    assert.equal(ar, 40, `Arabic ${ar}/50`);
    assert.ok(new Set(feed.map((v) => v.tp)).size >= 8, "and varied");
  });
});
