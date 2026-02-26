import Phaser from "phaser";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export default class BrickBreaker {
  constructor() {
    this.scene = null;
    this.parent = null;
    this.root = null;

    this.width = 0;
    this.height = 0;

    this.paddle = null;
    this.hud = null;
    this.message = null;

    this.paddleX = 0;
    this.paddleY = 0;
    this.paddleW = 24;
    this.paddleH = 4;
    this.paddleSpeed = 176;

    this.baseBallSpeed = 158;
    this.ballSpeed = this.baseBallSpeed;
    this.ballRadius = 3;
    this.maxBallSpeed = 240;

    this.balls = [];
    this.bricks = [];
    this.pickups = [];

    this.score = 0;
    this.lives = 3;
    this.level = 1;
    this.state = "serve";
    this.lastTickAt = 0;

    this.superBreakerUntil = 0;
    this.superBreakerWallReset = false;
    this.powerupChance = 0.12;
    this.maxActivePickups = 2;
    this.pickupSize = 28;
  }

  getName() {
    return "BRICK BREAKER";
  }

  submitScoreOnStop() {
    return false;
  }

  start({ scene, container, width, height }) {
    this.scene = scene;
    this.parent = container;
    this.width = Math.max(96, Math.round(width));
    this.height = Math.max(80, Math.round(height));

    this.root = scene.add.container(0, 0);
    this.parent.add(this.root);

    const topLine = scene.add.rectangle(Math.round(this.width / 2), 2, this.width - 6, 2, 0x223347, 1).setOrigin(0.5, 0.5);
    const bottomLine = scene.add.rectangle(Math.round(this.width / 2), this.height - 2, this.width - 6, 2, 0x223347, 1).setOrigin(0.5, 0.5);
    this.paddle = scene.add.rectangle(0, 0, this.paddleW, this.paddleH, 0x9db3c8, 1).setOrigin(0.5, 0.5);
    this.hud = scene.add.text(4, 4, "", {
      fontFamily: "monospace",
      fontSize: "9px",
      color: "#dbe8ff",
    }).setOrigin(0, 0);
    this.message = scene.add.text(Math.round(this.width / 2), Math.round(this.height / 2), "", {
      fontFamily: "monospace",
      fontSize: "11px",
      color: "#f4f6ff",
      align: "center",
    }).setOrigin(0.5, 0.5);

    this.root.add([topLine, bottomLine, this.paddle, this.hud, this.message]);
    this.reset();
  }

  reset() {
    this.clearBricks();
    this.clearPickups();
    this.clearBalls();
    this.score = 0;
    this.lives = 3;
    this.level = 1;
    this.state = "serve";
    this.lastTickAt = 0;
    this.superBreakerUntil = 0;
    this.superBreakerWallReset = false;
    this.ballSpeed = this.baseBallSpeed;
    this.paddleX = Math.round(this.width / 2);
    this.paddleY = this.height - 8;
    this.buildLevelBricks();
    this.resetBallOnPaddle();
    this.message.setText("A:LAUNCH");
    this.syncHud();
  }

  clearBricks() {
    for (let i = 0; i < this.bricks.length; i += 1) {
      this.bricks[i]?.rect?.destroy?.();
    }
    this.bricks = [];
  }

  clearPickups() {
    for (let i = 0; i < this.pickups.length; i += 1) {
      this.pickups[i]?.rect?.destroy?.();
      this.pickups[i]?.label?.destroy?.();
    }
    this.pickups = [];
  }

  clearBalls() {
    for (let i = 0; i < this.balls.length; i += 1) {
      this.balls[i]?.sprite?.destroy?.();
    }
    this.balls = [];
  }

  createBall(x, y, vx = 0, vy = 0) {
    const sprite = this.scene.add.rectangle(Math.round(x), Math.round(y), this.ballRadius * 2, this.ballRadius * 2, 0xf4f6ff, 1).setOrigin(0.5, 0.5);
    this.root.add(sprite);
    const ball = {
      x,
      y,
      vx,
      vy,
      sprite,
      superBreakerActive: false,
      superBreakerHasBrokenBrick: false,
      superBreakerUntil: 0,
    };
    this.balls.push(ball);
    this.syncBallVisual(ball);
    return ball;
  }

  syncBallVisual(ball) {
    const superActive = this.isBallSuperBreakerActive(ball, this.lastTickAt || 0);
    ball.sprite.setFillStyle(superActive ? 0xff6be0 : 0xf4f6ff, 1);
    ball.sprite.setPosition(Math.round(ball.x), Math.round(ball.y));
  }

  normalizeBallSpeed(ball, desiredSpeed = this.ballSpeed) {
    const speed = Math.hypot(ball.vx, ball.vy);
    if (speed <= 0.001) {
      ball.vx = desiredSpeed * (Math.random() < 0.5 ? -0.5 : 0.5);
      ball.vy = -Math.abs(desiredSpeed * 0.85);
      return;
    }
    const clampedTarget = clamp(desiredSpeed, 88, this.maxBallSpeed);
    const scale = clampedTarget / speed;
    ball.vx *= scale;
    ball.vy *= scale;
  }

  makeFilledPatternGrid(rows, cols) {
    return Array.from({ length: rows }, () => Array(cols).fill(1));
  }

  mirrorPatternGrid(grid) {
    return grid.map((row) => row.slice().reverse());
  }

  carveVerticalTunnel(grid, col, width = 1) {
    const rows = grid.length;
    const cols = rows > 0 ? grid[0].length : 0;
    if (rows <= 0 || cols <= 0) return;
    const safeWidth = clamp(Math.floor(width), 1, cols);
    const startCol = clamp(Math.floor(col), 0, cols - safeWidth);
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < safeWidth; c += 1) {
        grid[r][startCol + c] = 0;
      }
    }
  }

  carveWindow(grid, row, col, width = 2) {
    const rows = grid.length;
    const cols = rows > 0 ? grid[0].length : 0;
    if (rows <= 0 || cols <= 0) return;
    const safeRow = clamp(Math.floor(row), 0, rows - 1);
    const safeWidth = clamp(Math.floor(width), 1, cols);
    const startCol = clamp(Math.floor(col), 0, cols - safeWidth);
    for (let c = 0; c < safeWidth; c += 1) {
      grid[safeRow][startCol + c] = 0;
    }
  }

  getBrickPatterns(rows, cols) {
    const patterns = [];
    const mid = Math.floor(cols / 2);
    const quarter = clamp(Math.floor(cols * 0.25), 1, Math.max(1, cols - 2));
    const threeQuarter = clamp(Math.floor(cols * 0.75), 1, Math.max(1, cols - 2));
    const safeWindowW = cols >= 8 ? 2 : 1;

    // Pattern: Side Tunnel
    const sideTunnel = this.makeFilledPatternGrid(rows, cols);
    this.carveVerticalTunnel(sideTunnel, 1, 1);
    for (let r = 1; r < rows; r += 2) {
      this.carveWindow(sideTunnel, r, mid - 1, safeWindowW);
    }
    patterns.push({ name: "Side Tunnel", grid: sideTunnel });

    // Pattern: Side Tunnel Mirror
    patterns.push({ name: "Side Tunnel Mirror", grid: this.mirrorPatternGrid(sideTunnel) });

    // Pattern: Double Window
    const doubleWindow = this.makeFilledPatternGrid(rows, cols);
    this.carveVerticalTunnel(doubleWindow, mid - 1, cols >= 9 ? 2 : 1);
    for (let r = 1; r < rows; r += 2) {
      this.carveWindow(doubleWindow, r, 1, safeWindowW);
      this.carveWindow(doubleWindow, r, cols - 1 - safeWindowW, safeWindowW);
    }
    patterns.push({ name: "Double Window", grid: doubleWindow });

    // Pattern: Zigzag Gate
    const zigzagGate = this.makeFilledPatternGrid(rows, cols);
    this.carveVerticalTunnel(zigzagGate, quarter, 1);
    for (let r = 0; r < rows; r += 1) {
      const c = clamp(mid + (r % 2 === 0 ? -1 : 1), 1, Math.max(1, cols - 2));
      zigzagGate[r][c] = 0;
      if (r % 3 === 0) this.carveWindow(zigzagGate, r, c - 1, safeWindowW);
    }
    patterns.push({ name: "Zigzag Gate", grid: zigzagGate });

    // Pattern: Stagger Grid
    const staggerGrid = this.makeFilledPatternGrid(rows, cols);
    this.carveVerticalTunnel(staggerGrid, mid, 1);
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        if ((r + c) % 3 === 0 && c !== mid) staggerGrid[r][c] = 0;
      }
    }
    patterns.push({ name: "Stagger Grid", grid: staggerGrid });

    // Pattern: Split Canyon
    const splitCanyon = this.makeFilledPatternGrid(rows, cols);
    this.carveVerticalTunnel(splitCanyon, quarter, 1);
    this.carveVerticalTunnel(splitCanyon, threeQuarter, 1);
    for (let r = 1; r < rows; r += 2) {
      this.carveWindow(splitCanyon, r, mid - 1, safeWindowW);
    }
    patterns.push({ name: "Split Canyon", grid: splitCanyon });

    // Pattern: Diagonal Window
    const diagonalWindow = this.makeFilledPatternGrid(rows, cols);
    this.carveVerticalTunnel(diagonalWindow, mid, 1);
    for (let r = 0; r < rows; r += 1) {
      const c = clamp((r * 2 + 1) % cols, 1, Math.max(1, cols - 2));
      diagonalWindow[r][c] = 0;
      if (r % 2 === 0) this.carveWindow(diagonalWindow, r, c - 1, safeWindowW);
    }
    patterns.push({ name: "Diagonal Window", grid: diagonalWindow });

    // Pattern: Ladder Tunnel
    const ladderTunnel = this.makeFilledPatternGrid(rows, cols);
    this.carveVerticalTunnel(ladderTunnel, cols - 2, 1);
    for (let r = 0; r < rows; r += 1) {
      if (r % 2 === 1) {
        for (let c = 1; c < cols - 1; c += 3) {
          ladderTunnel[r][c] = 0;
        }
      }
    }
    patterns.push({ name: "Ladder Tunnel", grid: ladderTunnel });

    // Pattern: Triple Window Dense
    const tripleWindowDense = this.makeFilledPatternGrid(rows, cols);
    this.carveVerticalTunnel(tripleWindowDense, mid, 1);
    for (let r = 0; r < rows; r += 2) {
      this.carveWindow(tripleWindowDense, r, 1, safeWindowW);
      this.carveWindow(tripleWindowDense, r, mid - 1, safeWindowW);
      this.carveWindow(tripleWindowDense, r, cols - 1 - safeWindowW, safeWindowW);
    }
    patterns.push({ name: "Triple Window Dense", grid: tripleWindowDense });

    // Pattern: Cross Channels
    const crossChannels = this.makeFilledPatternGrid(rows, cols);
    this.carveVerticalTunnel(crossChannels, quarter, 1);
    this.carveVerticalTunnel(crossChannels, mid, 1);
    for (let r = 1; r < rows; r += 3) {
      this.carveWindow(crossChannels, r, 1, cols - 2);
    }
    patterns.push({ name: "Cross Channels", grid: crossChannels });

    return patterns;
  }

  pickPatternForLevel(patterns) {
    if (!patterns.length) return null;
    const earlyIndex = clamp(this.level - 1, 0, patterns.length - 1);
    if (this.level <= patterns.length) return patterns[earlyIndex];
    const tailStart = Math.max(0, patterns.length - 3);
    const tailIndex = tailStart + ((this.level - patterns.length - 1) % (patterns.length - tailStart || 1));
    return patterns[tailIndex] || patterns[patterns.length - 1];
  }

  buildLevelBricks() {
    this.clearBricks();
    const rows = clamp(4 + Math.floor((this.level - 1) / 2), 4, 7);
    const cols = clamp(Math.floor((this.width - 14) / 14), 6, 10);
    const gap = 2;
    const top = 16;
    const sidePad = 6;
    const usableW = this.width - sidePad * 2 - gap * (cols - 1);
    const brickW = Math.max(8, Math.floor(usableW / cols));
    const brickH = 6;
    const patterns = this.getBrickPatterns(rows, cols);
    const selectedPattern = this.pickPatternForLevel(patterns);
    const grid = selectedPattern?.grid || this.makeFilledPatternGrid(rows, cols);

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        if (!grid[row]?.[col]) continue;
        const x = sidePad + brickW / 2 + col * (brickW + gap);
        const y = top + brickH / 2 + row * (brickH + gap);
        const colorShift = (row + col + this.level) % 4;
        const color = [0x6f95ff, 0x57e3ff, 0x74e47f, 0xffd95d][colorShift];
        const rect = this.scene.add.rectangle(Math.round(x), Math.round(y), brickW, brickH, color, 1).setOrigin(0.5, 0.5);
        this.root.add(rect);
        this.bricks.push({ x, y, w: brickW, h: brickH, alive: true, rect });
      }
    }

    this.ballSpeed = clamp(this.baseBallSpeed + (this.level - 1) * 8, this.baseBallSpeed, this.maxBallSpeed);
  }

  isBallSuperBreakerActive(ball, now) {
    if (!ball?.superBreakerActive) return false;
    if (!ball.superBreakerHasBrokenBrick) return true;
    const stillTimed = Number(now) < Number(ball.superBreakerUntil || 0);
    if (stillTimed) return true;
    ball.superBreakerActive = false;
    ball.superBreakerHasBrokenBrick = false;
    ball.superBreakerUntil = 0;
    return false;
  }

  resetBallOnPaddle() {
    this.clearBalls();
    const ball = this.createBall(this.paddleX, this.paddleY - this.ballRadius - 2, 0, 0);
    this.normalizeBallSpeed(ball, this.ballSpeed);
    ball.vx = 0;
    ball.vy = 0;
  }

  launchBall(input) {
    if (!this.balls.length) this.resetBallOnPaddle();
    const ball = this.balls[0];
    const aim = input?.left && !input?.right ? -0.5 : input?.right && !input?.left ? 0.5 : (Math.random() * 1.2 - 0.6);
    ball.vx = aim * this.ballSpeed;
    ball.vy = -Math.sqrt(Math.max(1, this.ballSpeed * this.ballSpeed - ball.vx * ball.vx));
    this.state = "play";
    this.message.setText("");
    this.normalizeBallSpeed(ball, this.ballSpeed);
  }

  spawnPowerup(x, y) {
    if (this.pickups.length >= this.maxActivePickups) return;
    if (Math.random() > this.powerupChance) return;
    const type = Math.random() < 0.5 ? "multiball" : "super";
    const rect = this.scene.add.rectangle(
      Math.round(x),
      Math.round(y),
      this.pickupSize,
      this.pickupSize,
      type === "multiball" ? 0x6bc9ff : 0xff6be0,
      1,
    ).setOrigin(0.5, 0.5);
    const label = this.scene.add.text(Math.round(x), Math.round(y), type === "multiball" ? "M" : "S", {
      fontFamily: "monospace",
      fontSize: "12px",
      color: "#111111",
    }).setOrigin(0.5, 0.5);
    this.root.add([rect, label]);
    this.pickups.push({
      type,
      x,
      y,
      vy: 54,
      rect,
      label,
    });
  }

  applyPowerup(type, now) {
    if (type === "multiball") {
      if (!this.balls.length) return;
      if (this.balls.length >= 2) return;
      const source = this.balls[0];
      const clone = this.createBall(source.x, source.y, -source.vx, source.vy);
      if (this.isBallSuperBreakerActive(source, now)) {
        clone.superBreakerActive = true;
        clone.superBreakerHasBrokenBrick = !!source.superBreakerHasBrokenBrick;
        clone.superBreakerUntil = source.superBreakerUntil;
      }
      if (Math.abs(clone.vx) < 26) clone.vx = clone.vx < 0 ? -26 : 26;
      this.normalizeBallSpeed(clone, this.ballSpeed);
      return;
    }

    if (type === "super") {
      for (let i = 0; i < this.balls.length; i += 1) {
        const ball = this.balls[i];
        ball.superBreakerActive = true;
        ball.superBreakerHasBrokenBrick = false;
        ball.superBreakerUntil = now + 7000;
      }
      return;
    }
  }

  updatePickups(seconds, now) {
    if (!this.pickups.length) return;
    const pickupHalf = this.pickupSize / 2;
    const paddleLeft = this.paddleX - this.paddleW / 2;
    const paddleRight = this.paddleX + this.paddleW / 2;
    const paddleTop = this.paddleY - this.paddleH / 2;
    const paddleBottom = this.paddleY + this.paddleH / 2;

    for (let i = this.pickups.length - 1; i >= 0; i -= 1) {
      const pickup = this.pickups[i];
      pickup.y += pickup.vy * seconds;
      pickup.rect.setPosition(Math.round(pickup.x), Math.round(pickup.y));
      pickup.label.setPosition(Math.round(pickup.x), Math.round(pickup.y));

      const left = pickup.x - pickupHalf;
      const right = pickup.x + pickupHalf;
      const top = pickup.y - pickupHalf;
      const bottom = pickup.y + pickupHalf;
      const caught =
        right >= paddleLeft &&
        left <= paddleRight &&
        bottom >= paddleTop &&
        top <= paddleBottom;
      if (caught) {
        this.applyPowerup(pickup.type, now);
        pickup.rect.destroy();
        pickup.label.destroy();
        this.pickups.splice(i, 1);
        continue;
      }

      if (pickup.y > this.height + 8) {
        pickup.rect.destroy();
        pickup.label.destroy();
        this.pickups.splice(i, 1);
      }
    }
  }

  resolvePaddleBounce(ball) {
    const paddleTop = this.paddleY - this.paddleH / 2;
    const paddleLeft = this.paddleX - this.paddleW / 2;
    const paddleRight = this.paddleX + this.paddleW / 2;
    const left = ball.x - this.ballRadius;
    const right = ball.x + this.ballRadius;
    const top = ball.y - this.ballRadius;
    const bottom = ball.y + this.ballRadius;
    const hit =
      ball.vy > 0 &&
      right >= paddleLeft &&
      left <= paddleRight &&
      bottom >= paddleTop &&
      top <= this.paddleY + this.paddleH / 2;
    if (!hit) return;

    ball.y = paddleTop - this.ballRadius;
    const offset = clamp((ball.x - this.paddleX) / (this.paddleW / 2), -1, 1);
    const bounceSpeedFloor = Math.min(this.maxBallSpeed, this.baseBallSpeed + 8);
    const targetSpeed = clamp(Math.hypot(ball.vx, ball.vy), bounceSpeedFloor, this.maxBallSpeed);
    ball.vx = offset * targetSpeed * 0.92;
    if (Math.abs(ball.vx) < 20) {
      ball.vx = (offset < 0 ? -1 : 1) * 20;
    }
    ball.vy = -Math.sqrt(Math.max(1, targetSpeed * targetSpeed - ball.vx * ball.vx));
    this.normalizeBallSpeed(ball, targetSpeed);
  }

  resolveBrickCollision(ball, now) {
    if (!this.bricks.length) return;
    const superActive = this.isBallSuperBreakerActive(ball, now);
    for (let i = this.bricks.length - 1; i >= 0; i -= 1) {
      const brick = this.bricks[i];
      if (!brick.alive) continue;

      const left = brick.x - brick.w / 2;
      const right = brick.x + brick.w / 2;
      const top = brick.y - brick.h / 2;
      const bottom = brick.y + brick.h / 2;
      const ballLeft = ball.x - this.ballRadius;
      const ballRight = ball.x + this.ballRadius;
      const ballTop = ball.y - this.ballRadius;
      const ballBottom = ball.y + this.ballRadius;
      const overlap = ballRight >= left && ballLeft <= right && ballBottom >= top && ballTop <= bottom;
      if (!overlap) continue;

      brick.alive = false;
      brick.rect.destroy();
      this.bricks.splice(i, 1);
      this.score += 1;
      if (this.bricks.length > 0) this.spawnPowerup(brick.x, brick.y);
      if (superActive) {
        ball.superBreakerHasBrokenBrick = true;
      }

      if (!superActive) {
        const overlapLeft = Math.abs(ballRight - left);
        const overlapRight = Math.abs(right - ballLeft);
        const overlapTop = Math.abs(ballBottom - top);
        const overlapBottom = Math.abs(bottom - ballTop);
        const minX = Math.min(overlapLeft, overlapRight);
        const minY = Math.min(overlapTop, overlapBottom);
        if (minX < minY) {
          ball.vx *= -1;
        } else {
          ball.vy *= -1;
        }
      }

      return;
    }
  }

  updateBall(ball, seconds, now) {
    const targetSpeed = clamp(this.ballSpeed, this.baseBallSpeed, this.maxBallSpeed);
    this.normalizeBallSpeed(ball, targetSpeed);
    const steps = Math.max(1, Math.ceil((targetSpeed * seconds) / 4));
    const stepSeconds = seconds / steps;

    for (let step = 0; step < steps; step += 1) {
      ball.x += ball.vx * stepSeconds;
      ball.y += ball.vy * stepSeconds;

      let hitWall = false;
      if (ball.x - this.ballRadius <= 2) {
        ball.x = 2 + this.ballRadius;
        ball.vx = Math.abs(ball.vx);
        hitWall = true;
      } else if (ball.x + this.ballRadius >= this.width - 2) {
        ball.x = this.width - 2 - this.ballRadius;
        ball.vx = -Math.abs(ball.vx);
        hitWall = true;
      }
      if (ball.y - this.ballRadius <= 2) {
        ball.y = 2 + this.ballRadius;
        ball.vy = Math.abs(ball.vy);
        hitWall = true;
      }
      if (hitWall && this.isBallSuperBreakerActive(ball, now) && ball.superBreakerHasBrokenBrick) {
        ball.superBreakerActive = false;
        ball.superBreakerHasBrokenBrick = false;
        ball.superBreakerUntil = 0;
      }

      this.resolvePaddleBounce(ball);
      this.resolveBrickCollision(ball, now);
    }
  }

  loseLife() {
    this.lives = Math.max(0, this.lives - 1);
    this.clearPickups();
    this.superBreakerUntil = 0;
    this.superBreakerWallReset = false;
    if (this.lives <= 0) {
      this.state = "gameover";
      this.message.setText("GAME OVER\nA:RETRY  B:QUIT");
      return;
    }
    this.state = "serve";
    this.message.setText("A:LAUNCH");
    this.resetBallOnPaddle();
  }

  updateLevelProgress() {
    if (this.bricks.length > 0) return;
    this.level += 1;
    this.clearPickups();
    this.superBreakerUntil = 0;
    this.superBreakerWallReset = false;
    this.buildLevelBricks();
    this.state = "serve";
    this.message.setText(`LEVEL ${this.level}\nA:LAUNCH`);
    this.resetBallOnPaddle();
  }

  syncHud() {
    this.hud.setText(`SCORE:${this.score}  LIVES:${this.lives}  LV:${this.level}`);
    this.paddle.setPosition(Math.round(this.paddleX), Math.round(this.paddleY));
    for (let i = 0; i < this.balls.length; i += 1) {
      this.syncBallVisual(this.balls[i]);
    }
  }

  tick(now, input) {
    if (!Number.isFinite(this.lastTickAt) || this.lastTickAt <= 0) {
      this.lastTickAt = now;
    }
    const dtMs = Math.min(50, Math.max(0, now - this.lastTickAt));
    this.lastTickAt = now;
    const seconds = dtMs / 1000;

    const move = (input?.left ? -1 : 0) + (input?.right ? 1 : 0);
    this.paddleX += move * this.paddleSpeed * seconds;
    this.paddleX = clamp(this.paddleX, 8 + this.paddleW / 2, this.width - 8 - this.paddleW / 2);

    if (this.state === "gameover") {
      if (input?.aJust) this.reset();
      this.syncHud();
      return { done: true, score: this.score, message: "GAME OVER" };
    }

    if (this.state === "serve") {
      if (!this.balls.length) this.resetBallOnPaddle();
      const ball = this.balls[0];
      ball.x = this.paddleX;
      ball.y = this.paddleY - this.ballRadius - 2;
      ball.vx = 0;
      ball.vy = 0;
      if (input?.aJust) this.launchBall(input);
      this.syncHud();
      return { done: false, score: this.score, message: "A:LAUNCH  B:QUIT" };
    }

    for (let i = this.balls.length - 1; i >= 0; i -= 1) {
      const ball = this.balls[i];
      this.updateBall(ball, seconds, now);
      if (ball.y - this.ballRadius > this.height + 4) {
        ball.sprite.destroy();
        this.balls.splice(i, 1);
      }
    }

    if (!this.balls.length) {
      this.loseLife();
      this.syncHud();
      return {
        done: this.state === "gameover",
        score: this.score,
        message: this.state === "gameover" ? "GAME OVER" : "A:LAUNCH  B:QUIT",
      };
    }

    this.updatePickups(seconds, now);
    this.updateLevelProgress();
    this.syncHud();

    if (this.state === "serve") {
      return { done: false, score: this.score, message: "A:LAUNCH  B:QUIT" };
    }
    return { done: false, score: this.score, message: "B:QUIT" };
  }

  destroy() {
    this.clearBricks();
    this.clearPickups();
    this.clearBalls();
    this.root?.destroy?.(true);
    this.root = null;
    this.paddle = null;
    this.hud = null;
    this.message = null;
  }
}
