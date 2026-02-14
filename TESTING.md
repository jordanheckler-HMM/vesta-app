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
- `/folders` CRUD + cascade deletion behavior
- `/folders/{id}/files` ingest/list/delete flows
- duplicate and unsupported file handling
- `/conversations` CRUD + move between folder/uncategorized
- `/conversations/{id}/turns` persistence + auto-title behavior
- `/chat` metadata stream with retrieval sources
- folder-priority retrieval with global fallback
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
- Sidebar folder/chat rendering and selection
- New chat creation from header/sidebar
- Chat rename/delete/move actions
- Files tab upload and delete behavior
- Files tab scope switch (global vs folder endpoints)
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

## Manual saved chats + folders validation

1. Create two folders in the sidebar and verify both appear.
2. Create one uncategorized chat and one folder chat.
3. Send a message in each and verify sidebar ordering/preview updates.
4. Rename a chat and a folder, then reload app and verify persistence.
5. Move a chat between folder and uncategorized and verify regrouping.
6. Delete a folder and confirm cascade removes folder chats/docs.

## Manual Files RAG validation (global + folder scope)

1. Open main app `Files` tab.
2. In `Global knowledge` scope, upload one `.txt` SOP and confirm status `indexed`.
3. Re-upload same file in global scope and confirm `duplicate`.
4. Switch to `Folder knowledge`, pick a folder, upload same file again, and confirm `indexed`.
5. Query in a chat attached to that folder and verify source labels include folder scope.
6. Query in an uncategorized chat and verify only global sources appear.
7. Delete the folder file and confirm global file remains.

## Required local runtime

- Ollama server running on `http://localhost:11434`
- Models installed:
  - `hymetalab/vesta-general`
  - `hymetalab/vesta-lite`
  - `hymetalab/vesta-deep`
  - `qwen3-embedding:0.6b`
