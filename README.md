# Vesta

Internal desktop AI assistant with local chat and local persistent knowledge retrieval.

## Stack

- Frontend: React + TypeScript + Vite (`http://localhost:8081` in dev)
- Desktop shell: Tauri
- Backend: FastAPI (`http://localhost:8090`)
- LLM runtime: Ollama (`http://localhost:11434`)

## Prerequisites

- macOS (desktop app target)
- Python 3.10+
- Node.js 18+
- Rust toolchain (for Tauri builds)
- Ollama installed and running

## Required Ollama models

```bash
# Chat models
ollama pull hymetalab/vesta-general
ollama pull hymetalab/vesta-lite
ollama pull hymetalab/vesta-deep

# Embedding model used for Files knowledge base
ollama pull qwen3-embedding:0.6b
```

The first-run setup flow auto-downloads these same models if they are missing and skips models that already exist locally.

## Install dependencies

```bash
# Backend
cd vesta-backend
pip install -r requirements.txt

# Frontend
cd ../vesta-frontend
npm install
```

## Development

### Option 1: Full desktop app dev (recommended)

```bash
cd vesta-frontend
npm run tauri:dev
```

This starts:
- Vite dev server on `8081`
- Tauri desktop shell
- FastAPI backend on `8090` from the local `vesta-backend` source

### Option 2: Browser mode

```bash
# Terminal 1
cd vesta-backend
uvicorn main:app --reload --host 127.0.0.1 --port 8090

# Terminal 2
cd vesta-frontend
npm run dev
```

Open `http://localhost:8081`.

## Build one-click app

```bash
cd vesta-frontend
npm run tauri:build
```

The build command force-rebuilds the backend sidecar and bundles the desktop app.

macOS output:
- `vesta-frontend/src-tauri/target/release/bundle/macos/Vesta.app`

## App lifecycle behavior

- Closing the main window does **not** quit the app. It hides the window.
- The app remains running in the menu bar.
- Clicking the menu bar icon opens the mini chat window.
- Full quit happens only through:
  - Tray menu `Quit Vesta`
  - macOS quit shortcut (`Cmd+Q`)

## Saved chats and folders

- Main window includes a persistent left sidebar (ChatGPT/Claude style).
- Chats are saved locally in SQLite and can be:
  - created
  - selected
  - renamed
  - deleted
  - moved between uncategorized and folders
- Header action is `New chat` (replaces `Clear chat` in main window).
- You can create folders/projects and attach chats to a folder.
- Deleting a folder cascades folder chats and folder-scoped documents.
- Mini chat (`?view=mini`) is intentionally scratch-only and session-local; it does not save to sidebar history.

## Files knowledge base (persistent local RAG)

- Main window includes a `Files` tab.
- Files tab supports two scopes:
  - `Global knowledge`
  - `Folder knowledge` (for the selected folder/project)
- Uploaded docs are stored locally in SQLite under:
  - `$VESTA_DATA_DIR/knowledge.db` if `VESTA_DATA_DIR` is set
  - otherwise `~/.vesta/knowledge.db`
- Global and folder scopes both use Ollama embeddings with `qwen3-embedding:0.6b`.
- Knowledge retrieval runs automatically on every `/chat` request.
- Retrieval policy:
  - folder-scoped matches are ranked first when a chat is in a folder
  - global matches are used as fallback
- Chat stream includes source metadata shown in assistant messages (`Global: ...` or `Folder <name>: ...`).

### Supported ingestion behavior

- Known formats: `pdf`, `doc/docx`, `csv`, `txt`, `xls/xlsx`
- Unknown formats: best-effort UTF-8 text decode
- Non-text binaries: reported as `unsupported`
- Duplicate documents (same content hash): reported as `duplicate` and skipped

## Health check

```bash
curl http://localhost:8090/health
```

Expected shape:

```json
{
  "status": "ok",
  "backend": "running",
  "knowledge_db": "ready",
  "ollama": "connected"
}
```

## Environment variables

- `VESTA_DATA_DIR`: overrides local knowledge DB directory
- `VESTA_BACKEND_PORT`: sidecar backend port (default `8090`)

## Troubleshooting

### `Backend directory not found`

Run desktop dev from the repo frontend directory:

```bash
cd /path/to/vesta-app/vesta-frontend
npm run tauri:dev
```

### Port conflict on `8081` or `8090`

```bash
lsof -ti:8081 | xargs kill -9
lsof -ti:8090 | xargs kill -9
```

### Ollama connectivity failure

```bash
ollama serve
curl http://localhost:11434/api/version
```

## Limitations

- Knowledge storage is local and unencrypted by default.
- OCR/transcoding for scanned/image-only files is not included.
- Mini chat is scratch-mode only and is not persisted to sidebar history.
