import Phaser from "phaser";

const GAME_W = 320;
const GAME_H = 240;
const WORLD_ZOOM = 1;
const SPEED = 80;
const RUN_MULT = 1.8;
const RUN_HOLD_MS = 150;
const PLAYER_SCALE = 2;
const FEET_W = 10;
const FEET_H = 8;
const FEET_OFFSET_X = 3;
const FEET_OFFSET_Y = 8;

const DEBUG_UI = false;

// --- Computer Shop (Pokémon-style overlay w/ iOS-safe preview autoplay) ---
class ComputerShop {
  constructor(scene) {
    this.scene = scene;

    this.isOpen = false;
    this.data = { pageSize: 6, items: [] };

    this.page = 0;
    this.index = 0;

    this.mode = "list"; // "list" | "confirm"
    this.confirmChoice = 0; // 0 YES, 1 NO
    this.lastMoveAt = 0;
    this.repeatMs = 120;

    // Preview audio. iOS requires a user gesture before play() will succeed.
    this.audioUnlocked = false;
    this.audioUnlockSrc = "/previews/in_the_club_128bpm.mp3";
    this.audio = new Audio();
    this.audio.preload = "none";
    this.audio.loop = true;
    this.audio.volume = 0.9;

    this.rowHits = [];
    this._listAnchor = null;

    // UI container (lives in uiLayer)
    this.container = scene.add.container(0, 0);
    this.container.setVisible(false);
    this.container.setActive(false);

    // Fullscreen dimmer
    this.dim = scene.add.rectangle(0, 0, 10, 10, 0x000000, 0.85).setOrigin(0, 0);
    this.dim.setInteractive();
    this.dim.disableInteractive();
    this.dim.on("pointerdown", () => {
      if (!this.isOpen) return;
      if (this.mode === "confirm") {
        this.mode = "list";
        this.render();
      } else {
        this.close();
      }
    });

    // Main panel
    this.panelBorder = scene.add.rectangle(0, 0, 10, 10, 0x111111).setOrigin(0, 0);
    this.panelFill = scene.add.rectangle(0, 0, 10, 10, 0xffffff).setOrigin(0, 0);

    // Top-left metadata box (Pokémon mart-style)
    this.metaBorder = scene.add.rectangle(0, 0, 10, 10, 0x111111).setOrigin(0, 0);
    this.metaFill = scene.add.rectangle(0, 0, 10, 10, 0xffffff).setOrigin(0, 0);
    this.metaText = scene.add.text(0, 0, "", {
      fontFamily: "monospace",
      fontSize: "12px",
      color: "#111111",
      lineSpacing: 2,
    });

    this.title = scene.add.text(0, 0, "POKEPUTER", {
      fontFamily: "monospace",
      fontSize: "14px",
      color: "#111111",
    });

    this.list = scene.add.text(0, 0, "", {
      fontFamily: "monospace",
      fontSize: "14px",
      color: "#111111",
      lineSpacing: 4,
    });

    this.hint = scene.add.text(0, 0, "", {
      fontFamily: "monospace",
      fontSize: "12px",
      color: "#111111",
    });

    // Confirm box
    this.confirmBorder = scene.add.rectangle(0, 0, 10, 10, 0x111111).setOrigin(0, 0);
    this.confirmFill = scene.add.rectangle(0, 0, 10, 10, 0xffffff).setOrigin(0, 0);
    this.confirmText = scene.add.text(0, 0, "", {
      fontFamily: "monospace",
      fontSize: "14px",
      color: "#111111",
      lineSpacing: 4,
    });

    this.container.add([
      this.dim,
      this.panelBorder,
      this.panelFill,
      this.metaBorder,
      this.metaFill,
      this.metaText,
      this.title,
      this.list,
      this.hint,
      this.confirmBorder,
      this.confirmFill,
      this.confirmText,
    ]);

    this.hideConfirm();

    // Fire-and-forget load
    this.load();
  }

  async load() {
    try {
      const res = await fetch("/data/shop.json", { cache: "no-store" });
      if (!res.ok) throw new Error(`shop.json HTTP ${res.status}`);
      const json = await res.json();
      if (json && Array.isArray(json.items)) {
        this.data = json;
        if (!this.data.pageSize) this.data.pageSize = 6;
      } else {
        this.data = { pageSize: 6, items: [] };
      }
      this.page = 0;
      this.index = 0;
      this.render();
    } catch (e) {
      // Fallback demo data so the UI is testable even before shop.json exists.
      console.warn("ComputerShop: failed to load /data/shop.json, using fallback", e);
      this.data = {
        pageSize: 6,
        items: [
          { id: "beat1", name: "BEAT 01", price: 100, preview: "/previews/beat01.mp3", buyUrl: "" },
          { id: "beat2", name: "BEAT 02", price: 100, preview: "/previews/beat02.mp3", buyUrl: "" },
          { id: "beat3", name: "BEAT 03", price: 100, preview: "/previews/beat03.mp3", buyUrl: "" },
          { id: "beat4", name: "BEAT 04", price: 100, preview: "/previews/beat04.mp3", buyUrl: "" },
          { id: "beat5", name: "BEAT 05", price: 100, preview: "/previews/beat05.mp3", buyUrl: "" },
          { id: "coffee", name: "BUY ME A COFFEE", price: 5, preview: "/previews/coffee.mp3", buyUrl: "" },
        ],
      };
      this.page = 0;
      this.index = 0;
      this.render();
    }
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.mode = "list";
    this.confirmChoice = 0;
    this.container.setVisible(true);
    this.container.setActive(true);
    this.dim.setInteractive();
    this.container.setDepth(9999);
    this.render();

    // Only autoplay immediately if we already unlocked audio earlier.
    if (this.audioUnlocked) this.autoplaySelection();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.mode = "list";
    this.confirmChoice = 0;
    this.container.setVisible(false);
    this.container.setActive(false);
    this.dim.disableInteractive();
    this.stopPreview();
    this.hideConfirm();
    this.updateRowHits(0);
  }

  // Call this from an actual user gesture (pointer/key) to satisfy iOS.
  unlockAudioFromGesture() {
    if (this.audioUnlocked) return;
    const audio = this.audio;
    const onSuccess = () => {
      audio.pause();
      audio.currentTime = 0;
      audio.muted = false;
      audio.loop = true;
      this.audioUnlocked = true;
      if (this.isOpen) this.autoplaySelection();
    };
    const onFailure = () => {
      audio.muted = false;
      audio.loop = true;
      this.audioUnlocked = false;
    };

    try {
      const unlockSrc = this.selectedItem()?.preview || this.audioUnlockSrc;
      if (!unlockSrc) return;
      audio.src = unlockSrc;
      audio.muted = true;
      audio.loop = false;
      const p = audio.play();
      if (p && typeof p.then === "function") {
        p.then(onSuccess).catch(onFailure);
      } else {
        onSuccess();
      }
    } catch {
      onFailure();
    }
  }

  layout(gameCam) {
    const scene = this.scene;

    // Prefer camera viewport position/size via camera.x/y/width/height.
    // On some mobile builds, `camera.viewport` can be undefined or not reflect setViewport.
    // We want the shop confined strictly to the GBA screen (game camera viewport).
    let vpX = 0;
    let vpY = 0;
    let vpW = scene.scale.width;
    let vpH = scene.scale.height;

    if (
      gameCam &&
      Number.isFinite(gameCam.x) &&
      Number.isFinite(gameCam.y) &&
      Number.isFinite(gameCam.width) &&
      Number.isFinite(gameCam.height) &&
      gameCam.width > 0 &&
      gameCam.height > 0
    ) {
      vpX = Math.round(gameCam.x);
      vpY = Math.round(gameCam.y);
      vpW = Math.round(gameCam.width);
      vpH = Math.round(gameCam.height);
    }

    // IMPORTANT: keep the shop overlay confined to the GBA screen (game camera viewport)
    // so the on-screen D-pad/A controls (in the bottom deck area) remain tappable.
    this.dim.setPosition(vpX, vpY);
    this.dim.setSize(vpW, vpH);

    const border = 4;
    const pad = 8;

    // Fill the GBA screen with a small inset border, Pokémon-style.
    const panelX = Math.round(vpX + 4);
    const panelY = Math.round(vpY + 4);
    const panelW = Math.round(vpW - 8);
    const panelH = Math.round(vpH - 8);

    this.panelBorder.setPosition(panelX, panelY);
    this.panelBorder.setSize(panelW, panelH);

    this.panelFill.setPosition(panelX + border, panelY + border);
    this.panelFill.setSize(panelW - border * 2, panelH - border * 2);

    // Meta box dims (top-left, like the mart money box)
    const metaW = Math.min(150, Math.floor(panelW * 0.46));
    const metaH = 64;
    const metaX = Math.round(panelX + border + pad);
    const metaY = Math.round(panelY + border + pad);

    this.metaBorder.setPosition(metaX, metaY);
    this.metaBorder.setSize(metaW, metaH);

    this.metaFill.setPosition(metaX + border, metaY + border);
    this.metaFill.setSize(metaW - border * 2, metaH - border * 2);

    this.metaText.setPosition(metaX + border + 6, metaY + border + 5);
    this.metaText.setWordWrapWidth(Math.max(10, metaW - (border * 2 + 12)));

    // List/title start to the right of the meta box
    const listX = Math.round(metaX + metaW + 14);
    const listY = Math.round(panelY + border + pad);

    this.title.setPosition(listX, listY);
    this.list.setPosition(listX, Math.round(listY + 22));
    this.hint.setPosition(panelX + border + pad, Math.round(panelY + panelH - border - pad - 14));

    const listRight = Math.round(panelX + panelW - border - pad);
    const fontSize = Number.parseInt(this.list.style.fontSize, 10) || 14;
    const lineSpacing = Number.isFinite(this.list.lineSpacing) ? this.list.lineSpacing : 0;
    const lineHeight = Math.max(12, fontSize + lineSpacing);
    this._listAnchor = {
      x: listX,
      y: Math.round(listY + 22),
      rowW: Math.max(10, listRight - listX),
      rowH: lineHeight,
    };

    // Store for render() so it can format meta text without re-measuring
    this._metaBox = { metaW, metaH };

    this._confirmAnchor = { panelX, panelY, panelW, panelH, border, pad };
    this.render();
  }

  pageItems() {
    const items = this.data?.items || [];
    const size = this.data?.pageSize || 6;
    const start = this.page * size;
    return items.slice(start, start + size);
  }

  selectedItem() {
    const page = this.pageItems();
    if (!page.length) return null;
    const idx = Math.max(0, Math.min(page.length - 1, this.index));
    return page[idx] || null;
  }

  stopPreview() {
    try {
      this.audio.pause();
      this.audio.currentTime = 0;
      this.audio.src = "";
    } catch {}
  }

  autoplaySelection() {
    if (!this.audioUnlocked) return;

    const item = this.selectedItem();
    const preview = item?.preview;
    if (!preview) {
      this.stopPreview();
      return;
    }
    if (this.audio.src && this.audio.src.includes(preview)) return;

    try {
      this.audio.pause();
      this.audio.currentTime = 0;
      this.audio.src = preview;
      const p = this.audio.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch {}
  }

  ensureRowHits() {
    const size = this.data?.pageSize || 6;
    while (this.rowHits.length < size) {
      const rowIndex = this.rowHits.length;
      const hit = this.scene.add.rectangle(0, 0, 10, 10, 0x000000, 0);
      hit.setOrigin(0, 0);
      hit.setAlpha(0);
      hit.setInteractive();
      hit.on("pointerover", () => this.handleRowHover(rowIndex));
      hit.on("pointermove", () => this.handleRowHover(rowIndex));
      this.container.add(hit);
      this.rowHits.push(hit);
    }
    while (this.rowHits.length > size) {
      const hit = this.rowHits.pop();
      if (hit) hit.destroy();
    }
  }

  updateRowHits(visibleCount) {
    this.ensureRowHits();
    const anchor = this._listAnchor;
    if (!anchor) return;
    const canSelect = this.isOpen && this.mode === "list";

    for (let i = 0; i < this.rowHits.length; i++) {
      const hit = this.rowHits[i];
      const active = canSelect && i < visibleCount;
      hit.setVisible(active);
      if (hit.input) hit.input.enabled = active;
      if (!active) continue;
      const rowY = Math.round(anchor.y + i * anchor.rowH);
      hit.setPosition(anchor.x, rowY);
      hit.setSize(anchor.rowW, anchor.rowH);
      if (hit.input?.hitArea) {
        hit.input.hitArea.width = anchor.rowW;
        hit.input.hitArea.height = anchor.rowH;
      }
    }
  }

  handleRowHover(rowIndex) {
    if (!this.isOpen || this.mode !== "list") return;
    const page = this.pageItems();
    if (!page.length) return;
    const next = Math.max(0, Math.min(page.length - 1, rowIndex));
    if (next === this.index) return;
    this.index = next;
    this.render();
    this.autoplaySelection();
  }

  render() {
    const pageItems = this.pageItems();
    const total = this.data?.items?.length || 0;
    const size = this.data?.pageSize || 6;
    const pageCount = Math.max(1, Math.ceil(total / size));

    const lines = [];
    for (let i = 0; i < pageItems.length; i++) {
      const it = pageItems[i];
      const cursor = i === this.index ? "▶" : " ";
      const price = typeof it.price === "number" ? `$${it.price}` : "";
      lines.push(`${cursor} ${it.name}${price ? `  ${price}` : ""}`);
    }
    if (!pageItems.length) lines.push("  (No items)");

    this.list.setText(lines.join("\n"));
    this.updateRowHits(pageItems.length);

    // Update top-left metadata box (SONGNAME / BPM / KEY / TAGS)
    const sel = this.selectedItem();
    const song = sel?.songName || sel?.name || "—";
    const bpm = Number.isFinite(sel?.bpm) ? String(sel.bpm) : sel?.bpm ? String(sel.bpm) : "—";
    const key = sel?.key ? String(sel.key) : "—";
    const tags = Array.isArray(sel?.tags) ? sel.tags.join(", ") : sel?.tags ? String(sel.tags) : "—";
    this.metaText.setText(`SONG: ${song}\nBPM: ${bpm}\nKEY: ${key}\nTAGS: ${tags}`);

    const audioHint = this.audioUnlocked ? "" : "  (Press A to enable sound)";
    if (this.mode === "list") {
      this.hint.setText(`A: Select   B: Back   Page ${this.page + 1}/${pageCount}${audioHint}`);
    } else {
      this.hint.setText(audioHint);
    }

    if (this.mode === "confirm") this.showConfirm();
    else this.hideConfirm();
  }

  showConfirm() {
    const item = this.selectedItem();
    if (!item || !this._confirmAnchor) return;

    const { panelX, panelY, panelW, panelH, border, pad } = this._confirmAnchor;
    const cW = Math.round(panelW * 0.78);
    const cH = 86;
    const cX = Math.round(panelX + panelW - cW - 10);
    const cY = Math.round(panelY + panelH - cH - 10);

    this.confirmBorder.setVisible(true);
    this.confirmFill.setVisible(true);
    this.confirmText.setVisible(true);

    this.confirmBorder.setPosition(cX, cY);
    this.confirmBorder.setSize(cW, cH);

    this.confirmFill.setPosition(cX + border, cY + border);
    this.confirmFill.setSize(cW - border * 2, cH - border * 2);

    const yesCursor = this.confirmChoice === 0 ? "▶" : " ";
    const noCursor = this.confirmChoice === 1 ? "▶" : " ";

    const name = item.name || "this";
    const price = typeof item.price === "number" ? `$${item.price}` : "";

    this.confirmText.setPosition(cX + border + pad, cY + border + pad);
    this.confirmText.setText(`Buy ${name} for ${price}?\n\n${yesCursor} YES\n${noCursor} NO`);
  }

  hideConfirm() {
    this.confirmBorder.setVisible(false);
    this.confirmFill.setVisible(false);
    this.confirmText.setVisible(false);
  }

  moveSelection(delta) {
    const page = this.pageItems();
    if (!page.length) return;
    const next = Math.max(0, Math.min(page.length - 1, this.index + delta));
    if (next === this.index) return;
    this.index = next;
    this.render();
    this.autoplaySelection();
  }

  movePage(delta) {
    const total = this.data?.items?.length || 0;
    const size = this.data?.pageSize || 6;
    const pageCount = Math.max(1, Math.ceil(total / size));
    const next = Math.max(0, Math.min(pageCount - 1, this.page + delta));
    if (next === this.page) return;
    this.page = next;
    this.index = 0;
    this.render();
    this.autoplaySelection();
  }

  confirmOpen() {
    if (!this.selectedItem()) return;
    this.mode = "confirm";
    this.confirmChoice = 0;
    this.render();
  }

  confirmMove(delta) {
    const next = Math.max(0, Math.min(1, this.confirmChoice + delta));
    if (next === this.confirmChoice) return;
    this.confirmChoice = next;
    this.render();
  }

  confirmAccept() {
    const item = this.selectedItem();
    if (!item) {
      this.mode = "list";
      this.render();
      return;
    }

    // NO
    if (this.confirmChoice === 1) {
      this.mode = "list";
      this.render();
      return;
    }

    // YES
    this.stopPreview();

    const url = item.buyUrl;
    if (url && typeof url === "string" && url.startsWith("http")) {
      window.open(url, "_blank", "noopener,noreferrer");
    }

    this.mode = "list";
    this.render();
  }

  // Returns true if handled.
  tick(now, input) {
    if (!this.isOpen) return false;

    const { left, right, up, down, aJust, backJust } = input;
    const canMove = now - this.lastMoveAt >= this.repeatMs;

    // Back closes shop or returns from confirm
    if (backJust) {
      if (this.mode === "confirm") {
        this.mode = "list";
        this.render();
      } else {
        this.close();
      }
      return true;
    }

    // Any input counts as a "gesture" attempt for audio unlock.
    if (left || right || up || down || aJust) {
      // Note: key presses are user gestures; pointer handlers call unlockAudioFromGesture() directly.
      if (!this.audioUnlocked && aJust) this.unlockAudioFromGesture();
    }

    if (this.mode === "list") {
      if (canMove && up) {
        this.lastMoveAt = now;
        this.moveSelection(-1);
      } else if (canMove && down) {
        this.lastMoveAt = now;
        this.moveSelection(1);
      } else if (canMove && left) {
        this.lastMoveAt = now;
        this.movePage(-1);
      } else if (canMove && right) {
        this.lastMoveAt = now;
        this.movePage(1);
      }

      if (aJust) {
        this.confirmOpen();
      }
    } else {
      // confirm
      if (canMove && (up || down)) {
        this.lastMoveAt = now;
        this.confirmMove(up ? -1 : 1);
      }
      if (aJust) {
        this.confirmAccept();
      }
    }

    return true;
  }
}
// --- end ComputerShop ---

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
    this.load.image("ssl", "/assets/room/ssl.png");
    this.load.image("spkL", "/assets/room/speakerv2_L.png");
    this.load.image("spkR", "/assets/room/speakerv2_R.png");
    this.load.image("studer", "/assets/room/studer.png");
    this.load.image("studer_controller", "/assets/room/studer_controller.png");
    this.load.image("couch", "/assets/room/couch.png");
    this.load.image("ui_dpad", "/assets/ui/dpad.png");
    this.load.image("ui_a", "/assets/ui/abutton.png");
    this.load.image("floor", "/assets/room/floor.png");
  }

  create() {

    this.worldLayer = this.add.container(0, 0);
    this.uiLayer = this.add.container(0, 0);

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

    this.cursors = this.input.keyboard.createCursorKeys();
    this.keyA = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.keySpace = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.keyShift = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    this.keyB = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.B);
    this.keyEsc = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    // Enable multi-touch (needed to hold D-pad with one finger while pressing A with another).
    // Default is often 1 touch pointer; we want a few.
    this.input.addPointer(3);

    this.touch = { left: false, right: false, up: false, down: false, interact: false };
    this.lastPressedTime = { left: 0, right: 0, up: 0, down: 0 };
    this.inputTick = 0;
    this.pendingInteractUntil = 0;
    this.uiBound = false;
    this.aIsDown = false;
    this.aDownAt = 0;
    this.runHeld = false;
    this.runArmTimer = null;

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
    const PROP_SCALE = 0.5;
    const wallY = TOP_WALL_Y + TOP_WALL_H + CORNER_PAD;

    const spkL = this.add.image(0, 0, "spkL").setOrigin(0, 0);
    const spkR = this.add.image(0, 0, "spkR").setOrigin(0, 0);
    // Slightly bigger speakers (keep same non-uniform proportions)
    spkL.setScale(PROP_SCALE * 1.75, PROP_SCALE * 2.2);
    spkR.setScale(PROP_SCALE * 1.75, PROP_SCALE * 2.2);
    const SPEAKER_Y = wallY - 15; // shift speakers back 5px (toward top wall)
    const GAP_BASE = 10;
    // More negative = speakers pull inward (closer to the console)
    const GAP_INNER = -32;
    const CONSOLE_Y_OFFSET = 24;
    const LAYOUT_SHIFT_X = -37;
    const GROUP_SHIFT_X = -15;
    const consoleX = Math.round(CORNER_PAD + spkL.displayWidth + GAP_BASE + LAYOUT_SHIFT_X + 5 + GROUP_SHIFT_X);
    this.worldLayer.add([spkL, spkR]);

    const makeBlocker = (sprite, widthRatio, heightPx) => {
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
    };

    this.interactables = [];
    this.interactCandidate = null;
    this.lastCandidate = null;
    this.lastCandidateTime = 0;
    this.prevTouchInteract = false;
    const addInteractable = ({ id, sprite, text, getInteractRect }) => {
      const base = sprite.blocker ? sprite.blocker.getBottomCenter() : sprite.getBottomCenter();
      const interactPointX = Math.round(base.x);
      const interactPointY = Math.round(base.y + 6);
      const entry = { id, sprite, text, interactPointX, interactPointY, getInteractRect };
      this.interactables.push(entry);
      return entry;
    };

    const pc = this.add.image(0, 0, "room_pc").setOrigin(0.5, 0.5);
    pc.setScale(PROP_SCALE);
    pc.setOrigin(1, 0);
    pc.setPosition(GAME_W - CORNER_PAD + 4, wallY - 12);
    this.worldLayer.add(pc);
    this.pc = pc;
    makeBlocker(pc, 0.8, 12);

    const ssl = this.add.image(0, 0, "ssl").setOrigin(0, 0);
    ssl.setScale(PROP_SCALE * 1.9);
    const sslY = Math.round(SPEAKER_Y + CONSOLE_Y_OFFSET);
    ssl.setPosition(consoleX + 1, sslY);
    this.worldLayer.add(ssl);
    makeBlocker(ssl, 0.8, 12);

    const spkLX = Math.round(consoleX - spkL.displayWidth - GAP_INNER - 10);
    const spkRX = Math.round(consoleX + ssl.displayWidth + GAP_INNER + 12);
    spkL.setPosition(spkLX, Math.round(SPEAKER_Y));
    spkR.setPosition(spkRX, Math.round(SPEAKER_Y));

    makeBlocker(spkL, 0.8, 12);
    makeBlocker(spkR, 0.8, 12);

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
    makeBlocker(this.studerController, 0.8, 12);
    makeBlocker(this.studer, 0.8, 12);

    // Couch temporarily disabled
    const SHOW_COUCH = true;
    let couch = null;
    if (SHOW_COUCH) {
      couch = this.add.image(0, 0, "couch").setOrigin(0, 0);
      couch.setScale(PROP_SCALE * 3);
      const couchX = CORNER_PAD - 5;
      const couchY = Math.round(GAME_H / 2 - couch.displayHeight / 2 + 86);
      couch.setPosition(couchX, couchY);
      this.worldLayer.add(couch);
      makeBlocker(couch, 0.95, 16);
    }

    addInteractable({
      id: "pc",
      sprite: pc,
      text: "Computer...",
    });
    addInteractable({
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
      addInteractable({
        id: "couch",
        sprite: couch,
        text: "This couch has seen a lot of late nights...",
      });
    }
    addInteractable({
      id: "studer",
      sprite: this.studer,
      text: "This is ancient technology... Maybe I should try a plugin...",
    });
    addInteractable({
      id: "studer_controller",
      sprite: this.studerController,
      text: "*click* ~a faint whirring sound is coming from the tape machine.~",
    });

    if (DEBUG_UI) {
      this.interactProbe = this.add.circle(0, 0, 2, 0xff00ff, 1);
      this.interactProbe.setDepth(9999);
      this.worldLayer.add(this.interactProbe);
      this.interactCandidateOutline = this.add.rectangle(0, 0, 10, 10, 0x000000, 0);
      this.interactCandidateOutline.setStrokeStyle(1, 0xffff00);
      this.interactCandidateOutline.setDepth(9998);
      this.worldLayer.add(this.interactCandidateOutline);
    }

    console.log("pc parent", pc.parentContainer, "pc cam", pc.cameraFilter);
    console.log("player parent", this.player.parentContainer, "player cam", this.player.cameraFilter);

    this.createControls();

    // Ensure camera viewport + UI positions are set before any overlays read `gameCam.viewport`.
    this.layout();

    // Computer shop overlay (Pokémon-style)
    this.shop = new ComputerShop(this);
    this.uiLayer.add(this.shop.container);
    this.shop.layout(this.gameCam);

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
      frameRate: 8,
      repeat: -1,
    });
    this.anims.create({
      key: "walk_right",
      frames: this.anims.generateFrameNumbers("p_right", { start: 0, end: 1 }),
      frameRate: 8,
      repeat: -1,
    });

    this.layout();
    this.scale.on("resize", () => this.layout());
  }

  createControls() {
    if (this.uiBound) return;
    this.uiBound = true;

    this.deckBg = this.add.rectangle(0, 0, 10, 10, 0x000000).setOrigin(0, 0);
    this.uiLayer.add(this.deckBg);

    this.dpadVisual = this.add.container(0, 0);
    const dpadImg = this.add.image(0, 0, "ui_dpad").setOrigin(0.5);
    this.dpadVisual.add(dpadImg);
    this.uiLayer.add(this.dpadVisual);

    this.aVisual = this.add.container(0, 0);
    const aImg = this.add.image(0, 0, "ui_a").setOrigin(0.5);
    this.aVisual.add(aImg);
    this.uiLayer.add(this.aVisual);

    const dpadRadius = 70;
    const aVisualRadius = 48;
    const aHitRadius = 72;

    if (dpadImg.width > 0) {
      const desired = dpadRadius * 2;
      dpadImg.setScale(desired / dpadImg.width);
    }
    if (aImg.width > 0) {
      const desired = aVisualRadius * 2 * 2.0;
      aImg.setScale(desired / aImg.width);
    }

    this.dpadHit = this.add.circle(0, 0, dpadRadius, 0x000000, 0.001);
    this.aHit = this.add.circle(0, 0, aHitRadius, 0x000000, 0.001);
    // Make both controls independently touchable.
    this.dpadHit.setInteractive({ useHandCursor: false });
    this.aHit.setInteractive({ useHandCursor: false });

    this.uiLayer.add([this.dpadHit, this.aHit]);

    this.dpadPointerId = null;
    const deadzone = 10;

    const handleDpadPointer = (pointer) => {
      if (this.dialogOpen) return;

      // Use UI camera coordinates so the D-pad works regardless of game camera viewport.
      const camPoint = pointer.positionToCamera(this.uiCam);
      const cx = this.dpadHit.x;
      const cy = this.dpadHit.y;
      const dx = camPoint.x - cx;
      const dy = camPoint.y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (!Number.isFinite(dist) || dist < deadzone) {
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
      // When shop is open, don't change facing; cursor movement is handled in update() via touch states.
      if (!this.shop?.isOpen) {
        this.setFacing(dir);
      }
    };

    this.dpadHit.on("pointerdown", (ptr) => {
      if (this.dialogOpen) return;
      // Always re-claim on tap (helps iOS double-tap edge cases)
      this.dpadPointerId = null;
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

    this.aHit.on("pointerdown", (p) => {
      p.event?.preventDefault?.();
      p.event?.stopPropagation?.();

      const now = this.time.now;

      // If the shop is open, A should operate the shop (and unlock audio) and never arm run.
      if (this.shop?.isOpen) {
        this.shop.unlockAudioFromGesture();
        this.shop.layout(this.gameCam);
        this.shop.tick(now, { left: false, right: false, up: false, down: false, aJust: true, backJust: false });
        return;
      }

      // If dialog is open, A always advances/closes immediately (no running).
      if (this.dialogOpen) {
        this.handleA(now);
        return;
      }

      // Arm a hold-to-run gesture on mobile.
      this.aIsDown = true;
      this.aDownAt = now;
      this.runHeld = false;

      if (this.runArmTimer) {
        this.runArmTimer.remove(false);
        this.runArmTimer = null;
      }

      this.runArmTimer = this.time.delayedCall(RUN_HOLD_MS, () => {
        // Only start running if still held and no dialog popped.
        if (this.aIsDown && !this.dialogOpen) {
          this.runHeld = true;
        }
      });
    });

    const endAHold = (p) => {
      // End running on release.
      const now = this.time.now;
      const wasDown = this.aIsDown;
      const heldMs = wasDown ? now - this.aDownAt : 0;

      this.aIsDown = false;
      const wasRunning = this.runHeld;
      this.runHeld = false;

      if (this.runArmTimer) {
        this.runArmTimer.remove(false);
        this.runArmTimer = null;
      }

      // Treat short press as a tap-to-interact.
      // If it was a run hold, do NOT trigger dialog.
      if (!this.dialogOpen && wasDown && !wasRunning && heldMs < RUN_HOLD_MS) {
        this.handleA(now);
      }
    };

    this.aHit.on("pointerup", endAHold);
    this.aHit.on("pointerupoutside", endAHold);
    this.aHit.on("pointerout", endAHold);

    // Always position the UI immediately after creating controls.
    this.layout();
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

    // Clamp viewport so small screens never produce a negative viewport X (which shifts everything left).
    const vpX = Math.max(0, Math.floor((canvasW - vpW) / 2));
    const vpY = Math.max(0, Math.floor((deckTop - vpH) / 2) - 50);

    this.gameCam.setViewport(vpX, vpY, vpW, vpH);
    this.gameCam.setScroll(0, 0);
    this.uiCam.setViewport(0, 0, canvasW, canvasH);

    if (this.dialogContainer && this.dialogBorder && this.dialogFill && this.dialogText) {
      const margin = 8;
      const border = 4;
      const pad = 6;
      const boxW = Math.round(vpW * 0.93);
      const boxH = Math.round(vpH * 0.27);
      const boxX = Math.round(vpX + (vpW - boxW) / 2);
      const boxY = Math.round(vpY + vpH - boxH - margin);
      this.dialogBorder.setPosition(boxX, boxY);
      this.dialogBorder.setSize(boxW, boxH);
      this.dialogFill.setPosition(boxX + border, boxY + border);
      this.dialogFill.setSize(
        Math.max(4, boxW - border * 2),
        Math.max(4, boxH - border * 2)
      );
      const textX = boxX + border + pad;
      const textY = boxY + border + pad + 1;
      const textW = Math.max(4, boxW - 2 * (border + pad));
      this.dialogText.setPosition(textX, textY);
      this.dialogText.setWordWrapWidth(textW);
      this.dialogSlideOffsetY = Math.max(0, vpY + vpH - boxY + 4);
    }

    if (this.deckBg) {
      this.deckBg.setPosition(0, deckTop);
      this.deckBg.setDisplaySize(canvasW, deckHeight);
    }

    const pad = 24;
    const dpadX = pad + 70;
    const dpadY = deckTop + deckHeight / 2 - 25;
    const aX = canvasW - (pad + 70);
    const aY = dpadY;

    if (this.dpadVisual) this.dpadVisual.setPosition(dpadX, dpadY);
    if (this.aVisual) this.aVisual.setPosition(aX, aY);
    if (this.dpadHit) this.dpadHit.setPosition(dpadX, dpadY);
    if (this.aHit) this.aHit.setPosition(aX, aY);

    if (this.shop) this.shop.layout(this.gameCam);
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

    // PC opens the shop overlay
    if (candidate.id === "pc" && this.shop) {
      this.shop.unlockAudioFromGesture();
      this.shop.open();
      this.shop.layout(this.gameCam);
      return;
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

  update() {
    if (!this.__t) this.__t = 0;
    this.__t += 1;
    if (this.__t % 120 === 0) console.log("update tick", this.__t);

    this.inputTick += 1;

    const now = this.time.now;

    // --- Shop overlay takes over input ---
    if (this.shop && this.shop.isOpen) {
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

      // Freeze player
      this.touch.interact = false;
      this.runHeld = false;
      const body = this.player.body;
      body.setVelocity(0);
      this.stopWalk();

      // Keep shop layout in sync with viewport
      this.shop.layout(this.gameCam);
      this.shop.tick(now, { left, right, up, down, aJust, backJust });

      // Important: DO NOT clear `this.touch.*` while the shop is open.
      // On mobile, holding the D-pad often doesn't emit pointermove events every frame,
      // so if we clear the flags here the menu will stop responding unless the user wiggles/spams.
      // We only clear touch directions AFTER the shop closes to prevent movement bleed.
      if (!this.shop.isOpen) {
        this.touch.left = this.touch.right = this.touch.up = this.touch.down = false;
        this.dpadPointerId = null;
      }

      // Keep depth stable
      const playerBaseY = this.player.body ? this.player.body.bottom : this.player.y;
      this.player.setDepth(playerBaseY);
      if (this.worldLayer?.sort) this.worldLayer.sort("depth");

      return;
    }

    const keyJustPressed =
      Phaser.Input.Keyboard.JustDown(this.keyA) ||
      Phaser.Input.Keyboard.JustDown(this.keySpace);

    const freezePlayer = () => {
      this.touch.interact = false;
      this.runHeld = false;
      const body = this.player.body;
      body.setVelocity(0);
      this.stopWalk();
      const playerBaseY = this.player.body ? this.player.body.bottom : this.player.y;
      this.player.setDepth(playerBaseY);
      if (this.worldLayer?.sort) this.worldLayer.sort("depth");
    };

    if (this.dialogOpen) {
      if (keyJustPressed) this.handleA(now);
      freezePlayer();
      return;
    }

    const effectiveCandidate = this.updateInteractCandidate(now);
    if (!this.dialogOpen && this.pendingInteractUntil > now && effectiveCandidate) {
      this.openDialog(effectiveCandidate);
      freezePlayer();
      return;
    }

    if (keyJustPressed) {
      this.handleA(now);
      if (this.dialogOpen) {
        freezePlayer();
        return;
      }
    }

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

    // Run is held on mobile via A-hold, and on keyboard via Shift.
    const isRunActive = (this.keyShift && this.keyShift.isDown) || this.runHeld;
    const moveSpeed = isRunActive ? SPEED * RUN_MULT : SPEED;

    body.setVelocity(0);
    if (moveX !== 0) body.setVelocityX(moveX * moveSpeed);
    if (moveY !== 0) body.setVelocityY(moveY * moveSpeed);
    body.velocity.normalize().scale(moveSpeed);

    // Speed up walk animation when running.
    this.player.anims.timeScale = isRunActive ? RUN_MULT : 1.0;

    const isMoving = body.velocity.lengthSq() > 0.1;
    if (isMoving && movingDir) this.playWalk(movingDir);
    else this.stopWalk();
    if (!isMoving) this.player.anims.timeScale = 1.0;

    this.touch.interact = false;

    const playerBaseY = this.player.body ? this.player.body.bottom : this.player.y;
    this.player.setDepth(playerBaseY);
    if (this.worldLayer?.sort) this.worldLayer.sort("depth");
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
