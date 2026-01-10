"""
VESTA-Compliant Routing Utilities

Session-scoped routing logic based on the HYMetaLab Coherence Framework.
Analyzes message signals (E, I, K) and task context for intelligent model selection.

No cross-session memory. All analysis is stateless or session-scoped only.
"""

from typing import List, Dict, Optional, Tuple
import re
from dataclasses import dataclass


@dataclass
class MessageSignals:
    """Coherence framework signals extracted from a message"""
    energy: float  # E: Computational complexity (0-1)
    information: float  # I: Information integration needs (0-1)
    connection: float  # K: Relational/emotional depth (0-1)
    noise_tolerance: float  # η: Acceptable error tolerance (0-1)


@dataclass
class TaskContext:
    """Session-scoped task context (VESTA-compliant)"""
    is_continuation: bool  # Is this continuing the current task?
    is_new_task: bool  # Is this explicitly starting a new task?
    depth: int  # Number of user messages in current task
    requires_consistency: bool  # Does this need same/better model?
    complexity_trend: str  # "increasing", "decreasing", "stable"
    task_type: Optional[str]  # Inferred task type


@dataclass
class RoutingDecision:
    """Complete routing decision with audit trail"""
    model: str  # "lite", "general", "deep"
    method: str  # "heuristic" or "llm"
    reasoning: str  # Human-readable explanation
    signals: MessageSignals
    task_context: TaskContext
    confidence: float  # 0-1, how confident is this decision
    fallback_used: bool  # Did we fall back to defaults?


# Signal Analysis Functions

def estimate_energy_requirement(message: str) -> float:
    """
    Estimate computational complexity (E) of handling this message.
    
    Returns: 0.0 (trivial) to 1.0 (maximum complexity)
    """
    score = 0.0
    msg_lower = message.lower()
    
    # Length factor (logarithmic scale)
    score += min(0.2, len(message) / 500)
    
    # High complexity keywords
    high_complexity = [
        "analyze", "evaluate", "compare", "contrast", "synthesize",
        "implications", "tradeoffs", "consequences", "reasoning",
        "prove", "demonstrate", "justify", "critique", "assess"
    ]
    if any(kw in msg_lower for kw in high_complexity):
        score += 0.5
    
    # Medium complexity keywords
    medium_complexity = ["explain", "describe", "outline", "summarize", "review", "discuss"]
    if any(kw in msg_lower for kw in medium_complexity):
        score += 0.25
    
    # Low complexity keywords
    low_complexity = ["what", "when", "who", "list", "define"]
    if any(kw in msg_lower for kw in low_complexity) and score < 0.3:
        score += 0.1
    
    # Multi-step indicators
    multi_step = ["first", "then", "next", "finally", "step", "stage"]
    if any(word in msg_lower for word in multi_step):
        score += 0.2
    
    # Code or technical content
    if "```" in message or any(lang in msg_lower for lang in ["python", "javascript", "code", "function"]):
        score += 0.15
    
    # Question complexity
    if "?" in message:
        question_count = message.count("?")
        if question_count > 1:
            score += 0.1 * min(question_count, 3)
    
    return min(1.0, score)


def estimate_information_requirement(message: str, history: List[Dict]) -> float:
    """
    Estimate information integration needs (I).
    
    Returns: 0.0 (self-contained) to 1.0 (deep context integration)
    """
    score = 0.0
    msg_lower = message.lower()
    
    # History dependence indicators
    history_refs = [
        "the previous", "earlier", "above", "before", "that you",
        "you said", "you mentioned", "your last", "from before"
    ]
    if any(ref in msg_lower for ref in history_refs):
        score += 0.4
    
    # Pronoun usage (implies context)
    pronouns = ["it", "this", "that", "these", "those", "them"]
    # Only count at start of sentences or after common markers
    for pronoun in pronouns:
        if msg_lower.startswith(pronoun + " ") or f". {pronoun} " in msg_lower:
            score += 0.2
            break
    
    # Context depth (how deep into conversation)
    if history:
        turns = len([m for m in history if m.get("role") == "user"])
        score += min(0.5, turns * 0.1)
    
    # Cross-domain indicators
    domain_keywords = ["also", "additionally", "furthermore", "moreover", "besides"]
    if any(kw in msg_lower for kw in domain_keywords):
        score += 0.3
    
    return min(1.0, score)


def estimate_connection_requirement(message: str) -> float:
    """
    Estimate relational/emotional depth (K).
    
    Returns: 0.0 (purely factual) to 1.0 (highly relational)
    """
    score = 0.0
    msg_lower = message.lower()
    
    # Emotional language
    emotional_words = [
        "feel", "feeling", "worried", "anxious", "excited", "frustrated",
        "confused", "overwhelmed", "struggling", "difficult", "hard time"
    ]
    for word in emotional_words:
        if word in msg_lower:
            score += 0.4
            break
    
    # Relational terms
    relational = [
        "should i", "how do i", "help me", "advice", "guidance",
        "relationship", "team", "colleague", "friend", "family"
    ]
    if any(term in msg_lower for term in relational):
        score += 0.3
    
    # Interpersonal scenarios
    interpersonal = ["conversation", "communicate", "tell them", "say to", "respond to"]
    if any(term in msg_lower for term in interpersonal):
        score += 0.25
    
    # First-person perspective (personal context)
    first_person = [" i ", " my ", " me ", " i'm ", " i've "]
    if any(fp in f" {msg_lower} " for fp in first_person):
        score += 0.2
    
    return min(1.0, score)


def estimate_noise_tolerance(message: str) -> float:
    """
    Estimate acceptable error tolerance (η).
    
    Returns: 0.0 (high accuracy required) to 1.0 (errors acceptable)
    """
    msg_lower = message.lower()
    
    # High accuracy required
    accuracy_keywords = [
        "fact", "correct", "accurate", "precise", "exact",
        "true", "verify", "check", "confirm", "validate"
    ]
    if any(kw in msg_lower for kw in accuracy_keywords):
        return 0.1
    
    # Low accuracy acceptable (creative tasks)
    creative_keywords = [
        "brainstorm", "ideas", "explore", "draft", "sketch",
        "rough", "quick", "casual", "informal"
    ]
    if any(kw in msg_lower for kw in creative_keywords):
        return 0.7
    
    # Default: moderate tolerance
    return 0.4


def analyze_message_signals(message: str, mode: str, history: List[Dict]) -> MessageSignals:
    """
    VESTA-compliant: Extract all coherence signals from current message.
    Session-scoped only, no cross-session memory.
    """
    return MessageSignals(
        energy=estimate_energy_requirement(message),
        information=estimate_information_requirement(message, history),
        connection=estimate_connection_requirement(message),
        noise_tolerance=estimate_noise_tolerance(message)
    )


# Task Context Analysis

def detect_continuation(message: str, history: List[Dict]) -> bool:
    """Detect if message is continuing the current task"""
    if not history:
        return False
    
    msg_lower = message.lower()
    
    continuation_indicators = [
        "now", "also", "instead", "make it", "change", "add", "remove",
        "more", "less", "different", "another", "revise", "update",
        "modify", "adjust", "improve", "enhance", "better", "fix"
    ]
    
    # Check if message starts with or contains continuation words
    return any(ind in msg_lower for ind in continuation_indicators)


def is_new_task(message: str) -> bool:
    """Detect if user is explicitly starting a new task"""
    msg_lower = message.lower()
    
    new_task_indicators = [
        "now draft a different", "new topic", "switching to",
        "let's talk about", "different question", "unrelated",
        "change of subject", "moving on", "instead let's"
    ]
    
    return any(ind in msg_lower for ind in new_task_indicators)


def infer_task_type(first_message: str) -> Optional[str]:
    """Infer the type of task from the first message"""
    msg_lower = first_message.lower()
    
    if any(word in msg_lower for word in ["draft", "write", "compose", "email"]):
        return "draft"
    elif any(word in msg_lower for word in ["analyze", "evaluate", "compare"]):
        return "analysis"
    elif any(word in msg_lower for word in ["explain", "clarify", "understand"]):
        return "clarify"
    elif "?" in first_message:
        return "question"
    else:
        return "general"


def analyze_complexity_trend(history: List[Dict]) -> str:
    """Analyze if task complexity is increasing, decreasing, or stable"""
    if len(history) < 3:
        return "stable"
    
    # Get last 3 user messages
    user_messages = [m["content"] for m in history if m.get("role") == "user"]
    if len(user_messages) < 3:
        return "stable"
    
    recent_messages = user_messages[-3:]
    complexity_scores = [estimate_energy_requirement(msg) for msg in recent_messages]
    
    # Compare first and last
    if complexity_scores[-1] > complexity_scores[0] + 0.2:
        return "increasing"
    elif complexity_scores[-1] < complexity_scores[0] - 0.2:
        return "decreasing"
    else:
        return "stable"


def analyze_task_context(history: List[Dict], current_message: str) -> TaskContext:
    """
    VESTA-compliant: Analyze the current task context.
    Session-scoped only, resets when chat is cleared.
    """
    is_cont = detect_continuation(current_message, history)
    is_new = is_new_task(current_message)
    depth = len([m for m in history if m.get("role") == "user"])
    
    # Requires consistency if continuing and already have depth
    requires_consistency = is_cont and depth > 0
    
    complexity_trend = analyze_complexity_trend(history)
    
    task_type = None
    if history and len(history) > 0:
        first_user_msg = next((m["content"] for m in history if m.get("role") == "user"), None)
        if first_user_msg:
            task_type = infer_task_type(first_user_msg)
    
    return TaskContext(
        is_continuation=is_cont,
        is_new_task=is_new,
        depth=depth,
        requires_consistency=requires_consistency,
        complexity_trend=complexity_trend,
        task_type=task_type
    )


# Heuristic Routing

def can_fast_route(signals: MessageSignals, task_context: TaskContext) -> bool:
    """
    Determine if we can confidently route using heuristics alone.
    Returns True if routing is clear, False if we need LLM analysis.
    """
    # Very simple queries - clear
    if signals.energy < 0.2 and signals.information < 0.3:
        return True
    
    # Very complex queries - clear
    if signals.energy > 0.8:
        return True
    
    # Deep into task with clear continuation - clear
    if task_context.depth >= 3 and task_context.is_continuation:
        return True
    
    # High relational needs - clear
    if signals.connection > 0.6:
        return True
    
    # Otherwise ambiguous
    return False


def select_model_heuristic(
    signals: MessageSignals,
    mode: str,
    task_context: TaskContext
) -> Tuple[str, str]:
    """
    Fast heuristic routing decision.
    Returns: (model, reasoning)
    """
    # Fast route to lite
    if signals.energy < 0.2 and signals.information < 0.3 and mode != "think":
        return "lite", "Simple query with low complexity"
    
    if not task_context.is_continuation and signals.energy < 0.3:
        # Simple question
        if signals.energy < 0.2:
            return "lite", "Short, straightforward question"
    
    # Fast route to deep
    if mode == "think" and signals.energy > 0.6:
        return "deep", "Think mode with high complexity"
    
    if signals.energy > 0.8:
        return "deep", "Very high computational complexity"
    
    if task_context.depth >= 4 and signals.energy > 0.5:
        return "deep", "Deep task progression with sustained complexity"
    
    # Fast route to general
    if mode == "draft":
        return "general", "Draft mode uses general for language capability"
    
    if signals.connection > 0.6:
        return "general", "High relational depth requires nuanced understanding"
    
    if task_context.requires_consistency:
        return "general", "Task continuation requires consistency"
    
    # Default to general for moderate complexity
    if signals.energy >= 0.3 or signals.information >= 0.4:
        return "general", "Moderate complexity, balanced approach"
    
    return "lite", "Default for simple tasks"


def fast_route(
    signals: MessageSignals,
    mode: str,
    task_context: TaskContext
) -> Optional[RoutingDecision]:
    """
    Attempt fast heuristic routing.
    Returns RoutingDecision if confident, None if ambiguous.
    """
    if not can_fast_route(signals, task_context):
        return None
    
    model, reasoning = select_model_heuristic(signals, mode, task_context)
    
    return RoutingDecision(
        model=model,
        method="heuristic",
        reasoning=reasoning,
        signals=signals,
        task_context=task_context,
        confidence=0.85,  # Heuristic routes are reasonably confident
        fallback_used=False
    )


# Model Consistency

def enforce_model_consistency(
    selected_model: str,
    history: List[Dict],
    last_model_used: Optional[str]
) -> Tuple[str, bool]:
    """
    Prevent model downgrades mid-task (VESTA-compliant consistency).
    
    Returns: (final_model, was_upgraded)
    """
    if not last_model_used or not history:
        return selected_model, False
    
    model_hierarchy = {"lite": 0, "general": 1, "deep": 2}
    
    # If we're continuing a task (have any history), don't downgrade
    if len(history) >= 1:
        last_level = model_hierarchy.get(last_model_used, 1)
        selected_level = model_hierarchy.get(selected_model, 1)
        
        if selected_level < last_level:
            # Upgrade to maintain consistency
            return last_model_used, True
    
    return selected_model, False


def should_upgrade_model(
    message: str,
    history: List[Dict],
    last_model_used: Optional[str]
) -> Optional[str]:
    """
    Detect if user is requesting refinement and upgrade model accordingly.
    
    Returns: upgraded model if applicable, None otherwise
    """
    if not last_model_used or not history:
        return None
    
    msg_lower = message.lower()
    
    refinement_requests = [
        "better", "improve", "more detailed", "elaborate",
        "more formal", "more specific", "add", "expand",
        "enhance", "refine", "polish"
    ]
    
    is_refinement = any(word in msg_lower for word in refinement_requests)
    
    if is_refinement and len(history) > 1:
        if last_model_used == "lite":
            return "general"
        elif last_model_used == "general":
            # Only upgrade to deep if message has sufficient complexity
            signals = analyze_message_signals(message, "general", history)
            if signals.energy > 0.5:
                return "deep"
    
    return None
