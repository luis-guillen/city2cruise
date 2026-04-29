from __future__ import annotations

import csv

from rl_service.validation.convergence import evaluate_convergence


def test_convergence_returns_metrics_dict(tmp_path):
    log_dir = tmp_path / "logs"
    log_dir.mkdir()
    with (log_dir / "rewards.csv").open("w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=["step", "reward"])
        writer.writeheader()
        for step in range(200):
            reward = 100.0 if step < 100 else 120.0 + ((step % 2) * 0.2)
            writer.writerow({"step": step, "reward": reward})

    metrics = evaluate_convergence(log_dir=str(log_dir), window=100)
    assert "mean_reward" in metrics and "reward_std" in metrics
    assert "is_converged" in metrics
    assert metrics["mean_reward"] > 119
    assert metrics["is_converged"] is True

