/**
 * Shared state for all visitors (watch-together rooms, viewer labels) lives in Supabase, because the
 * free host wipes the server's files whenever it restarts. Without Supabase settings (local tests) it
 * falls back to the SQLite functions in db.ts.
 *
 * Validation that needs the catalog (video exists, channel comes from the catalog, "similar" answers
 * are real channels) still runs here against SQLite; the Supabase functions add their own checks
 * (codes, tokens, allowlisted answers, one vote per voter, vote cap) so they're safe to expose.
 */
import crypto from "node:crypto";
import type { LabelsAggregate, RoomState } from "./types.ts";
import {
  LABEL_ANSWERS,
  createRoom as sqliteCreateRoom,
  getAggregatedLabels as sqliteAggregated,
  getDb,
  getRoom as sqliteGetRoom,
  joinRoom as sqliteJoinRoom,
  saveViewerLabel as sqliteSaveLabel,
  updateRoom as sqliteUpdateRoom,
} from "./db.ts";

const SB_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
const useSupabase = () => !!(SB_URL && SB_KEY) && process.env.MOHSEN_SHARED_STORE !== "sqlite";

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T | null> {
  const res = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`supabase ${fn} ${res.status}`);
  return (await res.json()) as T | null;
}

// ---------- Rooms ----------
const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const cleanCode = (code: string) => String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
const newCode = () => {
  const bytes = crypto.randomBytes(8);
  return Array.from(bytes, (b) => ROOM_ALPHABET[b % ROOM_ALPHABET.length]).join("");
};

function cleanRoomInput(input: { vid: string; t: number; by: string }) {
  const vid = String(input.vid || "").trim();
  const by = String(input.by || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 20);
  if (!/^[A-Za-z0-9_-]{6,16}$/.test(vid) || !by) return null;
  if (!getDb().prepare(`SELECT 1 FROM videos WHERE id = ?`).get(vid)) return null;
  return { vid, by, t: Math.max(0, Math.min(Number(input.t) || 0, 86400)) };
}

export async function getRoom(code: string): Promise<RoomState | null> {
  if (!useSupabase()) return sqliteGetRoom(code);
  const c = cleanCode(code);
  return c ? rpc<RoomState>("room_get", { p_code: c }) : null;
}

export async function createRoom(input: { vid: string; t: number; playing: boolean; by: string }) {
  if (!useSupabase()) return sqliteCreateRoom(input);
  const clean = cleanRoomInput(input);
  if (!clean) return null;
  const token = crypto.randomBytes(24).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  for (let i = 0; i < 5; i++) {
    const room = await rpc<RoomState>("room_create", {
      p_code: newCode(),
      p_token_hash: tokenHash,
      p_vid: clean.vid,
      p_t: clean.t,
      p_playing: !!input.playing,
      p_by: clean.by,
    });
    if (room) return { room, token };
  }
  return null;
}

export async function joinRoom(code: string) {
  if (!useSupabase()) return sqliteJoinRoom(code);
  const c = cleanCode(code);
  return c ? rpc<{ room: RoomState; token: string }>("room_join", { p_code: c }) : null;
}

export async function updateRoom(input: { code: string; token: string; vid: string; t: number; playing: boolean; by: string }) {
  if (!useSupabase()) return sqliteUpdateRoom(input);
  const c = cleanCode(input.code);
  const clean = cleanRoomInput(input);
  if (!c || !clean || !input.token) return null;
  return rpc<RoomState>("room_update", {
    p_code: c,
    p_token: String(input.token),
    p_vid: clean.vid,
    p_t: clean.t,
    p_playing: !!input.playing,
    p_by: clean.by,
  });
}

// ---------- Viewer labels ----------
const VIDEO_QUESTIONS = new Set(["aud"]);

export async function saveViewerLabel(input: { vid: string; q: string; a: string[]; voter?: string }): Promise<boolean> {
  if (!useSupabase()) return sqliteSaveLabel(input);
  if (!["aud", "trait", "edge", "similar"].includes(input.q)) return false;
  if (!/^[A-Za-z0-9_-]{6,16}$/.test(input.vid)) return false;
  const db = getDb();
  const video = db.prepare(`SELECT c FROM videos WHERE id = ?`).get(input.vid) as { c: string } | undefined;
  if (!video) return false;
  const ch = video.c; // the channel always comes from the catalog
  const raw = [...new Set((input.a || []).map((x) => String(x).trim()))].filter(Boolean).slice(0, 3);
  let answers: string[];
  if (input.q === "similar") {
    const known = new Set(
      raw.length
        ? (db.prepare(`SELECT name FROM channels WHERE name IN (${raw.map(() => "?").join(",")})`).all(...raw) as Array<{ name: string }>).map((r) => r.name)
        : []
    );
    answers = raw.filter((x) => known.has(x) && x !== ch);
  } else {
    const allowed = LABEL_ANSWERS[input.q as "aud" | "trait" | "edge"];
    answers = raw.filter((x) => allowed.has(x));
  }
  if (!answers.length) return false;
  const isVideoQ = VIDEO_QUESTIONS.has(input.q);
  const ok = await rpc<boolean>("label_add", {
    p_vid: isVideoQ ? input.vid : "",
    p_ch: isVideoQ ? "" : ch,
    p_q: input.q,
    p_answers: answers,
    p_voter: input.voter || "",
  });
  if (ok) labelsCache = null;
  return !!ok;
}

let labelsCache: { at: number; data: LabelsAggregate } | null = null;

/** Totals per video/channel question; cached a minute so the home page doesn't hit Supabase on every load */
export async function getAggregatedLabels(): Promise<LabelsAggregate> {
  if (!useSupabase()) return sqliteAggregated();
  if (labelsCache && Date.now() - labelsCache.at < 60_000) return labelsCache.data;
  const out: LabelsAggregate = { v: {}, c: {} };
  try {
    const rows = (await rpc<Array<{ vid: string; ch: string; q: string; answer: string; n: number }>>("labels_totals", {})) || [];
    for (const r of rows) {
      if (r.q !== "similar" && !LABEL_ANSWERS[r.q as "aud" | "trait" | "edge"]?.has(r.answer)) continue;
      const isVideoQ = VIDEO_QUESTIONS.has(r.q);
      const key = isVideoQ ? r.vid : r.ch;
      if (!key) continue;
      const bucket = isVideoQ ? out.v : out.c;
      const qMap = ((bucket[key] = bucket[key] || {})[r.q] = bucket[key][r.q] || {});
      qMap[r.answer] = (qMap[r.answer] || 0) + Number(r.n);
    }
  } catch {
    return labelsCache?.data || out;
  }
  labelsCache = { at: Date.now(), data: out };
  return out;
}
