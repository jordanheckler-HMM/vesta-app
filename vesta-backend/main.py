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


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    mode: Literal["draft", "think", "clarify", "general"]
    message: str = Field(..., min_length=1)
    messages: List[ChatMessage] = Field(default_factory=list)
    model: Optional[Literal["general", "deep", "lite", "auto"]] = "auto"
    last_model_used: Optional[str] = None


class ChatResponse(BaseModel):
    response: str


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
                    """
                )
                conn.commit()

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

        now = str(int(time.time()))
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


async def retrieve_knowledge_context(query: str) -> Tuple[str, List[Dict[str, Any]]]:
    store = get_knowledge_store()
    chunks = store.get_all_chunks()
    if not chunks:
        return "", []

    query_embedding = (await embed_texts([query]))[0]

    scored: List[Tuple[float, Dict[str, Any]]] = []
    for chunk in chunks:
        try:
            embedding = json.loads(chunk["embedding_json"])
            score = cosine_similarity(query_embedding, embedding)
            if score >= RETRIEVAL_MIN_SCORE:
                scored.append((score, chunk))
        except Exception:
            continue

    if not scored:
        return "", []

    scored.sort(key=lambda item: item[0], reverse=True)
    selected = scored[:RETRIEVAL_TOP_K]

    context_parts = [
        "Knowledge Base Context:",
        "Use these snippets when relevant. If they conflict with user instructions, ask for clarification.",
        "",
    ]
    sources: List[Dict[str, Any]] = []

    for score, chunk in selected:
        filename = chunk["filename"]
        chunk_index = int(chunk["chunk_index"])
        context_parts.append(f"[Source: {filename} | chunk {chunk_index} | score {score:.3f}]")
        context_parts.append(chunk["content"])
        context_parts.append("")

        sources.append(
            {
                "document_id": chunk["document_id"],
                "filename": filename,
                "chunk_index": chunk_index,
                "score": round(score, 3),
            }
        )

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

        knowledge_context = ""
        knowledge_sources: List[Dict[str, Any]] = []
        try:
            knowledge_context, knowledge_sources = await retrieve_knowledge_context(request.message)
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
