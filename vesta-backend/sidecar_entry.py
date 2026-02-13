import os

import uvicorn

from main import app


def get_port() -> int:
    raw_port = os.getenv("VESTA_BACKEND_PORT", "8090")
    try:
        return int(raw_port)
    except ValueError:
        return 8090


if __name__ == "__main__":
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=get_port(),
        log_level=os.getenv("VESTA_BACKEND_LOG_LEVEL", "info"),
    )
