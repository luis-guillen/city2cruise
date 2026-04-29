#!/usr/bin/env python3
"""AI/RL release gate for milestone 6.5."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from rl_service.synthetic_data import generate_episode, inject_gps_noise
from rl_service.validation.convergence import evaluate_convergence
from rl_service.validation.fidelity import evaluate_fidelity
from rl_service.validation.robustness import evaluate_robustness, inject_packet_loss


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate AI/RL release gate")
    parser.add_argument("--log-dir", required=True, help="Training metrics directory")
    parser.add_argument("--twin-metrics", required=True, help="Path to twin metrics JSON")
    parser.add_argument("--prod-metrics", required=True, help="Path to production metrics JSON")
    parser.add_argument(
        "--report-out",
        default="/tmp/ai_release_report.json",
        help="Path where the JSON report will be written",
    )
    return parser.parse_args()


def _load_json(path: str) -> dict:
    return json.loads(Path(path).read_text())


def _sample_robustness() -> dict:
    episode = generate_episode(seed=1)
    points = [(driver.lat, driver.lon) for driver in episode.drivers] * 50
    degraded = inject_packet_loss(points, loss_rate=0.10, seed=1)
    noisy = inject_gps_noise(list(degraded), seed=2, sigma_m=15.0)
    return evaluate_robustness(noisy, expected_count=degraded.original_count)


def main() -> int:
    args = _parse_args()
    convergence = evaluate_convergence(args.log_dir)
    fidelity = evaluate_fidelity(_load_json(args.twin_metrics), _load_json(args.prod_metrics))
    robustness = _sample_robustness()

    report = {
        "convergence": convergence,
        "fidelity": fidelity,
        "robustness": robustness,
        "pass": convergence["is_converged"] and fidelity["pass"] and robustness["pass"],
    }

    report_path = Path(args.report_out)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2, sort_keys=True))
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0 if report["pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
