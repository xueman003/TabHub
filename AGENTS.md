# AGENTS.md -- TabHub

TabHub is a local Chrome extension for personal tab management.

## Product Summary

TabHub does not replace the new tab page. Users open it by clicking the Chrome extension icon. It provides a dashboard for open tabs, saved links, frequent links, quick links, and saved sessions.

## Core Features

- Open tab dashboard grouped by domain or by window.
- Click a tab title to focus that tab.
- Close a single tab, a whole group, or duplicate tabs.
- Save links to "稍后阅读".
- Move or drag links into "近期常用".
- Save and restore tab sessions.
- Manage custom quick links.
- Chinese UI optimized for personal daily use.
- Local-only storage via `chrome.storage.local`.

## Install

1. Open Chrome and go to `chrome://extensions`.
2. Enable Developer mode.
3. Click "Load unpacked".
4. Select the `extension/` folder in this repository.
5. Click the TabHub extension icon to open the dashboard.

## Development Notes

- This is a pure Chrome Manifest V3 extension.
- There is no npm install step and no build step.
- `extension/index.html` is the real extension page.
- `extension/preview.html` is only a static preview page.
- Do not commit `.dbg/`, local debug logs, or `extension/config.local.js`.

## Attribution

TabHub is based on the MIT-licensed Tab Out project and has been modified for a different product flow and personal-use feature set.
