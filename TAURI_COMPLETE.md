# Tauri Desktop Wrapper Status

Status: implemented and in active use.

This project currently ships a Tauri wrapper that:
- runs the React frontend in desktop windows
- manages backend process startup/cleanup
- provides tray interactions and mini-window behavior

## Verified commands

Development:
```bash
cd vesta-frontend
npm run tauri:dev
```

Production build:
```bash
cd vesta-frontend
npm run tauri:build
```

## Verified desktop behavior

- Main and mini windows hide on close (they do not quit the app).
- Tray icon supports opening mini chat and restoring main window.
- Tray `Quit Vesta` exits and triggers backend cleanup.
- Mini view uses `?view=mini` and is scratch-only.

## Constraints

- Backend host/port in Tauri Rust layer is fixed to `127.0.0.1:8090`.
- Ollama must be reachable by backend at `http://localhost:11434`.
- Sidecar build depends on PyInstaller in `vesta-backend/build_sidecar.sh`.

## Source of truth

For implementation details, use:
- `vesta-frontend/src-tauri/src/lib.rs`
- `vesta-frontend/src-tauri/tauri.conf.json`
- `vesta-backend/build_sidecar.sh`
- `vesta-backend/sidecar_entry.py`
