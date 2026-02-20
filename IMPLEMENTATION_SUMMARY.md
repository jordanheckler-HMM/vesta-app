# Implementation Summary (Current)

This summary is aligned with the current repository state.

## Runtime components

- Frontend: `vesta-frontend` (React + TypeScript + Vite)
- Desktop shell: `vesta-frontend/src-tauri` (Tauri)
- Backend: `vesta-backend` (FastAPI)
- LLM/embeddings runtime: Ollama (`http://localhost:11434`)

## Core execution paths

- Desktop dev: `cd vesta-frontend && npm run tauri:dev`
- Desktop build: `cd vesta-frontend && npm run tauri:build`
- Browser mode:
  - `cd vesta-backend && uvicorn main:app --reload --host 127.0.0.1 --port 8090`
  - `cd vesta-frontend && npm run dev`

## Data and state

Local SQLite state is stored in `knowledge.db` under:
- `$VESTA_DATA_DIR/knowledge.db` (if set), else
- `~/.vesta/knowledge.db`

Database state includes:
- Conversations and messages
- Global and folder-scoped knowledge documents/chunks
- Folder metadata
- Setup run history/events
- Model mapping settings
- Weather settings/cache/predictions/api telemetry

## Major features currently wired

- Streaming chat with model selection and auto-routing
- Conversation sidebar with folder organization and persistence
- File attachments for chat (`/upload`, non-indexed)
- Persistent knowledge ingestion (`/knowledge/files`, `/folders/{id}/files`)
- Weather tab with OpenWeather-backed dashboard and cache
- Setup wizard for Ollama readiness and model pulls
- Tauri tray behavior with mini-window support

## Verification status

Automated tests currently in repo:
- Backend: `44 passed` (`pytest -q`)
- Frontend: `27 passed` (`npm test`)
