import Phaser from "phaser";
import {
  DEBUG_UI,
  FEET_H,
  FEET_OFFSET_X,
  FEET_OFFSET_Y,
  FEET_W,
  GAME_H,
  GAME_W,
  LOCAL_IDENTITY_KEY,
  PLAYER_SCALE,
  RUN_HOLD_MS,
  RUN_MULT,
  SPEED,
  WORLD_ZOOM,
  normalizeShopItems,
} from "../config/gameConfig";
import GameMusic from "../systems/GameMusic";
import ComputerShop from "../systems/ComputerShop";
import TVOverlay from "../systems/TVOverlay";
import RemoteState from "../systems/RemoteState";
import EmailCaptureOverlay from "../ui/EmailCaptureOverlay";
import ArcadeOverlay from "../arcade/ArcadeOverlay";
class RoomScene extends Phaser.Scene {
  constructor({ key = "room", variant = "room" } = {}) {
    super(key);
    this.variant = variant;
  }

  init(data) {
    this.spawnData = data?.spawn || null;
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
    this.load.image("ssl", "/assets/room/ssl.png");
    this.load.image("spkL", "/assets/room/speakerv2_L.png");
    this.load.image("spkR", "/assets/room/speakerv2_R.png");
    this.load.image("studer", "/assets/room/studer.png");
    this.load.image("studer_controller", "/assets/room/studer_controller.png");
    this.load.image("couch", "/assets/room/couch.png");
    this.load.image("tv", "/assets/room/tv.png");
    this.load.image("arcade", "/assets/room/arcade.png");
    this.load.image("ui_dpad", "/assets/ui/dpad.png");
    this.load.image("ui_a", "/assets/ui/abutton.png");
    this.load.image("ui_b", "/assets/ui/bbutton.png");
    this.load.image("ui_bezel", "/assets/ui/screen_bezel.png");
    this.load.image("ui_deck", "/assets/ui/bottom_deck.png");
    this.load.image("door_rug", "/assets/ui/turkish_rug.png");
    this.load.image("floor", "/assets/room/floor.png");
    this.load.json("shop_data", "/data/shop.json");
  }

  isMainRoom() {
    return this.variant !== "trophy";
  }

  isTrophyRoom() {
    return this.variant === "trophy";
  }

  isCoffeeItem(item) {
    const name = String(item?.name || "").toLowerCase();
    const id = String(item?.id || "").toLowerCase();
    return name === "buymecoffee" || name === "buy me a coffee" || id === "coffee";
  }

  getPurchasableBeatItems() {
    const shopData = this.cache.json.get("shop_data") || {};
    const pageSize = Number.isFinite(shopData?.pageSize) ? shopData.pageSize : 5;
    const items = normalizeShopItems(shopData?.items || [], pageSize);
    return items.filter((item) => !this.isCoffeeItem(item));
  }

  readLocalIdentity() {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(LOCAL_IDENTITY_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      return {
        userId: parsed.userId || "",
        name: parsed.name || "",
        email: parsed.email || "",
      };
    } catch {
      return null;
    }
  }

  saveLocalIdentity(identity) {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(LOCAL_IDENTITY_KEY, JSON.stringify(identity));
    } catch {}
  }

  clearRunHoldTimer() {
    if (this.aHoldTimer) {
      this.aHoldTimer.remove(false);
      this.aHoldTimer = null;
    }
  }

  resetInputState() {
    if (this.touch) {
      this.touch.left = false;
      this.touch.right = false;
      this.touch.up = false;
      this.touch.down = false;
      this.touch.interact = false;
    }
    this.runHeld = false;
    this.aIsDown = false;
    this.aDownAt = 0;
    this.pendingInteractUntil = 0;
    this.dpadPointerId = null;
    this.aPointerId = null;
    this.bPointerId = null;
    this.dpadLockDir = null;
    this.dpadDesiredDir = null;
    this.dpadMoveEnabledAt = 0;
    this.arcadeTouchAJust = false;
    this.arcadeTouchBJust = false;
    this.clearRunHoldTimer();

    const body = this.player?.body;
    if (body?.setVelocity) body.setVelocity(0);
    if (this.player?.anims) this.stopWalk();
  }

  clearTouchMoveFlags() {
    if (!this.touch) return;
    this.touch.left = false;
    this.touch.right = false;
    this.touch.up = false;
    this.touch.down = false;
  }

  setDpadTouchDirection(dir, now) {
    const hasDir = typeof dir === "string" && dir.length > 0;
    this.dpadLockDir = hasDir ? dir : null;
    this.dpadDesiredDir = hasDir ? dir : null;

    if (!hasDir) {
      this.dpadMoveEnabledAt = 0;
      this.clearTouchMoveFlags();
      return;
    }

    this.lastPressedTime[dir] = this.inputTick;
    const inWorldMovementMode =
      !this.dialogOpen &&
      !this.shop?.isOpen &&
      !this.tvOverlay?.isOpen &&
      !this.arcadeOverlay?.isOpen &&
      !this.uiModalOpen &&
      !this.arcadeOpenPending;
    const body = this.player?.body;
    const isMovingNow =
      !!this.touch.left ||
      !!this.touch.right ||
      !!this.touch.up ||
      !!this.touch.down ||
      !!(body && body.velocity && body.velocity.lengthSq() > 1);

    if (inWorldMovementMode && dir !== this.facing) {
      this.setFacing(dir);
      if (!isMovingNow) {
        const skipTurnHoldOnStartup =
          Number.isFinite(this._startupNoTurnHoldUntil) && now < this._startupNoTurnHoldUntil;
        const useTurnHold = !this._isCoarsePointer;
        if (!skipTurnHoldOnStartup && useTurnHold) {
          // Pokemon-style turn-in-place only when starting from idle.
          this.stopWalk();
          this.clearTouchMoveFlags();
          this.dpadMoveEnabledAt = now + this.turnHoldMs;
          return;
        }
      }
    }

    this.dpadMoveEnabledAt = now;
    this.applyDpadTouchMovement(now);
  }

  applyDpadTouchMovement(now) {
    const dir = this.dpadDesiredDir;
    if (!dir || now < this.dpadMoveEnabledAt) {
      this.clearTouchMoveFlags();
      return;
    }

    this.touch.left = dir === "left";
    this.touch.right = dir === "right";
    this.touch.up = dir === "up";
    this.touch.down = dir === "down";
  }

  tryPlayArcadeInteractSfx() {
    const sound = this.sound;
    if (!sound) return;
    const candidates = ["ui_blip", "ui_click", "click", "confirm", "sfx_ui"];
    for (let i = 0; i < candidates.length; i += 1) {
      const key = candidates[i];
      const loaded = !!sound.get?.(key) || !!this.cache?.audio?.exists?.(key);
      if (!loaded) continue;
      try {
        sound.play(key, { volume: 0.45 });
      } catch {}
      return;
    }
  }

  clearArcadeHumMessage() {
    if (this.arcadeHumMessageUi) {
      this.safeDestroyObject(this.arcadeHumMessageUi);
      this.arcadeHumMessageUi = null;
    }
  }

  showArcadeHumMessage() {
    this.clearArcadeHumMessage();

    const cam = this.gameCam;
    const vpX = Math.round(cam?.x || 0);
    const vpY = Math.round(cam?.y || 0);
    const vpW = Math.round(cam?.width || this.scale?.width || 0);
    const vpH = Math.round(cam?.height || this.scale?.height || 0);

    const boxW = Math.max(120, Math.min(232, vpW - 12));
    const boxH = 22;
    const boxX = Math.round(vpX + (vpW - boxW) / 2);
    const boxY = Math.round(vpY + vpH - boxH - 6);

    const container = this.add.container(0, 0).setDepth(15000);
    const border = this.add.rectangle(boxX, boxY, boxW, boxH, 0x111111, 1).setOrigin(0, 0);
    const fill = this.add.rectangle(boxX + 2, boxY + 2, boxW - 4, boxH - 4, 0xffffff, 1).setOrigin(0, 0);
    const text = this.add.text(boxX + 8, boxY + 5, "The arcade hums softly...", {
      fontFamily: "monospace",
      fontSize: "11px",
      color: "#111111",
    }).setOrigin(0, 0);
    container.add([border, fill, text]);
    this.uiLayer.add(container);
    this.arcadeHumMessageUi = container;
  }

  cancelPendingArcadeOpen() {
    this.arcadeOpenPending = false;
    if (this.arcadeOpenTimer) {
      this.arcadeOpenTimer.remove(false);
      this.arcadeOpenTimer = null;
    }
    this.clearArcadeHumMessage();
  }

  freezePlayer() {
    if (!this.player || !this.player.body) return;
    this.touch.interact = false;
    this.runHeld = false;
    const body = this.player.body;
    if (body) body.setVelocity(0);
    this.stopWalk();
    const playerBaseY = this.player.body ? this.player.body.bottom : this.player.y;
    this.player.setDepth(playerBaseY);
    if (this.isTrophyRoom()) this.syncTrophyPillarDepths(playerBaseY);
    if (this.worldLayer?.sort) this.worldLayer.sort("depth");
  }

  syncTrophyPillarDepths(playerDepth) {
    if (!this.isTrophyRoom() || !Array.isArray(this.trophyPillars)) return;
    const resolvedPlayerDepth =
      Number.isFinite(playerDepth) ? playerDepth : this.player?.body?.bottom ?? this.player?.getBottomCenter?.().y;

    // Classic Pokemon-style layering: compare player feet Y vs pillar base anchor Y.
    if (Number.isFinite(resolvedPlayerDepth)) {
      this.player.setDepth(resolvedPlayerDepth);
    }

    for (let i = 0; i < this.trophyPillars.length; i += 1) {
      const pillar = this.trophyPillars[i];
      const anchorY =
        pillar?.depthAnchorY ??
        pillar?.blocker?.getBottomCenter?.().y ??
        pillar?.shaft?.getBottomCenter?.().y ??
        pillar?.shaft?.y ??
        0;

      pillar.depthAnchorY = anchorY;
      if (pillar?.visual?.setDepth) {
        pillar.visual.setDepth(anchorY + 0.01);
      } else {
        pillar.shaft?.setDepth?.(anchorY);
        pillar.cap?.setDepth?.(anchorY + 0.01);
        pillar.accent?.setDepth?.(anchorY + 0.02);
      }
      pillar.blocker?.setDepth?.(anchorY);
      if (pillar.trophy?.visible) pillar.trophy.setDepth(anchorY + 0.03);
    }
  }

  getTrophyRoomInnerBounds() {
    const bounds = this.physics?.world?.bounds;
    const worldX = Number.isFinite(bounds?.x) ? bounds.x : 0;
    const worldY = Number.isFinite(bounds?.y) ? bounds.y : 0;
    const worldW = Number.isFinite(bounds?.width) ? bounds.width : GAME_W;
    const worldH = Number.isFinite(bounds?.height) ? bounds.height : GAME_H;
    const wallThickness = 14;

    return {
      innerLeft: Math.round(worldX + wallThickness),
      innerRight: Math.round(worldX + worldW - wallThickness),
      innerTop: Math.round(worldY + wallThickness),
      innerBottom: Math.round(worldY + worldH - wallThickness),
      wallThickness,
    };
  }

  getTrophyPedestalSlots(count) {
    const total = Math.max(0, Math.floor(Number(count) || 0));
    if (total <= 0) return [];

    const cols = 4;
    const rows = Math.max(1, Math.ceil(total / cols));
    const { innerLeft, innerRight, innerTop, innerBottom } = this.getTrophyRoomInnerBounds();

    const centerX = Math.round((innerLeft + innerRight) / 2);
    const aisleWidth = 42;
    const columnGap = 30;
    const nearAisleOffset = Math.round(aisleWidth / 2) + 8;
    const farAisleOffset = nearAisleOffset + columnGap;

    const minX = innerLeft + 24;
    const maxX = innerRight - 24;
    const columns = [
      Phaser.Math.Clamp(centerX - farAisleOffset, minX, maxX),
      Phaser.Math.Clamp(centerX - nearAisleOffset, minX, maxX),
      Phaser.Math.Clamp(centerX + nearAisleOffset, minX, maxX),
      Phaser.Math.Clamp(centerX + farAisleOffset, minX, maxX),
    ];

    const rowTop = innerTop + 48;
    const rowBottom = innerBottom - 12;
    const rowYs = this.distributeEvenly(rows, rowTop, rowBottom, 0);

    const slots = [];
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        slots.push({ x: columns[c], y: rowYs[r] });
        if (slots.length >= total) return slots;
      }
    }
    return slots;
  }

  distributeEvenly(count, start, end, edgePadding = 0) {
    if (!Number.isFinite(count) || count <= 0) return [];
    const min = Math.min(start, end);
    const max = Math.max(start, end);
    const s = min + Math.max(0, edgePadding);
    const e = max - Math.max(0, edgePadding);
    if (count === 1 || e <= s) return [Math.round((s + e) / 2)];

    const step = (e - s) / (count - 1);
    const out = [];
    for (let i = 0; i < count; i += 1) {
      out.push(Math.round(s + step * i));
    }
    return out;
  }

  allocateCountsByLength(total, lengths, minEach = 0) {
    const keys = Object.keys(lengths || {});
    const counts = {};
    keys.forEach((key) => {
      counts[key] = 0;
    });
    if (!Number.isFinite(total) || total <= 0 || keys.length === 0) return counts;

    const safeMin = total >= keys.length * minEach ? minEach : 0;
    keys.forEach((key) => {
      counts[key] = safeMin;
    });

    let remaining = total - safeMin * keys.length;
    if (remaining <= 0) return counts;

    const safeLengths = keys.map((key) => ({
      key,
      len: Math.max(0, Number(lengths[key]) || 0),
    }));
    const sumLen = safeLengths.reduce((sum, item) => sum + item.len, 0);
    const useEvenWeights = sumLen <= 0;

    const fractional = safeLengths.map((item) => {
      const weight = useEvenWeights ? 1 : item.len;
      const raw = useEvenWeights ? remaining / keys.length : (remaining * weight) / sumLen;
      const base = Math.floor(raw);
      counts[item.key] += base;
      return { key: item.key, frac: raw - base };
    });

    remaining = total - keys.reduce((sum, key) => sum + counts[key], 0);
    fractional.sort((a, b) => b.frac - a.frac);
    for (let i = 0; i < remaining; i += 1) {
      counts[fractional[i % fractional.length].key] += 1;
    }
    return counts;
  }

  addInteractable({ id, sprite, text, getInteractRect, meta }) {
    const base = sprite.blocker ? sprite.blocker.getBottomCenter() : sprite.getBottomCenter();
    const interactPointX = Math.round(base.x);
    const interactPointY = Math.round(base.y + 6);
    const entry = { id, sprite, text, interactPointX, interactPointY, getInteractRect, meta };
    this.interactables.push(entry);
    return entry;
  }

  makeBlocker(sprite, widthRatio, heightPx) {
    const blockerW = Math.floor(sprite.displayWidth * widthRatio);
    const blockerH = heightPx;
    const base = sprite.getBottomCenter();
    const blockerX = base.x;
    const blockerY = base.y - Math.floor(blockerH / 2);
    const blocker = this.add.rectangle(
      blockerX,
      blockerY,
      blockerW,
      blockerH,
      0x00ff00,
      DEBUG_UI ? 0.25 : 0
    );
    this.worldLayer.add(blocker);
    this.physics.add.existing(blocker, true);
    this.physics.add.collider(this.player, blocker);
    const baseY = blocker.getBottomCenter().y;
    sprite.setDepth(baseY);
    blocker.setDepth(baseY);
    sprite.blocker = blocker;
    return blocker;
  }

  createDoorZone({ x, y, width, height, toScene, spawn }) {
    const zone = this.add.zone(x, y, width, height);
    zone.setOrigin(0.5, 0.5);
    this.physics.add.existing(zone, true);
    this.physics.add.overlap(this.player, zone, () => {
      this.startDoorTransition(toScene, spawn);
    });

    if (DEBUG_UI) {
      const viz = this.add.rectangle(x, y, width, height, 0x00ffff, 0.18);
      viz.setDepth(10000);
      this.worldLayer.add(viz);
    }
  }

  placeDoorRug({ x, y, width, height, side }) {
    const hasRug = this.textures.exists("door_rug");
    if (!hasRug) return;

    const rug = this.add.image(x, y, "door_rug").setOrigin(0.5, 0.5);
    rug.setPipeline("TextureTintPipeline");
    this.textures.get("door_rug").setFilter(Phaser.Textures.FilterMode.NEAREST);

    const texture = this.textures.get("door_rug").getSourceImage();
    const rugW = texture?.width || rug.width || 16;
    const rugH = texture?.height || rug.height || 12;

    const targetW = Math.max(10, Math.round(width + 12));
    const scale = (targetW / Math.max(1, rugW)) * 2;
    rug.setScale(scale);
    rug.setAngle(90);

    const inset = 6;
    const offsetX = side === "right" ? -inset : side === "left" ? inset : 0;
    rug.setPosition(Math.round(x + offsetX), Math.round(y + Math.max(0, height * 0.15)));

    // Keep rug below moving entities/props.
    rug.setDepth(Math.max(0, Math.round(rug.y + (rugH * scale) / 2 - 40)));
    this.worldLayer.add(rug);
  }

  startDoorTransition(toScene, spawn) {
    const now = this.time?.now || Date.now();
    const cooldownMs = this.transitionCooldownMs || 400;
    if (this.isSceneTransitioning || this.isTransitioning) return;
    if (this.lastTransitionAt && now - this.lastTransitionAt < cooldownMs) return;
    if (
      this.dialogOpen ||
      this.shop?.isOpen ||
      this.tvOverlay?.isOpen ||
      this.arcadeOverlay?.isOpen ||
      this.arcadeOpenPending ||
      this.uiModalOpen
    ) {
      return;
    }

    // Desktop repro stack captured while returning Trophy -> Room:
    // TypeError: Cannot read properties of undefined (reading 'radius')
    //   at RoomScene._onControlPointerDown (RoomScene.js:962:31)
    //   at InputPlugin.emit (phaser.js)
    //   at InputManager.update (phaser.js)
    // Mobile remote inspector showed the same error signature.
    // Root cause: stale/duplicate input listeners surviving scene restarts.
    // Fix: explicit listener teardown + transition lock/cooldown + guarded scene.start().
    this.isSceneTransitioning = true;
    this.isTransitioning = true;
    this.lastTransitionAt = now;

    try {
      this.resetInputState();
      this.cancelPendingArcadeOpen();
      this.shop?.close?.();
      this.tvOverlay?.close?.();
      this.arcadeOverlay?.close?.();
      if (this.emailOverlay?.isOpen?.()) this.emailOverlay.close();
      this.scene.start(toScene, { spawn });
    } catch (err) {
      this.isSceneTransitioning = false;
      this.isTransitioning = false;
      this.showTransitionError(err, toScene);
    }
  }

  showTransitionError(err, toScene) {
    const message = err?.stack || err?.message || String(err);
    console.error("[SceneTransition] failed", { from: this.scene.key, to: toScene, error: message });

    this.transitionFailed = true;
    this.resetInputState();

    if (this.transitionErrorUi?.container) return;

    const container = this.add.container(0, 0).setDepth(20000);
    const bg = this.add.rectangle(0, 0, this.scale.width, this.scale.height, 0x000000, 0.9).setOrigin(0, 0);
    const title = this.add.text(10, 10, "Transition error", {
      fontFamily: "monospace",
      fontSize: "14px",
      color: "#ff5555",
    });
    const body = this.add.text(10, 30, message.slice(0, 700), {
      fontFamily: "monospace",
      fontSize: "10px",
      color: "#ffffff",
      wordWrap: { width: Math.max(180, this.scale.width - 20) },
    });
    container.add([bg, title, body]);
    this.uiLayer.add(container);
    this.transitionErrorUi = { container, bg, title, body };
  }

  ensurePlayerAnims() {
    if (!this.anims.exists("walk_down")) {
      this.anims.create({
        key: "walk_down",
        frames: this.anims.generateFrameNumbers("p_down", { start: 0, end: 3 }),
        frameRate: 8,
        repeat: -1,
      });
    }
    if (!this.anims.exists("walk_up")) {
      this.anims.create({
        key: "walk_up",
        frames: this.anims.generateFrameNumbers("p_up", { start: 0, end: 3 }),
        frameRate: 8,
        repeat: -1,
      });
    }
    if (!this.anims.exists("walk_left")) {
      this.anims.create({
        key: "walk_left",
        frames: this.anims.generateFrameNumbers("p_left", { start: 0, end: 1 }),
        frameRate: 8,
        repeat: -1,
      });
    }
    if (!this.anims.exists("walk_right")) {
      this.anims.create({
        key: "walk_right",
        frames: this.anims.generateFrameNumbers("p_right", { start: 0, end: 1 }),
        frameRate: 8,
        repeat: -1,
      });
    }
  }

  detachControlInputListeners() {
    if (!this._onControlPointerDown) return;
    this.input.off("pointerdown", this._onControlPointerDown);
    this.input.off("pointermove", this._onControlPointerMove);
    this.input.off("pointerup", this._onControlPointerEnd);
    this.input.off("pointerupoutside", this._onControlPointerEnd);
    this.input.off("pointercancel", this._onControlPointerEnd);
    this._onControlPointerDown = null;
    this._onControlPointerMove = null;
    this._onControlPointerEnd = null;
  }

  attachLifecycleListeners() {
    this.detachLifecycleListeners();
    this._onVisualViewportResize = () => this.layout();
    this._onVisualViewportScroll = () => this.layout();
    window.visualViewport?.addEventListener("resize", this._onVisualViewportResize);
    window.visualViewport?.addEventListener("scroll", this._onVisualViewportScroll);

    this._onMusicGesture = () => {
      if (this.uiModalOpen) return;
      this._warmupHasUserGesture = true;
      if (this.gameMusic) this.gameMusic.startFromGesture();
    };
    this.input.on("pointerdown", this._onMusicGesture);
    this.input.keyboard?.on("keydown", this._onMusicGesture);

    this._onScaleResize = () => this.layout();
    this.scale.on("resize", this._onScaleResize);
  }

  detachLifecycleListeners() {
    if (this._onVisualViewportResize) {
      window.visualViewport?.removeEventListener("resize", this._onVisualViewportResize);
      this._onVisualViewportResize = null;
    }
    if (this._onVisualViewportScroll) {
      window.visualViewport?.removeEventListener("scroll", this._onVisualViewportScroll);
      this._onVisualViewportScroll = null;
    }
    if (this._onMusicGesture) {
      this.input.off("pointerdown", this._onMusicGesture);
      this.input.keyboard?.off("keydown", this._onMusicGesture);
      this._onMusicGesture = null;
    }
    if (this._onScaleResize) {
      this.scale.off("resize", this._onScaleResize);
      this._onScaleResize = null;
    }
  }

  destroySystems() {
    this.shop?.destroy?.();
    this.tvOverlay?.destroy?.();
    this.gameMusic?.destroy?.();
    this.emailOverlay?.destroy?.();
    this.arcadeOverlay?.destroy?.();
    this.shop = null;
    this.tvOverlay = null;
    this.gameMusic = null;
    this.emailOverlay = null;
    this.arcadeOverlay = null;
  }

  safeDestroyObject(obj) {
    try {
      obj?.destroy?.();
    } catch {}
  }

  resetUiObjectRefs() {
    this.screenBezel = null;
    this.deckBg = null;
    this.dpadVisual = null;
    this.dpadImg = null;
    this.aVisual = null;
    this.aImg = null;
    this.bVisual = null;
    this.bImg = null;
    this.dpadHit = null;
    this.aHit = null;
    this.bHit = null;
    this.dialogContainer = null;
    this.dialogBorder = null;
    this.dialogFill = null;
    this.dialogText = null;
    this.wrapProbeText = null;
    this.interactProbe = null;
    this.interactCandidateOutline = null;
    this._perfHudText = null;
    this._perfHudStart = 0;
    this._perfHudMaxDt = 0;
    this._perfHudHitches = 0;
    this._perfHudLayoutCount = 0;
    this._perfHudActive = false;
    this.uiBound = false;
  }

  destroyUiObjects() {
    this.safeDestroyObject(this.wrapProbeText);
    this.safeDestroyObject(this.dialogContainer);
    this.safeDestroyObject(this.dpadVisual);
    this.safeDestroyObject(this.aVisual);
    this.safeDestroyObject(this.bVisual);
    this.safeDestroyObject(this.deckBg);
    this.safeDestroyObject(this.dpadHit);
    this.safeDestroyObject(this.aHit);
    this.safeDestroyObject(this.bHit);
    this.safeDestroyObject(this.screenBezel);
    this.safeDestroyObject(this.interactProbe);
    this.safeDestroyObject(this.interactCandidateOutline);
    this.safeDestroyObject(this._perfHudText);
    this.safeDestroyObject(this.transitionErrorUi?.container);
    this.transitionErrorUi = null;
    this.resetUiObjectRefs();
  }

  isValidDisplayObject(obj) {
    return !!(obj && obj.scene && obj.active !== false);
  }

  isValidShape(obj) {
    return this.isValidDisplayObject(obj) && !!obj.geom;
  }

  buildDialogUi() {
    if (!this.uiLayer || this.isShuttingDown) return;
    this.destroyDialogUi();
    this.dialogContainer = this.add.container(0, 0);
    this.dialogBorder = this.add.rectangle(0, 0, 10, 10, 0x111111).setOrigin(0, 0);
    this.dialogFill = this.add.rectangle(0, 0, 10, 10, 0xffffff).setOrigin(0, 0);
    this.dialogText = this.add.text(0, 0, "", {
      fontFamily: "monospace",
      fontSize: "14px",
      color: "#111111",
      lineSpacing: 2,
      wordWrap: { width: 100 },
    });
    this.dialogContainer.add([this.dialogBorder, this.dialogFill, this.dialogText]);
    this.dialogContainer.setVisible(false);
    this.uiLayer.add(this.dialogContainer);
  }

  destroyDialogUi() {
    this.safeDestroyObject(this.wrapProbeText);
    this.wrapProbeText = null;
    this.safeDestroyObject(this.dialogContainer);
    this.dialogContainer = null;
    this.dialogBorder = null;
    this.dialogFill = null;
    this.dialogText = null;
  }

  ensureDialogUiAlive() {
    if (
      this.isValidDisplayObject(this.dialogContainer) &&
      this.isValidShape(this.dialogBorder) &&
      this.isValidShape(this.dialogFill) &&
      this.isValidDisplayObject(this.dialogText)
    ) {
      return true;
    }

    // Crash repro (desktop + mobile inspector):
    // Uncaught TypeError: can't access property "setSize", this.geom is null
    // setSize phaser.js:79338 -> layout RoomScene.js:1223 -> createControls RoomScene.js:1138 -> create RoomScene.js:512
    // Root cause: stale Rectangle refs from a previous scene instance became destroyed before layout.
    this.buildDialogUi();
    return (
      this.isValidDisplayObject(this.dialogContainer) &&
      this.isValidShape(this.dialogBorder) &&
      this.isValidShape(this.dialogFill) &&
      this.isValidDisplayObject(this.dialogText)
    );
  }

  ensureControlHitArea(refName, radius) {
    let shape = this[refName];
    if (!this.isValidShape(shape)) {
      this.safeDestroyObject(shape);
      if (!this.uiLayer || this.isShuttingDown) return null;
      shape = this.add.circle(0, 0, radius, 0x000000, 0.001);
      this.uiLayer.add(shape);
      this[refName] = shape;
    }
    return shape;
  }

  cleanupScene() {
    this.isShuttingDown = true;
    this.isSceneTransitioning = false;
    this.isTransitioning = false;
    this.uiModalOpen = false;
    this.cancelPendingArcadeOpen();
    this.setModalKeyboardCapture(false);
    this.detachLifecycleListeners();
    this.detachControlInputListeners();
    this.resetInputState();
    this.clearRunHoldTimer();
    this.destroySystems();
    this.destroyUiObjects();
    if (this.layoutSettleTimer) {
      this.layoutSettleTimer.remove(false);
      this.layoutSettleTimer = null;
    }
    if (this.trophyPollTimer) {
      this.trophyPollTimer.remove(false);
      this.trophyPollTimer = null;
    }
  }

  create() {
    this.isShuttingDown = false;
    this.isSceneTransitioning = false;
    this.isTransitioning = false;
    this.lastTransitionAt = 0;
    this.transitionCooldownMs = 400;
    this.transitionFailed = false;
    this.transitionErrorUi = null;
    this.layoutSettleTimer = null;
    this.resetUiObjectRefs();
    this.worldLayer = this.add.container(0, 0);
    this.uiLayer = this.add.container(0, 0);
    this.remoteState = new RemoteState();
    this.localIdentity = this.readLocalIdentity();
    this.identitySubmitted = !!(this.localIdentity?.name && this.localIdentity?.email);
    this.shopOpenedAt = 0;
    this.emailPromptSnoozedThisSession = false;
    this.emailOverlayWasOpen = false;
    this.uiModalOpen = false;
    this.arcadeTouchAJust = false;
    this.arcadeTouchBJust = false;
    this.arcadeOpenPending = false;
    this.arcadeOpenTimer = null;
    this.arcadeHumMessageUi = null;
    this._isCoarsePointer =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches;
    this._bootWarmupRemainingMs = 0;
    this._bootWarmupDidPrewarm = false;
    this._startupNoTurnHoldUntil = this.time.now + 1200;

    const floor = this.add.tileSprite(0, 0, GAME_W, GAME_H, "floor").setOrigin(0, 0);
    floor.setDepth(0);
    floor.setPosition(0, 0);
    if (typeof floor.setTileScale === "function") floor.setTileScale(2, 2);
    else {
      floor.tileScaleX = 2;
      floor.tileScaleY = 2;
    }
    floor.setPipeline("TextureTintPipeline");
    this.textures.get("floor").setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.worldLayer.add(floor);

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

    if (this.spawnData && Number.isFinite(this.spawnData.x) && Number.isFinite(this.spawnData.y)) {
      this.player.setPosition(this.spawnData.x, this.spawnData.y);
      if (this.spawnData.facing) this.facing = this.spawnData.facing;
    }

    this.cursors = this.input.keyboard.createCursorKeys();
    this.keyA = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.keySpace = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.keyShift = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    this.keyB = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.B);
    this.keyEsc = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.keyboardPreventDefaultBeforeModal = this.input?.keyboard?.preventDefault ?? true;
    this.input.addPointer(3);
    try {
      const c = this.game?.canvas;
      if (c) c.style.touchAction = "none";
    } catch {}

    this.touch = { left: false, right: false, up: false, down: false, interact: false };
    this.lastPressedTime = { left: 0, right: 0, up: 0, down: 0 };
    this.inputTick = 0;
    this.pendingInteractUntil = 0;
    this.uiBound = false;
    this.turnHoldMs = 110;
    this.dpadLockDir = null;
    this.dpadDesiredDir = null;
    this.dpadMoveEnabledAt = 0;
    this.runHeld = false;
    this.aIsDown = false;
    this.aDownAt = 0;
    this.aHoldTimer = null;
    this.aPointerId = null;
    this.bPointerId = null;

    this.gameCam = this.cameras.main;
    this.uiCam = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    this.gameCam.roundPixels = true;
    this.uiCam.roundPixels = true;
    this.gameCam.ignore(this.uiLayer);
    this.uiCam.ignore(this.worldLayer);
    this.uiLayer.setDepth(1000);

    this.gameCam.setZoom(WORLD_ZOOM);
    this.gameCam.setScroll(0, 0);
    this.gameCam.setBounds(0, 0, GAME_W, GAME_H);

    this.screenBezel = this.add.image(0, 0, "ui_bezel").setOrigin(0, 0);
    this.screenBezel.setDepth(20);
    this.uiLayer.add(this.screenBezel);

    this.interactables = [];
    this.interactCandidate = null;
    this.lastCandidate = null;
    this.lastCandidateTime = 0;
    this.prevTouchInteract = false;

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

    if (this.isMainRoom()) {
      this.buildMainRoomWorld();
    } else {
      this.buildTrophyRoomWorld();
    }

    if (DEBUG_UI) {
      this.interactProbe = this.add.circle(0, 0, 2, 0xff00ff, 1);
      this.interactProbe.setDepth(9999);
      this.worldLayer.add(this.interactProbe);
      this.interactCandidateOutline = this.add.rectangle(0, 0, 10, 10, 0x000000, 0);
      this.interactCandidateOutline.setStrokeStyle(1, 0xffff00);
      this.interactCandidateOutline.setDepth(9998);
      this.worldLayer.add(this.interactCandidateOutline);
    }

    this.buildDialogUi();
    // Optional perf HUD (DEBUG only)
    if (DEBUG_UI) {
      this._perfHudStart = this.time.now;
      this._perfHudMaxDt = 0;
      this._perfHudHitches = 0;
      this._perfHudLayoutCount = 0;
      this._perfHudActive = true;
      this._perfHudText = this.add.text(10, 10, "", {
        fontFamily: "monospace",
        fontSize: "11px",
        color: "#9cff9c",
        backgroundColor: "rgba(0,0,0,0.65)",
        padding: { x: 4, y: 3 },
      });
      this._perfHudText.setOrigin(0, 0);
      this._perfHudText.setScrollFactor(0);
      this._perfHudText.setDepth(50000);
      this.uiLayer.add(this._perfHudText);
    } else {
      this._perfHudStart = 0;
      this._perfHudMaxDt = 0;
      this._perfHudHitches = 0;
      this._perfHudLayoutCount = 0;
      this._perfHudActive = false;
      this._perfHudText = null;
    }
    this.createControls();
    this.layout();
    this._warmupNeedsInputReset = true;
    this._warmupHasUserGesture = false;
    this.time.delayedCall(0, () => {});
    this.time.delayedCall(50, () => {});

    if (this.isMainRoom()) {
      this.shop = new ComputerShop(this);
      this.uiLayer.add(this.shop.container);
      this.shop.layout(this.gameCam);

      this.tvOverlay = new TVOverlay(this);
      this.tvOverlay.layout(this.gameCam);
      this.tvVideos = [];
      this.tvBag = [];
      this.loadTvVideos();

      this.emailOverlay = new EmailCaptureOverlay({
        onOpen: () => {
          this.uiModalOpen = true;
          this.setModalKeyboardCapture(true);
          this.resetInputState();
        },
        onClose: () => {
          this.uiModalOpen = false;
          this.setModalKeyboardCapture(false);
          this.resetInputState();
        },
        onSubmit: async ({ name, email }) => {
          const registered = await this.remoteState.registerIdentity(name, email);
          this.localIdentity = {
            userId: registered?.userId || "",
            name: registered?.name || name,
            email: registered?.email || email,
          };
          this.identitySubmitted = !!(this.localIdentity.name && this.localIdentity.email);
          this.saveLocalIdentity(this.localIdentity);
          this.emailPromptSnoozedThisSession = true;
          this.resetInputState();
        },
        onCancel: () => {
          this.dismissEmailPromptForShopSession();
        },
      });

      this.arcadeOverlay = new ArcadeOverlay(this, {
        onOpen: () => {
          this.resetInputState();
        },
        onClose: () => {
          this.resetInputState();
        },
      });
      this.uiLayer.add(this.arcadeOverlay.container);
      this.arcadeOverlay.layout(this.gameCam);

      this.gameMusic = new GameMusic(this);
      this.gameMusic.load().then(() => {
        this.gameMusic.startOnLoad();
      });
    } else {
      this.shop = null;
      this.tvOverlay = null;
      this.gameMusic = null;
      this.emailOverlay = null;
      this.arcadeOverlay = null;
      this.trophyPollTimer = this.time.addEvent({
        delay: 10000,
        loop: true,
        callback: () => this.refreshTrophyState(),
      });
      this.refreshTrophyState();
    }

    this.attachLifecycleListeners();

    this.dialogOpen = false;
    this.dialogTyping = false;
    this.fullDialogText = "";
    this.dialogWrappedText = "";
    this.typeIndex = 0;
    this.typeTimer = null;
    this.dialogTween = null;
    this.dialogSlideOffsetY = 0;
    this.typeDelayMs = 32;
    this.wrapProbeText = null;

    this.ensurePlayerAnims();
    if (!this._bootWarmupDidPrewarm && this.player?.anims) {
      const facingBeforePrewarm = this.facing;
      const prewarmKeys = ["walk_down", "walk_up", "walk_left", "walk_right"];
      for (let i = 0; i < prewarmKeys.length; i += 1) {
        this.player.anims.play(prewarmKeys[i], true);
        this.player.anims.stop();
      }
      this.setFacing(facingBeforePrewarm);
      this.stopWalk();
      this._bootWarmupDidPrewarm = true;
    }
    this.setFacing(this.facing);
    this.layout();
    this.layoutSettleTimer = this.time.delayedCall(120, () => this.layout());

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.cleanupScene();
    });
    if (!this._hasDestroyCleanupHook) {
      this._hasDestroyCleanupHook = true;
      this.events.once(Phaser.Scenes.Events.DESTROY, () => {
        this.cleanupScene();
      });
    }
  }

  buildMainRoomWorld() {
    const CORNER_PAD = 6;
    const PROP_SCALE = 0.5;
    const TOP_WALL_Y = 5;
    const TOP_WALL_H = 2;
    const wallY = TOP_WALL_Y + TOP_WALL_H + CORNER_PAD;

    const spkL = this.add.image(0, 0, "spkL").setOrigin(0, 0);
    const spkR = this.add.image(0, 0, "spkR").setOrigin(0, 0);
    spkL.setScale(PROP_SCALE * 1.75, PROP_SCALE * 2.2);
    spkR.setScale(PROP_SCALE * 1.75, PROP_SCALE * 2.2);
    const SPEAKER_Y = wallY - 15;
    const GAP_BASE = 10;
    const GAP_INNER = -32;
    const CONSOLE_Y_OFFSET = 24;
    const LAYOUT_SHIFT_X = -37;
    const GROUP_SHIFT_X = -15;
    const consoleX = Math.round(CORNER_PAD + spkL.displayWidth + GAP_BASE + LAYOUT_SHIFT_X + 5 + GROUP_SHIFT_X);
    this.worldLayer.add([spkL, spkR]);

    const pc = this.add.image(0, 0, "room_pc").setOrigin(0.5, 0.5);
    pc.setScale(PROP_SCALE);
    pc.setOrigin(1, 0);
    pc.setPosition(GAME_W - CORNER_PAD + 4, wallY - 12);
    this.worldLayer.add(pc);
    this.pc = pc;
    this.makeBlocker(pc, 0.8, 12);

    const ssl = this.add.image(0, 0, "ssl").setOrigin(0, 0);
    ssl.setScale(PROP_SCALE * 1.9);
    const sslY = Math.round(SPEAKER_Y + CONSOLE_Y_OFFSET);
    ssl.setPosition(consoleX + 1, sslY);
    this.worldLayer.add(ssl);
    this.makeBlocker(ssl, 0.8, 12);

    const spkLX = Math.round(consoleX - spkL.displayWidth - GAP_INNER - 10);
    const spkRX = Math.round(consoleX + ssl.displayWidth + GAP_INNER + 12);
    spkL.setPosition(spkLX, Math.round(SPEAKER_Y));
    spkR.setPosition(spkRX, Math.round(SPEAKER_Y));

    this.makeBlocker(spkL, 0.8, 12);
    this.makeBlocker(spkR, 0.8, 12);

    this.studer = this.add.image(0, 0, "studer").setOrigin(0, 0);
    this.studerController = this.add.image(0, 0, "studer_controller").setOrigin(0, 0);
    const STUDER_SCALE = PROP_SCALE * 2;
    this.studer.setScale(STUDER_SCALE * (2 / 3) * 1.05);
    this.studerController.setScale(STUDER_SCALE * 1.05);
    const STUDER_OFFSET_X = -25;
    const STUDER_OFFSET_Y = 8;
    const studerY = wallY - 10 + STUDER_OFFSET_Y;
    const pairGap = 12;
    const edgeGap = 6;
    const pairW = this.studerController.displayWidth + pairGap + this.studer.displayWidth;
    const pairLeftBound = ssl.x + ssl.displayWidth + edgeGap;
    const pairRightBound = pc.x - pc.displayWidth - edgeGap;
    let pairX = pairLeftBound;
    if (pairRightBound - pairLeftBound >= pairW) {
      pairX = pairLeftBound + Math.floor((pairRightBound - pairLeftBound - pairW) / 2);
    } else {
      pairX = Math.max(pairLeftBound, pairRightBound - pairW);
    }
    pairX -= 15;
    this.studerController.setPosition(Math.round(pairX + STUDER_OFFSET_X), Math.round(studerY));
    this.studer.setPosition(
      Math.round(this.studerController.x + this.studerController.displayWidth + pairGap),
      Math.round(studerY)
    );
    this.worldLayer.add([this.studerController, this.studer]);
    this.makeBlocker(this.studerController, 0.8, 12);
    this.makeBlocker(this.studer, 0.8, 12);

    let couch = null;
    if (true) {
      couch = this.add.image(0, 0, "couch").setOrigin(0, 0);
      couch.setScale(PROP_SCALE * 3);
      const couchX = CORNER_PAD - 5;
      const couchY = Math.round(GAME_H / 2 - couch.displayHeight / 2 + 86);
      couch.setPosition(couchX, couchY);
      this.worldLayer.add(couch);
      const cb = couch.getBounds();
      const insetL = 4;
      const insetR = -1;
      const insetT = 8;
      const insetB = 4;
      const couchBlocker = this.add.rectangle(
        cb.x + insetL,
        cb.y + insetT,
        Math.max(1, cb.width - (insetL + insetR)),
        Math.max(1, cb.height - (insetT + insetB)),
        0x00ff00,
        DEBUG_UI ? 0.25 : 0
      );
      couchBlocker.setOrigin(0, 0);
      this.worldLayer.add(couchBlocker);
      this.physics.add.existing(couchBlocker, true);
      this.physics.add.collider(this.player, couchBlocker);
      const baseY = couchBlocker.getBottomCenter().y;
      couch.setDepth(baseY);
      couchBlocker.setDepth(baseY);
      couch.blocker = couchBlocker;
    }

    let tv = null;
    if (true) {
      tv = this.add.image(0, 0, "tv").setOrigin(0, 0);
      tv.setScale(PROP_SCALE * 2.3 * 0.5);
      const gap = 8;
      const tvX = Math.round(pc.x - pc.displayWidth - gap - tv.displayWidth - 15);
      const tvY = Math.round(pc.y + 2);
      tv.setPosition(tvX, tvY);
      this.worldLayer.add(tv);
      this.makeBlocker(tv, 0.9, 12);
    }

    let arcadeMachine = null;
    if (true) {
      const arcadeX = Math.round(GAME_W * 0.72);
      const arcadeY = GAME_H - 9;
      const arcadeTex = this.textures.exists("arcade") ? this.textures.get("arcade") : null;
      const hasArcadeTexture =
        !!arcadeTex &&
        arcadeTex.key !== "__MISSING" &&
        !!arcadeTex.getSourceImage &&
        !!arcadeTex.getSourceImage();

      if (hasArcadeTexture) {
        arcadeMachine = this.add.image(arcadeX, arcadeY, "arcade").setOrigin(0.5, 1);
        arcadeMachine.setScale(PROP_SCALE * 1.1);
        arcadeMachine.setPipeline("TextureTintPipeline");
        arcadeTex.setFilter(Phaser.Textures.FilterMode.NEAREST);
        this.worldLayer.add(arcadeMachine);
        this.makeBlocker(arcadeMachine, 0.85, 10);
      } else {
        arcadeMachine = this.add.rectangle(arcadeX, arcadeY, 26, 32, 0x16385a, 1).setOrigin(0.5, 1);
        const marquee = this.add.rectangle(arcadeX, arcadeY - 30, 20, 5, 0xffe57c, 1).setOrigin(0.5, 0);
        const screen = this.add.rectangle(arcadeX, arcadeY - 20, 16, 8, 0x6bc9ff, 1).setOrigin(0.5, 0.5);
        const label = this.add.text(arcadeX, arcadeY - 30, "ARCADE", {
          fontFamily: "monospace",
          fontSize: "6px",
          color: "#111111",
        }).setOrigin(0.5, 0);
        this.worldLayer.add([arcadeMachine, marquee, screen, label]);
        const blocker = this.makeBlocker(arcadeMachine, 0.85, 10);
        const baseY = blocker.getBottomCenter().y;
        marquee.setDepth(baseY + 0.01);
        screen.setDepth(baseY + 0.02);
        label.setDepth(baseY + 0.03);
      }
    }

    this.addInteractable({
      id: "pc",
      sprite: pc,
      text: "Computer...",
    });
    if (tv) {
      this.addInteractable({
        id: "tv",
        sprite: tv,
        text: "TV...",
        getInteractRect: () => {
          const b = tv.getBounds();
          const pad = 12;
          return new Phaser.Geom.Rectangle(b.x - pad, b.y - pad, b.width + pad * 2, b.height + pad * 2);
        },
      });
    }
    this.addInteractable({
      id: "console",
      sprite: ssl,
      text: "MIX ACTIVE: DO NOT TOUCH!!!",
      getInteractRect: () => {
        const bounds = ssl.getBounds();
        const stripH = 10;
        return new Phaser.Geom.Rectangle(bounds.x, bounds.bottom, bounds.width, stripH);
      },
    });
    if (couch) {
      this.addInteractable({
        id: "couch",
        sprite: couch,
        text: "This couch has seen a lot of late nights...",
        getInteractRect: () => {
          const b = couch.getBounds();
          const pad = 12;
          return new Phaser.Geom.Rectangle(
            b.x - pad,
            b.y - pad,
            b.width + pad * 2,
            b.height + pad * 2
          );
        },
      });
    }
    this.addInteractable({
      id: "studer",
      sprite: this.studer,
      text: "This is ancient technology... Maybe I should try a plugin...",
    });
    this.addInteractable({
      id: "studer_controller",
      sprite: this.studerController,
      text: "*click* ~a faint whirring sound is coming from the tape machine.~",
    });
    if (arcadeMachine) {
      this.addInteractable({
        id: "arcade",
        sprite: arcadeMachine,
        text: "An arcade machine...",
        getInteractRect: () => {
          const b = arcadeMachine.getBounds();
          const pad = 10;
          return new Phaser.Geom.Rectangle(b.x - pad, b.y - pad, b.width + pad * 2, b.height + pad * 2);
        },
      });
    }

    const studioDoor = {
      x: GAME_W - 4,
      y: Math.round(GAME_H / 2),
      width: 8,
      height: 48,
    };
    this.placeDoorRug({ ...studioDoor, side: "right" });
    this.createDoorZone({
      ...studioDoor,
      toScene: "trophy",
      spawn: { x: 24, y: Math.round(GAME_H / 2), facing: "right" },
    });
  }

  buildTrophyRoomWorld() {
    const beatItems = this.getPurchasableBeatItems();
    const count = beatItems.length > 0 ? beatItems.length : 20;
    this.trophyPillars = [];
    this.trophyPurchases = [];

    const trophyDoor = {
      x: 4,
      y: Math.round(GAME_H / 2),
      width: 8,
      height: 48,
    };

    const pillarSlots = this.getTrophyPedestalSlots(count);

    if (DEBUG_UI) {
      for (let i = 0; i < pillarSlots.length; i += 1) {
        const dot = this.add.circle(pillarSlots[i].x, pillarSlots[i].y, 2, 0x33e0ff, 0.95);
        dot.setDepth(12002);
        this.worldLayer.add(dot);
      }
      console.log("[trophy-grid-layout]", {
        rows: Math.ceil(Math.max(1, count) / 4),
        columns: 4,
        countRequested: count,
        totalSlots: pillarSlots.length,
      });
    }

    for (let i = 0; i < pillarSlots.length; i += 1) {
      const slot = pillarSlots[i];
      const x = slot.x;
      const y = slot.y;

      const shaft = this.add.rectangle(x, y, 14, 22, 0x8f98a3).setOrigin(0.5, 1);
      const cap = this.add.rectangle(x, y - 20, 20, 5, 0xdce2e8).setOrigin(0.5, 1);
      const accent = this.add.rectangle(x, y - 10, 10, 2, 0xb0beca).setOrigin(0.5, 1);
      this.worldLayer.add([shaft, cap, accent]);
      const blocker = this.makeBlocker(shaft, 0.9, 8);

      const trophy = this.add.container(x, y - 24);
      const cup = this.add.rectangle(0, 0, 10, 7, 0xf2c94c);
      const stem = this.add.rectangle(0, 5, 3, 5, 0xe7b93a);
      const base = this.add.rectangle(0, 9, 10, 3, 0x77522b);
      const lWing = this.add.rectangle(-7, 0, 4, 2, 0xf2c94c);
      const rWing = this.add.rectangle(7, 0, 4, 2, 0xf2c94c);
      trophy.add([cup, stem, base, lWing, rWing]);
      trophy.setVisible(false);
      this.worldLayer.add(trophy);

      this.addInteractable({
        id: `pillar_${i}`,
        sprite: shaft,
        text: "An empty pedestal...",
        getInteractRect: () => new Phaser.Geom.Rectangle(x - 12, y - 26, 24, 26),
        meta: { pillarIndex: i },
      });

      this.trophyPillars.push({
        shaft,
        cap,
        accent,
        trophy,
        purchase: null,
        depthAnchorY: blocker.getBottomCenter().y,
        blocker,
      });
    }

    this.syncTrophyPillarDepths();

    this.placeDoorRug({ ...trophyDoor, side: "left" });
    this.createDoorZone({
      ...trophyDoor,
      toScene: "room",
      spawn: { x: GAME_W - 28, y: Math.round(GAME_H / 2), facing: "left" },
    });
  }

  async refreshTrophyState() {
    if (!this.isTrophyRoom()) return;
    const state = await this.remoteState.getState();
    const purchases = Array.isArray(state?.purchases) ? state.purchases : [];
    this.trophyPurchases = purchases;
    this.applyTrophiesToPillars();
  }

  applyTrophiesToPillars() {
    if (!Array.isArray(this.trophyPillars)) return;
    for (let i = 0; i < this.trophyPillars.length; i += 1) {
      const pillar = this.trophyPillars[i];
      const purchase = this.trophyPurchases[i] || null;
      pillar.purchase = purchase;
      pillar.trophy.setVisible(!!purchase);
      if (purchase) {
        pillar.trophy.setDepth((pillar.depthAnchorY ?? pillar.shaft.getBottomCenter().y) + 0.03);
      }
    }
  }

  createControls() {
    if (this.uiBound) return;
    this.uiBound = true;
    this.detachControlInputListeners();

    this.deckBg = this.add.image(0, 0, "ui_deck").setOrigin(0, 0);
    this.uiLayer.add(this.deckBg);

    this.dpadVisual = this.add.container(0, 0);
    this.dpadImg = this.add.image(0, 0, "ui_dpad").setOrigin(0.5);
    this.dpadVisual.add(this.dpadImg);
    this.uiLayer.add(this.dpadVisual);

    this.aVisual = this.add.container(0, 0);
    this.aImg = this.add.image(0, 0, "ui_a").setOrigin(0.5);
    this.aVisual.add(this.aImg);
    this.uiLayer.add(this.aVisual);

    this.bVisual = this.add.container(0, 0);
    this.bImg = this.add.image(0, 0, "ui_b").setOrigin(0.5);
    this.bVisual.add(this.bImg);
    this.uiLayer.add(this.bVisual);

    const initialDeckHeight = this.getDeckLayout(this.scale.height).deckHeight;
    const initialMetrics = this.computeControlMetrics(initialDeckHeight);

    // NOTE: On mobile with multiple cameras, Phaser's interactive hit-testing can be unreliable.
    // We keep these circles only as geometry references (manual hit-test), not as interactive objects.
    this.dpadHit = this.add.circle(0, 0, initialMetrics.dpadRadius, 0x000000, 0.001);
    this.aHit = this.add.circle(0, 0, initialMetrics.aHitRadius, 0x000000, 0.001);
    this.bHit = this.add.circle(0, 0, initialMetrics.bHitRadius, 0x000000, 0.001);

    this.uiLayer.add([this.dpadHit, this.aHit, this.bHit]);
    this.applyControlMetrics(initialMetrics);

    this.dpadPointerId = null;
    this.aPointerId = null;
    this.bPointerId = null;
    const pressBButton = (now) => {
      if (this.uiModalOpen) {
        this.emailOverlay.close();
        this.resetInputState();
        return;
      }

      if (this.arcadeOpenPending) {
        this.cancelPendingArcadeOpen();
        this.resetInputState();
        return;
      }

      // Arcade: B backs out (game -> menu -> close).
      if (this.arcadeOverlay?.isOpen) {
        this.arcadeTouchBJust = true;
        return;
      }

      // TV: B closes
      if (this.tvOverlay?.isOpen) {
        this.tvOverlay.close();
        return;
      }

      // Shop: B backs out / closes
      if (this.shop?.isOpen) {
        this.shop.tick(now, { left: false, right: false, up: false, down: false, aJust: false, backJust: true });
        return;
      }

      // Dialog: B advances typing or closes
      if (this.dialogOpen) {
        if (this.dialogTyping) this.finishTyping();
        else this.closeDialog();
        // Prevent “stuck” movement after closing
        this.touch.left = this.touch.right = this.touch.up = this.touch.down = false;
        this.dpadPointerId = null;
        const body = this.player?.body;
        if (body) body.setVelocity(0);
        this.stopWalk();
        return;
      }

      // Default: no-op
    };

    // --- Manual touch hit-testing (robust on mobile) ---
    const uiPoint = (pointer) => pointer.positionToCamera(this.uiCam);

    const inCircle = (px, py, cx, cy, r) => {
      const dx = px - cx;
      const dy = py - cy;
      return dx * dx + dy * dy <= r * r;
    };

    const clearAHoldTimer = () => {
      this.clearRunHoldTimer();
    };

    const dominantDir = (dx, dy) => {
      if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? "left" : "right";
      return dy < 0 ? "up" : "down";
    };

    const computeLockedDpadDir = (px, py) => {
      const cx = this.dpadHit.x;
      const cy = this.dpadHit.y;
      const dx = px - cx;
      const dy = py - cy;
      const absdx = Math.abs(dx);
      const absdy = Math.abs(dy);
      const dist = Math.sqrt(dx * dx + dy * dy);
      const deadzoneEnter = this._isCoarsePointer ? 8 : 12;
      const deadzoneKeep = this._isCoarsePointer ? 6 : 8;
      const axisThreshold = 8;
      const switchMargin = 7;

      if (!Number.isFinite(dist)) return null;
      if (!this.dpadLockDir) {
        if (dist < deadzoneEnter) return null;
        return dominantDir(dx, dy);
      }
      if (dist < deadzoneKeep) return this.dpadLockDir;

      if (this.dpadLockDir === "left" || this.dpadLockDir === "right") {
        if (absdy > absdx + switchMargin) return dy < 0 ? "up" : "down";
        if (dx <= -axisThreshold) return "left";
        if (dx >= axisThreshold) return "right";
        return this.dpadLockDir;
      }
      if (absdx > absdy + switchMargin) return dx < 0 ? "left" : "right";
      if (dy <= -axisThreshold) return "up";
      if (dy >= axisThreshold) return "down";
      return this.dpadLockDir;
    };

    const handleDpadAtPoint = (px, py, now) => {
      if (this.dialogOpen || this.uiModalOpen) return;
      const nextDir = computeLockedDpadDir(px, py);
      if (!nextDir) {
        this.setDpadTouchDirection(null, now);
        return;
      }
      if (nextDir !== this.dpadLockDir) {
        this.setDpadTouchDirection(nextDir, now);
        return;
      }
      this.applyDpadTouchMovement(now);
    };

    const startAButton = (now) => {
      if (this.uiModalOpen) return;

      // Arcade: A action/select.
      if (this.arcadeOverlay?.isOpen) {
        this.arcadeTouchAJust = true;
        return;
      }

      // If an overlay is open, A behaves as action (not run).
      if (this.tvOverlay?.isOpen) {
        if (!this.tvOverlay.soundUnlocked) this.tvOverlay.enableSoundFromGesture();
        else this.tvOverlay.close();
        return;
      }

      if (this.shop?.isOpen) {
        this.shop.unlockAudioFromGesture();
        this.shop.tick(now, { left: false, right: false, up: false, down: false, aJust: true, backJust: false });
        return;
      }

      if (this.dialogOpen) {
        this.handleA(now);
        return;
      }

      // Movement mode: start a hold timer. Only enable run after the hold threshold.
      this.aIsDown = true;
      this.aDownAt = now;
      this.runHeld = false;

      clearAHoldTimer();
      this.aHoldTimer = this.time.delayedCall(RUN_HOLD_MS, () => {
        if (
          this.aIsDown &&
          !this.dialogOpen &&
          !this.shop?.isOpen &&
          !this.tvOverlay?.isOpen &&
          !this.uiModalOpen
        ) {
          this.runHeld = true;
        }
      });
    };

    const releaseAButton = (now) => {
      const wasDown = this.aIsDown;
      const wasRunning = this.runHeld;

      this.aIsDown = false;
      this.runHeld = false;
      clearAHoldTimer();

      // If we were in movement mode and did NOT enter run, treat as a tap -> interact.
      if (
        wasDown &&
        !wasRunning &&
        !this.dialogOpen &&
        !this.shop?.isOpen &&
        !this.tvOverlay?.isOpen &&
        !this.uiModalOpen
      ) {
        this.handleA(now);
      }
    };

    const clearDpad = () => {
      this.dpadPointerId = null;
      this.setDpadTouchDirection(null, this.time.now);
    };

    const clearA = () => {
      this.aPointerId = null;
      releaseAButton(this.time.now);
    };

    const clearB = () => {
      this.bPointerId = null;
    };

    this._onControlPointerDown = (pointer) => {
      if (this.transitionFailed) return;
      if (this.uiModalOpen) return;
      this._warmupHasUserGesture = true;
      pointer.event?.preventDefault?.();
      pointer.event?.stopPropagation?.();

      // Any touch counts as a user gesture for iOS-safe music unlock/start.
      if (this.gameMusic) this.gameMusic.startFromGesture();

      const p = uiPoint(pointer);

      // Claim D-pad pointer if inside D-pad circle.
      if (this.dpadPointerId === null) {
        const r = this.dpadHit.radius;
        if (inCircle(p.x, p.y, this.dpadHit.x, this.dpadHit.y, r)) {
          this.dpadPointerId = pointer.id;
          handleDpadAtPoint(p.x, p.y, this.time.now);
          return;
        }
      }

      // Claim A pointer if inside A circle.
      if (this.aPointerId === null) {
        const r = this.aHit.radius;
        if (inCircle(p.x, p.y, this.aHit.x, this.aHit.y, r)) {
          this.aPointerId = pointer.id;
          startAButton(this.time.now);
          return;
        }
      }

      // Claim B pointer if inside B circle.
      if (this.bPointerId === null) {
        const r = this.bHit.radius;
        if (inCircle(p.x, p.y, this.bHit.x, this.bHit.y, r)) {
          this.bPointerId = pointer.id;
          pressBButton(this.time.now);
          return;
        }
      }
    };

    this._onControlPointerMove = (pointer) => {
      if (this.transitionFailed) return;
      if (this.uiModalOpen) return;
      pointer?.event?.preventDefault?.();
      pointer?.event?.stopPropagation?.();
      const p = uiPoint(pointer);

      if (this.dpadPointerId !== null && pointer.id === this.dpadPointerId) {
        handleDpadAtPoint(p.x, p.y, this.time.now);
      }

      // We do NOT need pointer-move handling for A.
    };

    this._onControlPointerEnd = (pointer) => {
      if (this.transitionFailed) return;
      if (this.uiModalOpen) return;
      pointer?.event?.preventDefault?.();
      pointer?.event?.stopPropagation?.();

      if (this.dpadPointerId !== null && pointer.id === this.dpadPointerId) {
        clearDpad();
      }

      if (this.aPointerId !== null && pointer.id === this.aPointerId) {
        clearA();
      }
      if (this.bPointerId !== null && pointer.id === this.bPointerId) {
        clearB();
      }
    };

    this.input.on("pointerdown", this._onControlPointerDown);
    this.input.on("pointermove", this._onControlPointerMove);
    this.input.on("pointerup", this._onControlPointerEnd);
    this.input.on("pointerupoutside", this._onControlPointerEnd);
    this.input.on("pointercancel", this._onControlPointerEnd);

    // Always position the UI immediately after creating controls.
    this.layout();
  }

  getDeckLayout(canvasH) {
    const vpH = Math.round(GAME_H * WORLD_ZOOM);
    const minDeck = 160;
    const preferredDeck = Math.max(minDeck, Math.floor(canvasH * 0.32));
    const maxDeck = Math.max(0, canvasH - vpH);
    const deckHeight = Math.min(preferredDeck, maxDeck);
    const deckTop = canvasH - deckHeight;
    return { deckHeight, deckTop };
  }

  computeControlMetrics(deckHeight) {
    const scaleDown = 0.95;
    const baseDpadRadius = Math.round(Phaser.Math.Clamp(deckHeight * 0.28, 70, 90) * scaleDown);
    const isCoarsePointer =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches;
    const coarseMult = isCoarsePointer ? 1.25 : 1;
    const rawRadius = Math.round(baseDpadRadius * coarseMult);
    const maxRadius = Math.round(Phaser.Math.Clamp(deckHeight * 0.36, 98, 118));
    const dpadRadius = Phaser.Math.Clamp(rawRadius, 0, maxRadius);
    const aVisualRadius = Math.round(Phaser.Math.Clamp(deckHeight * 0.18, 30, 42) * scaleDown);
    const aHitRadius = Math.round(Phaser.Math.Clamp(aVisualRadius * 1.8, 58, 76) * scaleDown);
    const bVisualRadius = aVisualRadius;
    const bHitRadius = aHitRadius;
    return { dpadRadius, aVisualRadius, aHitRadius, bVisualRadius, bHitRadius };
  }

  applyControlMetrics(metrics) {
    if (this.isShuttingDown) return;
    this.uiMetrics = metrics;
    if (this.isValidDisplayObject(this.dpadImg) && this.dpadImg.width > 0) {
      const desired = Math.round(metrics.dpadRadius * 2);
      this.dpadImg.setScale(desired / this.dpadImg.width);
    }
    if (this.isValidDisplayObject(this.aImg) && this.aImg.width > 0) {
      const desired = Math.round(metrics.aVisualRadius * 2);
      this.aImg.setScale(desired / this.aImg.width);
    }
    if (this.isValidDisplayObject(this.bImg) && this.bImg.width > 0) {
      const desired = Math.round(metrics.bVisualRadius * 2);
      this.bImg.setScale(desired / this.bImg.width);
    }

    const dpad = this.ensureControlHitArea("dpadHit", metrics.dpadRadius);
    const a = this.ensureControlHitArea("aHit", metrics.aHitRadius);
    const b = this.ensureControlHitArea("bHit", metrics.bHitRadius);
    if (this.isValidShape(dpad)) dpad.setRadius(metrics.dpadRadius);
    if (this.isValidShape(a)) a.setRadius(metrics.aHitRadius);
    if (this.isValidShape(b)) b.setRadius(metrics.bHitRadius);
  }

  layout() {
    if (this.isShuttingDown) return;
    if (!this.scale || !this.gameCam || !this.uiCam) return;
    if (this._perfHudActive) this._perfHudLayoutCount += 1;
    const canvasW = this.scale.width;
    const canvasH = this.scale.height;

    const vpW = Math.round(GAME_W * WORLD_ZOOM);
    const vpH = Math.round(GAME_H * WORLD_ZOOM);
    const { deckHeight, deckTop } = this.getDeckLayout(canvasH);
    const safeBottom = Math.max(
      0,
      (window?.visualViewport?.height ? (canvasH - window.visualViewport.height) : 0)
    );
    const extraPad = 18; // raise controls a bit more
    const bottomInset = Math.round(safeBottom + extraPad);

    // Clamp viewport so small screens never produce a negative viewport X (which shifts everything left).
    const vpX = Math.max(0, Math.floor((canvasW - vpW) / 2));
    const vpY = Math.max(0, Math.floor((deckTop - vpH) / 2));

    if (this.isValidDisplayObject(this.gameCam)) {
      this.gameCam.setViewport(vpX, vpY, vpW, vpH);
      this.gameCam.setScroll(0, 0);
    }
    if (this.isValidDisplayObject(this.uiCam)) {
      this.uiCam.setViewport(0, 0, canvasW, canvasH);
    }

    if (this.isValidDisplayObject(this.screenBezel)) {
      const scaleFactor = this.gameCam.width / 320;
      const bezelW = Math.round(352 * scaleFactor);
      const bezelH = Math.round(272 * scaleFactor);
      const bezelX = Math.round(this.gameCam.x - 16 * scaleFactor);
      const bezelY = Math.round(this.gameCam.y - 16 * scaleFactor);
      this.screenBezel.setPosition(bezelX, bezelY);
      if (typeof this.screenBezel.setDisplaySize === "function") {
        this.screenBezel.setDisplaySize(bezelW, bezelH);
      }
      this.screenBezel.setScrollFactor(0);
    }

    if (this.ensureDialogUiAlive()) {
      const margin = 8;
      const border = 4;
      const pad = 6;
      const boxW = Math.round(vpW * 0.93);
      const boxH = Math.round(vpH * 0.27);
      const boxX = Math.round(vpX + (vpW - boxW) / 2);
      const boxY = Math.round(vpY + vpH - boxH - margin);
      if (this.isValidShape(this.dialogBorder)) {
        this.dialogBorder.setPosition(boxX, boxY);
        this.dialogBorder.setSize(boxW, boxH);
      }
      if (this.isValidShape(this.dialogFill)) {
        this.dialogFill.setPosition(boxX + border, boxY + border);
        this.dialogFill.setSize(
          Math.max(4, boxW - border * 2),
          Math.max(4, boxH - border * 2)
        );
      }
      const textX = boxX + border + pad;
      const textY = boxY + border + pad + 1;
      const textW = Math.max(4, boxW - 2 * (border + pad));
      if (this.isValidDisplayObject(this.dialogText)) {
        this.dialogText.setPosition(textX, textY);
        this.dialogText.setWordWrapWidth(textW);
      }
      this.dialogSlideOffsetY = Math.max(0, vpY + vpH - boxY + 4);
    }

    if (this.isValidDisplayObject(this.deckBg) && typeof this.deckBg.setDisplaySize === "function") {
      this.deckBg.setPosition(0, deckTop);
      this.deckBg.setDisplaySize(canvasW, deckHeight);
    }

    const metrics = this.computeControlMetrics(deckHeight);
    this.applyControlMetrics(metrics);

    const pad = 24;
    const isCoarsePointer =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches;
    const dpadSafeEdgeInset = isCoarsePointer
      ? Phaser.Math.Clamp(Math.round(canvasW * 0.02), 8, 12)
      : 24;
    const dpadLeftNudge = 6;
    const dpadNudgeX = isCoarsePointer
      ? Phaser.Math.Clamp(Math.round(canvasW * 0.03), 14, 20)
      : 0;
    const dpadX = Math.round(
      Phaser.Math.Clamp(
        pad + metrics.dpadRadius - dpadLeftNudge - dpadNudgeX,
        metrics.dpadRadius + dpadSafeEdgeInset,
        canvasW - metrics.dpadRadius
      )
    );
    const abShiftRight = 46;
    const aRightInset = Math.round(metrics.aHitRadius * 0.35);
    const aX = Math.round(
      Phaser.Math.Clamp(
        canvasW - (pad + metrics.aHitRadius) + abShiftRight,
        metrics.aHitRadius,
        canvasW - aRightInset
      )
    );
    const dpadRaise = isCoarsePointer ? -2 : 8;
    const dpadY = Math.round(
      Phaser.Math.Clamp(
        deckTop + deckHeight * 0.5 - dpadRaise,
        deckTop + metrics.dpadRadius,
        canvasH - bottomInset - metrics.dpadRadius
      )
    );
    const dpadTop = dpadY - metrics.dpadRadius;
    const dpadBottom = dpadY + metrics.dpadRadius;
    const aVisualTopAlignedY = dpadTop + metrics.aVisualRadius;
    const aY = Math.round(
      Phaser.Math.Clamp(
        aVisualTopAlignedY,
        deckTop + metrics.aHitRadius,
        canvasH - bottomInset - metrics.aHitRadius
      )
    );
    const abDeltaX = 96;
    const bX = Math.round(
      Phaser.Math.Clamp(
        aX - abDeltaX,
        metrics.bHitRadius,
        canvasW - Math.round(metrics.bHitRadius * 0.35)
      )
    );
    const bVisualLower = 40;
    const bVisualBottomAlignedY = dpadBottom - metrics.bVisualRadius + bVisualLower;
    const bY = Math.round(
      Phaser.Math.Clamp(
        bVisualBottomAlignedY,
        deckTop + metrics.bHitRadius,
        canvasH - bottomInset - metrics.bVisualRadius
      )
    );

    if (this.isValidDisplayObject(this.dpadVisual)) this.dpadVisual.setPosition(dpadX, dpadY);
    if (this.isValidDisplayObject(this.aVisual)) this.aVisual.setPosition(aX, aY);
    if (this.isValidDisplayObject(this.bVisual)) this.bVisual.setPosition(bX, bY);
    if (this.isValidShape(this.dpadHit)) this.dpadHit.setPosition(dpadX, dpadY);
    if (this.isValidShape(this.aHit)) this.aHit.setPosition(aX, aY);
    if (this.isValidShape(this.bHit)) this.bHit.setPosition(bX, bY);

    if (this.shop) this.shop.layout(this.gameCam);
    if (this.tvOverlay) this.tvOverlay.layout(this.gameCam);
    if (this.arcadeOverlay) this.arcadeOverlay.layout(this.gameCam);
  }

  updateInteractCandidate(now) {
    const feet = this.player.getBottomCenter();
    const FACE_OFFSET = 12;
    let fx = feet.x;
    let fy = feet.y;
    let faceX = 0;
    let faceY = 0;
    if (this.facing === "up") {
      fy -= FACE_OFFSET;
      faceY = -1;
    } else if (this.facing === "down") {
      fy += FACE_OFFSET;
      faceY = 1;
    } else if (this.facing === "left") {
      fx -= FACE_OFFSET;
      faceX = -1;
    } else if (this.facing === "right") {
      fx += FACE_OFFSET;
      faceX = 1;
    }

    let bestCandidate = null;
    let bestDistSq = Number.POSITIVE_INFINITY;
    const MAX_INTERACT_DIST = 20;
    const MAX_DIST_SQ = MAX_INTERACT_DIST * MAX_INTERACT_DIST;
    const FRONT_TOL = -4;
    for (const entry of this.interactables) {
      if (entry.getInteractRect) {
        const rect = entry.getInteractRect();
        const body = this.player.body;
        const feetRect = body
          ? new Phaser.Geom.Rectangle(body.x, body.y, body.width, body.height)
          : new Phaser.Geom.Rectangle(feet.x, feet.y, 1, 1);
        if (rect && Phaser.Geom.Rectangle.Overlaps(rect, feetRect)) {
          bestCandidate = entry;
          bestDistSq = 0;
        }
        continue;
      }
      const vx = entry.interactPointX - feet.x;
      const vy = entry.interactPointY - feet.y;
      const dot = vx * faceX + vy * faceY;
      if (dot < FRONT_TOL) continue;
      const dx = entry.interactPointX - fx;
      const dy = entry.interactPointY - fy;
      const distSq = dx * dx + dy * dy;
      if (distSq <= MAX_DIST_SQ && distSq < bestDistSq) {
        bestDistSq = distSq;
        bestCandidate = entry;
      }
    }

    this.interactCandidate = bestCandidate;
    if (bestCandidate) {
      this.lastCandidate = bestCandidate;
      this.lastCandidateTime = now;
    }

    const COYOTE_MS = 200;
    let effectiveCandidate = bestCandidate;
    if (!effectiveCandidate && this.lastCandidate && now - this.lastCandidateTime <= COYOTE_MS) {
      effectiveCandidate = this.lastCandidate;
    }

    if (DEBUG_UI && this.interactProbe) {
      this.interactProbe.setPosition(Math.round(fx), Math.round(fy));
    }
    if (DEBUG_UI && this.interactCandidateOutline) {
      if (bestCandidate) {
        const b = bestCandidate.sprite.getBounds();
        this.interactCandidateOutline.setPosition(b.centerX, b.centerY);
        this.interactCandidateOutline.setSize(b.width, b.height);
        this.interactCandidateOutline.setVisible(true);
      } else {
        this.interactCandidateOutline.setVisible(false);
      }
    }

    return effectiveCandidate;
  }

  async loadTvVideos() {
    try {
      const res = await fetch("/data/tv_videos.json", { cache: "no-store" });
      if (!res.ok) throw new Error(`tv_videos.json HTTP ${res.status}`);
      const json = await res.json();
      if (json && Array.isArray(json.videos)) {
        this.tvVideos = json.videos.filter(Boolean);
        return;
      }
    } catch (e) {
      console.warn("RoomScene: failed to load /data/tv_videos.json, using fallback", e);
    }
    this.tvVideos = ["https://www.youtube.com/watch?v=hrMlEv-6SEw"];
  }

  shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  getNextTvUrl() {
    if (!this.tvVideos.length) return "https://www.youtube.com/watch?v=hrMlEv-6SEw";
    if (!this.tvBag.length) {
      this.tvBag = [...this.tvVideos];
      this.shuffleInPlace(this.tvBag);
    }
    return this.tvBag.pop();
  }

  getWrappedDialogText(text) {
    const wrapWidth =
      this.dialogText?.style?.wordWrapWidth ?? this.dialogText?.style?.wordWrap?.width ?? 0;
    if (this.dialogText?.getWrappedText) {
      const wrapped = this.dialogText.getWrappedText(text);
      if (Array.isArray(wrapped)) return wrapped.join("\n");
      if (typeof wrapped === "string") return wrapped;
    }

    if (!this.wrapProbeText) {
      this.wrapProbeText = this.add.text(-1000, -1000, "", {
        fontFamily: this.dialogText.style.fontFamily,
        fontSize: this.dialogText.style.fontSize,
        color: this.dialogText.style.color,
        lineSpacing: this.dialogText.style.lineSpacing,
        wordWrap: { width: wrapWidth },
      });
      this.wrapProbeText.setVisible(false);
    }

    if (wrapWidth) this.wrapProbeText.setWordWrapWidth(wrapWidth);
    this.wrapProbeText.setText(text);

    if (this.wrapProbeText.getWrappedText) {
      const wrapped = this.wrapProbeText.getWrappedText(text);
      if (Array.isArray(wrapped)) return wrapped.join("\n");
      if (typeof wrapped === "string") return wrapped;
    }

    const bounds = this.wrapProbeText.getTextBounds?.(true);
    if (bounds?.lines?.length) return bounds.lines.join("\n");

    return text;
  }

  getTypeDelayForChar(char) {
    if (char === "\n") return this.typeDelayMs + 110;
    if (char === "." || char === "," || char === "!" || char === "?") {
      return this.typeDelayMs + 110;
    }
    return this.typeDelayMs;
  }

  startTypewriter() {
    if (this.typeTimer) {
      this.typeTimer.remove(false);
      this.typeTimer = null;
    }
    const tick = () => {
      if (!this.dialogTyping) return;
      const nextIndex = Math.min(this.typeIndex + 1, this.dialogWrappedText.length);
      this.typeIndex = nextIndex;
      this.dialogText.setText(this.dialogWrappedText.slice(0, this.typeIndex));
      if (this.typeIndex >= this.dialogWrappedText.length) {
        this.finishTyping();
        return;
      }
      const lastChar = this.dialogWrappedText[this.typeIndex - 1];
      const delay = this.getTypeDelayForChar(lastChar);
      this.typeTimer = this.time.delayedCall(delay, tick);
    };
    this.typeTimer = this.time.delayedCall(this.typeDelayMs, tick);
  }

  finishTyping() {
    if (!this.dialogTyping) return;
    this.dialogTyping = false;
    this.typeIndex = this.dialogWrappedText.length;
    this.dialogText.setText(this.dialogWrappedText);
    if (this.typeTimer) {
      this.typeTimer.remove(false);
      this.typeTimer = null;
    }
  }

  closeDialog() {
    if (!this.dialogOpen) return;
    this.finishTyping();
    if (this.dialogTween) {
      this.dialogTween.stop();
      this.dialogTween = null;
    }
    this.dialogContainer.setVisible(false);
    this.runHeld = false;
    this.aIsDown = false;
    this.dialogOpen = false;
  }

  openDialog(candidate) {
    const text = typeof candidate === "string" ? candidate : candidate?.text;
    if (!text) return;
    this.dialogOpen = true;
    this.dialogTyping = true;
    this.fullDialogText = text;
    this.dialogWrappedText = this.getWrappedDialogText(text);
    this.typeIndex = 0;
    this.dialogText.setText("");
    this.dialogContainer.setVisible(true);
    this.pendingInteractUntil = 0;
    this.runHeld = false;
    this.aIsDown = false;

    this.dialogContainer.y = this.dialogSlideOffsetY || 0;
    if (this.dialogTween) this.dialogTween.stop();
    this.dialogTween = this.tweens.add({
      targets: this.dialogContainer,
      y: 0,
      duration: 150,
      ease: "Sine.Out",
    });

    this.startTypewriter();
  }

  handleA(timeNow) {
    if (this.uiModalOpen) {
      return;
    }

    if (this.tvOverlay?.isOpen) {
      if (!this.tvOverlay.soundUnlocked) this.tvOverlay.enableSoundFromGesture();
      else this.tvOverlay.close();
      this.touch.interact = false;
      return;
    }

    if (this.dialogOpen) {
      if (this.dialogTyping) this.finishTyping();
      else this.closeDialog();
      return;
    }

    const candidate = this.updateInteractCandidate(timeNow);
    if (!candidate) {
      this.pendingInteractUntil = timeNow + 300;
      return;
    }

    if (this.isTrophyRoom() && typeof candidate.id === "string" && candidate.id.startsWith("pillar_")) {
      const pillarIndex = candidate.meta?.pillarIndex ?? Number(candidate.id.split("_")[1] || -1);
      const purchase = this.trophyPillars?.[pillarIndex]?.purchase || null;
      if (!purchase) {
        this.openDialog("An empty pedestal...");
        return;
      }
      const beatName = purchase.beatName || "UNKNOWN BEAT";
      const buyerName = purchase.buyerName || this.localIdentity?.name || "UNKNOWN";
      this.openDialog(`TROPHY\n${beatName}\nBY: ${buyerName}`);
      return;
    }

    if (this.isMainRoom()) {
      if (candidate.id === "arcade" && this.arcadeOverlay) {
        if (this.arcadeOpenPending) this.cancelPendingArcadeOpen();
        this.resetInputState();
        this.tryPlayArcadeInteractSfx();
        if (!this.arcadeOverlay?.isOpen) {
          this.arcadeOverlay.open();
          this.arcadeOverlay.layout(this.gameCam);
        }
        return;
      }

      if (candidate.id === "pc" && this.shop) {
        this.shop.unlockAudioFromGesture();
        this.shop.open();
        this.shop.layout(this.gameCam);
        return;
      }

      if (candidate.id === "tv" && this.tvOverlay) {
        const url = this.getNextTvUrl();
        this.tvOverlay.open(url);
        this.tvOverlay.layout(this.gameCam);
        this.tvOverlay.enableSoundFromGesture();
        return;
      }
    }

    this.openDialog(candidate);
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

    const curKey = this.player.anims.currentAnim?.key;
    const isPlaying = !!this.player.anims.isPlaying;
    if (curKey !== key || !isPlaying) {
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

  update(time, delta) {
    if (this.transitionFailed) return;
    this.inputTick += 1;
    const now = this.time.now;
    const rawDelta = Number.isFinite(delta) ? delta : 16.67;
    const dt = Phaser.Math.Clamp(rawDelta, 0, 33);

    if (DEBUG_UI && this._perfHudActive) {
      const elapsed = now - this._perfHudStart;
      if (elapsed >= 2000) {
        this._perfHudActive = false;
        this.safeDestroyObject(this._perfHudText);
        this._perfHudText = null;
      } else if (this.isValidDisplayObject(this._perfHudText)) {
        const hudDt = Phaser.Math.Clamp(rawDelta, 0, 250);
        if (hudDt > this._perfHudMaxDt) this._perfHudMaxDt = hudDt;
        if (hudDt > 40) this._perfHudHitches += 1;
        this._perfHudText.setText(
          [
            `dt ${hudDt.toFixed(1)}ms`,
            `max ${this._perfHudMaxDt.toFixed(1)}ms`,
            `hitch ${this._perfHudHitches}`,
            `layout ${this._perfHudLayoutCount}`,
          ].join("\n")
        );
      }
    }

    if (this._warmupNeedsInputReset) {
      this.resetInputState();
      this.clearTouchMoveFlags();
      if (this.touch) this.touch.interact = false;
      this.dpadLockDir = null;
      this.dpadDesiredDir = null;
      this._warmupNeedsInputReset = false;
    }

    this.uiModalOpen = !!this.emailOverlay?.isOpen?.();
    if (!this.uiModalOpen && this.emailOverlayWasOpen) {
      this.emailOverlayWasOpen = false;
      this.resetInputState();
    }

    if (this.uiModalOpen) {
      this.emailOverlayWasOpen = true;
      if (this.gameMusic) this.gameMusic.pauseForOverlay();
      this.freezePlayer();
      return;
    }

    const arcadeAJust = !!this.arcadeTouchAJust;
    const arcadeBJust = !!this.arcadeTouchBJust;
    this.arcadeTouchAJust = false;
    this.arcadeTouchBJust = false;

    if (this.arcadeOpenPending) {
      const cancelJust =
        (this.keyB && Phaser.Input.Keyboard.JustDown(this.keyB)) ||
        (this.keyEsc && Phaser.Input.Keyboard.JustDown(this.keyEsc));
      if (cancelJust) {
        this.cancelPendingArcadeOpen();
      }
      this.freezePlayer();
      return;
    }

    if (this.arcadeOverlay?.isOpen) {
      const left = this.cursors.left.isDown || this.touch.left;
      const right = this.cursors.right.isDown || this.touch.right;
      const up = this.cursors.up.isDown || this.touch.up;
      const down = this.cursors.down.isDown || this.touch.down;
      const aJust =
        arcadeAJust ||
        Phaser.Input.Keyboard.JustDown(this.keyA) ||
        Phaser.Input.Keyboard.JustDown(this.keySpace);
      const backJust =
        arcadeBJust ||
        (this.keyB && Phaser.Input.Keyboard.JustDown(this.keyB)) ||
        (this.keyEsc && Phaser.Input.Keyboard.JustDown(this.keyEsc));
      const aDown = (this.keyA && this.keyA.isDown) || (this.keySpace && this.keySpace.isDown);

      if (this.gameMusic) this.gameMusic.pauseForOverlay();
      this.arcadeOverlay.layout(this.gameCam);
      this.arcadeOverlay.tick(now, { up, down, left, right, aJust, aDown, bJust: backJust });

      if (!this.arcadeOverlay.isOpen) {
        this.resetInputState();
      }

      this.freezePlayer();
      return;
    }

    if (this.tvOverlay && this.tvOverlay.isOpen) {
      const aJust =
        Phaser.Input.Keyboard.JustDown(this.keyA) ||
        Phaser.Input.Keyboard.JustDown(this.keySpace);

      const backJust =
        (this.keyB && Phaser.Input.Keyboard.JustDown(this.keyB)) ||
        (this.keyEsc && Phaser.Input.Keyboard.JustDown(this.keyEsc));

      if (this.gameMusic) this.gameMusic.pauseForOverlay();
      this.tvOverlay.layout(this.gameCam);

      if (aJust) {
        if (!this.tvOverlay.soundUnlocked) this.tvOverlay.enableSoundFromGesture();
        else this.tvOverlay.close();
        this.touch.interact = false;
      }

      if (backJust) this.tvOverlay.close();

      this.freezePlayer();
      return;
    }

    if (this.shop && this.shop.isOpen) {
      if (!this.shopOpenedAt) {
        this.shopOpenedAt = now;
        this.emailPromptSnoozedThisSession = false;
      }

      const left = this.cursors.left.isDown || this.touch.left;
      const right = this.cursors.right.isDown || this.touch.right;
      const up = this.cursors.up.isDown || this.touch.up;
      const down = this.cursors.down.isDown || this.touch.down;

      const aJust =
        Phaser.Input.Keyboard.JustDown(this.keyA) ||
        Phaser.Input.Keyboard.JustDown(this.keySpace);

      const backJust =
        (this.keyEsc && Phaser.Input.Keyboard.JustDown(this.keyEsc)) ||
        (this.keyB && Phaser.Input.Keyboard.JustDown(this.keyB));

      if (this.gameMusic) this.gameMusic.pauseForOverlay();
      this.shop.layout(this.gameCam);
      this.shop.tick(now, { left, right, up, down, aJust, backJust });

      if (!this.shop.isOpen) {
        this.shopOpenedAt = 0;
        this.emailPromptSnoozedThisSession = false;
        this.resetInputState();
        this.freezePlayer();
        return;
      }

      if (
        !this.identitySubmitted &&
        !this.emailPromptSnoozedThisSession &&
        now - this.shopOpenedAt >= 30000 &&
        this.emailOverlay &&
        !this.emailOverlay.isOpen()
      ) {
        this.resetInputState();
        this.emailOverlay.open({
          name: this.localIdentity?.name || "",
          email: this.localIdentity?.email || "",
        });
        this.emailOverlayWasOpen = true;
      }

      this.freezePlayer();
      return;
    }

    this.shopOpenedAt = 0;
    this.emailPromptSnoozedThisSession = false;

    if (this.gameMusic && !this.tvOverlay?.isOpen && !this.shop?.isOpen) {
      this.gameMusic.resumeAfterOverlay();
    }

    const keyJustPressed =
      Phaser.Input.Keyboard.JustDown(this.keyA) ||
      Phaser.Input.Keyboard.JustDown(this.keySpace);

    if (this.dialogOpen) {
      const backJust =
        (this.keyB && Phaser.Input.Keyboard.JustDown(this.keyB)) ||
        (this.keyEsc && Phaser.Input.Keyboard.JustDown(this.keyEsc));
      if (keyJustPressed) this.handleA(now);
      else if (backJust) {
        if (this.dialogTyping) this.finishTyping();
        else this.closeDialog();
        this.touch.left = this.touch.right = this.touch.up = this.touch.down = false;
        this.dpadPointerId = null;
      }
      this.freezePlayer();
      return;
    }

    const effectiveCandidate = this.updateInteractCandidate(now);
    if (!this.dialogOpen && this.pendingInteractUntil > now && effectiveCandidate) {
      this.openDialog(effectiveCandidate);
      this.freezePlayer();
      return;
    }

    if (keyJustPressed) {
      this.handleA(now);
      if (this.dialogOpen || (this.shop && this.shop.isOpen) || (this.tvOverlay && this.tvOverlay.isOpen)) {
        this.freezePlayer();
        return;
      }
    }

    const body = this.player.body;
    if (!body) return;

    // Touch D-pad movement starts only after turn-hold delay (Pokemon-style turn in place).
    this.applyDpadTouchMovement(now);

    const leftPressed = (this.cursors?.left?.isDown || false) || !!this.touch.left;
    const rightPressed = (this.cursors?.right?.isDown || false) || !!this.touch.right;
    const upPressed = (this.cursors?.up?.isDown || false) || !!this.touch.up;
    const downPressed = (this.cursors?.down?.isDown || false) || !!this.touch.down;

    const running = (!!this.keyShift && this.keyShift.isDown) || !!this.runHeld;
    const speed = SPEED * (running ? RUN_MULT : 1);

    let vx = 0;
    let vy = 0;
    if (leftPressed) vx -= 1;
    if (rightPressed) vx += 1;
    if (upPressed) vy -= 1;
    if (downPressed) vy += 1;

    if (vx !== 0 || vy !== 0) {
      const len = Math.hypot(vx, vy) || 1;
      vx /= len;
      vy /= len;
      body.setVelocity(vx * speed, vy * speed);

      let dir = this.facing;
      if (Math.abs(vx) > Math.abs(vy)) dir = vx < 0 ? "left" : "right";
      else dir = vy < 0 ? "up" : "down";
      // Start walk animation immediately when movement input is active.
      this.playWalk(dir);
    } else {
      body.setVelocity(0, 0);
      this.stopWalk();
    }

    const playerBaseY = body.bottom;
    if (this.isTrophyRoom()) this.syncTrophyPillarDepths(playerBaseY);
    else this.player.setDepth(playerBaseY);
    if (this.worldLayer?.sort) this.worldLayer.sort("depth");
  }

  setModalKeyboardCapture(isModalOpen) {
    const keyboard = this.input?.keyboard;
    if (!keyboard) return;

    if (isModalOpen) {
      if (typeof this.keyboardPreventDefaultBeforeModal !== "boolean") {
        this.keyboardPreventDefaultBeforeModal = keyboard.preventDefault;
      }
      keyboard.enabled = false;
      keyboard.preventDefault = false;
      return;
    }

    keyboard.enabled = true;
    keyboard.preventDefault =
      typeof this.keyboardPreventDefaultBeforeModal === "boolean"
        ? this.keyboardPreventDefaultBeforeModal
        : true;
    keyboard.resetKeys?.();
  }

  dismissEmailPromptForShopSession() {
    this.emailPromptSnoozedThisSession = true;
    if (this.emailOverlay?.isOpen?.()) this.emailOverlay.close();
    this.emailOverlayWasOpen = false;
    this.resetInputState();
  }
}
export default RoomScene;
