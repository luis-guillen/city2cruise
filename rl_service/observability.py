"""
Model observability (MLOps §4.4) — Prometheus metrics for the RL service.

Exposes model-specific telemetry that the backend dashboard never had: inference
latency, prediction volume/outcome, top-score distribution and the loaded model's
identity/size. Scraped by Prometheus at ``/metrics/prometheus``.
"""
from __future__ import annotations

from prometheus_client import Counter, Gauge, Histogram, generate_latest, CONTENT_TYPE_LATEST

INFERENCE_DURATION = Histogram(
    "rl_inference_duration_seconds",
    "Driver-ranking inference latency (seconds)",
    buckets=(0.001, 0.005, 0.01, 0.02, 0.05, 0.1, 0.25, 0.5),
)
PREDICTIONS_TOTAL = Counter(
    "rl_predictions_total",
    "Total ranking predictions served, by outcome",
    ["outcome"],
)
RANKING_TOP_SCORE = Histogram(
    "rl_ranking_top_score",
    "Distribution of the top-ranked driver's confidence score",
    buckets=(0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0),
)
MODEL_INFO = Gauge("rl_model_info", "Loaded model info (always 1)", ["version"])
MODEL_TIMESTEPS = Gauge("rl_model_total_timesteps", "Total training timesteps of the loaded model")


def record_inference(duration_s: float, rankings) -> None:
    INFERENCE_DURATION.observe(duration_s)
    PREDICTIONS_TOTAL.labels(outcome="ok" if rankings else "empty").inc()
    if rankings:
        RANKING_TOP_SCORE.observe(float(rankings[0].score))


def set_model_info(version: str, total_timesteps: int | None) -> None:
    MODEL_INFO.labels(version=version).set(1)
    MODEL_TIMESTEPS.set(total_timesteps or 0)


def prometheus_latest() -> tuple[bytes, str]:
    return generate_latest(), CONTENT_TYPE_LATEST
