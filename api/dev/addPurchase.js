import { appendPurchase, listPurchases } from "../_storage.js";
import { newId, readJsonBody, sendJson } from "../_http.js";

export default async function handler(req, res) {
  if (process.env.NODE_ENV === "production") {
    return sendJson(res, 404, { error: "Not found" });
  }

  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  const body = await readJsonBody(req);
  const beatId = String(body?.beatId || "dev-beat");
  const beatName = String(body?.beatName || "Dev Beat");
  const buyerName = String(body?.buyerName || "Dev Buyer");
  const buyerEmail = String(body?.buyerEmail || "dev@example.com");

  try {
    await appendPurchase({
      purchaseId: body?.purchaseId ? String(body.purchaseId) : newId("dev_purchase"),
      beatId,
      beatName,
      buyerName,
      buyerEmail,
      createdAt: new Date().toISOString(),
    });
    const purchases = await listPurchases();
    return sendJson(res, 200, { ok: true, purchases });
  } catch (err) {
    return sendJson(res, 500, { error: "Failed to add dev purchase" });
  }
}
