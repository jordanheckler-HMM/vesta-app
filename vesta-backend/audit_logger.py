"""
VESTA-Compliant Audit Logging System

Provides comprehensive, transparent logging of all routing decisions.
Supports dual output: console (development) + rotating file logs (production).

No personal data logging. Session-scoped context only.
"""

import logging
import json
from logging.handlers import RotatingFileHandler
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, Optional
import sys


# Global logger instance
_routing_logger: Optional[logging.Logger] = None


def setup_logger(log_level: str = "INFO", log_dir: str = "logs") -> logging.Logger:
    """
    Initialize the routing audit logger with dual output.
    
    Args:
        log_level: Logging level (DEBUG, INFO, WARNING, ERROR)
        log_dir: Directory for log files (relative to backend root)
    
    Returns:
        Configured logger instance
    """
    global _routing_logger
    
    if _routing_logger is not None:
        return _routing_logger
    
    # Create logger
    logger = logging.getLogger("vesta.routing")
    logger.setLevel(getattr(logging, log_level.upper(), logging.INFO))
    logger.propagate = False  # Don't propagate to root logger
    
    # Formatter for structured logs
    formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    
    # Console handler (always enabled)
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.INFO)
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)
    
    # File handler (rotating logs)
    try:
        log_path = Path(__file__).parent / log_dir
        log_path.mkdir(exist_ok=True)
        
        file_handler = RotatingFileHandler(
            log_path / "routing_audit.log",
            maxBytes=10 * 1024 * 1024,  # 10MB
            backupCount=5
        )
        file_handler.setLevel(logging.DEBUG)
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)
        
        logger.info(f"File logging initialized: {log_path / 'routing_audit.log'}")
    except Exception as e:
        logger.warning(f"Could not initialize file logging: {e}")
    
    _routing_logger = logger
    return logger


def get_logger() -> logging.Logger:
    """Get the routing logger, initializing if needed"""
    global _routing_logger
    if _routing_logger is None:
        return setup_logger()
    return _routing_logger


def log_routing_decision(
    message: str,
    mode: str,
    history_depth: int,
    signals: Dict[str, float],
    task_context: Dict[str, Any],
    routing_method: str,
    selected_model: str,
    reasoning: str,
    confidence: float,
    fallback_used: bool,
    latency_ms: Optional[float] = None,
    last_model_used: Optional[str] = None,
    consistency_enforced: bool = False
) -> None:
    """
    Log a routing decision with full audit trail.
    
    Args:
        message: User message (first 100 chars only)
        mode: Selected mode (draft/think/clarify/general)
        history_depth: Number of previous user messages
        signals: Dict with E, I, K, noise_tolerance values
        task_context: Dict with is_continuation, depth, etc.
        routing_method: "heuristic" or "llm"
        selected_model: "lite", "general", or "deep"
        reasoning: Human-readable explanation
        confidence: 0-1 confidence score
        fallback_used: Whether default fallback was used
        latency_ms: Routing decision latency in milliseconds
        last_model_used: Previous model (if any)
        consistency_enforced: Whether model was upgraded for consistency
    """
    logger = get_logger()
    
    # Truncate message for privacy and log size
    message_preview = message[:100] + "..." if len(message) > 100 else message
    
    # Build structured log entry
    log_entry = {
        "timestamp": datetime.utcnow().isoformat(),
        "message_preview": message_preview,
        "message_length": len(message),
        "mode": mode,
        "history_depth": history_depth,
        "signals": {
            "energy": round(signals.get("energy", 0), 3),
            "information": round(signals.get("information", 0), 3),
            "connection": round(signals.get("connection", 0), 3),
            "noise_tolerance": round(signals.get("noise_tolerance", 0), 3)
        },
        "task_context": {
            "is_continuation": task_context.get("is_continuation", False),
            "is_new_task": task_context.get("is_new_task", False),
            "depth": task_context.get("depth", 0),
            "requires_consistency": task_context.get("requires_consistency", False),
            "complexity_trend": task_context.get("complexity_trend", "unknown"),
            "task_type": task_context.get("task_type")
        },
        "routing": {
            "method": routing_method,
            "selected_model": selected_model,
            "reasoning": reasoning,
            "confidence": round(confidence, 3),
            "fallback_used": fallback_used,
            "last_model_used": last_model_used,
            "consistency_enforced": consistency_enforced
        }
    }
    
    if latency_ms is not None:
        log_entry["latency_ms"] = round(latency_ms, 2)
    
    # Log as JSON for structured parsing
    logger.info(json.dumps(log_entry))
    
    # Also log human-readable summary to console
    summary = (
        f"Routing: {selected_model.upper()} "
        f"(method={routing_method}, "
        f"E={signals.get('energy', 0):.2f}, "
        f"I={signals.get('information', 0):.2f}, "
        f"K={signals.get('connection', 0):.2f}) "
        f"- {reasoning}"
    )
    
    if consistency_enforced:
        summary += f" [upgraded from {last_model_used}]"
    
    logger.debug(summary)


def log_routing_error(
    message: str,
    mode: str,
    error: Exception,
    fallback_model: str
) -> None:
    """
    Log routing errors with fallback information.
    
    Args:
        message: User message (first 100 chars)
        mode: Selected mode
        error: Exception that occurred
        fallback_model: Model used as fallback
    """
    logger = get_logger()
    
    message_preview = message[:100] + "..." if len(message) > 100 else message
    
    error_entry = {
        "timestamp": datetime.utcnow().isoformat(),
        "event": "routing_error",
        "message_preview": message_preview,
        "mode": mode,
        "error_type": type(error).__name__,
        "error_message": str(error),
        "fallback_model": fallback_model
    }
    
    logger.error(json.dumps(error_entry))
    logger.error(f"Routing error: {error}, using fallback: {fallback_model}")


def log_session_boundary(event: str, context: Optional[Dict[str, Any]] = None) -> None:
    """
    Log session boundary events (VESTA compliance tracking).
    
    Args:
        event: "session_start" or "session_clear"
        context: Optional context information
    """
    logger = get_logger()
    
    boundary_entry = {
        "timestamp": datetime.utcnow().isoformat(),
        "event": event,
        "context": context or {}
    }
    
    logger.info(json.dumps(boundary_entry))
    logger.info(f"Session boundary: {event}")


def log_model_consistency_event(
    original_model: str,
    final_model: str,
    reason: str,
    history_depth: int
) -> None:
    """
    Log model consistency enforcement events.
    
    Args:
        original_model: Originally selected model
        final_model: Final model after consistency check
        reason: Why consistency was enforced
        history_depth: Depth of conversation
    """
    logger = get_logger()
    
    consistency_entry = {
        "timestamp": datetime.utcnow().isoformat(),
        "event": "consistency_enforcement",
        "original_model": original_model,
        "final_model": final_model,
        "reason": reason,
        "history_depth": history_depth
    }
    
    logger.info(json.dumps(consistency_entry))
    logger.debug(f"Consistency: {original_model} → {final_model} ({reason})")


# Initialize logger on module import
setup_logger()
