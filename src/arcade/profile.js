const STORAGE_KEY = "arcade_profile_v1";
const MAX_NICKNAME_LEN = 10;
const NICKNAME_REGEX = /^[A-Z0-9_]{2,10}$/;
const MAX_USER_ID_LEN = 80;

function canUseStorage() {
  return typeof window !== "undefined" && !!window.localStorage;
}

export function canonicalizeNickname(name) {
  return String(name || "")
    .replace(/\s+/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "")
    .slice(0, MAX_NICKNAME_LEN);
}

export function validateNickname(name) {
  return NICKNAME_REGEX.test(canonicalizeNickname(name));
}

function createLocalUserId() {
  const uuid = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  return `usr_${uuid}`;
}

function sanitizeUserId(raw) {
  return String(raw || "").trim().slice(0, MAX_USER_ID_LEN);
}

export function getProfile() {
  if (!canUseStorage()) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const nickname = canonicalizeNickname(parsed?.nickname);
    if (!validateNickname(nickname)) return null;
    const createdAt = Number.isFinite(parsed?.createdAt) ? parsed.createdAt : Date.now();
    const userId = sanitizeUserId(parsed?.userId);
    return {
      nickname,
      createdAt,
      userId,
    };
  } catch {
    return null;
  }
}

export function getNickname() {
  return getProfile()?.nickname || "";
}

export function getUserId() {
  return getProfile()?.userId || "";
}

export function setNickname(name, { userId = "" } = {}) {
  if (!canUseStorage()) return null;
  const nickname = canonicalizeNickname(name);
  if (!validateNickname(nickname)) return null;

  try {
    const prev = getProfile();
    const nextUserId = sanitizeUserId(userId || prev?.userId || createLocalUserId());
    if (!nextUserId) return null;
    const payload = {
      nickname,
      createdAt: Number.isFinite(prev?.createdAt) ? prev.createdAt : Date.now(),
      userId: nextUserId,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return payload;
  } catch {
    return null;
  }
}

export function clearNickname() {
  if (!canUseStorage()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {}
}
