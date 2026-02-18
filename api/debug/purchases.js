import { sendJson } from "../_http.js";
import { listPurchases, storageInfo } from "../_storage.js";

export default async function handler(req, res) {
  if (process.env.NODE_ENV === "production") {
    return sendJson(res, 404, { error: "Not found" });
  }

  if (req.method !== "GET") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  try {
    const purchases = await listPurchases();
    const storage = await storageInfo();
    return sendJson(res, 200, { purchases, storage: storage.kind });
  } catch {
    return sendJson(res, 500, { error: "Failed to load purchases" });
  }
}
