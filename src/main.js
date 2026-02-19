import Phaser from "phaser";
import RoomScene from "./scenes/RoomScene";
import TrophyRoomScene from "./scenes/TrophyRoomScene";
import { canonicalizeNickname, getNickname, setNickname, validateNickname } from "./arcade/profile";
import { getAllLeaderboards } from "./arcade/ArcadePersistence";
import "./style.css";

const BRAND = "RAHI STUDIO";
const CONTACT_EMAIL = "rahi@example.com";
const STUDIO_MEDIA_MANIFEST_URL = "/RAHI_STUDIO_MEDIA/manifest.json";
const STUDIO_MEDIA_BASE_URL = "/RAHI_STUDIO_MEDIA";
const STUDIO_MEDIA_IMAGE_MS = 7000;
const STUDIO_MEDIA_VIDEO_MS = 22000;
const STUDIO_MEDIA_VIDEO_EXTENSIONS = new Set(["mp4", "webm", "ogg", "mov", "m4v"]);
const STUDIO_MEDIA_IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "avif", "gif"]);
const DEBUG_NICKNAME_CLAIM = false;

const NAV_LINKS = [
  { path: "/", label: "Home" },
  { path: "/work", label: "Work" },
  { path: "/about", label: "About" },
  { path: "/contact", label: "Contact" },
  { path: "/game", label: "Game" },
];

const ROUTES = {
  "/": { title: "Home", render: renderHomePage },
  "/work": { title: "Work", render: renderWorkPage },
  "/about": { title: "About", render: renderAboutPage },
  "/contact": { title: "Contact", render: renderContactPage },
  "/game": { title: "Game", render: renderGamePage },
};

const appEl = document.getElementById("app");
let currentPath = null;
let gameInstance = null;
let gameMountRaf = null;
let nicknameViewportCleanup = null;
let studioMediaCleanup = null;
let nicknameRegistryWarningShown = false;
let gameFatalErrorMessage = "";
let gameRouteErrorCleanup = null;
const GAME_MOUNT_MAX_RETRIES = 20;

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

function createGame(parentId) {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent: parentId,
    width: 360,
    height: 640,
    backgroundColor: "#000000",
    pixelArt: true,
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    dom: { createContainer: true },
    physics: {
      default: "arcade",
      arcade: { debug: false },
    },
    scene: [RoomScene, TrophyRoomScene],
  });
}

function syncGameFatalOverlay() {
  const fatal = appEl.querySelector("[data-game-fatal]");
  if (!fatal) return;
  if (!gameFatalErrorMessage) {
    fatal.hidden = true;
    fatal.textContent = "";
    return;
  }
  fatal.hidden = false;
  fatal.textContent = `Game failed to start: ${gameFatalErrorMessage}`;
}

function setGameFatalError(message) {
  gameFatalErrorMessage = String(message || "Unknown error");
  syncGameFatalOverlay();
}

function clearGameFatalError() {
  gameFatalErrorMessage = "";
  syncGameFatalOverlay();
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
    setGameFatalError(message);
  };

  const onUnhandledRejection = (event) => {
    if (getRoutePath() !== "/game") return;
    const reason = event?.reason;
    const message =
      reason?.message ||
      (typeof reason === "string" ? reason : "") ||
      "Unhandled promise rejection";
    console.error("[GameRoute] unhandledrejection", reason || event);
    setGameFatalError(message);
  };

  window.addEventListener("error", onWindowError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);
  gameRouteErrorCleanup = () => {
    window.removeEventListener("error", onWindowError);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
  };
}

function mountGame() {
  if (gameInstance) return true;
  const root = document.getElementById("game-root");
  if (!root) return false;

  const rect = root.getBoundingClientRect();
  console.log("[GameRoute] mountGame:start", {
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  });
  if (rect.width < 10 || rect.height < 10) {
    console.warn("[GameRoute] mountGame:root-not-ready", {
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    });
    return false;
  }

  try {
    gameInstance = createGame("game-root");
    console.log("[GameRoute] mountGame:success");
    clearGameFatalError();
    return true;
  } catch (error) {
    console.error("[GameRoute] mountGame:failed", error);
    setGameFatalError(error?.message || String(error || "Unknown error"));
    return false;
  }
}

function scheduleGameMount(retryCount = 0) {
  if (gameMountRaf !== null) window.cancelAnimationFrame(gameMountRaf);
  gameMountRaf = window.requestAnimationFrame(() => {
    gameMountRaf = null;
    if (getRoutePath() !== "/game") return;
    const modal = appEl.querySelector("[data-nickname-modal]");
    if (modal && !modal.hidden) return;
    if (!getNickname()) return;

    const mounted = mountGame();
    if (mounted) return;

    if (retryCount < GAME_MOUNT_MAX_RETRIES) {
      scheduleGameMount(retryCount + 1);
      return;
    }

    setGameFatalError("Game root did not become ready. Please refresh and try again.");
  });
}

function unmountGame() {
  if (!gameInstance) return;
  gameInstance.destroy(true);
  gameInstance = null;
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

function normalizeStudioMediaItem(rawFilename) {
  const filename = String(rawFilename || "").trim();
  if (!filename || filename.includes("/")) return null;
  const match = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
  if (!match) return null;

  const ext = match[1];
  let type = "";
  if (STUDIO_MEDIA_VIDEO_EXTENSIONS.has(ext)) type = "video";
  else if (STUDIO_MEDIA_IMAGE_EXTENSIONS.has(ext)) type = "image";
  if (!type) return null;

  return {
    filename,
    type,
    src: `${STUDIO_MEDIA_BASE_URL}/${encodeURIComponent(filename)}`,
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
  const caption = hero.querySelector("[data-studio-media-caption]");
  const indexLabel = hero.querySelector("[data-studio-media-index]");
  const preloadCache = new Map();
  const abortController = new AbortController();
  let timerId = null;
  let destroyed = false;
  let currentIndex = 0;
  let activeFrame = 0;
  let items = [];

  const clearTimer = () => {
    if (timerId !== null) {
      window.clearTimeout(timerId);
      timerId = null;
    }
  };

  const showFallback = (message) => {
    if (emptyState) {
      emptyState.textContent = message;
      emptyState.hidden = false;
    }
    if (indexLabel) indexLabel.hidden = true;
  };

  const setIndicator = () => {
    if (!indexLabel) return;
    indexLabel.textContent = `${currentIndex + 1}/${items.length}`;
    indexLabel.hidden = items.length === 0;
  };

  const tryPlayVideo = (videoEl) => {
    if (!videoEl || videoEl.tagName !== "VIDEO") return;
    const playPromise = videoEl.play?.();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {
        // Keep the first frame if autoplay is blocked and continue the timed rotation.
      });
    }
  };

  const createMediaElement = (item) => {
    if (item.type === "video") {
      const video = document.createElement("video");
      video.className = "studio-media-asset";
      video.src = item.src;
      video.autoplay = true;
      video.muted = true;
      video.defaultMuted = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = "metadata";
      video.setAttribute("autoplay", "");
      video.setAttribute("muted", "");
      video.setAttribute("playsinline", "");
      video.setAttribute("webkit-playsinline", "");
      video.setAttribute("aria-hidden", "true");
      return video;
    }

    const image = document.createElement("img");
    image.className = "studio-media-asset";
    image.src = item.src;
    image.alt = "";
    image.decoding = "async";
    return image;
  };

  const mountItemInFrame = (frameIndex, item) => {
    const frame = frames[frameIndex];
    if (!frame) return;
    frame.replaceChildren();

    const mediaEl = createMediaElement(item);
    frame.append(mediaEl);

    if (item.type === "video") {
      window.requestAnimationFrame(() => {
        if (!destroyed) tryPlayVideo(mediaEl);
      });
    }
  };

  const preloadItem = (item) => {
    if (!item || preloadCache.has(item.src)) return;

    if (item.type === "video") {
      const preloadVideo = document.createElement("video");
      preloadVideo.preload = "metadata";
      preloadVideo.muted = true;
      preloadVideo.playsInline = true;
      preloadVideo.src = item.src;
      try {
        preloadVideo.load();
      } catch {}
      preloadCache.set(item.src, preloadVideo);
      return;
    }

    const preloadImage = new Image();
    preloadImage.decoding = "async";
    preloadImage.src = item.src;
    preloadCache.set(item.src, preloadImage);
  };

  const scheduleAdvance = () => {
    clearTimer();
    if (items.length < 2 || destroyed) return;

    const holdMs = items[currentIndex].type === "video" ? STUDIO_MEDIA_VIDEO_MS : STUDIO_MEDIA_IMAGE_MS;
    timerId = window.setTimeout(() => {
      if (destroyed) return;
      const nextIndex = (currentIndex + 1) % items.length;
      const nextFrame = activeFrame === 0 ? 1 : 0;

      mountItemInFrame(nextFrame, items[nextIndex]);
      preloadItem(items[(nextIndex + 1) % items.length]);

      window.requestAnimationFrame(() => {
        if (destroyed) return;
        frames[nextFrame].classList.add("is-active");
        frames[activeFrame].classList.remove("is-active");

        const outgoingVideo = frames[activeFrame].querySelector("video");
        if (outgoingVideo) {
          try {
            outgoingVideo.pause();
          } catch {}
        }

        activeFrame = nextFrame;
        currentIndex = nextIndex;
        setIndicator();
        scheduleAdvance();
      });
    }, holdMs);
  };

  studioMediaCleanup = () => {
    destroyed = true;
    clearTimer();
    abortController.abort();
    frames.forEach((frame) => {
      frame.classList.remove("is-active");
      const video = frame.querySelector("video");
      if (video) {
        try {
          video.pause();
        } catch {}
      }
      frame.replaceChildren();
    });
  };

  if (caption) caption.textContent = "Studio Media";

  fetch(STUDIO_MEDIA_MANIFEST_URL, { cache: "no-store", signal: abortController.signal })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`manifest HTTP ${response.status}`);
      }
      return response.json();
    })
    .then((manifest) => {
      if (destroyed) return;
      const parsed = Array.isArray(manifest) ? manifest.map(normalizeStudioMediaItem).filter(Boolean) : [];
      items = parsed;

      if (!items.length) {
        showFallback("Add media files and entries to /RAHI_STUDIO_MEDIA/manifest.json.");
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
      scheduleAdvance();
    })
    .catch((error) => {
      if (destroyed || error?.name === "AbortError") return;
      console.error("[StudioMedia] Failed to load /RAHI_STUDIO_MEDIA/manifest.json", error);
      showFallback("Studio media unavailable.");
    });
}

function renderApp() {
  const path = getRoutePath();
  const route = ROUTES[path] || ROUTES["/"];
  const isGameRoute = path === "/game";
  const isHomeRoute = path === "/";

  cleanupStudioMediaHero();

  if (!isGameRoute && gameMountRaf !== null) {
    window.cancelAnimationFrame(gameMountRaf);
    gameMountRaf = null;
  }

  bindGameRouteErrorCapture(isGameRoute);

  if (currentPath === "/game" && !isGameRoute) {
    unmountGame();
    clearGameFatalError();
  }

  document.title = `${route.title} | ${BRAND}`;

  // Game route is full-bleed to avoid the double wrapper / orientation issues.
  if (isGameRoute) {
    appEl.innerHTML = route.render();
    syncGameFatalOverlay();
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

  if (isGameRoute) {
    if (canMountGame) scheduleGameMount();
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
  const input = appEl.querySelector("[data-nickname-input]");
  const error = appEl.querySelector("[data-nickname-error]");
  const cancelBtn = appEl.querySelector("[data-nickname-cancel]");
  const changeBtn = appEl.querySelector("[data-change-nickname]");
  const submitBtn = form?.querySelector('button[type="submit"]');

  if (!modal || !form || !input || !error) return !!getNickname();
  if (typeof nicknameViewportCleanup === "function") {
    nicknameViewportCleanup();
    nicknameViewportCleanup = null;
  }

  const showError = (message) => {
    error.textContent = message || "";
    error.hidden = !message;
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

  const openModal = (required = false, fromUserGesture = false) => {
    modal.dataset.required = required ? "true" : "false";
    if (cancelBtn) cancelBtn.hidden = required;

    setNicknameModalState(modal, true);
    showError("");
    input.value = getNickname();
    bindKeyboardInset();

    // iOS Safari will often refuse to show the keyboard if focus happens async.
    // If this open is the result of a user gesture (tap/click), focus immediately.
    const doFocus = () => {
      try {
        input.focus({ preventScroll: true });
      } catch {
        try { input.focus(); } catch {}
      }
      try { input.select(); } catch {}
      try { input.scrollIntoView({ block: "center", inline: "nearest" }); } catch {}
    };

    if (fromUserGesture) doFocus();

    // Fallback focus on next frame (covers initial required modal + slow layouts)
    window.requestAnimationFrame(() => {
      if (modal.hidden) return;
      doFocus();
    });
  };

  const closeModal = () => {
    if (modal.dataset.required === "true") return;
    setNicknameModalState(modal, false);
    showError("");
    if (typeof nicknameViewportCleanup === "function") {
      nicknameViewportCleanup();
      nicknameViewportCleanup = null;
    }
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

  const setNicknameSubmitPending = (pending) => {
    input.disabled = pending;
    if (submitBtn) submitBtn.disabled = pending;
  };

  const focusNicknameInputForRetry = () => {
    const applyFocus = () => {
      try {
        input.focus({ preventScroll: true });
      } catch {
        try { input.focus(); } catch {}
      }
      try { input.select(); } catch {}
    };

    applyFocus();
    window.requestAnimationFrame(() => {
      if (modal.hidden) return;
      applyFocus();
    });
  };

  const debugNicknameClaim = (...parts) => {
    if (!DEBUG_NICKNAME_CLAIM) return;
    console.log("[NicknameClaim]", ...parts);
  };

  const isNicknameTakenLocally = (nickname, previousNickname = "") => {
    const target = canonicalizeNickname(nickname);
    if (!target) return false;

    const previous = canonicalizeNickname(previousNickname);
    if (previous && previous === target) return false;

    const current = canonicalizeNickname(getNickname());
    if (current && current === target) return true;

    const boards = getAllLeaderboards();
    const gameIds = Object.keys(boards || {});
    for (let i = 0; i < gameIds.length; i += 1) {
      const entries = Array.isArray(boards[gameIds[i]]) ? boards[gameIds[i]] : [];
      for (let j = 0; j < entries.length; j += 1) {
        const entryName = canonicalizeNickname(entries[j]?.nickname);
        if (entryName && entryName === target) return true;
      }
    }

    return false;
  };

  const claimNickname = async (nickname) => {
    try {
      const claimResponse = await fetch("/api/nickname/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nickname,
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
      if (claimResponse.status === 501 || payload?.error === "registry_unavailable") {
        return { ok: false, reason: "registry_unavailable" };
      }
      if (!claimResponse.ok) return { ok: false, reason: "error" };

      const claimedNickname = canonicalizeNickname(payload?.nickname || nickname);
      return { ok: true, nickname: claimedNickname || nickname };
    } catch (error) {
      debugNicknameClaim("network-error", error?.message || String(error || ""));
      return { ok: false, reason: "network_error" };
    }
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const rawCandidate = input.value;
    const candidate = canonicalizeNickname(rawCandidate);
    debugNicknameClaim("submit", { raw: rawCandidate, canonical: candidate });
    input.value = candidate;
    if (!validateNickname(candidate)) {
      showError("Nickname becomes 2–10 uppercase letters/numbers/underscore (spaces and other characters are removed).");
      focusNicknameInputForRetry();
      return;
    }

    showError("");
    const previousNickname = getNickname() || "";
    setNicknameSubmitPending(true);
    const claimResult = await claimNickname(candidate);
    setNicknameSubmitPending(false);
    let allowLocalFallback = false;

    if (!claimResult.ok && claimResult.reason === "taken") {
      showError("That nickname is taken. Try another.");
      focusNicknameInputForRetry();
      return;
    }
    if (!claimResult.ok && claimResult.reason === "invalid") {
      showError("Nickname becomes 2–10 uppercase letters/numbers/underscore (spaces and other characters are removed).");
      focusNicknameInputForRetry();
      return;
    }
    if (!claimResult.ok && (claimResult.reason === "registry_unavailable" || claimResult.reason === "network_error")) {
      if (isNicknameTakenLocally(candidate, previousNickname)) {
        showError("That nickname is taken. Try another.");
        focusNicknameInputForRetry();
        return;
      }
      allowLocalFallback = true;
      if (!nicknameRegistryWarningShown) {
        nicknameRegistryWarningShown = true;
        window.alert("Online nickname registry unavailable; nickname uniqueness is local-only right now.");
      }
    }
    if (!claimResult.ok && !allowLocalFallback) {
      showError("Could not verify nickname right now. Try again in a moment.");
      focusNicknameInputForRetry();
      return;
    }

    const saved = setNickname(claimResult.nickname || candidate);
    if (!saved) {
      showError("Could not save nickname. Try again.");
      focusNicknameInputForRetry();
      return;
    }
    modal.dataset.required = "false";
    setNicknameModalState(modal, false);
    if (typeof nicknameViewportCleanup === "function") {
      nicknameViewportCleanup();
      nicknameViewportCleanup = null;
    }
    updateGameNicknameUi();
    scheduleGameMount();
  });

  bindPress(cancelBtn, closeModal);
  bindPress(changeBtn, () => openModal(false, true));

  updateGameNicknameUi();
  if (!getNickname()) {
    openModal(true);
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

function renderHomePage() {
  return `
    <section class="cover">
      <p class="cover-kicker">Issue 01 / Studio Edition</p>
      <h1 class="cover-masthead">RAHI STUDIO</h1>
      <a class="cover-sticker" href="${routeHref("/game")}" aria-label="Try my game and enter the studio">
        <svg viewBox="0 0 120 120" aria-hidden="true" focusable="false">
          <polygon fill="#ffd400" points="${STICKER_SEAL_POINTS}" />
          <circle cx="60" cy="60" r="43" fill="#ffdf33" opacity="0.55" />
          <circle cx="60" cy="60" r="41" fill="#ffd400" opacity="0.9" />
        </svg>
        <span class="sticker-text">
          <span>TRY MY GAME</span>
          <small>ENTER THE STUDIO</small>
        </span>
      </a>

      <div class="cover-layout">
        <aside class="cover-lines">
          <p>Control-room notes from this week.</p>
          <p>Melody first, mix-ready from day one.</p>
          <p>Where hooks meet heavyweight sonics.</p>
          <p>New work pipeline now open.</p>
        </aside>

        <section class="cover-feature">
          <div class="cover-stage studio-media-hero" aria-label="Studio media highlights" data-studio-media-hero>
            <div class="studio-media-frame is-active" data-studio-media-frame="0"></div>
            <div class="studio-media-frame" data-studio-media-frame="1"></div>
            <p class="studio-media-empty" data-studio-media-empty hidden></p>
            <p class="cover-stage-caption" data-studio-media-caption>Studio Media</p>
            <p class="studio-media-index" data-studio-media-index hidden></p>
          </div>
          <h2 class="cover-headline">HE DOESN'T MISS!</h2>
          <p class="cover-deck">Songwriting &bull; Producing &bull; Engineering</p>
        </section>

        <aside class="cover-lines">
          <p>Built for artists with clear intent.</p>
          <p>From session spark to final bounce.</p>
          <p>Confident process, fast creative decisions.</p>
          <p>Book: writing, production, engineering.</p>
        </aside>
      </div>
    </section>
  `;
}

function renderWorkPage() {
  return `
    <section class="editorial-header">
      <p class="section-label">Work</p>
      <h1>Services that keep records moving from idea to release.</h1>
    </section>
    <section class="service-stack">
      <article class="service-detail-card">
        <h2>Songwriting</h2>
        <p class="mini-label">What I do</p>
        <ul>
          <li>Topline direction and melodic development.</li>
          <li>Verse/pre/chorus architecture for momentum.</li>
          <li>Lyric editing for clarity, rhythm, and identity.</li>
        </ul>
        <p class="mini-label">What the client gets</p>
        <ul>
          <li>Song map and finalized lyric draft.</li>
          <li>Reference vocal + session notes.</li>
          <li>Revision pass aligned to release goals.</li>
        </ul>
      </article>
      <article class="service-detail-card">
        <h2>Producing</h2>
        <p class="mini-label">What I do</p>
        <ul>
          <li>Beat and arrangement design around artist tone.</li>
          <li>Session direction with fast decision loops.</li>
          <li>Final production prep for mix handoff.</li>
        </ul>
        <p class="mini-label">What the client gets</p>
        <ul>
          <li>Production stems and rough print.</li>
          <li>Creative direction memo per track.</li>
          <li>Versioned bounces for approvals.</li>
        </ul>
      </article>
      <article class="service-detail-card">
        <h2>Engineering</h2>
        <p class="mini-label">What I do</p>
        <ul>
          <li>Vocal tracking tuned for emotion and control.</li>
          <li>Comping and session cleanup in real time.</li>
          <li>Technical delivery that keeps post smooth.</li>
        </ul>
        <p class="mini-label">What the client gets</p>
        <ul>
          <li>Organized sessions ready for mix/master.</li>
          <li>Consistent gain staging and naming.</li>
          <li>Reliable turnaround with clear communication.</li>
        </ul>
      </article>
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
      <p class="contact-email-line">Email: ${CONTACT_EMAIL} (replace later)</p>
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
      <div
        class="nickname-modal"
        data-nickname-modal
        hidden
        role="dialog"
        aria-modal="true"
        aria-labelledby="nickname-title"
      >
        <div class="nickname-modal-card">
          <h2 id="nickname-title">Set your Nickname</h2>
          <p class="nickname-copy">Enter a nickname to continue.</p>
          <form class="nickname-form" data-nickname-form>
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
            <p class="nickname-error" data-nickname-error aria-live="polite" hidden></p>
            <div class="nickname-actions">
              <button type="submit" class="nickname-btn">Continue</button>
              <button type="button" class="nickname-btn ghost" data-nickname-cancel>Cancel</button>
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
