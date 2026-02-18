import { canonicalizeNickname, validateNickname } from "./profile";

const PROFILE_KEY = "arcade_profile_v1";
const LEADERBOARDS_KEY = "arcade_leaderboards_v1";
const MIN_NICKNAME_LEN = 2;
const MAX_NICKNAME_LEN = 10;
const MAX_ENTRIES = 5;

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
  const all = readLeaderboards();
  return sanitizeEntries(all[id] || []);
}

export function getAllLeaderboards() {
  return readLeaderboards();
}

export function submitScore(gameId, nickname, score) {
  const id = normalizeGameId(gameId);
  if (!id) return [];

  const safeNickname = sanitizeNickname(nickname) || "PLAYER";
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
