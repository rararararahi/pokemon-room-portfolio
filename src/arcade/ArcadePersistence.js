import { canonicalizeNickname, validateNickname } from "./profile";

const PROFILE_KEY = "arcade_profile_v1";
const LEADERBOARDS_KEY = "arcade_leaderboards_v1";
const MIN_NICKNAME_LEN = 2;
const MAX_NICKNAME_LEN = 10;
const MAX_ENTRIES = 5;
const GLOBAL_LEADERBOARD_TTL_MS = 30000;
const GLOBAL_ATTEMPT_COOLDOWN_MS = 5000;
const LEADERBOARD_UPDATE_EVENT = "arcade:leaderboard-updated";

const globalLeaderboardCache = new Map();
const globalLeaderboardStatus = new Map();
const globalLeaderboardInflight = new Map();
const globalLeaderboardLastAttempt = new Map();

function canUseStorage() {
  return typeof window !== "undefined" && !!window.localStorage;
}

function readJson(key, fallback) {
  if (!canUseStorage()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function normalizeGameId(gameId) {
  return String(gameId || "").trim().toLowerCase();
}

function sanitizeNickname(value) {
  const canonical = canonicalizeNickname(value).slice(0, MAX_NICKNAME_LEN);
  if (!validateNickname(canonical)) return "";
  return canonical;
}

function sanitizeEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const nickname = sanitizeNickname(entry.nickname);
  const score = Math.max(0, Math.floor(Number(entry.score) || 0));
  const ts = Number.isFinite(entry.ts) ? Math.floor(entry.ts) : Date.now();
  if (!nickname) return null;
  return { nickname, score, ts };
}

function sortEntries(entries) {
  return entries
    .slice()
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.ts - b.ts;
    })
    .slice(0, MAX_ENTRIES);
}

function sanitizeEntries(entries) {
  if (!Array.isArray(entries)) return [];
  const cleaned = [];
  for (let i = 0; i < entries.length; i += 1) {
    const safe = sanitizeEntry(entries[i]);
    if (safe) cleaned.push(safe);
  }
  return sortEntries(cleaned);
}

function readLeaderboards() {
  const raw = readJson(LEADERBOARDS_KEY, {});
  const next = {};
  const keys = Object.keys(raw || {});
  for (let i = 0; i < keys.length; i += 1) {
    const gameId = normalizeGameId(keys[i]);
    if (!gameId) continue;
    next[gameId] = sanitizeEntries(raw[keys[i]]);
  }
  return next;
}

function writeLeaderboards(data) {
  writeJson(LEADERBOARDS_KEY, data || {});
}

function emitLeaderboardUpdate(gameId) {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  try {
    window.dispatchEvent(new CustomEvent(LEADERBOARD_UPDATE_EVENT, { detail: { gameId } }));
  } catch {}
}

function setCachedGlobalLeaderboard(gameId, entries) {
  globalLeaderboardCache.set(gameId, {
    entries: sanitizeEntries(entries),
    fetchedAt: Date.now(),
  });
  globalLeaderboardStatus.set(gameId, "global");
}

function setLocalLeaderboard(gameId, entries) {
  const id = normalizeGameId(gameId);
  if (!id) return [];
  const all = readLeaderboards();
  const safe = sanitizeEntries(entries);
  all[id] = safe;
  writeLeaderboards(all);
  return safe;
}

function getLocalLeaderboard(gameId) {
  const id = normalizeGameId(gameId);
  if (!id) return [];
  const all = readLeaderboards();
  return sanitizeEntries(all[id] || []);
}

function submitLocalScore(gameId, nickname, score) {
  const id = normalizeGameId(gameId);
  if (!id) return [];

  const safeNickname = sanitizeNickname(nickname);
  if (!safeNickname) return getLocalLeaderboard(id);
  const safeScore = Math.max(0, Math.floor(Number(score) || 0));
  const all = readLeaderboards();
  const current = sanitizeEntries(all[id] || []);

  current.push({
    nickname: safeNickname,
    score: safeScore,
    ts: Date.now(),
  });

  const next = sortEntries(current);
  all[id] = next;
  writeLeaderboards(all);
  return next;
}

export function getNicknameConstraints() {
  return {
    min: MIN_NICKNAME_LEN,
    max: MAX_NICKNAME_LEN,
  };
}

export function normalizeNickname(value) {
  return sanitizeNickname(value);
}

export function getArcadeProfile() {
  const raw = readJson(PROFILE_KEY, {});
  const nickname = sanitizeNickname(raw?.nickname);
  if (!nickname) return null;
  const createdAt = Number.isFinite(raw?.createdAt) ? Math.floor(raw.createdAt) : Date.now();
  return { nickname, createdAt };
}

export function setArcadeNickname(nickname) {
  const safeNickname = sanitizeNickname(nickname);
  if (!safeNickname) return null;
  const prev = getArcadeProfile();
  const next = {
    nickname: safeNickname,
    createdAt: prev?.createdAt || Date.now(),
  };
  writeJson(PROFILE_KEY, next);
  return next;
}

export function getArcadeNickname() {
  return getArcadeProfile()?.nickname || "";
}

export function getLeaderboard(gameId) {
  const id = normalizeGameId(gameId);
  if (!id) return [];
  const cached = globalLeaderboardCache.get(id);
  const now = Date.now();
  const isFresh = !!cached && now - cached.fetchedAt <= GLOBAL_LEADERBOARD_TTL_MS;

  if (!isFresh) {
    void requestLeaderboardRefresh(id, { force: !cached });
  }

  if (cached?.entries?.length) return sanitizeEntries(cached.entries);
  return getLocalLeaderboard(id);
}

export function getAllLeaderboards() {
  return readLeaderboards();
}

export function getLeaderboardSource(gameId) {
  const id = normalizeGameId(gameId);
  if (!id) return "unknown";
  return globalLeaderboardStatus.get(id) || "unknown";
}

export async function getGlobalLeaderboard(gameId, { force = false } = {}) {
  const id = normalizeGameId(gameId);
  if (!id) return { ok: false, reason: "invalid", entries: [] };

  const now = Date.now();
  const cached = globalLeaderboardCache.get(id);
  if (!force && cached && now - cached.fetchedAt <= GLOBAL_LEADERBOARD_TTL_MS) {
    return { ok: true, entries: sanitizeEntries(cached.entries), source: "cache" };
  }

  const lastAttempt = Number(globalLeaderboardLastAttempt.get(id) || 0);
  if (!force && now - lastAttempt < GLOBAL_ATTEMPT_COOLDOWN_MS) {
    return { ok: false, reason: "cooldown", entries: getLocalLeaderboard(id) };
  }

  if (!force && globalLeaderboardInflight.has(id)) {
    return globalLeaderboardInflight.get(id);
  }

  const task = (async () => {
    globalLeaderboardLastAttempt.set(id, Date.now());
    try {
      const response = await fetch(`/api/leaderboard?gameId=${encodeURIComponent(id)}`, {
        method: "GET",
        cache: "no-store",
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }

      if (!response.ok || !payload?.ok) {
        const reason =
          payload?.error ||
          (response.status === 501 ? "leaderboard_unavailable" : response.status === 400 ? "invalid" : "error");
        globalLeaderboardStatus.set(id, "local");
        return { ok: false, reason, entries: getLocalLeaderboard(id) };
      }

      const entries = sanitizeEntries(payload.entries);
      setCachedGlobalLeaderboard(id, entries);
      setLocalLeaderboard(id, entries);
      emitLeaderboardUpdate(id);
      return { ok: true, entries, source: "global" };
    } catch {
      globalLeaderboardStatus.set(id, "local");
      return { ok: false, reason: "network_error", entries: getLocalLeaderboard(id) };
    } finally {
      globalLeaderboardInflight.delete(id);
    }
  })();

  globalLeaderboardInflight.set(id, task);
  return task;
}

export async function requestLeaderboardRefresh(gameId, { force = false } = {}) {
  const id = normalizeGameId(gameId);
  if (!id) return [];
  const result = await getGlobalLeaderboard(id, { force });
  if (result.ok) return sanitizeEntries(result.entries);
  return getLocalLeaderboard(id);
}

export async function submitGlobalScore(gameId, nickname, score) {
  const id = normalizeGameId(gameId);
  const safeNickname = sanitizeNickname(nickname);
  const safeScore = Math.max(0, Math.floor(Number(score) || 0));
  if (!id || !safeNickname) return { ok: false, reason: "invalid", entries: getLocalLeaderboard(id) };

  try {
    const response = await fetch("/api/leaderboard/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        gameId: id,
        nickname: safeNickname,
        score: safeScore,
      }),
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok || !payload?.ok) {
      const reason =
        payload?.error ||
        (response.status === 501 ? "leaderboard_unavailable" : response.status === 400 ? "invalid" : "error");
      globalLeaderboardStatus.set(id, "local");
      return { ok: false, reason, entries: getLocalLeaderboard(id) };
    }

    const entries = sanitizeEntries(payload.entries);
    setCachedGlobalLeaderboard(id, entries);
    setLocalLeaderboard(id, entries);
    emitLeaderboardUpdate(id);
    return { ok: true, entries };
  } catch {
    globalLeaderboardStatus.set(id, "local");
    return { ok: false, reason: "network_error", entries: getLocalLeaderboard(id) };
  }
}

export function submitScore(gameId, nickname, score) {
  const id = normalizeGameId(gameId);
  if (!id) return [];

  const safeNickname = sanitizeNickname(nickname);
  if (!safeNickname) return getLocalLeaderboard(id);
  const safeScore = Math.max(0, Math.floor(Number(score) || 0));
  const localEntries = submitLocalScore(id, safeNickname, safeScore);

  void submitGlobalScore(id, safeNickname, safeScore);
  return localEntries;
}

export function onLeaderboardUpdated(listener) {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function" || typeof listener !== "function") {
    return () => {};
  }
  const handler = (event) => listener(event?.detail?.gameId || "");
  window.addEventListener(LEADERBOARD_UPDATE_EVENT, handler);
  return () => {
    window.removeEventListener(LEADERBOARD_UPDATE_EVENT, handler);
  };
}
