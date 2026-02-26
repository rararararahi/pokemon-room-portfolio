import Phaser from "phaser";
import RoomScene from "./scenes/RoomScene";
import TrophyRoomScene from "./scenes/TrophyRoomScene";
import { canonicalizeNickname, clearNickname, getNickname, getProfile, setNickname, validateNickname } from "./arcade/profile";
import "./style.css";

const BRAND = "RAHI STUDIO";
const CONTACT_EMAIL = "rahi@example.com";
const STUDIO_VIDEO_MANIFEST_URL = "/RAHI_STUDIO_MEDIA/videos/manifest.json";
const STUDIO_VIDEO_BASE_URL = "/RAHI_STUDIO_MEDIA/videos";
const STUDIO_PHOTO_MANIFEST_URL = "/RAHI_STUDIO_MEDIA/manifest.json";
const STUDIO_PHOTO_BASE_URL = "/RAHI_STUDIO_MEDIA/photos";
const WORKS_TRACKS_JSON_URL = "/data/works_tracks.json";
const WORKS_TRACK_LINKS_URL = "/data/spotify_track_links.txt";
const SPOTIFY_TRACK_BASE_URL = "https://open.spotify.com/track";
const STUDIO_VIDEO_ADVANCE_FALLBACK_MS = 30000;
const STUDIO_VIDEO_ERROR_ADVANCE_MS = 700;
const STUDIO_MEDIA_VIDEO_EXTENSIONS = new Set(["mp4", "webm", "ogg", "mov", "m4v"]);
const STUDIO_MEDIA_IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);
const SESSIONS_FEATURE_BOX_COUNT = 3;
const SESSIONS_PHOTO_ROTATE_INTERVAL_MS = 7000;
const SESSIONS_PHOTO_ROTATE_STAGGER_MS = [0, 2000, 4000];
const WORKS_FLOW_WINDOW_RADIUS = 7;
const DEBUG_NICKNAME_CLAIM = false;
const DEBUG_GAME_MOUNT = false;

const NAV_LINKS = [
  { path: "/", label: "Home" },
  { path: "/works", label: "Works" },
  { path: "/contact", label: "Contact" },
  { path: "/game", label: "Game" },
];

const ROUTES = {
  "/": { title: "Home", render: renderHomePage },
  "/works": { title: "Works", render: renderWorkPage },
  "/sessions": { title: "Works", render: renderWorkPage },
  "/work": { title: "Works", render: renderWorkPage },
  "/about": { title: "About", render: renderAboutPage },
  "/contact": { title: "Contact", render: renderContactPage },
  "/game": { title: "Game", render: renderGamePage },
};

const appEl = document.getElementById("app");
let currentPath = null;
let gameInstance = null;
let gameMountRaf = null;
let gameMountPostPaintRaf = null;
let gameResizeRaf = null;
let nicknameViewportCleanup = null;
let studioMediaCleanup = null;
let sessionsPhotoCleanup = null;
let worksFlowCleanup = null;
let worksTracksCache = null;
let gameFatalErrorMessage = "";
let gameFatalCanRetry = false;
let gameFatalRetryLabel = "Retry";
let gameRouteErrorCleanup = null;
let gameMountListenersCleanup = null;
let gameMountResizeObserver = null;
let gameMountObservedRoot = null;
const GAME_MOUNT_MAX_RETRIES = 60;
const GAME_MOUNT_MIN_DIMENSION = 100;
const GAME_BASE_WIDTH = 360;
const GAME_BASE_HEIGHT = 640;
const GAME_DESKTOP_MIN_WIDTH = 900;
const GAME_VIEWPORT_WIDTH = 320;
const GAME_VIEWPORT_HEIGHT = 240;

function makeSealPoints({ teeth = 33, cx = 60, cy = 60, outerR = 56, innerR = 50 } = {}) {
  // Produces a serrated seal like a foil sticker (small tooth depth).
  const step = (Math.PI * 2) / (teeth * 2);
  const pts = [];
  for (let i = 0; i < teeth * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = -Math.PI / 2 + i * step;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return pts.join(" ");
}

const STICKER_SEAL_POINTS = makeSealPoints({ teeth: 33 });

function isDesktopGameLayout() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;

  return (
    window.matchMedia(`(min-width: ${GAME_DESKTOP_MIN_WIDTH}px)`).matches &&
    window.matchMedia("(pointer: fine)").matches
  );
}

function getGameZoom({ width, height } = {}) {
  const viewportWidth = Number.isFinite(width) ? width : (typeof window !== "undefined" ? window.innerWidth : 0);
  const viewportHeight = Number.isFinite(height) ? height : (typeof window !== "undefined" ? window.innerHeight : 0);
  if (!isDesktopGameLayout()) return 1;
  if (viewportWidth < GAME_VIEWPORT_WIDTH * 2) return 1;
  if (viewportHeight < GAME_VIEWPORT_HEIGHT * 2) return 1;

  return 2;
}

function createGame(parentId) {
  const isDesktop = isDesktopGameLayout();
  const zoom = getGameZoom();
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent: parentId,
    width: GAME_BASE_WIDTH,
    height: GAME_BASE_HEIGHT,
    backgroundColor: "#000000",
    pixelArt: true,
    scale: {
      mode: isDesktop ? Phaser.Scale.NONE : Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      zoom,
    },
    dom: { createContainer: true },
    physics: {
      default: "arcade",
      arcade: { debug: false },
    },
    scene: [RoomScene, TrophyRoomScene],
  });
}

function debugGameMount(stage, details = {}) {
  if (!DEBUG_GAME_MOUNT) return;
  console.log("[GameMount]", stage, details);
}

function syncGameFatalOverlay() {
  const fatal = appEl.querySelector("[data-game-fatal]");
  const retryBtn = appEl.querySelector("[data-game-retry]");
  if (!fatal || !retryBtn) return;
  if (!gameFatalErrorMessage) {
    fatal.hidden = true;
    fatal.textContent = "";
    retryBtn.hidden = true;
    return;
  }
  fatal.hidden = false;
  fatal.textContent = gameFatalErrorMessage;
  retryBtn.textContent = gameFatalRetryLabel || "Retry";
  retryBtn.hidden = !gameFatalCanRetry;
}

function setGameFatalError(message, { canRetry = true, retryLabel = "Retry" } = {}) {
  gameFatalErrorMessage = String(message || "Unknown error");
  gameFatalCanRetry = !!canRetry;
  gameFatalRetryLabel = String(retryLabel || "Retry");
  syncGameFatalOverlay();
}

function clearGameFatalError() {
  gameFatalErrorMessage = "";
  gameFatalCanRetry = false;
  gameFatalRetryLabel = "Retry";
  syncGameFatalOverlay();
}

function bindGameFatalRetry(isGameRoute) {
  if (!isGameRoute) return;
  const retryBtn = appEl.querySelector("[data-game-retry]");
  if (!retryBtn || retryBtn.dataset.bound === "true") return;
  retryBtn.dataset.bound = "true";
  retryBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    clearGameFatalError();
    ensureGameMounted(0);
  });
}

function bindGameRouteErrorCapture(isGameRoute) {
  if (!isGameRoute) {
    if (typeof gameRouteErrorCleanup === "function") {
      gameRouteErrorCleanup();
      gameRouteErrorCleanup = null;
    }
    return;
  }
  if (typeof gameRouteErrorCleanup === "function") return;

  const onWindowError = (event) => {
    if (getRoutePath() !== "/game") return;
    const message = event?.error?.message || event?.message || "Unknown error";
    console.error("[GameRoute] window.onerror", event?.error || event);
    setGameFatalError(`Game failed to start: ${message}`, { canRetry: true });
  };

  const onUnhandledRejection = (event) => {
    if (getRoutePath() !== "/game") return;
    const reason = event?.reason;
    const message =
      reason?.message ||
      (typeof reason === "string" ? reason : "") ||
      "Unhandled promise rejection";
    console.error("[GameRoute] unhandledrejection", reason || event);
    setGameFatalError(`Game failed to start: ${message}`, { canRetry: true });
  };

  window.addEventListener("error", onWindowError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);
  gameRouteErrorCleanup = () => {
    window.removeEventListener("error", onWindowError);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
  };
}

function cancelScheduledGameMount() {
  if (gameMountRaf !== null) {
    window.cancelAnimationFrame(gameMountRaf);
    gameMountRaf = null;
  }
  if (gameMountPostPaintRaf !== null) {
    window.cancelAnimationFrame(gameMountPostPaintRaf);
    gameMountPostPaintRaf = null;
  }
}

function scheduleGameResize() {
  if (gameResizeRaf !== null) return;
  gameResizeRaf = window.requestAnimationFrame(() => {
    gameResizeRaf = null;
    if (!gameInstance) return;
    const root = document.getElementById("game-root");
    if (!root || !document.body.contains(root)) return;
    const width = Math.round(root.clientWidth || root.getBoundingClientRect().width || 0);
    const height = Math.round(root.clientHeight || root.getBoundingClientRect().height || 0);
    if (width <= 0 || height <= 0) return;
    const desiredZoom = getGameZoom({ width, height });
    const scaleManager = gameInstance.scale;
    const currentZoom = Number(scaleManager?.zoom || 1);
    if (typeof scaleManager?.setZoom === "function" && Number.isFinite(currentZoom) && currentZoom !== desiredZoom) {
      scaleManager.setZoom(desiredZoom);
    }

    const zoom = desiredZoom > 0 ? desiredZoom : 1;
    const targetWidth = Math.round(width / zoom);
    const targetHeight = Math.round(height / zoom);
    if (targetWidth <= 0 || targetHeight <= 0) return;

    scaleManager?.resize?.(targetWidth, targetHeight);
  });
}

function bindGameMountListeners(isGameRoute) {
  const disconnectRootObserver = () => {
    if (gameMountResizeObserver) {
      gameMountResizeObserver.disconnect();
      gameMountResizeObserver = null;
    }
    gameMountObservedRoot = null;
  };

  const ensureRootObserver = () => {
    if (typeof ResizeObserver !== "function") return;
    const root = document.getElementById("game-root");
    if (!root || root === gameMountObservedRoot) return;
    if (gameMountResizeObserver) gameMountResizeObserver.disconnect();
    gameMountResizeObserver = new ResizeObserver(() => {
      if (getRoutePath() !== "/game") return;
      if (gameInstance) {
        scheduleGameResize();
        return;
      }
      ensureGameMounted(0);
    });
    gameMountResizeObserver.observe(root);
    gameMountObservedRoot = root;
  };

  if (!isGameRoute) {
    if (typeof gameMountListenersCleanup === "function") {
      gameMountListenersCleanup();
      gameMountListenersCleanup = null;
    }
    disconnectRootObserver();
    return;
  }
  if (typeof gameMountListenersCleanup === "function") {
    ensureRootObserver();
    return;
  }

  const retryMount = () => {
    if (getRoutePath() !== "/game") return;
    ensureRootObserver();
    if (gameInstance) {
      scheduleGameResize();
      return;
    }
    ensureGameMounted(0);
  };
  const onResize = () => retryMount();
  const onVisibilityChange = () => {
    if (document.visibilityState !== "visible") return;
    retryMount();
  };
  const vv = typeof window !== "undefined" ? window.visualViewport : null;

  window.addEventListener("resize", onResize);
  document.addEventListener("visibilitychange", onVisibilityChange);
  vv?.addEventListener?.("resize", onResize);
  ensureRootObserver();

  gameMountListenersCleanup = () => {
    window.removeEventListener("resize", onResize);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    vv?.removeEventListener?.("resize", onResize);
    disconnectRootObserver();
  };
}

function getGameMountState() {
  const routePath = getRoutePath();
  const modal = appEl.querySelector("[data-nickname-modal]");
  const modalOpen = !!(modal && !modal.hidden);
  const nickname = getNickname();
  const root = document.getElementById("game-root");
  const rect = root?.getBoundingClientRect?.();
  const width = Math.round(Number(rect?.width || 0));
  const height = Math.round(Number(rect?.height || 0));
  const visible = typeof document === "undefined" ? true : document.visibilityState === "visible";
  return {
    routePath,
    routeOk: routePath === "/game",
    modalOpen,
    hasNickname: !!nickname,
    hasRoot: !!root,
    width,
    height,
    visible,
    ready:
      routePath === "/game" &&
      !modalOpen &&
      !!nickname &&
      !!root &&
      width > GAME_MOUNT_MIN_DIMENSION &&
      height > GAME_MOUNT_MIN_DIMENSION &&
      visible,
  };
}

function mountGame() {
  if (gameInstance) return true;
  const root = document.getElementById("game-root");
  if (!root) {
    window.requestAnimationFrame(() => {
      if (getRoutePath() !== "/game" || gameInstance) return;
      const retriedRoot = document.getElementById("game-root");
      if (!retriedRoot) {
        console.warn("[GameMount] game-root missing after retry; skipping mount.");
        return;
      }
      if (retriedRoot.childElementCount > 0 || retriedRoot.childNodes.length > 0) {
        console.warn("[GameMount] game-root not empty after retry; skipping mount.");
        return;
      }
      ensureGameMounted(0);
    });
    return false;
  }
  if (!document.body.contains(root)) return false;
  if (root.childElementCount > 0 || root.childNodes.length > 0) {
    if (!gameInstance) {
      console.warn("[GameMount] game-root is not empty; skipping duplicate mount.");
    }
    return !!gameInstance;
  }

  const state = getGameMountState();
  debugGameMount("mount-attempt", state);
  if (!state.ready) return false;

  try {
    console.log(`[GameMount] mount start w=${state.width} h=${state.height}`);
    gameInstance = createGame("game-root");
    scheduleGameResize();
    console.log("[GameMount] mounted");
    debugGameMount("mount-success", { width: state.width, height: state.height });
    clearGameFatalError();
    return true;
  } catch (error) {
    console.error("[GameMount] mount failed", error);
    const message = error?.message || String(error || "Unknown error");
    setGameFatalError(`Game failed to start: ${message}`, { canRetry: true });
    return false;
  }
}

function scheduleGameMount(retryCount = 0) {
  cancelScheduledGameMount();
  gameMountRaf = window.requestAnimationFrame(() => {
    gameMountRaf = null;
    gameMountPostPaintRaf = window.requestAnimationFrame(() => {
      gameMountPostPaintRaf = null;
      const state = getGameMountState();
      debugGameMount("schedule-tick", { ...state, tries: retryCount });
      if (!state.routeOk) return;
      if (state.modalOpen || !state.hasNickname) return;
      if (!state.visible) return;

      const mounted = mountGame();
      if (mounted) return;

      if (retryCount < GAME_MOUNT_MAX_RETRIES) {
        scheduleGameMount(retryCount + 1);
        return;
      }

      setGameFatalError("Game failed to start. Tap to start.", {
        canRetry: true,
        retryLabel: "Tap to start",
      });
    });
  });
}

function ensureGameMounted(retryCount = 0) {
  scheduleGameMount(retryCount);
}

function unmountGame() {
  cancelScheduledGameMount();
  if (gameResizeRaf !== null) {
    window.cancelAnimationFrame(gameResizeRaf);
    gameResizeRaf = null;
  }
  if (gameInstance) {
    gameInstance.destroy(true);
    gameInstance = null;
  }
  const root = document.getElementById("game-root");
  if (root) root.replaceChildren();
}

function toRoutePath(rawValue) {
  if (!rawValue) return "/";
  let value = String(rawValue).trim();
  if (!value) return "/";

  if (value.startsWith("#")) value = value.slice(1);
  if (value.includes("#")) value = value.split("#").pop() || "";
  if (value.includes("?")) value = value.split("?")[0];
  if (!value.startsWith("/")) value = `/${value}`;

  value = value.replace(/\/{2,}/g, "/");
  if (value.length > 1 && value.endsWith("/")) value = value.slice(0, -1);

  return ROUTES[value] ? value : "/";
}

function getRoutePath() {
  if (window.location.hash) return toRoutePath(window.location.hash);
  return toRoutePath(window.location.pathname);
}

function routeHref(path) {
  return path === "/" ? "#/" : `#${path}`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function cleanupStudioMediaHero() {
  if (typeof studioMediaCleanup === "function") studioMediaCleanup();
  studioMediaCleanup = null;
}

function cleanupSessionsPhotoGrid() {
  if (typeof sessionsPhotoCleanup === "function") sessionsPhotoCleanup();
  sessionsPhotoCleanup = null;
}

function cleanupWorksCoverFlow() {
  if (typeof worksFlowCleanup === "function") worksFlowCleanup();
  worksFlowCleanup = null;
}

function shuffleArray(items) {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function normalizeStudioMediaItem(rawFilename, { baseUrl = "", extensions = null, type = "" } = {}) {
  const filename = String(rawFilename || "").trim();
  if (!filename || filename.includes("/")) return null;
  const match = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
  if (!match) return null;

  const ext = match[1];
  if (!baseUrl || !(extensions instanceof Set) || !extensions.has(ext) || !type) return null;

  return {
    filename,
    type,
    src: `${baseUrl}/${encodeURIComponent(filename)}`,
  };
}

function normalizeStudioVideoItem(rawFilename) {
  return normalizeStudioMediaItem(rawFilename, {
    baseUrl: STUDIO_VIDEO_BASE_URL,
    extensions: STUDIO_MEDIA_VIDEO_EXTENSIONS,
    type: "video",
  });
}

function normalizeStudioPhotoItem(rawFilename) {
  return normalizeStudioMediaItem(rawFilename, {
    baseUrl: STUDIO_PHOTO_BASE_URL,
    extensions: STUDIO_MEDIA_IMAGE_EXTENSIONS,
    type: "image",
  });
}

function normalizeWorksTrackLink(rawUrl) {
  const value = String(rawUrl || "").trim();
  if (!value || value.startsWith("#")) return null;

  const uriMatch = value.match(/^spotify:track:([A-Za-z0-9]+)$/i);
  if (uriMatch) {
    const trackId = uriMatch[1];
    return {
      trackId,
      spotifyUrl: `${SPOTIFY_TRACK_BASE_URL}/${trackId}`,
    };
  }

  try {
    const queryless = value.split("?")[0].split("#")[0];
    const parsed = new URL(queryless);
    if (parsed.hostname !== "open.spotify.com") return null;
    const segments = parsed.pathname.split("/").filter(Boolean);
    const trackIdx = segments.findIndex((segment) => segment.toLowerCase() === "track");
    if (trackIdx < 0 || !segments[trackIdx + 1]) return null;
    const trackId = segments[trackIdx + 1];
    if (!/^[A-Za-z0-9]+$/.test(trackId)) return null;
    return {
      trackId,
      spotifyUrl: `${SPOTIFY_TRACK_BASE_URL}/${trackId}`,
    };
  } catch {
    return null;
  }
}

function parseWorksTrackLinks(rawText) {
  return String(rawText || "")
    .split(/\r?\n/)
    .map(normalizeWorksTrackLink)
    .filter(Boolean);
}

function buildWorksTrackFromMetadata(rawTrack, index) {
  const fallbackTitle = `Track ${String(index + 1).padStart(2, "0")}`;
  const title = String(rawTrack?.title || "").trim() || fallbackTitle;
  const artist = String(rawTrack?.artist || "").trim();
  const trackIdValue = String(rawTrack?.id || rawTrack?.trackId || "").trim();
  const trackIdFromUrl = normalizeWorksTrackLink(rawTrack?.spotifyUrl)?.trackId || "";
  const trackId = /^[A-Za-z0-9]+$/.test(trackIdValue) ? trackIdValue : trackIdFromUrl;
  const spotifyUrl = trackId
    ? `${SPOTIFY_TRACK_BASE_URL}/${trackId}`
    : String(normalizeWorksTrackLink(rawTrack?.spotifyUrl)?.spotifyUrl || "").trim();

  return {
    title,
    artist,
    album: "",
    year: "",
    cover: trackId ? `/works_covers/${encodeURIComponent(trackId)}.jpg` : "",
    spotifyUrl,
    trackId,
    unavailable: !trackId,
  };
}

function buildWorksTrackFromLink(linkItem, index) {
  const trackId = String(linkItem?.trackId || "").trim();
  const trackNumber = String(index + 1).padStart(2, "0");
  return {
    title: `Track ${trackNumber}`,
    artist: "",
    album: "",
    year: "",
    cover: trackId ? `/works_covers/${encodeURIComponent(trackId)}.jpg` : "",
    spotifyUrl: String(linkItem?.spotifyUrl || "").trim(),
    trackId,
    unavailable: !trackId,
  };
}

function initStudioMediaHero() {
  const hero = appEl.querySelector("[data-studio-media-hero]");
  if (!hero) return;

  const frames = [
    hero.querySelector('[data-studio-media-frame="0"]'),
    hero.querySelector('[data-studio-media-frame="1"]'),
  ];
  if (frames.some((frame) => !frame)) return;

  const emptyState = hero.querySelector("[data-studio-media-empty]");
  const hud = hero.querySelector("[data-studio-media-hud]");
  const caption = hero.querySelector("[data-studio-media-caption]");
  const indexLabel = hero.querySelector("[data-studio-media-index]");
  const progressFill = hero.querySelector("[data-studio-media-progress]");
  const preloadCache = new Map();
  const abortController = new AbortController();
  let listenersCleanup = null;
  let fallbackAdvanceTimerId = null;
  let stallAdvanceTimerId = null;
  let destroyed = false;
  let currentIndex = 0;
  let activeFrame = 0;
  let items = [];

  const clearFallbackAdvanceTimer = () => {
    if (fallbackAdvanceTimerId !== null) {
      window.clearTimeout(fallbackAdvanceTimerId);
      fallbackAdvanceTimerId = null;
    }
  };

  const clearStallAdvanceTimer = () => {
    if (stallAdvanceTimerId !== null) {
      window.clearTimeout(stallAdvanceTimerId);
      stallAdvanceTimerId = null;
    }
  };

  const cleanupActiveVideoWatchers = () => {
    clearFallbackAdvanceTimer();
    clearStallAdvanceTimer();
    if (typeof listenersCleanup === "function") listenersCleanup();
    listenersCleanup = null;
  };

  const showFallback = (message) => {
    if (emptyState) {
      emptyState.textContent = message;
      emptyState.hidden = false;
    }
    if (indexLabel) indexLabel.hidden = true;
    if (hud) hud.hidden = true;
    if (progressFill) progressFill.style.width = "0%";
  };

  const setIndicator = () => {
    if (items.length === 0) {
      if (hud) hud.hidden = true;
      if (indexLabel) {
        indexLabel.textContent = "";
        indexLabel.hidden = true;
      }
      if (progressFill) progressFill.style.width = "0%";
      return;
    }

    const digits = Math.max(2, String(items.length).length);
    const currentLabel = String(currentIndex + 1).padStart(digits, "0");
    const totalLabel = String(items.length).padStart(digits, "0");
    const progressPct = ((currentIndex + 1) / items.length) * 100;

    if (hud) hud.hidden = false;
    if (indexLabel) {
      indexLabel.textContent = `${currentLabel} / ${totalLabel}`;
      indexLabel.hidden = false;
    }
    if (progressFill) progressFill.style.width = `${progressPct}%`;
  };

  const startStallFallback = (advance) => {
    clearStallAdvanceTimer();
    stallAdvanceTimerId = window.setTimeout(() => {
      stallAdvanceTimerId = null;
      advance("stalled-timeout");
    }, STUDIO_VIDEO_ADVANCE_FALLBACK_MS);
  };

  const tryPlayVideo = (videoEl) => {
    if (!videoEl || videoEl.tagName !== "VIDEO") return;
    const playPromise = videoEl.play?.();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {
        // Keep the current frame if autoplay is blocked and rely on fallback advancing.
      });
    }
  };

  const createMediaElement = (item, role = "main") => {
    if (item?.type === "image") {
      const image = document.createElement("img");
      image.className = "studio-media-asset";
      image.src = item.src;
      image.loading = "eager";
      image.decoding = "async";
      image.alt = "";
      image.setAttribute("aria-hidden", "true");
      image.dataset.studioMediaRole = role;
      return image;
    }

    const video = document.createElement("video");
    video.className = "studio-media-asset";
    video.src = item.src;
    video.autoplay = true;
    video.muted = true;
    video.defaultMuted = true;
    video.loop = false;
    video.playsInline = true;
    video.preload = "metadata";
    video.setAttribute("autoplay", "");
    video.setAttribute("muted", "");
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.setAttribute("aria-hidden", "true");
    video.dataset.studioMediaRole = role;
    return video;
  };

  const getFrameMainVideo = (frame) => {
    if (!frame) return null;
    return frame.querySelector('video[data-studio-media-role="main"]');
  };

  const mountItemInFrame = (frameIndex, item) => {
    const frame = frames[frameIndex];
    if (!frame) return;
    frame.replaceChildren();

    const fillLayer = document.createElement("div");
    fillLayer.className = "studio-media-fill";
    fillLayer.setAttribute("aria-hidden", "true");

    const mainLayer = document.createElement("div");
    mainLayer.className = "studio-media-main";

    const fillMediaEl = createMediaElement(item, "fill");
    const mainMediaEl = createMediaElement(item, "main");

    fillLayer.append(fillMediaEl);
    mainLayer.append(mainMediaEl);
    frame.append(fillLayer, mainLayer);
  };

  const preloadItem = (item) => {
    if (!item || preloadCache.has(item.src)) return;

    const preloadVideo = document.createElement("video");
    preloadVideo.preload = "metadata";
    preloadVideo.muted = true;
    preloadVideo.playsInline = true;
    preloadVideo.src = item.src;
    try {
      preloadVideo.load();
    } catch {}
    preloadCache.set(item.src, preloadVideo);
  };

  const advanceToNext = (reason = "ended") => {
    if (destroyed || items.length < 2) return;
    cleanupActiveVideoWatchers();

    window.setTimeout(() => {
      if (destroyed) return;
      const nextIndex = (currentIndex + 1) % items.length;
      const nextFrame = activeFrame === 0 ? 1 : 0;

      mountItemInFrame(nextFrame, items[nextIndex]);
      preloadItem(items[(nextIndex + 1) % items.length]);

      window.requestAnimationFrame(() => {
        if (destroyed) return;
        frames[nextFrame].classList.add("is-active");
        frames[activeFrame].classList.remove("is-active");

        frames[activeFrame].querySelectorAll("video").forEach((outgoingVideo) => {
          try {
            outgoingVideo.pause();
          } catch {}
        });

        activeFrame = nextFrame;
        currentIndex = nextIndex;
        setIndicator();
        bindAdvanceForActiveVideo();
      });
    }, reason === "error" ? STUDIO_VIDEO_ERROR_ADVANCE_MS : 0);
  };

  const bindAdvanceForActiveVideo = () => {
    cleanupActiveVideoWatchers();
    const activeVideo = getFrameMainVideo(frames[activeFrame]);
    if (!activeVideo) return;

    frames[activeFrame].querySelectorAll("video").forEach((videoEl) => {
      tryPlayVideo(videoEl);
    });
    if (items.length < 2) return;

    let advanced = false;
    const advanceOnce = (reason) => {
      if (advanced || destroyed) return;
      advanced = true;
      advanceToNext(reason);
    };

    const onEnded = () => advanceOnce("ended");
    const onError = () => advanceOnce("error");
    const onWaiting = () => startStallFallback(advanceOnce);
    const onStalled = () => startStallFallback(advanceOnce);
    const onPlaying = () => clearStallAdvanceTimer();
    const onCanPlay = () => clearStallAdvanceTimer();
    const scheduleMaxFallback = () => {
      clearFallbackAdvanceTimer();
      const durationSec = Number(activeVideo.duration);
      const hasKnownDuration = Number.isFinite(durationSec) && durationSec > 0;
      // Duration-driven fallback avoids cutting long videos early.
      const fallbackMs = hasKnownDuration
        ? Math.ceil(durationSec * 1000) + STUDIO_VIDEO_ADVANCE_FALLBACK_MS
        : STUDIO_VIDEO_ADVANCE_FALLBACK_MS;
      fallbackAdvanceTimerId = window.setTimeout(() => {
        fallbackAdvanceTimerId = null;
        advanceOnce("max-timeout");
      }, fallbackMs);
    };
    const onLoadedMetadata = () => scheduleMaxFallback();
    const onDurationChange = () => scheduleMaxFallback();

    activeVideo.addEventListener("ended", onEnded);
    activeVideo.addEventListener("error", onError);
    activeVideo.addEventListener("waiting", onWaiting);
    activeVideo.addEventListener("stalled", onStalled);
    activeVideo.addEventListener("playing", onPlaying);
    activeVideo.addEventListener("canplay", onCanPlay);
    activeVideo.addEventListener("loadedmetadata", onLoadedMetadata);
    activeVideo.addEventListener("durationchange", onDurationChange);
    scheduleMaxFallback();

    listenersCleanup = () => {
      activeVideo.removeEventListener("ended", onEnded);
      activeVideo.removeEventListener("error", onError);
      activeVideo.removeEventListener("waiting", onWaiting);
      activeVideo.removeEventListener("stalled", onStalled);
      activeVideo.removeEventListener("playing", onPlaying);
      activeVideo.removeEventListener("canplay", onCanPlay);
      activeVideo.removeEventListener("loadedmetadata", onLoadedMetadata);
      activeVideo.removeEventListener("durationchange", onDurationChange);
    };
  };

  studioMediaCleanup = () => {
    destroyed = true;
    cleanupActiveVideoWatchers();
    abortController.abort();
    frames.forEach((frame) => {
      frame.classList.remove("is-active");
      frame.querySelectorAll("video").forEach((video) => {
        try {
          video.pause();
        } catch {}
      });
      frame.replaceChildren();
    });
  };

  if (caption) caption.textContent = "STUDIO MEDIA";

  fetch(STUDIO_VIDEO_MANIFEST_URL, { cache: "no-store", signal: abortController.signal })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`manifest HTTP ${response.status}`);
      }
      return response.json();
    })
    .then((manifest) => {
      if (destroyed) return;
      const parsed = Array.isArray(manifest) ? manifest.map(normalizeStudioVideoItem).filter(Boolean) : [];
      items = parsed;

      if (!items.length) {
        showFallback("No videos found.");
        return;
      }

      if (emptyState) emptyState.hidden = true;
      frames[0].classList.add("is-active");
      frames[1].classList.remove("is-active");
      currentIndex = 0;
      activeFrame = 0;
      mountItemInFrame(0, items[0]);
      setIndicator();

      if (items.length > 1) preloadItem(items[1]);
      bindAdvanceForActiveVideo();
    })
    .catch((error) => {
      if (destroyed || error?.name === "AbortError") return;
      console.error("[StudioMedia] Failed to load video manifest", error);
      showFallback("Studio media unavailable.");
    });
}

function initSessionsPhotoGrid() {
  const gallery = appEl.querySelector("[data-sessions-triple-gallery]");
  if (!gallery) return;

  const status = appEl.querySelector("[data-sessions-photo-status]");
  const isLocalDevHost = typeof window !== "undefined" && (
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
  );
  const abortController = new AbortController();
  const timers = new Set();
  const preloadCache = new Map();
  const boxes = Array.from(gallery.querySelectorAll("[data-sessions-feature]")).map((el) => {
    const frames = [
      el.querySelector('[data-sessions-feature-frame="0"]'),
      el.querySelector('[data-sessions-feature-frame="1"]'),
    ];
    const images = frames.map((frame) => frame?.querySelector("[data-sessions-feature-image]"));
    return {
      el,
      frames,
      images,
      activeFrame: 0,
      currentIndex: -1,
      pendingIndex: -1,
    };
  });
  let destroyed = false;
  let items = [];

  const setStatus = (message) => {
    if (!status) return;
    status.textContent = message;
    status.hidden = !message;
  };

  const clearTimers = () => {
    timers.forEach((timerId) => window.clearTimeout(timerId));
    timers.clear();
  };

  const scheduleTimer = (callback, delayMs) => {
    const timerId = window.setTimeout(() => {
      timers.delete(timerId);
      callback();
    }, delayMs);
    timers.add(timerId);
  };

  const preloadItem = (item) => {
    if (!item?.src) return Promise.resolve();
    if (preloadCache.has(item.src)) return preloadCache.get(item.src);

    const promise = new Promise((resolve) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => resolve();
      img.onerror = () => resolve();
      img.src = item.src;
    });

    preloadCache.set(item.src, promise);
    return promise;
  };

  const chooseNextIndex = (boxIndex) => {
    const box = boxes[boxIndex];
    if (!box || items.length < 2) return box?.currentIndex ?? 0;

    const blocked = new Set();
    if (items.length >= SESSIONS_FEATURE_BOX_COUNT) {
      boxes.forEach((otherBox, otherIndex) => {
        if (otherIndex === boxIndex) return;
        if (otherBox.currentIndex >= 0) blocked.add(otherBox.currentIndex);
        if (otherBox.pendingIndex >= 0) blocked.add(otherBox.pendingIndex);
      });
    }

    for (let offset = 1; offset <= items.length; offset += 1) {
      const candidate = (box.currentIndex + offset) % items.length;
      if (items.length >= SESSIONS_FEATURE_BOX_COUNT && blocked.has(candidate)) continue;
      return candidate;
    }

    return box.currentIndex;
  };

  const setBoxPhoto = (box, nextIndex) => {
    const activeFrame = box.activeFrame;
    const nextFrame = (activeFrame + 1) % 2;
    const nextItem = items[nextIndex];
    if (!nextItem) return;

    const nextImage = box.images[nextFrame];
    const activeImage = box.images[activeFrame];
    const label = `Session photo ${nextIndex + 1}`;
    if (!nextImage || !activeImage) return;

    nextImage.src = nextItem.src;
    nextImage.alt = label;
    box.frames[nextFrame].classList.add("is-active");
    box.frames[activeFrame].classList.remove("is-active");
    box.activeFrame = nextFrame;
    box.currentIndex = nextIndex;
  };

  const rotateBox = (boxIndex) => {
    if (destroyed || !items.length) return;
    const box = boxes[boxIndex];
    if (!box) return;
    if (box.pendingIndex >= 0) return;

    const nextIndex = chooseNextIndex(boxIndex);
    if (nextIndex === box.currentIndex) return;

    const nextItem = items[nextIndex];
    box.pendingIndex = nextIndex;
    const commitRotation = (finalIndex) => {
      if (finalIndex === box.currentIndex) return;
      setBoxPhoto(box, finalIndex);
      const upcomingIndex = chooseNextIndex(boxIndex);
      if (upcomingIndex !== box.currentIndex) preloadItem(items[upcomingIndex]);
    };

    preloadItem(nextItem)
      .then(() => {
        if (destroyed) return;
        const safeIndex = chooseNextIndex(boxIndex);
        if (safeIndex === box.currentIndex) return;
        if (safeIndex !== nextIndex) {
          return preloadItem(items[safeIndex]).then(() => {
            if (destroyed) return;
            commitRotation(safeIndex);
          });
        }
        commitRotation(nextIndex);
      })
      .finally(() => {
        box.pendingIndex = -1;
      });
  };

  const startRotation = () => {
    if (items.length < 2) return;

    SESSIONS_PHOTO_ROTATE_STAGGER_MS.forEach((offset, boxIndex) => {
      const tick = () => {
        if (destroyed) return;
        rotateBox(boxIndex);
        scheduleTimer(tick, SESSIONS_PHOTO_ROTATE_INTERVAL_MS);
      };
      scheduleTimer(tick, SESSIONS_PHOTO_ROTATE_INTERVAL_MS + offset);
    });
  };

  sessionsPhotoCleanup = () => {
    destroyed = true;
    abortController.abort();
    clearTimers();
    preloadCache.clear();
  };

  if (
    boxes.length !== SESSIONS_FEATURE_BOX_COUNT ||
    boxes.some((box) => box.frames.some((frame) => !frame) || box.images.some((img) => !img))
  ) {
    setStatus("Photos unavailable.");
    return;
  }

  gallery.hidden = true;
  setStatus("Loading photos...");

  fetch(STUDIO_PHOTO_MANIFEST_URL, { cache: "no-store", signal: abortController.signal })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`manifest HTTP ${response.status}`);
      }
      return response.json();
    })
    .then((manifest) => {
      if (destroyed) return;
      items = Array.isArray(manifest) ? manifest.map(normalizeStudioPhotoItem).filter(Boolean) : [];

      if (!items.length) {
        gallery.hidden = true;
        setStatus("No photos found.");
        return;
      }

      if (items.length < SESSIONS_FEATURE_BOX_COUNT && isLocalDevHost) {
        console.warn(`[SessionsGallery] Only ${items.length} photo(s) available; duplicate boxes are allowed.`);
      }

      const shuffledIndices = Array.from({ length: items.length }, (_, index) => index);
      for (let i = shuffledIndices.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledIndices[i], shuffledIndices[j]] = [shuffledIndices[j], shuffledIndices[i]];
      }

      boxes.forEach((box, boxIndex) => {
        const startIndex = items.length >= SESSIONS_FEATURE_BOX_COUNT
          ? shuffledIndices[boxIndex]
          : shuffledIndices[boxIndex % shuffledIndices.length];
        const startItem = items[startIndex];
        const label = `Session photo ${startIndex + 1}`;
        if (!startItem) return;

        box.images.forEach((imgEl, frameIndex) => {
          if (!imgEl) return;
          imgEl.src = startItem.src;
          imgEl.alt = label;
          imgEl.loading = boxIndex === 0 && frameIndex === 0 ? "eager" : "lazy";
          imgEl.decoding = "async";
        });

        box.frames[0].classList.add("is-active");
        box.frames[1].classList.remove("is-active");
        box.activeFrame = 0;
        box.currentIndex = startIndex;
      });

      boxes.forEach((box, boxIndex) => {
        const nextIndex = chooseNextIndex(boxIndex);
        if (nextIndex !== box.currentIndex) preloadItem(items[nextIndex]);
      });

      gallery.hidden = false;
      setStatus("");
      startRotation();
    })
    .catch((error) => {
      if (destroyed || error?.name === "AbortError") return;
      console.error("[StudioPhotos] Failed to load photo manifest", error);
      gallery.hidden = true;
      setStatus("Photos unavailable.");
    });
}

function initWorksCoverFlow() {
  const flow = appEl.querySelector("[data-works-flow]");
  if (!flow) return;

  const strip = flow.querySelector("[data-works-flow-strip]");
  const status = flow.querySelector("[data-works-status]");
  const currentCaption = flow.querySelector("[data-works-current]");
  const overlay = appEl.querySelector("[data-works-overlay]");
  const overlayTitle = appEl.querySelector("[data-works-overlay-title]");
  const overlayMeta = appEl.querySelector("[data-works-overlay-meta]");
  const overlaySpotify = appEl.querySelector("[data-works-overlay-spotify]");
  const overlayClose = appEl.querySelector("[data-works-overlay-close]");
  const overlayDismiss = appEl.querySelector("[data-works-overlay-dismiss]");
  if (
    !strip ||
    !status ||
    !currentCaption ||
    !overlay ||
    !overlayTitle ||
    !overlayMeta ||
    !overlaySpotify ||
    !overlayClose ||
    !overlayDismiss
  ) {
    return;
  }

  const abortController = new AbortController();
  const listenerCleanups = [];
  const cardEntries = new Map();
  let tracks = [];
  let destroyed = false;
  let rafId = null;
  let position = 0;
  let targetPosition = 0;
  let velocity = 0;
  let dragging = false;
  let dragPointerId = null;
  let lastPointerX = 0;
  let lastPointerTime = 0;
  let selectedIndex = 0;

  const addListener = (target, eventName, handler, options) => {
    target.addEventListener(eventName, handler, options);
    listenerCleanups.push(() => target.removeEventListener(eventName, handler, options));
  };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const getMaxIndex = () => Math.max(0, tracks.length - 1);
  const clampIndex = (value) => clamp(value, 0, getMaxIndex());
  const getStepPx = () => clamp(flow.clientWidth * 0.24, 120, 250);
  const setStatus = (message) => {
    status.textContent = message;
    status.hidden = !message;
  };
  const getTrackTitle = (track, index) => {
    const title = String(track?.title || "").trim();
    if (title) return title;
    return `Track ${String(index + 1).padStart(2, "0")}`;
  };
  const getTrackArtist = (track) => String(track?.artist || "").trim();
  const getTrackCaption = (track, index) => {
    const title = getTrackTitle(track, index);
    const artist = getTrackArtist(track);
    return artist ? `${artist} — ${title}` : title;
  };

  const getCurrentSelectionIndex = () => clampIndex(Math.round(position));

  const setSelectedIndex = (index) => {
    const safeIndex = clampIndex(index);
    if (selectedIndex === safeIndex && !currentCaption.hidden) return;
    selectedIndex = safeIndex;
    const track = tracks[safeIndex];
    if (!track) {
      currentCaption.textContent = "";
      currentCaption.hidden = true;
      return;
    }
    currentCaption.textContent = getTrackCaption(track, safeIndex);
    currentCaption.hidden = false;
  };

  const selectItem = (index, { snap = false } = {}) => {
    const safeIndex = clampIndex(index);
    closeOverlay();
    targetPosition = safeIndex;
    if (snap) {
      position = safeIndex;
      velocity = 0;
    }
    setSelectedIndex(safeIndex);
  };

  const closeOverlay = () => {
    overlay.hidden = true;
  };

  const openSelectedItem = () => {
    openOverlayForIndex(selectedIndex);
  };

  const openOverlayForIndex = (index) => {
    const safeIndex = clampIndex(index);
    const track = tracks[safeIndex];
    if (!track) return;

    overlayTitle.textContent = getTrackTitle(track, safeIndex);
    const artist = getTrackArtist(track);
    if (artist) {
      overlayMeta.textContent = artist;
      overlayMeta.hidden = false;
    } else {
      overlayMeta.textContent = "";
      overlayMeta.hidden = true;
    }
    if (track.spotifyUrl) {
      overlaySpotify.hidden = false;
      overlaySpotify.href = track.spotifyUrl;
      overlaySpotify.setAttribute("aria-disabled", "false");
    } else {
      overlaySpotify.hidden = true;
      overlaySpotify.removeAttribute("href");
      overlaySpotify.setAttribute("aria-disabled", "true");
    }
    overlay.hidden = false;
  };

  const createCard = (track, index) => {
    const title = getTrackTitle(track, index);
    const artist = getTrackArtist(track);
    const ariaLabel = artist ? `${title} by ${artist}` : title;

    const card = document.createElement("button");
    card.type = "button";
    card.className = "works-cover-card";
    card.dataset.worksCardIndex = String(index);
    card.setAttribute("aria-label", ariaLabel);
    card.setAttribute("aria-pressed", "false");

    const frame = document.createElement("span");
    frame.className = "works-cover-frame";

    const placeholder = document.createElement("span");
    placeholder.className = "works-cover-placeholder";
    placeholder.textContent = "Track unavailable";

    const label = document.createElement("span");
    label.className = "works-cover-label";
    label.textContent = title;

    let img = null;
    if (track.cover) {
      img = document.createElement("img");
      img.className = "works-cover-image";
      img.src = track.cover;
      img.alt = `${title} cover art`;
      img.loading = "lazy";
      img.decoding = "async";
      img.onerror = () => {
        img?.remove();
        placeholder.hidden = false;
      };
      placeholder.hidden = true;
      frame.append(img);
    }

    if (!track.cover) placeholder.hidden = false;
    frame.append(placeholder);
    card.append(frame, label);
    strip.append(card);
    return { card, img, placeholder };
  };

  const syncVisibleCards = () => {
    if (!tracks.length) return;
    const centerIndex = clampIndex(Math.round(position));
    const visibleStart = clamp(centerIndex - WORKS_FLOW_WINDOW_RADIUS, 0, getMaxIndex());
    const visibleEnd = clamp(centerIndex + WORKS_FLOW_WINDOW_RADIUS, 0, getMaxIndex());
    const stepPx = getStepPx();

    cardEntries.forEach((entry, index) => {
      if (index < visibleStart || index > visibleEnd) {
        entry.card.remove();
        cardEntries.delete(index);
      }
    });

    for (let index = visibleStart; index <= visibleEnd; index += 1) {
      if (!cardEntries.has(index)) {
        cardEntries.set(index, createCard(tracks[index], index));
      }
    }

    cardEntries.forEach((entry, index) => {
      const offset = index - position;
      const distance = Math.abs(offset);
      const translateX = offset * stepPx;
      const translateY = Math.min(distance * 18, 64);
      const translateZ = -distance * 140;
      const rotateY = clamp(-offset * 32, -58, 58);
      const scale = clamp(1 - distance * 0.18, 0.56, 1);
      const opacity = clamp(1 - distance * 0.24, 0.16, 1);
      const isActive = selectedIndex === index;

      entry.card.style.transform =
        `translate3d(-50%, -50%, 0) translate3d(${translateX.toFixed(2)}px, ${translateY.toFixed(2)}px, ${translateZ.toFixed(2)}px) ` +
        `rotateY(${rotateY.toFixed(2)}deg) scale(${scale.toFixed(3)})`;
      entry.card.style.opacity = opacity.toFixed(3);
      entry.card.style.zIndex = String(2000 - Math.round(distance * 100));
      entry.card.classList.toggle("is-active", isActive);
      entry.card.setAttribute("aria-pressed", String(isActive));
      if (distance <= 1.5 && entry.img) entry.img.loading = "eager";
    });
  };

  const setTargetPosition = (next) => {
    targetPosition = clampIndex(next);
  };

  const snapToClosest = () => {
    const predicted = position + velocity * 2.6;
    setTargetPosition(Math.round(predicted));
  };

  const onCardActivate = (index) => {
    if (!tracks.length) return;
    const nextIndex = clampIndex(index);
    if (nextIndex === selectedIndex) {
      openSelectedItem();
      return;
    }
    velocity = 0;
    selectItem(nextIndex);
  };

  const stopDragging = () => {
    if (!dragging) return;
    dragging = false;
    flow.classList.remove("is-dragging");
    if (dragPointerId !== null && flow.hasPointerCapture?.(dragPointerId)) {
      flow.releasePointerCapture(dragPointerId);
    }
    dragPointerId = null;
    snapToClosest();
  };

  const animate = () => {
    if (destroyed) return;

    if (tracks.length && !dragging) {
      const delta = targetPosition - position;
      velocity += delta * 0.1;
      velocity *= 0.78;

      if (Math.abs(delta) < 0.0005 && Math.abs(velocity) < 0.0005) {
        position = targetPosition;
        velocity = 0;
      } else {
        position += velocity;
      }

      position = clampIndex(position);
    }

    setSelectedIndex(getCurrentSelectionIndex());
    syncVisibleCards();
    rafId = window.requestAnimationFrame(animate);
  };

  worksFlowCleanup = () => {
    destroyed = true;
    abortController.abort();
    if (rafId !== null) {
      window.cancelAnimationFrame(rafId);
      rafId = null;
    }
    listenerCleanups.forEach((cleanup) => cleanup());
    listenerCleanups.length = 0;
    cardEntries.forEach(({ card }) => card.remove());
    cardEntries.clear();
    strip.replaceChildren();
    currentCaption.textContent = "";
    currentCaption.hidden = true;
    closeOverlay();
  };

  addListener(strip, "click", (event) => {
    const cardEl = event.target.closest("[data-works-card-index]");
    if (!cardEl) return;
    const index = Number(cardEl.dataset.worksCardIndex);
    if (!Number.isFinite(index)) return;
    onCardActivate(index);
  });

  addListener(flow, "wheel", (event) => {
    if (!tracks.length) return;
    const dominantDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (!dominantDelta) return;
    event.preventDefault();
    closeOverlay();
    setTargetPosition(targetPosition + dominantDelta * 0.0025);
  }, { passive: false });

  addListener(flow, "pointerdown", (event) => {
    if (!tracks.length) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    closeOverlay();
    flow.focus({ preventScroll: true });
    dragging = true;
    dragPointerId = event.pointerId;
    lastPointerX = event.clientX;
    lastPointerTime = performance.now();
    velocity = 0;
    targetPosition = position;
    flow.classList.add("is-dragging");
    flow.setPointerCapture?.(event.pointerId);
  });

  addListener(flow, "pointermove", (event) => {
    if (!dragging || event.pointerId !== dragPointerId) return;
    const now = performance.now();
    const stepPx = getStepPx();
    const deltaX = event.clientX - lastPointerX;
    const deltaIndex = deltaX / Math.max(stepPx, 1);
    position = clampIndex(position - deltaIndex);
    targetPosition = position;

    const deltaTime = Math.max(8, now - lastPointerTime);
    velocity = (-deltaIndex * 16) / deltaTime;
    lastPointerX = event.clientX;
    lastPointerTime = now;
  });

  addListener(flow, "pointerup", (event) => {
    if (event.pointerId !== dragPointerId) return;
    stopDragging();
  });

  addListener(flow, "pointercancel", () => {
    stopDragging();
  });

  addListener(flow, "keydown", (event) => {
    if (!tracks.length) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      velocity = 0;
      selectItem(selectedIndex - 1);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      velocity = 0;
      selectItem(selectedIndex + 1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openSelectedItem();
      return;
    }
    if (event.key === "Escape") closeOverlay();
  });

  addListener(overlayClose, "click", () => closeOverlay());
  addListener(overlayDismiss, "click", () => closeOverlay());
  addListener(overlay, "click", (event) => {
    if (event.target === overlay) closeOverlay();
  });

  const loadTracksFromMetadata = () =>
    fetch(WORKS_TRACKS_JSON_URL, { cache: "no-store", signal: abortController.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`works tracks JSON HTTP ${response.status}`);
        }
        return response.json();
      })
      .then((payload) => {
        if (!Array.isArray(payload)) return [];
        return payload.map((item, index) => buildWorksTrackFromMetadata(item, index));
      });

  const loadTracksFromLinks = () =>
    fetch(WORKS_TRACK_LINKS_URL, { cache: "no-store", signal: abortController.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`works track links HTTP ${response.status}`);
        }
        return response.text();
      })
      .then((rawText) => parseWorksTrackLinks(rawText))
      .then((trackLinks) => trackLinks.map((trackLink, index) => buildWorksTrackFromLink(trackLink, index)));

  setStatus("Loading works...");
  const loadTracksPromise = worksTracksCache
    ? Promise.resolve(worksTracksCache)
    : loadTracksFromMetadata()
      .catch((error) => {
        if (error?.name === "AbortError") throw error;
        return [];
      })
      .then((metadataTracks) => {
        if (metadataTracks.length) return metadataTracks;
        return loadTracksFromLinks();
      })
      .then((parsed) => {
        worksTracksCache = parsed;
        return parsed;
      });

  loadTracksPromise
    .then((loadedTracks) => {
      if (destroyed) return;
      tracks = shuffleArray(loadedTracks);
      if (!tracks.length) {
        setStatus("No works available.");
        return;
      }

      const startIndex = Math.floor(Math.random() * tracks.length);
      position = startIndex;
      targetPosition = startIndex;
      velocity = 0;
      overlay.hidden = true;

      setStatus("");
      flow.classList.add("is-ready");
      setSelectedIndex(startIndex);
      syncVisibleCards();
      rafId = window.requestAnimationFrame(animate);
    })
    .catch((error) => {
      if (destroyed || error?.name === "AbortError") return;
      console.error("[WorksFlow] Failed to load works tracks", error);
      setStatus("Works unavailable.");
    });
}

function renderApp() {
  const path = getRoutePath();
  const route = ROUTES[path] || ROUTES["/"];
  const isGameRoute = path === "/game";
  const isHomeRoute = path === "/";
  const isWorksRoute = path === "/works" || path === "/sessions" || path === "/work";
  const isContactRoute = path === "/contact";

  cleanupStudioMediaHero();
  cleanupSessionsPhotoGrid();
  cleanupWorksCoverFlow();

  if (!isGameRoute) cancelScheduledGameMount();

  bindGameRouteErrorCapture(isGameRoute);
  bindGameMountListeners(isGameRoute);

  if (!isGameRoute && (currentPath === "/game" || gameInstance)) {
    unmountGame();
    clearGameFatalError();
  }

  document.title = `${route.title} | ${BRAND}`;

  // Game route is full-bleed to avoid the double wrapper / orientation issues.
  if (isGameRoute) {
    if (currentPath !== "/game") unmountGame();
    appEl.innerHTML = route.render();
    bindGameMountListeners(true);
    syncGameFatalOverlay();
    bindGameFatalRetry(true);
  } else if (isHomeRoute || isWorksRoute) {
    appEl.innerHTML = `
      <div class="home-fullbleed">
        ${route.render()}
        ${renderOverlayNav(path)}
      </div>
    `;
  } else {
    appEl.innerHTML = `
      <div class="site-shell">
        ${renderHeader(path)}
        <main class="page ${isHomeRoute ? "page-home" : ""}">
          ${route.render()}
        </main>
      </div>
    `;
  }

  document.body.classList.toggle("route-game", isGameRoute);
  document.body.classList.toggle("route-site", !isGameRoute);
  document.body.classList.toggle("route-home", isHomeRoute);
  document.body.classList.toggle("route-works", isWorksRoute);
  document.body.classList.toggle("route-sessions", false);
  document.body.classList.toggle("route-contact", isContactRoute);
  if (!isGameRoute) {
    document.body.classList.remove("nickname-modal-open");
    if (typeof nicknameViewportCleanup === "function") {
      nicknameViewportCleanup();
      nicknameViewportCleanup = null;
    }
  }

  bindNavigation();
  bindContactForm();
  bindGameBack(isGameRoute);
  const canMountGame = bindGameNicknameGate(isGameRoute);
  if (isHomeRoute) initStudioMediaHero();
  if (isWorksRoute) initWorksCoverFlow();
  if (isContactRoute) initSessionsPhotoGrid();

  if (isGameRoute) {
    if (canMountGame) ensureGameMounted();
    else unmountGame();
  }

  currentPath = path;
}

function bindNavigation() {
  const navToggle = appEl.querySelector("[data-nav-toggle]");
  const nav = appEl.querySelector("[data-nav]");
  if (!navToggle || !nav) return;

  navToggle.addEventListener("click", () => {
    const nextOpen = !nav.classList.contains("is-open");
    nav.classList.toggle("is-open", nextOpen);
    navToggle.setAttribute("aria-expanded", String(nextOpen));
  });

  nav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      nav.classList.remove("is-open");
      navToggle.setAttribute("aria-expanded", "false");
    });
  });
}

function bindContactForm() {
  const form = appEl.querySelector("[data-contact-form]");
  if (!form) return;

  const status = appEl.querySelector("[data-contact-status]");
  const draftLink = appEl.querySelector("[data-contact-draft-link]");

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const name = String(formData.get("name") || "").trim();
    const email = String(formData.get("email") || "").trim();
    const message = String(formData.get("message") || "").trim();

    const subject = encodeURIComponent(`Studio Inquiry from ${name || "New Contact"}`);
    const body = encodeURIComponent(
      [
        `Name: ${name || "N/A"}`,
        `Email: ${email || "N/A"}`,
        "",
        message || "No message provided.",
      ].join("\n")
    );

    const mailtoHref = `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`;

    if (draftLink) draftLink.href = mailtoHref;
    if (status) status.hidden = false;

    window.location.href = mailtoHref;
  });
}

function bindGameBack(isGameRoute) {
  if (!isGameRoute) return;

  const back = appEl.querySelector(".game-back");
  if (!back) return;

  const goBack = (event) => {
    // Ensure the click isn't swallowed by the Phaser canvas/touch handlers.
    event.preventDefault();
    event.stopPropagation();

    // Always tear down the Phaser instance before leaving the route.
    unmountGame();

    // Navigate using the existing hash router.
    window.location.hash = "#/";
    // Force a render immediately (some mobile browsers can delay hashchange).
    renderApp();
  };

  back.addEventListener("click", goBack, { passive: false });
  back.addEventListener("touchstart", goBack, { passive: false });
}

function updateGameNicknameUi() {
  const nickname = getNickname();
  const nicknameWrap = appEl.querySelector("[data-game-nickname-wrap]");
  const nicknameValue = appEl.querySelector("[data-game-nickname]");
  const changeBtn = appEl.querySelector("[data-change-nickname]");

  if (nicknameValue) nicknameValue.textContent = nickname || "";
  if (nicknameWrap) nicknameWrap.hidden = !nickname;
  if (changeBtn) changeBtn.hidden = !nickname;
}

function setNicknameModalState(modal, open) {
  if (!modal) return;
  modal.hidden = !open;
  modal.classList.toggle("is-open", open);
  document.body.classList.toggle("nickname-modal-open", open && getRoutePath() === "/game");
}

function bindGameNicknameGate(isGameRoute) {
  if (!isGameRoute) return true;

  const modal = appEl.querySelector("[data-nickname-modal]");
  const form = appEl.querySelector("[data-nickname-form]");
  const title = appEl.querySelector("[data-nickname-title]");
  const copy = appEl.querySelector("[data-nickname-copy]");
  const nicknameRow = appEl.querySelector("[data-nickname-row]");
  const lockedNickname = appEl.querySelector("[data-nickname-locked]");
  const input = appEl.querySelector("[data-nickname-input]");
  const error = appEl.querySelector("[data-nickname-error]");
  const cancelBtn = appEl.querySelector("[data-nickname-cancel]");
  const changeBtn = appEl.querySelector("[data-change-nickname]");
  const forgetBtn = appEl.querySelector("[data-nickname-forget]");
  const pinWrap = appEl.querySelector("[data-nickname-pin-inputs]");
  const pinInputs = Array.from(appEl.querySelectorAll("[data-nickname-pin-input]"));
  const submitBtn = appEl.querySelector("[data-nickname-submit]") || form?.querySelector('button[type="submit"]');
  const PIN_REGEX = /^\d{4}$/;

  if (!modal || !form || !input || !error || !title || !copy || pinInputs.length !== 4) {
    return !!getNickname();
  }
  if (typeof nicknameViewportCleanup === "function") {
    nicknameViewportCleanup();
    nicknameViewportCleanup = null;
  }

  let modalMode = "claim";
  let pending = false;
  let loginNickname = "";

  const getStoredProfile = () => {
    let profile = getProfile();
    if (profile?.nickname && !profile?.userId) {
      const migrated = setNickname(profile.nickname);
      if (migrated) profile = migrated;
    }
    return profile;
  };

  const showError = (message) => {
    error.textContent = message || "";
    error.hidden = !message;
  };

  const safeFocus = (el, { select = false } = {}) => {
    if (!el) return;
    try {
      el.focus({ preventScroll: true });
    } catch {
      try {
        el.focus();
      } catch {}
    }
    if (select) {
      try {
        el.select();
      } catch {}
    }
  };

  const focusPinInput = (index = 0) => {
    const clamped = Math.max(0, Math.min(pinInputs.length - 1, index));
    safeFocus(pinInputs[clamped], { select: true });
  };

  const getPinValue = () => pinInputs.map((pin) => String(pin.value || "").replace(/\D+/g, "").slice(-1)).join("");

  const setPinValue = (rawPin) => {
    const digits = String(rawPin || "").replace(/\D+/g, "").slice(0, pinInputs.length);
    pinInputs.forEach((pin, index) => {
      pin.value = digits[index] || "";
    });
  };

  const focusFirstEmptyPin = () => {
    const emptyIndex = pinInputs.findIndex((pin) => !pin.value);
    focusPinInput(emptyIndex === -1 ? pinInputs.length - 1 : emptyIndex);
  };

  const canSubmit = () => {
    if (pending) return false;
    const pin = getPinValue();
    if (!PIN_REGEX.test(pin)) return false;
    if (modalMode === "login") return validateNickname(loginNickname);
    return validateNickname(canonicalizeNickname(input.value));
  };

  const updateSubmitEnabled = () => {
    if (submitBtn) submitBtn.disabled = !canSubmit();
  };

  const clearKeyboardInset = () => {
    document.body.style.setProperty("--kb-inset", "0px");
  };

  const bindKeyboardInset = () => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) {
      clearKeyboardInset();
      return;
    }

    const applyInset = () => {
      if (modal.hidden) return;
      const inset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      document.body.style.setProperty("--kb-inset", `${inset}px`);
    };

    vv.addEventListener("resize", applyInset);
    vv.addEventListener("scroll", applyInset);
    window.addEventListener("orientationchange", applyInset);
    applyInset();

    nicknameViewportCleanup = () => {
      vv.removeEventListener("resize", applyInset);
      vv.removeEventListener("scroll", applyInset);
      window.removeEventListener("orientationchange", applyInset);
      clearKeyboardInset();
    };
  };

  const closeModal = () => {
    if (modal.dataset.required === "true") return;
    setNicknameModalState(modal, false);
    showError("");
    if (typeof nicknameViewportCleanup === "function") {
      nicknameViewportCleanup();
      nicknameViewportCleanup = null;
    }
    if (getRoutePath() === "/game" && getNickname()) ensureGameMounted(0);
  };

  const bindPress = (el, handler) => {
    if (!el) return;
    const onPress = (event) => {
      event.preventDefault();
      event.stopPropagation();
      handler(event);
    };
    el.addEventListener("click", onPress);
    el.addEventListener("touchstart", onPress, { passive: false });
  };

  const syncModalModeUi = () => {
    const required = modal.dataset.required === "true";
    const profile = getStoredProfile();

    if (cancelBtn) {
      cancelBtn.hidden = required;
      cancelBtn.disabled = pending;
    }
    if (forgetBtn) {
      forgetBtn.hidden = required || !profile?.nickname;
      forgetBtn.disabled = pending;
    }

    const isLogin = modalMode === "login";
    if (nicknameRow) nicknameRow.hidden = isLogin;
    input.disabled = pending || isLogin;

    if (isLogin) {
      title.textContent = "Nickname already claimed";
      copy.textContent = "Nickname already claimed. Enter PIN to continue.";
      if (lockedNickname) {
        lockedNickname.textContent = loginNickname ? `Nickname: ${loginNickname}` : "";
        lockedNickname.hidden = !loginNickname;
      }
    } else {
      title.textContent = "Choose Nickname";
      copy.textContent = "Set 4-digit PIN";
      if (lockedNickname) {
        lockedNickname.hidden = true;
        lockedNickname.textContent = "";
      }
    }

    pinInputs.forEach((pin) => {
      pin.disabled = pending;
    });
    updateSubmitEnabled();
  };

  const setPending = (isPending) => {
    pending = !!isPending;
    syncModalModeUi();
  };

  const debugNicknameClaim = (...parts) => {
    if (!DEBUG_NICKNAME_CLAIM) return;
    console.log("[NicknameClaim]", ...parts);
  };

  const claimNickname = async (nickname, pin) => {
    try {
      const claimResponse = await fetch("/api/nickname/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nickname,
          pin,
        }),
      });

      let payload = null;
      try {
        payload = await claimResponse.json();
      } catch {
        payload = null;
      }

      debugNicknameClaim("response", claimResponse.status, payload?.error || "");

      if (claimResponse.status === 409 || payload?.error === "taken") return { ok: false, reason: "taken" };
      if (claimResponse.status === 400 || payload?.error === "invalid") return { ok: false, reason: "invalid" };
      if (claimResponse.status === 501 || payload?.error === "registry_unavailable") return { ok: false, reason: "registry_unavailable" };
      if (!claimResponse.ok) return { ok: false, reason: "error" };

      const claimedNickname = canonicalizeNickname(payload?.nickname || nickname);
      return { ok: true, nickname: claimedNickname || nickname };
    } catch (error) {
      debugNicknameClaim("network-error", error?.message || String(error || ""));
      return { ok: false, reason: "network_error" };
    }
  };

  const loginWithPin = async (nickname, pin) => {
    try {
      const loginResponse = await fetch("/api/nickname/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nickname,
          pin,
        }),
      });

      let payload = null;
      try {
        payload = await loginResponse.json();
      } catch {
        payload = null;
      }

      debugNicknameClaim("login-response", loginResponse.status, payload?.error || "");

      if (loginResponse.status === 401 || payload?.error === "invalid_pin") return { ok: false, reason: "invalid_pin" };
      if (loginResponse.status === 429 || payload?.error === "rate_limited") return { ok: false, reason: "rate_limited" };
      if (loginResponse.status === 400 || payload?.error === "invalid") return { ok: false, reason: "invalid" };
      if (loginResponse.status === 501 || payload?.error === "registry_unavailable") return { ok: false, reason: "registry_unavailable" };
      if (!loginResponse.ok) return { ok: false, reason: "error" };

      const resolvedNickname = canonicalizeNickname(payload?.nickname || nickname);
      return { ok: true, nickname: resolvedNickname || nickname };
    } catch (error) {
      debugNicknameClaim("login-network-error", error?.message || String(error || ""));
      return { ok: false, reason: "network_error" };
    }
  };

  const verifyNickname = async (nickname, pin) => {
    try {
      const verifyResponse = await fetch("/api/nickname/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nickname,
          pin,
        }),
      });

      let payload = null;
      try {
        payload = await verifyResponse.json();
      } catch {
        payload = null;
      }

      debugNicknameClaim("verify-response", verifyResponse.status, payload?.error || "");

      if (verifyResponse.status === 401 || payload?.error === "wrong_pin") return { ok: false, reason: "wrong_pin" };
      if (verifyResponse.status === 404 || payload?.error === "not_found") return { ok: false, reason: "not_found" };
      if (verifyResponse.status === 429 || payload?.error === "rate_limited") return { ok: false, reason: "rate_limited" };
      if (verifyResponse.status === 400 || payload?.error === "invalid") return { ok: false, reason: "invalid" };
      if (verifyResponse.status === 501 || payload?.error === "registry_unavailable") return { ok: false, reason: "registry_unavailable" };
      if (!verifyResponse.ok) return { ok: false, reason: "error" };

      const resolvedNickname = canonicalizeNickname(payload?.nickname || nickname);
      return { ok: true, nickname: resolvedNickname || nickname };
    } catch (error) {
      debugNicknameClaim("verify-network-error", error?.message || String(error || ""));
      return { ok: false, reason: "network_error" };
    }
  };

  const completeNicknameAuth = (nickname) => {
    const saved = setNickname(nickname);
    if (!saved) {
      showError("Could not save nickname. Try again.");
      return false;
    }
    modal.dataset.required = "false";
    setNicknameModalState(modal, false);
    showError("");
    if (typeof nicknameViewportCleanup === "function") {
      nicknameViewportCleanup();
      nicknameViewportCleanup = null;
    }
    updateGameNicknameUi();
    ensureGameMounted();
    return true;
  };

  const setModalMode = (mode, nickname = "") => {
    modalMode = mode === "login" ? "login" : "claim";
    loginNickname = canonicalizeNickname(nickname);
    syncModalModeUi();
  };

  const openModal = ({ required = false, mode = "claim", nickname = "", fromUserGesture = false } = {}) => {
    modal.dataset.required = required ? "true" : "false";
    setNicknameModalState(modal, true);
    showError("");
    setPending(false);
    setPinValue("");
    input.value = canonicalizeNickname(nickname || (mode === "claim" ? getNickname() : ""));
    setModalMode(mode, nickname);
    bindKeyboardInset();

    const focusPrimaryField = () => {
      if (modalMode === "login") focusPinInput(0);
      else safeFocus(input, { select: true });
    };

    if (fromUserGesture) focusPrimaryField();
    window.requestAnimationFrame(() => {
      if (modal.hidden) return;
      focusPrimaryField();
    });
  };

  const switchToLoginMode = (nickname) => {
    setPinValue("");
    setModalMode("login", nickname);
    focusPinInput(0);
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const pin = getPinValue();
    if (!PIN_REGEX.test(pin)) {
      showError("PIN must be exactly 4 digits.");
      focusFirstEmptyPin();
      updateSubmitEnabled();
      return;
    }
    showError("");
    if (modalMode === "claim") {
      const rawCandidate = input.value;
      const candidate = canonicalizeNickname(rawCandidate);
      debugNicknameClaim("submit-claim", { raw: rawCandidate, canonical: candidate });
      input.value = candidate;

      if (!validateNickname(candidate)) {
        showError("Nickname becomes 2–10 uppercase letters/numbers/underscore (spaces and other characters are removed).");
        safeFocus(input, { select: true });
        updateSubmitEnabled();
        return;
      }

      setPending(true);
      const claimResult = await claimNickname(candidate, pin);

      if (claimResult.ok) {
        setPending(false);
        completeNicknameAuth(claimResult.nickname || candidate);
        return;
      }
      if (claimResult.reason === "taken") {
        const verifyResult = await verifyNickname(candidate, pin);
        setPending(false);
        if (verifyResult.ok) {
          completeNicknameAuth(verifyResult.nickname || candidate);
          return;
        }
        if (verifyResult.reason === "wrong_pin") {
          showError("Nickname taken. PIN incorrect.");
          focusPinInput(0);
          return;
        }
        if (verifyResult.reason === "not_found") {
          showError("Nickname taken. Try another.");
          safeFocus(input, { select: true });
          return;
        }
        if (verifyResult.reason === "rate_limited") {
          showError("Too many attempts. Try again in a few minutes.");
          return;
        }
        if (verifyResult.reason === "registry_unavailable") {
          showError("Nickname registry unavailable right now. Try again in a moment.");
          return;
        }
        showError("Could not verify nickname right now. Try again in a moment.");
        return;
      }
      setPending(false);
      if (claimResult.reason === "invalid") {
        showError("Nickname becomes 2–10 uppercase letters/numbers/underscore (spaces and other characters are removed).");
        safeFocus(input, { select: true });
        updateSubmitEnabled();
        return;
      }
      if (claimResult.reason === "registry_unavailable") {
        completeNicknameAuth(candidate);
        return;
      }

      showError("Could not verify nickname right now. Try again in a moment.");
      updateSubmitEnabled();
      return;
    }

    const candidate = canonicalizeNickname(loginNickname);
    if (!validateNickname(candidate)) {
      showError("Choose a nickname first.");
      setModalMode("claim");
      safeFocus(input, { select: true });
      return;
    }

    setPending(true);
    const loginResult = await loginWithPin(candidate, pin);
    setPending(false);

    if (loginResult.ok) {
      completeNicknameAuth(loginResult.nickname || candidate);
      return;
    }
    if (loginResult.reason === "invalid_pin") {
      showError("Incorrect PIN. Try again.");
      focusPinInput(0);
      return;
    }
    if (loginResult.reason === "rate_limited") {
      showError("Too many attempts. Try again in a few minutes.");
      return;
    }
    if (loginResult.reason === "invalid") {
      showError("Enter a valid nickname and 4-digit PIN.");
      return;
    }
    showError("Could not verify nickname right now. Try again in a moment.");
  });

  input.addEventListener("input", () => {
    const canonical = canonicalizeNickname(input.value);
    if (input.value !== canonical) input.value = canonical;
    showError("");
    updateSubmitEnabled();
  });

  pinInputs.forEach((pin, index) => {
    pin.addEventListener("input", () => {
      const digits = String(pin.value || "").replace(/\D+/g, "");
      if (!digits) {
        pin.value = "";
        updateSubmitEnabled();
        return;
      }

      if (digits.length === 1) {
        pin.value = digits;
        if (index < pinInputs.length - 1) focusPinInput(index + 1);
        showError("");
        updateSubmitEnabled();
        return;
      }

      const fromIndex = index;
      const spread = digits.slice(0, pinInputs.length - fromIndex).split("");
      spread.forEach((digit, offset) => {
        pinInputs[fromIndex + offset].value = digit;
      });
      const nextIndex = Math.min(pinInputs.length - 1, fromIndex + spread.length - 1);
      focusPinInput(nextIndex);
      showError("");
      updateSubmitEnabled();
    });

    pin.addEventListener("keydown", (event) => {
      if (event.key === "Backspace") {
        if (pin.value) {
          pin.value = "";
          event.preventDefault();
          updateSubmitEnabled();
          return;
        }
        if (index > 0) {
          const prev = pinInputs[index - 1];
          prev.value = "";
          focusPinInput(index - 1);
          event.preventDefault();
          updateSubmitEnabled();
        }
        return;
      }

      if (event.key === "ArrowLeft" && index > 0) {
        focusPinInput(index - 1);
        event.preventDefault();
        return;
      }

      if (event.key === "ArrowRight" && index < pinInputs.length - 1) {
        focusPinInput(index + 1);
        event.preventDefault();
        return;
      }

      if (event.key.length === 1 && /\D/.test(event.key)) {
        event.preventDefault();
      }
    });

    pin.addEventListener("focus", () => {
      try {
        pin.select();
      } catch {}
    });
  });

  pinWrap?.addEventListener("paste", (event) => {
    const pasted = event.clipboardData?.getData("text") || "";
    const digits = pasted.replace(/\D+/g, "").slice(0, pinInputs.length);
    if (!digits) return;
    event.preventDefault();
    setPinValue(digits);
    focusPinInput(Math.min(digits.length, pinInputs.length) - 1);
    showError("");
    updateSubmitEnabled();
  });

  bindPress(cancelBtn, closeModal);
  bindPress(changeBtn, () => openModal({ required: false, mode: "claim", fromUserGesture: true, nickname: "" }));
  bindPress(forgetBtn, () => {
    clearNickname();
    updateGameNicknameUi();
    unmountGame();
    openModal({ required: true, mode: "claim", fromUserGesture: true, nickname: "" });
  });

  updateGameNicknameUi();
  const profile = getStoredProfile();
  if (!profile?.nickname || !profile?.userId) {
    openModal({ required: true, mode: "claim", nickname: profile?.nickname || "" });
    return false;
  }

  setNicknameModalState(modal, false);
  return true;
}

function renderHeader(activePath) {
  const links = NAV_LINKS.map(({ path, label }) => {
    const activeClass = activePath === path ? "is-active" : "";
    return `<a class="nav-link ${activeClass}" href="${routeHref(path)}">${label}</a>`;
  }).join("");

  return `
    <header class="site-header">
      <div class="nav-inner">
        <a class="brand" href="${routeHref("/")}">${BRAND}</a>
        <button
          class="nav-toggle"
          type="button"
          aria-expanded="false"
          aria-controls="site-nav"
          data-nav-toggle
        >
          Menu
        </button>
        <nav class="site-nav" id="site-nav" data-nav>
          ${links}
        </nav>
      </div>
    </header>
  `;
}

function renderOverlayNav(activePath) {
  const links = NAV_LINKS.map(({ path, label }) => {
    const activeClass = activePath === path ? "is-active" : "";
    return `<a class="overlay-link ${activeClass}" href="${routeHref(path)}">${label}</a>`;
  }).join("");

  return `
    <nav class="overlay-nav" data-overlay-nav aria-label="Site navigation">
      <div class="overlay-nav__panel">
        <a class="overlay-brand" href="${routeHref("/")}">${BRAND}</a>
        <div class="overlay-nav__links">
          ${links}
        </div>
      </div>
    </nav>
  `;
}

function renderHomePage() {
  return `
    <section class="cover">
      <div class="cover-layout">
        <section class="cover-feature">
          <div class="cover-stage studio-media-hero" aria-label="Studio media highlights" data-studio-media-hero>
            <div class="studio-media-frame is-active" data-studio-media-frame="0">
              <div class="studio-media-fill" aria-hidden="true"></div>
              <div class="studio-media-main"></div>
            </div>
            <div class="studio-media-frame" data-studio-media-frame="1">
              <div class="studio-media-fill" aria-hidden="true"></div>
              <div class="studio-media-main"></div>
            </div>
            <div class="studio-media-hud" data-studio-media-hud aria-live="polite">
              <p class="studio-media-hud-label" data-studio-media-caption>STUDIO MEDIA</p>
              <p class="studio-media-hud-index" data-studio-media-index>00 / 00</p>
              <span class="studio-media-hud-progress" aria-hidden="true">
                <span class="studio-media-hud-progress-fill" data-studio-media-progress></span>
              </span>
            </div>
            <p class="studio-media-empty" data-studio-media-empty hidden></p>
          </div>
        </section>
      </div>
    </section>
  `;
}

function renderSessionsPage() {
  return `
    <div class="sessions-page">
      <a
        class="cover-sticker sessions-sticker"
        href="${routeHref("/game")}"
        aria-label="Try my game and enter the studio"
        style="--sticker-points:${STICKER_SEAL_POINTS};"
      >
        <svg viewBox="0 0 120 120" aria-hidden="true" focusable="false">
          <polygon class="cover-sticker-star" points="${STICKER_SEAL_POINTS}" />
          <circle class="cover-sticker-sheen" cx="60" cy="60" r="43" />
          <circle class="cover-sticker-core" cx="60" cy="60" r="41" />
        </svg>
        <span class="sticker-text">
          <span>TRY MY GAME</span>
          <small>ENTER THE STUDIO</small>
        </span>
      </a>

      <section class="section-block">
        <ul class="sessions-list">
          <li>
            <p class="session-line">
              <span class="session-main">Raphael Saadiq&#39;s studio</span>
              <span class="session-meta">North Hollywood &mdash; engineering sessions for Syd</span>
            </p>
            <div class="session-tags">
              <a
                class="session-tag"
                href="https://www.youtube.com/watch?v=FqlI299tirE&list=RDFqlI299tirE&start_radio=1"
                target="_blank"
                rel="noreferrer"
              >
                Die for This
              </a>
              <a
                class="session-tag"
                href="https://www.youtube.com/watch?v=YgA2rJXXIkM&list=RDYgA2rJXXIkM&start_radio=1"
                target="_blank"
                rel="noreferrer"
              >
                GMFU
              </a>
            </div>
          </li>
          <li>
            <p class="session-line">
              <span class="session-main">Warner Chappell songwriter camps</span>
              <span class="session-meta">Sound Factory + Palms &mdash; engineering</span>
            </p>
          </li>
          <li>
            <p class="session-line">
              <span class="session-main">Furaha Sound</span>
              <span class="session-meta">Hollywood &mdash; production + engineering for Malia</span>
            </p>
            <div class="session-tags">
              <a
                class="session-tag"
                href="https://www.youtube.com/watch?v=z5KE9OTcjy4&list=RDz5KE9OTcjy4&start_radio=1"
                target="_blank"
                rel="noreferrer"
              >
                Not a Love Song
              </a>
            </div>
          </li>
          <li>
            <p class="session-line">
              <span class="session-main">Spotify Recording Studios</span>
              <span class="session-meta">Los Angeles &mdash; sessions + engineering</span>
            </p>
          </li>
          <li>
            <p class="session-line">
              <span class="session-main">Pulse</span>
              <span class="session-meta">Burbank &mdash; sessions + engineering</span>
            </p>
          </li>
          <li>
            <p class="session-line">
              <span class="session-main">Abbey Road Studios</span>
              <span class="session-meta">London &mdash; sessions</span>
            </p>
          </li>
        </ul>
      </section>
      <section class="section-block sessions-photos-block">
        <h2 class="sessions-photos-title">Photos</h2>
        <p class="sessions-photo-status" data-sessions-photo-status>Loading photos...</p>
        <div class="sessions-triple-gallery" data-sessions-triple-gallery hidden>
          <article class="sessions-feature sessions-feature-primary" data-sessions-feature="0">
            <div class="sessions-feature-frame is-active" data-sessions-feature-frame="0">
              <img class="sessions-feature-image" data-sessions-feature-image alt="" />
            </div>
            <div class="sessions-feature-frame" data-sessions-feature-frame="1">
              <img class="sessions-feature-image" data-sessions-feature-image alt="" />
            </div>
          </article>
          <article class="sessions-feature sessions-feature-secondary" data-sessions-feature="1">
            <div class="sessions-feature-frame is-active" data-sessions-feature-frame="0">
              <img class="sessions-feature-image" data-sessions-feature-image alt="" />
            </div>
            <div class="sessions-feature-frame" data-sessions-feature-frame="1">
              <img class="sessions-feature-image" data-sessions-feature-image alt="" />
            </div>
          </article>
          <article class="sessions-feature sessions-feature-secondary" data-sessions-feature="2">
            <div class="sessions-feature-frame is-active" data-sessions-feature-frame="0">
              <img class="sessions-feature-image" data-sessions-feature-image alt="" />
            </div>
            <div class="sessions-feature-frame" data-sessions-feature-frame="1">
              <img class="sessions-feature-image" data-sessions-feature-image alt="" />
            </div>
          </article>
        </div>
      </section>
    </div>
  `;
}

function renderWorkPage() {
  return `
    <section class="works-stage" data-works-stage>
      <div class="works-flow" data-works-flow tabindex="0" aria-label="Works cover flow">
        <p class="works-status" data-works-status>Loading works...</p>
        <div class="works-flow-strip" data-works-flow-strip></div>
        <p class="works-current" data-works-current hidden></p>
      </div>
      <div class="works-overlay" data-works-overlay hidden>
        <div class="works-overlay-panel" role="dialog" aria-modal="true" aria-labelledby="works-overlay-title">
          <button type="button" class="works-overlay-close" data-works-overlay-close aria-label="Close">Close</button>
          <h2 class="works-overlay-title" id="works-overlay-title" data-works-overlay-title></h2>
          <p class="works-overlay-meta" data-works-overlay-meta></p>
          <div class="works-overlay-actions">
            <a class="works-overlay-action" data-works-overlay-spotify target="_blank" rel="noreferrer noopener">
              Open in Spotify
            </a>
            <button type="button" class="works-overlay-action works-overlay-action-ghost" data-works-overlay-dismiss>
              Close
            </button>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderAboutPage() {
  return `
    <section class="editorial-header">
      <p class="section-label">About</p>
      <h1>A studio operator focused on records that last beyond release week.</h1>
    </section>
    <section class="about-layout">
      <article class="about-copy">
        <p>
          Rahi works at the intersection of songwriting, production, and engineering, shaping ideas into records with
          clear identity.
        </p>
        <p>
          From first concept to final handoff, sessions are built for momentum and trust.
        </p>
      </article>
      <aside class="portrait-placeholder" role="img" aria-label="Portrait placeholder">Portrait / Studio shot</aside>
    </section>
  `;
}

function renderContactPage() {
  return `
    <section class="editorial-header">
      <p class="section-label">Contact</p>
      <h1>Start the conversation.</h1>
    </section>

    <section class="contact-layout">
      <section class="contact-gallery">
        <p class="sessions-photo-status" data-sessions-photo-status>Loading photos...</p>
        <div class="sessions-triple-gallery" data-sessions-triple-gallery hidden>
          <article class="sessions-feature sessions-feature-primary" data-sessions-feature="0">
            <div class="sessions-feature-frame is-active" data-sessions-feature-frame="0">
              <img class="sessions-feature-image" data-sessions-feature-image alt="" />
            </div>
            <div class="sessions-feature-frame" data-sessions-feature-frame="1">
              <img class="sessions-feature-image" data-sessions-feature-image alt="" />
            </div>
          </article>
          <article class="sessions-feature sessions-feature-secondary" data-sessions-feature="1">
            <div class="sessions-feature-frame is-active" data-sessions-feature-frame="0">
              <img class="sessions-feature-image" data-sessions-feature-image alt="" />
            </div>
            <div class="sessions-feature-frame" data-sessions-feature-frame="1">
              <img class="sessions-feature-image" data-sessions-feature-image alt="" />
            </div>
          </article>
          <article class="sessions-feature sessions-feature-secondary" data-sessions-feature="2">
            <div class="sessions-feature-frame is-active" data-sessions-feature-frame="0">
              <img class="sessions-feature-image" data-sessions-feature-image alt="" />
            </div>
            <div class="sessions-feature-frame" data-sessions-feature-frame="1">
              <img class="sessions-feature-image" data-sessions-feature-image alt="" />
            </div>
          </article>
        </div>
      </section>

      <section class="contact-wrap">
        <form class="contact-form" data-contact-form>
          <label>
            Name
            <input type="text" name="name" autocomplete="name" required />
          </label>
          <label>
            Email
            <input type="email" name="email" autocomplete="email" required />
          </label>
          <label>
            Message
            <textarea name="message" rows="6" required></textarea>
          </label>
          <button class="callout-link" type="submit">Draft Message</button>
        </form>

        <p class="contact-status" data-contact-status hidden>
          Message drafted - send it?
          <a href="#" data-contact-draft-link>Open email app</a>
        </p>
      </section>
    </section>
  `;
}

function renderGamePage() {
  const nickname = getNickname();
  return `
    <section class="game-fullscreen" aria-label="Pokemon room game">
      <a class="game-back" href="${routeHref("/")}" aria-label="Back to site">← Back to site</a>
      <button class="game-change-nickname" type="button" data-change-nickname hidden>Change Nickname</button>
      <p class="game-nickname" data-game-nickname-wrap hidden>
        Player: <span data-game-nickname>${escapeHtml(nickname)}</span>
      </p>
      <div id="game-root" class="game-root"></div>
      <p class="game-fatal" data-game-fatal role="alert" hidden></p>
      <button class="game-retry" type="button" data-game-retry hidden>Retry</button>
      <div
        class="nickname-modal"
        data-nickname-modal
        hidden
        role="dialog"
        aria-modal="true"
        aria-labelledby="nickname-title"
      >
        <div class="nickname-modal-card">
          <h2 id="nickname-title" data-nickname-title>Choose Nickname</h2>
          <p class="nickname-copy" data-nickname-copy>Set 4-digit PIN</p>
          <form class="nickname-form" data-nickname-form>
            <div class="nickname-row" data-nickname-row>
              <label class="nickname-label" for="nickname-input">Nickname</label>
              <input
                id="nickname-input"
                class="nickname-input"
                data-nickname-input
                type="text"
                autofocus
                maxlength="10"
                autocomplete="nickname"
                inputmode="text"
              />
            </div>
            <p class="nickname-locked" data-nickname-locked hidden></p>
            <div class="nickname-pin-group">
              <p class="nickname-label">4-digit PIN</p>
              <div class="nickname-pin-inputs" data-nickname-pin-inputs>
                <input class="nickname-pin-input" data-nickname-pin-input type="text" inputmode="numeric" maxlength="1" pattern="[0-9]*" autocomplete="one-time-code" />
                <input class="nickname-pin-input" data-nickname-pin-input type="text" inputmode="numeric" maxlength="1" pattern="[0-9]*" />
                <input class="nickname-pin-input" data-nickname-pin-input type="text" inputmode="numeric" maxlength="1" pattern="[0-9]*" />
                <input class="nickname-pin-input" data-nickname-pin-input type="text" inputmode="numeric" maxlength="1" pattern="[0-9]*" />
              </div>
            </div>
            <p class="nickname-error" data-nickname-error aria-live="polite" hidden></p>
            <div class="nickname-actions">
              <button type="submit" class="nickname-btn" data-nickname-submit disabled>Continue</button>
              <button type="button" class="nickname-btn ghost" data-nickname-cancel>Cancel</button>
              <button type="button" class="nickname-btn ghost" data-nickname-forget hidden>Log out / Forget this device</button>
            </div>
          </form>
        </div>
      </div>
    </section>
  `;
}

window.addEventListener("hashchange", renderApp);
window.addEventListener("popstate", renderApp);
window.addEventListener("beforeunload", () => unmountGame());

renderApp();
