# Vesta Feature Documentation (Current)

This file documents currently implemented behavior only.

## 1. Chat and model routing

- Endpoint: `POST /chat` (streaming SSE)
- Supports manual model selection and `auto` routing.
- Auto routing uses message/task analysis plus fallback LLM routing.
- Response includes source metadata and selected-model headers.

## 2. Copy message content

- Message bubbles include a hover copy button.
- Copy operation uses `navigator.clipboard.writeText(content)`.
- The copied payload is the message content string currently in the bubble.

## 3. Chat file attachments (`/upload`)

- Purpose: inject extracted text into a single chat turn context.
- Supported extensions: `pdf`, `doc/docx`, `csv`, `txt`, `xls/xlsx`.
- Per-file size limit: 10MB.
- Extracted content is truncated to 50,000 characters per file in `/upload` response.

Important distinction:
- `/upload` does not index files into the persistent knowledge base.
- Indexed retrieval uses Files tab endpoints (`/knowledge/files` or `/folders/{id}/files`).

## 4. Persistent Files knowledge base

- Global scope endpoints:
  - `POST /knowledge/files`
  - `GET /knowledge/files`
  - `DELETE /knowledge/files/{document_id}`
- Folder scope endpoints:
  - `POST /folders/{folder_id}/files`
  - `GET /folders/{folder_id}/files`
  - `DELETE /folders/{folder_id}/files/{document_id}`
- Embedding model: `qwen3-embedding:0.6b`.
- Retrieval policy: folder matches first, then global fallback.
- Ingest result states include `indexed`, `duplicate`, `unsupported`, `error`.

## 5. Saved chats and folders

- Conversation endpoints:
  - `GET/POST /conversations`
  - `GET/PATCH/DELETE /conversations/{id}`
  - `POST /conversations/{id}/turns`
- Folder endpoints:
  - `GET/POST /folders`
  - `PATCH/DELETE /folders/{id}`
- Folder deletion cascades folder conversations and folder documents/chunks.

## 6. Weather features

- Weather status gate: `GET /weather/status`.
- Weather dashboard: `GET /weather/dashboard`.
- Weather refresh: `POST /weather/refresh`.
- Settings/location management:
  - `GET /weather/settings`
  - `PUT /weather/settings`
  - `GET /weather/resolve-location`
- Cache TTL default: 45 minutes.
- Weather context is injected into `/chat` only for weather-intent prompts.

## 7. Desktop lifecycle behavior (Tauri)

- Closing main/mini windows hides them instead of quitting.
- Tray icon left click opens mini chat.
- Mini chat auto-hides on focus loss.
- Full quit occurs through tray `Quit Vesta` or app quit command.
