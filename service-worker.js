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

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "AUTO_SYNC_CREDENTIALS") {
    const { token, relationshipId } = message;
    if (token && relationshipId) {
      let needsConnect = false;
      if (token !== config.token || relationshipId !== config.relationshipId) {
        config.token = token;
        config.relationshipId = relationshipId;
        chrome.storage.local.set({ token, relationshipId });
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

  // Forward video elements events to partner
  if (
    message.type === "VIDEO_EVENT" &&
    config.videoSyncEnabled &&
    socket &&
    socket.connected
  ) {
    socket.emit("extension_video_control", {
      action: message.action,
      time: message.time,
    });
    sendResponse({ success: true });
    return true;
  }

  // Forward tab url changes to partner
  if (
    message.type === "URL_EVENT" &&
    config.urlSyncEnabled &&
    socket &&
    socket.connected
  ) {
    socket.emit("extension_url_change", {
      url: message.url,
    });
    sendResponse({ success: true });
    return true;
  }
});

// Track URL updates to notify partner when active tab URL changes on streaming sites
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (
    config.urlSyncEnabled &&
    changeInfo.status === "complete" &&
    tab.active &&
    socket &&
    socket.connected
  ) {
    // Avoid circular triggers and client dashboard URLs
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
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });

    socket.on("connect", () => {
      console.log("Connected to Love server via extension");
      socket.emit("join_cinema", { relationshipId: config.relationshipId });
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
