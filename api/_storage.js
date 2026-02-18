// Required env vars for production Stripe flow:
// - STRIPE_SECRET_KEY (used by webhook line item fallback lookup)
// - STRIPE_WEBHOOK_SECRET (signature verification, in /api/webhook/stripe)
// Preferred persistence:
// - KV_REST_API_URL
// - KV_REST_API_TOKEN
const PURCHASES_KEY = "pokemon_room_purchases_v1";
const IDENTITY_PREFIX = "pokemon_room_identity_v1:";
const DEV_STORE_KEY = "__pokemon_room_dev_store__";

let backendPromise = null;

let redisClientPromise = null;

async function getRedisClient() {
  const url = process.env.REDIS_URL;
  if (!url) return null;

  if (!redisClientPromise) {
    redisClientPromise = (async () => {
      const mod = await import("redis");
      const createClient = mod.createClient || mod.default?.createClient;
      if (typeof createClient !== "function") throw new Error("redis createClient not found");

      const client = createClient({ url });
      client.on("error", (err) => {
        console.warn("[storage] Redis client error", err?.message || err);
      });
      await client.connect();
      return client;
    })();
  }

  return redisClientPromise;
}

async function getRedisBackend() {
  const client = await getRedisClient();
  if (!client) return null;

  // sanity
  await client.ping();

  const scanKeysByPrefix = async (prefix) => {
    const keys = [];
    let cursor = "0";
    const pattern = `${prefix}*`;

    do {
      const result = await client.scan(cursor, { MATCH: pattern, COUNT: 200 });
      const nextCursor = result?.cursor ?? result?.[0] ?? "0";
      const batch = result?.keys ?? result?.[1] ?? [];
      if (Array.isArray(batch)) keys.push(...batch);
      cursor = String(nextCursor);
    } while (cursor !== "0");

    return keys;
  };

  return {
    kind: "redis",
    async getPurchases() {
      const raw = await client.get(PURCHASES_KEY);
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    },
    async appendPurchase(purchase) {
      const purchases = await this.getPurchases();
      if (!purchases.find((entry) => entry.purchaseId === purchase.purchaseId)) {
        purchases.push(purchase);
        await client.set(PURCHASES_KEY, JSON.stringify(purchases));
      }
      return purchases;
    },
    async getIdentity(userId) {
      if (!userId) return null;
      const raw = await client.get(`${IDENTITY_PREFIX}${userId}`);
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    },
    async setIdentity(userId, identity) {
      await client.set(`${IDENTITY_PREFIX}${userId}`, JSON.stringify(identity));
      return identity;
    },
    async listIdentities() {
      const keys = await scanKeysByPrefix(IDENTITY_PREFIX);
      if (!keys.length) return [];
      const values = await client.mGet(keys);
      return keys
        .map((key, idx) => {
          const raw = values?.[idx];
          if (!raw) return null;
          try {
            const parsed = JSON.parse(raw);
            const userId = parsed?.userId || key.slice(IDENTITY_PREFIX.length);
            return {
              userId: String(userId || ""),
              name: String(parsed?.name || ""),
              email: String(parsed?.email || ""),
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    },
  };
}

function getDevStore() {
  if (!globalThis[DEV_STORE_KEY]) {
    globalThis[DEV_STORE_KEY] = {
      purchases: [],
      identities: {},
      warned: false,
    };
  }
  const store = globalThis[DEV_STORE_KEY];
  if (!store.warned) {
    console.warn("[storage] Using in-memory dev store (not persistent)");
    store.warned = true;
  }
  return store;
}

async function kvCommand(command, args = []) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error("KV env vars missing");

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

async function getKvBackend() {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return null;

  await kvCommand("PING", []);

  const scanKeysByPrefix = async (prefix) => {
    const keys = [];
    const pattern = `${prefix}*`;
    let cursor = "0";

    do {
      const result = await kvCommand("SCAN", [cursor, "MATCH", pattern, "COUNT", "200"]);
      const nextCursor = result?.cursor ?? result?.[0] ?? "0";
      const batch = result?.keys ?? result?.[1] ?? [];
      if (Array.isArray(batch)) keys.push(...batch);
      cursor = String(nextCursor);
    } while (cursor !== "0");

    return keys;
  };

  return {
    kind: "kv",
    async getPurchases() {
      const raw = await kvCommand("GET", [PURCHASES_KEY]);
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    },
    async appendPurchase(purchase) {
      const purchases = await this.getPurchases();
      if (!purchases.find((entry) => entry.purchaseId === purchase.purchaseId)) {
        purchases.push(purchase);
        await kvCommand("SET", [PURCHASES_KEY, JSON.stringify(purchases)]);
      }
      return purchases;
    },
    async getIdentity(userId) {
      if (!userId) return null;
      const raw = await kvCommand("GET", [`${IDENTITY_PREFIX}${userId}`]);
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    },
    async setIdentity(userId, identity) {
      await kvCommand("SET", [`${IDENTITY_PREFIX}${userId}`, JSON.stringify(identity)]);
      return identity;
    },
    async listIdentities() {
      const keys = await scanKeysByPrefix(IDENTITY_PREFIX);
      if (!keys.length) return [];
      const values = await kvCommand("MGET", keys);
      return keys
        .map((key, idx) => {
          const raw = values?.[idx];
          if (!raw) return null;
          try {
            const parsed = JSON.parse(raw);
            const userId = parsed?.userId || key.slice(IDENTITY_PREFIX.length);
            return {
              userId: String(userId || ""),
              name: String(parsed?.name || ""),
              email: String(parsed?.email || ""),
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    },
  };
}

let pgInitPromise = null;

async function getPostgresBackend() {
  if (!process.env.POSTGRES_URL && !process.env.POSTGRES_PRISMA_URL) return null;

  let postgres;
  try {
    postgres = await import("@vercel/postgres");
  } catch {
    return null;
  }

  const { sql } = postgres;
  if (!pgInitPromise) {
    pgInitPromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS room_purchases (
          purchase_id TEXT PRIMARY KEY,
          beat_id TEXT NOT NULL,
          beat_name TEXT NOT NULL,
          buyer_name TEXT NOT NULL,
          buyer_email TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS room_identities (
          user_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `;
    })();
  }
  await pgInitPromise;

  return {
    kind: "postgres",
    async getPurchases() {
      const rows = await sql`
        SELECT purchase_id, beat_id, beat_name, buyer_name, buyer_email, created_at
        FROM room_purchases
        ORDER BY created_at ASC, purchase_id ASC
      `;
      return rows.rows.map((row) => ({
        purchaseId: row.purchase_id,
        beatId: row.beat_id,
        beatName: row.beat_name,
        buyerName: row.buyer_name,
        buyerEmail: row.buyer_email,
        createdAt: row.created_at,
      }));
    },
    async appendPurchase(purchase) {
      await sql`
        INSERT INTO room_purchases (
          purchase_id, beat_id, beat_name, buyer_name, buyer_email, created_at
        ) VALUES (
          ${purchase.purchaseId},
          ${purchase.beatId},
          ${purchase.beatName},
          ${purchase.buyerName},
          ${purchase.buyerEmail},
          ${purchase.createdAt}
        )
        ON CONFLICT (purchase_id) DO NOTHING
      `;
      return this.getPurchases();
    },
    async getIdentity(userId) {
      if (!userId) return null;
      const rows = await sql`
        SELECT user_id, name, email
        FROM room_identities
        WHERE user_id = ${userId}
        LIMIT 1
      `;
      const row = rows.rows[0];
      if (!row) return null;
      return {
        userId: row.user_id,
        name: row.name,
        email: row.email,
      };
    },
    async setIdentity(userId, identity) {
      const now = new Date().toISOString();
      await sql`
        INSERT INTO room_identities (user_id, name, email, updated_at)
        VALUES (${userId}, ${identity.name}, ${identity.email}, ${now})
        ON CONFLICT (user_id)
        DO UPDATE SET
          name = EXCLUDED.name,
          email = EXCLUDED.email,
          updated_at = EXCLUDED.updated_at
      `;
      return identity;
    },
    async listIdentities() {
      const rows = await sql`
        SELECT user_id, name, email
        FROM room_identities
        ORDER BY updated_at ASC, user_id ASC
      `;
      return rows.rows.map((row) => ({
        userId: row.user_id,
        name: row.name,
        email: row.email,
      }));
    },
  };
}

function getMemoryBackend() {
  const store = getDevStore();
  return {
    kind: "memory",
    async getPurchases() {
      return [...store.purchases];
    },
    async appendPurchase(purchase) {
      if (!store.purchases.find((entry) => entry.purchaseId === purchase.purchaseId)) {
        store.purchases.push(purchase);
      }
      return [...store.purchases];
    },
    async getIdentity(userId) {
      return store.identities[userId] || null;
    },
    async setIdentity(userId, identity) {
      store.identities[userId] = identity;
      return identity;
    },
    async listIdentities() {
      return Object.values(store.identities || {}).map((identity) => ({
        userId: String(identity?.userId || ""),
        name: String(identity?.name || ""),
        email: String(identity?.email || ""),
      }));
    },
  };
}

async function resolveBackend() {
  try {
    const redis = await getRedisBackend();
    if (redis) return redis;
  } catch (err) {
    console.warn("[storage] Redis unavailable, falling back", err?.message || err);
  }

  try {
    const kv = await getKvBackend();
    if (kv) return kv;
  } catch (err) {
    console.warn("[storage] KV unavailable, falling back", err?.message || err);
  }

  try {
    const pg = await getPostgresBackend();
    if (pg) return pg;
  } catch (err) {
    console.warn("[storage] Postgres unavailable, falling back", err?.message || err);
  }

  return getMemoryBackend();
}

async function getBackend() {
  if (!backendPromise) {
    backendPromise = resolveBackend();
  }
  return backendPromise;
}

export function sanitizePurchase(input) {
  return {
    purchaseId: String(input?.purchaseId || `purchase_${Date.now()}`),
    beatId: String(input?.beatId || "unknown-beat"),
    beatName: String(input?.beatName || "Unknown Beat"),
    buyerName: String(input?.buyerName || ""),
    buyerEmail: String(input?.buyerEmail || ""),
    createdAt: String(input?.createdAt || new Date().toISOString()),
  };
}

export async function listPurchases() {
  const backend = await getBackend();
  return backend.getPurchases();
}

export async function appendPurchase(purchase) {
  const backend = await getBackend();
  return backend.appendPurchase(sanitizePurchase(purchase));
}

export async function getIdentity(userId) {
  const backend = await getBackend();
  return backend.getIdentity(userId);
}

export async function setIdentity(userId, identity) {
  const backend = await getBackend();
  return backend.setIdentity(userId, {
    userId,
    name: String(identity?.name || ""),
    email: String(identity?.email || ""),
  });
}

export async function listIdentities() {
  const backend = await getBackend();
  if (typeof backend.listIdentities === "function") {
    return backend.listIdentities();
  }
  return [];
}

export async function storageInfo() {
  const backend = await getBackend();
  return { kind: backend.kind };
}
