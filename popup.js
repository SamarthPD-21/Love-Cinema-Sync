// popup.js

document.addEventListener("DOMContentLoaded", () => {
  const urlSyncToggle = document.getElementById("urlSyncToggle");
  const videoSyncToggle = document.getElementById("videoSyncToggle");
  const toggleConfigBtn = document.getElementById("toggleConfigBtn");
  const manualConfigForm = document.getElementById("manualConfigForm");

  const serverUrlInput = document.getElementById("serverUrlInput");
  const relIdInput = document.getElementById("relIdInput");
  const tokenInput = document.getElementById("tokenInput");
  const saveConfigBtn = document.getElementById("saveConfigBtn");
  const toastMessage = document.getElementById("toastMessage");

  const statusDot = document.getElementById("statusDot");
  const statusText = document.getElementById("statusText");

  let isConfigExpanded = false;

  // 1. Fetch current connection status & config from service worker
  function updateStatus() {
    chrome.runtime.sendMessage({ type: "GET_CONNECTION_STATUS" }, (response) => {
      if (chrome.runtime.lastError || !response) {
        statusDot.className = "dot disconnected";
        statusText.textContent = "Offline";
        return;
      }

      // Update badge status
      if (response.connected) {
        statusDot.className = "dot connected";
        statusText.textContent = "Synced";
      } else {
        statusDot.className = "dot disconnected";
        statusText.textContent = "Disconnected";
      }

      // Sync checkboxes
      urlSyncToggle.checked = response.config.urlSyncEnabled;
      videoSyncToggle.checked = response.config.videoSyncEnabled;

      // Populate config inputs
      serverUrlInput.value = response.config.serverUrl || "http://localhost:5000";
      relIdInput.value = response.config.relationshipId || "";
      tokenInput.value = response.config.token || "";
    });
  }

  updateStatus();
  // Poll connection status every 2 seconds while popup is open
  const statusPoller = setInterval(updateStatus, 2000);

  // 2. Slider Toggle Handlers
  urlSyncToggle.addEventListener("change", () => {
    chrome.runtime.sendMessage({
      type: "UPDATE_CONFIG",
      config: { urlSyncEnabled: urlSyncToggle.checked },
    });
  });

  videoSyncToggle.addEventListener("change", () => {
    chrome.runtime.sendMessage({
      type: "UPDATE_CONFIG",
      config: { videoSyncEnabled: videoSyncToggle.checked },
    });
  });

  // 3. Manual Config toggle expand button
  toggleConfigBtn.addEventListener("click", () => {
    isConfigExpanded = !isConfigExpanded;
    if (isConfigExpanded) {
      manualConfigForm.classList.remove("hidden");
      toggleConfigBtn.textContent = "🔧 Hide Manual Config";
    } else {
      manualConfigForm.classList.add("hidden");
      toggleConfigBtn.textContent = "🔧 Show Manual Config";
    }
  });

  // 4. Save Button handler
  saveConfigBtn.addEventListener("click", () => {
    const serverUrl = serverUrlInput.value.trim() || "http://localhost:5000";
    const relationshipId = relIdInput.value.trim();
    const token = tokenInput.value.trim();

    chrome.runtime.sendMessage(
      {
        type: "UPDATE_CONFIG",
        config: { serverUrl, relationshipId, token },
      },
      () => {
        // Show saved success toast
        toastMessage.classList.remove("hidden");
        setTimeout(() => {
          toastMessage.classList.add("hidden");
        }, 2000);
        updateStatus();
      }
    );
  });

  // Clean up poller when popup is closed
  window.addEventListener("unload", () => {
    clearInterval(statusPoller);
  });
});
