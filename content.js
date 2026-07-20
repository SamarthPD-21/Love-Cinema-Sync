// content.js
console.log("Love Cinema Sync extension content script loaded");

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

// Helper to safely send messages to the extension background script without throwing uncaught context invalidation errors
function safeSendMessage(message, callback) {
  try {
    if (typeof chrome !== "undefined" && chrome?.runtime?.id) {
      chrome.runtime.sendMessage(message, (res) => {
        if (chrome.runtime.lastError) {
          // Extension might be reloading or disabled
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
  
  // Find the video element with the largest area (width * height) that is visible
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

// 1. Auto-sync credentials from the client app page (local & production domains)
const isAppDomain =
  window.location.host.includes("localhost") ||
  window.location.host.includes("127.0.0.1") ||
  window.location.host.includes("vercel.app") ||
  window.location.host.includes("onrender.com");

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

      // Update page active attribute
      if (isAppDomain) {
        if (isCinemaHallPage && response.config.extensionEnabled !== false) {
          document.body.setAttribute("data-love-sync-extension-active", "true");
        } else {
          document.body.removeAttribute("data-love-sync-extension-active");
        }

        // Monitor server select requests
        if (isCinemaHallPage) {
          const currentServer = document.body.getAttribute("data-love-sync-server");
          if (currentServer && currentServer !== lastObservedServer) {
            lastObservedServer = currentServer;
            safeSendMessage({ type: "SWITCH_SERVER", server: currentServer });
          }
        }
      }

      if (!isCinemaHallPage) {
        // Clean up styles if injected
        const existing = document.getElementById("love-sync-iframe-styles");
        if (existing) {
          existing.remove();
          console.log("Love Sync: Removed iframe maximization styles.");
        }
        const trailerBlocked = document.getElementById("love-sync-trailer-blocked");
        if (trailerBlocked) {
          trailerBlocked.remove();
        }
        return;
      }

      isExtensionEnabled = response.config.extensionEnabled !== false;
      isUrlSyncEnabled = response.config.urlSyncEnabled !== false;
      isVideoSyncEnabled = response.config.videoSyncEnabled !== false;

      // Update iframe layout overrides dynamically
      updateIframeStyles();

      // Start background intervals (scanning videos and blocking trailers)
      startIntervals();
    }
  });
}

function startIntervals() {
  if (isIntervalsStarted) return;
  isIntervalsStarted = true;

  // Monitor page for new video elements dynamically
  setInterval(scanForVideos, 1500);
  scanForVideos();

  // Check for trailers periodically
  setInterval(checkForTrailers, 1500);
  checkForTrailers();

  // For iframe players (non-app domains), they need to keep polling config
  if (!isAppDomain) {
    setInterval(syncExtensionConfig, 2500);
  }
}

// 1.5. Maximize video player to cover full iframe viewport (Dynamic CSS Injection)
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

function updateIframeStyles() {
  const existing = document.getElementById("love-sync-iframe-styles");
  
  if (!isCinemaHallPage || !isExtensionEnabled) {
    if (existing) {
      existing.remove();
      console.log("Love Sync: Disabled state detected. Removed iframe maximization styles.");
    }
    return;
  }

  if (window.location.host.includes("cineby")) {
    const existingCineby = document.getElementById("love-sync-iframe-styles");
    if (!existingCineby) {
      const style = document.createElement("style");
      style.id = "love-sync-iframe-styles";
      style.textContent = `
        html, body {
          overflow: hidden !important;
          width: 100% !important;
          height: 100% !important;
          margin: 0 !important;
          padding: 0 !important;
          background: black !important;
        }
        /* Maximize only active player iframes on Cineby (ignoring trailer streams) */
        iframe[src*="vidking"]:not([src*="youtube"]),
        iframe[src*="vidsrc"]:not([src*="youtube"]),
        iframe[src*="embed"]:not([src*="youtube"]):not([src*="vimeo"]),
        iframe[src*="player"]:not([src*="youtube"]):not([src*="vimeo"]),
        .watch-play iframe,
        #player iframe,
        .player-container iframe {
          position: fixed !important;
          top: 0 !important;
          left: 0 !important;
          width: 100vw !important;
          height: 100vh !important;
          z-index: 9999999 !important;
          background: black !important;
          border: none !important;
          margin: 0 !important;
          padding: 0 !important;
        }
        /* Hide page details, sidebar columns, and trailers when movie iframe is streaming */
        body:has(iframe[src*="vidking"]),
        body:has(iframe[src*="vidsrc"]),
        body:has(iframe[src*="embed"]:not([src*="youtube"]):not([src*="vimeo"])) {
          background: black !important;
        }
        body:has(iframe[src*="vidking"]) .movie-info,
        body:has(iframe[src*="vidsrc"]) .movie-info,
        body:has(iframe[src*="embed"]:not([src*="youtube"]):not([src*="vimeo"])) .movie-info,
        body:has(iframe[src*="vidking"]) header,
        body:has(iframe[src*="vidsrc"]) header,
        body:has(iframe[src*="embed"]:not([src*="youtube"]):not([src*="vimeo"])) header,
        body:has(iframe[src*="vidking"]) footer,
        body:has(iframe[src*="vidsrc"]) footer,
        body:has(iframe[src*="embed"]:not([src*="youtube"]):not([src*="vimeo"])) footer,
        body:has(iframe[src*="vidking"]) .sidebar,
        body:has(iframe[src*="vidsrc"]) .sidebar,
        body:has(iframe[src*="embed"]:not([src*="youtube"]):not([src*="vimeo"])) .sidebar {
          display: none !important;
        }
      `;
      document.documentElement.appendChild(style);
      console.log("Love Sync: Injected Cineby-specific movie player maximizer styles.");
    }
    return;
  }

  if (window.location.host.includes("miruro")) {
    const isWatchPage = window.location.pathname.includes("/watch");
    if (!isWatchPage) {
      const existingStyles = document.getElementById("love-sync-iframe-styles");
      if (existingStyles) {
        existingStyles.remove();
        console.log("Love Sync: Non-watch Miruro page detected. Removed styles for episode selection.");
      }
      return;
    }
    const existingMiruro = document.getElementById("love-sync-iframe-styles");
    if (!existingMiruro) {
      const style = document.createElement("style");
      style.id = "love-sync-iframe-styles";
      style.textContent = `
        html, body {
          overflow: hidden !important;
          width: 100% !important;
          height: 100% !important;
          margin: 0 !important;
          padding: 0 !important;
          background: black !important;
        }
        /* Maximize only active player iframes or video elements on Miruro watch page */
        video,
        .artplayer-app,
        .plyr,
        .player-container,
        #player,
        iframe {
          position: fixed !important;
          top: 0 !important;
          left: 0 !important;
          width: 100vw !important;
          height: 100vh !important;
          z-index: 9999999 !important;
          background: black !important;
          border: none !important;
          margin: 0 !important;
          padding: 0 !important;
        }
        /* Hide all page layouts, episode lists, header controls, comments for pure cinematic focus */
        header, footer, nav, .navbar, .header, .footer, .sidebar, .episode-list-container, .related-anime, [class*="Header"], [class*="Footer"], [class*="Sidebar"], [class*="Navbar"] {
          display: none !important;
          visibility: hidden !important;
          opacity: 0 !important;
        }
      `;
      document.documentElement.appendChild(style);
      console.log("Love Sync: Injected Miruro movie player maximizer styles.");
    }
    return;
  }

  if ((window !== window.top || isPlayerDomain) && !existing) {
    const style = document.createElement("style");
    style.id = "love-sync-iframe-styles";
    style.textContent = `
      html, body {
        overflow: hidden !important;
        width: 100% !important;
        height: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
        background: black !important;
      }
      iframe#iframe-embed, 
      .watch-play iframe,
      iframe[src*="embed"], 
      iframe[src*="player"],
      #player,
      .player-container,
      video,
      .jwplayer,
      .vjs-tech,
      #player-holder,
      .watching-player {
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        z-index: 9999999 !important;
        background: black !important;
        border: none !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      header, footer, .sidebar, #header, #footer, .comment-section, .related-movies, .breadcrumbs, .alert-ad, .ad-box, .banner-ad, #sidebar, aside, nav, .menu, .navbar, .navigation, .left-menu, .side-nav, .left-sidebar, .nav-sidebar, [class*="sidebar"], [id*="sidebar"] {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }
    `;
    document.documentElement.appendChild(style);
    console.log("Love Sync: Applied iframe player maximization styles to frame: " + window.location.host);
  }
}

// Initial config check
syncExtensionConfig();

if (isAppDomain) {
  // Sync credentials on load
  syncCredentials();
  
  // Periodic keep-alive ping and credentials sync
  const keepAliveInterval = setInterval(() => {
    syncCredentials();
    syncExtensionConfig();
    
    const success = safeSendMessage({ type: "KEEP_ALIVE" });
    if (!success) {
      clearInterval(keepAliveInterval);
      console.log("Love Sync: Stopped keep-alive loops as the extension context was invalidated.");
    }
  }, 10000); // Check status every 10s for responsive updates

  // Regular status sync checks for the app domain
  setInterval(syncExtensionConfig, 2500);
}

// 2. Video Sync Logic
let isRespondingToPartner = false;
const seenVideos = new WeakSet();

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

// Listen for sync events from the service worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isExtensionEnabled) return;

  if (message.type === "PARTNER_COUNTDOWN") {
    showCountdownOverlay();
    sendResponse({ success: true });
    return true;
  }

  if (message.type === "DO_SWITCH_SERVER") {
    selectServerOnPage(message.server);
    sendResponse({ success: true });
    return true;
  }

  if (message.type === "PARTNER_VIDEO_EVENT") {
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

    // Settle time buffer block flag
    setTimeout(() => {
      isRespondingToPartner = false;
    }, 800);

    sendResponse({ success: true });
    return true;
  }
});

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
  overlay.style.color = "#f59e0b"; // Amber
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

function selectServerOnPage(serverName) {
  if (!serverName) return;
  console.log("Love Sync: Attempting to select server:", serverName);
  
  // 1. Target standard anchors and buttons
  const elements = document.querySelectorAll("a, button, [data-server], .server, .server-item");
  const target = serverName.toLowerCase().replace(/[^a-z0-9]/g, "");
  
  let found = false;
  for (const el of elements) {
    const text = el.textContent.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (text.includes(target)) {
      console.log("Love Sync: Found server element, clicking:", el);
      el.click();
      found = true;
      break;
    }
  }

  if (!found) {
    // Fallback: search leaf nodes of divs/spans
    const leafNodes = document.querySelectorAll("div, span, li");
    for (const el of leafNodes) {
      if (el.children.length === 0) {
        const text = el.textContent.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (text === target || text.includes(target)) {
          console.log("Love Sync: Found leaf server node, clicking:", el);
          el.click();
          found = true;
          break;
        }
      }
    }
  }
}

// 3. Trailer Auto-Block & Notice Overlay (e.g. for Cineby or VidSrc when movie is unavailable)
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
    // 1. Pause and hide any active HTML5 video tags
    const videos = document.querySelectorAll("video");
    videos.forEach((video) => {
      try {
        video.pause();
      } catch (e) {}
      video.style.display = "none";
      video.style.opacity = "0";
      video.style.pointerEvents = "none";
    });

    // 2. Hide common iframe container elements or players if it is a trailer page
    const playerHolders = document.querySelectorAll("#player, .player-container, #player-holder, .watching-player, #iframe-embed");
    playerHolders.forEach((holder) => {
      holder.style.display = "none";
    });

    // 3. Render a beautiful full-screen overlay notifying the user to change sources
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
    // If text goes away (user loads movie or switches page), remove it
    const overlay = document.getElementById("love-sync-trailer-blocked");
    if (overlay) overlay.remove();
  }
}

// Check for trailers periodically
