"""Tests for model drift detection (MLOps §4.4)."""
import numpy as np

from rl_service.monitoring.drift import (
    build_reference,
    population_stability_index,
    concept_drift,
)


def _reference(seed=0, n=2000, n_features=8):
    rng = np.random.default_rng(seed)
    return build_reference(rng.uniform(0, 1, size=(n, n_features)))


def test_no_drift_on_same_distribution():
    ref = _reference(seed=0)
    rng = np.random.default_rng(1)
    sample = rng.uniform(0, 1, size=(1500, 8))
    result = population_stability_index(ref, sample)
    assert result["drift"] is False
    assert result["mean_psi"] < 0.10


def test_detects_covariate_shift():
    ref = _reference(seed=0)
    rng = np.random.default_rng(2)
    shifted = np.clip(rng.uniform(0, 1, size=(1500, 8)) + 0.3, 0, 1)
    result = population_stability_index(ref, shifted)
    assert result["drift"] is True
    assert result["n_drifted_features"] > 0


def test_feature_count_mismatch_raises():
    ref = _reference(seed=0, n_features=8)
    try:
        population_stability_index(ref, np.zeros((10, 5)))
        assert False, "expected ValueError"
    except ValueError:
        pass


def test_concept_drift_flags_diverging_eta():
    ok = concept_drift(predicted=[30, 32, 28, 35, 31], realized=[31, 33, 29, 36, 30])
    bad = concept_drift(predicted=[30, 32, 28, 35, 31], realized=[60, 64, 58, 70, 62])
    assert ok["drift"] is False
    assert bad["drift"] is True
    assert bad["mape"] > 0.20


def test_concept_drift_handles_empty():
    assert concept_drift([], [])["drift"] is False
