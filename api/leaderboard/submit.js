import { readJsonBody, sendJson } from "../_http.js";
import { submitLeaderboard } from "./_store.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { ok: false, error: "method_not_allowed" });
  }

  try {
    const body = await readJsonBody(req);
    const result = await submitLeaderboard({
      gameId: body?.gameId,
      nickname: body?.nickname,
      score: body?.score,
    });

    if (!result.ok && result.error === "invalid") {
      return sendJson(res, 400, { ok: false, error: "invalid" });
    }
    if (!result.ok && result.error === "leaderboard_unavailable") {
      return sendJson(res, 501, { ok: false, error: "leaderboard_unavailable" });
    }
    if (!result.ok) {
      return sendJson(res, 500, { ok: false, error: "unexpected" });
    }

    return sendJson(res, 200, {
      ok: true,
      gameId: result.gameId,
      entries: result.entries,
    });
  } catch (err) {
    console.error("[leaderboard] submit failed", err);
    return sendJson(res, 500, { ok: false, error: "unexpected" });
  }
}
