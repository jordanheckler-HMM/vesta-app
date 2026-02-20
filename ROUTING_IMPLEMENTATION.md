# Routing Implementation

This file documents the current routing implementation in:
- `vesta-backend/main.py`
- `vesta-backend/routing_utils.py`
- `vesta-backend/audit_logger.py`
- `vesta-frontend/src/pages/Index.tsx`
- `vesta-frontend/src/components/MessageBubble.tsx`

## Backend routing flow

`/chat` supports manual model selection (`lite|general|deep`) and auto routing (`auto`).

When `model=auto`, the backend flow is:
1. `route_to_model(...)` analyzes message signals and task context.
2. Fast heuristic routing is attempted first.
3. If ambiguous, `llm_route(...)` asks the configured general model to choose `lite|general|deep`.
4. `enforce_model_consistency(...)` can prevent mid-task downgrade.
5. Routing decision is audit-logged.
6. The selected model profile is mapped to the configured Ollama model name.

When `model` is explicit (not `auto`), routing analysis is bypassed.

## Response metadata

`/chat` returns streaming SSE and sets:
- `X-Selected-Model`
- `X-Routing-Method` (auto-routing only)
- `X-Routing-Confidence` (auto-routing only)

The first SSE frame includes source metadata (`metadata.sources`).

## Frontend integration

- Frontend sends `last_model_used` in `/chat` requests.
- Frontend reads `X-Selected-Model` and stores it for subsequent turns.
- Assistant bubbles show the selected model badge after stream completion.

## Logging

Routing logs are produced by `audit_logger.py`:
- Console logging in development.
- Rotating file logs at `vesta-backend/logs/routing_audit.log`.

## Notes on certainty

- The code includes heuristic and LLM fallback routing.
- No benchmark numbers are asserted in this document.
