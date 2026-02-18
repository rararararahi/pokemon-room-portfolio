import { sendJson } from "../_http.js";
import { listIdentities, storageInfo } from "../_storage.js";

export default async function handler(req, res) {
  if (process.env.NODE_ENV === "production") {
    return sendJson(res, 404, { error: "Not found" });
  }

  if (req.method !== "GET") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  try {
    const identities = await listIdentities();
    const storage = await storageInfo();
    return sendJson(res, 200, { identities, storage: storage.kind });
  } catch {
    return sendJson(res, 500, { error: "Failed to load identities" });
  }
}
