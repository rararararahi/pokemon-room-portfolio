import { readJsonBody, sendJson } from "../_http.js";
import { loginNicknameWithPin } from "./_auth.js";

export default async function handler(req, res) {
  if (req.method === "GET") {
    return sendJson(res, 405, {
      ok: false,
      error: "method_not_allowed",
      message: "Use POST /api/nickname/login",
    });
  }

  if (req.method !== "POST") {
    return sendJson(res, 405, { ok: false, error: "method_not_allowed" });
  }

  try {
    const body = await readJsonBody(req);
    const result = await loginNicknameWithPin(body?.nickname, body?.pin, req);

    if (result.ok) {
      return sendJson(res, 200, { ok: true, nickname: result.nickname });
    }
    if (result.error === "invalid") {
      return sendJson(res, 400, { ok: false, error: "invalid" });
    }
    if (result.error === "invalid_pin") {
      return sendJson(res, 401, { ok: false, error: "invalid_pin" });
    }
    if (result.error === "rate_limited") {
      return sendJson(res, 429, { ok: false, error: "rate_limited" });
    }
    if (result.error === "registry_unavailable") {
      return sendJson(res, 501, {
        ok: false,
        error: "registry_unavailable",
        message: "Nickname registry backend is not configured.",
      });
    }

    return sendJson(res, 500, { ok: false, error: "unexpected" });
  } catch (err) {
    console.error("[nickname] login failed", err);
    return sendJson(res, 500, { ok: false, error: "unexpected" });
  }
}
