import Phaser from "phaser";

const GRID_W = 10;
const GRID_H = 20;

const PIECES = [
  {
    id: "I",
    cells: [
      [[0, 1], [1, 1], [2, 1], [3, 1]],
      [[2, 0], [2, 1], [2, 2], [2, 3]],
      [[0, 2], [1, 2], [2, 2], [3, 2]],
      [[1, 0], [1, 1], [1, 2], [1, 3]],
    ],
  },
  {
    id: "O",
    cells: [
      [[1, 0], [2, 0], [1, 1], [2, 1]],
      [[1, 0], [2, 0], [1, 1], [2, 1]],
      [[1, 0], [2, 0], [1, 1], [2, 1]],
      [[1, 0], [2, 0], [1, 1], [2, 1]],
    ],
  },
  {
    id: "T",
    cells: [
      [[1, 0], [0, 1], [1, 1], [2, 1]],
      [[1, 0], [1, 1], [2, 1], [1, 2]],
      [[0, 1], [1, 1], [2, 1], [1, 2]],
      [[1, 0], [0, 1], [1, 1], [1, 2]],
    ],
  },
  {
    id: "S",
    cells: [
      [[1, 0], [2, 0], [0, 1], [1, 1]],
      [[1, 0], [1, 1], [2, 1], [2, 2]],
      [[1, 1], [2, 1], [0, 2], [1, 2]],
      [[0, 0], [0, 1], [1, 1], [1, 2]],
    ],
  },
  {
    id: "Z",
    cells: [
      [[0, 0], [1, 0], [1, 1], [2, 1]],
      [[2, 0], [1, 1], [2, 1], [1, 2]],
      [[0, 1], [1, 1], [1, 2], [2, 2]],
      [[1, 0], [0, 1], [1, 1], [0, 2]],
    ],
  },
  {
    id: "J",
    cells: [
      [[0, 0], [0, 1], [1, 1], [2, 1]],
      [[1, 0], [2, 0], [1, 1], [1, 2]],
      [[0, 1], [1, 1], [2, 1], [2, 2]],
      [[1, 0], [1, 1], [0, 2], [1, 2]],
    ],
  },
  {
    id: "L",
    cells: [
      [[2, 0], [0, 1], [1, 1], [2, 1]],
      [[1, 0], [1, 1], [1, 2], [2, 2]],
      [[0, 1], [1, 1], [2, 1], [0, 2]],
      [[0, 0], [1, 0], [1, 1], [1, 2]],
    ],
  },
];

const COLORS = [0x2c3e50, 0x57e3ff, 0xffd95d, 0xdc6aff, 0x74e47f, 0xff6f6f, 0x6f95ff, 0xffad66];

export default class Tetris {
  constructor() {
    this.scene = null;
    this.parent = null;
    this.root = null;

    this.width = 0;
    this.height = 0;
    this.cell = 8;
    this.offsetX = 0;
    this.offsetY = 0;

    this.board = new Uint8Array(GRID_W * GRID_H);
    this.current = null;

    this.boardGraphics = null;
    this.pieceGraphics = null;
    this.frameRect = null;
    this.scoreText = null;
    this.stateText = null;

    this.score = 0;
    this.over = false;
    this.lastTickAt = 0;
    this.lastFallAt = 0;

    this.fallMs = 520;
    this.softDropMs = 70;

    this.holdDir = 0;
    this.holdNextAt = 0;
    this.holdInitialDelayMs = 120;
    this.holdRepeatMs = 80;
    this.dirty = true;
  }

  getName() {
    return "TETRIS";
  }

  start({ scene, container, width, height }) {
    this.scene = scene;
    this.parent = container;
    this.width = Math.max(96, Math.round(width));
    this.height = Math.max(96, Math.round(height));

    this.root = scene.add.container(0, 0);
    this.parent.add(this.root);

    this.cell = Math.max(5, Math.floor(Math.min((this.width - 24) / GRID_W, (this.height - 16) / GRID_H)));
    const boardW = GRID_W * this.cell;
    const boardH = GRID_H * this.cell;
    this.offsetX = Math.round((this.width - boardW) / 2);
    this.offsetY = Math.round((this.height - boardH) / 2 + 2);

    this.boardGraphics = scene.add.graphics();
    this.pieceGraphics = scene.add.graphics();
    this.frameRect = scene.add.rectangle(this.offsetX - 1, this.offsetY - 1, boardW + 2, boardH + 2, 0x000000, 0)
      .setOrigin(0, 0)
      .setStrokeStyle(1, 0x8ea3ba, 1);
    this.scoreText = scene.add.text(4, 2, "SCORE 0", {
      fontFamily: "monospace",
      fontSize: "10px",
      color: "#dbe8ff",
    }).setOrigin(0, 0);
    this.stateText = scene.add.text(Math.round(this.width / 2), Math.round(this.height / 2), "", {
      fontFamily: "monospace",
      fontSize: "11px",
      color: "#f4f6ff",
      align: "center",
    }).setOrigin(0.5, 0.5);

    this.root.add([this.boardGraphics, this.pieceGraphics, this.frameRect, this.scoreText, this.stateText]);

    this.reset();
  }

  reset() {
    this.board.fill(0);
    this.current = null;
    this.score = 0;
    this.over = false;
    this.lastTickAt = 0;
    this.lastFallAt = 0;
    this.holdDir = 0;
    this.holdNextAt = 0;
    this.stateText.setText("");
    this.spawnPiece();
    this.dirty = true;
    this.draw();
  }

  randomPiece() {
    const typeIndex = Math.floor(Math.random() * PIECES.length);
    return {
      typeIndex,
      rot: 0,
      x: 3,
      y: -1,
    };
  }

  forEachBlock(piece, cb) {
    const shape = PIECES[piece.typeIndex].cells[piece.rot];
    for (let i = 0; i < shape.length; i += 1) {
      const block = shape[i];
      cb(piece.x + block[0], piece.y + block[1]);
    }
  }

  collides(piece) {
    let hit = false;
    this.forEachBlock(piece, (x, y) => {
      if (hit) return;
      if (x < 0 || x >= GRID_W || y >= GRID_H) {
        hit = true;
        return;
      }
      if (y >= 0 && this.board[y * GRID_W + x]) {
        hit = true;
      }
    });
    return hit;
  }

  spawnPiece() {
    const piece = this.randomPiece();
    this.current = piece;
    if (this.collides(piece)) {
      this.over = true;
      this.stateText.setText("GAME OVER\nA:RETRY  B:QUIT");
    }
  }

  tryMove(dx, dy) {
    if (!this.current || this.over) return false;
    const next = {
      ...this.current,
      x: this.current.x + dx,
      y: this.current.y + dy,
    };
    if (this.collides(next)) return false;
    this.current = next;
    this.dirty = true;
    return true;
  }

  tryRotate() {
    if (!this.current || this.over) return;
    const nextRot = (this.current.rot + 1) % 4;
    const kicks = [0, -1, 1, -2, 2];
    for (let i = 0; i < kicks.length; i += 1) {
      const next = {
        ...this.current,
        rot: nextRot,
        x: this.current.x + kicks[i],
      };
      if (!this.collides(next)) {
        this.current = next;
        this.dirty = true;
        return;
      }
    }
  }

  lockPiece() {
    if (!this.current) return;
    const colorIndex = this.current.typeIndex + 1;
    this.forEachBlock(this.current, (x, y) => {
      if (y < 0) return;
      this.board[y * GRID_W + x] = colorIndex;
    });

    const lines = this.clearLines();
    if (lines > 0) {
      if (lines === 4) this.score += 500;
      else this.score += lines * 100;
    }

    this.spawnPiece();
    this.dirty = true;
  }

  clearLines() {
    let lines = 0;
    for (let y = GRID_H - 1; y >= 0; y -= 1) {
      let full = true;
      for (let x = 0; x < GRID_W; x += 1) {
        if (!this.board[y * GRID_W + x]) {
          full = false;
          break;
        }
      }

      if (!full) continue;

      lines += 1;
      for (let yy = y; yy > 0; yy -= 1) {
        for (let x = 0; x < GRID_W; x += 1) {
          this.board[yy * GRID_W + x] = this.board[(yy - 1) * GRID_W + x];
        }
      }
      for (let x = 0; x < GRID_W; x += 1) {
        this.board[x] = 0;
      }
      y += 1;
    }

    return lines;
  }

  handleLateral(now, input) {
    const dir = input.left && !input.right ? -1 : input.right && !input.left ? 1 : 0;
    if (dir === 0) {
      this.holdDir = 0;
      this.holdNextAt = 0;
      return;
    }

    if (dir !== this.holdDir) {
      this.holdDir = dir;
      this.holdNextAt = now + this.holdInitialDelayMs;
      this.tryMove(dir, 0);
      return;
    }

    if (now >= this.holdNextAt) {
      this.holdNextAt = now + this.holdRepeatMs;
      this.tryMove(dir, 0);
    }
  }

  tick(now, input) {
    if (!this.current) return { done: false, score: this.score };

    if (this.over) {
      if (input?.aJust) this.reset();
      return {
        done: true,
        score: this.score,
        message: "GAME OVER",
      };
    }

    if (!Number.isFinite(this.lastTickAt) || this.lastTickAt <= 0) {
      this.lastTickAt = now;
      this.lastFallAt = now;
    }

    this.handleLateral(now, input || {});

    if (input?.aJust) {
      this.tryRotate();
    }

    const fallEvery = input?.down ? this.softDropMs : this.fallMs;
    if (now - this.lastFallAt >= fallEvery) {
      this.lastFallAt = now;
      const moved = this.tryMove(0, 1);
      if (!moved) this.lockPiece();
    }

    this.draw();

    return {
      done: false,
      score: this.score,
    };
  }

  draw() {
    if (!this.dirty) return;
    this.dirty = false;

    this.boardGraphics.clear();
    this.pieceGraphics.clear();

    this.scoreText.setText(`SCORE ${this.score}`);

    for (let y = 0; y < GRID_H; y += 1) {
      for (let x = 0; x < GRID_W; x += 1) {
        const v = this.board[y * GRID_W + x];
        if (!v) continue;
        const px = Math.round(this.offsetX + x * this.cell);
        const py = Math.round(this.offsetY + y * this.cell);
        const color = COLORS[v % COLORS.length] || COLORS[0];
        this.boardGraphics.fillStyle(color, 1);
        this.boardGraphics.fillRect(px, py, this.cell - 1, this.cell - 1);
      }
    }

    if (this.current) {
      const color = COLORS[(this.current.typeIndex + 1) % COLORS.length] || COLORS[1];
      this.pieceGraphics.fillStyle(color, 1);
      this.forEachBlock(this.current, (x, y) => {
        if (y < 0) return;
        const px = Math.round(this.offsetX + x * this.cell);
        const py = Math.round(this.offsetY + y * this.cell);
        this.pieceGraphics.fillRect(px, py, this.cell - 1, this.cell - 1);
      });
    }
  }

  destroy() {
    this.root?.destroy?.(true);
    this.root = null;
    this.boardGraphics = null;
    this.pieceGraphics = null;
    this.frameRect = null;
    this.scoreText = null;
    this.stateText = null;
    this.current = null;
  }
}
