import Phaser from "phaser";

export default class Invaders {
  constructor() {
    this.scene = null;
    this.parent = null;
    this.root = null;

    this.width = 0;
    this.height = 0;

    this.player = null;
    this.bullet = null;
    this.message = null;

    this.playerX = 0;
    this.invaders = [];
    this.invaderDir = 1;
    this.invaderSpeed = 24;
    this.invaderDrop = 8;

    this.bulletActive = false;
    this.bulletX = 0;
    this.bulletY = 0;
    this.score = 0;
    this.state = "play";

    this.exitRequested = false;
  }

  start({ scene, container, width, height }) {
    this.scene = scene;
    this.parent = container;
    this.width = Math.max(90, Math.round(width));
    this.height = Math.max(70, Math.round(height));

    this.root = scene.add.container(0, 0);
    this.parent.add(this.root);

    this.playerX = Math.round(this.width / 2);
    this.player = scene.add.rectangle(this.playerX, this.height - 8, 12, 5, 0x6ce18d, 1).setOrigin(0.5, 0.5);
    this.bullet = scene.add.rectangle(-100, -100, 2, 5, 0xf4f6ff, 1).setOrigin(0.5, 0.5);
    this.message = scene.add.text(this.width / 2, this.height / 2, "", {
      fontFamily: "monospace",
      fontSize: "11px",
      color: "#f4f6ff",
      align: "center",
    }).setOrigin(0.5, 0.5);

    this.root.add([this.player, this.bullet, this.message]);

    this.invaders = [];
    const cols = 6;
    const rows = 3;
    const cellX = 18;
    const cellY = 14;
    const startX = Math.round((this.width - (cols - 1) * cellX) / 2);
    const startY = 18;

    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const x = startX + c * cellX;
        const y = startY + r * cellY;
        const rect = scene.add.rectangle(x, y, 10, 6, 0xffcf5a, 1).setOrigin(0.5, 0.5);
        this.invaders.push({ x, y, alive: true, rect });
        this.root.add(rect);
      }
    }

    this.invaderDir = 1;
    this.invaderSpeed = 24;
    this.invaderDrop = 8;
    this.bulletActive = false;
    this.score = 0;
    this.state = "play";
    this.exitRequested = false;
    this.message.setText("");
    this.syncBullet();
  }

  update(dt, input) {
    const seconds = Math.min(0.05, Math.max(0, dt) / 1000);

    if (this.state !== "play") {
      if (input?.aJust) this.exitRequested = true;
      return;
    }

    const moveSpeed = 118;
    if (input?.left) this.playerX -= moveSpeed * seconds;
    if (input?.right) this.playerX += moveSpeed * seconds;
    this.playerX = Phaser.Math.Clamp(this.playerX, 10, this.width - 10);
    this.player.setPosition(this.playerX, this.height - 8);

    if (input?.aJust && !this.bulletActive) {
      this.bulletActive = true;
      this.bulletX = this.playerX;
      this.bulletY = this.height - 14;
    }

    if (this.bulletActive) {
      this.bulletY -= 180 * seconds;
      if (this.bulletY < -8) this.bulletActive = false;
    }

    const dx = this.invaderDir * this.invaderSpeed * seconds;
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;

    for (let i = 0; i < this.invaders.length; i += 1) {
      const inv = this.invaders[i];
      if (!inv.alive) continue;
      inv.x += dx;
      if (inv.x < minX) minX = inv.x;
      if (inv.x > maxX) maxX = inv.x;
    }

    if (Number.isFinite(minX) && Number.isFinite(maxX)) {
      if (minX <= 8 || maxX >= this.width - 8) {
        this.invaderDir *= -1;
        for (let i = 0; i < this.invaders.length; i += 1) {
          const inv = this.invaders[i];
          if (!inv.alive) continue;
          inv.y += this.invaderDrop;
        }
      }
    }

    if (this.bulletActive) {
      for (let i = 0; i < this.invaders.length; i += 1) {
        const inv = this.invaders[i];
        if (!inv.alive) continue;
        if (
          Math.abs(this.bulletX - inv.x) <= 6 &&
          Math.abs(this.bulletY - inv.y) <= 5
        ) {
          inv.alive = false;
          inv.rect.setVisible(false);
          this.bulletActive = false;
          this.score += 10;
          break;
        }
      }
    }

    let living = 0;
    let reachedBottom = false;
    for (let i = 0; i < this.invaders.length; i += 1) {
      const inv = this.invaders[i];
      if (!inv.alive) continue;
      living += 1;
      if (inv.y >= this.height - 18) reachedBottom = true;
      inv.rect.setPosition(inv.x, inv.y);
    }

    if (living <= 0) {
      this.state = "win";
      this.message.setText("YOU WIN\nA: MENU");
    } else if (reachedBottom) {
      this.state = "lose";
      this.message.setText("GAME OVER\nA: MENU");
    }

    this.syncBullet();
  }

  syncBullet() {
    if (this.bulletActive) {
      this.bullet.setVisible(true);
      this.bullet.setPosition(this.bulletX, this.bulletY);
    } else {
      this.bullet.setVisible(false);
      this.bullet.setPosition(-100, -100);
    }
  }

  getHudText() {
    if (this.state === "play") return `INVADERS  SCORE:${this.score}  A:FIRE B:QUIT`;
    return "INVADERS  B:QUIT";
  }

  consumeExitRequest() {
    if (!this.exitRequested) return false;
    this.exitRequested = false;
    return true;
  }

  destroy() {
    this.root?.destroy?.(true);
    this.root = null;
    this.player = null;
    this.bullet = null;
    this.message = null;
    this.invaders = [];
  }
}
