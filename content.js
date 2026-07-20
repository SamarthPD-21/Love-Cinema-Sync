// content.js
console.log("Love Cinema Sync extension content script loaded");

// --- SECTION 1: Constants & State ---
let isExtensionEnabled = true;
let isUrlSyncEnabled = true;
let isVideoSyncEnabled = true;
let lastObservedServer = "";
let isCinemaHallPage = false;
let isIntervalsStarted = false;
let lastReceivedSeekTime = null;
let lastReceivedSeekTimestamp = 0;
let lastReceivedPlayPauseAction = null;
let lastReceivedPlayPauseTimestamp = 0;

// Host checks
const isAppDomain =
  window.location.host.includes("localhost") ||
  window.location.host.includes("127.0.0.1") ||
  window.location.host.includes("vercel.app") ||
  window.location.host.includes("onrender.com");

const isPlayerDomain = 
  window.location.host.includes("1hd.art") || 
  window.location.host.includes("cineby") || 
  window.location.host.includes("miruro") || 
  window.location.host.includes("rabbitstream") || 
  window.location.host.includes("upcloud") || 
  window.location.host.includes("vidcloud") || 
  window.location.host.includes("megacloud") || 
  window.location.host.includes("dokicloud") ||
  window.location.host.includes("cloud") ||
  window.location.host.includes("stream") ||
  window.location.host.includes("play");

// Non-player iframe signatures to exclude from player finder
const NON_PLAYER_PATTERNS = [
  "disqus", "giscus", "facebook", "twitter", "google",
  "ads", "analytics", "tracking", "comment", "chat",
  "recaptcha", "cdn-cgi", "doubleclick", "adsense",
  "widget", "gravatar"
];

// --- SECTION 2: Utility Functions ---
function safeSendMessage(message, callback) {
  try {
    if (typeof chrome !== "undefined" && chrome?.runtime?.id) {
      chrome.runtime.sendMessage(message, (res) => {
        if (chrome.runtime.lastError) {
          // Context might be invalidated
        } else if (callback) {
          callback(res);
        }
      });
      return true;
    }
  } catch (e) {
    // Context is invalidated
  }
  return false;
}

function getMainVideoElement() {
  const videos = Array.from(document.querySelectorAll("video"));
  if (videos.length === 0) return null;
  if (videos.length === 1) return videos[0];
  
  let mainVideo = null;
  let maxArea = 0;
  for (const video of videos) {
    const rect = video.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area > maxArea && rect.width > 50 && rect.height > 50) {
      maxArea = area;
      mainVideo = video;
    }
  }
  return mainVideo || videos[0];
}

// --- SECTION 3: PlayerFinder Engine ---
function isNonPlayerIframe(src) {
  const lowerSrc = src.toLowerCase();
  return NON_PLAYER_PATTERNS.some(pattern => lowerSrc.includes(pattern));
}

function scoreElement(el, type) {
  let score = 0;
  
  if (type === "video") {
    score += 50;
  } else if (type === "iframe") {
    const src = (el.src || "").toLowerCase();
    if (src.includes("embed") || src.includes("player") || src.includes("stream") || src.includes("watch")) {
      score += 40;
    }
  } else if (type === "container") {
    score += 30;
  }

  // Size scoring
  const rect = el.getBoundingClientRect();
  const area = rect.width * rect.height;
  const viewportArea = window.innerWidth * window.innerHeight;
  
  if (area > viewportArea * 0.3) {
    score += 30;
  }
  if (rect.width > 100 && rect.height > 100) {
    score += 10;
  } else {
    score -= 50; // Penalty for tiny elements
  }

  // Proximity to known player selectors
  if (el.closest(".artplayer-app, .plyr, .jwplayer, .video-js, .player-container, #player")) {
    score += 20;
  }

  return score;
}

function findMainPlayer() {
  const candidates = [];

  // 1. Check direct video elements
  document.querySelectorAll("video").forEach(el => {
    candidates.push({ el, score: scoreElement(el, "video") });
  });

  // 2. Check iframes
  document.querySelectorAll("iframe").forEach(el => {
    const src = el.src || "";
    if (src && !isNonPlayerIframe(src)) {
      candidates.push({ el, score: scoreElement(el, "iframe") });
    }
  });

  // 3. Check player container divs
  const containerSelectors = [
    ".artplayer-app", ".plyr", ".jwplayer", ".video-js",
    ".player-container", "#player", ".watching-player",
    "#player-holder", ".vjs-tech"
  ];
  document.querySelectorAll(containerSelectors.join(",")).forEach(el => {
    candidates.push({ el, score: scoreElement(el, "container") });
  });

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].score > 0 ? candidates[0].el : null;
}

// --- SECTION 4: ControlsFinder Engine ---
function findServers() {
  const results = [];
  const serverPatterns = [
    /server\s*\d*/i, /source/i, /vidcloud/i, /upcloud/i,
    /megacloud/i, /1hd/i, /vidsrc/i, /vidking/i,
    /filemoon/i, /streamtape/i, /doodstream/i, /mp4upload/i
  ];

  const clickables = document.querySelectorAll("a, button, [role='button'], [data-server]");
  for (const el of clickables) {
    const text = el.textContent.trim();
    if (text.length > 0 && text.length < 30) {
      for (const pattern of serverPatterns) {
        if (pattern.test(text)) {
          if (results.some(r => r.el === el)) continue;
          const isActive = el.classList.contains("active") ||
                           el.getAttribute("aria-selected") === "true" ||
                           el.classList.contains("selected");
          results.push({ el, label: text, active: isActive });
          break;
        }
      }
    }
  }
  return results;
}

function findSubDub() {
  const results = [];
  const allElements = document.querySelectorAll("button, a, span, div, li");

  for (const el of allElements) {
    if (el.children.length > 0) continue; // leaf nodes only
    const text = el.textContent.trim().toUpperCase();
    if (text === "SUB" || text === "DUB" ||
        text === "SUBBED" || text === "DUBBED" ||
        text === "JAPANESE" || text === "ENGLISH") {
      const clickTarget = el.closest("button") || el.closest("a") ||
                          el.closest("[role='button']") || el;
      if (results.some(r => r.el === clickTarget)) continue;
      
      const isActive = clickTarget.classList.contains("active") ||
                       clickTarget.getAttribute("aria-selected") === "true" ||
                       clickTarget.classList.contains("selected") ||
                       el.classList.contains("active") ||
                       el.classList.contains("selected");
      results.push({ el: clickTarget, label: text, active: isActive });
    }
  }
  return results;
}

function findEpisodes() {
  const results = [];
  const links = document.querySelectorAll("a, button, [role='button']");
  
  for (const el of links) {
    const text = el.textContent.trim();
    if (/^(ep\.?\s*)?(\d{1,4})$/i.test(text)) {
      const container = el.closest("[class*='episode'], [class*='Episode'], [id*='episode'], .episodes");
      if (container) {
        if (results.some(r => r.el === el)) continue;
        const isActive = el.classList.contains("active") ||
                         el.getAttribute("aria-current") === "true" ||
                         el.classList.contains("selected");
        results.push({ el, label: `Ep ${text.replace(/\D/g, "")}`, active: isActive });
      }
    }
    
    const lowerText = text.toLowerCase();
    if (lowerText.includes("next") && (lowerText.includes("ep") || lowerText.includes("episode"))) {
      results.push({ el, label: "Next ▸", active: false });
    }
    if (lowerText.includes("prev") && (lowerText.includes("ep") || lowerText.includes("episode"))) {
      results.push({ el, label: "◂ Prev", active: false });
    }
  }
  return results;
}

function findQuality() {
  const results = [];
  const qualityPatterns = [/\d{3,4}p/i, /4k/i, /hd/i, /fhd/i, /uhd/i, /auto/i];

  const clickables = document.querySelectorAll("a, button, [role='button'], li, span");
  for (const el of clickables) {
    const text = el.textContent.trim();
    if (text.length > 0 && text.length < 15) {
      for (const pattern of qualityPatterns) {
        if (pattern.test(text)) {
          if (results.some(r => r.el === el)) continue;
          const isActive = el.classList.contains("active") || el.classList.contains("selected");
          results.push({ el, label: text, active: isActive });
          break;
        }
      }
    }
  }
  return results;
}

// --- SECTION 5: CinemaMode Engine ---
function findPlayerSection(el) {
  if (!el) return el;
  
  // 1. Prioritize precise web video player engine containers (ArtPlayer, Plyr, JWPlayer, Video.js, etc.)
  const playerEngineContainer = el.closest(
    ".artplayer-app, .art-video-player, .plyr, .jwplayer, .video-js, .vjs-tech, .html5-video-player"
  );
  if (playerEngineContainer) return playerEngineContainer;

  // 2. Direct player box containers (excluding broad wrappers that include site footers/bars)
  const playerBox = el.closest(
    "#player, .player-container, .watching-player, #player-holder, #iframe-embed, #video-player, [id*='player-box']"
  );
  if (playerBox) return playerBox;

  // 3. Fallback: If el is inside a generic player wrapper
  const genericWrapper = el.closest(
    "[class*='player-wrapper'], [class*='PlayerWrapper'], [class*='player_wrapper'], [class*='player-container'], [class*='playerContainer']"
  );
  if (genericWrapper) return genericWrapper;

  // 4. Otherwise walk up until reaching a main layout boundary
  let current = el;
  if (current.tagName === "VIDEO" && current.parentElement) {
    current = current.parentElement;
  }

  while (
    current &&
    current.parentElement &&
    current.parentElement !== document.body &&
    current.parentElement !== document.documentElement
  ) {
    const parent = current.parentElement;
    if (
      parent.tagName === "BODY" ||
      parent.tagName === "HTML" ||
      parent.classList.contains("cinema-room") ||
      parent.id === "root" ||
      parent.id === "__next"
    ) {
      break;
    }
    current = parent;
  }
  return current;
}

function cleanNativeControlsFromSection(section, originalStylesMap) {
  if (!section) return;
  // Hide site-specific control bars, server bars, or episode bars that might be nested inside or around section
  const siteBars = section.querySelectorAll(
    "[class*='controls-bar'], [class*='control-bar'], [class*='server-list'], [class*='servers-list'], [class*='episodes-list'], [class*='player-footer'], [class*='player-bottom'], [class*='site-controls']"
  );
  siteBars.forEach(bar => {
    // Only hide if it's not part of ArtPlayer / Plyr / JWPlayer / VideoJS built-in player controls
    if (!bar.closest(".art-controls, .plyr__controls, .jw-controls, .vjs-control-bar")) {
      if (!originalStylesMap.has(bar)) {
        originalStylesMap.set(bar, bar.style.cssText);
      }
      bar.style.setProperty("display", "none", "important");
      bar.style.setProperty("visibility", "hidden", "important");
      bar.style.setProperty("opacity", "0", "important");
    }
  });
}

function hideSiblings(section, originalStylesMap) {
  let current = section;
  while (current && current !== document.body) {
    const parent = current.parentElement;
    if (parent) {
      Array.from(parent.children).forEach(sibling => {
        if (sibling !== current && 
            sibling.id !== "love-sync-countdown" &&
            sibling.id !== "love-sync-trailer-blocked") {
          if (!originalStylesMap.has(sibling)) {
            originalStylesMap.set(sibling, sibling.style.cssText);
          }
          sibling.style.setProperty("display", "none", "important");
          sibling.style.setProperty("visibility", "hidden", "important");
          sibling.style.setProperty("opacity", "0", "important");
          sibling.style.setProperty("pointer-events", "none", "important");
        }
      });
    }
    current = parent;
  }
}

function maximizeElement(el, originalStylesMap) {
  if (!originalStylesMap.has(el)) {
    originalStylesMap.set(el, el.style.cssText);
  }
  
  el.setAttribute("data-love-sync-player", "true");
  el.style.setProperty("position", "fixed", "important");
  el.style.setProperty("top", "0", "important");
  el.style.setProperty("left", "0", "important");
  el.style.setProperty("width", "100vw", "important");
  el.style.setProperty("height", "100vh", "important");
  el.style.setProperty("z-index", "2147483646", "important");
  el.style.setProperty("background", "black", "important");
  el.style.setProperty("border", "none", "important");
  el.style.setProperty("margin", "0", "important");
  el.style.setProperty("padding", "0", "important");
  el.style.setProperty("box-shadow", "none", "important");
}

const cinemaMode = {
  active: false,
  originalStyles: new Map(),
  playerEl: null,
  sectionEl: null,

  toggle() {
    if (this.active) {
      this.deactivate();
    } else {
      const player = findMainPlayer();
      if (player) {
        this.activate(player);
      } else {
        console.warn("Love Sync: Main video player element not found on page.");
      }
    }
  },

  activate(playerEl) {
    if (!playerEl) return;
    console.log("Love Sync: Activating Cinema Mode for player:", playerEl);
    this.playerEl = playerEl;
    this.active = true;

    // 1. Walk up to section/container boundary
    const section = findPlayerSection(playerEl);
    this.sectionEl = section;
    
    // 2. Hide all siblings up the tree
    hideSiblings(section, this.originalStyles);

    // 3. Clean native website control bars nested inside or near section
    cleanNativeControlsFromSection(section, this.originalStyles);
    
    // 4. Maximize the section container to full screen
    maximizeElement(section, this.originalStyles);

    // 5. Ensure all video elements inside section stretch to 100% width/height with current aspect mode
    const videos = section.querySelectorAll ? section.querySelectorAll("video") : (playerEl.tagName === "VIDEO" ? [playerEl] : []);
    videos.forEach(v => {
      if (!this.originalStyles.has(v)) {
        this.originalStyles.set(v, v.style.cssText);
      }
      v.style.setProperty("width", "100%", "important");
      v.style.setProperty("height", "100%", "important");
      v.style.setProperty("max-height", "100vh", "important");
      v.style.setProperty("max-width", "100vw", "important");
      v.style.setProperty("object-fit", currentAspectMode || "cover", "important");
    });
    
    // 6. Save and lock body
    if (!this.originalStyles.has(document.body)) {
      this.originalStyles.set(document.body, document.body.style.cssText);
    }
    document.body.style.setProperty("overflow", "hidden", "important");
    document.body.style.setProperty("background", "black", "important");

    if (!this.originalStyles.has(document.documentElement)) {
      this.originalStyles.set(document.documentElement, document.documentElement.style.cssText);
    }
    document.documentElement.style.setProperty("overflow", "hidden", "important");

    // 7. Post controls to parent and set global active state
    postControlsToParent();
    document.documentElement.setAttribute("data-love-sync-cinema", "active");
  },

  deactivate() {
    console.log("Love Sync: Deactivating Cinema Mode.");
    
    // Restore original CSS styles
    this.originalStyles.forEach((original, el) => {
      if (el) el.style.cssText = original;
    });
    this.originalStyles.clear();

    if (this.playerEl) {
      this.playerEl.removeAttribute("data-love-sync-player");
      this.playerEl = null;
    }
    if (this.sectionEl) {
      this.sectionEl.removeAttribute("data-love-sync-player");
      this.sectionEl = null;
    }

    document.documentElement.removeAttribute("data-love-sync-cinema");
    this.active = false;
  },

  // Post detected controls to parent window (client page) instead of building a DOM panel
  showControlsPanel() {
    postControlsToParent();
  },
};

// --- Detected controls cache for click commands ---
let lastDetectedControls = { servers: [], languages: [], episodes: [], quality: [] };

function postControlsToParent() {
  try {
    const controls = {
      servers: findServers().map((s, i) => ({ label: s.label, active: s.active, index: i })),
      languages: findSubDub().map((s, i) => ({ label: s.label, active: s.active, index: i })),
      episodes: findEpisodes().map((s, i) => ({ label: s.label, active: s.active, index: i })),
      quality: findQuality().map((s, i) => ({ label: s.label, active: s.active, index: i })),
    };
    // Cache the raw elements for click commands
    lastDetectedControls = {
      servers: findServers(),
      languages: findSubDub(),
      episodes: findEpisodes(),
      quality: findQuality(),
    };
    // Send to parent window (the cinema hall page)
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: "LOVE_SYNC_CONTROLS_DATA", controls }, "*");
    }
  } catch (e) {
    // Cross-origin or other error — silently ignore
  }
}

// Listen for click commands from the parent window (client)
window.addEventListener("message", (event) => {
  if (!event.data || event.data.type !== "LOVE_SYNC_CLICK_CONTROL") return;
  const { category, index } = event.data;
  const items = lastDetectedControls[category];
  if (!items || !items[index]) return;

  const item = items[index];
  console.log(`Love Sync: Received click command for ${category}[${index}]: "${item.label}"`);

  isRespondingToPartner = true;
  item.el.click();

  const upperLabel = item.label.toUpperCase();
  if (upperLabel === "SUB" || upperLabel === "DUB") {
    safeSendMessage({
      type: "VIDEO_EVENT",
      action: "switch_language",
      language: upperLabel.toLowerCase(),
      time: 0
    });
  }

  setTimeout(() => { isRespondingToPartner = false; }, 1500);

  // Re-scan and re-post after the click takes effect
  setTimeout(() => {
    if (cinemaMode.active) {
      const currentVideo = findMainPlayer();
      if (currentVideo) {
        const section = findPlayerSection(currentVideo);
        maximizeElement(section, cinemaMode.originalStyles);
      }
    }
    postControlsToParent();
  }, 1500);
});

let currentAspectMode = "cover";

// Listen for aspect ratio change requests from parent window
window.addEventListener("message", (event) => {
  if (!event.data) return;
  if (event.data.type === "LOVE_SYNC_SET_ASPECT_RATIO") {
    currentAspectMode = event.data.mode || "cover";
    console.log("Love Sync: Aspect mode changed to:", currentAspectMode);
    
    const target = cinemaMode.sectionEl || cinemaMode.playerEl || document;
    const videos = target.querySelectorAll ? target.querySelectorAll("video") : document.querySelectorAll("video");
    videos.forEach(v => {
      v.style.setProperty("object-fit", currentAspectMode, "important");
      v.style.setProperty("width", "100%", "important");
      v.style.setProperty("height", "100%", "important");
    });
  }
});

// Listen for rescan requests from the parent window
window.addEventListener("message", (event) => {
  if (!event.data || event.data.type !== "LOVE_SYNC_RESCAN_CONTROLS") return;
  postControlsToParent();
});

// Toggle pill and remove functions are no-ops — UI is now in the client
function injectTogglePill() { /* no-op: UI moved to client */ }
function removeTogglePill() { /* no-op: UI moved to client */ }

// --- SECTION 6: Video Sync ---
let isRespondingToPartner = false;
const seenVideos = new WeakSet();

function getMainVideoElement() {
  const p = findMainPlayer();
  if (p && p.tagName === "VIDEO") return p;
  if (p && p.querySelector) {
    const v = p.querySelector("video");
    if (v) return v;
  }
  return document.querySelector("video");
}

function switchLanguageOnPage(targetLang) {
  if (!targetLang) return;
  const subDubItems = findSubDub();
  const target = targetLang.toUpperCase();
  const item = subDubItems.find(i => {
    const lbl = i.label.toUpperCase();
    if (target === "SUB" && (lbl === "SUB" || lbl === "SUBBED" || lbl === "JAPANESE")) return true;
    if (target === "DUB" && (lbl === "DUB" || lbl === "DUBBED" || lbl === "ENGLISH")) return true;
    return lbl.includes(target);
  });
  if (item && item.el) {
    console.log(`Love Sync: Switching language on page to "${target}" via`, item.el);
    isRespondingToPartner = true;
    item.el.click();
    setTimeout(() => { isRespondingToPartner = false; }, 1500);
  }
}

function setupVideoListeners(video) {
  video.addEventListener("play", () => {
    if (!isExtensionEnabled || !isVideoSyncEnabled || isRespondingToPartner) return;
    if (video !== getMainVideoElement()) return;

    if (
      lastReceivedPlayPauseAction === "play" &&
      Date.now() - lastReceivedPlayPauseTimestamp < 3000
    ) {
      console.log("Love Sync: Ignored bounce-back play event");
      return;
    }

    safeSendMessage({
      type: "VIDEO_EVENT",
      action: "play",
      time: video.currentTime,
    });
  });

  video.addEventListener("pause", () => {
    if (!isExtensionEnabled || !isVideoSyncEnabled || isRespondingToPartner) return;
    if (video !== getMainVideoElement()) return;

    if (
      lastReceivedPlayPauseAction === "pause" &&
      Date.now() - lastReceivedPlayPauseTimestamp < 3000
    ) {
      console.log("Love Sync: Ignored bounce-back pause event");
      return;
    }

    safeSendMessage({
      type: "VIDEO_EVENT",
      action: "pause",
      time: video.currentTime,
    });
  });

  video.addEventListener("seeked", () => {
    if (!isExtensionEnabled || !isVideoSyncEnabled || isRespondingToPartner) return;
    if (video !== getMainVideoElement()) return;

    const timeDiff = Math.abs(video.currentTime - lastReceivedSeekTime);
    const timeSinceReceived = Date.now() - lastReceivedSeekTimestamp;
    if (lastReceivedSeekTime !== null && timeDiff < 2.0 && timeSinceReceived < 3500) {
      console.log("Love Sync: Ignored bounce-back seek event. diff:", timeDiff, "ms since:", timeSinceReceived);
      return;
    }

    safeSendMessage({
      type: "VIDEO_EVENT",
      action: "seek",
      time: video.currentTime,
    });
  });
}

function scanForVideos() {
  if (!isCinemaHallPage || !isExtensionEnabled || !isVideoSyncEnabled) return;
  const videos = document.querySelectorAll("video");
  videos.forEach((video) => {
    if (!seenVideos.has(video)) {
      seenVideos.add(video);
      setupVideoListeners(video);
      console.log("Love Sync: Hooked HTML5 video element successfully");
    }
  });
}

// --- SECTION 7: Message Handlers ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isExtensionEnabled) return;

  if (message.type === "PARTNER_COUNTDOWN") {
    showCountdownOverlay();
    sendResponse({ success: true });
    return true;
  }

  if (message.type === "DO_SWITCH_SERVER") {
    // Attempt dynamic server click
    const servers = findServers();
    const target = (message.server || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const found = servers.find(s => s.label.toLowerCase().replace(/[^a-z0-9]/g, "").includes(target));
    if (found) {
      isRespondingToPartner = true;
      found.el.click();
      setTimeout(() => { isRespondingToPartner = false; }, 1500);
    }
    sendResponse({ success: true });
    return true;
  }

  if (message.type === "PARTNER_VIDEO_EVENT") {
    if (message.action === "switch_language") {
      switchLanguageOnPage(message.language);
      sendResponse({ success: true });
      return true;
    }

    const mainVideo = getMainVideoElement();
    if (!mainVideo) return;

    isRespondingToPartner = true;

    if (message.action === "seek" || Math.abs(mainVideo.currentTime - message.time) > 1.5) {
      lastReceivedSeekTime = message.time;
      lastReceivedSeekTimestamp = Date.now();
    }

    if (message.action === "play" || message.action === "pause") {
      lastReceivedPlayPauseAction = message.action;
      lastReceivedPlayPauseTimestamp = Date.now();
    }

    if (message.action === "play") {
      if (Math.abs(mainVideo.currentTime - message.time) > 1.5) {
        mainVideo.currentTime = message.time;
      }
      mainVideo.play().catch(() => {});
    } else if (message.action === "pause") {
      mainVideo.pause();
      if (Math.abs(mainVideo.currentTime - message.time) > 1.5) {
        mainVideo.currentTime = message.time;
      }
    } else if (message.action === "seek") {
      mainVideo.currentTime = message.time;
    }

    setTimeout(() => {
      isRespondingToPartner = false;
    }, 800);

    sendResponse({ success: true });
    return true;
  }
});

// --- SECTION 8: UI Overlays ---
function showCountdownOverlay() {
  const existing = document.getElementById("love-sync-countdown");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "love-sync-countdown";
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.backgroundColor = "rgba(0, 0, 0, 0.75)";
  overlay.style.backdropFilter = "blur(8px)";
  overlay.style.zIndex = "9999999";
  overlay.style.display = "flex";
  overlay.style.flexDirection = "column";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.style.color = "#f59e0b";
  overlay.style.fontFamily = "sans-serif";
  overlay.style.pointerEvents = "none";

  const numEl = document.createElement("div");
  numEl.style.fontSize = "120px";
  numEl.style.fontWeight = "900";
  numEl.style.textShadow = "0 4px 20px rgba(245, 158, 11, 0.4)";
  overlay.appendChild(numEl);

  const textEl = document.createElement("div");
  textEl.style.fontSize = "16px";
  textEl.style.fontWeight = "bold";
  textEl.style.color = "#e4e4e7";
  textEl.style.textTransform = "uppercase";
  textEl.style.letterSpacing = "2px";
  textEl.style.marginTop = "20px";
  textEl.textContent = "Get ready to watch...";
  overlay.appendChild(textEl);

  document.body.appendChild(overlay);

  let count = 5;
  numEl.textContent = count;

  const interval = setInterval(() => {
    count--;
    if (count > 0) {
      numEl.textContent = count;
    } else if (count === 0) {
      numEl.textContent = "PLAY! 🍿";
      textEl.textContent = "Enjoy the movie!";
      
      const mainVideo = getMainVideoElement();
      if (mainVideo) {
        isRespondingToPartner = true;
        mainVideo.play().catch(() => {});
        setTimeout(() => {
          isRespondingToPartner = false;
        }, 500);
      }
    } else {
      clearInterval(interval);
      overlay.remove();
    }
  }, 1000);
}

function checkForTrailers() {
  if (!isCinemaHallPage || !isExtensionEnabled) return;
  if (window.location.host.includes("cineby") || window.location.host.includes("miruro")) {
    return;
  }

  const bodyText = document.body.innerText || "";
  const hasTrailerIndicator = 
    bodyText.includes("Background Trailer") || 
    bodyText.includes("Trailer Playing") || 
    bodyText.includes("Playing Trailer");

  if (hasTrailerIndicator) {
    const videos = document.querySelectorAll("video");
    videos.forEach((video) => {
      try {
        video.pause();
      } catch (e) {}
      video.style.display = "none";
      video.style.opacity = "0";
      video.style.pointerEvents = "none";
    });

    const playerHolders = document.querySelectorAll("#player, .player-container, #player-holder, .watching-player, #iframe-embed");
    playerHolders.forEach((holder) => {
      holder.style.display = "none";
    });

    let overlay = document.getElementById("love-sync-trailer-blocked");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "love-sync-trailer-blocked";
      overlay.style.cssText = `
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        background: #05050f !important;
        display: flex !important;
        flex-direction: column !important;
        align-items: center !important;
        justify-content: center !important;
        text-align: center !important;
        color: #F0EAF4 !important;
        font-family: system-ui, -apple-system, sans-serif !important;
        z-index: 99999999 !important;
        padding: 20px !important;
        box-sizing: border-box !important;
      `;
      
      overlay.innerHTML = `
        <div style="max-width: 400px; padding: 30px; border-radius: 24px; background: rgba(255,255,255,0.01); border: 1px solid rgba(232,88,122,0.15); box-shadow: 0 12px 40px 0 rgba(232,88,122,0.12); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);">
          <div style="font-size: 48px; margin-bottom: 24px; display: inline-block; animation: pulse-scale 2s infinite ease-in-out;">🎬</div>
          <h3 style="margin: 0 0 12px 0; font-size: 20px; font-weight: 800; color: #FFF; font-family: serif; letter-spacing: 0.5px;">Trailer Blocked</h3>
          <p style="margin: 0 0 24px 0; font-size: 13px; color: #94a3b8; line-height: 1.6; font-weight: 500;">
            This server is currently only hosting the trailer. Please select a different source (like <strong>1HD</strong> or <strong>VidSrc</strong>) from the controls bar to play the full movie.
          </p>
          <div style="font-size: 10px; font-weight: 700; color: #E8587A; text-transform: uppercase; letter-spacing: 1px; border: 1px dashed rgba(232,88,122,0.3); padding: 8px 16px; border-radius: 10px; display: inline-block; background: rgba(232,88,122,0.05);">
            Select Another Source
          </div>
        </div>
        <style>
          @keyframes pulse-scale {
            0% { transform: scale(1); opacity: 0.8; }
            50% { transform: scale(1.08); opacity: 1; }
            100% { transform: scale(1); opacity: 0.8; }
          }
        </style>
      `;
      document.documentElement.appendChild(overlay);
    }
  } else {
    const overlay = document.getElementById("love-sync-trailer-blocked");
    if (overlay) overlay.remove();
  }
}

// --- SECTION 9: Credential & Sync ---
const syncCredentials = () => {
  const token = localStorage.getItem("home-token");
  const userStr = localStorage.getItem("home-user");
  const serverUrl = document.body.getAttribute("data-socket-url") || localStorage.getItem("home-socket-url");
  if (token && userStr) {
    try {
      const user = JSON.parse(userStr);
      if (user.relationshipId) {
        safeSendMessage({
          type: "AUTO_SYNC_CREDENTIALS",
          token: token,
          relationshipId: user.relationshipId,
          serverUrl: serverUrl || undefined,
        });
      }
    } catch (e) {
      console.warn("Love Sync: Failed to parse user credentials", e);
    }
  }
};

function syncExtensionConfig() {
  safeSendMessage({ type: "GET_CONNECTION_STATUS" }, (response) => {
    if (response && response.config) {
      isCinemaHallPage = response.isCinemaHall === true;
      isExtensionEnabled = response.config.extensionEnabled !== false;
      isUrlSyncEnabled = response.config.urlSyncEnabled !== false;
      isVideoSyncEnabled = response.config.videoSyncEnabled !== false;

      if (isAppDomain) {
        if (isCinemaHallPage && isExtensionEnabled) {
          document.body.setAttribute("data-love-sync-extension-active", "true");
        } else {
          document.body.removeAttribute("data-love-sync-extension-active");
        }
      }

      if (!isCinemaHallPage || !isExtensionEnabled) {
        if (cinemaMode.active) {
          cinemaMode.deactivate();
        }
        removeTogglePill();
        return;
      }

      // Auto-maximize if in player page / watch route / nested iframe inside room
      const isWatch = window.location.pathname.includes("/watch") || isPlayerDomain || window !== window.top;
      if (isWatch) {
        injectTogglePill();
        
        if (!cinemaMode.active) {
          setTimeout(() => {
            const player = findMainPlayer();
            if (player) {
              cinemaMode.activate(player);
            }
          }, 1200);
        }
      } else {
        removeTogglePill();
      }

      startIntervals();
    }
  });
}

function startIntervals() {
  if (isIntervalsStarted) return;
  isIntervalsStarted = true;

  setInterval(scanForVideos, 1500);
  scanForVideos();

  setInterval(checkForTrailers, 1500);
  checkForTrailers();

  // Periodically post detected controls to the parent window
  setInterval(postControlsToParent, 3000);

  if (!isAppDomain) {
    setInterval(syncExtensionConfig, 2500);
  }
}

// Keyboard shortcuts (Escape key toggle)
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (isCinemaHallPage && isExtensionEnabled) {
      cinemaMode.toggle();
    }
  }
});

// --- SECTION 10: Initialization ---
function init() {
  syncExtensionConfig();

  if (isAppDomain) {
    syncCredentials();
    
    const keepAliveInterval = setInterval(() => {
      syncCredentials();
      syncExtensionConfig();
      
      const success = safeSendMessage({ type: "KEEP_ALIVE" });
      if (!success) {
        clearInterval(keepAliveInterval);
        console.log("Love Sync: Stopped keep-alive loop due to context invalidation.");
      }
    }, 10000);

    setInterval(syncExtensionConfig, 2500);
  }
}

// Run init
init();
