# Testing Guide

## Automated checks

### Backend

```bash
cd vesta-backend
python -m pip install -r requirements-dev.txt
pytest -q
```

Coverage includes:
- `/health` endpoint behavior
- `/upload` text extraction
- `/knowledge/files` ingest/list/delete flows
- duplicate and unsupported file handling
- `/chat` metadata stream with retrieval sources
- `/chat` fallback behavior when retrieval fails

### Frontend

```bash
cd vesta-frontend
npm ci
npm run lint
npm test
```

Coverage includes:
- Model selector interaction
- Files tab upload and delete behavior
- Message source labels rendering
- Mini view hiding the Files tab

### Tauri Rust shell

```bash
cd vesta-frontend/src-tauri
cargo check
```

## Manual validation (macOS)

1. Start desktop dev:
   ```bash
   cd vesta-frontend
   npm run tauri:dev
   ```
2. Close main window and verify app remains running in menu bar.
3. Click tray icon and verify mini chat opens.
4. Click outside mini chat and verify it auto-hides.
5. From tray menu choose `Open Main Window` and verify main window restores.
6. From tray menu choose `Quit Vesta` and verify app plus backend process exit.

## Manual Files RAG validation

1. Open main app `Files` tab.
2. Upload one `.txt` SOP file and confirm status `indexed`.
3. Upload the same file again and confirm status `duplicate`.
4. Send a chat query related to the SOP and confirm source tags appear in the assistant message.
5. Delete the file in `Files` tab and confirm it no longer appears in list.

## Required local runtime

- Ollama server running on `http://localhost:11434`
- Models installed:
  - `hymetalab/vesta-general`
  - `hymetalab/vesta-lite`
  - `hymetalab/vesta-deep`
  - `qwen3-embedding:0.6b`
