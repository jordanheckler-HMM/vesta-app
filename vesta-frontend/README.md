# Vesta Frontend

React + Vite frontend used by both browser mode and Tauri desktop windows.

## Dev server

```bash
npm install
npm run dev
```

Dev URL: `http://localhost:8081`

## Desktop dev wrapper

```bash
npm run tauri:dev
```

This command also builds/uses the backend sidecar and launches the Tauri shell.

## Build

```bash
npm run build
npm run tauri:build
```

## Tests

```bash
npm run lint
npm test
```

## Runtime behavior

- Main window has `Chat`, `Files`, and `Settings` tabs, plus `Weather` when enabled by backend status.
- `Files` tab manages persistent local knowledge ingestion via backend APIs.
- Mini window (`?view=mini`) is chat-only and is opened from the menu bar icon.
- Chat stream supports metadata frames for retrieved source labels.
