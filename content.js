// content.js
console.log("Love Cinema Sync extension content script loaded");

// 1. Auto-sync credentials from the client app page (local & production domains)
const isAppDomain =
  window.location.host.includes("localhost") ||
  window.location.host.includes("127.0.0.1") ||
  window.location.host.includes("vercel.app") ||
  window.location.host.includes("onrender.com");

if (isAppDomain) {
  document.body.setAttribute("data-love-sync-extension-active", "true");
  const token = localStorage.getItem("home-token");
  const userStr = localStorage.getItem("home-user");
  const serverUrl = localStorage.getItem("home-socket-url");
  if (token && userStr) {
    try {
      const user = JSON.parse(userStr);
      if (user.relationshipId) {
        chrome.runtime.sendMessage({
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
}

// 1.5. Maximize video player to cover full iframe viewport
const isPlayerDomain = 
  window.location.host.includes("1hd.art") || 
  window.location.host.includes("rabbitstream") || 
  window.location.host.includes("upcloud") || 
  window.location.host.includes("vidcloud") || 
  window.location.host.includes("megacloud") || 
  window.location.host.includes("dokicloud") ||
  window.location.host.includes("cloud") ||
  window.location.host.includes("stream") ||
  window.location.host.includes("play");

if (window !== window.top || isPlayerDomain) {
  const style = document.createElement("style");
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
    header, footer, .sidebar, #header, #footer, .comment-section, .related-movies, .breadcrumbs, .alert-ad, .ad-box, .banner-ad, #sidebar {
      display: none !important;
      visibility: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }
  `;
  document.documentElement.appendChild(style);
  console.log("Love Sync: Applied iframe player maximization styles to frame: " + window.location.host);
}

// 2. Video Sync Logic
let isRespondingToPartner = false;
const seenVideos = new WeakSet();

function setupVideoListeners(video) {
  video.addEventListener("play", () => {
    if (isRespondingToPartner) return;
    chrome.runtime.sendMessage({
      type: "VIDEO_EVENT",
      action: "play",
      time: video.currentTime,
    }).catch(() => {});
  });

  video.addEventListener("pause", () => {
    if (isRespondingToPartner) return;
    chrome.runtime.sendMessage({
      type: "VIDEO_EVENT",
      action: "pause",
      time: video.currentTime,
    }).catch(() => {});
  });

  video.addEventListener("seeked", () => {
    if (isRespondingToPartner) return;
    chrome.runtime.sendMessage({
      type: "VIDEO_EVENT",
      action: "seek",
      time: video.currentTime,
    }).catch(() => {});
  });
}

function scanForVideos() {
  const videos = document.querySelectorAll("video");
  videos.forEach((video) => {
    if (!seenVideos.has(video)) {
      seenVideos.add(video);
      setupVideoListeners(video);
      console.log("Love Sync: Hooked HTML5 video element successfully");
    }
  });
}

// Monitor page for new video elements dynamically
setInterval(scanForVideos, 1500);
scanForVideos();

// Listen for sync events from the service worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "PARTNER_COUNTDOWN") {
    showCountdownOverlay();
    sendResponse({ success: true });
    return true;
  }

  if (message.type === "PARTNER_VIDEO_EVENT") {
    const videos = document.querySelectorAll("video");
    if (videos.length === 0) return;

    videos.forEach((video) => {
      isRespondingToPartner = true;

      if (message.action === "play") {
        if (Math.abs(video.currentTime - message.time) > 1.5) {
          video.currentTime = message.time;
        }
        video.play().catch(() => {});
      } else if (message.action === "pause") {
        video.pause();
        if (Math.abs(video.currentTime - message.time) > 1.5) {
          video.currentTime = message.time;
        }
      } else if (message.action === "seek") {
        video.currentTime = message.time;
      }

      // Settle time buffer block flag
      setTimeout(() => {
        isRespondingToPartner = false;
      }, 600);
    });

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
      
      const videos = document.querySelectorAll("video");
      videos.forEach((video) => {
        isRespondingToPartner = true;
        video.play().catch(() => {});
        setTimeout(() => {
          isRespondingToPartner = false;
        }, 500);
      });
    } else {
      clearInterval(interval);
      overlay.remove();
    }
  }, 1000);
}
