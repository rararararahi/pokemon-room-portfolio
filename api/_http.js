import crypto from "node:crypto";

export function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

export async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body || "{}");
    } catch {
      return {};
    }
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function parseCookies(req) {
  const raw = req.headers?.cookie || "";
  return raw.split(";").reduce((acc, part) => {
    const [k, ...rest] = part.trim().split("=");
    if (!k) return acc;
    acc[k] = decodeURIComponent(rest.join("=") || "");
    return acc;
  }, {});
}

export function setCookie(res, name, value, { maxAge = 31536000 } = {}) {
  const cookie = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
  const existing = res.getHeader("Set-Cookie");
  if (!existing) {
    res.setHeader("Set-Cookie", cookie);
  } else if (Array.isArray(existing)) {
    res.setHeader("Set-Cookie", [...existing, cookie]);
  } else {
    res.setHeader("Set-Cookie", [existing, cookie]);
  }
}

export function newId(prefix = "id") {
  const uuid = crypto.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${uuid}`;
}

export function basicEmailValid(email) {
  const value = String(email || "").trim();
  return value.includes("@") && value.includes(".");
}
