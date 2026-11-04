"use client";

// "حسابك": every nt_* key in localStorage (history, progress, the recommendation model, subscriptions,
// clips, playlists...) follows the viewer across devices.
// - Every write to an nt_* key records its time in nt__ts.
// - On sign-in / page load we pull the cloud copy and merge: per key the newer side wins, and objects merge
//   two levels deep, with [value, timestamp] tuples (model features, progress) won by the newer timestamp,
//   so two devices add up instead of one wiping the other.
// - Cloud = optional Supabase (NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY), talked to over
//   its REST API (no SDK). Without it, the same merge powers the JSON backup export/import in /library.

export const TS_KEY = "nt__ts";
const LAST_KEY = "nt__synced";
const SESSION_KEY = "nt__auth";
/** Set when this browser asks for a sign-in link; a redirect is only accepted while it's fresh. */
const PENDING_KEY = "nt__auth_pending";
const PENDING_TTL = 3600_000;
const SKIP = new Set(["nt_live", TS_KEY, LAST_KEY, SESSION_KEY, PENDING_KEY]);
export const isSyncedKey = (k: string) => k.startsWith("nt_") && !SKIP.has(k);

export interface Snapshot {
  keys: Record<string, string>;
  ts: Record<string, number>;
}

type Json = unknown;
const plain = (o: Json): o is Record<string, Json> => !!o && typeof o === "object" && !Array.isArray(o);
/** A [value, ..., timestamp] tuple whose last element is a ms epoch. */
const stamped = (a: Json): a is unknown[] =>
  Array.isArray(a) && a.length >= 2 && typeof a[a.length - 1] === "number" && (a[a.length - 1] as number) > 1e12;

/** Merge two parsed values up to `depth` object levels; `newer` wins on conflicts except newer-stamped tuples. */
export function deepMerge(older: Json, newer: Json, depth = 2): Json {
  if (!plain(older) || !plain(newer)) return newer;
  const out: Record<string, Json> = { ...older };
  for (const [k, nv] of Object.entries(newer)) {
    const ov = older[k];
    if (depth > 0 && plain(ov) && plain(nv)) out[k] = deepMerge(ov, nv, depth - 1);
    else if (stamped(ov) && stamped(nv)) out[k] = (ov[ov.length - 1] as number) > (nv[nv.length - 1] as number) ? ov : nv;
    else out[k] = nv;
  }
  return out;
}

const parse = (s: string | undefined): Json => {
  if (s === undefined) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
};

/** Merge a remote snapshot into a local one (pure; used by sync, backup import and tests). */
export function mergeSnapshots(local: Snapshot, remote: Snapshot): Snapshot {
  const keys: Record<string, string> = {};
  const ts: Record<string, number> = { ...remote.ts, ...local.ts };
  for (const k of new Set([...Object.keys(remote.keys), ...Object.keys(local.keys)])) {
    if (!isSyncedKey(k)) continue;
    const r = remote.keys[k];
    const l = local.keys[k];
    const rt = remote.ts[k] || 0;
    const lt = local.ts[k] || 0;
    if (r === undefined) {
      keys[k] = l;
      ts[k] = lt;
      continue;
    }
    if (l === undefined) {
      keys[k] = r;
      ts[k] = rt;
      continue;
    }
    const [newer, older] = lt >= rt ? [l, r] : [r, l];
    const on = parse(newer);
    const oo = parse(older);
    keys[k] = plain(on) && plain(oo) ? JSON.stringify(deepMerge(oo, on)) : newer;
    ts[k] = Math.max(lt, rt);
  }
  return { keys, ts };
}

// ---------- local side ----------
const hasWindow = () => typeof window !== "undefined";
const tsMap = (): Record<string, number> => {
  try {
    return JSON.parse(window.localStorage.getItem(TS_KEY) || "{}") || {};
  } catch {
    return {};
  }
};

let installed = false;
let rawSet: ((this: Storage, k: string, v: string) => void) | null = null;
let onLocalChange: (() => void) | null = null;

/** Record a timestamp for every nt_* write (call once on the client). */
export function installWriteTracking(): void {
  if (!hasWindow() || installed) return;
  installed = true;
  const proto = Storage.prototype;
  const set = proto.setItem;
  const remove = proto.removeItem;
  rawSet = set;
  const touch = (k: string) => {
    const m = tsMap();
    m[k] = Date.now();
    set.call(window.localStorage, TS_KEY, JSON.stringify(m));
    onLocalChange?.();
  };
  proto.setItem = function (this: Storage, k: string, v: string) {
    set.call(this, k, v);
    if (this === window.localStorage && isSyncedKey(k)) touch(k);
  };
  proto.removeItem = function (this: Storage, k: string) {
    remove.call(this, k);
    if (this === window.localStorage && isSyncedKey(k)) touch(k);
  };
}

export function localSnapshot(): Snapshot {
  const keys: Record<string, string> = {};
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (k && isSyncedKey(k)) keys[k] = window.localStorage.getItem(k) || "";
  }
  return { keys, ts: tsMap() };
}

/** Write a merged snapshot back; returns true if anything changed. */
function applySnapshot(s: Snapshot): boolean {
  const set = rawSet || Storage.prototype.setItem;
  let changed = false;
  for (const [k, v] of Object.entries(s.keys)) {
    if (!isSyncedKey(k) || typeof v !== "string") continue;
    if (window.localStorage.getItem(k) !== v) {
      set.call(window.localStorage, k, v);
      changed = true;
    }
  }
  set.call(window.localStorage, TS_KEY, JSON.stringify(s.ts || {}));
  return changed;
}

// ---------- backup file ----------
export function exportBackup(): string {
  return JSON.stringify({ app: "mohsen-tube", v: 1, at: Date.now(), ...localSnapshot() });
}

/** Merge a backup file into this browser. Returns true if data changed (caller should reload). */
export function importBackup(text: string): boolean {
  const data = parse(text);
  if (!plain(data) || data.app !== "mohsen-tube" || !plain(data.keys) || !plain(data.ts)) {
    throw new Error("bad backup");
  }
  const remote: Snapshot = {
    keys: Object.fromEntries(Object.entries(data.keys).filter(([, v]) => typeof v === "string")) as Record<string, string>,
    ts: Object.fromEntries(Object.entries(data.ts).filter(([, v]) => typeof v === "number")) as Record<string, number>,
  };
  return applySnapshot(mergeSnapshots(localSnapshot(), remote));
}

// ---------- Supabase (optional) ----------
const SB_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
export const cloudConfigured = () => !!(SB_URL && SB_KEY);

interface AuthSession {
  access_token: string;
  refresh_token: string;
  expires_at: number; // seconds
  email: string;
  user_id: string;
}

const readSession = (): AuthSession | null => {
  try {
    return JSON.parse(window.localStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
};
const writeSession = (s: AuthSession | null) => {
  if (s) window.localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  else window.localStorage.removeItem(SESSION_KEY);
};

function decodeJwt(token: string): { sub?: string; email?: string } {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(part));
  } catch {
    return {};
  }
}

export function currentUser(): { email: string } | null {
  if (!hasWindow()) return null;
  const s = readSession();
  return s ? { email: s.email } : null;
}

export function lastSyncedAt(): number {
  return hasWindow() ? Number(window.localStorage.getItem(LAST_KEY) || 0) : 0;
}

/** Sends a magic sign-in link; it comes back to /library with tokens in the URL hash. */
export async function sendMagicLink(email: string): Promise<boolean> {
  if (!cloudConfigured()) return false;
  const redirect = window.location.origin + "/library";
  window.localStorage.setItem(PENDING_KEY, String(Date.now()));
  const res = await fetch(`${SB_URL}/auth/v1/otp?redirect_to=${encodeURIComponent(redirect)}`, {
    method: "POST",
    headers: { apikey: SB_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, create_user: true }),
  });
  return res.ok;
}

/**
 * One-tap sign-in with Google: Supabase sends the viewer to Google and back here with the session in
 * the URL hash (same shape as the magic link), which captureAuthRedirect() picks up.
 */
export async function signInWithGoogle(): Promise<boolean> {
  if (!cloudConfigured()) return false;
  // Ask Supabase first: if Google isn't switched on there, its authorize URL is a bare JSON error page
  try {
    const res = await fetch(`${SB_URL}/auth/v1/settings`, { headers: { apikey: SB_KEY } });
    const settings = (await res.json()) as { external?: Record<string, boolean> };
    if (!settings.external?.google) return false;
  } catch {
    return false;
  }
  window.localStorage.setItem(PENDING_KEY, String(Date.now()));
  const back = window.location.origin + window.location.pathname;
  window.location.href = `${SB_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(back)}`;
  return true;
}

/** If the URL hash carries a fresh sign-in, store the session and clean the URL. */
export function captureAuthRedirect(): boolean {
  if (!hasWindow() || !window.location.hash.includes("access_token=")) return false;
  // Only a sign-in this browser asked for: otherwise a crafted link could log the viewer into someone
  // else's account and sync their data there (login CSRF).
  const pendingAt = Number(window.localStorage.getItem(PENDING_KEY) || 0);
  const cleanUrl = () => history.replaceState(null, "", window.location.pathname + window.location.search);
  if (!pendingAt || Date.now() - pendingAt > PENDING_TTL) {
    cleanUrl();
    return false;
  }
  window.localStorage.removeItem(PENDING_KEY);
  const p = new URLSearchParams(window.location.hash.slice(1));
  const access = p.get("access_token");
  const refresh = p.get("refresh_token");
  if (!access || !refresh) return false;
  const claims = decodeJwt(access);
  writeSession({
    access_token: access,
    refresh_token: refresh,
    expires_at: Math.floor(Date.now() / 1000) + Number(p.get("expires_in") || 3600),
    email: claims.email || "",
    user_id: claims.sub || "",
  });
  history.replaceState(null, "", window.location.pathname + window.location.search);
  return true;
}

async function validSession(): Promise<AuthSession | null> {
  const s = readSession();
  if (!s) return null;
  if (s.expires_at - 60 > Date.now() / 1000) return s;
  const res = await fetch(`${SB_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: SB_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: s.refresh_token }),
  });
  if (!res.ok) {
    if (res.status === 400 || res.status === 401) writeSession(null);
    return null;
  }
  const j = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
  const next = { ...s, access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Math.floor(Date.now() / 1000) + j.expires_in };
  writeSession(next);
  return next;
}

const authHeaders = (s: AuthSession) => ({
  apikey: SB_KEY,
  Authorization: `Bearer ${s.access_token}`,
  "Content-Type": "application/json",
});

export async function push(): Promise<boolean> {
  if (!cloudConfigured()) return false;
  const s = await validSession();
  if (!s) return false;
  const res = await fetch(`${SB_URL}/rest/v1/user_data?on_conflict=user_id`, {
    method: "POST",
    headers: { ...authHeaders(s), Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ user_id: s.user_id, data: localSnapshot(), updated_at: new Date().toISOString() }),
  });
  if (res.ok) (rawSet || Storage.prototype.setItem).call(window.localStorage, LAST_KEY, String(Date.now()));
  return res.ok;
}

/** Pull + merge + push. Returns true if local data changed (caller should reload so every module re-reads). */
export async function pull(): Promise<boolean> {
  if (!cloudConfigured()) return false;
  const s = await validSession();
  if (!s) return false;
  const res = await fetch(`${SB_URL}/rest/v1/user_data?select=data&user_id=eq.${encodeURIComponent(s.user_id)}`, {
    headers: authHeaders(s),
  });
  if (!res.ok) return false;
  const rows = (await res.json()) as Array<{ data: Snapshot }>;
  const changed = rows[0]?.data ? applySnapshot(mergeSnapshots(localSnapshot(), rows[0].data)) : false;
  await push();
  return changed;
}

export async function signOut(): Promise<void> {
  await push().catch(() => false);
  const s = readSession();
  if (s && cloudConfigured()) {
    await fetch(`${SB_URL}/auth/v1/logout`, { method: "POST", headers: authHeaders(s) }).catch(() => {});
  }
  writeSession(null);
}

/** Start background syncing: pull once, then push ~15s after local changes and when the tab is hidden. */
let started = false;
export function startSync(onReloadNeeded: () => void): void {
  if (!hasWindow() || started) return;
  started = true;
  installWriteTracking();
  captureAuthRedirect();
  if (!cloudConfigured() || !readSession()) return;
  let timer: ReturnType<typeof setTimeout> | null = null;
  onLocalChange = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void push(), 15_000);
  };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && timer) {
      clearTimeout(timer);
      timer = null;
      void push();
    }
  });
  pull()
    .then((changed) => changed && onReloadNeeded())
    .catch(() => {});
}
