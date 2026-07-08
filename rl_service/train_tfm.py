"""
train_tfm.py — Canonical, reproducible training + evaluation run for the TFM.

Produces the evidence artifacts referenced in the thesis (all under
``rl_service/artifacts/``):

  cruise_dispatch_ppo.zip        Trained PPO checkpoint (Stable-Baselines3)
  cruise_dispatch_ppo.meta.json  Model version metadata
  rewards.csv                    Convergence series (step,reward) → Figure 9
  tb/                            TensorBoard event files
  benchmark.json                 PPO vs greedy vs random → Figure 10
  fidelity.json                  Sim-to-real reality gap → Figure 11
  summary.json                   One-shot summary of every acceptance metric

Usage:
  python -m rl_service.train_tfm                       # 100k steps, N=1000 eval
  python -m rl_service.train_tfm --timesteps 100000 --eval-episodes 1000

The training environments use domain randomization (Tobin et al., 2017); the
evaluation/benchmark environments are deterministic (DR off) so PPO, greedy and
random are compared on identical held-out episodes.
"""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import BaseCallback
from stable_baselines3.common.env_util import make_vec_env

from .agent import MODEL_PATH, MODEL_META_PATH, RLAgent
from .gym_env import CruiseDispatchEnv
from .benchmark import run_episodes, greedy_policy, random_policy, make_rl_policy
from .validation.convergence import evaluate_convergence
from .validation.fidelity import evaluate_fidelity

ARTIFACTS = MODEL_PATH.parent
REWARDS_CSV = ARTIFACTS / "rewards.csv"
TB_DIR = ARTIFACTS / "tb"
BENCHMARK_JSON = ARTIFACTS / "benchmark.json"
FIDELITY_JSON = ARTIFACTS / "fidelity.json"
SUMMARY_JSON = ARTIFACTS / "summary.json"

FIXTURES = Path(__file__).resolve().parent / "validation" / "fixtures"


class RewardCsvCallback(BaseCallback):
    """Samples the rolling mean episode reward every ``log_freq`` steps and writes
    it to rewards.csv (step,reward) — the convergence series used for Figure 9."""

    def __init__(self, csv_path: Path, log_freq: int = 2000) -> None:
        super().__init__()
        self._csv_path = csv_path
        self._log_freq = log_freq
        self._next_log = log_freq
        self._rows: list[tuple[int, float]] = []

    def _on_training_start(self) -> None:
        self._csv_path.parent.mkdir(parents=True, exist_ok=True)
        with self._csv_path.open("w", newline="") as fh:
            csv.writer(fh).writerow(["step", "reward"])

    def _on_step(self) -> bool:
        if self.num_timesteps >= self._next_log:
            self._next_log += self._log_freq
            buf = self.model.ep_info_buffer
            if buf:
                mean_r = sum(ep["r"] for ep in buf) / len(buf)
                self._rows.append((int(self.num_timesteps), float(mean_r)))
                with self._csv_path.open("a", newline="") as fh:
                    csv.writer(fh).writerow([int(self.num_timesteps), round(float(mean_r), 4)])
        return True


def _train(timesteps: int, domain_randomization: bool = True) -> dict:
    print(f"[train_tfm] Training PPO for {timesteps:,} steps "
          f"(domain randomization {'ON' if domain_randomization else 'OFF'})…")
    vec_env = make_vec_env(
        lambda: CruiseDispatchEnv(
            n_drivers=8, n_requests=12, max_steps=20,
            domain_randomization=domain_randomization,
        ),
        n_envs=8,
    )
    model = PPO(
        policy="MlpPolicy",
        env=vec_env,
        learning_rate=1e-4,
        n_steps=1024,
        batch_size=256,
        n_epochs=10,
        gamma=0.99,
        gae_lambda=0.95,
        clip_range=0.2,
        ent_coef=0.005,
        policy_kwargs={"net_arch": [256, 256]},
        tensorboard_log=str(TB_DIR),
        seed=42,
        verbose=0,
    )
    cb = RewardCsvCallback(REWARDS_CSV)
    model.learn(total_timesteps=timesteps, callback=cb, progress_bar=False)

    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    model.save(str(MODEL_PATH))
    MODEL_META_PATH.write_text(json.dumps({
        "modelVersion": RLAgent.MODEL_VERSION,
        "totalTimesteps": timesteps,
        "domainRandomization": True,
    }, indent=2))
    print(f"[train_tfm] Saved model → {MODEL_PATH}.zip  ({len(cb._rows)} rollout points)")
    return {"timesteps": timesteps, "rollout_points": len(cb._rows)}


def _benchmark(n_episodes: int) -> dict:
    print(f"[train_tfm] Benchmarking over {n_episodes} deterministic episodes…")
    model = PPO.load(str(MODEL_PATH))
    results = {
        "greedy": run_episodes(greedy_policy, n_episodes, policy_name="greedy"),
        "random": run_episodes(random_policy, n_episodes, policy_name="random"),
        "rl_ppo": run_episodes(make_rl_policy(model), n_episodes, policy_name="rl_ppo"),
    }
    payload = {
        name: {
            "mean_reward": r.mean_reward,
            "p95_reward": r.p95_reward,
            "mean_assign_seconds": r.mean_assign_seconds,
            "mean_queue_left": r.mean_queue_left,
            "mean_urgency_loss": r.mean_urgency_loss,
        }
        for name, r in results.items()
    }
    for r in results.values():
        print("  " + r.summary())

    greedy_eta = payload["greedy"]["mean_assign_seconds"]
    rl_eta = payload["rl_ppo"]["mean_assign_seconds"]
    greedy_rw = payload["greedy"]["mean_reward"]
    rl_rw = payload["rl_ppo"]["mean_reward"]
    payload["improvement"] = {
        "reward_vs_greedy_pct": (rl_rw - greedy_rw) / abs(greedy_rw) if greedy_rw else 0.0,
        "assign_time_vs_greedy_pct": (greedy_eta - rl_eta) / greedy_eta if greedy_eta else 0.0,
    }
    BENCHMARK_JSON.write_text(json.dumps(payload, indent=2))
    return payload


def _fidelity() -> dict:
    twin = json.loads((FIXTURES / "twin_metrics.json").read_text())
    prod = json.loads((FIXTURES / "prod_metrics.json").read_text())
    result = evaluate_fidelity(twin, prod, threshold_pct=0.20)
    FIDELITY_JSON.write_text(json.dumps(result, indent=2))
    print(f"[train_tfm] Reality gap avg={result['delta_avg_pct']*100:.1f}% "
          f"p95={result['delta_p95_pct']*100:.1f}%  pass={result['pass']}")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="TFM canonical PPO training + evaluation")
    parser.add_argument("--timesteps", type=int, default=100_000)
    parser.add_argument("--eval-episodes", type=int, default=1000)
    parser.add_argument("--no-domain-randomization", action="store_true",
                        help="Diagnostic: train without domain randomization")
    args = parser.parse_args()

    train_info = _train(args.timesteps, domain_randomization=not args.no_domain_randomization)
    convergence = evaluate_convergence(str(ARTIFACTS), window=20)
    print(f"[train_tfm] Convergence: mean_reward={convergence['mean_reward']:.2f} "
          f"coeff_var={convergence['coeff_var']:.3f} converged={convergence['is_converged']}")
    benchmark = _benchmark(args.eval_episodes)
    fidelity = _fidelity()

    summary = {
        "training": train_info,
        "convergence": convergence,
        "benchmark": benchmark,
        "fidelity": fidelity,
    }
    SUMMARY_JSON.write_text(json.dumps(summary, indent=2))
    print(f"[train_tfm] Wrote summary → {SUMMARY_JSON}")


if __name__ == "__main__":
    main()
