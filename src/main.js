import Phaser from "phaser";

const GAME_W = 320;
const GAME_H = 320;
const WORLD_ZOOM = 1;
const SPEED = 80;
const PLAYER_SCALE = 2;
const FEET_W = 10;
const FEET_H = 8;
const FEET_OFFSET_X = 3;
const FEET_OFFSET_Y = 8;
const DEBUG_UI = false;

class RoomScene extends Phaser.Scene {
  constructor() {
    super("room");
  }

  preload() {
    this.load.spritesheet("p_down", "/assets/player_front.png", {
      frameWidth: 16,
      frameHeight: 16,
    });
    this.load.spritesheet("p_up", "/assets/player_back.png", {
      frameWidth: 16,
      frameHeight: 16,
    });
    this.load.spritesheet("p_left", "/assets/player_left.png", {
      frameWidth: 16,
      frameHeight: 16,
    });
    this.load.spritesheet("p_right", "/assets/player_right.png", {
      frameWidth: 16,
      frameHeight: 16,
    });
    this.load.image("room_pc", "/assets/room/pokeputer.png");
  }

  create() {

    this.worldLayer = this.add.container(0, 0);
    this.uiLayer = this.add.container(0, 0);

    const bg = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x2b2b44);
    this.worldLayer.add(bg);

    this.facing = "down";
    this.idleFrame = { down: 0, up: 0, left: 0, right: 0 };

    this.player = this.physics.add.sprite(GAME_W / 2, GAME_H / 2, "p_down", 0);
    this.player.setOrigin(0.5, 1);
    this.player.setScale(PLAYER_SCALE);
    if (this.player.body) {
      this.player.body.setSize(FEET_W, FEET_H);
      this.player.body.setOffset(FEET_OFFSET_X, FEET_OFFSET_Y);
      this.player.body.setCollideWorldBounds(true);
    }
    this.player.setCollideWorldBounds(true);
    this.worldLayer.add(this.player);
    this.physics.world.setBounds(0, 0, GAME_W, GAME_H);

    this.cursors = this.input.keyboard.createCursorKeys();
    this.keyA = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.keySpace = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    this.touch = { left: false, right: false, up: false, down: false, interact: false };
    this.lastPressedTime = { left: 0, right: 0, up: 0, down: 0 };
    this.inputTick = 0;

    this.gameCam = this.cameras.main;
    this.uiCam = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    this.gameCam.ignore(this.uiLayer);
    this.uiCam.ignore(this.worldLayer);
    this.uiLayer.setDepth(1000);

    this.gameCam.setZoom(WORLD_ZOOM);
    this.gameCam.setScroll(0, 0);
    this.gameCam.setBounds(0, 0, GAME_W, GAME_H);

    const TOP_WALL_Y = 5;
    const TOP_WALL_H = 2;
    const topWall = this.add.rectangle(
      GAME_W / 2,
      TOP_WALL_Y + TOP_WALL_H / 2,
      GAME_W,
      TOP_WALL_H,
      0x000000,
      0
    );
    this.physics.add.existing(topWall, true);
    this.physics.add.collider(this.player, topWall);

    const CORNER_PAD = 6;
    const pc = this.add.image(0, 0, "room_pc").setOrigin(0.5, 0.5);
    pc.setScale(0.5);
    pc.setOrigin(1, 0);
    pc.setPosition(GAME_W - CORNER_PAD + 4, TOP_WALL_Y + TOP_WALL_H + CORNER_PAD - 12);
    this.worldLayer.add(pc);
    this.pc = pc;

    const blockerW = Math.floor(pc.displayWidth * 0.85);
    const blockerH = 14;
    const blockerX = pc.getBottomCenter().x;
    const blockerY = pc.getBottomCenter().y - 6;
    const pcBlocker = this.add.rectangle(
      blockerX,
      blockerY,
      blockerW,
      blockerH,
      0x00ff00,
      DEBUG_UI ? 0.25 : 0
    );
    this.worldLayer.add(pcBlocker);
    this.physics.add.existing(pcBlocker, true);
    this.physics.add.collider(this.player, pcBlocker);

    console.log("pc parent", pc.parentContainer, "pc cam", pc.cameraFilter);
    console.log("player parent", this.player.parentContainer, "player cam", this.player.cameraFilter);

    const zoneW = Math.round(pc.displayWidth * 0.9);
    const zoneH = Math.round(pc.displayHeight * 0.35);
    const zoneX = pc.x - pc.displayWidth / 2;
    const zoneY = pc.y + pc.displayHeight + zoneH / 2 - 2;
    this.pcZone = this.add.zone(zoneX, zoneY, zoneW, zoneH);
    this.physics.add.existing(this.pcZone, true);

    this.createControls();

    this.dialogOpen = false;
    this.dialogText = this.add.text(12, 12, "", {
      fontFamily: "monospace",
      fontSize: "14px",
      color: "#ffffff",
    });
    this.dialogText.setVisible(false);
    this.uiLayer.add(this.dialogText);

    this.anims.create({
      key: "walk_down",
      frames: this.anims.generateFrameNumbers("p_down", { start: 0, end: 3 }),
      frameRate: 8,
      repeat: -1,
    });
    this.anims.create({
      key: "walk_up",
      frames: this.anims.generateFrameNumbers("p_up", { start: 0, end: 3 }),
      frameRate: 8,
      repeat: -1,
    });
    this.anims.create({
      key: "walk_left",
      frames: this.anims.generateFrameNumbers("p_left", { start: 0, end: 1 }),
      frameRate: 12,
      repeat: -1,
    });
    this.anims.create({
      key: "walk_right",
      frames: this.anims.generateFrameNumbers("p_right", { start: 0, end: 1 }),
      frameRate: 12,
      repeat: -1,
    });

    this.layout();
    this.scale.on("resize", () => this.layout());
  }

  createControls() {
    const dpadRadius = 70;
    const aRadius = 34;

    this.dpadHit = this.add.circle(0, 0, dpadRadius, 0x000000, 0.001);
    this.aHit = this.add.circle(0, 0, aRadius, 0x000000, 0.001);
    this.dpadHit.setInteractive();
    this.aHit.setInteractive();

    this.uiLayer.add([this.dpadHit, this.aHit]);

    this.dpadPointerId = null;
    const deadzone = 10;

    const handleDpadPointer = (pointer) => {
      const bounds = this.dpadHit.getBounds();
      const cx = bounds.centerX;
      const cy = bounds.centerY;
      const dx = pointer.worldX - cx;
      const dy = pointer.worldY - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < deadzone) {
        this.touch.left = this.touch.right = this.touch.up = this.touch.down = false;
        return;
      }

      const absdx = Math.abs(dx);
      const absdy = Math.abs(dy);
      let dir = null;
      if (absdx > absdy) dir = dx < 0 ? "left" : "right";
      else dir = dy < 0 ? "up" : "down";

      this.touch.left = dir === "left";
      this.touch.right = dir === "right";
      this.touch.up = dir === "up";
      this.touch.down = dir === "down";

      this.lastPressedTime[dir] = this.inputTick;
      this.setFacing(dir);
    };

    this.dpadHit.on("pointerdown", (ptr) => {
      if (this.dpadPointerId != null) return;
      this.dpadPointerId = ptr.id;
      handleDpadPointer(ptr);
    });

    this.input.on("pointermove", (pointer) => {
      if (this.dpadPointerId === null) return;
      if (pointer.id !== this.dpadPointerId) return;
      handleDpadPointer(pointer);
    });

    const clearDpad = (pointer) => {
      if (pointer.id !== this.dpadPointerId) return;
      this.dpadPointerId = null;
      this.touch.left = this.touch.right = this.touch.up = this.touch.down = false;
    };

    this.input.on("pointerup", clearDpad);
    this.input.on("pointerupoutside", clearDpad);
    this.input.on("pointercancel", clearDpad);

    this.aHit.on("pointerdown", () => (this.touch.interact = true));
    this.aHit.on("pointerup", () => (this.touch.interact = false));
  }

  layout() {
    const canvasW = this.scale.width;
    const canvasH = this.scale.height;

    const vpW = Math.round(GAME_W * WORLD_ZOOM);
    const vpH = Math.round(GAME_H * WORLD_ZOOM);
    const minDeck = 160;
    const preferredDeck = Math.max(minDeck, Math.floor(canvasH * 0.32));
    const maxDeck = Math.max(0, canvasH - vpH);
    const deckHeight = Math.min(preferredDeck, maxDeck);
    const deckTop = canvasH - deckHeight;

    const vpX = Math.floor((canvasW - vpW) / 2);
    const vpY = Math.max(0, Math.floor((deckTop - vpH) / 2));

    this.gameCam.setViewport(vpX, vpY, vpW, vpH);
    this.gameCam.setScroll(0, 0);
    this.uiCam.setViewport(0, 0, canvasW, canvasH);

    const pad = 24;
    const dpadX = pad + 70;
    const dpadY = deckTop + deckHeight / 2;
    const aX = canvasW - (pad + 70);
    const aY = dpadY;

    this.dpadHit.setPosition(dpadX, dpadY);
    this.aHit.setPosition(aX, aY);
  }

  setFacing(direction) {
    if (this.facing === direction) return;
    this.facing = direction;

    if (direction === "down") this.player.setTexture("p_down");
    if (direction === "up") this.player.setTexture("p_up");
    if (direction === "left") this.player.setTexture("p_left");
    if (direction === "right") this.player.setTexture("p_right");
  }

  playWalk(direction) {
    this.setFacing(direction);

    const key =
      direction === "down"
        ? "walk_down"
        : direction === "up"
        ? "walk_up"
        : direction === "left"
        ? "walk_left"
        : "walk_right";

    if (this.player.anims.currentAnim?.key !== key) {
      this.player.anims.play(key, true);
    }
  }

  stopWalk() {
    this.player.anims.stop();

    const frame =
      this.facing === "down"
        ? this.idleFrame.down
        : this.facing === "up"
        ? this.idleFrame.up
        : this.facing === "left"
        ? this.idleFrame.left
        : this.idleFrame.right;

    const tex =
      this.facing === "down"
        ? "p_down"
        : this.facing === "up"
        ? "p_up"
        : this.facing === "left"
        ? "p_left"
        : "p_right";

    this.player.setTexture(tex, frame);
  }

  update() {
    this.inputTick += 1;

    const leftPressed = this.cursors.left.isDown || this.touch.left;
    const rightPressed = this.cursors.right.isDown || this.touch.right;
    const upPressed = this.cursors.up.isDown || this.touch.up;
    const downPressed = this.cursors.down.isDown || this.touch.down;

    if (Phaser.Input.Keyboard.JustDown(this.cursors.left)) this.lastPressedTime.left = this.inputTick;
    if (Phaser.Input.Keyboard.JustDown(this.cursors.right)) this.lastPressedTime.right = this.inputTick;
    if (Phaser.Input.Keyboard.JustDown(this.cursors.up)) this.lastPressedTime.up = this.inputTick;
    if (Phaser.Input.Keyboard.JustDown(this.cursors.down)) this.lastPressedTime.down = this.inputTick;

    let moveX = 0;
    let moveY = 0;

    if (leftPressed && !rightPressed) moveX = -1;
    else if (rightPressed && !leftPressed) moveX = 1;

    if (upPressed && !downPressed) moveY = -1;
    else if (downPressed && !upPressed) moveY = 1;

    const horizontalDir =
      leftPressed && rightPressed
        ? this.lastPressedTime.left >= this.lastPressedTime.right
          ? "left"
          : "right"
        : leftPressed
        ? "left"
        : rightPressed
        ? "right"
        : null;

    const verticalDir =
      upPressed && downPressed
        ? this.lastPressedTime.up >= this.lastPressedTime.down
          ? "up"
          : "down"
        : upPressed
        ? "up"
        : downPressed
        ? "down"
        : null;

    const horizontalTime = horizontalDir ? this.lastPressedTime[horizontalDir] : -1;
    const verticalTime = verticalDir ? this.lastPressedTime[verticalDir] : -1;

    let movingDir = null;
    if (horizontalDir && verticalDir) {
      movingDir = horizontalTime >= verticalTime ? horizontalDir : verticalDir;
    } else {
      movingDir = horizontalDir ?? verticalDir;
    }

    if (movingDir) this.setFacing(movingDir);

    const body = this.player.body;
    body.setVelocity(0);
    if (moveX !== 0) body.setVelocityX(moveX * SPEED);
    if (moveY !== 0) body.setVelocityY(moveY * SPEED);
    body.velocity.normalize().scale(SPEED);

    const isMoving = body.velocity.lengthSq() > 0.1;
    if (isMoving && movingDir) this.playWalk(movingDir);
    else this.stopWalk();

    const inPC = this.pcZone ? this.physics.overlap(this.player, this.pcZone) : false;
    const interactPressed =
      Phaser.Input.Keyboard.JustDown(this.keyA) ||
      Phaser.Input.Keyboard.JustDown(this.keySpace) ||
      this.touch.interact;

    if (interactPressed) {
      if (this.dialogOpen) {
        this.dialogText.setVisible(false);
        this.dialogOpen = false;
      } else if (inPC) {
        this.dialogText.setText("Computer...");
        this.dialogText.setVisible(true);
        this.dialogOpen = true;
      }
    }

    this.touch.interact = false;

    const parent = this.player.parentContainer;
    if (parent) parent.bringToTop(this.player);
    else this.children.bringToTop(this.player);
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "app",
  width: 360,
  height: 640,
  backgroundColor: "#000000",
  pixelArt: true,
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: "arcade",
    arcade: { debug: false },
  },
  scene: [RoomScene],
});
