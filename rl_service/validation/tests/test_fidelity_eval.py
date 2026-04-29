from rl_service.validation.fidelity import evaluate_fidelity


def test_fidelity_within_tolerance():
    twin_metrics = {"avg_match_seconds": 32.5, "p95": 78.0}
    prod_metrics = {"avg_match_seconds": 35.1, "p95": 82.5}
    result = evaluate_fidelity(twin_metrics, prod_metrics)
    assert result["delta_avg_pct"] < 0.15
    assert result["pass"] is True

