const STORAGE_KEY = "arcade_profile_v1";
const MAX_NICKNAME_LEN = 10;
const NICKNAME_REGEX = /^[A-Z0-9_]{2,10}$/;

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

export function getNickname() {
  if (!canUseStorage()) return "";
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return "";
    const parsed = JSON.parse(raw);
    const nickname = canonicalizeNickname(parsed?.nickname);
    return validateNickname(nickname) ? nickname : "";
  } catch {
    return "";
  }
}

export function setNickname(name) {
  if (!canUseStorage()) return null;
  const nickname = canonicalizeNickname(name);
  if (!validateNickname(nickname)) return null;

  try {
    const prevRaw = window.localStorage.getItem(STORAGE_KEY);
    const prev = prevRaw ? JSON.parse(prevRaw) : null;
    const payload = {
      nickname,
      createdAt: Number.isFinite(prev?.createdAt) ? prev.createdAt : Date.now(),
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
