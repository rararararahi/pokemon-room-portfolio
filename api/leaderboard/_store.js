const LEADERBOARD_KEY_PREFIX = "hiscore:v1:";
const MAX_ENTRIES = 5;
const NICKNAME_REGEX = /^[A-Z0-9_]{2,10}$/;
const GAME_ID_REGEX = /^[a-z0-9][a-z0-9_-]{0,31}$/;

let redisClientPromise = null;

export function canonicalizeNickname(raw) {
  return String(raw || "")
    .replace(/\s+/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "")
    .slice(0, 10);
}

export function normalizeGameId(raw) {
  return String(raw || "").trim().toLowerCase();
}

export function sanitizeScore(raw) {
  if (!Number.isFinite(Number(raw))) return null;
  return Math.max(0, Math.floor(Number(raw)));
}

export function isValidCanonicalNickname(nickname) {
  return NICKNAME_REGEX.test(String(nickname || ""));
}

export function isValidGameId(gameId) {
  return GAME_ID_REGEX.test(String(gameId || ""));
}

function sanitizeEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const nickname = canonicalizeNickname(entry.nickname);
  if (!isValidCanonicalNickname(nickname)) return null;
  const score = sanitizeScore(entry.score);
  if (score === null) return null;
  const tsRaw = Number(entry.ts);
  const ts = Number.isFinite(tsRaw) ? Math.floor(tsRaw) : Date.now();
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

function normalizeEntries(entries) {
  if (!Array.isArray(entries)) return [];
  const next = [];
  for (let i = 0; i < entries.length; i += 1) {
    const safe = sanitizeEntry(entries[i]);
    if (safe) next.push(safe);
  }
  return sortEntries(next);
}

function leaderboardKey(gameId) {
  return `${LEADERBOARD_KEY_PREFIX}${gameId}`;
}

function hasKvEnv() {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

async function getRedisClient() {
  if (!process.env.REDIS_URL) return null;
  if (!redisClientPromise) {
    redisClientPromise = (async () => {
      const mod = await import("redis");
      const createClient = mod.createClient || mod.default?.createClient;
      if (typeof createClient !== "function") throw new Error("redis createClient not found");
      const client = createClient({ url: process.env.REDIS_URL });
      client.on("error", (err) => {
        console.warn("[leaderboard] Redis client error", err?.message || err);
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
  const raw = await client.get(key);
  if (!raw) return [];
  try {
    return normalizeEntries(JSON.parse(raw));
  } catch {
    return [];
  }
}

async function readWithKv(key) {
  if (!hasKvEnv()) return null;
  await kvCommand("PING", []);
  const raw = await kvCommand("GET", [key]);
  if (!raw) return [];
  try {
    return normalizeEntries(JSON.parse(raw));
  } catch {
    return [];
  }
}

async function submitWithRedis(key, entry) {
  const client = await getRedisClient();
  if (!client) return null;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await client.watch(key);
      const raw = await client.get(key);
      const current = raw ? normalizeEntries(JSON.parse(raw)) : [];
      current.push(entry);
      const next = sortEntries(current);
      const tx = client.multi();
      tx.set(key, JSON.stringify(next));
      const result = await tx.exec();
      if (result !== null) return next;
    } catch (err) {
      console.warn("[leaderboard] Redis submit retry", err?.message || err);
    } finally {
      try {
        await client.unwatch();
      } catch {}
    }
  }

  try {
    const raw = await client.get(key);
    const current = raw ? normalizeEntries(JSON.parse(raw)) : [];
    current.push(entry);
    const next = sortEntries(current);
    await client.set(key, JSON.stringify(next));
    return next;
  } catch (err) {
    console.warn("[leaderboard] Redis submit fallback failed", err?.message || err);
    return null;
  }
}

async function submitWithKv(key, entry) {
  if (!hasKvEnv()) return null;
  await kvCommand("PING", []);
  const raw = await kvCommand("GET", [key]);
  let current = [];
  if (raw) {
    try {
      current = normalizeEntries(JSON.parse(raw));
    } catch {
      current = [];
    }
  }
  current.push(entry);
  const next = sortEntries(current);
  await kvCommand("SET", [key, JSON.stringify(next)]);
  return next;
}

export async function readLeaderboard(gameIdRaw) {
  const gameId = normalizeGameId(gameIdRaw);
  if (!isValidGameId(gameId)) return { ok: false, error: "invalid" };

  const key = leaderboardKey(gameId);

  try {
    const redisEntries = await readWithRedis(key);
    if (redisEntries !== null) return { ok: true, gameId, entries: redisEntries };
  } catch (err) {
    console.warn("[leaderboard] Redis read unavailable", err?.message || err);
  }

  try {
    const kvEntries = await readWithKv(key);
    if (kvEntries !== null) return { ok: true, gameId, entries: kvEntries };
  } catch (err) {
    console.warn("[leaderboard] KV read unavailable", err?.message || err);
  }

  return { ok: false, error: "leaderboard_unavailable" };
}

export async function submitLeaderboard({ gameId: gameIdRaw, nickname: nicknameRaw, score: scoreRaw }) {
  const gameId = normalizeGameId(gameIdRaw);
  const nickname = canonicalizeNickname(nicknameRaw);
  const score = sanitizeScore(scoreRaw);

  if (!isValidGameId(gameId) || !isValidCanonicalNickname(nickname) || score === null) {
    return { ok: false, error: "invalid" };
  }

  const key = leaderboardKey(gameId);
  const nextEntry = { nickname, score, ts: Date.now() };

  try {
    const redisEntries = await submitWithRedis(key, nextEntry);
    if (redisEntries !== null) return { ok: true, gameId, entries: redisEntries };
  } catch (err) {
    console.warn("[leaderboard] Redis submit unavailable", err?.message || err);
  }

  try {
    const kvEntries = await submitWithKv(key, nextEntry);
    if (kvEntries !== null) return { ok: true, gameId, entries: kvEntries };
  } catch (err) {
    console.warn("[leaderboard] KV submit unavailable", err?.message || err);
  }

  return { ok: false, error: "leaderboard_unavailable" };
}
