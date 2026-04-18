# Auto Tabs

Auto Tabs is a Chrome Manifest V3 extension that keeps your open tabs under a configurable limit. When a new tab pushes the count over the limit, the extension closes the oldest eligible tab.

## Features

- Set a maximum tab count. The default is `12`.
- Starts paused by default, so it will not close tabs until you enable it.
- Protect pinned tabs by default. Pinned tabs are not counted and will not be closed automatically.
- Tracks tab creation time and closes the oldest eligible tab first.

## Local Installation

1. Open `chrome://extensions`.
2. Enable Developer mode in the top-right corner.
3. Click "Load unpacked".
4. Select this directory: `~/Downloads/auto-tabs`.
5. Click the Auto Tabs icon in the Chrome toolbar and set your maximum tab count.

## Notes

Chrome does not expose the exact creation time for already-open tabs. On install or browser startup, Auto Tabs estimates the age of existing tabs from their tab ID order. Tabs opened after that are tracked with an accurate creation timestamp.
