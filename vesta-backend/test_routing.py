"""
Test script for VESTA routing utilities.

Run with: python3 test_routing.py
"""

from routing_utils import (
    analyze_message_signals,
    analyze_task_context,
    fast_route,
    enforce_model_consistency,
    should_upgrade_model
)

def test_signal_analysis():
    """Test signal detection"""
    print("\n=== Testing Signal Analysis ===")
    
    test_cases = [
        ("What is Python?", "general", []),
        ("Analyze the implications of microservices architecture", "think", []),
        ("Draft an email about team performance", "draft", []),
        ("I'm feeling overwhelmed with this project", "general", []),
    ]
    
    for message, mode, history in test_cases:
        signals = analyze_message_signals(message, mode, history)
        print(f"\nMessage: {message[:50]}...")
        print(f"  Energy: {signals.energy:.2f}")
        print(f"  Information: {signals.information:.2f}")
        print(f"  Connection: {signals.connection:.2f}")
        print(f"  Noise tolerance: {signals.noise_tolerance:.2f}")


def test_task_context():
    """Test task context analysis"""
    print("\n=== Testing Task Context Analysis ===")
    
    # Simple first message
    history = []
    message = "Draft an email to my team"
    context = analyze_task_context(history, message)
    print(f"\nFirst message: {message}")
    print(f"  Is continuation: {context.is_continuation}")
    print(f"  Depth: {context.depth}")
    print(f"  Task type: {context.task_type}")
    
    # Continuation message
    history = [
        {"role": "user", "content": "Draft an email to my team"},
        {"role": "assistant", "content": "Here's a draft email..."}
    ]
    message = "Make it more formal"
    context = analyze_task_context(history, message)
    print(f"\nContinuation: {message}")
    print(f"  Is continuation: {context.is_continuation}")
    print(f"  Depth: {context.depth}")
    print(f"  Requires consistency: {context.requires_consistency}")


def test_fast_routing():
    """Test heuristic routing"""
    print("\n=== Testing Fast Routing ===")
    
    test_cases = [
        ("What is 2+2?", "general", []),
        ("Analyze the tradeoffs between REST and GraphQL APIs", "think", []),
        ("Draft a professional email", "draft", []),
        ("Make it better", "draft", [{"role": "user", "content": "Draft an email"}]),
    ]
    
    for message, mode, history in test_cases:
        signals = analyze_message_signals(message, mode, history)
        task_context = analyze_task_context(history, message)
        decision = fast_route(signals, mode, task_context)
        
        print(f"\nMessage: {message[:50]}...")
        if decision:
            print(f"  Model: {decision.model}")
            print(f"  Reasoning: {decision.reasoning}")
            print(f"  Confidence: {decision.confidence:.2f}")
        else:
            print(f"  Ambiguous - would use LLM routing")


def test_model_consistency():
    """Test model consistency enforcement"""
    print("\n=== Testing Model Consistency ===")
    
    # Prevent downgrade
    history = [{"role": "user", "content": "Previous message"}]
    selected = "lite"
    last_used = "deep"
    
    final, upgraded = enforce_model_consistency(selected, history, last_used)
    print(f"\nConsistency enforcement:")
    print(f"  Selected: {selected}, Last used: {last_used}")
    print(f"  Final: {final}, Upgraded: {upgraded}")
    
    # Allow same or upgrade
    selected = "general"
    last_used = "general"
    final, upgraded = enforce_model_consistency(selected, history, last_used)
    print(f"\nConsistency enforcement:")
    print(f"  Selected: {selected}, Last used: {last_used}")
    print(f"  Final: {final}, Upgraded: {upgraded}")


def test_refinement_detection():
    """Test refinement upgrade detection"""
    print("\n=== Testing Refinement Detection ===")
    
    history = [
        {"role": "user", "content": "Draft an email"},
        {"role": "assistant", "content": "Here's a draft..."}
    ]
    
    refinement_messages = [
        "Make it better",
        "Improve the clarity",
        "Add more details",
        "Can you elaborate?"
    ]
    
    for message in refinement_messages:
        upgraded = should_upgrade_model(message, history, "lite")
        print(f"\nMessage: {message}")
        print(f"  From lite to: {upgraded or 'no upgrade'}")


def test_session_boundary():
    """Test session boundary behavior (VESTA compliance)"""
    print("\n=== Testing Session Boundary (VESTA Compliance) ===")
    
    # Simulate multi-turn conversation
    print("\nSession 1:")
    history = []
    
    for turn, message in enumerate([
        "Draft an email about Q4 results",
        "Make it more formal",
        "Add a section about challenges"
    ], 1):
        signals = analyze_message_signals(message, "draft", history)
        context = analyze_task_context(history, message)
        decision = fast_route(signals, "draft", context)
        
        print(f"  Turn {turn}: {message[:40]}... → {decision.model if decision else 'LLM'}")
        
        # Add to history
        history.append({"role": "user", "content": message})
        history.append({"role": "assistant", "content": "Response..."})
    
    print("\n✓ Session cleared (VESTA compliance)")
    print("Session 2 (fresh start):")
    
    # New session - history should be empty
    history = []
    message = "Draft a different email"
    signals = analyze_message_signals(message, "draft", history)
    context = analyze_task_context(history, message)
    decision = fast_route(signals, "draft", context)
    
    print(f"  Turn 1: {message} → {decision.model if decision else 'LLM'}")
    print(f"  Context depth: {context.depth} (should be 0)")
    print(f"  Is continuation: {context.is_continuation} (should be False)")


def run_all_tests():
    """Run all routing tests"""
    print("=" * 60)
    print("VESTA ROUTING SYSTEM TESTS")
    print("=" * 60)
    
    try:
        test_signal_analysis()
        test_task_context()
        test_fast_routing()
        test_model_consistency()
        test_refinement_detection()
        test_session_boundary()
        
        print("\n" + "=" * 60)
        print("✓ ALL TESTS COMPLETED")
        print("=" * 60)
        
    except Exception as e:
        print(f"\n✗ TEST FAILED: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    run_all_tests()
