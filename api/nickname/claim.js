import { readJsonBody, sendJson } from "../_http.js";

const NICKNAME_KEY_PREFIX = "nickname:";
const NICKNAME_REGEX = /^[A-Z0-9_]{2,10}$/;

let redisClientPromise = null;

function canonicalizeNickname(raw) {
  return String(raw || "")
    .replace(/\s+/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "")
    .slice(0, 10);
}

function nicknameKey(canonicalNickname) {
  return `${NICKNAME_KEY_PREFIX}${canonicalNickname.toLowerCase()}`;
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
        console.warn("[nickname] Redis client error", err?.message || err);
      });
      await client.connect();
      await client.ping();
      return client;
    })();
  }

  return redisClientPromise;
}

async function claimWithRedis(key, valueJson) {
  const client = await getRedisClient();
  if (!client) return null;
  const result = await client.set(key, valueJson, { NX: true });
  return result === "OK";
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

async function claimWithKv(key, valueJson) {
  if (!hasKvEnv()) return null;
  await kvCommand("PING", []);
  const result = await kvCommand("SET", [key, valueJson, "NX"]);
  return result === "OK";
}

async function claimNicknameAtomic(key, valueJson) {
  try {
    const redisResult = await claimWithRedis(key, valueJson);
    if (redisResult !== null) return redisResult;
  } catch (err) {
    console.warn("[nickname] Redis unavailable", err?.message || err);
  }

  try {
    const kvResult = await claimWithKv(key, valueJson);
    if (kvResult !== null) return kvResult;
  } catch (err) {
    console.warn("[nickname] KV unavailable", err?.message || err);
  }

  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { ok: false, error: "method_not_allowed" });
  }

  try {
    const body = await readJsonBody(req);
    const nickname = canonicalizeNickname(body?.nickname);

    if (!NICKNAME_REGEX.test(nickname)) {
      return sendJson(res, 400, { ok: false, error: "invalid" });
    }

    const valueJson = JSON.stringify({
      nickname,
      claimedAt: new Date().toISOString(),
    });

    const claimResult = await claimNicknameAtomic(nicknameKey(nickname), valueJson);
    if (claimResult === null) {
      return sendJson(res, 501, {
        ok: false,
        error: "registry_unavailable",
        message: "Nickname registry backend is not configured.",
      });
    }
    if (!claimResult) {
      return sendJson(res, 409, { ok: false, error: "taken" });
    }

    return sendJson(res, 200, { ok: true, nickname });
  } catch (err) {
    console.error("[nickname] claim failed", err);
    return sendJson(res, 500, { ok: false, error: "unexpected" });
  }
}
