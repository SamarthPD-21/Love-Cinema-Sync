// service-worker.js
importScripts("libs/socket.io.min.js");

let socket = null;
const config = {
  serverUrl: "http://localhost:5000",
  token: "",
  relationshipId: "",
  urlSyncEnabled: true,
  videoSyncEnabled: true,
};

// Load saved config
chrome.storage.local.get(Object.keys(config), (data) => {
  Object.assign(config, data);
  if (config.token && config.relationshipId) {
    connectSocket();
  }
});

function isAppUrl(url) {
  if (!url) return false;
  return (
    url.includes("localhost") ||
    url.includes("127.0.0.1") ||
    url.includes("vercel.app") ||
    url.includes("onrender.com")
  );
}

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "KEEP_ALIVE") {
    if (config.token && config.relationshipId && (!socket || !socket.connected)) {
      console.log("Extension Keepalive: Socket is disconnected, triggering automatic reconnection...");
      connectSocket();
    }
    sendResponse({ success: true, connected: socket ? socket.connected : false });
    return true;
  }

  if (message.type === "AUTO_SYNC_CREDENTIALS") {
    const { token, relationshipId, serverUrl } = message;
    if (token && relationshipId) {
      let needsConnect = false;
      const targetServerUrl = serverUrl || config.serverUrl;
      if (
        token !== config.token ||
        relationshipId !== config.relationshipId ||
        targetServerUrl !== config.serverUrl
      ) {
        config.token = token;
        config.relationshipId = relationshipId;
        config.serverUrl = targetServerUrl;
        chrome.storage.local.set({ token, relationshipId, serverUrl: targetServerUrl });
        needsConnect = true;
      }
      if (!socket || !socket.connected) {
        needsConnect = true;
      }
      if (needsConnect) {
        connectSocket();
      }
    }
    sendResponse({ success: true });
    return true;
  }

  if (message.type === "UPDATE_CONFIG") {
    Object.assign(config, message.config);
    chrome.storage.local.set(message.config, () => {
      if (message.config.token || message.config.serverUrl) {
        connectSocket();
      }
    });
    sendResponse({ success: true });
    return true;
  }

  if (message.type === "GET_CONNECTION_STATUS") {
    sendResponse({
      connected: socket ? socket.connected : false,
      config,
    });
    return true;
  }

  // Forward video elements events to partner (only from app tab)
  if (
    message.type === "VIDEO_EVENT" &&
    config.videoSyncEnabled &&
    socket &&
    socket.connected &&
    sender.tab &&
    isAppUrl(sender.tab.url)
  ) {
    socket.emit("extension_video_control", {
      action: message.action,
      time: message.time,
    });
    sendResponse({ success: true });
    return true;
  }

  // Forward tab url changes to partner (only from app tab)
  if (
    message.type === "URL_EVENT" &&
    config.urlSyncEnabled &&
    socket &&
    socket.connected &&
    sender.tab &&
    isAppUrl(sender.tab.url)
  ) {
    socket.emit("extension_url_change", {
      url: message.url,
    });
    sendResponse({ success: true });
    return true;
  }
});

// Track URL updates to notify partner when active tab URL changes on streaming sites (only for app tab)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (
    config.urlSyncEnabled &&
    changeInfo.status === "complete" &&
    tab.active &&
    socket &&
    socket.connected &&
    isAppUrl(tab.url)
  ) {
    const urlStr = tab.url || "";
    if (
      urlStr &&
      !urlStr.includes("localhost:") &&
      !urlStr.includes("127.0.0.1:") &&
      !urlStr.startsWith("chrome://")
    ) {
      socket.emit("extension_url_change", { url: urlStr });
    }
  }
});

function connectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }

  try {
    socket = io(config.serverUrl, {
      auth: { token: config.token },
      transports: ["polling", "websocket"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });

    socket.on("connect", () => {
      console.log("Connected to Love server via extension");
      socket.emit("join_cinema", { relationshipId: config.relationshipId });
    });

    socket.on("cinema_resolve_link_request", async (data) => {
      console.log("Extension received resolve request for:", data);
      const searchUrl = `https://1hd.art/search?keyword=${encodeURIComponent(data.title)}`;
      
      try {
        const res = await fetch(searchUrl);
        if (!res.ok) throw new Error("Status: " + res.status);
        const html = await res.text();
        
        // Parse search results using regex
        const items = html.split('<div class="item-film">').slice(1);
        const results = [];
        const linkRegex = /<a href="([^"]+)" title="([^"]+)"/;
        const typeRegex = /<span class="item">([^<]+)<\/span>/;

        items.forEach((item) => {
          const linkMatch = linkRegex.exec(item);
          const typeMatch = typeRegex.exec(item);
          if (linkMatch) {
            results.push({
              href: linkMatch[1],
              title: linkMatch[2],
              type: typeMatch ? typeMatch[1].trim() : ''
            });
          }
        });

        if (results.length === 0) {
          console.log("Extension: No results found for:", data.title);
          return;
        }

        // Matching logic
        const targetType = data.type === "movie" ? "movie" : "tv";
        const normalize = (t) => t.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
        const normalizedTarget = normalize(data.title);

        let bestMatch = results.find((r) => {
          const typeOk = r.type.toLowerCase().includes(targetType);
          const titleOk = normalize(r.title) === normalizedTarget;
          return typeOk && titleOk;
        });

        if (!bestMatch) {
          bestMatch = results.find((r) => normalize(r.title) === normalizedTarget);
        }
        if (!bestMatch) {
          bestMatch = results.find((r) => r.type.toLowerCase().includes(targetType));
        }
        if (!bestMatch) {
          bestMatch = results[0];
        }

        console.log("Extension: Resolved link:", bestMatch.href);
        
        // Emit response back to server
        socket.emit("cinema_resolve_link_response", {
          movieId: data.movieId,
          watchLink: bestMatch.href,
        });

      } catch (err) {
        console.error("Extension: Failed to resolve search link:", err);
      }
    });

    socket.on("disconnect", () => {
      console.log("Disconnected from Love server");
    });

    socket.on("cinema_countdown_trigger", async () => {
      const tabs = await chrome.tabs.query({});
      tabs.forEach((tab) => {
        const url = tab.url || "";
        if (url.includes("/lounge")) {
          chrome.webNavigation.getAllFrames({ tabId: tab.id }, (frames) => {
            if (frames) {
              frames.forEach((frame) => {
                chrome.tabs.sendMessage(tab.id, {
                  type: "PARTNER_COUNTDOWN",
                }, { frameId: frame.frameId }).catch(() => {});
              });
            }
          });
        }
      });
    });

    socket.on("extension_url_changed", async (data) => {
      if (!config.urlSyncEnabled) return;
      
      const tabs = await chrome.tabs.query({});
      tabs.forEach(async (tab) => {
        const url = tab.url || "";
        if (url.includes("/lounge") && tab.url !== data.url) {
          await chrome.tabs.update(tab.id, { url: data.url });
        }
      });
    });

    socket.on("extension_video_controlled", async (data) => {
      if (!config.videoSyncEnabled) return;

      const tabs = await chrome.tabs.query({});
      tabs.forEach((tab) => {
        const url = tab.url || "";
        if (url.includes("/lounge")) {
          chrome.webNavigation.getAllFrames({ tabId: tab.id }, (frames) => {
            if (frames) {
              frames.forEach((frame) => {
                chrome.tabs.sendMessage(tab.id, {
                  type: "PARTNER_VIDEO_EVENT",
                  action: data.action,
                  time: data.time,
                }, { frameId: frame.frameId }).catch(() => {});
              });
            }
          });
        }
      });
    });
  } catch (err) {
    console.error("Connection failed:", err);
  }
}
