export default class TVOverlay {
  constructor(scene) {
    this.scene = scene;
    this.isOpen = false;
    this.apiReady = false;
    this.playerReady = false;
    this.soundUnlocked = false;
    this.pendingUnmute = false;
    this.videoId = "";
    this.player = null;

    this.container = scene.add.container(0, 0);
    this.container.setVisible(false);
    this.container.setActive(false);
    this.container.setDepth(10000);
    scene.uiLayer.add(this.container);

    this.dim = scene.add.rectangle(0, 0, 10, 10, 0x000000, 0.85).setOrigin(0, 0);
    this.dim.setInteractive();
    this.dim.disableInteractive();
    this.dim.on("pointerdown", () => {
      if (this.isOpen) this.close();
    });

    this.rootEl = document.createElement("div");
    this.rootEl.style.position = "relative";
    this.rootEl.style.width = "100%";
    this.rootEl.style.height = "100%";
    this.rootEl.style.background = "#000000";
    this.rootEl.style.overflow = "hidden";
    this.rootEl.style.border = "4px solid #111111";
    this.rootEl.style.boxSizing = "border-box";
    this.rootEl.style.pointerEvents = "none";
    this.rootEl.style.touchAction = "manipulation";

    this.playerMount = document.createElement("div");
    this.playerMount.style.position = "absolute";
    this.playerMount.style.left = "0";
    this.playerMount.style.top = "0";
    this.playerMount.style.width = "100%";
    this.playerMount.style.height = "100%";
    this.playerMount.style.background = "#000000";

    this.hintEl = document.createElement("div");
    this.hintEl.textContent = "Press A for sound";
    this.hintEl.style.position = "absolute";
    this.hintEl.style.left = "8px";
    this.hintEl.style.top = "8px";
    this.hintEl.style.padding = "4px 6px";
    this.hintEl.style.background = "rgba(0, 0, 0, 0.6)";
    this.hintEl.style.color = "#ffffff";
    this.hintEl.style.fontFamily = "monospace";
    this.hintEl.style.fontSize = "11px";
    this.hintEl.style.letterSpacing = "0.5px";
    this.hintEl.style.pointerEvents = "none";
    this.hintEl.style.display = "none";

    this.rootEl.appendChild(this.playerMount);
    this.rootEl.appendChild(this.hintEl);

    this.dom = scene.add.dom(0, 0, this.rootEl);
    this.dom.setOrigin(0, 0);
    this.dom.setVisible(false);

    this.container.add([this.dim, this.dom]);

    TVOverlay.loadYouTubeApi()
      .then(() => {
        this.apiReady = true;
        if (this.isOpen) this.ensurePlayer();
      })
      .catch(() => {});
  }

  static loadYouTubeApi() {
    if (TVOverlay._apiPromise) return TVOverlay._apiPromise;
    TVOverlay._apiPromise = new Promise((resolve) => {
      if (window.YT && window.YT.Player) {
        resolve(window.YT);
        return;
      }

      const existing = document.getElementById("youtube-iframe-api");
      if (existing) {
        const waitForReady = () => {
          if (window.YT && window.YT.Player) resolve(window.YT);
          else setTimeout(waitForReady, 50);
        };
        waitForReady();
        return;
      }

      const tag = document.createElement("script");
      tag.id = "youtube-iframe-api";
      tag.src = "https://www.youtube.com/iframe_api";
      tag.async = true;

      const firstScript = document.getElementsByTagName("script")[0];
      if (firstScript?.parentNode) firstScript.parentNode.insertBefore(tag, firstScript);
      else document.head.appendChild(tag);

      const prevReady = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof prevReady === "function") prevReady();
        resolve(window.YT);
      };
    });
    return TVOverlay._apiPromise;
  }

  extractVideoId(url) {
    if (!url) return "";
    try {
      const parsed = new URL(url);
      if (parsed.hostname.includes("youtu.be")) return parsed.pathname.replace("/", "");
      const v = parsed.searchParams.get("v");
      if (v) return v;
      if (parsed.pathname.startsWith("/embed/")) return parsed.pathname.replace("/embed/", "");
    } catch {
      const match = url.match(/[?&]v=([^&]+)/);
      if (match) return match[1];
      const short = url.match(/youtu\.be\/([^?]+)/);
      if (short) return short[1];
    }
    return url;
  }

  showHint(_visible) {
    if (!this.hintEl) return;
    this.hintEl.style.display = "none";
  }

  startMutedPlayback() {
    if (!this.player) return;
    try {
      this.player.mute();
      this.player.setVolume(0);
      this.player.playVideo();
    } catch {}
  }

  ensurePlayer() {
    if (!this.apiReady || !this.videoId) return;

    if (!this.player) {
      this.player = new window.YT.Player(this.playerMount, {
        width: "100%",
        height: "100%",
        videoId: this.videoId,
        playerVars: {
          autoplay: 1,
          playsinline: 1,
          mute: 1,
          controls: 1,
          rel: 0,
          modestbranding: 1,
        },
        events: {
          onReady: () => {
            this.playerReady = true;
            this.startMutedPlayback();
            if (this.pendingUnmute) this.enableSoundFromGesture();
          },
        },
      });
    } else if (this.playerReady && this.player.loadVideoById) {
      this.player.loadVideoById(this.videoId);
      this.startMutedPlayback();
    }
  }

  enableSoundFromGesture() {
    if (this.soundUnlocked) return true;
    if (!this.playerReady || !this.player) {
      this.pendingUnmute = true;
      this.showHint(true);
      return false;
    }

    let success = false;
    try {
      this.player.unMute();
      this.player.setVolume(100);
      this.player.playVideo();
      if (typeof this.player.isMuted === "function") {
        success = !this.player.isMuted();
      } else {
        success = true;
      }
    } catch {}

    this.soundUnlocked = success;
    this.pendingUnmute = !success;
    this.showHint(!success);
    return success;
  }

  open(url) {
    this.isOpen = true;
    this.container.setVisible(true);
    this.container.setActive(true);
    this.dom.setVisible(true);
    this.rootEl.style.pointerEvents = "auto";
    this.dim.setInteractive();
    this.container.setDepth(10000);
    this.soundUnlocked = false;
    this.pendingUnmute = false;
    this.showHint(false);

    this.videoId = this.extractVideoId(url);
    this.ensurePlayer();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.container.setVisible(false);
    this.container.setActive(false);
    this.dom.setVisible(false);
    this.rootEl.style.pointerEvents = "none";
    this.dim.disableInteractive();
    this.soundUnlocked = false;
    this.pendingUnmute = false;
    this.showHint(false);

    if (this.playerMount) {
      const iframe = this.playerMount.querySelector("iframe");
      if (iframe) iframe.src = "about:blank";
      this.playerMount.innerHTML = "";
    }

    if (this.player?.destroy) {
      try {
        this.player.destroy();
      } catch {}
    }
    this.player = null;
    this.playerReady = false;
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

    const pad = 10;
    const frameX = Math.round(vpX + pad);
    const frameY = Math.round(vpY + pad);
    const frameW = Math.max(80, Math.round(vpW - pad * 2));
    const frameH = Math.max(80, Math.round(vpH - pad * 2));

    this.dom.setPosition(frameX, frameY);

    if (typeof this.dom.setDisplaySize === "function") {
      this.dom.setDisplaySize(frameW, frameH);
    }

    this.rootEl.style.width = `${frameW}px`;
    this.rootEl.style.height = `${frameH}px`;
  }

  destroy() {
    try {
      this.close();
    } catch {}
    try {
      this.dom?.destroy?.();
    } catch {}
    try {
      this.container?.destroy?.(true);
    } catch {}
    this.dom = null;
    this.container = null;
    this.rootEl = null;
    this.playerMount = null;
    this.hintEl = null;
  }
}
