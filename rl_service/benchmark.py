"""
benchmark.py — Sprint 3.F.2 (AC#1 Hito 3.5)

Compares the PPO RL agent against a nearest-driver greedy baseline over
N simulated episodes using CruiseDispatchEnv.

Metrics reported
────────────────
  mean_reward         Mean cumulative episode reward
  p95_reward          95th-percentile episode reward
  mean_queue_left     Average pending requests still unhandled at episode end
  mean_urgency_loss   Average urgency of unhandled requests (0 if all handled)
  mean_inference_ms   Average wall-clock ms per step (policy query only)

Usage
─────
  python -m rl_service.benchmark          # quick run (N=200)
  python -m rl_service.benchmark 1000     # full validation run
"""

from __future__ import annotations

import importlib.util
import math
import random
import statistics
import sys
import time
from dataclasses import dataclass, field
from typing import Callable

import numpy as np

from .gym_env import (
    CruiseDispatchEnv,
    OBS_PER_DRIVER,
    MAX_DRIVERS,
)

# ─── Result dataclass ─────────────────────────────────────────────────────────

@dataclass
class BenchmarkResult:
    policy_name: str
    n_episodes: int
    mean_reward: float
    p95_reward: float
    mean_queue_left: float
    mean_urgency_loss: float
    mean_inference_ms: float
    all_rewards: list[float] = field(default_factory=list)

    def summary(self) -> str:
        return (
            f"[{self.policy_name:12s}] "
            f"reward mean={self.mean_reward:7.2f}  p95={self.p95_reward:7.2f}  "
            f"queue_left={self.mean_queue_left:.2f}  "
            f"urgency_loss={self.mean_urgency_loss:.3f}  "
            f"step_ms={self.mean_inference_ms:.2f}"
        )


# ─── Greedy baseline: pick available driver with lowest eta_norm ──────────────

def greedy_policy(obs: np.ndarray) -> int:
    """
    Nearest-driver heuristic: pick the available driver with the lowest eta_norm.

    The env interprets `action` as an index into the *available* subset of drivers
    (those with is_available==True), in their original order. This policy scans
    all obs slots, collects (available_position, eta_norm) pairs, and returns the
    position in the available list with minimum eta_norm.
    """
    available_etas: list[float] = []

    for i in range(MAX_DRIVERS):
        base = i * OBS_PER_DRIVER
        if obs[base + 4] > 0.5:  # is_available flag
            available_etas.append(float(obs[base + 3]))  # eta_norm

    if not available_etas:
        return 0  # all drivers busy; any action triggers penalty anyway

    # Return index in available-drivers list with min eta_norm
    return int(min(range(len(available_etas)), key=lambda j: available_etas[j]))


# ─── Random baseline ──────────────────────────────────────────────────────────

def random_policy(obs: np.ndarray) -> int:  # noqa: ARG001
    return random.randint(0, MAX_DRIVERS - 1)


# ─── Episode runner ───────────────────────────────────────────────────────────

def run_episodes(
    policy: Callable[[np.ndarray], int],
    n_episodes: int,
    seed: int = 42,
    policy_name: str = "unknown",
) -> BenchmarkResult:
    """Run `n_episodes` episodes with `policy` and collect metrics."""
    rewards: list[float] = []
    queues: list[float] = []
    urgency_losses: list[float] = []
    inference_times: list[float] = []  # total per episode, divided by steps later
    step_counts: list[int] = []

    env = CruiseDispatchEnv(n_drivers=8, n_requests=12, max_steps=20)

    for ep in range(n_episodes):
        obs, _info = env.reset(seed=seed + ep)
        done = truncated = False
        ep_reward = 0.0
        ep_steps = 0
        ep_inference_ns = 0.0

        while not (done or truncated):
            t0 = time.perf_counter_ns()
            action = policy(obs)
            ep_inference_ns += time.perf_counter_ns() - t0

            obs, reward, done, truncated, info = env.step(action)
            ep_reward += reward
            ep_steps += 1

        rewards.append(ep_reward)
        queues.append(float(info.get("remaining_requests", 0)))
        urgency_losses.append(_mean_pending_urgency(env))
        if ep_steps > 0:
            inference_times.append(ep_inference_ns / ep_steps / 1e6)  # ms per step
        step_counts.append(ep_steps)

    n = len(rewards)
    sorted_r = sorted(rewards)

    return BenchmarkResult(
        policy_name=policy_name,
        n_episodes=n,
        mean_reward=statistics.mean(rewards),
        p95_reward=sorted_r[math.ceil(0.95 * n) - 1],
        mean_queue_left=statistics.mean(queues),
        mean_urgency_loss=statistics.mean(urgency_losses),
        mean_inference_ms=statistics.mean(inference_times) if inference_times else 0.0,
        all_rewards=rewards,
    )


def _mean_pending_urgency(env: CruiseDispatchEnv) -> float:
    """Average urgency of requests still pending at episode end (0 if none)."""
    pending = getattr(env, "_pending", [])
    if not pending:
        return 0.0
    return sum(r.urgency for r in pending) / len(pending)


# ─── RL policy wrapper (requires stable_baselines3) ──────────────────────────

def make_rl_policy(model) -> Callable[[np.ndarray], int]:
    """Wrap a loaded SB3 PPO model as a single-step callable policy."""
    def _policy(obs: np.ndarray) -> int:
        action, _ = model.predict(obs, deterministic=True)
        return int(action)
    return _policy


# ─── Main entry point ─────────────────────────────────────────────────────────

def run_benchmark(n_episodes: int = 200, seed: int = 42) -> dict[str, BenchmarkResult]:
    """
    Run greedy and (if SB3 available) RL policies over n_episodes episodes.
    Returns a dict keyed by policy name.
    """
    results: dict[str, BenchmarkResult] = {}

    print(f"\n=== CruiseDispatch Benchmark  N={n_episodes}  seed={seed} ===\n")

    # Greedy baseline
    greedy = run_episodes(greedy_policy, n_episodes, seed=seed, policy_name="greedy")
    results["greedy"] = greedy
    print(greedy.summary())

    # RL policy (skip gracefully if SB3/torch not installed)
    has_sb3 = importlib.util.find_spec("stable_baselines3") is not None
    if has_sb3:
        try:
            from stable_baselines3 import PPO
            from .agent import MODEL_PATH
            import pathlib

            model_zip = pathlib.Path(f"{MODEL_PATH}.zip")
            if model_zip.exists():
                model = PPO.load(str(MODEL_PATH))
                rl = run_episodes(make_rl_policy(model), n_episodes, seed=seed, policy_name="rl_ppo")
            else:
                # No checkpoint — use untrained model (should still beat purely random)
                env_fn = lambda: CruiseDispatchEnv(n_drivers=8, n_requests=12, max_steps=20)
                from stable_baselines3.common.env_util import make_vec_env
                vec_env = make_vec_env(env_fn, n_envs=1)
                model = PPO("MlpPolicy", vec_env, verbose=0)
                rl = run_episodes(make_rl_policy(model), n_episodes, seed=seed, policy_name="rl_ppo_untrained")

            results["rl_ppo"] = rl
            print(rl.summary())

        except Exception as exc:
            print(f"[benchmark] RL policy error (non-fatal): {exc}")
    else:
        print("[benchmark] stable_baselines3 not installed — skipping RL policy")

    print()
    return results


if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 200
    run_benchmark(n_episodes=n)
