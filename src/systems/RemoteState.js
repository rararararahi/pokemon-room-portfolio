export default class RemoteState {
  constructor(baseUrl = "") {
    this.baseUrl = baseUrl;
  }

  async getState() {
    try {
      const res = await fetch(`${this.baseUrl}/api/state`, {
        method: "GET",
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`state HTTP ${res.status}`);
      const contentType = String(res.headers.get("content-type") || "").toLowerCase();
      if (!contentType.includes("application/json")) {
        console.warn("[RemoteState] /api/state returned non-JSON response; using empty state");
        return { purchases: [] };
      }
      const json = await res.json();
      const purchases = Array.isArray(json?.purchases) ? json.purchases : [];
      return { purchases };
    } catch (err) {
      console.warn("[RemoteState] failed to fetch state", err);
      return { purchases: [] };
    }
  }

  async registerIdentity(name, email) {
    const payload = {
      name: String(name || "").trim(),
      email: String(email || "").trim(),
    };

    const res = await fetch(`${this.baseUrl}/api/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || `register HTTP ${res.status}`);
    }

    return res.json();
  }
}
