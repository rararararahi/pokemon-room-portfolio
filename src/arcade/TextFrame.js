function ensureTextMetrics(text) {
  if (!text) return { width: 1, height: 1 };
  if (typeof text.updateText === "function") {
    try {
      text.updateText();
    } catch {}
  }

  let width = Number(text.displayWidth);
  let height = Number(text.displayHeight);

  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    width = Number(text.width);
    height = Number(text.height);
  }

  return {
    width: Math.max(1, Math.ceil(width || 1)),
    height: Math.max(1, Math.ceil(height || 1)),
  };
}

export function frameTextPanel(text, fill, border, {
  textX = 0,
  textY = 0,
  padX = 8,
  padY = 6,
  borderPad = 2,
} = {}) {
  const { width, height } = ensureTextMetrics(text);
  const x = Math.floor(textX - padX);
  const y = Math.floor(textY - padY);
  const w = Math.ceil(width + padX * 2);
  const h = Math.ceil(height + padY * 2);

  if (text) text.setPosition(textX, textY);
  if (fill) fill.setPosition(x, y).setSize(w, h);
  if (border) border.setPosition(x - borderPad, y - borderPad).setSize(w + borderPad * 2, h + borderPad * 2);

  return { x, y, width: w, height: h };
}
