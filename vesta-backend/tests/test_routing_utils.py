from routing_utils import (
    analyze_task_context,
    enforce_model_consistency,
    estimate_energy_requirement,
    should_upgrade_model,
)


def test_estimate_energy_requirement_complex_message_scores_higher():
    simple_message = "What is 2+2?"
    complex_message = (
        "Analyze and compare the tradeoffs of these approaches and justify each step."
    )

    simple_score = estimate_energy_requirement(simple_message)
    complex_score = estimate_energy_requirement(complex_message)

    assert complex_score > simple_score
    assert complex_score >= 0.6


def test_analyze_task_context_detects_continuation_and_consistency_requirement():
    history = [
        {"role": "user", "content": "Draft an email to my team."},
        {"role": "assistant", "content": "Here is a first draft."},
    ]

    context = analyze_task_context(history, "Make it more formal.")

    assert context.is_continuation is True
    assert context.requires_consistency is True
    assert context.depth == 1


def test_enforce_model_consistency_prevents_downgrade_mid_task():
    final_model, was_upgraded = enforce_model_consistency(
        selected_model="lite",
        history=[{"role": "user", "content": "Previous task message"}],
        last_model_used="deep",
    )

    assert final_model == "deep"
    assert was_upgraded is True


def test_should_upgrade_model_from_lite_on_refinement_request():
    history = [
        {"role": "user", "content": "Draft an email to my team."},
        {"role": "assistant", "content": "Here is a draft email."},
    ]

    upgraded_model = should_upgrade_model(
        message="Please improve this and make it better.",
        history=history,
        last_model_used="lite",
    )

    assert upgraded_model == "general"
