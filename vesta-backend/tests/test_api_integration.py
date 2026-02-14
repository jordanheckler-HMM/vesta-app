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


def test_folder_crud_and_cascade_delete(monkeypatch):
    monkeypatch.setattr(main, "embed_texts", _fake_embed_texts)

    with TestClient(main.app) as client:
        created = client.post("/folders", json={"name": "HR Project"})
        assert created.status_code == 200
        assert created.json()["folder"]["color"] == "sand"
        folder_id = created.json()["folder"]["id"]

        renamed = client.patch(f"/folders/{folder_id}", json={"name": "HR Playbook"})
        assert renamed.status_code == 200
        assert renamed.json()["folder"]["name"] == "HR Playbook"
        assert renamed.json()["folder"]["color"] == "sand"

        file_upload = client.post(
            f"/folders/{folder_id}/files",
            files=[("files", ("hr.txt", b"HR policy SOP", "text/plain"))],
        )
        assert file_upload.status_code == 200
        assert file_upload.json()["results"][0]["status"] == "indexed"

        conversation = client.post("/conversations", json={"folder_id": folder_id})
        assert conversation.status_code == 200
        conversation_id = conversation.json()["conversation"]["id"]

        turn = client.post(
            f"/conversations/{conversation_id}/turns",
            json={
                "user_message": "What is the PTO policy?",
                "assistant_message": "Use the HR SOP.",
                "model_used": "general",
                "sources": [],
            },
        )
        assert turn.status_code == 200

        deleted = client.delete(f"/folders/{folder_id}")
        assert deleted.status_code == 200
        body = deleted.json()
        assert body["deleted"] is True
        assert body["conversations_deleted"] == 1
        assert body["documents_deleted"] == 1
        assert body["chunks_deleted"] > 0

        folders_after = client.get("/folders")
        assert folders_after.status_code == 200
        assert folders_after.json()["folders"] == []

        conversations_after = client.get("/conversations")
        assert conversations_after.status_code == 200
        assert conversations_after.json()["conversations"] == []

        folder_files_after = client.get(f"/folders/{folder_id}/files")
        assert folder_files_after.status_code == 404


def test_folder_upload_duplicate_and_global_independent(monkeypatch):
    monkeypatch.setattr(main, "embed_texts", _fake_embed_texts)

    with TestClient(main.app) as client:
        folder = client.post("/folders", json={"name": "Ops"})
        assert folder.status_code == 200
        folder_id = folder.json()["folder"]["id"]

        global_upload = client.post(
            "/knowledge/files",
            files=[("files", ("same.txt", b"same knowledge content", "text/plain"))],
        )
        assert global_upload.status_code == 200
        assert global_upload.json()["results"][0]["status"] == "indexed"

        folder_upload_first = client.post(
            f"/folders/{folder_id}/files",
            files=[("files", ("same-folder.txt", b"same knowledge content", "text/plain"))],
        )
        folder_upload_second = client.post(
            f"/folders/{folder_id}/files",
            files=[("files", ("same-folder-copy.txt", b"same knowledge content", "text/plain"))],
        )

        assert folder_upload_first.status_code == 200
        assert folder_upload_first.json()["results"][0]["status"] == "indexed"
        assert folder_upload_second.status_code == 200
        assert folder_upload_second.json()["results"][0]["status"] == "duplicate"


def test_folder_file_delete_removes_folder_document_only(monkeypatch):
    monkeypatch.setattr(main, "embed_texts", _fake_embed_texts)

    with TestClient(main.app) as client:
        folder = client.post("/folders", json={"name": "Finance"})
        folder_id = folder.json()["folder"]["id"]

        upload = client.post(
            f"/folders/{folder_id}/files",
            files=[("files", ("budget.txt", b"finance SOP", "text/plain"))],
        )
        folder_document_id = upload.json()["results"][0]["document"]["id"]

        delete = client.delete(f"/folders/{folder_id}/files/{folder_document_id}")
        assert delete.status_code == 200
        assert delete.json()["deleted"] is True

        list_folder = client.get(f"/folders/{folder_id}/files")
        assert list_folder.status_code == 200
        assert list_folder.json()["documents"] == []


def test_conversation_crud_move_and_turn_persistence(monkeypatch):
    monkeypatch.setattr(main, "embed_texts", _fake_embed_texts)

    with TestClient(main.app) as client:
        created = client.post("/conversations", json={"folder_id": None})
        assert created.status_code == 200
        conversation_id = created.json()["conversation"]["id"]

        renamed = client.patch(
            f"/conversations/{conversation_id}",
            json={"title": "Operations Follow-up"},
        )
        assert renamed.status_code == 200
        assert renamed.json()["conversation"]["title"] == "Operations Follow-up"

        folder = client.post("/folders", json={"name": "Operations"})
        folder_id = folder.json()["folder"]["id"]

        moved = client.patch(
            f"/conversations/{conversation_id}",
            json={"folder_id": folder_id},
        )
        assert moved.status_code == 200
        assert moved.json()["conversation"]["folder_id"] == folder_id

        turn = client.post(
            f"/conversations/{conversation_id}/turns",
            json={
                "user_message": "Summarize onboarding steps",
                "assistant_message": "Here is the process.",
                "model_used": "general",
                "sources": [{"filename": "playbook.txt", "source_type": "global"}],
            },
        )
        assert turn.status_code == 200
        assert turn.json()["saved"] is True

        loaded = client.get(f"/conversations/{conversation_id}")
        assert loaded.status_code == 200
        assert len(loaded.json()["messages"]) == 2
        assert loaded.json()["messages"][1]["role"] == "assistant"
        assert loaded.json()["messages"][1]["sources"][0]["filename"] == "playbook.txt"

        moved_to_root = client.patch(
            f"/conversations/{conversation_id}",
            json={"folder_id": None},
        )
        assert moved_to_root.status_code == 200
        assert moved_to_root.json()["conversation"]["folder_id"] is None

        deleted = client.delete(f"/conversations/{conversation_id}")
        assert deleted.status_code == 200

        after = client.get("/conversations")
        assert after.status_code == 200
        assert after.json()["conversations"] == []


def test_chat_folder_sources_prioritize_folder_then_global(monkeypatch):
    monkeypatch.setattr(main, "embed_texts", _fake_embed_texts)
    captured = {}

    async def _fake_stream(model_name, prompt, sources=None):
        captured["sources"] = sources or []
        yield f"data: {main.json.dumps({'metadata': {'sources': sources or []}})}\n\n"
        yield f"data: {main.json.dumps({'content': 'ok', 'done': True})}\n\n"

    monkeypatch.setattr(main, "stream_ollama_response", _fake_stream)

    with TestClient(main.app) as client:
        folder = client.post("/folders", json={"name": "Sales"})
        folder_id = folder.json()["folder"]["id"]

        global_upload = client.post(
            "/knowledge/files",
            files=[("files", ("global.txt", b"policy SOP global", "text/plain"))],
        )
        assert global_upload.status_code == 200

        folder_upload = client.post(
            f"/folders/{folder_id}/files",
            files=[("files", ("folder.txt", b"policy SOP folder", "text/plain"))],
        )
        assert folder_upload.status_code == 200

        response = client.post(
            "/chat",
            json={
                "mode": "general",
                "message": "What does policy say?",
                "messages": [],
                "model": "general",
                "folder_id": folder_id,
            },
        )

    assert response.status_code == 200
    assert len(captured["sources"]) >= 1
    assert captured["sources"][0]["source_type"] == "folder"


def test_chat_infers_folder_from_conversation_id(monkeypatch):
    monkeypatch.setattr(main, "embed_texts", _fake_embed_texts)
    captured = {}

    async def _capture_retrieval(query, folder_id=None):
        captured["folder_id"] = folder_id
        return "", []

    async def _fake_stream(model_name, prompt, sources=None):
        yield f"data: {main.json.dumps({'metadata': {'sources': sources or []}})}\n\n"
        yield f"data: {main.json.dumps({'content': 'ok', 'done': True})}\n\n"

    monkeypatch.setattr(main, "retrieve_knowledge_context", _capture_retrieval)
    monkeypatch.setattr(main, "stream_ollama_response", _fake_stream)

    with TestClient(main.app) as client:
        folder = client.post("/folders", json={"name": "Legal"})
        folder_id = folder.json()["folder"]["id"]

        conversation = client.post("/conversations", json={"folder_id": folder_id})
        conversation_id = conversation.json()["conversation"]["id"]

        response = client.post(
            "/chat",
            json={
                "mode": "general",
                "message": "hello",
                "messages": [],
                "model": "general",
                "conversation_id": conversation_id,
            },
        )

    assert response.status_code == 200
    assert captured["folder_id"] == folder_id


def test_folder_color_create_update_and_validation():
    with TestClient(main.app) as client:
        created = client.post(
            "/folders",
            json={"name": "Product", "color": "sage"},
        )
        assert created.status_code == 200
        folder = created.json()["folder"]
        assert folder["color"] == "sage"

        folder_id = folder["id"]
        recolored = client.patch(f"/folders/{folder_id}", json={"color": "slate"})
        assert recolored.status_code == 200
        assert recolored.json()["folder"]["color"] == "slate"

        invalid = client.post("/folders", json={"name": "Invalid", "color": "neon"})
        assert invalid.status_code == 400
