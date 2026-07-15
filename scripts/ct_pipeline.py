#!/usr/bin/env python3
"""
ct_pipeline.py — Continuous Training pipeline (MLOps §4.4).

Closes the MLOps loop: monitor → (re)train → validate → register → promote.

  1. Drift check      run scripts/drift_report.py against the training baseline.
  2. Decide           retrain if drift is detected (or --force / scheduled run).
  3. Retrain          python -m rl_service.train_tfm  (fresh artifacts + MLflow run).
  4. Register         add the new model version to the registry.
  5. Promote          promote to production ONLY if the promotion policy passes.

Runs entirely on synthetic data (the reference is the training distribution and
the live sample is a synthetic batch — use ``--shift`` to simulate drift). Wiring
real production telemetry is future work (§5.2). ``--dry-run`` prints the plan
without training or mutating the registry.

Usage:
  python scripts/ct_pipeline.py --dry-run
  python scripts/ct_pipeline.py --shift 0.2 --timesteps 100000
  python scripts/ct_pipeline.py --force            # retrain regardless of drift
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DRIFT_REPORT = ROOT / "scripts" / "drift_report.py"
REPORT_OUT = "/tmp/ct_drift_report.json"


def _run(cmd: list[str]) -> None:
    print(f"[ct] $ {' '.join(str(c) for c in cmd)}")
    subprocess.run(cmd, check=True, cwd=str(ROOT))


def _check_drift(shift: float) -> dict:
    _run([sys.executable, str(DRIFT_REPORT), "--shift", str(shift), "--report-out", REPORT_OUT])
    return json.loads(Path(REPORT_OUT).read_text())["data_drift"]


def main() -> None:
    ap = argparse.ArgumentParser(description="Continuous training pipeline")
    ap.add_argument("--timesteps", type=int, default=100_000)
    ap.add_argument("--eval-episodes", type=int, default=1000)
    ap.add_argument("--shift", type=float, default=0.0, help="simulate covariate drift for the demo")
    ap.add_argument("--force", action="store_true", help="retrain even if no drift")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    print("[ct] Step 1 — drift check")
    drift = _check_drift(args.shift)
    print(f"[ct]   drift={drift['drift']} mean_psi={drift['mean_psi']} "
          f"n_drifted={drift['n_drifted_features']}")

    retrain = args.force or drift["drift"]
    if not retrain:
        print("[ct] No drift and --force not set → nothing to do. ✅")
        return

    if args.dry_run:
        print(f"[ct] DRY RUN: would retrain ({args.timesteps} steps) → gate → register → promote.")
        return

    print("[ct] Step 2 — retrain")
    _run([sys.executable, "-m", "rl_service.train_tfm",
          "--timesteps", str(args.timesteps), "--eval-episodes", str(args.eval_episodes)])

    print("[ct] Step 3 — register + gated promotion")
    from rl_service.registry import register, promote
    version = register()
    try:
        promote(version, "production")
        print(f"[ct] ✅ promoted {version} to production")
    except SystemExit as exc:
        print(f"[ct] ⚠️  {version} registered but NOT promoted: {exc}")


if __name__ == "__main__":
    main()
