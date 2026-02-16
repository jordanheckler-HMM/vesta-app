# Vesta Desktop Quick Start

## Run in development

```bash
cd vesta-frontend
npm run tauri:dev
```

What starts:
- Vite frontend on `http://localhost:8081`
- FastAPI backend on `http://localhost:8090`
- Tauri desktop app shell

## Build release app

```bash
cd vesta-frontend
npm run tauri:build
```

Output app:
- `vesta-frontend/src-tauri/target/release/bundle/macos/Vesta.app`

## Menu bar and close behavior

- Closing the main window hides it instead of quitting.
- Vesta stays active in the menu bar.
- Clicking the menu bar icon opens a mini chat window.
- Mini chat auto-hides when it loses focus.
- Full quit only happens with tray menu `Quit Vesta` or `Cmd+Q`.

## Main vs mini behavior

- Main window:
  - Persistent saved chats in left sidebar
  - Folder/project organization
  - Tabs: `Chat`, `Files`, `Weather`, `Settings` (Weather shown only when OpenWeather is configured)
  - `New chat` action creates a saved conversation
- Mini window:
  - Compact scratch chat for quick prompts
  - Session-only state (not written to saved sidebar history)

## Saved chats and folders

- Chats are stored in local SQLite.
- Chat actions: create, select, rename, delete, move between folder/uncategorized.
- Folder actions: create, rename, delete.
- Folder delete is destructive and cascades:
  - folder chats
  - folder documents/chunks

## Files tab (persistent local knowledge)

- Main window includes a `Files` tab.
- Scope selector supports:
  - `Global knowledge` (`/knowledge/files`)
  - `Folder knowledge` (`/folders/{folder_id}/files`)
- Uploaded docs are embedded with Ollama `qwen3-embedding:0.6b`.
- Retrieval combines global + folder knowledge:
  - folder matches first
  - global fallback
- Assistant messages show scope-aware source labels.

## Required Ollama models

```bash
ollama pull hymetalab/vesta-general
ollama pull hymetalab/vesta-lite
ollama pull hymetalab/vesta-deep
ollama pull qwen3-embedding:0.6b
```

The first-run setup flow in the app auto-downloads any missing model from this list and skips models that are already installed.

## Weather tab behavior

- Weather tab appears only when backend `/weather/status` reports `enabled=true`.
- Missing/invalid `OPENWEATHER_API_KEY` hides Weather tab.
- Weather settings are app-global:
  - tracking mode (`Storm Damage`, `Lawn Care`, `Construction`, `General`)
  - location (city/state/country resolved to lat/lon)
- Dashboard shows:
  - current conditions
  - 5-day forecast chart
  - alerts
  - coherence score (integrity/resilience/meaning/CCI)
  - prediction timeline and insights
- Manual refresh calls `/weather/refresh`; normal loads use cache unless stale (>45 min).
- If One Call 3.0 alerts are not included on your OpenWeather account, dashboard still works with current + forecast and shows alert warning state.
