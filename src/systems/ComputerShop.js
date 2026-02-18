import { deriveBeatId, normalizeShopItems } from "../config/gameConfig";

export default class ComputerShop {
  constructor(scene, hooks = {}) {
    this.scene = scene;

    this.isOpen = false;
    this.data = { pageSize: 5, items: [] };

    this.page = 0;
    this.index = 0;

    this.mode = "list";
    this.confirmChoice = 0;
    this.lastMoveAt = 0;
    this.repeatMs = 120;

    this.audioUnlocked = false;
    this.audioUnlockSrc = "/previews/in_the_club_128bpm.mp3";
    this.audio = new Audio();
    this.audio.preload = "none";
    this.audio.loop = true;
    this.audio.volume = 0.9;

    this.onOpen = hooks.onOpen;
    this.onClose = hooks.onClose;

    this.rowHits = [];
    this._listAnchor = null;
    this._didSanityCheck = false;

    this.container = scene.add.container(0, 0);
    this.container.setVisible(false);
    this.container.setActive(false);

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

    this.panelBorder = scene.add.rectangle(0, 0, 10, 10, 0x111111).setOrigin(0, 0);
    this.panelFill = scene.add.rectangle(0, 0, 10, 10, 0xffffff).setOrigin(0, 0);

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
      fontSize: "13px",
      color: "#111111",
    });

    this.list = scene.add.text(0, 0, "", {
      fontFamily: "monospace",
      fontSize: "13px",
      color: "#111111",
      lineSpacing: 3,
    });
    this.priceList = scene.add.text(0, 0, "", {
      fontFamily: "monospace",
      fontSize: "13px",
      color: "#111111",
      lineSpacing: 3,
    });

    this.hint = scene.add.text(0, 0, "", {
      fontFamily: "monospace",
      fontSize: "11px",
      color: "#111111",
    });

    this.selectBg = scene.add.rectangle(0, 0, 10, 10, 0xdddddd, 0.35).setOrigin(0, 0);
    this.selectBg.setVisible(false);

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
      this.selectBg,
      this.list,
      this.priceList,
      this.hint,
      this.confirmBorder,
      this.confirmFill,
      this.confirmText,
    ]);

    this.hideConfirm();
    this.load();
  }

  normalizeLoadedData(json) {
    const pageSize = Number.isFinite(json?.pageSize) ? json.pageSize : 5;
    const items = normalizeShopItems(json?.items || [], pageSize).map((item, index) => ({
      ...item,
      beatId: deriveBeatId(item, index),
    }));
    return { pageSize, items };
  }

  runShopSanityCheck() {
    if (this._didSanityCheck) return;
    this._didSanityCheck = true;

    const pageSize = Number.isFinite(this.data?.pageSize) ? this.data.pageSize : 5;
    const items = Array.isArray(this.data?.items) ? this.data.items : [];
    const isCoffee = (item) => {
      const name = String(item?.name || "").toLowerCase();
      const id = String(item?.id || "").toLowerCase();
      return name === "buymecoffee" || name === "buy me a coffee" || id === "coffee";
    };

    const beatCount = items.filter((item) => !isCoffee(item)).length;
    const coffeeIndex = items.findIndex((item) => isCoffee(item));
    const coffeeExpected = Math.max(0, pageSize - 1);
    if (beatCount !== 20 || coffeeIndex !== coffeeExpected) {
      console.warn("[ComputerShop] shop.json sanity warning", {
        beatCount,
        expectedBeatCount: 20,
        coffeeIndex,
        expectedCoffeeIndex: coffeeExpected,
        pageSize,
      });
    }
  }

  async load() {
    try {
      const res = await fetch("/data/shop.json", { cache: "no-store" });
      if (!res.ok) throw new Error(`shop.json HTTP ${res.status}`);
      const json = await res.json();
      this.data = this.normalizeLoadedData(json || {});
      this.runShopSanityCheck();
      this.page = 0;
      this.index = 0;
      this.render();
    } catch (e) {
      console.warn("ComputerShop: failed to load /data/shop.json, using fallback", e);
      this.data = this.normalizeLoadedData({
        pageSize: 5,
        items: [
          { id: "beat1", name: "BEAT 01", price: 100, preview: "/previews/beat01.mp3", buyUrl: "", beatId: "beat-01" },
          { id: "beat2", name: "BEAT 02", price: 100, preview: "/previews/beat02.mp3", buyUrl: "", beatId: "beat-02" },
          { id: "beat3", name: "BEAT 03", price: 100, preview: "/previews/beat03.mp3", buyUrl: "", beatId: "beat-03" },
          { id: "beat4", name: "BEAT 04", price: 100, preview: "/previews/beat04.mp3", buyUrl: "", beatId: "beat-04" },
          { id: "coffee", name: "BUY ME A COFFEE", price: 5, preview: "/previews/coffee.mp3", buyUrl: "", beatId: "coffee" },
          { id: "beat5", name: "BEAT 05", price: 100, preview: "/previews/beat05.mp3", buyUrl: "", beatId: "beat-05" },
        ],
      });
      this.runShopSanityCheck();
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
    this.autoplaySelection();
    if (typeof this.onOpen === "function") this.onOpen();
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
    if (typeof this.onClose === "function") this.onClose();
  }

  unlockAudioFromGesture() {
    if (this.audioUnlocked) return;
    const audio = this.audio;
    const unlockSrc = this.selectedItem()?.preview || this.audioUnlockSrc;
    if (!unlockSrc) return;

    audio.src = unlockSrc;
    audio.muted = true;
    audio.loop = false;

    try {
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.then === "function") {
        playPromise
          .then(() => {
            audio.pause();
            audio.currentTime = 0;
            audio.muted = false;
            audio.loop = true;
            this.audioUnlocked = true;
            if (this.isOpen) this.autoplaySelection();
          })
          .catch(() => {
            this.audioUnlocked = false;
          });
      }
    } catch {
      this.audioUnlocked = false;
    }
  }

  layout(gameCam) {
    const scene = this.scene;

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

    this.dim.setPosition(vpX, vpY);
    this.dim.setSize(vpW, vpH);

    const border = 4;
    const pad = 8;

    const panelX = Math.round(vpX + 4);
    const panelY = Math.round(vpY + 4);
    const panelW = Math.round(vpW - 8);
    const panelH = Math.round(vpH - 8);

    this.panelBorder.setPosition(panelX, panelY);
    this.panelBorder.setSize(panelW, panelH);

    this.panelFill.setPosition(panelX + border, panelY + border);
    this.panelFill.setSize(panelW - border * 2, panelH - border * 2);

    const metaW = Math.min(150, Math.floor(panelW * 0.46));
    const metaH = 84;
    const metaX = Math.round(panelX + border + pad);
    const metaY = Math.round(panelY + border + pad);

    this.metaBorder.setPosition(metaX, metaY);
    this.metaBorder.setSize(metaW, metaH);

    this.metaFill.setPosition(metaX + border, metaY + border);
    this.metaFill.setSize(metaW - border * 2, metaH - border * 2);

    this.metaText.setPosition(metaX + border + 6, metaY + border + 5);
    this.metaText.setWordWrapWidth(Math.max(10, metaW - (border * 2 + 12)));

    const listX = Math.round(metaX + metaW + 2);
    const listY = Math.round(panelY + border + pad);

    this.title.setPosition(listX, listY);
    this.list.setPosition(listX, Math.round(listY + 22));
    this.hint.setPosition(panelX + border + pad, Math.round(panelY + panelH - border - pad - 14));

    const listRight = Math.round(panelX + panelW - border - pad - 12);
    const fontSize = Number.parseInt(this.list.style.fontSize, 10) || 14;
    const lineSpacing = Number.isFinite(this.list.lineSpacing) ? this.list.lineSpacing : 0;
    const lineHeight = Math.max(11, fontSize + lineSpacing);
    const listRowW = Math.max(10, listRight - listX);
    this.list.setWordWrapWidth(listRowW);
    this.priceList.setWordWrapWidth(listRowW);
    this.priceList.setPosition(listX, Math.round(listY + 22 + lineHeight));
    this._listAnchor = {
      x: listX,
      y: Math.round(listY + 22),
      rowW: listRowW,
      rowH: lineHeight,
    };

    this._metaBox = { metaW, metaH };
    this._confirmAnchor = { panelX, panelY, panelW, panelH, border, pad };
    this.render();
  }

  pageItems() {
    const items = this.data?.items || [];
    const size = this.data?.pageSize || 5;
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
    const size = this.data?.pageSize || 5;
    while (this.rowHits.length < size) {
      const rowIndex = this.rowHits.length;
      const hit = this.scene.add.rectangle(0, 0, 10, 10, 0x000000, 0);
      hit.setOrigin(0, 0);
      hit.setAlpha(0);
      hit.setInteractive();
      hit.on("pointerover", () => this.handleRowHover(rowIndex));
      hit.on("pointermove", () => this.handleRowHover(rowIndex));
      hit.on("pointerdown", () => this.handleRowTap(rowIndex));
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
    const rowStep = anchor.rowH * 2;

    for (let i = 0; i < this.rowHits.length; i++) {
      const hit = this.rowHits[i];
      const active = canSelect && i < visibleCount;
      hit.setVisible(active);
      if (hit.input) hit.input.enabled = active;
      if (!active) continue;
      const rowY = Math.round(anchor.y + i * rowStep);
      hit.setPosition(anchor.x, rowY);
      hit.setSize(anchor.rowW, rowStep);
      if (hit.input?.hitArea) {
        hit.input.hitArea.width = anchor.rowW;
        hit.input.hitArea.height = rowStep;
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

  handleRowTap(rowIndex) {
    if (!this.isOpen || this.mode !== "list") return;
    if (!this.audioUnlocked) this.unlockAudioFromGesture();
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
    const size = this.data?.pageSize || 5;
    const pageCount = Math.max(1, Math.ceil(total / size));

    const lines = [];
    const anchor = this._listAnchor;
    const fontSize = Number.parseInt(this.list.style.fontSize, 10) || 14;
    const approxCharWidth = fontSize * 0.6;
    const cols = anchor ? Math.max(1, Math.floor(anchor.rowW / approxCharWidth)) : 1;
    for (let i = 0; i < pageItems.length; i++) {
      const it = pageItems[i];
      const cursor = i === this.index ? "▶" : " ";
      const price = typeof it.price === "number" ? `$${it.price}` : "";
      if (price) {
        const indent = Math.max(1, cols - price.length);
        lines.push(`${cursor} ${it.name}\n${" ".repeat(indent)}${price}`);
      } else {
        lines.push(`${cursor} ${it.name}`);
      }
    }
    if (!pageItems.length) lines.push("  (No items)");

    this.list.setText(lines.join("\n"));
    if (this.priceList) {
      this.priceList.setText("");
      this.priceList.setVisible(false);
    }
    this.updateRowHits(pageItems.length);
    this.updateSelectionHighlight(pageItems.length);

    const sel = this.selectedItem();
    const song = sel?.songName || sel?.name || "—";
    const bpm = Number.isFinite(sel?.bpm) ? String(sel.bpm) : sel?.bpm ? String(sel.bpm) : "—";
    const key = sel?.key ? String(sel.key) : "—";
    const tags = Array.isArray(sel?.tags) ? sel.tags.join(", ") : sel?.tags ? String(sel.tags) : "—";
    this.metaText.setText(`SONG: ${song}\nBPM: ${bpm}\nKEY: ${key}\nTAGS: ${tags}`);

    const audioHint = "";
    if (this.mode === "list") {
      this.hint.setText(`A: Select   Tap Screen: Back   Page ${this.page + 1}/${pageCount}${audioHint}`);
    } else {
      this.hint.setText(audioHint);
    }

    if (this.mode === "confirm") this.showConfirm();
    else this.hideConfirm();
  }

  updateSelectionHighlight(visibleCount) {
    if (!this.selectBg) return;
    const anchor = this._listAnchor;
    const canShow = this.isOpen && this.mode === "list" && visibleCount > 0 && anchor;
    this.selectBg.setVisible(!!canShow);
    if (!canShow) return;

    const rowStep = anchor.rowH * 2;
    const rowIndex = Math.max(0, Math.min(visibleCount - 1, this.index));
    const rowY = Math.round(anchor.y + rowIndex * rowStep);
    this.selectBg.setPosition(anchor.x, rowY);
    this.selectBg.setSize(anchor.rowW, rowStep);
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
    const size = this.data?.pageSize || 5;
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

    if (this.confirmChoice === 1) {
      this.mode = "list";
      this.render();
      return;
    }

    this.stopPreview();

    const url = item.buyUrl;
    if (url && typeof url === "string" && url.startsWith("http")) {
      window.open(url, "_blank", "noopener,noreferrer");
    }

    this.mode = "list";
    this.render();
  }

  tick(now, input) {
    if (!this.isOpen) return false;

    const { left, right, up, down, aJust, backJust } = input;
    const canMove = now - this.lastMoveAt >= this.repeatMs;

    if (backJust) {
      if (this.mode === "confirm") {
        this.mode = "list";
        this.render();
      } else {
        this.close();
      }
      return true;
    }

    if (left || right || up || down || aJust) {
      if (!this.audioUnlocked && aJust) this.unlockAudioFromGesture();
    }

    if (this.mode === "list") {
      if (canMove && up) {
        this.lastMoveAt = now;
        if (this.index <= 0 && this.page > 0) {
          const total = this.data?.items?.length || 0;
          const size = this.data?.pageSize || 5;
          const pageCount = Math.max(1, Math.ceil(total / size));
          this.page = Math.max(0, Math.min(pageCount - 1, this.page - 1));
          const prevPageItems = this.pageItems();
          this.index = Math.max(0, prevPageItems.length - 1);
          this.render();
          this.autoplaySelection();
        } else {
          this.moveSelection(-1);
        }
      } else if (canMove && down) {
        this.lastMoveAt = now;
        const page = this.pageItems();
        if (page.length && this.index >= page.length - 1) {
          const total = this.data?.items?.length || 0;
          const size = this.data?.pageSize || 5;
          const pageCount = Math.max(1, Math.ceil(total / size));
          this.page = Math.max(0, Math.min(pageCount - 1, this.page + 1));
          this.index = 0;
          this.render();
          this.autoplaySelection();
        } else {
          this.moveSelection(1);
        }
      }

      if (aJust) {
        this.confirmOpen();
      }
    } else {
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

  destroy() {
    try {
      this.close();
    } catch {}
    try {
      this.stopPreview();
      this.audio.src = "";
    } catch {}
    this.rowHits.forEach((hit) => hit?.destroy?.());
    this.rowHits = [];
    this.container?.destroy?.(true);
    this.container = null;
  }
}
