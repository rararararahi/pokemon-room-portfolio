import { frameTextPanel } from "./TextFrame";

function formatLeaderboardLine(entry, rank) {
  if (!entry) return `${rank}. ---`;
  const name = String(entry.nickname || "PLAYER")
    .toUpperCase()
    .slice(0, 8);
  const score = Math.max(0, Math.floor(Number(entry.score) || 0));
  return `${rank}. ${name} ${score}`;
}

function getHudOffset(gameId) {
  const id = String(gameId || "").toLowerCase();
  if (id === "flappy") return { x: 0, y: 8 };
  if (id === "tetris") return { x: -6, y: 0 };
  return { x: 0, y: 0 };
}

export function createArcadeHud(scene, { gameId = "", gameName = "GAME" } = {}) {
  const panel = scene.add.container(0, 0);
  const border = scene.add.rectangle(0, 0, 10, 10, 0x111111, 0.9).setOrigin(0, 0);
  const fill = scene.add.rectangle(0, 0, 10, 10, 0xffffff, 0.86).setOrigin(0, 0);
  const text = scene.add.text(0, 0, "", {
    fontFamily: "monospace",
    fontSize: "8px",
    color: "#111111",
    lineSpacing: 1,
  }).setOrigin(0, 0);

  panel.add([border, fill, text]);
  if (typeof panel.setScrollFactor === "function") panel.setScrollFactor(0);
  if (typeof border.setScrollFactor === "function") border.setScrollFactor(0);
  if (typeof fill.setScrollFactor === "function") fill.setScrollFactor(0);
  if (typeof text.setScrollFactor === "function") text.setScrollFactor(0);
  panel.setDepth(999999);

  let currentGameId = String(gameId || "").toLowerCase();
  let currentGameName = String(gameName || "GAME");
  let leaderboard = [];
  let viewport = null;
  let chromeRect = null;

  function layoutPanel() {
    frameTextPanel(text, fill, border, {
      textX: 4,
      textY: 2,
      padX: 4,
      padY: 2,
      borderPad: 1,
    });
  }

  function getMaxLinesForChrome() {
    if (!chromeRect) return 7;
    const lineHeight = 9;
    const available = Math.max(0, Math.floor((Number(chromeRect.height) || 0) - 6));
    return Math.max(1, Math.floor(available / lineHeight));
  }

  function getDisplayLines() {
    const best = Math.max(0, Math.floor(Number(leaderboard[0]?.score) || 0));
    const maxLines = getMaxLinesForChrome();

    if (maxLines <= 1) return [`HiScore: ${best}`];
    if (maxLines === 2) return [`GAME: ${currentGameName || "GAME"}`, `HiScore: ${best}`];

    const lines = [`GAME: ${currentGameName || "GAME"}`, "HiScore"];
    const maxEntries = Math.min(5, maxLines - 2);
    for (let i = 0; i < maxEntries; i += 1) {
      lines.push(formatLeaderboardLine(leaderboard[i], i + 1));
    }
    return lines;
  }

  function positionPanel() {
    if (!viewport) return;
    const safePad = 8;
    const vpX = Math.round(Number(viewport.x) || 0);
    const vpY = Math.round(Number(viewport.y) || 0);
    const vpW = Math.round(Number(viewport.width) || 0);
    const vpH = Math.round(Number(viewport.height) || 0);
    const vpRight = vpX + vpW - safePad;
    const vpBottom = vpY + vpH - safePad;

    const hudW = Math.ceil(border.width || 0);
    const hudH = Math.ceil(border.height || 0);

    let x = vpRight - hudW;
    let y = vpY + safePad;

    if (chromeRect) {
      const cx = Math.round(Number(chromeRect.x) || vpX);
      const cy = Math.round(Number(chromeRect.y) || vpY);
      const cw = Math.round(Number(chromeRect.width) || vpW);
      const ch = Math.round(Number(chromeRect.height) || 0);

      const targetX = cx + cw - safePad - hudW;
      const targetY = cy + Math.round((ch - hudH) / 2);
      x = Math.max(vpX + safePad, Math.min(targetX, vpRight - hudW));
      y = Math.max(vpY + safePad, Math.min(targetY, vpBottom - hudH));
    }

    const offset = getHudOffset(currentGameId);
    x += Math.round(offset.x || 0);
    y += Math.round(offset.y || 0);
    x = Math.max(vpX + safePad, Math.min(x, vpRight - hudW));
    y = Math.max(vpY + safePad, Math.min(y, vpBottom - hudH));

    panel.setPosition(x, y);
  }

  function renderText() {
    const lines = getDisplayLines();
    text.setText(lines.join("\n"));
    layoutPanel();
    positionPanel();
  }

  renderText();

  return {
    setGame({ gameId: nextId, gameName: nextName } = {}) {
      currentGameId = String(nextId || currentGameId || "").toLowerCase();
      currentGameName = String(nextName || currentGameName || "GAME");
      renderText();
    },
    setLeaderboard(entries) {
      leaderboard = Array.isArray(entries) ? entries.slice(0, 5) : [];
      renderText();
    },
    layout(nextLayout) {
      if (!nextLayout) return;
      const nextViewport = nextLayout.viewport || nextLayout;
      viewport = {
        x: Number(nextViewport.x) || 0,
        y: Number(nextViewport.y) || 0,
        width: Number(nextViewport.width) || 0,
        height: Number(nextViewport.height) || 0,
      };
      const nextChromeRect = nextLayout.chromeRect || null;
      if (nextChromeRect) {
        chromeRect = {
          x: Number(nextChromeRect.x) || 0,
          y: Number(nextChromeRect.y) || 0,
          width: Number(nextChromeRect.width) || 0,
          height: Number(nextChromeRect.height) || 0,
        };
      } else {
        chromeRect = null;
      }
      renderText();
    },
    setVisible(visible) {
      panel.setVisible(!!visible);
    },
    destroy() {
      try {
        panel.destroy(true);
      } catch {}
    },
    getGameId() {
      return currentGameId;
    },
  };
}
