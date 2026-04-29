from __future__ import annotations

import csv
import json
import subprocess
import sys
from pathlib import Path


def test_release_gate_writes_report_and_exits_zero(tmp_path):
    log_dir = tmp_path / "logs"
    log_dir.mkdir()
    with (log_dir / "rewards.csv").open("w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=["step", "reward"])
        writer.writeheader()
        for step in range(150):
            writer.writerow({"step": step, "reward": 100.0 + (step / 10_000)})

    twin_metrics = tmp_path / "twin.json"
    prod_metrics = tmp_path / "prod.json"
    report_file = tmp_path / "report.json"
    twin_metrics.write_text(json.dumps({"avg_match_seconds": 32.5, "p95": 78.0}))
    prod_metrics.write_text(json.dumps({"avg_match_seconds": 35.1, "p95": 82.5}))

    result = subprocess.run(
        [
            sys.executable,
            "scripts/validate_ai_release.py",
            "--log-dir",
            str(log_dir),
            "--twin-metrics",
            str(twin_metrics),
            "--prod-metrics",
            str(prod_metrics),
            "--report-out",
            str(report_file),
        ],
        cwd=Path(__file__).resolve().parents[3],
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr
    report = json.loads(report_file.read_text())
    assert report["pass"] is True
    assert report["convergence"]["is_converged"] is True
    assert report["fidelity"]["pass"] is True
    assert report["robustness"]["pass"] is True

