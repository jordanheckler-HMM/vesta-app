from fastapi import FastAPI, HTTPException, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
import csv
import hashlib
import httpx
import io
import json
import math
import os
from pathlib import Path
import sqlite3
import sys
import threading
import time
from typing import Any, Dict, List, Literal, Optional, Tuple
from uuid import uuid4

# Import routing utilities and audit logger
from routing_utils import (
    analyze_message_signals,
    analyze_task_context,
    fast_route,
    enforce_model_consistency,
    should_upgrade_model,
    RoutingDecision,
)
from audit_logger import (
    log_routing_decision,
    log_routing_error,
    log_model_consistency_event,
)

app = FastAPI(title="Vesta Backend")

# CORS middleware for local frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Local only - no auth needed
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Model definitions
MODEL_NAMES = {
    "general": "hymetalab/vesta-general",
    "deep": "hymetalab/vesta-deep",
    "lite": "hymetalab/vesta-lite",
}

OLLAMA_BASE_URL = "http://localhost:11434"
EMBEDDING_MODEL = "qwen3-embedding:0.6b"
MAX_CHAT_UPLOAD_SIZE = 10 * 1024 * 1024
MAX_KNOWLEDGE_UPLOAD_SIZE = 25 * 1024 * 1024
MAX_KNOWLEDGE_TEXT_CHARS = 300_000
CHUNK_SIZE = 1_200
CHUNK_OVERLAP = 200
RETRIEVAL_TOP_K = 5
RETRIEVAL_MIN_SCORE = 0.2
FOLDER_COLOR_OPTIONS = {"sand", "stone", "sage", "slate", "taupe", "clay"}
DEFAULT_FOLDER_COLOR = "sand"


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    mode: Literal["draft", "think", "clarify", "general"]
    message: str = Field(..., min_length=1)
    messages: List[ChatMessage] = Field(default_factory=list)
    model: Optional[Literal["general", "deep", "lite", "auto"]] = "auto"
    last_model_used: Optional[str] = None
    conversation_id: Optional[str] = None
    folder_id: Optional[str] = None


class ChatResponse(BaseModel):
    response: str


class FolderCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    color: Optional[str] = None


class FolderUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    color: Optional[str] = None


class ConversationCreateRequest(BaseModel):
    folder_id: Optional[str] = None


class ConversationUpdateRequest(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=160)
    folder_id: Optional[str] = None


class ConversationTurnRequest(BaseModel):
    user_message: str = Field(..., min_length=1)
    assistant_message: str = Field(..., min_length=1)
    model_used: Optional[str] = None
    sources: Optional[List[Dict[str, Any]]] = None


class KnowledgeStore:
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.db_path = data_dir / "knowledge.db"
        self._lock = threading.Lock()
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def _initialize(self) -> None:
        with self._lock:
            with self._connect() as conn:
                conn.executescript(
                    """
                    CREATE TABLE IF NOT EXISTS knowledge_documents (
                        id TEXT PRIMARY KEY,
                        filename TEXT NOT NULL,
                        content_hash TEXT NOT NULL UNIQUE,
                        size_bytes INTEGER NOT NULL,
                        mime_type TEXT,
                        chunk_count INTEGER NOT NULL,
                        created_at TEXT NOT NULL
                    );

                    CREATE TABLE IF NOT EXISTS knowledge_chunks (
                        id TEXT PRIMARY KEY,
                        document_id TEXT NOT NULL,
                        chunk_index INTEGER NOT NULL,
                        content TEXT NOT NULL,
                        embedding_json TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        FOREIGN KEY (document_id) REFERENCES knowledge_documents(id) ON DELETE CASCADE
                    );

                    CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_document_id
                        ON knowledge_chunks(document_id);

                    CREATE TABLE IF NOT EXISTS folders (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL UNIQUE,
                        color TEXT NOT NULL DEFAULT 'sand',
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    );

                    CREATE TABLE IF NOT EXISTS folder_documents (
                        id TEXT PRIMARY KEY,
                        folder_id TEXT NOT NULL,
                        filename TEXT NOT NULL,
                        content_hash TEXT NOT NULL,
                        size_bytes INTEGER NOT NULL,
                        mime_type TEXT,
                        chunk_count INTEGER NOT NULL,
                        created_at TEXT NOT NULL,
                        FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE,
                        UNIQUE(folder_id, content_hash)
                    );

                    CREATE TABLE IF NOT EXISTS folder_chunks (
                        id TEXT PRIMARY KEY,
                        document_id TEXT NOT NULL,
                        chunk_index INTEGER NOT NULL,
                        content TEXT NOT NULL,
                        embedding_json TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        FOREIGN KEY (document_id) REFERENCES folder_documents(id) ON DELETE CASCADE
                    );

                    CREATE INDEX IF NOT EXISTS idx_folder_documents_folder_id
                        ON folder_documents(folder_id);

                    CREATE INDEX IF NOT EXISTS idx_folder_chunks_document_id
                        ON folder_chunks(document_id);

                    CREATE TABLE IF NOT EXISTS conversations (
                        id TEXT PRIMARY KEY,
                        title TEXT NOT NULL,
                        folder_id TEXT,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        last_message_at TEXT NOT NULL,
                        last_message_preview TEXT NOT NULL,
                        message_count INTEGER NOT NULL DEFAULT 0,
                        FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE
                    );

                    CREATE INDEX IF NOT EXISTS idx_conversations_folder_id
                        ON conversations(folder_id);

                    CREATE INDEX IF NOT EXISTS idx_conversations_last_message_at
                        ON conversations(last_message_at DESC);

                    CREATE TABLE IF NOT EXISTS conversation_messages (
                        id TEXT PRIMARY KEY,
                        conversation_id TEXT NOT NULL,
                        role TEXT NOT NULL,
                        content TEXT NOT NULL,
                        model_used TEXT,
                        sources_json TEXT,
                        created_at TEXT NOT NULL,
                        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
                    );

                    CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation_id
                        ON conversation_messages(conversation_id, created_at);
                    """
                )
                columns = {
                    row["name"]
                    for row in conn.execute("PRAGMA table_info(folders)").fetchall()
                }
                if "color" not in columns:
                    conn.execute(
                        f"""
                        ALTER TABLE folders
                        ADD COLUMN color TEXT NOT NULL DEFAULT '{DEFAULT_FOLDER_COLOR}'
                        """
                    )
                conn.execute(
                    """
                    UPDATE folders
                    SET color = ?
                    WHERE color IS NULL OR TRIM(color) = ''
                    """,
                    (DEFAULT_FOLDER_COLOR,),
                )
                conn.commit()

    def _current_ts(self) -> str:
        return str(int(time.time()))

    def get_document_by_hash(self, content_hash: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            with self._connect() as conn:
                row = conn.execute(
                    """
                    SELECT id, filename, content_hash, size_bytes, mime_type, chunk_count, created_at
                    FROM knowledge_documents
                    WHERE content_hash = ?
                    """,
                    (content_hash,),
                ).fetchone()
                return dict(row) if row else None

    def get_folder_document_by_hash(
        self, folder_id: str, content_hash: str
    ) -> Optional[Dict[str, Any]]:
        with self._lock:
            with self._connect() as conn:
                row = conn.execute(
                    """
                    SELECT id, folder_id, filename, content_hash, size_bytes, mime_type, chunk_count, created_at
                    FROM folder_documents
                    WHERE folder_id = ? AND content_hash = ?
                    """,
                    (folder_id, content_hash),
                ).fetchone()
                return dict(row) if row else None

    def insert_document_with_chunks(
        self,
        *,
        filename: str,
        content_hash: str,
        size_bytes: int,
        mime_type: Optional[str],
        chunks: List[str],
        embeddings: List[List[float]],
    ) -> Dict[str, Any]:
        if len(chunks) != len(embeddings):
            raise ValueError("Chunks and embeddings length mismatch")

        now = self._current_ts()
        document_id = str(uuid4())

        with self._lock:
            with self._connect() as conn:
                conn.execute(
                    """
                    INSERT INTO knowledge_documents (
                        id, filename, content_hash, size_bytes, mime_type, chunk_count, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        document_id,
                        filename,
                        content_hash,
                        size_bytes,
                        mime_type,
                        len(chunks),
                        now,
                    ),
                )

                for index, (chunk_text, embedding) in enumerate(zip(chunks, embeddings)):
                    conn.execute(
                        """
                        INSERT INTO knowledge_chunks (
                            id, document_id, chunk_index, content, embedding_json, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?)
                        """,
                        (
                            str(uuid4()),
                            document_id,
                            index,
                            chunk_text,
                            json.dumps(embedding),
                            now,
                        ),
                    )

                conn.commit()

        return {
            "id": document_id,
            "filename": filename,
            "content_hash": content_hash,
            "size_bytes": size_bytes,
            "mime_type": mime_type,
            "chunk_count": len(chunks),
            "created_at": now,
        }

    def insert_folder_document_with_chunks(
        self,
        *,
        folder_id: str,
        filename: str,
        content_hash: str,
        size_bytes: int,
        mime_type: Optional[str],
        chunks: List[str],
        embeddings: List[List[float]],
    ) -> Dict[str, Any]:
        if len(chunks) != len(embeddings):
            raise ValueError("Chunks and embeddings length mismatch")

        now = self._current_ts()
        document_id = str(uuid4())

        with self._lock:
            with self._connect() as conn:
                folder = conn.execute(
                    "SELECT id FROM folders WHERE id = ?",
                    (folder_id,),
                ).fetchone()
                if folder is None:
                    raise ValueError("Folder not found")

                conn.execute(
                    """
                    INSERT INTO folder_documents (
                        id, folder_id, filename, content_hash, size_bytes, mime_type, chunk_count, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        document_id,
                        folder_id,
                        filename,
                        content_hash,
                        size_bytes,
                        mime_type,
                        len(chunks),
                        now,
                    ),
                )

                for index, (chunk_text, embedding) in enumerate(zip(chunks, embeddings)):
                    conn.execute(
                        """
                        INSERT INTO folder_chunks (
                            id, document_id, chunk_index, content, embedding_json, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?)
                        """,
                        (
                            str(uuid4()),
                            document_id,
                            index,
                            chunk_text,
                            json.dumps(embedding),
                            now,
                        ),
                    )

                conn.commit()

        return {
            "id": document_id,
            "folder_id": folder_id,
            "filename": filename,
            "content_hash": content_hash,
            "size_bytes": size_bytes,
            "mime_type": mime_type,
            "chunk_count": len(chunks),
            "created_at": now,
        }

    def list_documents(self) -> List[Dict[str, Any]]:
        with self._lock:
            with self._connect() as conn:
                rows = conn.execute(
                    """
                    SELECT id, filename, content_hash, size_bytes, mime_type, chunk_count, created_at
                    FROM knowledge_documents
                    ORDER BY created_at DESC
                    """
                ).fetchall()
                return [dict(row) for row in rows]

    def list_folder_documents(self, folder_id: str) -> List[Dict[str, Any]]:
        with self._lock:
            with self._connect() as conn:
                rows = conn.execute(
                    """
                    SELECT id, folder_id, filename, content_hash, size_bytes, mime_type, chunk_count, created_at
                    FROM folder_documents
                    WHERE folder_id = ?
                    ORDER BY created_at DESC
                    """,
                    (folder_id,),
                ).fetchall()
                return [dict(row) for row in rows]

    def delete_document(self, document_id: str) -> Dict[str, Any]:
        with self._lock:
            with self._connect() as conn:
                row = conn.execute(
                    "SELECT chunk_count FROM knowledge_documents WHERE id = ?",
                    (document_id,),
                ).fetchone()
                if row is None:
                    return {"deleted": False, "chunk_count": 0}

                chunk_count = int(row["chunk_count"])
                conn.execute("DELETE FROM knowledge_chunks WHERE document_id = ?", (document_id,))
                conn.execute("DELETE FROM knowledge_documents WHERE id = ?", (document_id,))
                conn.commit()
                return {"deleted": True, "chunk_count": chunk_count}

    def delete_folder_document(self, folder_id: str, document_id: str) -> Dict[str, Any]:
        with self._lock:
            with self._connect() as conn:
                row = conn.execute(
                    """
                    SELECT chunk_count
                    FROM folder_documents
                    WHERE id = ? AND folder_id = ?
                    """,
                    (document_id, folder_id),
                ).fetchone()
                if row is None:
                    return {"deleted": False, "chunk_count": 0}

                chunk_count = int(row["chunk_count"])
                conn.execute("DELETE FROM folder_chunks WHERE document_id = ?", (document_id,))
                conn.execute(
                    "DELETE FROM folder_documents WHERE id = ? AND folder_id = ?",
                    (document_id, folder_id),
                )
                conn.commit()
                return {"deleted": True, "chunk_count": chunk_count}

    def get_all_chunks(self) -> List[Dict[str, Any]]:
        with self._lock:
            with self._connect() as conn:
                rows = conn.execute(
                    """
                    SELECT
                        c.id,
                        c.document_id,
                        c.chunk_index,
                        c.content,
                        c.embedding_json,
                        d.filename
                    FROM knowledge_chunks c
                    JOIN knowledge_documents d ON c.document_id = d.id
                    """
                ).fetchall()
                return [dict(row) for row in rows]

    def get_folder_chunks(self, folder_id: str) -> List[Dict[str, Any]]:
        with self._lock:
            with self._connect() as conn:
                rows = conn.execute(
                    """
                    SELECT
                        c.id,
                        d.id AS document_id,
                        d.folder_id AS folder_id,
                        f.name AS folder_name,
                        c.chunk_index,
                        c.content,
                        c.embedding_json,
                        d.filename
                    FROM folder_chunks c
                    JOIN folder_documents d ON c.document_id = d.id
                    JOIN folders f ON d.folder_id = f.id
                    WHERE d.folder_id = ?
                    """,
                    (folder_id,),
                ).fetchall()
                return [dict(row) for row in rows]

    def list_folders(self) -> List[Dict[str, Any]]:
        with self._lock:
            with self._connect() as conn:
                rows = conn.execute(
                    """
                    SELECT
                        f.id,
                        f.name,
                        f.color,
                        f.created_at,
                        f.updated_at,
                        COALESCE(cc.chat_count, 0) AS chat_count,
                        COALESCE(dc.document_count, 0) AS document_count
                    FROM folders f
                    LEFT JOIN (
                        SELECT folder_id, COUNT(*) AS chat_count
                        FROM conversations
                        WHERE folder_id IS NOT NULL
                        GROUP BY folder_id
                    ) cc ON cc.folder_id = f.id
                    LEFT JOIN (
                        SELECT folder_id, COUNT(*) AS document_count
                        FROM folder_documents
                        GROUP BY folder_id
                    ) dc ON dc.folder_id = f.id
                    ORDER BY f.updated_at DESC, f.created_at DESC
                    """
                ).fetchall()
                return [dict(row) for row in rows]

    def get_folder(self, folder_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            with self._connect() as conn:
                row = conn.execute(
                    """
                    SELECT id, name, color, created_at, updated_at
                    FROM folders
                    WHERE id = ?
                    """,
                    (folder_id,),
                ).fetchone()
                return dict(row) if row else None

    def create_folder(self, name: str, color: str) -> Dict[str, Any]:
        now = self._current_ts()
        folder_id = str(uuid4())

        with self._lock:
            with self._connect() as conn:
                conn.execute(
                    """
                    INSERT INTO folders (id, name, color, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (folder_id, name.strip(), color, now, now),
                )
                conn.commit()

        return {
            "id": folder_id,
            "name": name.strip(),
            "color": color,
            "created_at": now,
            "updated_at": now,
            "chat_count": 0,
            "document_count": 0,
        }

    def update_folder(
        self,
        folder_id: str,
        *,
        name: Optional[str] = None,
        color: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        now = self._current_ts()
        with self._lock:
            with self._connect() as conn:
                assignments: List[str] = []
                params: List[Any] = []

                if name is not None:
                    assignments.append("name = ?")
                    params.append(name.strip())

                if color is not None:
                    assignments.append("color = ?")
                    params.append(color)

                assignments.append("updated_at = ?")
                params.append(now)
                params.append(folder_id)

                result = conn.execute(
                    f"""
                    UPDATE folders
                    SET {", ".join(assignments)}
                    WHERE id = ?
                    """,
                    tuple(params),
                )
                conn.commit()
                if result.rowcount == 0:
                    return None

                row = conn.execute(
                    """
                    SELECT id, name, color, created_at, updated_at
                    FROM folders
                    WHERE id = ?
                    """,
                    (folder_id,),
                ).fetchone()
                if row is None:
                    return None

                chat_count = conn.execute(
                    "SELECT COUNT(*) AS count FROM conversations WHERE folder_id = ?",
                    (folder_id,),
                ).fetchone()["count"]
                document_count = conn.execute(
                    "SELECT COUNT(*) AS count FROM folder_documents WHERE folder_id = ?",
                    (folder_id,),
                ).fetchone()["count"]

                data = dict(row)
                data["chat_count"] = int(chat_count)
                data["document_count"] = int(document_count)
                return data

    def delete_folder(self, folder_id: str) -> Dict[str, Any]:
        with self._lock:
            with self._connect() as conn:
                exists = conn.execute(
                    "SELECT id FROM folders WHERE id = ?",
                    (folder_id,),
                ).fetchone()
                if exists is None:
                    return {
                        "deleted": False,
                        "conversations_deleted": 0,
                        "documents_deleted": 0,
                        "chunks_deleted": 0,
                    }

                conversations_deleted = int(
                    conn.execute(
                        "SELECT COUNT(*) AS count FROM conversations WHERE folder_id = ?",
                        (folder_id,),
                    ).fetchone()["count"]
                )
                documents_deleted = int(
                    conn.execute(
                        "SELECT COUNT(*) AS count FROM folder_documents WHERE folder_id = ?",
                        (folder_id,),
                    ).fetchone()["count"]
                )
                chunks_deleted = int(
                    conn.execute(
                        """
                        SELECT COUNT(*) AS count
                        FROM folder_chunks c
                        JOIN folder_documents d ON c.document_id = d.id
                        WHERE d.folder_id = ?
                        """,
                        (folder_id,),
                    ).fetchone()["count"]
                )

                conn.execute("DELETE FROM folders WHERE id = ?", (folder_id,))
                conn.commit()
                return {
                    "deleted": True,
                    "conversations_deleted": conversations_deleted,
                    "documents_deleted": documents_deleted,
                    "chunks_deleted": chunks_deleted,
                }

    def _conversation_summary_row(
        self, conn: sqlite3.Connection, conversation_id: str
    ) -> Optional[Dict[str, Any]]:
        row = conn.execute(
            """
            SELECT
                c.id,
                c.title,
                c.folder_id,
                f.name AS folder_name,
                c.created_at,
                c.updated_at,
                c.last_message_at,
                c.last_message_preview,
                c.message_count
            FROM conversations c
            LEFT JOIN folders f ON f.id = c.folder_id
            WHERE c.id = ?
            """,
            (conversation_id,),
        ).fetchone()
        return dict(row) if row else None

    def list_conversations(self) -> List[Dict[str, Any]]:
        with self._lock:
            with self._connect() as conn:
                rows = conn.execute(
                    """
                    SELECT
                        c.id,
                        c.title,
                        c.folder_id,
                        f.name AS folder_name,
                        c.created_at,
                        c.updated_at,
                        c.last_message_at,
                        c.last_message_preview,
                        c.message_count
                    FROM conversations c
                    LEFT JOIN folders f ON f.id = c.folder_id
                    ORDER BY c.last_message_at DESC, c.updated_at DESC
                    """
                ).fetchall()
                return [dict(row) for row in rows]

    def create_conversation(self, folder_id: Optional[str]) -> Dict[str, Any]:
        now = self._current_ts()
        conversation_id = str(uuid4())

        with self._lock:
            with self._connect() as conn:
                if folder_id:
                    folder = conn.execute(
                        "SELECT id FROM folders WHERE id = ?",
                        (folder_id,),
                    ).fetchone()
                    if folder is None:
                        raise ValueError("Folder not found")

                conn.execute(
                    """
                    INSERT INTO conversations (
                        id, title, folder_id, created_at, updated_at, last_message_at, last_message_preview, message_count
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        conversation_id,
                        "New chat",
                        folder_id,
                        now,
                        now,
                        now,
                        "",
                        0,
                    ),
                )
                conn.commit()

                summary = self._conversation_summary_row(conn, conversation_id)
                if summary is None:
                    raise ValueError("Failed to create conversation")
                return summary

    def get_conversation(self, conversation_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            with self._connect() as conn:
                return self._conversation_summary_row(conn, conversation_id)

    def get_conversation_folder_id(self, conversation_id: str) -> Optional[str]:
        with self._lock:
            with self._connect() as conn:
                row = conn.execute(
                    "SELECT folder_id FROM conversations WHERE id = ?",
                    (conversation_id,),
                ).fetchone()
                if row is None:
                    return None
                return row["folder_id"]

    def get_conversation_messages(self, conversation_id: str) -> List[Dict[str, Any]]:
        with self._lock:
            with self._connect() as conn:
                rows = conn.execute(
                    """
                    SELECT id, conversation_id, role, content, model_used, sources_json, created_at
                    FROM conversation_messages
                    WHERE conversation_id = ?
                    ORDER BY created_at ASC, rowid ASC
                    """,
                    (conversation_id,),
                ).fetchall()

                messages: List[Dict[str, Any]] = []
                for row in rows:
                    item = dict(row)
                    sources_json = item.pop("sources_json")
                    try:
                        item["sources"] = json.loads(sources_json) if sources_json else []
                    except Exception:
                        item["sources"] = []
                    messages.append(item)
                return messages

    def update_conversation(
        self,
        conversation_id: str,
        *,
        title: Optional[str] = None,
        set_folder: bool = False,
        folder_id: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        with self._lock:
            with self._connect() as conn:
                exists = conn.execute(
                    "SELECT id FROM conversations WHERE id = ?",
                    (conversation_id,),
                ).fetchone()
                if exists is None:
                    return None

                assignments: List[str] = []
                params: List[Any] = []

                if title is not None:
                    assignments.append("title = ?")
                    params.append(title.strip())

                if set_folder:
                    if folder_id is not None:
                        folder = conn.execute(
                            "SELECT id FROM folders WHERE id = ?",
                            (folder_id,),
                        ).fetchone()
                        if folder is None:
                            raise ValueError("Folder not found")
                    assignments.append("folder_id = ?")
                    params.append(folder_id)

                if not assignments:
                    return self._conversation_summary_row(conn, conversation_id)

                assignments.append("updated_at = ?")
                params.append(self._current_ts())
                params.append(conversation_id)

                conn.execute(
                    f"UPDATE conversations SET {', '.join(assignments)} WHERE id = ?",
                    tuple(params),
                )
                conn.commit()
                return self._conversation_summary_row(conn, conversation_id)

    def delete_conversation(self, conversation_id: str) -> Dict[str, Any]:
        with self._lock:
            with self._connect() as conn:
                row = conn.execute(
                    "SELECT id FROM conversations WHERE id = ?",
                    (conversation_id,),
                ).fetchone()
                if row is None:
                    return {"deleted": False}

                conn.execute(
                    "DELETE FROM conversations WHERE id = ?",
                    (conversation_id,),
                )
                conn.commit()
                return {"deleted": True}

    def _derive_title_from_message(self, user_message: str) -> str:
        normalized = " ".join(user_message.strip().split())
        if not normalized:
            return "New chat"
        if len(normalized) <= 60:
            return normalized
        return f"{normalized[:57].rstrip()}..."

    def append_turn(
        self,
        conversation_id: str,
        *,
        user_message: str,
        assistant_message: str,
        model_used: Optional[str],
        sources: Optional[List[Dict[str, Any]]],
    ) -> Optional[Dict[str, Any]]:
        now = self._current_ts()

        with self._lock:
            with self._connect() as conn:
                conversation = conn.execute(
                    "SELECT title, message_count FROM conversations WHERE id = ?",
                    (conversation_id,),
                ).fetchone()
                if conversation is None:
                    return None

                conn.execute(
                    """
                    INSERT INTO conversation_messages (
                        id, conversation_id, role, content, model_used, sources_json, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        str(uuid4()),
                        conversation_id,
                        "user",
                        user_message,
                        None,
                        None,
                        now,
                    ),
                )

                conn.execute(
                    """
                    INSERT INTO conversation_messages (
                        id, conversation_id, role, content, model_used, sources_json, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        str(uuid4()),
                        conversation_id,
                        "assistant",
                        assistant_message,
                        model_used,
                        json.dumps(sources or []),
                        now,
                    ),
                )

                title = str(conversation["title"])
                message_count = int(conversation["message_count"])
                next_title = title
                if title == "New chat" and message_count == 0:
                    next_title = self._derive_title_from_message(user_message)

                preview = " ".join(assistant_message.strip().split())[:200]

                conn.execute(
                    """
                    UPDATE conversations
                    SET
                        title = ?,
                        updated_at = ?,
                        last_message_at = ?,
                        last_message_preview = ?,
                        message_count = message_count + 2
                    WHERE id = ?
                    """,
                    (next_title, now, now, preview, conversation_id),
                )
                conn.commit()
                return self._conversation_summary_row(conn, conversation_id)


PROMPTS_DIR = Path(__file__).parent / "prompts"
BASE_PROMPT = ""
MODE_PROMPTS: Dict[str, str] = {}
KNOWLEDGE_STORE: Optional[KnowledgeStore] = None


def resolve_data_dir() -> Path:
    env_data_dir = os.getenv("VESTA_DATA_DIR")
    if env_data_dir:
        return Path(env_data_dir).expanduser().resolve()
    return (Path.home() / ".vesta").resolve()


def get_knowledge_store() -> KnowledgeStore:
    global KNOWLEDGE_STORE
    if KNOWLEDGE_STORE is None:
        KNOWLEDGE_STORE = KnowledgeStore(resolve_data_dir())
    return KNOWLEDGE_STORE


def chunk_text(text: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> List[str]:
    cleaned = "\n".join(line.strip() for line in text.splitlines() if line.strip())
    if not cleaned:
        return []

    chunks: List[str] = []
    step = max(size - overlap, 1)
    start = 0
    while start < len(cleaned):
        chunk = cleaned[start : start + size].strip()
        if chunk:
            chunks.append(chunk)
        if start + size >= len(cleaned):
            break
        start += step
    return chunks


def cosine_similarity(vec_a: List[float], vec_b: List[float]) -> float:
    if len(vec_a) != len(vec_b):
        return 0.0

    dot = sum(a * b for a, b in zip(vec_a, vec_b))
    norm_a = math.sqrt(sum(a * a for a in vec_a))
    norm_b = math.sqrt(sum(b * b for b in vec_b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def looks_like_text(decoded_text: str) -> bool:
    if not decoded_text:
        return False
    sample = decoded_text[:2000]
    printable = sum(ch.isprintable() or ch in "\n\r\t" for ch in sample)
    ratio = printable / max(len(sample), 1)
    return ratio >= 0.85


def normalize_folder_color(color: Optional[str]) -> str:
    if color is None:
        return DEFAULT_FOLDER_COLOR

    normalized = color.strip().lower()
    if normalized not in FOLDER_COLOR_OPTIONS:
        raise ValueError("Invalid folder color")
    return normalized


async def embed_texts(inputs: List[str], model_name: str = EMBEDDING_MODEL) -> List[List[float]]:
    if not inputs:
        return []

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            f"{OLLAMA_BASE_URL}/api/embed",
            json={"model": model_name, "input": inputs},
        )

    if response.status_code != 200:
        raise RuntimeError(f"Embedding request failed with status {response.status_code}")

    data = response.json()
    embeddings = data.get("embeddings")
    if not isinstance(embeddings, list):
        raise RuntimeError("Embedding response missing 'embeddings'")
    return embeddings


async def embed_in_batches(chunks: List[str], batch_size: int = 24) -> List[List[float]]:
    vectors: List[List[float]] = []
    for start in range(0, len(chunks), batch_size):
        batch = chunks[start : start + batch_size]
        vectors.extend(await embed_texts(batch))
    return vectors


def extract_pdf_text(content: bytes) -> str:
    """Extract text from PDF."""
    try:
        import PyPDF2

        pdf_file = io.BytesIO(content)
        reader = PyPDF2.PdfReader(pdf_file)
        text = ""
        for page in reader.pages:
            page_text = page.extract_text() or ""
            text += page_text + "\n"
        return text.strip()
    except ImportError:
        return "[PDF processing unavailable - PyPDF2 not installed]"
    except Exception as e:
        return f"[Error extracting PDF: {str(e)}]"


def extract_docx_text(content: bytes) -> str:
    """Extract text from DOCX."""
    try:
        import docx

        doc_file = io.BytesIO(content)
        doc = docx.Document(doc_file)
        text = "\n".join([paragraph.text for paragraph in doc.paragraphs])
        return text.strip()
    except ImportError:
        return "[DOCX processing unavailable - python-docx not installed]"
    except Exception as e:
        return f"[Error extracting DOCX: {str(e)}]"


def extract_csv_text(content: bytes) -> str:
    """Extract text from CSV as markdown table."""
    try:
        csv_file = io.StringIO(content.decode("utf-8", errors="ignore"))
        reader = csv.reader(csv_file)
        rows = list(reader)

        if not rows:
            return "[Empty CSV file]"

        text = "| " + " | ".join(rows[0]) + " |\n"
        text += "| " + " | ".join(["---"] * len(rows[0])) + " |\n"
        for row in rows[1:]:
            text += "| " + " | ".join(row) + " |\n"
        return text
    except Exception as e:
        return f"[Error extracting CSV: {str(e)}]"


def extract_excel_text(content: bytes) -> str:
    """Extract text from Excel files."""
    try:
        import openpyxl

        excel_file = io.BytesIO(content)
        workbook = openpyxl.load_workbook(excel_file, read_only=True)

        text = ""
        for sheet_name in workbook.sheetnames:
            sheet = workbook[sheet_name]
            text += f"\n=== Sheet: {sheet_name} ===\n\n"

            rows = []
            for row in sheet.iter_rows(values_only=True, max_row=100):
                rows.append([str(cell) if cell is not None else "" for cell in row])

            if rows:
                text += "| " + " | ".join(rows[0]) + " |\n"
                text += "| " + " | ".join(["---"] * len(rows[0])) + " |\n"
                for row in rows[1:]:
                    text += "| " + " | ".join(row) + " |\n"

        return text.strip()
    except ImportError:
        return "[Excel processing unavailable - openpyxl not installed]"
    except Exception as e:
        return f"[Error extracting Excel: {str(e)}]"


def extract_text_for_knowledge(filename: str, content: bytes) -> Tuple[Optional[str], Optional[str]]:
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    if extension == "pdf":
        extracted = extract_pdf_text(content)
        return (extracted, None) if extracted else (None, "No text extracted from PDF")
    if extension in ["docx", "doc"]:
        extracted = extract_docx_text(content)
        return (extracted, None) if extracted else (None, "No text extracted from document")
    if extension == "csv":
        extracted = extract_csv_text(content)
        return (extracted, None) if extracted else (None, "No text extracted from CSV")
    if extension == "txt":
        extracted = content.decode("utf-8", errors="ignore").strip()
        return (extracted, None) if extracted else (None, "Text file is empty")
    if extension in ["xlsx", "xls"]:
        extracted = extract_excel_text(content)
        return (extracted, None) if extracted else (None, "No text extracted from spreadsheet")

    decoded = content.decode("utf-8", errors="ignore").strip()
    if decoded and looks_like_text(decoded):
        return decoded, None

    return None, "Unsupported or non-text binary file"


async def retrieve_knowledge_context(
    query: str, folder_id: Optional[str] = None
) -> Tuple[str, List[Dict[str, Any]]]:
    store = get_knowledge_store()
    global_chunks = store.get_all_chunks()
    folder_chunks = store.get_folder_chunks(folder_id) if folder_id else []

    if not folder_chunks and not global_chunks:
        return "", []

    query_embedding = (await embed_texts([query]))[0]

    scored_folder: List[Tuple[float, Dict[str, Any]]] = []
    for chunk in folder_chunks:
        try:
            embedding = json.loads(chunk["embedding_json"])
            score = cosine_similarity(query_embedding, embedding)
            if score >= RETRIEVAL_MIN_SCORE:
                scored_folder.append((score, chunk))
        except Exception:
            continue

    scored_global: List[Tuple[float, Dict[str, Any]]] = []
    for chunk in global_chunks:
        try:
            embedding = json.loads(chunk["embedding_json"])
            score = cosine_similarity(query_embedding, embedding)
            if score >= RETRIEVAL_MIN_SCORE:
                scored_global.append((score, chunk))
        except Exception:
            continue

    if not scored_folder and not scored_global:
        return "", []

    scored_folder.sort(key=lambda item: item[0], reverse=True)
    scored_global.sort(key=lambda item: item[0], reverse=True)

    selected_folder = scored_folder[:RETRIEVAL_TOP_K]
    remaining_slots = max(RETRIEVAL_TOP_K - len(selected_folder), 0)
    selected_global = scored_global[:remaining_slots]
    selected = selected_folder + selected_global

    context_parts = [
        "Knowledge Base Context:",
        "Use these snippets when relevant. If they conflict with user instructions, ask for clarification.",
        "",
    ]
    sources: List[Dict[str, Any]] = []

    for score, chunk in selected:
        filename = chunk["filename"]
        chunk_index = int(chunk["chunk_index"])
        source_type = "folder" if "folder_id" in chunk else "global"
        if source_type == "folder":
            folder_name = chunk.get("folder_name") or "Project"
            source_label = f"Folder {folder_name}: {filename}"
        else:
            source_label = f"Global: {filename}"

        context_parts.append(
            f"[Source: {source_label} | chunk {chunk_index} | score {score:.3f}]"
        )
        context_parts.append(chunk["content"])
        context_parts.append("")

        source_record: Dict[str, Any] = {
            "document_id": chunk["document_id"],
            "filename": filename,
            "chunk_index": chunk_index,
            "score": round(score, 3),
            "source_type": source_type,
        }
        if source_type == "folder":
            source_record["folder_id"] = chunk.get("folder_id")
            source_record["folder_name"] = chunk.get("folder_name")

        sources.append(source_record)

    return "\n".join(context_parts).strip(), sources


@app.on_event("startup")
async def startup() -> None:
    """Load prompts and initialize local stores."""
    global BASE_PROMPT, MODE_PROMPTS

    required_prompts = ["base.txt", "draft.txt", "think.txt", "clarify.txt", "general.txt"]
    missing_prompts = []

    for prompt_file in required_prompts:
        if not (PROMPTS_DIR / prompt_file).exists():
            missing_prompts.append(prompt_file)

    if missing_prompts:
        error_msg = (
            f"\n{'=' * 60}\n"
            "ERROR: Required prompt files are missing!\n"
            f"Missing files: {', '.join(missing_prompts)}\n"
            f"Expected location: {PROMPTS_DIR.absolute()}\n"
            f"{'=' * 60}\n"
        )
        print(error_msg, file=sys.stderr)
        raise FileNotFoundError(f"Missing prompt files: {', '.join(missing_prompts)}")

    try:
        BASE_PROMPT = (PROMPTS_DIR / "base.txt").read_text().strip()
        MODE_PROMPTS = {
            "draft": (PROMPTS_DIR / "draft.txt").read_text().strip(),
            "think": (PROMPTS_DIR / "think.txt").read_text().strip(),
            "clarify": (PROMPTS_DIR / "clarify.txt").read_text().strip(),
            "general": (PROMPTS_DIR / "general.txt").read_text().strip(),
        }

        get_knowledge_store()
        print(f"Successfully loaded {len(MODE_PROMPTS) + 1} prompt files from {PROMPTS_DIR}")
    except Exception as e:
        print(f"Error during startup initialization: {e}", file=sys.stderr)
        raise


async def route_to_model(
    message: str,
    mode: str,
    history: List[ChatMessage],
    last_model_used: Optional[str] = None,
) -> RoutingDecision:
    """
    VESTA-compliant routing with coherence framework analysis.

    Returns: RoutingDecision with full audit trail
    """
    start_time = time.time()

    history_dicts = [{"role": msg.role, "content": msg.content} for msg in history]

    signals = analyze_message_signals(message, mode, history_dicts)
    task_context = analyze_task_context(history_dicts, message)

    upgraded_model = should_upgrade_model(message, history_dicts, last_model_used)
    if upgraded_model:
        _latency_ms = (time.time() - start_time) * 1000
        return RoutingDecision(
            model=upgraded_model,
            method="refinement_upgrade",
            reasoning=f"User requested refinement, upgrading from {last_model_used}",
            signals=signals,
            task_context=task_context,
            confidence=0.95,
            fallback_used=False,
        )

    decision = fast_route(signals, mode, task_context)
    if decision:
        _latency_ms = (time.time() - start_time) * 1000
        return decision

    try:
        decision = await llm_route(message, mode, signals, task_context, history)
        _latency_ms = (time.time() - start_time) * 1000
        return decision
    except Exception as e:
        _latency_ms = (time.time() - start_time) * 1000
        fallback_model = get_fallback_model(mode)

        log_routing_error(message, mode, e, fallback_model)

        return RoutingDecision(
            model=fallback_model,
            method="fallback",
            reasoning="Routing error, using mode-based fallback",
            signals=signals,
            task_context=task_context,
            confidence=0.5,
            fallback_used=True,
        )


async def llm_route(
    message: str,
    mode: str,
    signals: Any,
    task_context: Any,
    history: List[ChatMessage],
) -> RoutingDecision:
    """
    LLM-based routing for ambiguous cases.
    Enhanced with coherence framework signals.
    """
    routing_prompt = f"""Analyze this user query and determine which AI model should handle it.

Available models:
- hymetalab/vesta-lite: For simple, straightforward questions, quick clarifications, basic information retrieval
- hymetalab/vesta-general: For standard tasks, moderate complexity, general conversation, typical problem-solving
- hymetalab/vesta-deep: For complex reasoning, deep analysis, nuanced thinking, difficult problems requiring extensive reasoning

User's selected mode: {mode}
Message context: {len(history)} previous messages

Coherence Analysis:
- Energy (computational complexity): {signals.energy:.2f}
- Information (context integration): {signals.information:.2f}
- Connection (relational depth): {signals.connection:.2f}
- Noise tolerance: {signals.noise_tolerance:.2f}

Task Context:
- Is continuation: {task_context.is_continuation}
- Task depth: {task_context.depth}
- Requires consistency: {task_context.requires_consistency}
- Complexity trend: {task_context.complexity_trend}

User query: {message}

Consider all factors and respond with ONLY a JSON object:
{{"model": "lite|general|deep", "reasoning": "brief explanation", "confidence": 0.0-1.0}}"""

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{OLLAMA_BASE_URL}/api/generate",
            json={
                "model": "hymetalab/vesta-general",
                "prompt": routing_prompt,
                "temperature": 0.3,
                "stream": False,
            },
        )

    if response.status_code == 200:
        result = response.json()
        response_text = result.get("response", "").strip()

        start = response_text.find("{")
        end = response_text.rfind("}") + 1
        if start >= 0 and end > start:
            json_str = response_text[start:end]
            decision_data = json.loads(json_str)

            selected_model = decision_data.get("model", "general")
            reasoning = decision_data.get("reasoning", "LLM routing decision")
            confidence = decision_data.get("confidence", 0.7)

            if selected_model in ["lite", "general", "deep"]:
                return RoutingDecision(
                    model=selected_model,
                    method="llm",
                    reasoning=reasoning,
                    signals=signals,
                    task_context=task_context,
                    confidence=float(confidence),
                    fallback_used=False,
                )

    raise ValueError("Invalid LLM routing response")


def get_fallback_model(mode: str) -> str:
    """Get fallback model based on mode."""
    fallbacks = {
        "think": "deep",
        "draft": "general",
        "clarify": "general",
        "general": "general",
    }
    return fallbacks.get(mode, "general")


def build_conversation_context(
    messages: List[ChatMessage],
    mode_prompt: str,
    current_message: str,
    knowledge_context: str = "",
) -> str:
    """Build the full conversation context including history and optional retrieved knowledge."""
    context_parts = [BASE_PROMPT, "", mode_prompt, ""]

    if knowledge_context:
        context_parts.extend([knowledge_context, ""])

    if messages:
        context_parts.append("Previous conversation:")
        for msg in messages[-10:]:
            prefix = "User: " if msg.role == "user" else "Assistant: "
            context_parts.append(f"{prefix}{msg.content}")
        context_parts.append("")

    context_parts.append(f"User: {current_message}")

    return "\n".join(context_parts)


async def stream_ollama_response(
    model_name: str,
    prompt: str,
    sources: Optional[List[Dict[str, Any]]] = None,
):
    """Stream response from Ollama and emit source metadata first."""
    metadata_payload = {"metadata": {"sources": sources or []}}
    yield f"data: {json.dumps(metadata_payload)}\n\n"

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            async with client.stream(
                "POST",
                f"{OLLAMA_BASE_URL}/api/generate",
                json={"model": model_name, "prompt": prompt, "stream": True},
            ) as response:
                if response.status_code != 200:
                    yield f"data: {json.dumps({'error': 'Ollama service unavailable'})}\n\n"
                    return

                async for line in response.aiter_lines():
                    if line.strip():
                        try:
                            data = json.loads(line)
                            if "response" in data:
                                chunk = {
                                    "content": data["response"],
                                    "done": data.get("done", False),
                                }
                                yield f"data: {json.dumps(chunk)}\n\n"

                                if data.get("done"):
                                    break
                        except json.JSONDecodeError:
                            continue

    except httpx.ConnectError:
        yield f"data: {json.dumps({'error': 'Cannot connect to Ollama'})}\n\n"
    except Exception as e:
        print(f"Streaming error: {e}", file=sys.stderr)
        yield f"data: {json.dumps({'error': 'Streaming failed'})}\n\n"


@app.post("/chat")
async def chat(request: ChatRequest):
    """
    Handle chat requests with context and streaming.
    Supports manual model selection or auto-routing with coherence framework.
    """
    try:
        start_time = time.time()
        routing_decision = None
        consistency_enforced = False

        if request.model == "auto":
            routing_decision = await route_to_model(
                request.message,
                request.mode,
                request.messages,
                request.last_model_used,
            )
            selected_model_key = routing_decision.model

            original_model = selected_model_key
            selected_model_key, was_upgraded = enforce_model_consistency(
                selected_model_key,
                [{"role": msg.role, "content": msg.content} for msg in request.messages],
                request.last_model_used,
            )

            if was_upgraded:
                consistency_enforced = True
                log_model_consistency_event(
                    original_model,
                    selected_model_key,
                    "Prevented mid-task downgrade",
                    len([m for m in request.messages if m.role == "user"]),
                )
        else:
            selected_model_key = request.model if request.model != "auto" else "general"

        model_name = MODEL_NAMES.get(selected_model_key, "hymetalab/vesta-general")

        if routing_decision:
            latency_ms = (time.time() - start_time) * 1000
            log_routing_decision(
                message=request.message,
                mode=request.mode,
                history_depth=len([m for m in request.messages if m.role == "user"]),
                signals={
                    "energy": routing_decision.signals.energy,
                    "information": routing_decision.signals.information,
                    "connection": routing_decision.signals.connection,
                    "noise_tolerance": routing_decision.signals.noise_tolerance,
                },
                task_context={
                    "is_continuation": routing_decision.task_context.is_continuation,
                    "is_new_task": routing_decision.task_context.is_new_task,
                    "depth": routing_decision.task_context.depth,
                    "requires_consistency": routing_decision.task_context.requires_consistency,
                    "complexity_trend": routing_decision.task_context.complexity_trend,
                    "task_type": routing_decision.task_context.task_type,
                },
                routing_method=routing_decision.method,
                selected_model=selected_model_key,
                reasoning=routing_decision.reasoning,
                confidence=routing_decision.confidence,
                fallback_used=routing_decision.fallback_used,
                latency_ms=latency_ms,
                last_model_used=request.last_model_used,
                consistency_enforced=consistency_enforced,
            )

        effective_folder_id = request.folder_id
        if effective_folder_id is None and request.conversation_id:
            effective_folder_id = get_knowledge_store().get_conversation_folder_id(
                request.conversation_id
            )

        knowledge_context = ""
        knowledge_sources: List[Dict[str, Any]] = []
        try:
            knowledge_context, knowledge_sources = await retrieve_knowledge_context(
                request.message, effective_folder_id
            )
        except Exception as retrieval_error:
            print(
                f"Knowledge retrieval warning: {type(retrieval_error).__name__}: {retrieval_error}",
                file=sys.stderr,
            )

        mode_prompt = MODE_PROMPTS.get(request.mode, "")
        full_prompt = build_conversation_context(
            request.messages,
            mode_prompt,
            request.message,
            knowledge_context,
        )

        response = StreamingResponse(
            stream_ollama_response(model_name, full_prompt, knowledge_sources),
            media_type="text/event-stream",
        )

        response.headers["X-Selected-Model"] = selected_model_key
        if routing_decision:
            response.headers["X-Routing-Method"] = routing_decision.method
            response.headers["X-Routing-Confidence"] = str(round(routing_decision.confidence, 2))

        return response

    except Exception as e:
        print(f"Unexpected error in chat endpoint: {type(e).__name__}: {e}", file=sys.stderr)
        raise HTTPException(
            status_code=500,
            detail="An error occurred processing your request.",
        )


@app.post("/upload")
async def upload_files(files: List[UploadFile] = File(...)):
    """
    Process uploaded files and extract text content.
    VESTA-compliant: Files are processed immediately and not stored.
    Returns extracted text for session-scoped context only.
    """
    extracted_content = []

    for file in files:
        try:
            content = await file.read()
            file_type = file.filename.split(".")[-1].lower() if "." in file.filename else ""

            if len(content) > MAX_CHAT_UPLOAD_SIZE:
                extracted_content.append(
                    {"filename": file.filename, "error": "File too large (max 10MB)"}
                )
                continue

            if file_type == "pdf":
                text = extract_pdf_text(content)
            elif file_type in ["docx", "doc"]:
                text = extract_docx_text(content)
            elif file_type in ["csv"]:
                text = extract_csv_text(content)
            elif file_type in ["txt"]:
                text = content.decode("utf-8", errors="ignore")
            elif file_type in ["xlsx", "xls"]:
                text = extract_excel_text(content)
            else:
                text = f"[Unsupported file type: {file_type}]"

            extracted_content.append(
                {
                    "filename": file.filename,
                    "content": text[:50000],
                    "size": len(content),
                }
            )
        except Exception as e:
            print(f"Error processing file {file.filename}: {e}", file=sys.stderr)
            extracted_content.append({"filename": file.filename, "error": str(e)})

    return {"files": extracted_content}


@app.post("/knowledge/files")
async def upload_knowledge_files(files: List[UploadFile] = File(...)):
    """Persist files for retrieval-augmented chat."""
    store = get_knowledge_store()
    results: List[Dict[str, Any]] = []

    for file in files:
        try:
            content = await file.read()
            if len(content) > MAX_KNOWLEDGE_UPLOAD_SIZE:
                results.append(
                    {
                        "filename": file.filename,
                        "status": "error",
                        "reason": "File too large (max 25MB)",
                    }
                )
                continue

            text, extraction_error = extract_text_for_knowledge(file.filename, content)
            if extraction_error:
                results.append(
                    {
                        "filename": file.filename,
                        "status": "unsupported",
                        "reason": extraction_error,
                    }
                )
                continue

            if not text:
                results.append(
                    {
                        "filename": file.filename,
                        "status": "unsupported",
                        "reason": "No text extracted from file",
                    }
                )
                continue

            trimmed_text = text[:MAX_KNOWLEDGE_TEXT_CHARS]
            chunks = chunk_text(trimmed_text)
            if not chunks:
                results.append(
                    {
                        "filename": file.filename,
                        "status": "unsupported",
                        "reason": "No meaningful text chunks could be produced",
                    }
                )
                continue

            content_hash = hashlib.sha256(content).hexdigest()
            duplicate = store.get_document_by_hash(content_hash)
            if duplicate:
                results.append(
                    {
                        "filename": file.filename,
                        "status": "duplicate",
                        "reason": "Document with identical content already indexed",
                        "document": duplicate,
                    }
                )
                continue

            embeddings = await embed_in_batches(chunks)
            document = store.insert_document_with_chunks(
                filename=file.filename,
                content_hash=content_hash,
                size_bytes=len(content),
                mime_type=file.content_type,
                chunks=chunks,
                embeddings=embeddings,
            )

            results.append(
                {
                    "filename": file.filename,
                    "status": "indexed",
                    "document": document,
                }
            )
        except Exception as e:
            print(f"Knowledge ingest error for {file.filename}: {e}", file=sys.stderr)
            results.append(
                {
                    "filename": file.filename,
                    "status": "error",
                    "reason": f"{type(e).__name__}: {e}",
                }
            )

    return {"results": results}


@app.get("/knowledge/files")
async def list_knowledge_files():
    store = get_knowledge_store()
    return {"documents": store.list_documents()}


@app.delete("/knowledge/files/{document_id}")
async def delete_knowledge_file(document_id: str):
    store = get_knowledge_store()
    result = store.delete_document(document_id)
    if not result["deleted"]:
        raise HTTPException(status_code=404, detail="Document not found")

    return {
        "deleted": True,
        "document_id": document_id,
        "chunk_count": result["chunk_count"],
    }


@app.get("/folders")
async def list_folders():
    store = get_knowledge_store()
    return {"folders": store.list_folders()}


@app.post("/folders")
async def create_folder(request: FolderCreateRequest):
    store = get_knowledge_store()
    name = request.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Folder name is required")
    try:
        color = normalize_folder_color(request.color)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid folder color")

    try:
        folder = store.create_folder(name, color)
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="Folder name already exists")

    return {"folder": folder}


@app.patch("/folders/{folder_id}")
async def rename_folder(folder_id: str, request: FolderUpdateRequest):
    store = get_knowledge_store()
    name = request.name.strip() if request.name is not None else None
    if request.name is not None and not name:
        raise HTTPException(status_code=400, detail="Folder name is required")
    if request.name is None and request.color is None:
        raise HTTPException(status_code=400, detail="No folder updates provided")

    color: Optional[str] = None
    if request.color is not None:
        try:
            color = normalize_folder_color(request.color)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid folder color")

    try:
        folder = store.update_folder(folder_id, name=name, color=color)
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="Folder name already exists")

    if folder is None:
        raise HTTPException(status_code=404, detail="Folder not found")

    return {"folder": folder}


@app.delete("/folders/{folder_id}")
async def delete_folder(folder_id: str):
    store = get_knowledge_store()
    result = store.delete_folder(folder_id)
    if not result["deleted"]:
        raise HTTPException(status_code=404, detail="Folder not found")

    return {
        "deleted": True,
        "folder_id": folder_id,
        "conversations_deleted": result["conversations_deleted"],
        "documents_deleted": result["documents_deleted"],
        "chunks_deleted": result["chunks_deleted"],
    }


@app.get("/folders/{folder_id}/files")
async def list_folder_knowledge_files(folder_id: str):
    store = get_knowledge_store()
    if store.get_folder(folder_id) is None:
        raise HTTPException(status_code=404, detail="Folder not found")
    return {"documents": store.list_folder_documents(folder_id)}


@app.post("/folders/{folder_id}/files")
async def upload_folder_knowledge_files(folder_id: str, files: List[UploadFile] = File(...)):
    store = get_knowledge_store()
    if store.get_folder(folder_id) is None:
        raise HTTPException(status_code=404, detail="Folder not found")

    results: List[Dict[str, Any]] = []

    for file in files:
        try:
            content = await file.read()
            if len(content) > MAX_KNOWLEDGE_UPLOAD_SIZE:
                results.append(
                    {
                        "filename": file.filename,
                        "status": "error",
                        "reason": "File too large (max 25MB)",
                    }
                )
                continue

            text, extraction_error = extract_text_for_knowledge(file.filename, content)
            if extraction_error:
                results.append(
                    {
                        "filename": file.filename,
                        "status": "unsupported",
                        "reason": extraction_error,
                    }
                )
                continue

            if not text:
                results.append(
                    {
                        "filename": file.filename,
                        "status": "unsupported",
                        "reason": "No text extracted from file",
                    }
                )
                continue

            trimmed_text = text[:MAX_KNOWLEDGE_TEXT_CHARS]
            chunks = chunk_text(trimmed_text)
            if not chunks:
                results.append(
                    {
                        "filename": file.filename,
                        "status": "unsupported",
                        "reason": "No meaningful text chunks could be produced",
                    }
                )
                continue

            content_hash = hashlib.sha256(content).hexdigest()
            duplicate = store.get_folder_document_by_hash(folder_id, content_hash)
            if duplicate:
                results.append(
                    {
                        "filename": file.filename,
                        "status": "duplicate",
                        "reason": "Document with identical content already indexed in this folder",
                        "document": duplicate,
                    }
                )
                continue

            embeddings = await embed_in_batches(chunks)
            document = store.insert_folder_document_with_chunks(
                folder_id=folder_id,
                filename=file.filename,
                content_hash=content_hash,
                size_bytes=len(content),
                mime_type=file.content_type,
                chunks=chunks,
                embeddings=embeddings,
            )

            results.append(
                {
                    "filename": file.filename,
                    "status": "indexed",
                    "document": document,
                }
            )
        except Exception as e:
            print(
                f"Folder knowledge ingest error for {file.filename}: {e}",
                file=sys.stderr,
            )
            results.append(
                {
                    "filename": file.filename,
                    "status": "error",
                    "reason": f"{type(e).__name__}: {e}",
                }
            )

    return {"results": results}


@app.delete("/folders/{folder_id}/files/{document_id}")
async def delete_folder_knowledge_file(folder_id: str, document_id: str):
    store = get_knowledge_store()
    if store.get_folder(folder_id) is None:
        raise HTTPException(status_code=404, detail="Folder not found")

    result = store.delete_folder_document(folder_id, document_id)
    if not result["deleted"]:
        raise HTTPException(status_code=404, detail="Document not found")

    return {
        "deleted": True,
        "document_id": document_id,
        "chunk_count": result["chunk_count"],
    }


@app.get("/conversations")
async def list_conversations():
    store = get_knowledge_store()
    return {"conversations": store.list_conversations()}


@app.post("/conversations")
async def create_conversation(request: ConversationCreateRequest):
    store = get_knowledge_store()
    try:
        conversation = store.create_conversation(request.folder_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))

    return {"conversation": conversation}


@app.get("/conversations/{conversation_id}")
async def get_conversation(conversation_id: str):
    store = get_knowledge_store()
    conversation = store.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    return {
        "conversation": conversation,
        "messages": store.get_conversation_messages(conversation_id),
    }


@app.patch("/conversations/{conversation_id}")
async def update_conversation(conversation_id: str, request: ConversationUpdateRequest):
    store = get_knowledge_store()
    payload = request.model_dump(exclude_unset=True)

    title = payload.get("title")
    if title is not None:
        title = title.strip()
        if not title:
            raise HTTPException(status_code=400, detail="Conversation title is required")

    set_folder = "folder_id" in payload
    folder_id = payload.get("folder_id")

    try:
        conversation = store.update_conversation(
            conversation_id,
            title=title,
            set_folder=set_folder,
            folder_id=folder_id,
        )
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))

    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    return {"conversation": conversation}


@app.delete("/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str):
    store = get_knowledge_store()
    result = store.delete_conversation(conversation_id)
    if not result["deleted"]:
        raise HTTPException(status_code=404, detail="Conversation not found")

    return {"deleted": True, "conversation_id": conversation_id}


@app.post("/conversations/{conversation_id}/turns")
async def append_conversation_turn(conversation_id: str, request: ConversationTurnRequest):
    user_message = request.user_message.strip()
    assistant_message = request.assistant_message.strip()
    if not user_message:
        raise HTTPException(status_code=400, detail="User message is required")
    if not assistant_message:
        raise HTTPException(status_code=400, detail="Assistant message is required")

    store = get_knowledge_store()
    conversation = store.append_turn(
        conversation_id,
        user_message=user_message,
        assistant_message=assistant_message,
        model_used=request.model_used,
        sources=request.sources,
    )
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    return {"saved": True, "conversation": conversation}


@app.get("/health")
async def health_check():
    """Health check endpoint that verifies FastAPI, Ollama, and knowledge DB connectivity."""
    health_status: Dict[str, Any] = {
        "status": "ok",
        "backend": "running",
    }

    try:
        get_knowledge_store()
        health_status["knowledge_db"] = "ready"
    except Exception as e:
        health_status["status"] = "degraded"
        health_status["knowledge_db"] = "error"
        health_status["message"] = f"Knowledge DB init failed: {type(e).__name__}"

    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            response = await client.get(f"{OLLAMA_BASE_URL}/api/version")
            if response.status_code == 200:
                health_status["ollama"] = "connected"
            else:
                health_status["status"] = "degraded"
                health_status["ollama"] = "unreachable"
                health_status["message"] = "Ollama is not responding correctly"
    except (httpx.ConnectError, httpx.TimeoutException):
        health_status["status"] = "degraded"
        health_status["ollama"] = "unreachable"
        health_status["message"] = "Cannot connect to Ollama at http://localhost:11434"
    except Exception as e:
        health_status["status"] = "degraded"
        health_status["ollama"] = "error"
        health_status["message"] = f"Error checking Ollama: {type(e).__name__}"

    return health_status
