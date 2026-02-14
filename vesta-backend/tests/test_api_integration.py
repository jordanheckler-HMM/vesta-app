import httpx
import pytest
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


@pytest.fixture(autouse=True)
def isolate_knowledge_store(tmp_path, monkeypatch):
    monkeypatch.setenv("VESTA_DATA_DIR", str(tmp_path))
    main.KNOWLEDGE_STORE = None
    yield
    main.KNOWLEDGE_STORE = None


async def _fake_embed_texts(inputs, model_name=main.EMBEDDING_MODEL):
    vectors = []
    for text in inputs:
        lower = text.lower()
        vectors.append(
            [
                1.0 if "policy" in lower else 0.2,
                1.0 if "sop" in lower else 0.2,
                float(len(lower) % 11) / 10.0,
            ]
        )
    return vectors


def test_health_endpoint_reports_ok_when_ollama_is_reachable(monkeypatch):
    monkeypatch.setattr(main.httpx, "AsyncClient", _HealthyAsyncClient)

    with TestClient(main.app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["backend"] == "running"
    assert body["ollama"] == "connected"
    assert body["knowledge_db"] == "ready"


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


def test_knowledge_upload_txt_returns_indexed(monkeypatch):
    monkeypatch.setattr(main, "embed_texts", _fake_embed_texts)

    with TestClient(main.app) as client:
        response = client.post(
            "/knowledge/files",
            files=[("files", ("sop.txt", b"Company policy and SOP details", "text/plain"))],
        )

    assert response.status_code == 200
    result = response.json()["results"][0]
    assert result["status"] == "indexed"
    assert result["document"]["chunk_count"] > 0


def test_knowledge_upload_duplicate_returns_duplicate(monkeypatch):
    monkeypatch.setattr(main, "embed_texts", _fake_embed_texts)

    with TestClient(main.app) as client:
        first = client.post(
            "/knowledge/files",
            files=[("files", ("sop.txt", b"same document body", "text/plain"))],
        )
        second = client.post(
            "/knowledge/files",
            files=[("files", ("sop-copy.txt", b"same document body", "text/plain"))],
        )

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["results"][0]["status"] == "indexed"
    assert second.json()["results"][0]["status"] == "duplicate"


def test_knowledge_upload_binary_returns_unsupported(monkeypatch):
    monkeypatch.setattr(main, "embed_texts", _fake_embed_texts)

    with TestClient(main.app) as client:
        response = client.post(
            "/knowledge/files",
            files=[("files", ("archive.bin", b"\x00\x01\x02\x03" * 500, "application/octet-stream"))],
        )

    assert response.status_code == 200
    result = response.json()["results"][0]
    assert result["status"] == "unsupported"


def test_knowledge_list_returns_documents(monkeypatch):
    monkeypatch.setattr(main, "embed_texts", _fake_embed_texts)

    with TestClient(main.app) as client:
        client.post(
            "/knowledge/files",
            files=[("files", ("policy.txt", b"policy SOP text", "text/plain"))],
        )
        response = client.get("/knowledge/files")

    assert response.status_code == 200
    documents = response.json()["documents"]
    assert len(documents) == 1
    assert documents[0]["filename"] == "policy.txt"
    assert "id" in documents[0]


def test_knowledge_delete_removes_document_and_chunks(monkeypatch):
    monkeypatch.setattr(main, "embed_texts", _fake_embed_texts)

    with TestClient(main.app) as client:
        upload = client.post(
            "/knowledge/files",
            files=[("files", ("policy.txt", b"policy SOP text", "text/plain"))],
        )
        document_id = upload.json()["results"][0]["document"]["id"]

        delete_response = client.delete(f"/knowledge/files/{document_id}")
        list_response = client.get("/knowledge/files")

    assert delete_response.status_code == 200
    assert delete_response.json()["deleted"] is True
    assert delete_response.json()["chunk_count"] > 0
    assert list_response.status_code == 200
    assert list_response.json()["documents"] == []


def test_chat_injects_knowledge_context_and_emits_metadata(monkeypatch):
    monkeypatch.setattr(main, "embed_texts", _fake_embed_texts)
    captured = {}

    async def _fake_stream(model_name, prompt, sources=None):
        captured["model_name"] = model_name
        captured["prompt"] = prompt
        captured["sources"] = sources or []
        yield f"data: {main.json.dumps({'metadata': {'sources': sources or []}})}\n\n"
        yield f"data: {main.json.dumps({'content': 'ok', 'done': True})}\n\n"

    monkeypatch.setattr(main, "stream_ollama_response", _fake_stream)

    with TestClient(main.app) as client:
        ingest = client.post(
            "/knowledge/files",
            files=[("files", ("policy.txt", b"Company policy for leave requests", "text/plain"))],
        )
        assert ingest.status_code == 200

        response = client.post(
            "/chat",
            json={
                "mode": "general",
                "message": "What is our policy?",
                "messages": [],
                "model": "general",
                "last_model_used": None,
            },
        )

    assert response.status_code == 200
    body = response.text
    assert '"metadata"' in body
    assert '"content": "ok"' in body
    assert "Knowledge Base Context:" in captured["prompt"]
    assert len(captured["sources"]) > 0


def test_chat_continues_when_retrieval_fails(monkeypatch):
    async def _broken_retrieval(query):
        raise RuntimeError("retrieval failure")

    captured = {}

    async def _fake_stream(model_name, prompt, sources=None):
        captured["sources"] = sources or []
        yield f"data: {main.json.dumps({'metadata': {'sources': sources or []}})}\n\n"
        yield f"data: {main.json.dumps({'content': 'fallback response', 'done': True})}\n\n"

    monkeypatch.setattr(main, "retrieve_knowledge_context", _broken_retrieval)
    monkeypatch.setattr(main, "stream_ollama_response", _fake_stream)

    with TestClient(main.app) as client:
        response = client.post(
            "/chat",
            json={
                "mode": "general",
                "message": "hello",
                "messages": [],
                "model": "general",
                "last_model_used": None,
            },
        )

    assert response.status_code == 200
    assert '"content": "fallback response"' in response.text
    assert captured["sources"] == []
