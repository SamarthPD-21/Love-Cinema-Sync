# 🔌 Love Cinema Sync — Browser Extension

<div align="center">

![Manifest V3](https://img.shields.io/badge/Manifest-V3-brightgreen?style=for-the-badge&logo=google-chrome&logoColor=white)
![Platform](https://img.shields.io/badge/Platform-Chrome%20%7C%20Brave-blue?style=for-the-badge&logo=google-chrome&logoColor=white)
![Socket.io](https://img.shields.io/badge/Socket.io-v4.x-010101?style=for-the-badge&logo=socket.io&logoColor=white)

The official browser extension for the **Cozy Cinema Hall** room. Seamlessly handles frame-headers bypassing, styles maximization, and real-time playback synchronization.

</div>

---

## ✨ Core Features

* **🛡️ CSP & X-Frame Header Bypass**: Intercepts `sub_frame` navigation requests to strip restrictive `Content-Security-Policy` and `X-Frame-Options` headers, allowing video streams to embed cleanly in the Next.js iframe.
* **🎥 Player Auto-Maximize Injection**: Injects optimized stylesheets into video player domains (1HD, RabbitStream, Megacloud, etc.) to crop out headers, comments, sidebars, and ads, rendering a pure edge-to-edge full-viewport player.
* **⚡ Dual Room Synchronization**: Seamlessly listens to HTML5 video play, pause, seek, and server switch actions on both `/lounge` and `/cinema` room tabs and forwards them to your partner.
* **⏳ Sync Play Countdowns**: Automatically triggers a synchronized 5-second countdown overlay with blurry backdrop glass effects when co-play is initiated.

---

## 📂 File Architecture

* **`manifest.json`**: Standard Manifest V3 config defining tab permissions, scripting overrides, dynamic net rules, and split-incognito mode.
* **`content.js`**: Injected directly into movie player pages and iframes. Injects CSS overrides to maximize the viewport and monitors HTML5 video controls.
* **`service-worker.js`**: The background worker that maintains the WebSocket connection to the server and handles multi-tab message passing.
* **`rules.json`**: Dynamic Declarative Net Request rules targeting X-Frame header headers.

---

## ⚙️ Installation & Setup

### 📥 1. Download or Clone the Repository
Clone the repository folder:
```bash
git clone https://github.com/SamarthPD-21/Love-Cinema-Sync.git
```
*(Or download the folder structure directly)*

### 🔌 2. Load the Unpacked Extension
1. Open Chrome or Brave and navigate to **`chrome://extensions/`**.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click the **"Load unpacked"** button in the top-left corner.
4. Select the `extension/` directory.

### 🔑 3. Configure Incognito Mode (Critical)
To test co-watching on a single machine side-by-side:
1. Click **"Details"** on the loaded **Love Cinema Sync** card.
2. Scroll down and enable **"Allow in incognito"** / **"Allow in private"**.
3. *This is required so the extension can listen and synchronise play commands on your private browser window!*

---

## 🎨 Popup Control Panel

Clicking the extension icon in your browser toolbar reveals a custom settings popup dashboard where you can:
* Toggle the extension sync on/off globally.
* Individually enable/disable **URL Syncing** or **Video Control Syncing**.
* Monitor connection sync statuses:
  - 🟢 **Synced** (Connected & active room joined)
  - 🔴 **Disconnected** (Server unreachable)
  - ⚪ **Disabled** (Extension toggled off)
