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
    this.playerIframe = null;
    this.loadFailed = false;
    this.loadWatchdog = null;
    this.loadRebuildTried = false;
    this._layoutCheckRaf = null;
    this.soundUnlockRetryTimer = null;
    this.soundUnlockRetriesRemaining = 0;

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
    this.rootEl.style.zIndex = "2";

    this.playerMount = document.createElement("div");
    this.playerMount.style.position = "absolute";
    this.playerMount.style.left = "0";
    this.playerMount.style.top = "0";
    this.playerMount.style.width = "100%";
    this.playerMount.style.height = "100%";
    this.playerMount.style.background = "#000000";
    this.playerMount.style.zIndex = "2";

    this.hintEl = document.createElement("div");
    this.hintEl.textContent = "Press A for sound";
    this.hintEl.style.position = "absolute";
    this.hintEl.style.left = "50%";
    this.hintEl.style.bottom = "8px";
    this.hintEl.style.transform = "translateX(-50%)";
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
    this.ensureDomContainerLayer();

    this.container.add([this.dim, this.dom]);

    TVOverlay.loadYouTubeApi()
      .then(() => {
        this.apiReady = true;
        if (this.isOpen) this.ensurePlayer();
      })
      .catch(() => {});
  }

  ensureDomContainerLayer() {
    const domContainer = this.scene?.game?.domContainer;
    if (!domContainer) return;
    domContainer.style.zIndex = "4";
    domContainer.style.pointerEvents = "none";
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
    const sanitize = (value) => {
      const match = String(value || "").match(/[A-Za-z0-9_-]{11}/);
      return match ? match[0] : "";
    };
    try {
      const parsed = new URL(url);
      if (parsed.hostname.includes("youtu.be")) return sanitize(parsed.pathname.replace("/", ""));
      const v = parsed.searchParams.get("v");
      if (v) return sanitize(v);
      if (parsed.pathname.startsWith("/embed/")) return sanitize(parsed.pathname.replace("/embed/", ""));
    } catch {
      const match = url.match(/[?&]v=([^&]+)/);
      if (match) return sanitize(match[1]);
      const short = url.match(/youtu\.be\/([^?]+)/);
      if (short) return sanitize(short[1]);
    }
    return sanitize(url);
  }

  showHint(visible, text = "Press A for sound") {
    if (!this.hintEl) return;
    this.hintEl.textContent = text;
    this.hintEl.style.display = visible ? "block" : "none";
  }

  configureIframeAttributes() {
    if (!this.playerMount) return;
    const iframe = this.playerMount.querySelector("iframe");
    if (!iframe) {
      this.playerIframe = null;
      return;
    }
    this.playerIframe = iframe;
    iframe.setAttribute("allow", "autoplay; encrypted-media; picture-in-picture");
    iframe.setAttribute("referrerpolicy", "origin");
    iframe.setAttribute("allowfullscreen", "");
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    iframe.style.border = "0";
    iframe.style.display = "block";
    iframe.style.position = "absolute";
    iframe.style.left = "0";
    iframe.style.top = "0";
    iframe.style.background = "#000000";
  }

  clearLoadWatchdog() {
    if (this.loadWatchdog) {
      window.clearTimeout(this.loadWatchdog);
      this.loadWatchdog = null;
    }
  }

  scheduleLoadWatchdog() {
    this.clearLoadWatchdog();
    if (!this.isOpen) return;
    this.loadWatchdog = window.setTimeout(() => {
      if (!this.isOpen) return;
      if (!this.apiReady) {
        this.scheduleLoadWatchdog();
        return;
      }
      const rootRect = this.rootEl?.getBoundingClientRect?.();
      const iframe = this.playerMount?.querySelector?.("iframe");
      const iframeRect = iframe?.getBoundingClientRect?.();
      const rootReady = !!rootRect && rootRect.width > 50 && rootRect.height > 50;
      const iframeReady = !!iframe && !!iframeRect && iframeRect.width > 50 && iframeRect.height > 50;
      if (this.playerReady && rootReady && iframeReady) return;
      if (!this.loadRebuildTried) {
        this.loadRebuildTried = true;
        this.rebuildPlayer();
        this.scheduleLoadWatchdog();
        return;
      }
      this.loadFailed = true;
      this.showHint(true, "TV failed to load. Press A to retry.");
    }, 1500);
  }

  rebuildPlayer() {
    if (this.player?.destroy) {
      try {
        this.player.destroy();
      } catch {}
    }
    this.player = null;
    this.playerIframe = null;
    this.playerReady = false;
    if (this.playerMount) this.playerMount.innerHTML = "";
    this.ensurePlayer();
  }

  sendPlayerCommand(command, args = []) {
    this.configureIframeAttributes();
    const iframe = this.playerIframe;
    if (!iframe?.contentWindow) return false;
    try {
      iframe.contentWindow.postMessage(
        JSON.stringify({
          event: "command",
          func: command,
          args: Array.isArray(args) ? args : [],
        }),
        "*"
      );
      return true;
    } catch {
      return false;
    }
  }

  clearSoundUnlockRetry() {
    if (this.soundUnlockRetryTimer) {
      window.clearTimeout(this.soundUnlockRetryTimer);
      this.soundUnlockRetryTimer = null;
    }
    this.soundUnlockRetriesRemaining = 0;
  }

  attemptSoundUnlock() {
    if (!this.isOpen) {
      this.clearSoundUnlockRetry();
      return false;
    }

    const targetVolume = 80;
    let attempted = false;
    let unlocked = false;

    if (this.playerReady && this.player) {
      try {
        this.player.unMute();
        attempted = true;
      } catch {}
      try {
        this.player.setVolume(targetVolume);
        attempted = true;
      } catch {}
      try {
        this.player.playVideo();
        attempted = true;
      } catch {}
      try {
        if (typeof this.player.isMuted === "function") {
          unlocked = this.player.isMuted() === false;
        }
      } catch {}
    }

    if (this.sendPlayerCommand("unMute")) attempted = true;
    if (this.sendPlayerCommand("setVolume", [targetVolume])) attempted = true;
    if (this.sendPlayerCommand("playVideo")) attempted = true;

    if (unlocked || (this.playerReady && attempted)) {
      this.soundUnlocked = true;
      this.pendingUnmute = false;
      this.loadFailed = false;
      this.showHint(false);
      this.clearSoundUnlockRetry();
      return true;
    }

    if (this.soundUnlockRetriesRemaining > 0) {
      this.soundUnlockRetriesRemaining -= 1;
      this.soundUnlockRetryTimer = window.setTimeout(() => {
        this.soundUnlockRetryTimer = null;
        this.attemptSoundUnlock();
      }, 150);
      return false;
    }

    this.soundUnlocked = false;
    this.pendingUnmute = true;
    this.showHint(true, "Press A for sound");
    return false;
  }

  unlockSoundFromGesture() {
    return this.enableSoundFromGesture();
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
    this.ensureDomContainerLayer();

    if (!this.player) {
      this.player = new window.YT.Player(this.playerMount, {
        width: "100%",
        height: "100%",
        videoId: this.videoId,
        playerVars: {
          autoplay: 1,
          playsinline: 1,
          mute: 1,
          controls: 0,
          rel: 0,
          modestbranding: 1,
          enablejsapi: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            this.playerReady = true;
            this.loadFailed = false;
            this.configureIframeAttributes();
            if (this.pendingUnmute) {
              this.enableSoundFromGesture();
            } else {
              this.showHint(true, "Press A for sound");
              this.startMutedPlayback();
            }
          },
          onError: () => {
            this.playerReady = false;
            this.loadFailed = true;
            this.showHint(true, "TV failed to load. Press A to retry.");
          },
        },
      });
      this.scheduleLoadWatchdog();
    } else if (this.playerReady && this.player.loadVideoById) {
      this.player.loadVideoById(this.videoId);
      this.loadFailed = false;
      this.startMutedPlayback();
      this.scheduleLoadWatchdog();
    }
  }

  scheduleLayoutCheck() {
    if (this._layoutCheckRaf) {
      window.cancelAnimationFrame(this._layoutCheckRaf);
      this._layoutCheckRaf = null;
    }
    this._layoutCheckRaf = window.requestAnimationFrame(() => {
      this._layoutCheckRaf = window.requestAnimationFrame(() => {
        this._layoutCheckRaf = null;
        if (!this.isOpen) return;
        this.ensureDomContainerLayer();
        const rootRect = this.rootEl?.getBoundingClientRect?.();
        if (!rootRect || rootRect.width < 50 || rootRect.height < 50) {
          const fallbackW = Math.max(80, Math.round(this.scene.scale.width - 20));
          const fallbackH = Math.max(80, Math.round(this.scene.scale.height - 20));
          this.rootEl.style.width = `${fallbackW}px`;
          this.rootEl.style.height = `${fallbackH}px`;
        }
        this.scheduleLoadWatchdog();
      });
    });
  }

  enableSoundFromGesture() {
    if (this.soundUnlocked) return true;
    this.pendingUnmute = true;
    this.clearSoundUnlockRetry();
    this.soundUnlockRetriesRemaining = 5;
    return this.attemptSoundUnlock();
  }

  open(url) {
    this.isOpen = true;
    this.container.setVisible(true);
    this.container.setActive(true);
    this.dom.setVisible(true);
    this.ensureDomContainerLayer();
    this.rootEl.style.pointerEvents = "auto";
    this.dim.setInteractive();
    this.container.setDepth(10000);
    this.soundUnlocked = false;
    this.pendingUnmute = false;
    this.loadFailed = false;
    this.loadRebuildTried = false;
    this.clearSoundUnlockRetry();
    this.showHint(true, "Press A for sound");

    this.videoId = this.extractVideoId(url) || "hrMlEv-6SEw";
    this.ensurePlayer();
    this.scheduleLoadWatchdog();
    this.scheduleLayoutCheck();
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
    this.loadFailed = false;
    this.loadRebuildTried = false;
    this.clearSoundUnlockRetry();
    this.playerIframe = null;
    this.showHint(false);
    this.clearLoadWatchdog();
    if (this._layoutCheckRaf) {
      window.cancelAnimationFrame(this._layoutCheckRaf);
      this._layoutCheckRaf = null;
    }

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
    this.ensureDomContainerLayer();
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
    if (this.isOpen) this.scheduleLoadWatchdog();
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
    this.clearLoadWatchdog();
    this.clearSoundUnlockRetry();
    if (this._layoutCheckRaf) {
      window.cancelAnimationFrame(this._layoutCheckRaf);
      this._layoutCheckRaf = null;
    }
  }
}
