"""
Model drift detection (MLOps §4.4).

Two complementary checks, kept dependency-light (numpy + optional scipy) so they
can run in the serving container or a scheduled job without pulling SB3/torch:

  • Data drift  — Population Stability Index (PSI) of the live observation
    features against a reference distribution captured at training time
    (``build_reference`` → ``artifacts/drift_baseline.json``). PSI is the
    industry-standard measure: <0.1 stable, 0.1–0.25 moderate, >0.25 significant.

  • Concept drift — divergence between the ETA the agent *predicted* and the
    match time actually *realised* in production (from the inference log),
    via MAPE and a two-sample Kolmogorov–Smirnov test.

Neither check requires the confidential production dataset to be demonstrated:
the reference is synthetic (training distribution) and the live sample can be a
shifted synthetic batch, which is exactly how the unit tests exercise it.
"""
from __future__ import annotations

import numpy as np

# PSI interpretation thresholds (Siddiqi, 2006 — credit-scoring convention).
PSI_MODERATE = 0.10
PSI_SIGNIFICANT = 0.25


def build_reference(observations, n_bins: int = 10) -> dict:
    """Capture a per-feature reference distribution (quantile bins + proportions)
    from a batch of training observations. Serialisable to JSON."""
    obs = np.asarray(observations, dtype=float)
    if obs.ndim != 2:
        raise ValueError(f"observations must be 2D (n_samples, n_features), got {obs.shape}")
    n_samples, n_features = obs.shape
    features = []
    for j in range(n_features):
        col = obs[:, j]
        edges = np.unique(np.quantile(col, np.linspace(0.0, 1.0, n_bins + 1)))
        if edges.size < 2:  # degenerate/constant feature
            c = float(col[0])
            edges = np.array([c - 1e-6, c + 1e-6])
        counts, _ = np.histogram(col, bins=edges)
        props = counts / max(counts.sum(), 1)
        features.append({"edges": edges.tolist(), "ref_props": props.tolist()})
    return {"n_features": int(n_features), "n_samples": int(n_samples),
            "n_bins": int(n_bins), "features": features}


def population_stability_index(reference: dict, sample, eps: float = 1e-6) -> dict:
    """PSI of a live observation batch vs the training reference."""
    obs = np.asarray(sample, dtype=float)
    feats = reference["features"]
    if obs.shape[1] != len(feats):
        raise ValueError(f"feature count mismatch: sample {obs.shape[1]} vs reference {len(feats)}")
    psis = np.empty(len(feats))
    for j, f in enumerate(feats):
        edges = np.asarray(f["edges"], dtype=float)
        ref = np.asarray(f["ref_props"], dtype=float)
        counts, _ = np.histogram(obs[:, j], bins=edges)
        cur = counts / max(counts.sum(), 1)
        ref_c = np.clip(ref, eps, None)
        cur_c = np.clip(cur, eps, None)
        psis[j] = float(np.sum((cur_c - ref_c) * np.log(cur_c / ref_c)))
    max_psi = float(psis.max())
    mean_psi = float(psis.mean())
    n_drifted = int((psis > PSI_SIGNIFICANT).sum())
    frac_drifted = n_drifted / len(feats)
    # Aggregate rule robust to single-feature tail noise (max over 69 features is
    # too sensitive): flag drift when the *average* feature shifts materially OR a
    # meaningful fraction of features individually cross the significance line.
    drift = bool(mean_psi > PSI_MODERATE or frac_drifted > 0.10)
    return {
        "per_feature_psi": psis.round(4).tolist(),
        "max_psi": round(max_psi, 4),
        "mean_psi": round(mean_psi, 4),
        "n_drifted_features": n_drifted,
        "frac_drifted_features": round(frac_drifted, 3),
        "drift": drift,
        "moderate": bool(not drift and mean_psi > PSI_MODERATE / 2),
    }


def concept_drift(predicted, realized, rel_threshold: float = 0.20) -> dict:
    """Divergence between predicted ETA and realised match time (concept drift)."""
    p = np.asarray(predicted, dtype=float)
    r = np.asarray(realized, dtype=float)
    if p.size == 0 or r.size == 0:
        return {"drift": False, "reason": "no_data"}
    mape = float(np.mean(np.abs(r - p) / np.clip(np.abs(p), 1e-6, None)))
    result = {
        "mape": round(mape, 4),
        "pred_mean": round(float(p.mean()), 4),
        "realized_mean": round(float(r.mean()), 4),
        "drift": bool(mape > rel_threshold),
    }
    try:  # scipy is optional; KS strengthens the signal when available
        from scipy.stats import ks_2samp
        ks = ks_2samp(p, r)
        result["ks_stat"] = round(float(ks.statistic), 4)
        result["ks_pvalue"] = round(float(ks.pvalue), 4)
        result["distribution_shift"] = bool(ks.pvalue < 0.05)
    except Exception:
        pass
    return result
