# Love Cinema Sync Extension

This directory contains the Chrome/Brave Extension used to maximize, format, and synchronize HTML5 video playback controls across co-watching cinema rooms.

GitHub Repository: [https://github.com/SamarthPD-21/Love-Cinema-Sync](https://github.com/SamarthPD-21/Love-Cinema-Sync)

## Files

- `manifest.json`: Defines MV3 configurations, permissions, and split incognito mode.
- `content.js`: Injected into movie pages/iframes. Intercepts play, pause, seek events, and injects clean viewport stylesheets.
- `service-worker.js`: Relays event frames in the background via Socket.io channels focus-independently.

## Setup Instructions

### 📥 1. Download or Clone the Extension
If you don't have the source folder locally, clone or download it:
```bash
git clone https://github.com/SamarthPD-21/Love-Cinema-Sync.git
```
*(Or download the ZIP from the GitHub page and extract it).*

### 🔌 2. Load the Extension in Your Browser
1. Open **`chrome://extensions`** in your browser.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click the **"Load unpacked"** button (top-left corner).
4. Select the `extension/` directory (or the folder you extracted/cloned).
5. Click **"Details"** on the loaded card.
6. Enable the toggle for **"Allow in incognito"** / **"Allow in private"** (critical for side-by-side session testing!).
7. Reload your movie lounge tabs (`http://localhost:3000/lounge`).
