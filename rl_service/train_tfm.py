"""
train_tfm.py — Canonical, reproducible training + evaluation run for the TFM.

Produces the evidence artifacts referenced in the thesis (all under
``rl_service/artifacts/``):

  cruise_dispatch_ppo.zip        Trained PPO checkpoint (Stable-Baselines3)
  cruise_dispatch_ppo.meta.json  Model version metadata
  rewards.csv                    Convergence series (step,reward) → Figure 9
  tb/                            TensorBoard event files
  benchmark.json                 PPO vs patient/greedy/cascade/random → Figure 10
  fidelity.json                  Sim-to-real reality gap → Figure 11
  summary.json                   One-shot summary of every acceptance metric

Usage:
  python -m rl_service.train_tfm                       # 300k steps, N=1000 eval
  python -m rl_service.train_tfm --timesteps 300000 --eval-episodes 1000

Phase 2 (TFM): trains on the ANTICIPATORY formulation — event-driven arrivals
in cruise waves, driver resource contention, hold actions and hard all-aboard
deadlines — where myopic greedy dispatch is provably suboptimal (see
benchmark.patient_policy for the pre-training ceiling proof).

The training environments use domain randomization (Tobin et al., 2017); the
evaluation/benchmark environments are deterministic (DR off) so every policy
is compared on identical paired-seed held-out episodes.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
from pathlib import Path

from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import BaseCallback
from stable_baselines3.common.env_util import make_vec_env
from stable_baselines3.common.vec_env import VecNormalize

from .agent import MODEL_PATH, MODEL_META_PATH, RLAgent, write_model_meta, HYPERPARAMS
from .gym_env import CruiseDispatchEnv
from .benchmark import (
    run_episodes,
    paired_delta_ci95,
    greedy_policy,
    random_policy,
    cascade_policy,
    patient_policy,
    make_rl_policy,
)
from .validation.convergence import evaluate_convergence
from .validation.fidelity import evaluate_fidelity

ARTIFACTS = MODEL_PATH.parent
REWARDS_CSV = ARTIFACTS / "rewards.csv"
TB_DIR = ARTIFACTS / "tb"
BENCHMARK_JSON = ARTIFACTS / "benchmark.json"
FIDELITY_JSON = ARTIFACTS / "fidelity.json"
SUMMARY_JSON = ARTIFACTS / "summary.json"
BASELINE_JSON = ARTIFACTS / "drift_baseline.json"

FIXTURES = Path(__file__).resolve().parent / "validation" / "fixtures"

# MLflow experiment tracking — optional, degrades gracefully if not installed.
# Local file store at repo-root/mlruns (gitignored). Browse with `mlflow ui`.
MLRUNS_DIR = Path(__file__).resolve().parents[1] / "mlruns"
MLFLOW_EXPERIMENT = "city2cruise-dispatch"
# MLflow 3.x rejects the local file store unless explicitly opted in; the file
# store is sufficient for a zero-infra local `mlflow ui` (no DB server needed).
os.environ.setdefault("MLFLOW_ALLOW_FILE_STORE", "true")
try:
    import mlflow as _mlflow
except Exception:  # pragma: no cover - mlflow is a training-only dep
    _mlflow = None


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


def _train(timesteps: int, domain_randomization: bool = True,
           init_from: str | None = None, learning_rate: float | None = None,
           ent_coef: float | None = None) -> dict:
    print(f"[train_tfm] Training PPO for {timesteps:,} steps "
          f"(domain randomization {'ON' if domain_randomization else 'OFF'}"
          f"{', warm-start from ' + init_from if init_from else ''})…")
    vec_env = make_vec_env(
        lambda: CruiseDispatchEnv(
            n_drivers=8,
            domain_randomization=domain_randomization,
            anticipatory=True,
        ),
        n_envs=8,
    )
    # Reward normalisation (training-only): episode returns live in the
    # thousands with sparse −150 deadline spikes; normalising stabilises the
    # value loss. Observations are NOT normalised — the serving contract
    # feeds raw [0,1] tensors to the policy.
    vec_env = VecNormalize(
        vec_env, norm_obs=False, norm_reward=True, gamma=HYPERPARAMS["gamma"]
    )
    hp = {k: v for k, v in HYPERPARAMS.items() if k not in ("policy", "net_arch")}
    if learning_rate is not None:
        hp["learning_rate"] = learning_rate
    if ent_coef is not None:
        hp["ent_coef"] = ent_coef

    if init_from:
        # Warm start (e.g., behaviour-cloned from the anticipatory heuristic —
        # scripts/bc_warmstart.py — or a previous production model for
        # continuous training). RL then fine-tunes from that basin.
        model = PPO.load(
            init_from, env=vec_env, tensorboard_log=str(TB_DIR),
            custom_objects={k: v for k, v in hp.items()
                            if k in ("learning_rate", "ent_coef")},
        )
    else:
        model = PPO(
            policy=HYPERPARAMS["policy"],
            env=vec_env,
            policy_kwargs={"net_arch": HYPERPARAMS["net_arch"]},
            tensorboard_log=str(TB_DIR),
            seed=42,
            verbose=0,
            **hp,
        )
    cb = RewardCsvCallback(REWARDS_CSV)
    model.learn(total_timesteps=timesteps, callback=cb, progress_bar=False)

    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    model.save(str(MODEL_PATH))
    write_model_meta(timesteps, extra={
        "domainRandomization": domain_randomization,
        "initFrom": init_from,
        "learningRateOverride": learning_rate,
        "entCoefOverride": ent_coef,
    })
    print(f"[train_tfm] Saved model → {MODEL_PATH}.zip  ({len(cb._rows)} rollout points)")
    return {"timesteps": timesteps, "rollout_points": len(cb._rows),
            "init_from": init_from}


def _benchmark(n_episodes: int) -> dict:
    print(f"[train_tfm] Benchmarking over {n_episodes} deterministic episodes…")
    model = PPO.load(str(MODEL_PATH))
    results = {
        "greedy": run_episodes(greedy_policy, n_episodes, policy_name="greedy"),
        "random": run_episodes(random_policy, n_episodes, policy_name="random"),
        "cascade": run_episodes(cascade_policy, n_episodes, policy_name="cascade"),
        "patient": run_episodes(patient_policy, n_episodes, policy_name="patient"),
        "rl_ppo": run_episodes(make_rl_policy(model), n_episodes, policy_name="rl_ppo"),
    }
    payload = {
        name: {
            "mean_reward": r.mean_reward,
            "p95_reward": r.p95_reward,
            "mean_assign_seconds": r.mean_assign_seconds,
            "mean_queue_left": r.mean_queue_left,
            "mean_urgency_loss": r.mean_urgency_loss,
            "mean_expired": r.mean_expired,
            "mean_utilization": r.mean_utilization,
        }
        for name, r in results.items()
    }
    for r in results.values():
        print("  " + r.summary())

    greedy_eta = payload["greedy"]["mean_assign_seconds"]
    rl_eta = payload["rl_ppo"]["mean_assign_seconds"]
    greedy_rw = payload["greedy"]["mean_reward"]
    rl_rw = payload["rl_ppo"]["mean_reward"]
    patient_rw = payload["patient"]["mean_reward"]
    ci = paired_delta_ci95(
        results["rl_ppo"].all_rewards, results["greedy"].all_rewards
    )
    payload["improvement"] = {
        "reward_vs_greedy_pct": (rl_rw - greedy_rw) / abs(greedy_rw) if greedy_rw else 0.0,
        "assign_time_vs_greedy_pct": (greedy_eta - rl_eta) / greedy_eta if greedy_eta else 0.0,
        "reward_vs_patient_pct": (rl_rw - patient_rw) / abs(patient_rw) if patient_rw else 0.0,
        "delta_vs_greedy_ci95": ci,
    }
    BENCHMARK_JSON.write_text(json.dumps(payload, indent=2))
    return payload


def _build_drift_baseline(n_samples: int = 16_000) -> dict:
    """Capture the training-time observation distribution as the drift reference.

    In the anticipatory formulation observations are strongly correlated within
    an episode (same waves/clusters over ~50 steps), so the reference must span
    MANY episodes: 16k obs ≈ 300+ episodes keeps the same-distribution PSI well
    below the drift rule while a 0.08 covariate shift scores ≈ 4.3 (calibrated).
    """
    from .monitoring.drift import build_reference
    env = CruiseDispatchEnv(n_drivers=8, domain_randomization=True, anticipatory=True)
    env.action_space.seed(123)
    obs_list = []
    obs, _ = env.reset(seed=123)
    for i in range(n_samples):
        obs_list.append(obs.copy())
        obs, _, done, trunc, _ = env.step(env.action_space.sample())
        if done or trunc:
            obs, _ = env.reset(seed=124 + i)
    ref = build_reference(obs_list)
    BASELINE_JSON.write_text(json.dumps(ref))
    print(f"[train_tfm] Wrote drift baseline ({ref['n_samples']} obs × "
          f"{ref['n_features']} feats) → {BASELINE_JSON}")
    return ref


def _fidelity() -> dict:
    twin = json.loads((FIXTURES / "twin_metrics.json").read_text())
    prod = json.loads((FIXTURES / "prod_metrics.json").read_text())
    result = evaluate_fidelity(twin, prod, threshold_pct=0.20)
    FIDELITY_JSON.write_text(json.dumps(result, indent=2))
    print(f"[train_tfm] Reality gap avg={result['delta_avg_pct']*100:.1f}% "
          f"p95={result['delta_p95_pct']*100:.1f}%  pass={result['pass']}")
    return result


def _mlflow_log(args, convergence, benchmark, fidelity) -> None:
    """Log params, metrics and artifacts of this run to MLflow (if available)."""
    if _mlflow is None:
        return
    dr = not args.no_domain_randomization
    _mlflow.log_params({**HYPERPARAMS, "timesteps": args.timesteps,
                        "eval_episodes": args.eval_episodes,
                        "domain_randomization": dr, "git_sha": os.getenv("GIT_SHA")})
    b = benchmark
    _mlflow.log_metrics({
        "convergence_mean_reward": convergence["mean_reward"],
        "convergence_coeff_var": convergence["coeff_var"],
        "reward_ppo": b["rl_ppo"]["mean_reward"],
        "reward_greedy": b["greedy"]["mean_reward"],
        "reward_random": b["random"]["mean_reward"],
        "reward_cascade": b["cascade"]["mean_reward"],
        "reward_patient": b["patient"]["mean_reward"],
        "reward_vs_greedy_pct": b["improvement"]["reward_vs_greedy_pct"],
        "reward_vs_random_pct": (b["rl_ppo"]["mean_reward"] - b["random"]["mean_reward"])
                                 / abs(b["random"]["mean_reward"]) if b["random"]["mean_reward"] else 0.0,
        "assign_seconds_ppo": b["rl_ppo"]["mean_assign_seconds"],
        "fidelity_delta_avg_pct": fidelity["delta_avg_pct"],
        "fidelity_delta_p95_pct": fidelity["delta_p95_pct"],
    })
    for f in (Path(f"{MODEL_PATH}.zip"), MODEL_META_PATH, REWARDS_CSV,
              BENCHMARK_JSON, FIDELITY_JSON, SUMMARY_JSON, BASELINE_JSON):
        if Path(f).exists():
            _mlflow.log_artifact(str(f))


def main() -> None:
    parser = argparse.ArgumentParser(description="TFM canonical PPO training + evaluation")
    parser.add_argument("--timesteps", type=int, default=300_000)
    parser.add_argument("--eval-episodes", type=int, default=1000)
    parser.add_argument("--no-domain-randomization", action="store_true",
                        help="Diagnostic: train without domain randomization")
    parser.add_argument("--init-from", default=None,
                        help="Warm-start checkpoint (e.g. BC init or previous model)")
    parser.add_argument("--learning-rate", type=float, default=None,
                        help="Override HYPERPARAMS learning rate (fine-tuning)")
    parser.add_argument("--ent-coef", type=float, default=None,
                        help="Override HYPERPARAMS entropy coefficient (fine-tuning)")
    args = parser.parse_args()

    if _mlflow is not None:
        MLRUNS_DIR.mkdir(parents=True, exist_ok=True)
        _mlflow.set_tracking_uri(f"file:{MLRUNS_DIR}")
        _mlflow.set_experiment(MLFLOW_EXPERIMENT)
        run_cm = _mlflow.start_run(run_name=f"ppo-{args.timesteps}")
    else:
        import contextlib
        run_cm = contextlib.nullcontext()
        print("[train_tfm] mlflow not installed — skipping experiment tracking")

    with run_cm:
        train_info = _train(
            args.timesteps,
            domain_randomization=not args.no_domain_randomization,
            init_from=args.init_from,
            learning_rate=args.learning_rate,
            ent_coef=args.ent_coef,
        )
        # Stability threshold 0.20 for the anticipatory formulation: with domain
        # randomization the per-rollout mean return fluctuates with the sampled
        # traffic/demand regime (a FIXED policy already shows coeff_var ≈ 0.15
        # across rollouts), so the phase-1 threshold of 0.10 would measure DR
        # noise, not training instability. Improvement ≥ 0 is still required.
        convergence = evaluate_convergence(str(ARTIFACTS), window=20, stability_ratio=0.20)
        print(f"[train_tfm] Convergence: mean_reward={convergence['mean_reward']:.2f} "
              f"coeff_var={convergence['coeff_var']:.3f} converged={convergence['is_converged']}")
        benchmark = _benchmark(args.eval_episodes)
        fidelity = _fidelity()
        _build_drift_baseline()

        summary = {
            "training": train_info,
            "convergence": convergence,
            "benchmark": benchmark,
            "fidelity": fidelity,
        }
        SUMMARY_JSON.write_text(json.dumps(summary, indent=2))
        print(f"[train_tfm] Wrote summary → {SUMMARY_JSON}")
        _mlflow_log(args, convergence, benchmark, fidelity)
        if _mlflow is not None:
            print(f"[train_tfm] Logged run to MLflow ({MLRUNS_DIR}) — browse with `mlflow ui`")


if __name__ == "__main__":
    main()
