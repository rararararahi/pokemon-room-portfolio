import {
  getArcadeNickname,
  getLeaderboard as readLeaderboard,
  submitScore as submitLeaderboardScore,
} from "./ArcadePersistence";

export default class ArcadeGameRunner {
  constructor(scene, parentContainer) {
    this.scene = scene;
    this.parentContainer = parentContainer;

    this.currentGame = null;
    this.currentGameDef = null;
    this.currentScore = 0;
    this.currentMessage = "";
    this.lastDoneState = false;
    this.leaderboardCache = {};

    this.gameWidth = 0;
    this.gameHeight = 0;

    this.frameBorder = scene.add.rectangle(0, 0, 10, 10, 0x111111).setOrigin(0, 0);
    this.frameFill = scene.add.rectangle(0, 0, 10, 10, 0x060b14).setOrigin(0, 0);
    this.gameContainer = scene.add.container(0, 0);

    this.parentContainer.add([this.frameBorder, this.frameFill, this.gameContainer]);
  }

  layout(x, y, width, height) {
    const w = Math.max(80, Math.round(width));
    const h = Math.max(60, Math.round(height));
    const border = 3;

    this.frameBorder.setPosition(Math.round(x), Math.round(y));
    this.frameBorder.setSize(w, h);

    this.frameFill.setPosition(Math.round(x + border), Math.round(y + border));
    this.frameFill.setSize(Math.max(10, w - border * 2), Math.max(10, h - border * 2));

    const innerX = Math.round(x + border);
    const innerY = Math.round(y + border);
    const innerW = Math.max(10, Math.round(w - border * 2));
    const innerH = Math.max(10, Math.round(h - border * 2));

    this.gameContainer.setPosition(innerX, innerY);

    const changed = innerW !== this.gameWidth || innerH !== this.gameHeight;
    this.gameWidth = innerW;
    this.gameHeight = innerH;

    if (changed && this.currentGame && typeof this.currentGame.resize === "function") {
      this.currentGame.resize(innerW, innerH);
    }
  }

  getBestScore(gameId) {
    const leaderboard = this.getLeaderboard(gameId);
    if (!leaderboard.length) return 0;
    return Math.max(0, Number(leaderboard[0]?.score || 0));
  }

  getLeaderboard(gameId) {
    const key = String(gameId || "").toLowerCase();
    if (!key) return [];
    if (!this.leaderboardCache[key]) {
      this.leaderboardCache[key] = readLeaderboard(key);
    }
    return this.leaderboardCache[key];
  }

  refreshLeaderboard(gameId) {
    const key = String(gameId || "").toLowerCase();
    if (!key) return [];
    const next = readLeaderboard(key);
    this.leaderboardCache[key] = next;
    return next;
  }

  getCurrentBestScore() {
    const gameId = this.currentGameDef?.id;
    if (!gameId) return 0;
    return this.getBestScore(gameId);
  }

  submitCurrentScore() {
    const gameId = this.currentGameDef?.id;
    if (!gameId) return;
    if (!Number.isFinite(this.currentScore) || this.currentScore <= 0) return;
    const nickname = getArcadeNickname() || "PLAYER";
    submitLeaderboardScore(gameId, nickname, this.currentScore);
    this.refreshLeaderboard(gameId);
  }

  getCurrentGameName() {
    if (this.currentGame && typeof this.currentGame.getName === "function") {
      return this.currentGame.getName() || this.currentGameDef?.label || "GAME";
    }
    return this.currentGameDef?.label || "GAME";
  }

  startGame(gameDef) {
    this.stopGame();

    this.currentGameDef = gameDef || null;
    this.currentGame = typeof gameDef?.createGame === "function" ? gameDef.createGame() : null;
    this.currentScore = 0;
    this.currentMessage = "";
    this.lastDoneState = false;

    if (this.currentGame && typeof this.currentGame.start === "function") {
      this.currentGame.start({
        scene: this.scene,
        container: this.gameContainer,
        width: this.gameWidth,
        height: this.gameHeight,
      });
    }

    if (this.currentGame && typeof this.currentGame.reset === "function") {
      this.currentGame.reset();
    }
  }

  stopGame() {
    if (this.currentGameDef?.id && !this.lastDoneState && this.currentScore > 0) {
      this.submitCurrentScore();
    }

    if (this.currentGame && typeof this.currentGame.destroy === "function") {
      try {
        this.currentGame.destroy();
      } catch {}
    }

    this.currentGame = null;
    this.currentGameDef = null;
    this.currentScore = 0;
    this.currentMessage = "";
    this.lastDoneState = false;

    if (this.gameContainer) {
      this.gameContainer.removeAll(true);
    }
  }

  tick(now, input) {
    if (!this.currentGame || typeof this.currentGame.tick !== "function") {
      return {
        running: false,
        done: false,
        score: 0,
        best: 0,
        message: "",
        gameName: "",
      };
    }

    const result = this.currentGame.tick(now, input) || {};

    const score = Number.isFinite(result.score) ? Math.max(0, Math.floor(result.score)) : this.currentScore;
    this.currentScore = score;

    this.currentMessage = typeof result.message === "string" ? result.message : "";
    const done = !!result.done;

    if (done && !this.lastDoneState) {
      this.submitCurrentScore();
    }
    this.lastDoneState = done;

    return {
      running: true,
      done,
      score: this.currentScore,
      best: this.getCurrentBestScore(),
      message: this.currentMessage,
      gameName: this.getCurrentGameName(),
    };
  }

  hasRunningGame() {
    return !!this.currentGame;
  }

  destroy() {
    this.stopGame();
    try {
      this.frameBorder?.destroy?.();
      this.frameFill?.destroy?.();
      this.gameContainer?.destroy?.(true);
    } catch {}
    this.frameBorder = null;
    this.frameFill = null;
    this.gameContainer = null;
  }
}
