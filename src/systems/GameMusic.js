export default class GameMusic {
  constructor(scene) {
    this.scene = scene;
    this.tracks = [];
    this.bag = [];
    this.currentTrackPath = "";
    this.failStreak = 0;
    this.musicVolume = 0.3;

    this.audio = new Audio();
    this.audio.preload = "auto";
    this.audio.loop = false;
    this.audio.volume = this.musicVolume;

    this.audioCtx = null;
    this.audioSourceNode = null;
    this.gainNode = null;
    this.initAudioGraph();
    this.applyVolume();

    this.unlocked = false;
    this.pendingMusicStart = false;
    this.isPausedByOverlay = false;

    this.pendingUnmute = false;

    this._onEnded = () => {
      if (this.isOverlayOpen()) {
        this.isPausedByOverlay = true;
        this.pendingMusicStart = true;
        return;
      }
      this.playNext("ended");
    };
    this._onError = (e) => {
      console.warn("[GameMusic] audio error:", this.currentTrackPath, e);
      if (this.isOverlayOpen()) {
        this.isPausedByOverlay = true;
        this.pendingMusicStart = true;
        return;
      }
      this.failStreak += 1;
      if (this.failStreak > Math.max(1, this.tracks.length)) {
        console.warn("[GameMusic] too many failures; stopping music until next gesture/load");
        this.pendingMusicStart = true;
        try {
          this.audio.pause();
        } catch {}
        return;
      }
      this.playNext("error");
    };

    this.audio.addEventListener("ended", this._onEnded);
    this.audio.addEventListener("error", this._onError);
  }

  initAudioGraph() {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      return;
    }
    try {
      this.audioCtx = new AudioContextCtor();
      this.audioSourceNode = this.audioCtx.createMediaElementSource(this.audio);
      this.gainNode = this.audioCtx.createGain();
      this.audioSourceNode.connect(this.gainNode);
      this.gainNode.connect(this.audioCtx.destination);
      this.audio.volume = 1;
    } catch (e) {
      console.warn("[GameMusic] WebAudio init failed, using audio.volume:", e);
      this.audioCtx = null;
      this.audioSourceNode = null;
      this.gainNode = null;
      this.audio.volume = this.musicVolume;
    }
  }

  applyVolume() {
    const v = Math.max(0, Math.min(1, this.musicVolume));
    if (this.gainNode && this.audioCtx) {
      this.gainNode.gain.setValueAtTime(v, this.audioCtx.currentTime || 0);
    } else {
      this.audio.volume = v;
    }
  }

  normalizeTrackPath(trackPath) {
    if (typeof trackPath !== "string") return "";
    const raw = trackPath.trim();
    if (!raw) return "";

    if (raw.includes("wavygravy_davy_126bpm_mainmusic.mp3")) {
      return "/game_music/wavygravydavy_126bpm_mainmusic.mp3";
    }

    if (raw.startsWith("/game_music/")) return raw;
    if (raw.startsWith("game_music/")) return `/${raw}`;
    if (raw.startsWith("/public/game_music/")) return raw.replace("/public", "");
    if (raw.startsWith("public/game_music/")) return `/${raw.replace(/^public\//, "")}`;

    const marker = raw.indexOf("game_music/");
    if (marker >= 0) return `/${raw.slice(marker)}`;

    const file = raw.split("/").pop();
    return file ? `/game_music/${file}` : "";
  }

  async load() {
    try {
      const res = await fetch("/data/game_music.json", { cache: "no-store" });
      if (!res.ok) throw new Error(`game_music.json HTTP ${res.status}`);
      const json = await res.json();
      if (json && Array.isArray(json.tracks) && json.tracks.length) {
        this.tracks = json.tracks
          .map((trackPath) => this.normalizeTrackPath(trackPath))
          .filter(Boolean);
      }
    } catch (e) {
      console.error("[GameMusic] failed to fetch /data/game_music.json:", e);
      this.tracks = [
        "/game_music/wavygravydavy_126bpm_mainmusic.mp3",
        "/game_music/nightywhitey_130bpm_mainmusic.mp3",
      ];
    }

    this.resetBag();
  }

  isOverlayOpen() {
    return !!(
      this.scene?.tvOverlay?.isOpen ||
      this.scene?.shop?.isOpen ||
      this.scene?.emailOverlay?.isOpen?.()
    );
  }

  shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  resetBag() {
    this.bag = [...this.tracks];
    this.shuffleInPlace(this.bag);
  }

  pickNext() {
    if (!this.tracks.length) return "";
    if (!this.bag.length) this.resetBag();
    return this.bag.pop() || "";
  }

  setTrack(trackPath) {
    this.currentTrackPath = trackPath || "";
    if (!this.currentTrackPath) return false;
    this.audio.src = this.currentTrackPath;
    return true;
  }

  playCurrent(reason) {
    if (!this.audio.src) return false;
    if (this.isOverlayOpen()) return false;

    try {
      this.applyVolume();
      const p = this.audio.play();
      if (p && typeof p.then === "function") {
        p.then(() => {
          this.unlocked = true;
          this.pendingMusicStart = false;
          this.failStreak = 0;
        }).catch((err) => {
          this.pendingMusicStart = true;
          console.warn(`[GameMusic] play() failed (${reason}):`, this.currentTrackPath, err);
          this._onError?.(err);
        });
      } else {
        this.unlocked = true;
        this.pendingMusicStart = false;
      }
      return true;
    } catch (err) {
      this.pendingMusicStart = true;
      console.warn(`[GameMusic] play() failed (${reason}):`, this.currentTrackPath, err);
      this._onError?.(err);
      return false;
    }
  }

  startOnLoad() {
    if (!this.tracks.length) return;
    if (this.isOverlayOpen()) {
      this.pendingMusicStart = true;
      return;
    }

    const next = this.pickNext();
    if (!next) return;

    this.setTrack(next);
    this.audio.muted = true;
    this.pendingUnmute = true;

    const ok = this.playCurrent("create-muted");
    if (!ok) this.pendingMusicStart = true;
  }

  startFromGesture() {
    if (!this.tracks.length) return;
    if (this.audioCtx && this.audioCtx.state !== "running") {
      this.audioCtx.resume().catch(() => {});
    }

    if (this.pendingUnmute) {
      this.audio.muted = false;
      this.pendingUnmute = false;
      if (!this.audio.paused) {
        this.unlocked = true;
        this.pendingMusicStart = false;
        return;
      }
    }

    if (!this.pendingMusicStart && this.unlocked && !this.audio.paused) return;

    if (this.isOverlayOpen()) {
      this.pendingMusicStart = true;
      return;
    }

    if (!this.audio.src) {
      const next = this.pickNext();
      if (!next) return;
      this.setTrack(next);
    }

    this.audio.muted = false;
    this.playCurrent("gesture");
  }

  pauseForOverlay() {
    if (this.isPausedByOverlay) return;
    this.isPausedByOverlay = true;
    if (this.audio.muted) this.pendingUnmute = true;
    try {
      if (!this.audio.paused) this.audio.pause();
    } catch {}
  }

  resumeAfterOverlay() {
    if (!this.isPausedByOverlay) return;
    if (this.isOverlayOpen()) return;
    this.isPausedByOverlay = false;

    if (!this.unlocked) {
      this.pendingMusicStart = true;
      return;
    }

    if (this.pendingUnmute) this.audio.muted = true;

    if (this.audio.src) {
      this.playCurrent("resume");
    } else {
      this.playNext("resume");
    }
  }

  playNext(reason = "next") {
    if (!this.tracks.length) return;
    if (!this.unlocked) {
      this.pendingMusicStart = true;
      return;
    }
    if (this.isOverlayOpen()) {
      this.isPausedByOverlay = true;
      this.pendingMusicStart = true;
      return;
    }

    const next = this.pickNext();
    if (!next) return;
    this.setTrack(next);
    this.playCurrent(reason);
  }

  destroy() {
    this.audio.removeEventListener("ended", this._onEnded);
    this.audio.removeEventListener("error", this._onError);
    try {
      this.audio.pause();
      this.audio.src = "";
    } catch {}
    try {
      if (this.audioCtx && this.audioCtx.state !== "closed") this.audioCtx.close();
    } catch {}
  }
}
