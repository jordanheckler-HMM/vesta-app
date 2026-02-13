#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
TAURI_DIR="${ROOT_DIR}/vesta-frontend/src-tauri"
BINARIES_DIR="${TAURI_DIR}/binaries"

TARGET_TRIPLE="${TARGET_TRIPLE:-$(rustc -vV | awk '/host:/ {print $2}')}"
if [[ -z "${TARGET_TRIPLE}" ]]; then
  echo "Could not determine target triple. Set TARGET_TRIPLE and retry."
  exit 1
fi

OUTPUT_NAME="vesta-backend-${TARGET_TRIPLE}"
if [[ "${TARGET_TRIPLE}" == *windows* ]]; then
  OUTPUT_NAME="${OUTPUT_NAME}.exe"
fi
DEST_PATH="${BINARIES_DIR}/${OUTPUT_NAME}"

echo "Building Vesta backend sidecar for target: ${TARGET_TRIPLE}"

if [[ -f "${DEST_PATH}" ]] && [[ "${FORCE_REBUILD:-0}" != "1" ]]; then
  echo "Sidecar already exists at: ${DEST_PATH}"
  echo "Skipping rebuild (set FORCE_REBUILD=1 to force)."
  exit 0
fi

if ! command -v pyinstaller >/dev/null 2>&1; then
  echo "Installing PyInstaller..."
  python3 -m pip install pyinstaller
fi

mkdir -p "${BINARIES_DIR}"

cd "${SCRIPT_DIR}"
rm -rf dist build *.spec

# Bundle a runnable entrypoint that starts uvicorn directly.
# Keep explicit hidden imports for uvicorn/FastAPI packaging stability.
pyinstaller --onefile \
  --name vesta-backend \
  --add-data "prompts:prompts" \
  --hidden-import uvicorn.logging \
  --hidden-import uvicorn.loops \
  --hidden-import uvicorn.loops.auto \
  --hidden-import uvicorn.protocols \
  --hidden-import uvicorn.protocols.http \
  --hidden-import uvicorn.protocols.http.auto \
  --hidden-import uvicorn.protocols.websockets \
  --hidden-import uvicorn.protocols.websockets.auto \
  --hidden-import uvicorn.lifespan \
  --hidden-import uvicorn.lifespan.on \
  --hidden-import httpx \
  --hidden-import httpx._client \
  --hidden-import fastapi \
  --hidden-import pydantic \
  --collect-all fastapi \
  --collect-all uvicorn \
  sidecar_entry.py

cp "dist/vesta-backend" "${DEST_PATH}"
chmod +x "${DEST_PATH}"

echo "Backend sidecar built successfully at: ${DEST_PATH}"
