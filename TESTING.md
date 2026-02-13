# Testing Guide

This repository currently has two active runtime components:

- `vesta-frontend` (React + TypeScript + Vite)
- `vesta-backend` (FastAPI + Python)

## Local commands

### Frontend

```bash
cd vesta-frontend
npm ci
npm run lint
npm test
```

### Backend

```bash
cd vesta-backend
python -m pip install -r requirements-dev.txt
pytest -q
```

## Test layout

### Backend (`vesta-backend/tests`)

- `test_routing_utils.py`: unit tests for pure routing logic
- `test_api_integration.py`: integration tests for FastAPI endpoints (`/health`, `/upload`) with external Ollama calls mocked

### Frontend (`vesta-frontend/src`)

- `lib/utils.test.ts`: unit test for `cn` utility behavior
- `components/ModelSelector.test.tsx`: component interaction test for model selection behavior

## CI behavior

GitHub Actions workflow: `.github/workflows/ci.yml`

- Triggered on:
  - Pull requests
  - Pushes to `main`
- Frontend job:
  - `npm ci`
  - `npm run lint`
  - `npm test`
- Backend job:
  - Install from `requirements-dev.txt`
  - `pytest -q`

## Safe-mode CD

Manual-only workflow: `.github/workflows/cd-safe.yml`

- Triggered only via `workflow_dispatch`
- Builds frontend artifact and uploads it
- Deploy job is intentionally disabled (`if: false`) until an explicit deployment target and approval model are defined

## Extending tests

- Add backend unit tests for new pure functions in `vesta-backend/tests`.
- Add backend integration tests for new endpoints; mock external services to keep tests deterministic.
- Add frontend tests near the feature module (`src/...`) and keep UI tests focused on behavior, not styling details.
