import Phaser from "phaser";

const CONTROL_TOP_PAD = 0;
const ICON_RAISE = 50; // raise on-screen control visuals by this many pixels (adjusted -10px)
const SCREEN_SHIFT_Y = 0; // no global vertical shift for square framing
const A_HIT_SCALE = 1.6; // multiplier for A button hit radius (bigger = easier to press)
const ASSET_SCALE = 2; // global multiplier for in-world game assets (characters, props)

class RoomScene extends Phaser.Scene {
  constructor() {
    super("room");
  }

  preload() {
    // IMPORTANT:
    // - Each file is a spritesheet (multiple frames), not a single image.
    // - Frame size must match your Piskel export (assuming 16x16).
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
    // UI images (visuals only)
    this.load.image('ui_dpad', '/assets/ui/dpad.png');
    this.load.image('ui_a', '/assets/ui/abutton.png');
    // Room assets (PC + speakers)
    this.load.image('room_pc', '/assets/room/pokeputer.png');
    this.load.image('room_spk_l', '/assets/room/speaker_L.png');
    this.load.image('room_spk_r', '/assets/room/speaker_R.png');
    // console asset removed
  }

  create() {
    // --- Constants ---
    this.GAME_W = 320;
    // make the room square
    this.GAME_H = this.GAME_W;

    // Stop iOS Safari gestures interfering with touch buttons
    document.documentElement.style.touchAction = "none";
    document.body.style.touchAction = "none";
    const app = document.getElementById("app");
    if (app) app.style.touchAction = "none";

    // --- World ---
    this.physics.world.setBounds(0, 0, this.GAME_W, this.GAME_H);

    // Layers for multi-camera setup
    this.worldLayer = this.add.container(0, 0);
    this.uiLayer = this.add.container(0, 0);

    // UI control deck background (will be sized/positioned in layout())
    this.deckBg = this.add.rectangle(0, 0, 10, 10, 0x000000).setOrigin(0.5, 0);
    this.uiLayer.add(this.deckBg);

    // Background room (centered)
    const bg = this.add.rectangle(160, 160, this.GAME_W, this.GAME_H, 0x2b2b44);
    this.worldLayer.add(bg);

    // --- Player ---
    // We will use one sprite and swap its texture when direction changes.
    // Frame indexing is zero-based; idle/reset frame = 0 for ALL directions
    this.facing = "down"; // "down" | "up" | "left" | "right"
    this.idleFrame = { down: 0, up: 0, left: 0, right: 0 };

    this.player = this.physics.add.sprite(160, 160, "p_down", 0);
    this.lastAxisPressed = 'y'; // 'x'|'y' used to prefer axis on diagonals
    this.player.setCollideWorldBounds(true);
    // Scale the player sprite and make collision feel more Pokémon-like (collide at feet)
    this.player.setScale(ASSET_SCALE);
    // Body sizes/offsets scaled with ASSET_SCALE
    if (this.player.body) {
      this.player.body.setSize(10 * ASSET_SCALE, 8 * ASSET_SCALE, true);
      this.player.body.setOffset(3 * ASSET_SCALE, 8 * ASSET_SCALE);
      this.player.body.setCollideWorldBounds(true);
      this.player.setCollideWorldBounds(true);
    }

    this.worldLayer.add(this.player);

    // (table removed)

    // Wall padding & anchored prop placement
    const WALL_PAD = 10;

    // Simple top-right anchored furniture group: speakerL, PC, speakerR
    const GROUP_GAP = 8;
    // create objects with top-origin so they align to the top wall
    this.speakerL = this.add.image(0, 0, 'room_spk_l').setOrigin(0.5, 0);
    this.pc = this.add.image(0, 0, 'room_pc').setOrigin(0.5, 0);
    this.speakerR = this.add.image(0, 0, 'room_spk_r').setOrigin(0.5, 0);

    // base visual scales (multiplied by ASSET_SCALE)
    // reduce PC size and speaker size so they fit the square room better
    const PC_BASE = 0.45;
    const SPK_BASE = 0.35;
    this.pc.setScale(PC_BASE * ASSET_SCALE);
    this.speakerL.setScale(SPK_BASE * ASSET_SCALE);
    this.speakerR.setScale(SPK_BASE * ASSET_SCALE);

    // measure widths after scale
    const spLw = Math.round(this.speakerL.displayWidth || this.speakerL.width || 0);
    const pW = Math.round(this.pc.displayWidth || this.pc.width || 0);
    const spRw = Math.round(this.speakerR.displayWidth || this.speakerR.width || 0);
    const totalGroupW = spLw + pW + spRw + GROUP_GAP * 2;

    // right-align the group to the wall with a small pad
    const groupRight = this.GAME_W - WALL_PAD;
    const groupLeft = Math.round(groupRight - totalGroupW);
    let sx = groupLeft;

    // position speakers and pc along the top wall
    this.speakerL.setPosition(sx + Math.round(spLw / 2), WALL_PAD);
    sx += spLw + GROUP_GAP;
    this.pc.setPosition(sx + Math.round(pW / 2), WALL_PAD);
    sx += pW + GROUP_GAP;
    this.speakerR.setPosition(sx + Math.round(spRw / 2), WALL_PAD);

    this.worldLayer.add([this.speakerL, this.pc, this.speakerR]);

    // add static bodies for pc and speakers (small footprint near their bottoms)
    [this.speakerL, this.pc, this.speakerR].forEach((obj) => {
      this.physics.add.existing(obj, true);
      if (!obj.body) return;
      const w = Math.round(obj.displayWidth || obj.width || 16);
      const h = Math.round(obj.displayHeight || obj.height || 16);
      const footW = Math.max(6, Math.round(w * 0.6));
      const footH = Math.max(6, Math.round(h * 0.25));
      // origin is top, so offset Y should be lower in sprite (near bottom)
      const offsetX = Math.round((w - footW) / 2);
      const offsetY = Math.round(h - footH - 2);
      obj.body.setSize(footW, footH);
      obj.body.setOffset(offsetX, offsetY);
      this.physics.add.collider(this.player, obj);
    });

    // Interaction zone (in front of the PC). Slightly larger than the collision footprint.
    const pcBounds = this.pc.getBounds();
    const pcZoneW = Math.round((pcBounds.width * 0.8) + 12);
    const pcZoneH = Math.round(Math.max(12, pcBounds.height * 0.32));
    // place the zone slightly below the top (in front of PC on the floor)
    this.pcZone = this.add.zone(this.pc.x - Math.round(pcBounds.width * 0.4), Math.round(this.pc.y + pcBounds.height * 0.42), pcZoneW, pcZoneH);
    this.physics.add.existing(this.pcZone, true);

    // Shift all props together (right 20px, up 10px)
    const SHIFT_X = 20;
    const SHIFT_Y = -10;
    [this.pc, this.speakerL, this.speakerR].forEach((obj) => {
      if (!obj) return;
      obj.setPosition(Math.round(obj.x + SHIFT_X), Math.round(obj.y + SHIFT_Y));
    });
    if (this.pcZone && this.pcZone.body) {
      this.pcZone.setPosition(Math.round(this.pcZone.x + SHIFT_X), Math.round(this.pcZone.y + SHIFT_Y));
      // update static body position for the zone
      this.pcZone.body.x = Math.round(this.pcZone.x - (this.pcZone.width || 0) * 0.5);
      this.pcZone.body.y = Math.round(this.pcZone.y - (this.pcZone.height || 0) * 0.5);
    }

    // Recompute physics body sizes/offsets to match new display positions
    if (this.pc && this.pc.body) {
      const w = Math.round(this.pc.displayWidth);
      const h = Math.round(this.pc.displayHeight);
      const footW = Math.max(6, Math.round(w * 0.8));
      const footH = Math.max(6, Math.round(h * 0.32));
      this.pc.body.setSize(footW, footH);
      this.pc.body.setOffset(Math.round((w - footW) / 2), Math.round(h - footH));
    }
    [this.speakerL, this.speakerR].forEach((spk) => {
      if (!spk || !spk.body) return;
      const w = Math.round(spk.displayWidth);
      const h = Math.round(spk.displayHeight);
      const sFootW = Math.max(4, Math.round(w * 0.6));
      const sFootH = Math.max(4, Math.round(h * 0.28));
      spk.body.setSize(sFootW, sFootH);
      spk.body.setOffset(Math.round((w - sFootW) / 2), Math.round(h - sFootH));
    });

    // (debug markers removed)

    // --- Input ---
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keyA = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.keySpace = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    this.touch = { left: false, right: false, up: false, down: false, interact: false };
    this.prevTouch = { left: false, right: false, up: false, down: false };
    this.inputTick = 0;
    this.lastPressedTime = { left: 0, right: 0, up: 0, down: 0 };

    // --- Cameras ---
    this.gameCam = this.cameras.main;
    this.uiCam = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    this.uiCam.setScroll(0, 0);
    this.uiCam.setZoom(1);

    this.gameCam.ignore(this.uiLayer);
    this.uiCam.ignore(this.worldLayer);

    // --- UI ---
    this.interactHint = this.add.text(12, 12, "", {
      fontFamily: "monospace",
      fontSize: "14px",
      color: "#ffffff",
    });
    this.uiLayer.add(this.interactHint);

    // (debug UI removed)

    this.dialog = this.createDialogUI();
    this.createOnScreenControls();
    // (debug overlay removed)

    // --- Animations ---
    // Down/Up = 4 frames (0..3), Left/Right = 2 frames (0..1)
    // If your frame order differs, we’ll adjust, but this is the common setup.
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
      // 2-frame sheet; slightly faster cadence so feel matches 4-frame sheets
      frameRate: 12,
      repeat: -1,
    });
    this.anims.create({
      key: "walk_right",
      frames: this.anims.generateFrameNumbers("p_right", { start: 0, end: 1 }),
      frameRate: 12,
      repeat: -1,
    });

    // Layout
    this.layout();
    this.scale.on("resize", () => this.layout());
  }

  createDialogUI() {
    const ui = {};
    ui.container = this.add.container(0, 0);
    this.uiLayer.add(ui.container);

    ui.border = this.add.rectangle(0, 0, 300, 68, 0x111122).setOrigin(0.5);
    ui.inner = this.add.rectangle(0, 0, 292, 60, 0xe6e6f0).setOrigin(0.5);

    ui.text = this.add.text(0, 0, "", {
      fontFamily: "monospace",
      fontSize: "14px",
      color: "#111122",
      lineSpacing: 0,
      wordWrap: { width: 274 },
    }).setOrigin(0, 0);

    ui.container.add([ui.border, ui.inner, ui.text]);
    ui.container.setVisible(false);

    ui.isOpen = false;
    ui.open = (msg) => {
      ui.text.setText(msg);
      ui.container.setVisible(true);
      ui.isOpen = true;
    };
    ui.close = () => {
      ui.container.setVisible(false);
      ui.isOpen = false;
    };

    return ui;
  }

  createOnScreenControls() {
    const alpha = 0.60;

    // Visuals: use provided image assets for D-pad and A button.
    const dpadContainer = this.add.container(0, 0);
    const dpadImg = this.add.image(0, 0, 'ui_dpad').setOrigin(0.5).setScale(1.425);
    dpadContainer.add(dpadImg);
    this.uiLayer.add(dpadContainer);

    const aContainer = this.add.container(0, 0);
    // Larger visual scale for the A button (visual only — hit area unchanged)
    const aImg = this.add.image(0, 0, 'ui_a').setOrigin(0.5).setScale(2.2);
    // Keep the image as a standalone UI object so we can anchor its top precisely.
    this.uiLayer.add(aImg);
    // Keep the container (for the invisible hit area) separate so input logic is unchanged.
    this.uiLayer.add(aContainer);
    // Expose the visible A image and its container for layout logic
    this.aBtnImage = aImg;
    this.aBtnContainer = aContainer;

    // Keep a separate invisible circular hit area for the A button larger than the image
    const aHitRadius = Math.max(aImg.width, aImg.height) * A_HIT_SCALE;
    const aHit = this.add.circle(0, 0, aHitRadius, 0x000000, 0.001).setOrigin(0.5);
    aHit.setInteractive();
    aContainer.add(aHit);
    aHit.on('pointerdown', () => (this.touch.interact = true));
    aHit.on('pointerup', () => (this.touch.interact = false));
    this.input.on('pointerupoutside', (p) => {
      // ensure A release if pointer cancels outside
      aHit.emit('pointerup', p);
    });

    // D-pad input zone (thumb-driven) — circular hit area, separate from visual
    const dpadSize = 140;
    const deadzone = 12; // pixels
    const maxRadius = dpadSize * 0.5;
    const dpadHit = this.add.circle(0, 0, maxRadius, 0x000000, 0.001).setOrigin(0.5);
    dpadHit.setInteractive();
    this.uiLayer.add(dpadHit);

    this.uiControls = {
      dpad: { container: dpadContainer, image: dpadImg },
      a: { container: aContainer, image: aImg, hit: aHit },
      dpadHit: dpadHit,
    };

    this.dpadPointerId = null;

    const handleDpadPointer = (pointer) => {
      // Use the hit area's center for input calculations so visual offsets
      // of the D-pad do not affect control behavior.
      const bounds = this.uiControls.dpadHit.getBounds();
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
      if (absdx > absdy) dir = dx < 0 ? 'left' : 'right';
      else dir = dy < 0 ? 'up' : 'down';

      this.touch.left = dir === 'left';
      this.touch.right = dir === 'right';
      this.touch.up = dir === 'up';
      this.touch.down = dir === 'down';

      this.lastPressedTime[dir] = this.inputTick;
      this.lastAxisPressed = dir === 'left' || dir === 'right' ? 'x' : 'y';
      this.setFacing(dir);
    };

    dpadHit.on('pointerdown', (ptr) => {
      if (this.dpadPointerId != null) return;
      const bounds = this.uiControls.dpadHit.getBounds();
      const cx = bounds.centerX;
      const cy = bounds.centerY;
      const dx = ptr.worldX - cx;
      const dy = ptr.worldY - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > maxRadius) return;
      this.dpadPointerId = ptr.id;
      handleDpadPointer(ptr);
    });

    this.input.on('pointermove', (pointer) => {
      if (this.dpadPointerId === null) return;
      if (pointer.id !== this.dpadPointerId) return;
      handleDpadPointer(pointer);
    });

    const clearDpad = (pointer) => {
      if (pointer.id !== this.dpadPointerId) return;
      this.dpadPointerId = null;
      this.touch.left = this.touch.right = this.touch.up = this.touch.down = false;
    };

    this.input.on('pointerup', clearDpad);
    this.input.on('pointerupoutside', clearDpad);
    this.input.on('pointercancel', clearDpad);
  }

  layout() {
    const canvasW = this.scale.width;
    const canvasH = this.scale.height;
    // Safe-area aware control deck (always visible for GBA-style layout)
    const SAFE_BOTTOM = Math.max(16, canvasH * 0.04);
    const DECK_HEIGHT = Math.round(canvasH * 0.28);
    if (this.deckBg) this.deckBg.setVisible(true);

    // Compute where the deck should sit, then position the deckBg object
    const desiredDeckBottom = canvasH - SAFE_BOTTOM;
    const desiredDeckTop = desiredDeckBottom - DECK_HEIGHT;

    if (this.deckBg) {
      // size and place the deck background so its top aligns to desiredDeckTop
      this.deckBg.setDisplaySize(canvasW, DECK_HEIGHT);
      this.deckBg.setPosition(Math.floor(canvasW / 2), desiredDeckTop - CONTROL_TOP_PAD);
    }

    // Read authoritative deckTop from the deckBg object's bounds (guarantees we're aligned to the visible object)
    let deckTop;
    if (this.deckBg) {
      if (typeof this.deckBg.getTopLeft === 'function') deckTop = this.deckBg.getTopLeft().y;
      else deckTop = this.deckBg.getBounds().top;
    } else {
      deckTop = desiredDeckTop;
    }

    const deckBottom = deckTop + DECK_HEIGHT;
    const deckMidY = Math.floor((deckTop + deckBottom) / 2);

    // Fit the game viewport into the area above the deck
    const fitZoomX = canvasW / this.GAME_W;
    const fitZoomY = Math.max(0.01, deckTop / this.GAME_H);
    const fitZoom = Math.min(fitZoomX, fitZoomY);

    // Viewport dimensions based on fitZoom only (do not expand with camera zoom)
    const vpW = Math.floor(this.GAME_W * fitZoom);
    const vpH = Math.floor(this.GAME_H * fitZoom);
    const vpX = Math.floor((canvasW - vpW) / 2);
    // center the game viewport vertically inside [0, deckTop]
    let vpY = Math.floor((deckTop - vpH) / 2);
    // Shift entire game viewport down by SCREEN_SHIFT_Y so UI and game move together
    vpY += SCREEN_SHIFT_Y;

    // Apply camera closeness via multiplier only
    const WORLD_ZOOM_MULT = 1.0; // use neutral zoom so entire world is visible on mobile framing
    const gameCamZoom = fitZoom * WORLD_ZOOM_MULT;

    this.gameCam.setZoom(gameCamZoom);
    this.gameCam.roundPixels = true;
    this.gameCam.setViewport(vpX, vpY, vpW, vpH);
    // Configure camera to world bounds
    this.gameCam.setBounds(0, 0, this.GAME_W, this.GAME_H);
    // lock camera to top-left of the world (no follow)
    this.gameCam.setScroll(0, 0);

    // Camera is following the player (set in create()). Camera bounds
    // are configured above so the follow will never scroll outside the world.

    // Ensure props remain within world bounds so they are visible
    const MARGIN = 6;
    const clampProp = (obj) => {
      if (!obj) return;
      let x = obj.x;
      let y = obj.y;
      x = Phaser.Math.Clamp(x, MARGIN, this.GAME_W - MARGIN);
      y = Phaser.Math.Clamp(y, MARGIN, this.GAME_H - MARGIN);
      obj.setPosition(Math.round(x), Math.round(y));
    };
    clampProp(this.pc);
    clampProp(this.speakerL);
    clampProp(this.speakerR);

    // (speakers positioned in create(); collision footprints remain configured there)

    // UI camera covers the full canvas
    this.uiCam.setViewport(0, 0, canvasW, canvasH);
    // Shift UI layer down so UI visuals match the game viewport shift
    this.uiLayer.setPosition(0, SCREEN_SHIFT_Y);

    // Dialog placement (above deck)
    const dialogCenterX = Math.floor(canvasW / 2);
    const dialogCenterY = Math.floor(deckTop - 52);

    this.dialog.border.setPosition(dialogCenterX, dialogCenterY);
    this.dialog.inner.setPosition(dialogCenterX, dialogCenterY);
    this.dialog.text.setPosition(dialogCenterX - 140, dialogCenterY - 22);

    // Controls placement in deck
    // dpad centered vertically inside deck
    const padX = Math.max(18, Math.floor(canvasW * 0.05));
    const dpadCx = padX + 74;
    const dpadCy = deckMidY;

    const gap = 14;
    const step = gap + 28;

    // Position the D-pad visual + keep hit area unchanged (visuals unchanged except visual offset)
    if (this.uiControls && this.uiControls.dpad) {
      // Vertically center D-pad in the deck for strict alignment, then raise visuals slightly
      // and move the D-pad + hitbox down by 25px as requested.
      const DPAD_Y = deckMidY - ICON_RAISE + 25; // shift down 25px
      this.uiControls.dpad.container.setPosition(dpadCx + 8, DPAD_Y);
      if (this.uiControls.dpadHit) {
        // Keep control zone center matched to the D-pad image center (hit area moved as well)
        this.uiControls.dpadHit.setPosition(dpadCx + 8, DPAD_Y);
      }
    }

    const aX = canvasW - (padX + 74);

    // --- A button placement ---
    // Goal: the *visible A image top edge* must touch the top of the black deck.
    // We do this in two steps:
    //  1) Place container at (aX, deckTop) and put the image at local (0,0) with top-origin
    //  2) Measure the image's world-space top and apply a corrective delta if needed
    const A_TOP_PADDING = 10; // retained for debug/legacy calculations
    if ((this.uiControls && this.uiControls.a) || this.aBtnImage) {
      const aImg = this.aBtnImage || (this.uiControls && this.uiControls.a && this.uiControls.a.image);
      const aContainerObj = this.aBtnContainer || (this.uiControls && this.uiControls.a && this.uiControls.a.container);

      // Step 1: Position the visible PNG top exactly at deckTop
      aImg.setOrigin(0.5, 0);
      aImg.setPosition(aX, deckTop - ICON_RAISE);

      // Step 2: Keep the hit container centered on the A image so input logic is unchanged.
      // Place the container at the image's vertical center.
      const aDisplayH = aImg.displayHeight || (aImg.height * (aImg.scaleY || 1));
      if (aContainerObj) {
        aContainerObj.setPosition(aX, Math.floor(deckTop - ICON_RAISE + aDisplayH / 2));
      }

      // Measure using world-space bounds for debug and validation
      const aBtnTop = aImg.getBounds().top;
      const aBtnTop2 = aBtnTop;

      // (debug overlay removed)
    }
    // (debug overlay update removed)
  }

  setFacing(direction) {
    if (this.facing === direction) return;
    this.facing = direction;

    // Swap texture so the sprite visually changes direction.
    // Do NOT force the idle frame here — that would restart animations.
    if (direction === "down") this.player.setTexture("p_down");
    if (direction === "up") this.player.setTexture("p_up");
    if (direction === "left") this.player.setTexture("p_left");
    if (direction === "right") this.player.setTexture("p_right");
  }

  playWalk(direction) {
    // Ensure correct spritesheet is active before playing its animation
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
    // Stop animation and snap to idle frame for current facing
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
    // Dialog mode: A closes
    if (this.dialog.isOpen) {
      const closePressed =
        Phaser.Input.Keyboard.JustDown(this.keyA) ||
        Phaser.Input.Keyboard.JustDown(this.keySpace) ||
        this.touch.interact;

      if (closePressed) this.dialog.close();
      this.touch.interact = false;
      this.stopWalk();
      return;
    }

    this.inputTick += 1;

    // Movement input
    const leftPressed = this.cursors.left.isDown || this.touch.left;
    const rightPressed = this.cursors.right.isDown || this.touch.right;
    const upPressed = this.cursors.up.isDown || this.touch.up;
    const downPressed = this.cursors.down.isDown || this.touch.down;

    const leftJustPressed =
      Phaser.Input.Keyboard.JustDown(this.cursors.left) ||
      (this.touch.left && !this.prevTouch.left);
    const rightJustPressed =
      Phaser.Input.Keyboard.JustDown(this.cursors.right) ||
      (this.touch.right && !this.prevTouch.right);
    const upJustPressed =
      Phaser.Input.Keyboard.JustDown(this.cursors.up) ||
      (this.touch.up && !this.prevTouch.up);
    const downJustPressed =
      Phaser.Input.Keyboard.JustDown(this.cursors.down) ||
      (this.touch.down && !this.prevTouch.down);

    if (leftJustPressed) this.lastPressedTime.left = this.inputTick;
    if (rightJustPressed) this.lastPressedTime.right = this.inputTick;
    if (upJustPressed) this.lastPressedTime.up = this.inputTick;
    if (downJustPressed) this.lastPressedTime.down = this.inputTick;

    // Track which axis was pressed last so diagonal movement prefers that axis
    if (leftJustPressed || rightJustPressed) this.lastAxisPressed = 'x';
    if (upJustPressed || downJustPressed) this.lastAxisPressed = 'y';

    // Instant turn: on any just-pressed direction, immediately update facing
    if (leftJustPressed) this.setFacing('left');
    if (rightJustPressed) this.setFacing('right');
    if (upJustPressed) this.setFacing('up');
    if (downJustPressed) this.setFacing('down');

    this.prevTouch.left = this.touch.left;
    this.prevTouch.right = this.touch.right;
    this.prevTouch.up = this.touch.up;
    this.prevTouch.down = this.touch.down;

    const speed = 80;
    const body = this.player.body;

    body.setVelocity(0);

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

    // Decide moving direction. If both axes pressed, prefer lastAxisPressed.
    let movingDir = null;
    if (horizontalDir && verticalDir) {
      movingDir = this.lastAxisPressed === 'x' ? horizontalDir : verticalDir;
    } else {
      movingDir = horizontalDir ?? verticalDir;
    }

    if (moveX !== 0) body.setVelocityX(moveX * speed);
    if (moveY !== 0) body.setVelocityY(moveY * speed);

    body.velocity.normalize().scale(speed);

    // Stop movement when body hits world bounds; rely on physics for clamping.
    if (this.player && this.player.body) {
      const b = this.player.body;
      if (b.blocked.left && body.velocity.x < 0) body.setVelocityX(0);
      if (b.blocked.right && body.velocity.x > 0) body.setVelocityX(0);
      if (b.blocked.up && body.velocity.y < 0) body.setVelocityY(0);
      if (b.blocked.down && body.velocity.y > 0) body.setVelocityY(0);
    }

    // Animations
    const isMoving = body.velocity.lengthSq() > 0.1;

    if (isMoving && movingDir) this.playWalk(movingDir);
    else this.stopWalk();

    // PC overlap hint
    const inPC = this.physics.overlap(this.player, this.pcZone);
    this.interactHint.setText(inPC ? "A / Space: Interact" : "");

    const interactPressed =
      (inPC &&
        (Phaser.Input.Keyboard.JustDown(this.keyA) ||
          Phaser.Input.Keyboard.JustDown(this.keySpace))) ||
      (inPC && this.touch.interact);

    if (interactPressed) {
      this.dialog.open("PC: Beats\nSelect a beat.\n\nPress A to close.");
    }
    // Depth-sorting: layer world objects by their Y coordinate so the player
    // naturally appears in front of items when below them and behind when above.
    const depthSort = (objs) => {
      objs.forEach((o) => {
        if (!o || typeof o.y !== 'number' || typeof o.setDepth !== 'function') return;
        // add small offset so player can beat ties
        o.setDepth(Math.round(o.y));
      });
    };

    depthSort([this.pc, this.speakerL, this.speakerR]);
    if (this.player && typeof this.player.y === 'number') this.player.setDepth(Math.round(this.player.y) + 1);

    this.touch.interact = false;
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "app",
  width: 320,
  height: 320,
  backgroundColor: "#000000",
  pixelArt: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: "arcade",
    arcade: { debug: false },
  },
  scene: [RoomScene],
});
