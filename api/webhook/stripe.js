import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { appendPurchase } from "../_storage.js";
import { sendJson } from "../_http.js";

// Env vars used here:
// - STRIPE_WEBHOOK_SECRET (required for signature verification)
// - STRIPE_SECRET_KEY (optional; used to query session line items if metadata/mapping are missing)
export const config = {
  api: {
    bodyParser: false,
  },
};

let cachedPaymentLinkMap = null;

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown-beat";
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function parseSignatureHeader(header) {
  if (!header) return { timestamp: "", signatures: [] };
  const parts = String(header)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  let timestamp = "";
  const signatures = [];
  for (const part of parts) {
    const [key, value] = part.split("=");
    if (key === "t") timestamp = value;
    if (key === "v1") signatures.push(value);
  }
  return { timestamp, signatures };
}

function verifySignature(rawBody, stripeSignature, secret) {
  const { timestamp, signatures } = parseSignatureHeader(stripeSignature);
  if (!timestamp || !signatures.length || !secret) return false;
  const payload = `${timestamp}.${rawBody.toString("utf8")}`;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");

  for (const sig of signatures) {
    const sigBuf = Buffer.from(sig, "hex");
    const expBuf = Buffer.from(expected, "hex");
    if (sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf)) {
      return true;
    }
  }
  return false;
}

async function loadPaymentLinkMap() {
  if (cachedPaymentLinkMap) return cachedPaymentLinkMap;

  const filePath = path.join(process.cwd(), "public", "data", "payment_links.json");
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    cachedPaymentLinkMap = parsed?.links && typeof parsed.links === "object" ? parsed.links : {};
  } catch {
    cachedPaymentLinkMap = {};
  }
  return cachedPaymentLinkMap;
}

function getMappedBeat(mapping, key) {
  if (!key) return null;
  if (mapping[key]) return mapping[key];

  const decoded = decodeURIComponent(String(key));
  if (mapping[decoded]) return mapping[decoded];

  const bySuffix = Object.keys(mapping).find((candidate) => decoded.endsWith(candidate) || candidate.endsWith(decoded));
  if (bySuffix) return mapping[bySuffix];

  return null;
}

async function fetchLineItemBeat(sessionId) {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret || !sessionId) return null;

  const url = `https://api.stripe.com/v1/checkout/sessions/${sessionId}/line_items?limit=1`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${secret}`,
    },
  });

  if (!res.ok) return null;
  const json = await res.json();
  const first = json?.data?.[0];
  if (!first) return null;

  const beatName = first.description || first.price?.nickname || "Unknown Beat";
  return {
    beatId: slugify(beatName),
    beatName,
  };
}

async function inferBeatFromCheckoutSession(session) {
  const metadata = session?.metadata || {};
  if (metadata.beatId || metadata.beatName) {
    return {
      beatId: metadata.beatId ? slugify(metadata.beatId) : slugify(metadata.beatName),
      beatName: metadata.beatName || metadata.beatId || "Unknown Beat",
    };
  }

  const map = await loadPaymentLinkMap();
  const candidates = [
    metadata.buyUrl,
    metadata.paymentLink,
    session?.payment_link,
    session?.url,
    session?.success_url,
    session?.cancel_url,
  ].filter(Boolean);

  for (const key of candidates) {
    const mapped = getMappedBeat(map, key);
    if (mapped?.beatId || mapped?.beatName) {
      return {
        beatId: slugify(mapped.beatId || mapped.beatName),
        beatName: mapped.beatName || mapped.beatId || "Unknown Beat",
      };
    }
  }

  const lineItemBeat = await fetchLineItemBeat(session?.id);
  if (lineItemBeat) return lineItemBeat;

  return {
    beatId: "unknown-beat",
    beatName: "Unknown Beat",
  };
}

function inferBeatFromPaymentIntent(intent) {
  const metadata = intent?.metadata || {};
  if (metadata.beatId || metadata.beatName) {
    return {
      beatId: slugify(metadata.beatId || metadata.beatName),
      beatName: metadata.beatName || metadata.beatId || "Unknown Beat",
    };
  }
  return {
    beatId: "unknown-beat",
    beatName: "Unknown Beat",
  };
}

function inferBuyerFromCheckoutSession(session) {
  return {
    buyerName: String(session?.customer_details?.name || "").trim(),
    buyerEmail: String(session?.customer_details?.email || "").trim(),
  };
}

function inferBuyerFromPaymentIntent(intent) {
  const billing = intent?.charges?.data?.[0]?.billing_details || {};
  return {
    buyerName: String(billing?.name || "").trim(),
    buyerEmail: String(billing?.email || "").trim(),
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.warn("[stripe webhook] STRIPE_WEBHOOK_SECRET missing, webhook noop");
    return sendJson(res, 200, { received: true, warning: "Webhook secret missing" });
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (err) {
    return sendJson(res, 400, { error: "Unable to read request body" });
  }

  const signature = req.headers["stripe-signature"];
  const isValid = verifySignature(rawBody, signature, webhookSecret);
  if (!isValid) {
    return sendJson(res, 400, { error: "Invalid signature" });
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return sendJson(res, 400, { error: "Invalid JSON" });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data?.object || {};
      const beat = await inferBeatFromCheckoutSession(session);
      const buyer = inferBuyerFromCheckoutSession(session);
      await appendPurchase({
        purchaseId: `stripe_${session.id || event.id}`,
        beatId: beat.beatId,
        beatName: beat.beatName,
        buyerName: buyer.buyerName,
        buyerEmail: buyer.buyerEmail,
        createdAt: new Date((event.created || Date.now() / 1000) * 1000).toISOString(),
      });
    }

    if (event.type === "payment_intent.succeeded") {
      const intent = event.data?.object || {};
      const beat = inferBeatFromPaymentIntent(intent);
      const buyer = inferBuyerFromPaymentIntent(intent);
      await appendPurchase({
        purchaseId: `stripe_${intent.id || event.id}`,
        beatId: beat.beatId,
        beatName: beat.beatName,
        buyerName: buyer.buyerName,
        buyerEmail: buyer.buyerEmail,
        createdAt: new Date((event.created || Date.now() / 1000) * 1000).toISOString(),
      });
    }
  } catch (err) {
    console.error("[stripe webhook] processing error", err);
    return sendJson(res, 500, { error: "Webhook handling failed" });
  }

  return sendJson(res, 200, { received: true });
}
