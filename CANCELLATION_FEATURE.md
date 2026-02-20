# Message Cancellation

This document reflects current behavior in:
- `vesta-frontend/src/pages/Index.tsx`
- `vesta-frontend/src/components/ChatInput.tsx`

## Implemented behavior

- Chat input toggles between `Send` and `Stop` while an assistant response is streaming.
- Each `/chat` request gets a dedicated `AbortController`.
- Clicking `Stop` aborts the active streaming request.

## Persistence and UX details

- Cancelled streams keep any partial assistant text that already rendered in the open UI.
- In the main window, cancelled turns are not saved to SQLite history because turn persistence runs only after a completed stream.
- Mini view clear resets local scratch state and aborts any in-flight stream.
- Main view uses `New chat` plus conversation management; it does not use the old global `Clear chat` behavior.

## Scope boundaries

- Cancellation applies to `/chat` streaming only.
- It does not cancel setup/model download streams (`/setup/prerequisites/stream`).

## Verification

- Backend tests: `cd vesta-backend && pytest -q`
- Frontend tests: `cd vesta-frontend && npm test`
