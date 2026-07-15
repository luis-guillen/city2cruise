#!/usr/bin/env python3
"""
drift_report.py — data + concept drift report for the dispatch agent (MLOps §4.4).

Compares a live observation batch against the training reference distribution
(``rl_service/artifacts/drift_baseline.json``, produced by train_tfm.py) via PSI,
and optionally checks concept drift from an inference log (predicted vs realised
ETA). Writes a JSON report and, optionally, a Prometheus textfile gauge that the
node_exporter textfile collector can scrape.

Since the real production telemetry is confidential, the live sample defaults to a
synthetic batch; ``--shift`` injects a covariate shift to demonstrate detection
(this is exactly how the CT pipeline and tests exercise it). Feeding a real sample
(``--sample-file``) or inference log is a drop-in for production.

Usage:
  python scripts/drift_report.py                          # synthetic, no shift → no drift
  python scripts/drift_report.py --shift 0.2 --fail-on-drift
  python scripts/drift_report.py --prom-out /var/lib/node_exporter/rl_drift.prom
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from rl_service.monitoring.drift import population_stability_index, concept_drift  # noqa: E402

DEFAULT_BASELINE = ROOT / "rl_service" / "artifacts" / "drift_baseline.json"


def _synthetic_sample(n: int, seed: int, shift: float) -> np.ndarray:
    from rl_service.gym_env import CruiseDispatchEnv
    env = CruiseDispatchEnv(n_drivers=8, domain_randomization=True, anticipatory=True)
    env.action_space.seed(seed)
    out = []
    obs, _ = env.reset(seed=seed)
    for i in range(n):
        out.append(obs.copy())
        obs, _, done, trunc, _ = env.step(env.action_space.sample())
        if done or trunc:
            obs, _ = env.reset(seed=seed + i + 1)
    arr = np.asarray(out, dtype=float)
    return np.clip(arr + shift, 0.0, 1.0) if shift else arr


def _load_sample(path: str) -> np.ndarray:
    if path.endswith(".npy"):
        return np.load(path)
    return np.loadtxt(path, delimiter=",")


def _concept_from_log(path: Path) -> dict | None:
    preds, reals = [], []
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        if row.get("predictedEta") is not None and row.get("realizedEta") is not None:
            preds.append(row["predictedEta"])
            reals.append(row["realizedEta"])
    if not preds:
        return None
    return concept_drift(preds, reals)


def _write_prometheus(path: str, data: dict) -> None:
    lines = [
        "# HELP rl_drift_max_psi Max PSI across observation features",
        "# TYPE rl_drift_max_psi gauge",
        f"rl_drift_max_psi {data['max_psi']}",
        "# HELP rl_drift_mean_psi Mean PSI across observation features",
        "# TYPE rl_drift_mean_psi gauge",
        f"rl_drift_mean_psi {data['mean_psi']}",
        "# HELP rl_drift_flag Data drift detected (1) or not (0)",
        "# TYPE rl_drift_flag gauge",
        f"rl_drift_flag {1 if data['drift'] else 0}",
    ]
    Path(path).write_text("\n".join(lines) + "\n")


def main() -> None:
    ap = argparse.ArgumentParser(description="Data + concept drift report")
    ap.add_argument("--baseline", default=str(DEFAULT_BASELINE))
    ap.add_argument("--sample-file", help="npy/csv observations; default = synthetic batch")
    # ≥ ~150 episodes: within-episode correlation (waves/clusters) makes small
    # samples PSI-noisy in the anticipatory formulation.
    ap.add_argument("--n", type=int, default=6000)
    ap.add_argument("--seed", type=int, default=7000)
    ap.add_argument("--shift", type=float, default=0.0, help="synthetic covariate shift (demo/testing)")
    ap.add_argument("--inference-log", help="JSONL with predictedEta/realizedEta for concept drift")
    ap.add_argument("--report-out", default="/tmp/drift_report.json")
    ap.add_argument("--prom-out", help="Prometheus textfile output path")
    ap.add_argument("--fail-on-drift", action="store_true", help="exit 2 if drift detected")
    args = ap.parse_args()

    ref = json.loads(Path(args.baseline).read_text())
    sample = _load_sample(args.sample_file) if args.sample_file else _synthetic_sample(args.n, args.seed, args.shift)
    data = population_stability_index(ref, sample)

    report = {"data_drift": data}
    if args.inference_log and Path(args.inference_log).exists():
        cd = _concept_from_log(Path(args.inference_log))
        if cd is not None:
            report["concept_drift"] = cd

    Path(args.report_out).write_text(json.dumps(report, indent=2))
    if args.prom_out:
        _write_prometheus(args.prom_out, data)

    print(f"[drift_report] data drift={data['drift']} "
          f"mean_psi={data['mean_psi']} n_drifted={data['n_drifted_features']}/{ref['n_features']} "
          f"→ {args.report_out}")
    if report.get("concept_drift"):
        print(f"[drift_report] concept drift={report['concept_drift']['drift']} "
              f"mape={report['concept_drift'].get('mape')}")

    if args.fail_on_drift and data["drift"]:
        sys.exit(2)


if __name__ == "__main__":
    main()
