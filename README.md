# Love Cinema Sync Extension

This directory contains the Chrome/Brave Extension used to maximize, format, and synchronize HTML5 video playback controls across co-watching cinema rooms.

## Files

- `manifest.json`: Defines MV3 configurations, permissions, and split incognito mode.
- `content.js`: Injected into movie pages/iframes. Intercepts play, pause, seek events, and injects clean viewport stylesheets.
- `service-worker.js`: Relays event frames in the background via Socket.io channels focus-independently.

## Setup Instructions

1. Open **`chrome://extensions`** in your browser.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click the **"Load unpacked"** button (top-left corner).
4. Select the `extension/` directory.
5. Click **"Details"** on the loaded card.
6. Enable **"Allow in incognito"** / **"Allow in private"** (critical for side-by-side session testing!).
