"""Convergence evaluator for PPO training runs."""
from __future__ import annotations

import csv
import json
import math
from pathlib import Path


def _load_rewards(log_dir: str) -> list[float]:
    root = Path(log_dir)
    candidates = (
        root / "rewards.jsonl",
        root / "rewards.csv",
        root / "events.out.tfevents.jsonl",
    )

    for path in candidates:
        if not path.exists():
            continue
        if path.suffix == ".csv":
            with path.open() as fh:
                reader = csv.DictReader(fh)
                rewards = [float(row["reward"]) for row in reader if row.get("reward") is not None]
        else:
            rewards = []
            for line in path.read_text().splitlines():
                if not line.strip():
                    continue
                payload = json.loads(line)
                if "reward" in payload:
                    rewards.append(float(payload["reward"]))
                elif payload.get("tag") == "rollout/ep_rew_mean" and "value" in payload:
                    rewards.append(float(payload["value"]))
        if rewards:
            return rewards

    raise FileNotFoundError(f"No reward series found in {root}")


def evaluate_convergence(
    log_dir: str,
    window: int = 100,
    stability_ratio: float = 0.10,
) -> dict:
    rewards = _load_rewards(log_dir)
    effective_window = max(1, min(window, len(rewards)))
    tail = rewards[-effective_window:]
    head = rewards[:effective_window]

    mean_reward = sum(tail) / len(tail)
    variance = sum((value - mean_reward) ** 2 for value in tail) / len(tail)
    reward_std = math.sqrt(variance)
    coeff_var = reward_std / max(abs(mean_reward), 1e-9)
    head_mean = sum(head) / len(head)
    improvement_pct = (mean_reward - head_mean) / max(abs(head_mean), 1.0)

    return {
        "points": len(rewards),
        "window": effective_window,
        "mean_reward": mean_reward,
        "reward_std": reward_std,
        "coeff_var": coeff_var,
        "improvement_pct": improvement_pct,
        "stability_ratio": stability_ratio,
        "is_converged": coeff_var < stability_ratio and improvement_pct >= 0.0,
    }

