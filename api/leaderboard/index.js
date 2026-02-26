import { sendJson } from "../_http.js";
import { isValidGameId, normalizeGameId, readLeaderboard } from "./_store.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { ok: false, error: "method_not_allowed" });
  }

  try {
    const gameId = normalizeGameId(req.query?.gameId || "");
    if (!isValidGameId(gameId)) {
      return sendJson(res, 400, { ok: false, error: "invalid" });
    }

    const result = await readLeaderboard(gameId);
    if (!result.ok && result.error === "leaderboard_unavailable") {
      return sendJson(res, 501, { ok: false, error: "leaderboard_unavailable" });
    }
    if (!result.ok) {
      return sendJson(res, 400, { ok: false, error: "invalid" });
    }

    return sendJson(res, 200, {
      ok: true,
      gameId: result.gameId,
      entries: result.entries,
    });
  } catch (err) {
    console.error("[leaderboard] GET failed", err);
    return sendJson(res, 500, { ok: false, error: "unexpected" });
  }
}
