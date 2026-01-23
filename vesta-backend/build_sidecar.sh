#!/bin/bash
set -e

echo "Building Vesta backend sidecar..."

# Check if PyInstaller is installed
if ! command -v pyinstaller &> /dev/null; then
    echo "Installing PyInstaller..."
    pip install pyinstaller
fi

# Clean previous builds
rm -rf dist build *.spec

# Bundle FastAPI app with all dependencies
# Note: Add prompts directory as data files
# Include all hidden imports needed for uvicorn
pyinstaller --onefile \
  --name vesta-backend \
  --add-data "prompts:prompts" \
  --add-data "audit_logger.py:." \
  --add-data "routing_utils.py:." \
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
  main.py

echo "Backend sidecar built successfully at: dist/vesta-backend"
