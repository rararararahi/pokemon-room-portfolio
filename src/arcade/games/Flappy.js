import Phaser from "phaser";

export default class Flappy {
  constructor() {
    this.scene = null;
    this.parent = null;
    this.root = null;

    this.width = 0;
    this.height = 0;

    this.bird = null;
    this.message = null;

    this.pipes = [];

    this.birdX = 0;
    this.birdY = 0;
    this.birdVy = 0;

    this.gravity = 315;
    this.jumpVelocity = -158;
    this.pipeSpeed = 74;
    this.pipeGap = 43;
    this.pipeSpawnEvery = 1.32;
    this.pipeTimer = 0;
    this.pipeWidth = 12;

    this.score = 0;
    this.state = "play";
    this.lastTickAt = 0;
  }

  getName() {
    return "FLAPPY";
  }

  start({ scene, container, width, height }) {
    this.scene = scene;
    this.parent = container;
    this.width = Math.max(90, Math.round(width));
    this.height = Math.max(80, Math.round(height));

    this.root = scene.add.container(0, 0);
    this.parent.add(this.root);

    const topLine = scene.add.rectangle(Math.round(this.width / 2), 2, this.width - 6, 2, 0x223347, 1).setOrigin(0.5, 0.5);
    const bottomLine = scene.add.rectangle(Math.round(this.width / 2), this.height - 2, this.width - 6, 2, 0x223347, 1).setOrigin(0.5, 0.5);

    this.bird = scene.add.rectangle(0, 0, 7, 7, 0xffdd57, 1).setOrigin(0.5, 0.5);
    this.message = scene.add.text(Math.round(this.width / 2), Math.round(this.height / 2), "", {
      fontFamily: "monospace",
      fontSize: "11px",
      color: "#f4f6ff",
      align: "center",
    }).setOrigin(0.5, 0.5);

    this.root.add([topLine, bottomLine, this.bird, this.message]);

    this.reset();
  }

  reset() {
    for (let i = 0; i < this.pipes.length; i += 1) {
      this.pipes[i].top?.destroy?.();
      this.pipes[i].bottom?.destroy?.();
    }
    this.pipes = [];

    this.birdX = Math.round(this.width * 0.28);
    this.birdY = Math.round(this.height * 0.45);
    this.birdVy = 0;

    this.score = 0;
    this.state = "play";
    this.pipeTimer = 0;
    this.lastTickAt = 0;
    this.message.setText("");

    this.bird.setPosition(this.birdX, this.birdY);
  }

  spawnPipe() {
    const minGapCenter = 20;
    const maxGapCenter = this.height - 20;
    const gapCenter = Phaser.Math.Between(minGapCenter, maxGapCenter);

    const topH = Math.max(8, Math.round(gapCenter - this.pipeGap / 2));
    const bottomY = Math.round(gapCenter + this.pipeGap / 2);
    const bottomH = Math.max(8, this.height - bottomY);

    const x = this.width + this.pipeWidth;

    const topRect = this.scene.add.rectangle(x, Math.round(topH / 2), this.pipeWidth, topH, 0x65c54f, 1)
      .setOrigin(0.5, 0.5);
    const bottomRect = this.scene.add.rectangle(
      x,
      Math.round(bottomY + bottomH / 2),
      this.pipeWidth,
      bottomH,
      0x65c54f,
      1
    ).setOrigin(0.5, 0.5);

    this.root.add([topRect, bottomRect]);

    this.pipes.push({
      x,
      topH,
      bottomY,
      bottomH,
      passed: false,
      top: topRect,
      bottom: bottomRect,
    });
  }

  collidePipe(pipe) {
    const birdHalf = 3.5;
    const birdLeft = this.birdX - birdHalf;
    const birdRight = this.birdX + birdHalf;
    const birdTop = this.birdY - birdHalf;
    const birdBottom = this.birdY + birdHalf;

    const pipeLeft = pipe.x - this.pipeWidth / 2;
    const pipeRight = pipe.x + this.pipeWidth / 2;

    const overlapsX = birdRight >= pipeLeft && birdLeft <= pipeRight;
    if (!overlapsX) return false;

    return birdTop <= pipe.topH || birdBottom >= pipe.bottomY;
  }

  setGameOver() {
    if (this.state !== "play") return;
    this.state = "gameover";
    this.message.setText("GAME OVER\nA:RETRY  B:QUIT");
  }

  tick(now, input) {
    if (!Number.isFinite(this.lastTickAt) || this.lastTickAt <= 0) {
      this.lastTickAt = now;
    }
    const dtMs = Math.min(50, Math.max(0, now - this.lastTickAt));
    this.lastTickAt = now;
    const seconds = dtMs / 1000;

    if (this.state === "gameover") {
      if (input?.aJust) this.reset();
      return { done: true, score: this.score, message: "GAME OVER" };
    }

    if (input?.aJust) {
      this.birdVy = this.jumpVelocity;
    }

    this.birdVy += this.gravity * seconds;
    this.birdY += this.birdVy * seconds;
    this.bird.setPosition(Math.round(this.birdX), Math.round(this.birdY));

    if (this.birdY < 3 || this.birdY > this.height - 3) {
      this.setGameOver();
      return { done: true, score: this.score, message: "GAME OVER" };
    }

    this.pipeTimer += seconds;
    if (this.pipeTimer >= this.pipeSpawnEvery) {
      this.pipeTimer -= this.pipeSpawnEvery;
      this.spawnPipe();
    }

    for (let i = this.pipes.length - 1; i >= 0; i -= 1) {
      const pipe = this.pipes[i];
      pipe.x -= this.pipeSpeed * seconds;

      pipe.top.setPosition(Math.round(pipe.x), Math.round(pipe.topH / 2));
      pipe.bottom.setPosition(Math.round(pipe.x), Math.round(pipe.bottomY + pipe.bottomH / 2));

      if (!pipe.passed && pipe.x + this.pipeWidth / 2 < this.birdX) {
        pipe.passed = true;
        this.score += 1;
      }

      if (this.collidePipe(pipe)) {
        this.setGameOver();
      }

      if (pipe.x < -this.pipeWidth - 8) {
        pipe.top.destroy();
        pipe.bottom.destroy();
        this.pipes.splice(i, 1);
      }
    }

    if (this.state === "gameover") {
      return { done: true, score: this.score, message: "GAME OVER" };
    }

    return { done: false, score: this.score };
  }

  destroy() {
    this.root?.destroy?.(true);
    this.root = null;
    this.bird = null;
    this.message = null;
    this.pipes = [];
  }
}
