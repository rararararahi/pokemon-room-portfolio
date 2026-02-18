import { listPurchases, storageInfo } from "./_storage.js";
import { sendJson } from "./_http.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  try {
    const purchases = await listPurchases();
    const storage = await storageInfo();
    return sendJson(res, 200, { purchases, storage: storage.kind });
  } catch (err) {
    return sendJson(res, 500, { error: "Failed to load state" });
  }
}
