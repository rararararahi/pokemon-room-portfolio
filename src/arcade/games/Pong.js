import Phaser from "phaser";

export default class Pong {
  constructor() {
    this.scene = null;
    this.parent = null;
    this.root = null;

    this.width = 0;
    this.height = 0;

    this.aiPaddle = null;
    this.playerPaddle = null;
    this.ball = null;
    this.scoreText = null;
    this.message = null;

    this.playerY = 0;
    this.aiY = 0;
    this.ballX = 0;
    this.ballY = 0;
    this.ballVx = 0;
    this.ballVy = 0;
    this.ballStopped = false;

    this.scorePoints = 0;
    this.lives = 3;
    this.state = "play";
    this.lastTickAt = 0;

    this.baseBallSpeed = 148;
    this.maxBallSpeed = 240;
  }

  getName() {
    return "PONG";
  }

  start({ scene, container, width, height }) {
    this.scene = scene;
    this.parent = container;
    this.width = Math.max(80, Math.round(width));
    this.height = Math.max(60, Math.round(height));

    this.root = scene.add.container(0, 0);
    this.parent.add(this.root);

    const centerLine = scene.add.rectangle(Math.round(this.width / 2), Math.round(this.height / 2), 2, this.height - 8, 0x1f3045, 1)
      .setOrigin(0.5, 0.5);
    this.aiPaddle = scene.add.rectangle(8, Math.round(this.height / 2), 4, 22, 0x9db3c8, 1).setOrigin(0.5, 0.5);
    this.playerPaddle = scene.add.rectangle(this.width - 8, Math.round(this.height / 2), 4, 22, 0x9db3c8, 1).setOrigin(0.5, 0.5);
    this.ball = scene.add.rectangle(Math.round(this.width / 2), Math.round(this.height / 2), 4, 4, 0xf8f8f8, 1).setOrigin(0.5, 0.5);
    this.scoreText = scene.add.text(Math.round(this.width / 2), 6, "SCORE: 0  LIVES: 3", {
      fontFamily: "monospace",
      fontSize: "10px",
      color: "#dbe8ff",
    }).setOrigin(0.5, 0);
    this.message = scene.add.text(Math.round(this.width / 2), Math.round(this.height / 2), "", {
      fontFamily: "monospace",
      fontSize: "11px",
      color: "#dbe8ff",
      align: "center",
    }).setOrigin(0.5, 0.5);

    this.root.add([centerLine, this.aiPaddle, this.playerPaddle, this.ball, this.scoreText, this.message]);

    this.reset();
  }

  reset() {
    this.playerY = this.height / 2;
    this.aiY = this.height / 2;
    this.scorePoints = 0;
    this.lives = 3;
    this.state = "play";
    this.lastTickAt = 0;
    this.resetBall(Math.random() < 0.5 ? -1 : 1, true);
    this.message.setText("A:SERVE");
    this.syncVisuals();
  }

  currentBallSpeed() {
    return Math.hypot(this.ballVx, this.ballVy);
  }

  resetBall(dir, stopped = false) {
    this.ballX = this.width / 2;
    this.ballY = this.height / 2;
    this.ballStopped = !!stopped;
    if (this.ballStopped) {
      this.ballVx = 0;
      this.ballVy = 0;
      return;
    }

    this.ballVx = this.baseBallSpeed * (dir < 0 ? -1 : 1);
    const vy = Phaser.Math.Between(-78, 78);
    this.ballVy = vy === 0 ? 28 : vy;
  }

  bumpBallSpeedOnHit() {
    const speed = this.currentBallSpeed();
    const boosted = Math.min(this.maxBallSpeed, speed * 1.06);
    if (speed <= 0) return;
    const scale = boosted / speed;
    this.ballVx *= scale;
    this.ballVy *= scale;
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
      this.syncVisuals();
      return { done: true, score: this.scorePoints, message: "GAME OVER" };
    }

    const paddleHalf = 11;

    const moveSpeed = 132;
    if (input?.up) this.playerY -= moveSpeed * seconds;
    if (input?.down) this.playerY += moveSpeed * seconds;
    this.playerY = Phaser.Math.Clamp(this.playerY, 4 + paddleHalf, this.height - 4 - paddleHalf);

    const aiTarget = this.ballY;
    const aiSpeed = 112;
    if (this.aiY < aiTarget - 2) this.aiY += aiSpeed * seconds;
    else if (this.aiY > aiTarget + 2) this.aiY -= aiSpeed * seconds;
    this.aiY = Phaser.Math.Clamp(this.aiY, 4 + paddleHalf, this.height - 4 - paddleHalf);

    if (this.ballStopped) {
      if (input?.aJust) {
        this.resetBall(Math.random() < 0.5 ? -1 : 1, false);
        this.message.setText("");
      }
      this.syncVisuals();
      return { done: false, score: this.scorePoints, message: "A:SERVE" };
    }

    this.ballX += this.ballVx * seconds;
    this.ballY += this.ballVy * seconds;

    if (this.ballY <= 2) {
      this.ballY = 2;
      this.ballVy *= -1;
    } else if (this.ballY >= this.height - 2) {
      this.ballY = this.height - 2;
      this.ballVy *= -1;
    }

    const paddleH = 22;
    const paddleW = 4;
    const ballSize = 4;

    const aiLeft = 8 - paddleW / 2;
    const aiTop = this.aiY - paddleH / 2;
    const playerLeft = this.width - 8 - paddleW / 2;
    const playerTop = this.playerY - paddleH / 2;
    const ballLeft = this.ballX - ballSize / 2;
    const ballTop = this.ballY - ballSize / 2;

    if (
      this.ballVx < 0 &&
      ballLeft <= aiLeft + paddleW &&
      ballLeft + ballSize >= aiLeft &&
      ballTop + ballSize >= aiTop &&
      ballTop <= aiTop + paddleH
    ) {
      this.ballX = aiLeft + paddleW + ballSize / 2;
      this.ballVx = Math.abs(this.ballVx);
      const offset = (this.ballY - this.aiY) / (paddleH / 2);
      this.ballVy += offset * 28;
      this.bumpBallSpeedOnHit();
    }

    if (
      this.ballVx > 0 &&
      ballLeft + ballSize >= playerLeft &&
      ballLeft <= playerLeft + paddleW &&
      ballTop + ballSize >= playerTop &&
      ballTop <= playerTop + paddleH
    ) {
      this.ballX = playerLeft - ballSize / 2;
      this.ballVx = -Math.abs(this.ballVx);
      const offset = (this.ballY - this.playerY) / (paddleH / 2);
      this.ballVy += offset * 28;
      this.bumpBallSpeedOnHit();
    }

    if (this.ballX < -6) {
      this.scorePoints += 1;
      this.resetBall(1, true);
      this.message.setText("A:SERVE");
    } else if (this.ballX > this.width + 6) {
      this.lives = Math.max(0, this.lives - 1);
      if (this.lives <= 0) {
        this.state = "gameover";
        this.ballStopped = true;
        this.ballVx = 0;
        this.ballVy = 0;
        this.message.setText(`GAME OVER\nFINAL SCORE: ${this.scorePoints}\nA:RETRY  B:QUIT`);
      } else {
        this.resetBall(-1, true);
        this.message.setText("A:SERVE");
      }
    }

    this.syncVisuals();
    return { done: this.state === "gameover", score: this.scorePoints, message: this.state === "gameover" ? "GAME OVER" : "" };
  }

  syncVisuals() {
    this.aiPaddle.setPosition(8, Math.round(this.aiY));
    this.playerPaddle.setPosition(this.width - 8, Math.round(this.playerY));
    this.ball.setPosition(Math.round(this.ballX), Math.round(this.ballY));
    this.scoreText.setText(`SCORE: ${this.scorePoints}  LIVES: ${this.lives}`);
  }

  destroy() {
    this.root?.destroy?.(true);
    this.root = null;
    this.aiPaddle = null;
    this.playerPaddle = null;
    this.ball = null;
    this.scoreText = null;
    this.message = null;
  }
}
