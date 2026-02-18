import { basicEmailValid, newId, parseCookies, readJsonBody, sendJson, setCookie } from "./_http.js";
import { setIdentity } from "./_storage.js";

const USER_COOKIE = "pokemon_room_uid";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  const body = await readJsonBody(req);
  const name = String(body?.name || "").trim();
  const email = String(body?.email || "").trim();

  if (!name) {
    return sendJson(res, 400, { error: "Name is required" });
  }
  if (!basicEmailValid(email)) {
    return sendJson(res, 400, { error: "Valid email is required" });
  }

  const cookies = parseCookies(req);
  const userId = cookies[USER_COOKIE] || newId("user");

  try {
    await setIdentity(userId, { name, email });
    setCookie(res, USER_COOKIE, userId);
    return sendJson(res, 200, { userId, name, email });
  } catch (err) {
    return sendJson(res, 500, { error: "Unable to register identity" });
  }
}
