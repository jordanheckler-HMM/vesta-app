# Tauri Implementation (Current)

This file describes the current desktop wrapper behavior in `vesta-frontend/src-tauri`.

## Build/runtime wiring

- Tauri config: `vesta-frontend/src-tauri/tauri.conf.json`
- Frontend dev URL: `http://localhost:8081`
- Backend target host/port from Rust: `127.0.0.1:8090`
- Backend sidecar binary path in bundle config:
  - `vesta-frontend/src-tauri/binaries/vesta-backend-<target-triple>[.exe]`

## Startup behavior

In `src-tauri/src/lib.rs`:

- Development mode:
  - starts backend from source via `python3 -m uvicorn main:app --host 127.0.0.1 --port 8090`
- Production mode:
  - starts bundled sidecar process `vesta-backend`
- Performs backend health polling against `/health` for up to 30 seconds before continuing.

## Window and tray behavior

- Creates tray menu with:
  - `Open Mini Chat`
  - `Open Main Window`
  - `Quit Vesta`
- Creates hidden mini window at `/?view=mini`.
- Closing `main` or `mini` window is intercepted and converted to hide.
- Mini window hides when focus is lost.
- Left-click tray icon opens mini chat.

## Shutdown behavior

- Backend child process is tracked in app state.
- Process cleanup executes on explicit quit/exit events.

## Sidecar build path

`vesta-backend/build_sidecar.sh`:
- builds one-file backend executable via PyInstaller
- copies artifact into `vesta-frontend/src-tauri/binaries/`
- supports `FORCE_REBUILD=1`
