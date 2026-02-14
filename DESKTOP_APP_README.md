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

## Files tab (persistent local knowledge)

- Main window includes a `Files` tab.
- Uploaded docs are embedded with Ollama `qwen3-embedding:0.6b`.
- Retrieved snippets are automatically injected into `/chat` requests.
- Assistant messages show source labels for retrieved chunks.

## Required Ollama models

```bash
ollama pull hymetalab/vesta-general
ollama pull hymetalab/vesta-lite
ollama pull hymetalab/vesta-deep
ollama pull qwen3-embedding:0.6b
```
