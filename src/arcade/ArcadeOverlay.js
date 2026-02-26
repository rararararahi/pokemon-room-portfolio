import ArcadeGameRunner from "./ArcadeGameRunner";
import PacMini from "./games/PacMini";
import Pong from "./games/Pong";
import Tetris from "./games/Tetris";
import Flappy from "./games/Flappy";
import BlackjackMini from "./games/BlackjackMini";
import BrickBreaker from "./games/BrickBreaker";
import { createArcadeHud } from "./ArcadeHud";
import {
  getArcadeProfile,
  getNicknameConstraints,
  normalizeNickname,
  setArcadeNickname,
} from "./ArcadePersistence";

const ARCADE_GAMES = [
  { id: "pacmini", label: "PACMINI", createGame: () => new PacMini() },
  { id: "pong", label: "PONG", createGame: () => new Pong() },
  { id: "tetris", label: "TETRIS", createGame: () => new Tetris() },
  { id: "flappy", label: "FLAPPY", createGame: () => new Flappy() },
  { id: "brickbreaker", label: "BRICK BREAKER", createGame: () => new BrickBreaker() },
  { id: "blackjack", label: "BLACKJACK", createGame: () => new BlackjackMini() },
];

const MENU_ENTRIES = ARCADE_GAMES;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export default class ArcadeOverlay {
  constructor(scene, hooks = {}) {
    this.scene = scene;
    this.onOpen = hooks.onOpen;
    this.onClose = hooks.onClose;

    this.isOpen = false;
    this.mode = "menu";
    this.selectedIndex = 0;
    this.confirmChoice = 0;
    this.lastTickAt = 0;

    this.navHoldDir = 0;
    this.navHoldNextAt = 0;
    this.navInitialDelayMs = 160;
    this.navRepeatMs = 90;

    this.launchDebounceUntil = 0;
    this.layoutMetrics = null;

    this.panelBaseX = 0;
    this.panelBaseY = 0;
    this.panelOffsetY = 0;
    this.panelTween = null;
    this.bannerTween = null;

    this.typeBaseDelayMs = 24;
    this.systemQueue = [];
    this.systemActive = false;
    this.systemCurrent = "";
    this.systemIndex = 0;
    this.systemNextAt = 0;
    this.systemAwaitAdvance = false;
    this.profile = getArcadeProfile();
    this.hud = null;
    this.viewport = null;
    this.menuHiScoreAnchor = null;
    this.gameScreenRect = null;
    this.gameChromeRect = null;
    this.gameViewportRect = null;

    this.container = scene.add.container(0, 0);
    this.container.setVisible(false);
    this.container.setActive(false);

    this.dim = scene.add.rectangle(0, 0, 10, 10, 0x000000, 0.82).setOrigin(0, 0);
    this.dim.setInteractive();
    this.dim.disableInteractive();
    this.dim.on("pointerdown", () => {
      if (!this.isOpen) return;
      if (this.mode === "confirm") {
        this.mode = "menu";
        this.render();
      } else if (this.mode === "menu") {
        this.close();
      }
    });

    this.panelWrap = scene.add.container(0, 0);

    this.panelBorder = scene.add.rectangle(0, 0, 10, 10, 0x111111).setOrigin(0, 0);
    this.panelFill = scene.add.rectangle(0, 0, 10, 10, 0xffffff).setOrigin(0, 0);

    this.title = scene.add.text(0, 0, "ARCADE MACHINE", {
      fontFamily: "monospace",
      fontSize: "13px",
      color: "#111111",
    }).setOrigin(0, 0);

    this.pageText = scene.add.text(0, 0, "PAGE 1/1", {
      fontFamily: "monospace",
      fontSize: "11px",
      color: "#111111",
    }).setOrigin(1, 0);

    this.infoBorder = scene.add.rectangle(0, 0, 10, 10, 0x111111).setOrigin(0, 0);
    this.infoFill = scene.add.rectangle(0, 0, 10, 10, 0xffffff).setOrigin(0, 0);
    this.infoText = scene.add.text(0, 0, "", {
      fontFamily: "monospace",
      fontSize: "10px",
      color: "#111111",
      lineSpacing: 2,
    }).setOrigin(0, 0);

    this.list = scene.add.text(0, 0, "", {
      fontFamily: "monospace",
      fontSize: "14px",
      color: "#111111",
      lineSpacing: 8,
    }).setOrigin(0, 0);

    this.menuHiScoreBorder = scene.add.rectangle(0, 0, 10, 10, 0x111111, 0.9).setOrigin(0, 0);
    this.menuHiScoreFill = scene.add.rectangle(0, 0, 10, 10, 0xffffff, 0.86).setOrigin(0, 0);
    this.menuHiScoreText = scene.add.text(0, 0, "", {
      fontFamily: "monospace",
      fontSize: "12px",
      color: "#111111",
      lineSpacing: 5,
    }).setOrigin(0, 0);

    this.hint = scene.add.text(0, 0, "", {
      fontFamily: "monospace",
      fontSize: "11px",
      color: "#111111",
    }).setOrigin(0, 0);

    this.systemBorder = scene.add.rectangle(0, 0, 10, 10, 0x111111).setOrigin(0, 0);
    this.systemFill = scene.add.rectangle(0, 0, 10, 10, 0xffffff).setOrigin(0, 0);
    this.systemText = scene.add.text(0, 0, "", {
      fontFamily: "monospace",
      fontSize: "11px",
      color: "#111111",
    }).setOrigin(0, 0);

    this.bannerText = scene.add.text(0, 0, "", {
      fontFamily: "monospace",
      fontSize: "11px",
      color: "#111111",
    }).setOrigin(0.5, 0);
    this.bannerText.setVisible(false);

    this.confirmBorder = scene.add.rectangle(0, 0, 10, 10, 0x111111).setOrigin(0, 0);
    this.confirmFill = scene.add.rectangle(0, 0, 10, 10, 0xffffff).setOrigin(0, 0);
    this.confirmText = scene.add.text(0, 0, "", {
      fontFamily: "monospace",
      fontSize: "14px",
      color: "#111111",
      lineSpacing: 4,
    }).setOrigin(0, 0);

    this.panelWrap.add([
      this.panelBorder,
      this.panelFill,
      this.title,
      this.pageText,
      this.infoBorder,
      this.infoFill,
      this.infoText,
      this.list,
      this.menuHiScoreBorder,
      this.menuHiScoreFill,
      this.menuHiScoreText,
      this.hint,
      this.systemBorder,
      this.systemFill,
      this.systemText,
      this.bannerText,
      this.confirmBorder,
      this.confirmFill,
      this.confirmText,
    ]);

    this.runner = new ArcadeGameRunner(scene, this.panelWrap);
    this.runner.onLeaderboardChanged = (gameId) => {
      const selectedId = this.selectedEntry?.id || "";
      if (this.mode === "game") return;
      if (gameId && selectedId && gameId !== selectedId) return;
      this.render();
    };

    this.container.add([this.dim, this.panelWrap]);

    this.hideConfirm();
    this.setRunnerVisible(false);
    this.systemBorder.setVisible(false);
    this.systemFill.setVisible(false);
    this.systemText.setVisible(false);
    this.menuHiScoreBorder.setVisible(false);
    this.menuHiScoreFill.setVisible(false);
    this.menuHiScoreText.setVisible(false);
  }

  get selectedEntry() {
    return MENU_ENTRIES[this.selectedIndex] || MENU_ENTRIES[0];
  }

  get selectedGame() {
    const entry = this.selectedEntry;
    if (entry && typeof entry.createGame === "function") return entry;
    return ARCADE_GAMES[0];
  }

  getNickname() {
    return this.profile?.nickname || "";
  }

  promptForNickname({ required = false } = {}) {
    if (typeof window === "undefined") return false;
    const { min, max } = getNicknameConstraints();
    const current = this.getNickname();
    const promptText = `Choose nickname (${min}-${max} chars, letters/numbers/_ only)`;

    while (true) {
      const raw = window.prompt(promptText, current);
      if (raw === null) return false;
      const nickname = normalizeNickname(raw);
      if (!nickname) {
        window.alert("Nickname becomes 2-10 uppercase letters/numbers/underscore.");
        continue;
      }

      const next = setArcadeNickname(nickname);
      if (!next) {
        window.alert("Couldn't save nickname. Try again.");
        if (required) continue;
        return false;
      }

      this.profile = next;
      this.render();
      return true;
    }
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.mode = "menu";
    this.selectedIndex = 0;
    this.confirmChoice = 0;
    this.lastTickAt = 0;
    this.navHoldDir = 0;
    this.navHoldNextAt = 0;
    this.launchDebounceUntil = 0;

    this.container.setVisible(true);
    this.container.setActive(true);
    this.container.setDepth(10000);
    this.dim.setInteractive();

    this.profile = getArcadeProfile();
    if (!this.getNickname()) {
      const ok = this.promptForNickname({ required: true });
      if (!ok) {
        this.close();
        return;
      }
    }

    this.runner.requestLeaderboard(this.selectedGame?.id || "", { force: false });

    if (this.panelTween) {
      this.panelTween.stop();
      this.panelTween = null;
    }
    this.panelOffsetY = 12;
    this.applyPanelPosition();
    this.panelTween = this.scene.tweens.add({
      targets: this,
      panelOffsetY: 0,
      duration: 150,
      ease: "Sine.Out",
      onUpdate: () => this.applyPanelPosition(),
      onComplete: () => {
        this.panelTween = null;
      },
    });

    this.render();
    if (typeof this.onOpen === "function") this.onOpen();
  }

  close() {
    if (!this.isOpen) return;

    this.runner.stopGame();
    this.destroyHud();
    this.isOpen = false;
    this.mode = "menu";

    this.systemActive = false;
    this.systemQueue = [];
    this.systemCurrent = "";
    this.systemText.setVisible(false);
    this.systemBorder.setVisible(false);
    this.systemFill.setVisible(false);

    this.container.setVisible(false);
    this.container.setActive(false);
    this.dim.disableInteractive();

    if (this.panelTween) {
      this.panelTween.stop();
      this.panelTween = null;
    }
    if (this.bannerTween) {
      this.bannerTween.stop();
      this.bannerTween = null;
    }

    if (typeof this.onClose === "function") this.onClose();
  }

  setRunnerVisible(visible) {
    this.runner.frameBorder?.setVisible?.(visible);
    this.runner.frameFill?.setVisible?.(visible);
    this.runner.gameContainer?.setVisible?.(visible);
  }

  destroyHud() {
    if (!this.hud) return;
    try {
      this.hud.destroy();
    } catch {}
    this.hud = null;
  }

  ensureHud(game) {
    const gameId = game?.id || "";
    const gameName = this.runner.getCurrentGameName() || game?.label || "GAME";
    if (!this.hud) {
      this.hud = createArcadeHud(this.scene, { gameId, gameName });
    }
    this.hud.setGame({ gameId, gameName });
    this.hud.setLeaderboard(this.runner.getLeaderboard(gameId));
    if (this.viewport) {
      this.hud.layout({
        viewport: this.viewport,
        screenRect: this.gameScreenRect,
        chromeRect: this.gameChromeRect,
        viewportRect: this.gameViewportRect,
      });
    }
    this.hud.setVisible(true);
  }

  applyPanelPosition() {
    this.panelWrap.setPosition(Math.round(this.panelBaseX), Math.round(this.panelBaseY + this.panelOffsetY));
  }

  layout(gameCam) {
    const scene = this.scene;

    let vpX = 0;
    let vpY = 0;
    let vpW = scene.scale.width;
    let vpH = scene.scale.height;

    if (
      gameCam &&
      Number.isFinite(gameCam.x) &&
      Number.isFinite(gameCam.y) &&
      Number.isFinite(gameCam.width) &&
      Number.isFinite(gameCam.height) &&
      gameCam.width > 0 &&
      gameCam.height > 0
    ) {
      vpX = Math.round(gameCam.x);
      vpY = Math.round(gameCam.y);
      vpW = Math.round(gameCam.width);
      vpH = Math.round(gameCam.height);
    }

    this.viewport = { x: vpX, y: vpY, width: vpW, height: vpH };
    this.dim.setPosition(vpX, vpY);
    this.dim.setSize(vpW, vpH);
    if (this.hud) {
      this.hud.layout({
        viewport: this.viewport,
        screenRect: this.gameScreenRect,
        chromeRect: this.gameChromeRect,
        viewportRect: this.gameViewportRect,
      });
    }

    const border = 4;
    const pad = 8;
    const panelW = Math.max(80, Math.round(vpW - 8));
    const panelH = Math.max(80, Math.round(vpH - 8));
    this.layoutMetrics = { panelW, panelH, border, pad };

    this.panelBaseX = Math.round(vpX + 4);
    this.panelBaseY = Math.round(vpY + 4);
    this.applyPanelPosition();

    this.panelBorder.setPosition(0, 0);
    this.panelBorder.setSize(panelW, panelH);

    this.panelFill.setPosition(border, border);
    this.panelFill.setSize(panelW - border * 2, panelH - border * 2);

    const innerX = border + pad;
    const innerY = border + pad;
    const innerW = panelW - (border + pad) * 2;

    this.title.setPosition(innerX, innerY - 2);
    this.pageText.setPosition(panelW - border - pad, innerY - 1);

    this.bannerText.setPosition(Math.round(panelW / 2), innerY + 1);

    this.confirmAnchor = { panelW, panelH, border, pad, innerX, innerY, innerW };
    this.applyModeLayout();
    this.render();
  }

  applyModeLayout() {
    if (!this.layoutMetrics || !this.confirmAnchor) return;
    const { panelW, panelH, border, pad } = this.layoutMetrics;
    const { innerX, innerY, innerW } = this.confirmAnchor;

    const isGame = this.mode === "game";
    const infoX = innerX;
    const infoY = innerY + 14;
    const infoW = Math.min(138, Math.max(112, Math.round(panelW * 0.42)));
    const infoH = 106;
    const hintY = panelH - border - pad - 12;

    this.infoBorder.setPosition(infoX, infoY);
    this.infoBorder.setSize(infoW, infoH);
    this.infoFill.setPosition(infoX + 2, infoY + 2);
    this.infoFill.setSize(infoW - 4, infoH - 4);
    this.infoText.setPosition(infoX + 6, infoY + 4);
    this.infoText.setWordWrapWidth(Math.max(24, infoW - 12), true);

    let runnerX = innerX;
    let runnerY = isGame ? innerY + 14 : innerY + 78;
    let runnerW = innerW;
    let runnerH = Math.max(60, panelH - runnerY - (border + pad + 4));

    if (isGame) {
      this.menuHiScoreAnchor = null;

      const rects = this.buildGameRects(innerX, innerY, innerW, panelH, border, pad);
      const { screenRect, chromeRect, viewportRect } = rects;
      runnerX = viewportRect.x;
      runnerY = viewportRect.y;
      runnerW = viewportRect.width;
      runnerH = viewportRect.height;

      const panelOffsetX = Math.round(Number(this.panelWrap?.x) || this.panelBaseX || 0);
      const panelOffsetY = Math.round(Number(this.panelWrap?.y) || this.panelBaseY || 0);

      this.gameScreenRect = {
        x: panelOffsetX + screenRect.x,
        y: panelOffsetY + screenRect.y,
        width: screenRect.width,
        height: screenRect.height,
      };
      this.gameChromeRect = {
        x: panelOffsetX + chromeRect.x,
        y: panelOffsetY + chromeRect.y,
        width: chromeRect.width,
        height: chromeRect.height,
      };
      this.gameViewportRect = {
        x: panelOffsetX + viewportRect.x,
        y: panelOffsetY + viewportRect.y,
        width: viewportRect.width,
        height: viewportRect.height,
      };
    } else {
      const contentX = innerX + 2;
      const contentY = infoY + 4;
      const contentW = Math.max(120, innerW - 2);
      const menuGap = 8;
      const leftPreferred = Math.round(contentW * 0.38);
      const leftMaxBySpace = Math.max(120, contentW - menuGap - 140);
      const listW = clamp(leftPreferred, 120, Math.min(182, leftMaxBySpace));
      const listX = contentX;
      const menuX = listX + listW + menuGap;
      const menuW = Math.max(96, contentX + contentW - menuX);
      const menuY = contentY;

      this.list.setPosition(listX, contentY);
      this.list.setWordWrapWidth(0, false);

      const textPadX = 12;
      const textPadY = 10;
      const borderPad = 1;
      const fontPx = Number.parseInt(String(this.menuHiScoreText.style.fontSize || "12"), 10) || 12;
      const lineSpacing = Number.isFinite(this.menuHiScoreText.lineSpacing) ? this.menuHiScoreText.lineSpacing : 0;
      const lineHeight = fontPx + lineSpacing;
      const fixedLines = 7; // GAME + HiScore + Top 5
      const safeMinX = menuX + 2;
      const safeMaxX = menuX + menuW - 2;
      const safeMinY = menuY + 2;
      const safeMaxY = hintY - 6;
      const availableH = Math.max(44, safeMaxY - safeMinY);
      const desiredPanelW = clamp(Math.floor(menuW * 0.98), 150, 220);
      const panelW = Math.max(72, Math.min(desiredPanelW, safeMaxX - safeMinX));
      const panelH = Math.max(44, Math.min(textPadY * 2 + fixedLines * lineHeight, availableH));
      const panelX = safeMaxX - panelW;
      const panelY = safeMinY;

      this.menuHiScoreFill.setPosition(panelX, panelY);
      this.menuHiScoreFill.setSize(panelW, panelH);
      this.menuHiScoreBorder.setPosition(panelX - borderPad, panelY - borderPad);
      this.menuHiScoreBorder.setSize(panelW + borderPad * 2, panelH + borderPad * 2);

      this.menuHiScoreAnchor = {
        x: panelX + textPadX,
        y: panelY + textPadY,
        maxW: Math.max(24, panelW - textPadX * 2),
        lineMaxChars: Math.max(8, Math.floor((panelW - textPadX * 2) / Math.max(5, Math.round(fontPx * 0.6)))),
      };
      this.menuHiScoreText.setPosition(this.menuHiScoreAnchor.x, this.menuHiScoreAnchor.y);
      this.menuHiScoreText.setWordWrapWidth(0, false);

      this.gameScreenRect = null;
      this.gameChromeRect = null;
      this.gameViewportRect = null;
    }

    this.runner.layout(runnerX, runnerY, runnerW, runnerH);

    this.hint.setPosition(innerX, hintY);

    const sysH = 20;
    this.systemBorder.setPosition(innerX, hintY - sysH - 6);
    this.systemBorder.setSize(innerW, sysH);
    this.systemFill.setPosition(innerX + 2, hintY - sysH - 4);
    this.systemFill.setSize(innerW - 4, sysH - 4);
    this.systemText.setPosition(innerX + 6, hintY - sysH - 1);
  }

  buildGameRects(innerX, innerY, innerW, panelH, border, pad) {
    const baseViewportY = innerY + 14;
    const baseViewportH = Math.max(60, panelH - baseViewportY - (border + pad + 4));

    const chromeH = Math.max(18, Math.min(24, Math.round(panelH * 0.06)));
    const screenY = Math.max(border + 2, baseViewportY - chromeH);
    const maxScreenH = Math.max(80, panelH - screenY - (border + 2));
    const screenH = Math.max(80, Math.min(maxScreenH, baseViewportH + chromeH));
    const viewportH = Math.max(60, Math.min(baseViewportH, screenH - chromeH));

    const screenRect = {
      x: innerX,
      y: screenY,
      width: innerW,
      height: screenH,
    };
    const chromeRect = {
      x: innerX,
      y: screenY,
      width: innerW,
      height: chromeH,
    };
    const viewportRect = {
      x: innerX,
      y: screenY + chromeH,
      width: innerW,
      height: viewportH,
    };
    return { screenRect, chromeRect, viewportRect };
  }

  getTypeDelay(char) {
    if (char === "\n") return this.typeBaseDelayMs + 90;
    if (char === "." || char === "," || char === "!" || char === "?" || char === ";") {
      return this.typeBaseDelayMs + 90;
    }
    return this.typeBaseDelayMs;
  }

  startSystemSequence(now, messages) {
    this.systemQueue = Array.isArray(messages) ? messages.slice() : [];
    this.systemActive = this.systemQueue.length > 0;
    this.systemCurrent = "";
    this.systemIndex = 0;
    this.systemAwaitAdvance = false;
    this.systemNextAt = now;

    this.systemBorder.setVisible(this.systemActive);
    this.systemFill.setVisible(this.systemActive);
    this.systemText.setVisible(this.systemActive);
    this.systemText.setText("");

    if (this.systemActive) this.beginNextSystemMessage(now);
  }

  beginNextSystemMessage(now) {
    if (!this.systemQueue.length) {
      this.systemActive = false;
      this.systemCurrent = "";
      this.systemText.setText("");
      this.systemBorder.setVisible(false);
      this.systemFill.setVisible(false);
      this.systemText.setVisible(false);
      return;
    }

    this.systemCurrent = String(this.systemQueue.shift() || "");
    this.systemIndex = 0;
    this.systemAwaitAdvance = false;
    this.systemText.setText("");
    this.systemNextAt = now + this.typeBaseDelayMs;
    this.systemBorder.setVisible(true);
    this.systemFill.setVisible(true);
    this.systemText.setVisible(true);
  }

  updateSystemTypewriter(now) {
    if (!this.systemActive || this.systemAwaitAdvance) return;
    if (now < this.systemNextAt) return;

    this.systemIndex = Math.min(this.systemIndex + 1, this.systemCurrent.length);
    this.systemText.setText(this.systemCurrent.slice(0, this.systemIndex));

    if (this.systemIndex >= this.systemCurrent.length) {
      this.systemAwaitAdvance = true;
      return;
    }

    const char = this.systemCurrent[this.systemIndex - 1];
    this.systemNextAt = now + this.getTypeDelay(char);
  }

  consumeSystemAdvance(now, input) {
    if (!this.systemActive || !input?.aJust) return false;

    if (!this.systemAwaitAdvance) {
      this.systemIndex = this.systemCurrent.length;
      this.systemText.setText(this.systemCurrent);
      this.systemAwaitAdvance = true;
      return true;
    }

    this.beginNextSystemMessage(now);
    return true;
  }

  updateInfoBox() {
    if (this.mode === "game") {
      this.infoText.setText("");
      return;
    }

    const game = this.selectedGame;
    const lines = [`GAME: ${game?.label || "-"}`, "A: PLAY", "B: BACK"];
    this.infoText.setText(lines.join("\n"));
  }

  formatMenuHiScoreLine(entry, rank) {
    if (!entry) return `${rank}. ---- 0`;
    const name = String(entry.nickname || "---")
      .toUpperCase()
      .slice(0, 8);
    const score = Math.max(0, Math.floor(Number(entry.score) || 0));
    return `${rank}. ${name} ${score}`;
  }

  truncateMenuLine(line, maxChars) {
    const safe = String(line || "");
    if (!Number.isFinite(maxChars) || maxChars <= 3) return safe.slice(0, Math.max(1, maxChars || 1));
    if (safe.length <= maxChars) return safe;
    return `${safe.slice(0, maxChars - 3)}...`;
  }

  formatMenuScoreRow(rank, nickname, score, maxChars) {
    const safeMaxChars = Math.max(6, Math.floor(Number(maxChars) || 0));
    const rankPrefix = `${Math.max(1, Math.floor(Number(rank) || 0))}. `;
    const scoreText = String(Math.max(0, Math.floor(Number(score) || 0)));
    const reserved = rankPrefix.length + 1 + scoreText.length;
    if (reserved >= safeMaxChars) return `${rankPrefix.trim()} ${scoreText}`;
    const availableNameChars = safeMaxChars - reserved;
    const rawName = String(nickname || "----")
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, "");
    const safeName = this.truncateMenuLine(rawName || "----", availableNameChars).padEnd(availableNameChars, " ");
    return `${rankPrefix}${safeName} ${scoreText}`;
  }

  formatMenuGameLabel(label, maxChars = 12) {
    const safe = String(label || "-").toUpperCase();
    if (safe.length <= maxChars) return safe;
    return `${safe.slice(0, Math.max(1, maxChars - 3))}...`;
  }

  updateMenuHiScorePanel() {
    const entry = this.selectedEntry;
    if (!entry || !this.menuHiScoreAnchor) {
      this.menuHiScoreText.setText("");
      this.menuHiScoreFill.setSize(0, 0);
      this.menuHiScoreBorder.setSize(0, 0);
      return;
    }

    this.menuHiScoreText.setPosition(this.menuHiScoreAnchor.x, this.menuHiScoreAnchor.y);
    this.menuHiScoreText.setWordWrapWidth(0, false);
    const leaderboard = this.runner.getLeaderboard(entry?.id || "");
    const source = this.runner.getLeaderboardSource(entry?.id || "");
    const lineMaxChars = Math.max(8, Math.floor(Number(this.menuHiScoreAnchor.lineMaxChars) || 8));
    const gameLabelChars = Math.max(3, lineMaxChars - 6);
    const lines = [
      this.truncateMenuLine(`GAME: ${this.formatMenuGameLabel(entry?.label || "-", gameLabelChars)}`, lineMaxChars),
      this.truncateMenuLine(source === "local" ? "HiScore LOCAL" : "HiScore", lineMaxChars),
    ];
    for (let rank = 0; rank < 5; rank += 1) {
      const row = leaderboard[rank] || null;
      lines.push(
        this.formatMenuScoreRow(rank + 1, row?.nickname || "----", row?.score || 0, lineMaxChars)
      );
    }
    this.menuHiScoreText.setText(lines.join("\n"));
  }

  updateMenuList() {
    const lines = [];
    for (let i = 0; i < MENU_ENTRIES.length; i += 1) {
      const cursor = i === this.selectedIndex ? "▶" : " ";
      const entry = MENU_ENTRIES[i];
      lines.push(`${cursor} ${entry.label}`);
    }
    this.list.setText(lines.join("\n"));
  }

  showConfirm() {
    const entry = this.selectedEntry;
    if (!entry || !this.confirmAnchor) return;

    const { panelW, panelH } = this.confirmAnchor;
    const cW = Math.round(panelW * 0.72);
    const cH = 86;
    const cX = Math.round(panelW - cW - 10);
    const cY = Math.round(panelH - cH - 10);

    this.confirmBorder.setVisible(true);
    this.confirmFill.setVisible(true);
    this.confirmText.setVisible(true);

    this.confirmBorder.setPosition(cX, cY);
    this.confirmBorder.setSize(cW, cH);

    this.confirmFill.setPosition(cX + 2, cY + 2);
    this.confirmFill.setSize(cW - 4, cH - 4);

    const yesCursor = this.confirmChoice === 0 ? "▶" : " ";
    const noCursor = this.confirmChoice === 1 ? "▶" : " ";
    this.confirmText.setPosition(cX + 8, cY + 8);
    const prompt = `Play ${entry.label}?`;
    this.confirmText.setText(`${prompt}\n\n${yesCursor} YES\n${noCursor} NO`);
  }

  hideConfirm() {
    this.confirmBorder.setVisible(false);
    this.confirmFill.setVisible(false);
    this.confirmText.setVisible(false);
  }

  showStartBanner(text) {
    if (!text) return;

    if (this.bannerTween) {
      this.bannerTween.stop();
      this.bannerTween = null;
    }

    this.bannerText.setVisible(true);
    this.bannerText.setAlpha(1);
    this.bannerText.setText(text);

    this.bannerTween = this.scene.tweens.add({
      targets: this.bannerText,
      alpha: 0,
      delay: 1200,
      duration: 220,
      ease: "Sine.Out",
      onComplete: () => {
        this.bannerText.setVisible(false);
        this.bannerText.setAlpha(1);
        this.bannerTween = null;
      },
    });
  }

  render() {
    if (!this.isOpen) return;

    this.profile = getArcadeProfile() || this.profile;
    this.pageText.setText("PAGE 1/1");
    this.title.setText(`ARCADE MACHINE - ${this.getNickname() || "NEW"}`);
    this.updateInfoBox();
    this.applyModeLayout();

    if (this.mode === "game") {
      this.setRunnerVisible(true);
      this.title.setVisible(false);
      this.list.setVisible(false);
      this.pageText.setVisible(false);
      this.infoBorder.setVisible(false);
      this.infoFill.setVisible(false);
      this.infoText.setVisible(false);
      this.menuHiScoreBorder.setVisible(false);
      this.menuHiScoreFill.setVisible(false);
      this.menuHiScoreText.setVisible(false);
      this.systemBorder.setVisible(false);
      this.systemFill.setVisible(false);
      this.systemText.setVisible(false);
      this.hideConfirm();
      this.hint.setVisible(true);
      this.ensureHud(this.runner.currentGameDef || this.selectedGame);

      const msg = this.runner.currentMessage || "B: Quit";
      this.hint.setText(msg);
      return;
    }

    this.destroyHud();
    this.setRunnerVisible(false);
    this.title.setVisible(true);
    this.list.setVisible(true);
    this.pageText.setVisible(true);
    this.infoBorder.setVisible(false);
    this.infoFill.setVisible(false);
    this.infoText.setVisible(false);
    this.bannerText.setVisible(false);
    this.hint.setVisible(true);
    this.systemBorder.setVisible(this.systemActive);
    this.systemFill.setVisible(this.systemActive);
    this.systemText.setVisible(this.systemActive);

    this.updateMenuList();
    this.updateMenuHiScorePanel();

    if (this.mode === "confirm") {
      this.menuHiScoreBorder.setVisible(false);
      this.menuHiScoreFill.setVisible(false);
      this.menuHiScoreText.setVisible(false);
      this.showConfirm();
      this.hint.setText("A:Confirm  B:Back");
    } else {
      const hasSelection = !!this.selectedEntry;
      this.menuHiScoreBorder.setVisible(hasSelection);
      this.menuHiScoreFill.setVisible(hasSelection);
      this.menuHiScoreText.setVisible(hasSelection);
      this.hideConfirm();
      this.hint.setText("UP/DOWN: Select  A:Play  B:Back");
    }
  }

  stepRepeat(now, dir, onStep) {
    if (!dir) {
      this.navHoldDir = 0;
      this.navHoldNextAt = 0;
      return;
    }

    if (this.navHoldDir !== dir) {
      this.navHoldDir = dir;
      this.navHoldNextAt = now + this.navInitialDelayMs;
      onStep(dir);
      return;
    }

    if (now >= this.navHoldNextAt) {
      this.navHoldNextAt = now + this.navRepeatMs;
      onStep(dir);
    }
  }

  moveSelection(delta) {
    const next = Math.max(0, Math.min(MENU_ENTRIES.length - 1, this.selectedIndex + delta));
    if (next === this.selectedIndex) return;
    this.selectedIndex = next;
    this.runner.requestLeaderboard(this.selectedGame?.id || "", { force: false });
    this.render();
  }

  moveConfirm(delta) {
    const next = Math.max(0, Math.min(1, this.confirmChoice + delta));
    if (next === this.confirmChoice) return;
    this.confirmChoice = next;
    this.render();
  }

  launchSelectedGame(now) {
    const entry = this.selectedEntry;
    if (!entry) {
      this.mode = "menu";
      this.render();
      return;
    }

    const game = this.selectedGame;
    this.mode = "game";
    // Ensure runner gets game-mode dimensions before creating the game instance.
    this.applyModeLayout();
    this.runner.startGame(game);
    this.launchDebounceUntil = now + 200;
    this.showStartBanner(`${game.label} - B: Quit`);
    this.render();
  }

  stopGameToMenu() {
    this.runner.stopGame();
    this.mode = "menu";
    this.navHoldDir = 0;
    this.navHoldNextAt = 0;
    this.render();
  }

  tick(now, input) {
    if (!this.isOpen) return false;

    this.lastTickAt = now;
    this.updateSystemTypewriter(now);

    if (this.mode === "game") {
      if (input?.bJust) {
        this.stopGameToMenu();
        return true;
      }

      const result = this.runner.tick(now, input || {});
      const msg = result?.message || this.runner.currentMessage || "B: Quit";
      this.hint.setText(msg);
      this.ensureHud(this.runner.currentGameDef || this.selectedGame);
      return true;
    }

    if (input?.bJust) {
      if (this.mode === "confirm") {
        this.mode = "menu";
        this.render();
      } else {
        this.close();
      }
      return true;
    }

    const canSelect = now >= this.launchDebounceUntil;

    if (this.mode === "menu") {
      const dir =
        input?.up && !input?.down
          ? -1
          : input?.down && !input?.up
          ? 1
          : input?.left && !input?.right
          ? -1
          : input?.right && !input?.left
          ? 1
          : 0;
      this.stepRepeat(now, dir, (stepDir) => this.moveSelection(stepDir));

      if (this.consumeSystemAdvance(now, input)) {
        this.render();
        return true;
      }

      if (canSelect && input?.aJust) {
        this.mode = "confirm";
        this.confirmChoice = 0;
        this.render();
      }

      return true;
    }

    if (this.mode === "confirm") {
      const dir =
        input?.up && !input?.down
          ? -1
          : input?.down && !input?.up
          ? 1
          : input?.left && !input?.right
          ? -1
          : input?.right && !input?.left
          ? 1
          : 0;
      this.stepRepeat(now, dir, (stepDir) => this.moveConfirm(stepDir));

      if (this.consumeSystemAdvance(now, input)) {
        this.render();
        return true;
      }

      if (canSelect && input?.aJust) {
        if (this.confirmChoice === 0) this.launchSelectedGame(now);
        else {
          this.mode = "menu";
          this.render();
        }
      }

      return true;
    }

    return true;
  }

  destroy() {
    try {
      this.runner?.destroy?.();
    } catch {}
    try {
      this.destroyHud();
    } catch {}
    try {
      this.container?.destroy?.(true);
    } catch {}

    this.runner = null;
    this.container = null;
    this.panelWrap = null;
  }
}
