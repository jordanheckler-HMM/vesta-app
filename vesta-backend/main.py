from fastapi import FastAPI, HTTPException, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
import httpx
from pathlib import Path
from typing import Literal, List, Optional
import sys
import json
import time
import io

# Import routing utilities and audit logger
from routing_utils import (
    analyze_message_signals,
    analyze_task_context,
    fast_route,
    enforce_model_consistency,
    should_upgrade_model,
    RoutingDecision
)
from audit_logger import (
    log_routing_decision,
    log_routing_error,
    log_session_boundary,
    log_model_consistency_event
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
    "lite": "hymetalab/vesta-lite"
}

# Request/Response models
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


# Load prompts on startup
PROMPTS_DIR = Path(__file__).parent / "prompts"
BASE_PROMPT = ""
MODE_PROMPTS = {}


@app.on_event("startup")
async def load_prompts():
    """Load all prompt files into memory"""
    global BASE_PROMPT, MODE_PROMPTS
    
    required_prompts = ["base.txt", "draft.txt", "think.txt", "clarify.txt", "general.txt"]
    missing_prompts = []
    
    for prompt_file in required_prompts:
        if not (PROMPTS_DIR / prompt_file).exists():
            missing_prompts.append(prompt_file)
    
    if missing_prompts:
        error_msg = (
            f"\n{'='*60}\n"
            f"ERROR: Required prompt files are missing!\n"
            f"Missing files: {', '.join(missing_prompts)}\n"
            f"Expected location: {PROMPTS_DIR.absolute()}\n"
            f"{'='*60}\n"
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
        print(f"Successfully loaded {len(MODE_PROMPTS) + 1} prompt files from {PROMPTS_DIR}")
    except Exception as e:
        print(f"Error reading prompt files: {e}", file=sys.stderr)
        raise


async def route_to_model(
    message: str,
    mode: str,
    history: List[ChatMessage],
    last_model_used: Optional[str] = None
) -> RoutingDecision:
    """
    VESTA-compliant routing with coherence framework analysis.
    
    Returns: RoutingDecision with full audit trail
    """
    start_time = time.time()
    
    # Convert ChatMessage objects to dicts for analysis
    history_dicts = [{"role": msg.role, "content": msg.content} for msg in history]
    
    # 1. Signal analysis
    signals = analyze_message_signals(message, mode, history_dicts)
    
    # 2. Task context analysis
    task_context = analyze_task_context(history_dicts, message)
    
    # 3. Check for refinement upgrade requests
    upgraded_model = should_upgrade_model(message, history_dicts, last_model_used)
    if upgraded_model:
        latency_ms = (time.time() - start_time) * 1000
        return RoutingDecision(
            model=upgraded_model,
            method="refinement_upgrade",
            reasoning=f"User requested refinement, upgrading from {last_model_used}",
            signals=signals,
            task_context=task_context,
            confidence=0.95,
            fallback_used=False
        )
    
    # 4. Try fast heuristic routing
    decision = fast_route(signals, mode, task_context)
    
    if decision:
        # Fast route succeeded
        latency_ms = (time.time() - start_time) * 1000
        return decision
    
    # 5. Fall back to LLM-based routing for ambiguous cases
    try:
        decision = await llm_route(message, mode, signals, task_context, history)
        latency_ms = (time.time() - start_time) * 1000
        return decision
    except Exception as e:
        # LLM routing failed, use fallback
        latency_ms = (time.time() - start_time) * 1000
        fallback_model = get_fallback_model(mode)
        
        log_routing_error(message, mode, e, fallback_model)
        
        return RoutingDecision(
            model=fallback_model,
            method="fallback",
            reasoning=f"Routing error, using mode-based fallback",
            signals=signals,
            task_context=task_context,
            confidence=0.5,
            fallback_used=True
        )


async def llm_route(
    message: str,
    mode: str,
    signals: any,
    task_context: any,
    history: List[ChatMessage]
) -> RoutingDecision:
    """
    LLM-based routing for ambiguous cases.
    Enhanced with coherence framework signals.
    """
    # Build enhanced routing prompt with signals
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
            "http://localhost:11434/api/generate",
            json={
                "model": "hymetalab/vesta-general",
                "prompt": routing_prompt,
                "temperature": 0.3,  # Lower temperature for more consistent routing
                "stream": False
            }
        )
        
        if response.status_code == 200:
            result = response.json()
            response_text = result.get("response", "").strip()
            
            # Parse JSON response
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
                        fallback_used=False
                    )
        
        # If we get here, LLM response was invalid
        raise ValueError("Invalid LLM routing response")


def get_fallback_model(mode: str) -> str:
    """Get fallback model based on mode"""
    fallbacks = {
        "think": "deep",
        "draft": "general",
        "clarify": "general",
        "general": "general"
    }
    return fallbacks.get(mode, "general")


def build_conversation_context(messages: List[ChatMessage], mode_prompt: str, current_message: str) -> str:
    """Build the full conversation context including history"""
    context_parts = [BASE_PROMPT, "", mode_prompt, ""]
    
    # Add conversation history
    if messages:
        context_parts.append("Previous conversation:")
        for msg in messages[-10:]:  # Last 10 messages for context
            prefix = "User: " if msg.role == "user" else "Assistant: "
            context_parts.append(f"{prefix}{msg.content}")
        context_parts.append("")
    
    # Add current message
    context_parts.append(f"User: {current_message}")
    
    return "\n".join(context_parts)


async def stream_ollama_response(model_name: str, prompt: str):
    """Stream response from Ollama"""
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            async with client.stream(
                "POST",
                "http://localhost:11434/api/generate",
                json={
                    "model": model_name,
                    "prompt": prompt,
                    "stream": True
                }
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
                                    "done": data.get("done", False)
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
        
        # Determine which model to use
        if request.model == "auto":
            routing_decision = await route_to_model(
                request.message,
                request.mode,
                request.messages,
                request.last_model_used
            )
            selected_model_key = routing_decision.model
            
            # Enforce model consistency (no mid-task downgrades)
            original_model = selected_model_key
            selected_model_key, was_upgraded = enforce_model_consistency(
                selected_model_key,
                [{"role": msg.role, "content": msg.content} for msg in request.messages],
                request.last_model_used
            )
            
            if was_upgraded:
                consistency_enforced = True
                log_model_consistency_event(
                    original_model,
                    selected_model_key,
                    "Prevented mid-task downgrade",
                    len([m for m in request.messages if m.role == "user"])
                )
        else:
            # Manual model selection
            selected_model_key = request.model if request.model != "auto" else "general"
        
        model_name = MODEL_NAMES.get(selected_model_key, "hymetalab/vesta-general")
        
        # Log routing decision
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
                    "noise_tolerance": routing_decision.signals.noise_tolerance
                },
                task_context={
                    "is_continuation": routing_decision.task_context.is_continuation,
                    "is_new_task": routing_decision.task_context.is_new_task,
                    "depth": routing_decision.task_context.depth,
                    "requires_consistency": routing_decision.task_context.requires_consistency,
                    "complexity_trend": routing_decision.task_context.complexity_trend,
                    "task_type": routing_decision.task_context.task_type
                },
                routing_method=routing_decision.method,
                selected_model=selected_model_key,
                reasoning=routing_decision.reasoning,
                confidence=routing_decision.confidence,
                fallback_used=routing_decision.fallback_used,
                latency_ms=latency_ms,
                last_model_used=request.last_model_used,
                consistency_enforced=consistency_enforced
            )
        
        # Build conversation context
        mode_prompt = MODE_PROMPTS.get(request.mode, "")
        full_prompt = build_conversation_context(
            request.messages,
            mode_prompt,
            request.message
        )
        
        # Return streaming response with routing metadata in headers
        response = StreamingResponse(
            stream_ollama_response(model_name, full_prompt),
            media_type="text/event-stream"
        )
        
        # Add routing metadata to response headers for UI
        response.headers["X-Selected-Model"] = selected_model_key
        if routing_decision:
            response.headers["X-Routing-Method"] = routing_decision.method
            response.headers["X-Routing-Confidence"] = str(round(routing_decision.confidence, 2))
        
        return response
            
    except Exception as e:
        print(f"Unexpected error in chat endpoint: {type(e).__name__}: {e}", file=sys.stderr)
        raise HTTPException(
            status_code=500,
            detail="An error occurred processing your request."
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
            file_type = file.filename.split('.')[-1].lower()
            
            # Limit file size to 10MB
            if len(content) > 10 * 1024 * 1024:
                extracted_content.append({
                    "filename": file.filename,
                    "error": "File too large (max 10MB)"
                })
                continue
            
            if file_type == 'pdf':
                text = extract_pdf_text(content)
            elif file_type in ['docx', 'doc']:
                text = extract_docx_text(content)
            elif file_type in ['csv']:
                text = extract_csv_text(content)
            elif file_type in ['txt']:
                text = content.decode('utf-8', errors='ignore')
            elif file_type in ['xlsx', 'xls']:
                text = extract_excel_text(content)
            else:
                text = f"[Unsupported file type: {file_type}]"
            
            extracted_content.append({
                "filename": file.filename,
                "content": text[:50000],  # Limit to 50k chars per file
                "size": len(content)
            })
        except Exception as e:
            print(f"Error processing file {file.filename}: {e}", file=sys.stderr)
            extracted_content.append({
                "filename": file.filename,
                "error": str(e)
            })
    
    return {"files": extracted_content}


def extract_pdf_text(content: bytes) -> str:
    """Extract text from PDF"""
    try:
        import PyPDF2
        pdf_file = io.BytesIO(content)
        reader = PyPDF2.PdfReader(pdf_file)
        text = ""
        for page in reader.pages:
            text += page.extract_text() + "\n"
        return text.strip()
    except ImportError:
        return "[PDF processing unavailable - PyPDF2 not installed]"
    except Exception as e:
        return f"[Error extracting PDF: {str(e)}]"


def extract_docx_text(content: bytes) -> str:
    """Extract text from DOCX"""
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
    """Extract text from CSV as markdown table"""
    try:
        import csv
        csv_file = io.StringIO(content.decode('utf-8', errors='ignore'))
        reader = csv.reader(csv_file)
        rows = list(reader)
        
        if not rows:
            return "[Empty CSV file]"
        
        # Format as markdown table
        text = "| " + " | ".join(rows[0]) + " |\n"
        text += "| " + " | ".join(["---"] * len(rows[0])) + " |\n"
        for row in rows[1:]:
            text += "| " + " | ".join(row) + " |\n"
        return text
    except Exception as e:
        return f"[Error extracting CSV: {str(e)}]"


def extract_excel_text(content: bytes) -> str:
    """Extract text from Excel files"""
    try:
        import openpyxl
        excel_file = io.BytesIO(content)
        workbook = openpyxl.load_workbook(excel_file, read_only=True)
        
        text = ""
        for sheet_name in workbook.sheetnames:
            sheet = workbook[sheet_name]
            text += f"\n=== Sheet: {sheet_name} ===\n\n"
            
            rows = []
            for row in sheet.iter_rows(values_only=True, max_row=100):  # Limit rows
                rows.append([str(cell) if cell is not None else "" for cell in row])
            
            if rows:
                # Format as markdown table
                text += "| " + " | ".join(rows[0]) + " |\n"
                text += "| " + " | ".join(["---"] * len(rows[0])) + " |\n"
                for row in rows[1:]:
                    text += "| " + " | ".join(row) + " |\n"
        
        return text.strip()
    except ImportError:
        return "[Excel processing unavailable - openpyxl not installed]"
    except Exception as e:
        return f"[Error extracting Excel: {str(e)}]"


@app.get("/health")
async def health_check():
    """Health check endpoint that verifies both FastAPI and Ollama connectivity"""
    health_status = {
        "status": "ok",
        "backend": "running"
    }
    
    # Check Ollama connectivity
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            response = await client.get("http://localhost:11434/api/version")
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

