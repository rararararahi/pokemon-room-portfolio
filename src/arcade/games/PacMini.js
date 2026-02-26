export default class PacMini {
  constructor() {
    this.scene = null;
    this.parent = null;
    this.root = null;

    this.width = 0;
    this.height = 0;

    this.tile = 8;
    this.cols = 0;
    this.rows = 0;
    this.offsetX = 0;
    this.offsetY = 0;

    this.walls = null;
    this.dots = null;
    this.dotSprites = [];
    this.dotsLeft = 0;

    this.pacStart = { x: 1, y: 1 };
    this.ghostStart = { x: 17, y: 1 };
    this.pac = { x: 1, y: 1 };
    this.pacDir = { x: 1, y: 0 };
    this.nextDir = { x: 1, y: 0 };
    this.enemies = [];

    this.pacSprite = null;
    this.hudText = null;
    this.message = null;
    this.wallGraphics = null;

    this.lastTickAt = 0;
    this.stepTimer = 0;
    this.ghostStepTimer = 0;
    this.stepEvery = 0.1;
    this.ghostStepEvery = 0.14;

    this.score = 0;
    this.level = 1;
    this.baseEnemyCount = 1;
    this.levelClearDelay = 0.75;
    this.levelClearTimer = 0;
    this.nextLevel = 2;
    this.clearedLevel = 0;
    this.state = "play";
    this.currentTemplate = null;
  }

  getName() {
    return "PACMINI";
  }

  static get MAP_TEMPLATE() {
    return [
      "###################",
      "#P...............G#",
      "#.###############.#",
      "#.#.............#.#",
      "#.#.###########.#.#",
      "#.#.#.........#.#.#",
      "#.#.#.#######.#.#.#",
      "#...#.#.....#.#...#",
      "###.#.#.###.#.#.###",
      "#...#.#.....#.#...#",
      "#.#.#.#######.#.#.#",
      "#.#.#.........#.#.#",
      "#.#.###########.#.#",
      "#.#.............#.#",
      "#.###############.#",
      "#.................#",
      "###################",
    ];
  }

  createRailTemplate({ randomize = true } = {}) {
    const rows = 17;
    const cols = 19;
    const grid = Array.from({ length: rows }, () => Array(cols).fill("#"));
    const carve = (x, y) => {
      if (x <= 0 || y <= 0 || x >= cols - 1 || y >= rows - 1) return;
      grid[y][x] = ".";
    };

    for (let x = 1; x < cols - 1; x += 1) {
      carve(x, 1);
      carve(x, rows - 2);
    }
    for (let y = 1; y < rows - 1; y += 1) {
      carve(1, y);
      carve(cols - 2, y);
    }

    const railRows = [3, 5, 7, 9, 11, 13];
    const baseCols = [3, 15];
    const optionalCols = [5, 7, 9, 11, 13];
    const railCols = baseCols.concat(randomize ? optionalCols.filter(() => Math.random() < 0.72) : optionalCols);

    for (let i = 0; i < railRows.length; i += 1) {
      const rowY = railRows[i];
      for (let x = 3; x <= cols - 4; x += 1) {
        carve(x, rowY);
      }
    }

    for (let i = 0; i < railCols.length; i += 1) {
      const colX = railCols[i];
      for (let y = 1; y < rows - 1; y += 1) {
        carve(colX, y);
      }
    }

    grid[1][1] = "P";
    grid[rows - 2][cols - 2] = "G";
    return grid.map((row) => row.join(""));
  }

  countWalkableNeighbors(template, x, y) {
    const rows = template.length;
    const cols = (template[0] || "").length;
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    let count = 0;
    for (let i = 0; i < dirs.length; i += 1) {
      const nx = x + dirs[i][0];
      const ny = y + dirs[i][1];
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      if ((template[ny][nx] || "#") !== "#") count += 1;
    }
    return count;
  }

  getReachableInfo(template, start) {
    const rows = template.length;
    const cols = (template[0] || "").length;
    if (!start || rows <= 0 || cols <= 0) {
      return { reachablePellets: 0, reachableCells: [] };
    }

    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    const visited = new Uint8Array(rows * cols);
    const queue = [{ x: start.x, y: start.y }];
    visited[start.y * cols + start.x] = 1;
    let head = 0;
    let reachablePellets = 0;
    const reachableCells = [];

    while (head < queue.length) {
      const node = queue[head++];
      const char = (template[node.y] || "")[node.x] || "#";
      if (char === ".") reachablePellets += 1;
      reachableCells.push({ x: node.x, y: node.y });

      for (let i = 0; i < dirs.length; i += 1) {
        const nx = node.x + dirs[i][0];
        const ny = node.y + dirs[i][1];
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        if (((template[ny] || "")[nx] || "#") === "#") continue;
        const idx = ny * cols + nx;
        if (visited[idx]) continue;
        visited[idx] = 1;
        queue.push({ x: nx, y: ny });
      }
    }

    return { reachablePellets, reachableCells };
  }

  validateTemplate(template) {
    if (!Array.isArray(template) || template.length <= 0) return false;
    const rows = template.length;
    const cols = (template[0] || "").length;
    if (cols <= 0) return false;

    let start = null;
    let totalPellets = 0;

    for (let y = 0; y < rows; y += 1) {
      const row = template[y] || "";
      if (row.length !== cols) return false;
      for (let x = 0; x < cols; x += 1) {
        const char = row[x] || "#";
        if (char !== "#") {
          const neighbors = this.countWalkableNeighbors(template, x, y);
          if (neighbors <= 1) return false;
        }
        if (char === "P") start = { x, y };
        if (char === ".") totalPellets += 1;
      }
    }

    if (!start || totalPellets <= 0) return false;

    const { reachablePellets } = this.getReachableInfo(template, start);
    return reachablePellets === totalPellets;
  }

  generatePlayableTemplate() {
    const maxAttempts = 20;
    for (let i = 0; i < maxAttempts; i += 1) {
      const candidate = this.createRailTemplate({ randomize: true });
      if (this.validateTemplate(candidate)) return candidate;
    }

    const fallback = this.createRailTemplate({ randomize: false });
    if (this.validateTemplate(fallback)) return fallback;
    return PacMini.MAP_TEMPLATE;
  }

  start({ scene, container, width, height }) {
    this.scene = scene;
    this.parent = container;
    this.width = Math.max(110, Math.round(width));
    this.height = Math.max(96, Math.round(height));

    this.root = scene.add.container(0, 0);
    this.parent.add(this.root);

    const map = this.generatePlayableTemplate();
    this.currentTemplate = map;
    this.rows = map.length;
    this.cols = map[0].length;

    this.tile = Math.max(5, Math.floor(Math.min((this.width - 8) / this.cols, (this.height - 8) / this.rows)));
    this.offsetX = Math.round((this.width - this.cols * this.tile) / 2);
    this.offsetY = Math.round((this.height - this.rows * this.tile) / 2);

    const cellCount = this.cols * this.rows;
    this.walls = new Uint8Array(cellCount);
    this.dots = new Uint8Array(cellCount);
    this.dotSprites = new Array(cellCount);

    this.wallGraphics = scene.add.graphics();
    this.root.add(this.wallGraphics);

    this.buildMazeFromTemplate(map);
    this.drawWalls();
    this.createDots();

    this.pacSprite = scene.add.rectangle(0, 0, this.tile - 2, this.tile - 2, 0xffdd57, 1).setOrigin(0.5, 0.5);
    this.hudText = scene.add.text(4, 4, "", {
      fontFamily: "monospace",
      fontSize: "10px",
      color: "#f4f6ff",
    }).setOrigin(0, 0);
    this.message = scene.add.text(Math.round(this.width / 2), Math.round(this.height / 2), "", {
      fontFamily: "monospace",
      fontSize: "11px",
      color: "#f4f6ff",
      align: "center",
    }).setOrigin(0.5, 0.5);

    this.root.add([this.pacSprite, this.hudText, this.message]);

    this.resetRun();
  }

  index(x, y) {
    return y * this.cols + x;
  }

  isInside(x, y) {
    return x >= 0 && y >= 0 && x < this.cols && y < this.rows;
  }

  isWall(x, y) {
    if (!this.isInside(x, y)) return true;
    return this.walls[this.index(x, y)] === 1;
  }

  isPath(x, y) {
    return this.isInside(x, y) && this.walls[this.index(x, y)] === 0;
  }

  clearMap() {
    this.walls.fill(0);
    this.dots.fill(0);
    this.dotsLeft = 0;
  }

  buildMazeFromTemplate(template) {
    this.clearMap();

    for (let y = 0; y < this.rows; y += 1) {
      const row = template[y] || "";
      for (let x = 0; x < this.cols; x += 1) {
        const char = row[x] || "#";
        const idx = this.index(x, y);

        if (char === "#") {
          this.walls[idx] = 1;
          this.dots[idx] = 0;
          continue;
        }

        this.walls[idx] = 0;
        this.dots[idx] = char === "." ? 1 : 0;

        if (char === "P") this.pacStart = { x, y };
        if (char === "G") this.ghostStart = { x, y };
      }
    }
  }

  drawWalls() {
    this.wallGraphics.clear();
    this.wallGraphics.fillStyle(0x274666, 1);

    for (let y = 0; y < this.rows; y += 1) {
      for (let x = 0; x < this.cols; x += 1) {
        if (!this.isWall(x, y)) continue;
        const px = Math.round(this.offsetX + x * this.tile);
        const py = Math.round(this.offsetY + y * this.tile);
        this.wallGraphics.fillRect(px, py, this.tile, this.tile);
      }
    }
  }

  createDots() {
    this.dotsLeft = 0;
    for (let y = 0; y < this.rows; y += 1) {
      for (let x = 0; x < this.cols; x += 1) {
        const idx = this.index(x, y);
        if (this.walls[idx] === 1) this.dots[idx] = 0;
        const center = this.cellCenter(x, y);
        const dot = this.scene.add.rectangle(center.x, center.y, 2, 2, 0xf4f6ff, 1).setOrigin(0.5, 0.5);
        const hasDot = this.dots[idx] === 1;
        dot.setVisible(hasDot);
        this.dotSprites[idx] = dot;
        this.root.add(dot);
        if (hasDot) this.dotsLeft += 1;
      }
    }
  }

  resetRun() {
    this.score = 0;
    this.level = 1;
    this.lastTickAt = 0;
    this.startLevel(this.level);
  }

  clearEnemies() {
    for (let i = 0; i < this.enemies.length; i += 1) {
      this.enemies[i]?.sprite?.destroy?.();
    }
    this.enemies = [];
  }

  getReachableCellsFromCurrentMap() {
    if (!this.isInside(this.pacStart.x, this.pacStart.y) || this.isWall(this.pacStart.x, this.pacStart.y)) {
      return [];
    }

    const visited = new Uint8Array(this.rows * this.cols);
    const queue = [{ x: this.pacStart.x, y: this.pacStart.y }];
    visited[this.index(this.pacStart.x, this.pacStart.y)] = 1;
    let head = 0;
    const cells = [];
    const dirs = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ];

    while (head < queue.length) {
      const node = queue[head++];
      cells.push(node);

      for (let i = 0; i < dirs.length; i += 1) {
        const nx = node.x + dirs[i].x;
        const ny = node.y + dirs[i].y;
        if (!this.isInside(nx, ny) || this.isWall(nx, ny)) continue;
        const idx = this.index(nx, ny);
        if (visited[idx]) continue;
        visited[idx] = 1;
        queue.push({ x: nx, y: ny });
      }
    }

    return cells;
  }

  spawnEnemies(count) {
    this.clearEnemies();

    const reachable = this.getReachableCellsFromCurrentMap();
    const spawnPool = reachable.filter((cell) => !(cell.x === this.pacStart.x && cell.y === this.pacStart.y));
    if (!spawnPool.length) return;

    const targetCount = Math.max(1, Math.min(count, spawnPool.length));
    const chosen = [];
    const used = new Set();

    const takeCell = (cell) => {
      if (!cell) return false;
      const key = `${cell.x},${cell.y}`;
      if (used.has(key)) return false;
      used.add(key);
      chosen.push({ x: cell.x, y: cell.y });
      return true;
    };

    if (
      this.isInside(this.ghostStart.x, this.ghostStart.y) &&
      !this.isWall(this.ghostStart.x, this.ghostStart.y) &&
      !(this.ghostStart.x === this.pacStart.x && this.ghostStart.y === this.pacStart.y)
    ) {
      takeCell(this.ghostStart);
    }

    while (chosen.length < targetCount && used.size < spawnPool.length) {
      const pick = spawnPool[Math.floor(Math.random() * spawnPool.length)];
      takeCell(pick);
    }

    const dirs = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ];

    for (let i = 0; i < chosen.length; i += 1) {
      const spawn = chosen[i];
      const valid = dirs.filter((dir) => this.canMove(spawn.x, spawn.y, dir.x, dir.y));
      const dir = valid.length ? valid[Math.floor(Math.random() * valid.length)] : { x: -1, y: 0 };
      const sprite = this.scene.add.rectangle(0, 0, this.tile - 2, this.tile - 2, 0xff6b6b, 1).setOrigin(0.5, 0.5);
      this.root.add(sprite);
      this.enemies.push({
        x: spawn.x,
        y: spawn.y,
        dir: { x: dir.x, y: dir.y },
        sprite,
      });
    }
  }

  startLevel(level) {
    this.level = Math.max(1, Math.floor(level || 1));
    this.state = "play";
    this.levelClearTimer = 0;
    this.nextLevel = this.level + 1;
    this.clearedLevel = 0;
    this.stepTimer = 0;
    this.ghostStepTimer = 0;
    this.message.setText("");

    this.currentTemplate = this.generatePlayableTemplate();
    this.buildMazeFromTemplate(this.currentTemplate);
    this.drawWalls();

    this.dotsLeft = 0;
    for (let y = 0; y < this.rows; y += 1) {
      for (let x = 0; x < this.cols; x += 1) {
        const idx = this.index(x, y);
        if (this.walls[idx] === 1) this.dots[idx] = 0;
        const visible = this.dots[idx] === 1;
        if (visible) this.dotsLeft += 1;
        const dot = this.dotSprites[idx];
        if (dot) dot.setVisible(visible);
      }
    }

    this.pac = { x: this.pacStart.x, y: this.pacStart.y };
    this.pacDir = { x: 1, y: 0 };
    this.nextDir = { x: 1, y: 0 };

    const enemyCount = Math.max(1, this.baseEnemyCount + (this.level - 1));
    this.spawnEnemies(enemyCount);

    this.eatDot(this.pac.x, this.pac.y);
    this.syncActors();
    this.updateHud();
  }

  updateHud() {
    if (!this.hudText) return;
    this.hudText.setText(`LEVEL: ${this.level}  SCORE: ${this.score}`);
  }

  cellCenter(x, y) {
    return {
      x: Math.round(this.offsetX + x * this.tile + this.tile / 2),
      y: Math.round(this.offsetY + y * this.tile + this.tile / 2),
    };
  }

  eatDot(x, y) {
    const idx = this.index(x, y);
    if (this.dots[idx] !== 1) return;
    this.dots[idx] = 0;
    this.dotsLeft = Math.max(0, this.dotsLeft - 1);
    const dot = this.dotSprites[idx];
    if (dot) dot.setVisible(false);
    this.score += 1;
    this.updateHud();
    if (this.dotsLeft <= 0) {
      this.state = "levelclear";
      this.levelClearTimer = this.levelClearDelay;
      this.nextLevel = this.level + 1;
      this.clearedLevel = this.level;
      this.message.setText(`LEVEL ${this.level} CLEARED`);
    }
  }

  canMove(fromX, fromY, dirX, dirY) {
    const nx = fromX + dirX;
    const ny = fromY + dirY;
    return this.isPath(nx, ny);
  }

  stepPac() {
    if (this.canMove(this.pac.x, this.pac.y, this.nextDir.x, this.nextDir.y)) {
      this.pacDir.x = this.nextDir.x;
      this.pacDir.y = this.nextDir.y;
    }
    if (this.canMove(this.pac.x, this.pac.y, this.pacDir.x, this.pacDir.y)) {
      this.pac.x += this.pacDir.x;
      this.pac.y += this.pacDir.y;
    }
    this.eatDot(this.pac.x, this.pac.y);
  }

  stepEnemy(enemy) {
    if (!enemy) return;
    const dirs = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ];
    const reverse = { x: -enemy.dir.x, y: -enemy.dir.y };
    const valid = [];
    for (let i = 0; i < dirs.length; i += 1) {
      const dir = dirs[i];
      if (!this.canMove(enemy.x, enemy.y, dir.x, dir.y)) continue;
      valid.push(dir);
    }
    if (!valid.length) return;

    let options = valid;
    if (valid.length > 1) {
      const noReverse = valid.filter((dir) => !(dir.x === reverse.x && dir.y === reverse.y));
      if (noReverse.length) options = noReverse;
    }

    const straight = options.find((dir) => dir.x === enemy.dir.x && dir.y === enemy.dir.y) || null;
    let pickPool = options;
    let chosen = null;

    // Keep momentum most of the time, but force turns often enough to break perimeter loops.
    if (straight && options.length > 1) {
      if (Math.random() < 0.68) {
        chosen = straight;
      } else {
        const turns = options.filter((dir) => !(dir.x === straight.x && dir.y === straight.y));
        if (turns.length) pickPool = turns;
      }
    }

    if (!chosen) {
      const centerX = (this.cols - 1) * 0.5;
      const centerY = (this.rows - 1) * 0.5;
      let total = 0;
      const weighted = [];

      for (let i = 0; i < pickPool.length; i += 1) {
        const dir = pickPool[i];
        const nx = enemy.x + dir.x;
        const ny = enemy.y + dir.y;
        const centerDist = Math.abs(nx - centerX) + Math.abs(ny - centerY);
        const playerDist = Math.abs(nx - this.pac.x) + Math.abs(ny - this.pac.y);
        const interiorBonus = nx > 1 && nx < this.cols - 2 && ny > 1 && ny < this.rows - 2 ? 0.25 : 0;
        const weight =
          1 +
          (straight && dir.x === straight.x && dir.y === straight.y ? 0.2 : 0) +
          (1 / (1 + centerDist)) * 0.9 +
          (1 / (1 + playerDist)) * 1.1 +
          interiorBonus;
        total += weight;
        weighted.push({ dir, upto: total });
      }

      if (total > 0) {
        const roll = Math.random() * total;
        chosen = weighted[weighted.length - 1].dir;
        for (let i = 0; i < weighted.length; i += 1) {
          if (roll <= weighted[i].upto) {
            chosen = weighted[i].dir;
            break;
          }
        }
      }
    }

    if (!chosen) chosen = pickPool[Math.floor(Math.random() * pickPool.length)];
    enemy.dir = { x: chosen.x, y: chosen.y };
    enemy.x += chosen.x;
    enemy.y += chosen.y;
  }

  stepEnemies() {
    for (let i = 0; i < this.enemies.length; i += 1) {
      this.stepEnemy(this.enemies[i]);
    }
  }

  isCaughtByEnemy() {
    for (let i = 0; i < this.enemies.length; i += 1) {
      const enemy = this.enemies[i];
      if (enemy.x === this.pac.x && enemy.y === this.pac.y) return true;
    }
    return false;
  }

  handleFinalGameOver() {
    this.state = "gameover";
    this.message.setText(`GAME OVER\nFINAL SCORE: ${this.score}\nA:RETRY  B:QUIT`);
  }

  syncActors() {
    const pacPos = this.cellCenter(this.pac.x, this.pac.y);
    this.pacSprite.setPosition(pacPos.x, pacPos.y);
    for (let i = 0; i < this.enemies.length; i += 1) {
      const enemy = this.enemies[i];
      const pos = this.cellCenter(enemy.x, enemy.y);
      enemy.sprite.setPosition(pos.x, pos.y);
    }
  }

  tick(now, input) {
    if (!Number.isFinite(this.lastTickAt) || this.lastTickAt <= 0) {
      this.lastTickAt = now;
    }
    const dtMs = Math.min(50, Math.max(0, now - this.lastTickAt));
    this.lastTickAt = now;
    const seconds = dtMs / 1000;

    if (this.state === "gameover") {
      if (input?.aJust) this.resetRun();
      return {
        done: true,
        score: this.score,
        message: "GHOST GOT YOU",
      };
    }

    if (this.state === "levelclear") {
      const clearedLevel = this.clearedLevel || this.level;
      this.levelClearTimer -= seconds;
      if (this.levelClearTimer <= 0) {
        this.startLevel(this.nextLevel);
      }
      return {
        done: false,
        score: this.score,
        message: `LEVEL ${clearedLevel} CLEARED`,
      };
    }

    if (input?.left) this.nextDir = { x: -1, y: 0 };
    else if (input?.right) this.nextDir = { x: 1, y: 0 };
    else if (input?.up) this.nextDir = { x: 0, y: -1 };
    else if (input?.down) this.nextDir = { x: 0, y: 1 };

    this.stepTimer += seconds;
    while (this.stepTimer >= this.stepEvery) {
      this.stepTimer -= this.stepEvery;
      this.stepPac();
      if (this.state !== "play") break;
    }

    if (this.state === "play" && this.isCaughtByEnemy()) {
      this.handleFinalGameOver();
    }

    this.ghostStepTimer += seconds;
    while (this.state === "play" && this.ghostStepTimer >= this.ghostStepEvery) {
      this.ghostStepTimer -= this.ghostStepEvery;
      this.stepEnemies();
    }

    if (this.state === "play" && this.isCaughtByEnemy()) {
      this.handleFinalGameOver();
    }

    this.syncActors();
    this.updateHud();

    if (this.state === "gameover") {
      return {
        done: true,
        score: this.score,
        message: "GHOST GOT YOU",
      };
    }

    return {
      done: false,
      score: this.score,
    };
  }

  destroy() {
    this.clearEnemies();
    this.root?.destroy?.(true);
    this.root = null;
    this.wallGraphics = null;
    this.pacSprite = null;
    this.hudText = null;
    this.message = null;
    this.dotSprites = [];
    this.walls = null;
    this.dots = null;
  }
}
