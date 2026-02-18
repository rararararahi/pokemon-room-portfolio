export const GAME_W = 320;
export const GAME_H = 240;
export const WORLD_ZOOM = 1;
export const SPEED = 80;
export const RUN_MULT = 1.8;
export const RUN_HOLD_MS = 110;
export const PLAYER_SCALE = 2;
export const FEET_W = 10;
export const FEET_H = 8;
export const FEET_OFFSET_X = 3;
export const FEET_OFFSET_Y = 8;

export const DEBUG_UI =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("debug") === "1";

export const LOCAL_IDENTITY_KEY = "pokemon_room_identity";

export function debugLog(...args) {
  if (DEBUG_UI) {
    console.log(...args);
  }
}

export function deriveBeatId(item, index = 0) {
  const explicit = item?.beatId || item?.id;
  if (explicit && typeof explicit === "string") {
    return slugifyBeatId(explicit);
  }

  const preview = typeof item?.preview === "string" ? item.preview : "";
  const previewName = preview.split("/").pop() || "";
  const previewBase = previewName.replace(/\.[^.]+$/, "");
  if (previewBase) return slugifyBeatId(previewBase);

  const name = typeof item?.name === "string" ? item.name : `beat-${index + 1}`;
  return slugifyBeatId(name);
}

export function slugifyBeatId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "beat";
}

export function normalizeShopItems(rawItems, pageSize = 5) {
  const items = Array.isArray(rawItems) ? rawItems.map((item, index) => {
    const beatId = deriveBeatId(item, index);
    return {
      ...item,
      beatId,
      id: typeof item?.id === "string" && item.id ? item.id : beatId,
    };
  }) : [];

  const coffeeIndex = items.findIndex((item) => {
    const name = String(item?.name || "").toLowerCase();
    const id = String(item?.id || "").toLowerCase();
    return name === "buymecoffee" || name === "buy me a coffee" || id === "coffee";
  });

  if (coffeeIndex >= 0 && pageSize > 0) {
    const [coffee] = items.splice(coffeeIndex, 1);
    const target = Math.min(items.length, Math.max(0, pageSize - 1));
    items.splice(target, 0, coffee);
  }

  return items;
}
