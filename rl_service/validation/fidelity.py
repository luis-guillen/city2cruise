"""Sim-to-real fidelity evaluator."""
from __future__ import annotations


def _get_metric(metrics: dict, *keys: str) -> float:
    for key in keys:
        if key in metrics:
            return float(metrics[key])
    raise KeyError(f"Missing any of metrics keys: {keys}")


def evaluate_fidelity(twin: dict, prod: dict, threshold_pct: float = 0.20) -> dict:
    twin_avg = _get_metric(twin, "avg_match_seconds")
    prod_avg = _get_metric(prod, "avg_match_seconds")
    twin_p95 = _get_metric(twin, "p95", "p95_match_seconds")
    prod_p95 = _get_metric(prod, "p95", "p95_match_seconds")

    delta_avg = abs(prod_avg - twin_avg) / max(abs(twin_avg), 1.0)
    delta_p95 = abs(prod_p95 - twin_p95) / max(abs(twin_p95), 1.0)
    return {
        "twin_avg_match_seconds": twin_avg,
        "prod_avg_match_seconds": prod_avg,
        "twin_p95_match_seconds": twin_p95,
        "prod_p95_match_seconds": prod_p95,
        "delta_avg_pct": delta_avg,
        "delta_p95_pct": delta_p95,
        "pass": delta_avg < threshold_pct and delta_p95 < threshold_pct,
    }

