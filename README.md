# Request Inspector

A Manifest V3 Chrome Extension for inspecting, toggling, and modifying the current tab's URL path and query parameters — with a live preview and one-click reload.

## Features

- **Path editor** — modify the URL pathname directly
- **Query parameter table** — toggle, edit key/value, or delete individual params
- **Live preview** — colour-coded URL updates in real time; disabled params are excluded automatically
- **Apply & Reload** — navigates the active tab to the newly constructed URL

## Installation (Developer Mode)

1. Clone or download this repository.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked**.
5. Select the root folder of this repository (the one containing `manifest.json`).
6. The extension icon will appear in the Chrome toolbar. Pin it for easy access.

## Usage

1. Navigate to any webpage with query parameters (e.g. a search results page).
2. Click the Request Inspector toolbar icon.
3. Edit the path, toggle or modify individual query parameters, or add new ones.
4. Watch the **New URL** preview update live.
5. Click **Apply & Reload** to navigate the tab to the new URL.
6. Use **Reset** to restore the original URL state.

## License

MIT License — Copyright (c) 2026 Corey. See [LICENSE](LICENSE) for full text.
