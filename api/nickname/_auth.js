import crypto from "node:crypto";

const NICKNAME_KEY_PREFIX = "nickname:";
const NICKNAME_REGEX = /^[A-Z0-9_]{2,10}$/;
const PIN_REGEX = /^\d{4}$/;
const HASH_HEX_REGEX = /^[a-f0-9]{64}$/;
const SALT_HEX_REGEX = /^[a-f0-9]{16,128}$/;
const SALT_BASE64_REGEX = /^[A-Za-z0-9+/=]{22,24}$/;
const RATE_LIMIT_MAX_ATTEMPTS = 10;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

const globalRateLimitBuckets = globalThis.__nicknamePinRateLimitBuckets;
const rateLimitBuckets = globalRateLimitBuckets instanceof Map ? globalRateLimitBuckets : new Map();
if (!(globalRateLimitBuckets instanceof Map)) {
  globalThis.__nicknamePinRateLimitBuckets = rateLimitBuckets;
}

let lastRateLimitCleanupAt = 0;
let redisClientPromise = null;

export function canonicalizeNickname(raw) {
  return String(raw || "")
    .replace(/\s+/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "")
    .slice(0, 10);
}

export function normalizePin(raw) {
  return String(raw || "").trim();
}

function nicknameKey(canonicalNickname) {
  return `${NICKNAME_KEY_PREFIX}${canonicalNickname.toLowerCase()}`;
}

function isValidNickname(nickname) {
  return NICKNAME_REGEX.test(nickname);
}

function isValidPin(pin) {
  return PIN_REGEX.test(pin);
}

function nowIso() {
  return new Date().toISOString();
}

function hasRedisEnv() {
  return !!process.env.REDIS_URL;
}

function hasKvEnv() {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

async function getRedisClient() {
  if (!hasRedisEnv()) return null;
  if (!redisClientPromise) {
    redisClientPromise = (async () => {
      const mod = await import("redis");
      const createClient = mod.createClient || mod.default?.createClient;
      if (typeof createClient !== "function") throw new Error("redis createClient not found");

      const client = createClient({ url: process.env.REDIS_URL });
      client.on("error", (err) => {
        console.warn("[nickname] Redis client error", err?.message || err);
      });
      await client.connect();
      await client.ping();
      return client;
    })();
  }
  return redisClientPromise;
}

async function kvCommand(command, args = []) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([command, ...args]),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`KV ${command} failed (${res.status}): ${text}`);
  }

  const json = await res.json();
  return json?.result;
}

async function readWithRedis(key) {
  const client = await getRedisClient();
  if (!client) return null;
  return await client.get(key);
}

async function readWithKv(key) {
  if (!hasKvEnv()) return null;
  await kvCommand("PING", []);
  const value = await kvCommand("GET", [key]);
  return typeof value === "string" ? value : null;
}

async function setWithRedis(key, valueJson, mode = "") {
  const client = await getRedisClient();
  if (!client) return null;
  const options = {};
  if (mode === "NX") options.NX = true;
  if (mode === "XX") options.XX = true;
  const result = await client.set(key, valueJson, options);
  return result === "OK";
}

async function setWithKv(key, valueJson, mode = "") {
  if (!hasKvEnv()) return null;
  await kvCommand("PING", []);
  const args = [key, valueJson];
  if (mode) args.push(mode);
  const result = await kvCommand("SET", args);
  return result === "OK";
}

async function claimNicknameAtomic(key, valueJson) {
  try {
    const redisResult = await setWithRedis(key, valueJson, "NX");
    if (redisResult !== null) return redisResult;
  } catch (err) {
    console.warn("[nickname] Redis claim unavailable", err?.message || err);
  }

  try {
    const kvResult = await setWithKv(key, valueJson, "NX");
    if (kvResult !== null) return kvResult;
  } catch (err) {
    console.warn("[nickname] KV claim unavailable", err?.message || err);
  }

  return null;
}

async function readNicknameRecordRaw(key) {
  const redisEnabled = hasRedisEnv();
  const kvEnabled = hasKvEnv();
  let hadSuccessfulRead = false;

  if (redisEnabled) {
    try {
      const value = await readWithRedis(key);
      hadSuccessfulRead = true;
      if (typeof value === "string") return { status: "ok", value };
    } catch (err) {
      console.warn("[nickname] Redis read unavailable", err?.message || err);
    }
  }

  if (kvEnabled) {
    try {
      const value = await readWithKv(key);
      hadSuccessfulRead = true;
      if (typeof value === "string") return { status: "ok", value };
    } catch (err) {
      console.warn("[nickname] KV read unavailable", err?.message || err);
    }
  }

  if (hadSuccessfulRead) return { status: "ok", value: null };
  if (!redisEnabled && !kvEnabled) return { status: "unavailable", value: null };
  return { status: "error", value: null };
}

async function updateNicknameRecordExisting(key, valueJson) {
  let hadBackend = false;

  try {
    const redisResult = await setWithRedis(key, valueJson, "XX");
    if (redisResult !== null) {
      hadBackend = true;
      if (redisResult) return true;
    }
  } catch (err) {
    console.warn("[nickname] Redis update unavailable", err?.message || err);
    hadBackend = true;
  }

  try {
    const kvResult = await setWithKv(key, valueJson, "XX");
    if (kvResult !== null) {
      hadBackend = true;
      if (kvResult) return true;
    }
  } catch (err) {
    console.warn("[nickname] KV update unavailable", err?.message || err);
    hadBackend = true;
  }

  if (!hadBackend) return null;
  return false;
}

function hashPin(salt, pin) {
  return crypto.createHash("sha256").update(`${salt}:${pin}`).digest("hex");
}

function hashEquals(hashA, hashB) {
  if (!HASH_HEX_REGEX.test(String(hashA || "")) || !HASH_HEX_REGEX.test(String(hashB || ""))) return false;
  const a = Buffer.from(hashA, "hex");
  const b = Buffer.from(hashB, "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}

function makeSalt() {
  return crypto.randomBytes(16).toString("base64");
}

function isValidSalt(salt) {
  return SALT_HEX_REGEX.test(salt) || SALT_BASE64_REGEX.test(salt);
}

function parseNicknameRecord(rawValue, expectedNickname = "") {
  if (!rawValue) return null;
  try {
    const parsed = JSON.parse(rawValue);
    const nickname = canonicalizeNickname(parsed?.nickname);
    const salt = String(parsed?.salt || "");
    const pinHash = String(parsed?.pinHash || "").toLowerCase();
    const createdAt = String(parsed?.createdAt || "") || nowIso();
    const lastLoginAt = String(parsed?.lastLoginAt || "");
    const hasPinAuth = !!(salt || pinHash);
    if (!isValidNickname(nickname)) return null;
    if (expectedNickname && nickname !== expectedNickname) return null;
    if (hasPinAuth) {
      if (!isValidSalt(salt)) return null;
      if (!HASH_HEX_REGEX.test(pinHash)) return null;
    }
    return {
      nickname,
      salt,
      pinHash,
      createdAt,
      lastLoginAt: lastLoginAt || createdAt,
      hasPinAuth,
    };
  } catch {
    return null;
  }
}

function getClientIp(req) {
  const forwarded = req?.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  const realIp = req?.headers?.["x-real-ip"];
  if (typeof realIp === "string" && realIp.trim()) return realIp.trim();
  return req?.socket?.remoteAddress || "unknown";
}

function cleanupRateLimitBuckets(now) {
  if (now - lastRateLimitCleanupAt < 60_000) return;
  lastRateLimitCleanupAt = now;
  for (const [key, value] of rateLimitBuckets.entries()) {
    if (!value || now - Number(value.windowStart || 0) > RATE_LIMIT_WINDOW_MS) {
      rateLimitBuckets.delete(key);
    }
  }
}

function consumeLoginAttempt(nickname, ip) {
  const now = Date.now();
  cleanupRateLimitBuckets(now);

  const key = `${nickname}|${ip || "unknown"}`;
  const current = rateLimitBuckets.get(key);
  const isExpired = !current || now - Number(current.windowStart || 0) > RATE_LIMIT_WINDOW_MS;
  const next = isExpired
    ? { windowStart: now, attempts: 1 }
    : { windowStart: current.windowStart, attempts: Number(current.attempts || 0) + 1 };

  rateLimitBuckets.set(key, next);
  return next.attempts <= RATE_LIMIT_MAX_ATTEMPTS;
}

function clearLoginAttempts(nickname, ip) {
  rateLimitBuckets.delete(`${nickname}|${ip || "unknown"}`);
}

export async function claimNicknameWithPin(nicknameRaw, pinRaw) {
  const nickname = canonicalizeNickname(nicknameRaw);
  const pin = normalizePin(pinRaw);
  if (!isValidNickname(nickname) || !isValidPin(pin)) {
    return { ok: false, error: "invalid" };
  }

  const now = nowIso();
  const salt = makeSalt();
  const pinHash = hashPin(salt, pin);
  const recordJson = JSON.stringify({
    nickname,
    salt,
    pinHash,
    createdAt: now,
    lastLoginAt: now,
  });

  const result = await claimNicknameAtomic(nicknameKey(nickname), recordJson);
  if (result === null) return { ok: false, error: "registry_unavailable" };
  if (!result) return { ok: false, error: "taken" };
  return { ok: true, nickname };
}

export async function loginNicknameWithPin(nicknameRaw, pinRaw, req) {
  const result = await verifyNicknameWithPin(nicknameRaw, pinRaw, req);
  if (result.ok) return result;
  if (result.error === "wrong_pin" || result.error === "not_found") {
    return { ok: false, error: "invalid_pin" };
  }
  return result;
}

export async function verifyNicknameWithPin(nicknameRaw, pinRaw, req) {
  const nickname = canonicalizeNickname(nicknameRaw);
  const pin = normalizePin(pinRaw);
  if (!isValidNickname(nickname) || !isValidPin(pin)) {
    return { ok: false, error: "invalid" };
  }

  const ip = getClientIp(req);
  const allowed = consumeLoginAttempt(nickname, ip);
  if (!allowed) {
    return { ok: false, error: "rate_limited" };
  }

  const key = nicknameKey(nickname);
  const readResult = await readNicknameRecordRaw(key);
  if (readResult.status === "unavailable" || readResult.status === "error") {
    return { ok: false, error: "registry_unavailable" };
  }
  if (!readResult.value) {
    return { ok: false, error: "not_found" };
  }

  const record = parseNicknameRecord(readResult.value, nickname);
  if (!record) {
    return { ok: false, error: "wrong_pin" };
  }

  if (!record.hasPinAuth) {
    const upgradedSalt = makeSalt();
    const upgradedHash = hashPin(upgradedSalt, pin);
    const upgradedRecord = {
      ...record,
      salt: upgradedSalt,
      pinHash: upgradedHash,
      createdAt: record.createdAt || nowIso(),
      lastLoginAt: nowIso(),
    };
    const updateResult = await updateNicknameRecordExisting(key, JSON.stringify(upgradedRecord));
    if (updateResult === null) {
      return { ok: false, error: "registry_unavailable" };
    }
    if (!updateResult) {
      return { ok: false, error: "not_found" };
    }
    clearLoginAttempts(nickname, ip);
    return { ok: true, nickname };
  }

  const candidateHash = hashPin(record.salt, pin);
  if (!hashEquals(candidateHash, record.pinHash)) {
    return { ok: false, error: "wrong_pin" };
  }

  const updatedRecord = {
    ...record,
    lastLoginAt: nowIso(),
  };

  void updateNicknameRecordExisting(key, JSON.stringify(updatedRecord));
  clearLoginAttempts(nickname, ip);
  return { ok: true, nickname };
}
