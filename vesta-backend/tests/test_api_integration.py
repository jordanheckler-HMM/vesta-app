import httpx
from fastapi.testclient import TestClient

import main


class _HealthyResponse:
    status_code = 200


class _HealthyAsyncClient:
    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def get(self, url):
        return _HealthyResponse()


class _UnavailableAsyncClient(_HealthyAsyncClient):
    async def get(self, url):
        raise httpx.ConnectError("connection failed", request=httpx.Request("GET", url))


def test_health_endpoint_reports_ok_when_ollama_is_reachable(monkeypatch):
    monkeypatch.setattr(main.httpx, "AsyncClient", _HealthyAsyncClient)

    with TestClient(main.app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "backend": "running",
        "ollama": "connected",
    }


def test_health_endpoint_reports_degraded_when_ollama_is_unreachable(monkeypatch):
    monkeypatch.setattr(main.httpx, "AsyncClient", _UnavailableAsyncClient)

    with TestClient(main.app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "degraded"
    assert body["backend"] == "running"
    assert body["ollama"] == "unreachable"


def test_upload_endpoint_extracts_text_from_txt_file():
    with TestClient(main.app) as client:
        response = client.post(
            "/upload",
            files=[("files", ("notes.txt", b"hello from test", "text/plain"))],
        )

    assert response.status_code == 200
    files = response.json()["files"]
    assert len(files) == 1
    assert files[0]["filename"] == "notes.txt"
    assert "hello from test" in files[0]["content"]
