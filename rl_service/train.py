"""
Standalone training CLI — runs outside FastAPI for long offline training runs.

Usage:
  python -m rl_service.train --timesteps 500000
  python -m rl_service.train --timesteps 1000000 --eval-freq 50000
"""

from __future__ import annotations

import argparse
import sys

from stable_baselines3.common.callbacks import EvalCallback
from stable_baselines3.common.env_util import make_vec_env

from .agent import RLAgent, MODEL_PATH
from .gym_env import CruiseDispatchEnv


def main() -> None:
    parser = argparse.ArgumentParser(description="CruiseDispatch PPO offline trainer")
    parser.add_argument("--timesteps", type=int, default=200_000,
                        help="Total environment steps to train (default: 200,000)")
    parser.add_argument("--eval-freq", type=int, default=10_000,
                        help="Evaluate every N timesteps (default: 10,000)")
    parser.add_argument("--n-eval-envs", type=int, default=5,
                        help="Parallel envs for evaluation (default: 5)")
    args = parser.parse_args()

    print(f"[train] Timesteps={args.timesteps:,} | EvalFreq={args.eval_freq:,}")

    agent = RLAgent()

    eval_env = make_vec_env(
        lambda: CruiseDispatchEnv(n_drivers=8, n_requests=12, max_steps=20),
        n_envs=args.n_eval_envs,
    )
    eval_callback = EvalCallback(
        eval_env,
        best_model_save_path=str(MODEL_PATH.parent / "best"),
        log_path=str(MODEL_PATH.parent / "logs"),
        eval_freq=max(args.eval_freq // 4, 1000),   # per-env frequency
        n_eval_episodes=20,
        deterministic=True,
        verbose=1,
    )

    agent.model.set_env(make_vec_env(
        lambda: CruiseDispatchEnv(n_drivers=8, n_requests=12, max_steps=20),
        n_envs=4,
    ))
    agent.model.learn(
        total_timesteps=args.timesteps,
        callback=eval_callback,
        reset_num_timesteps=False,
        progress_bar=True,
    )
    agent.model.save(str(MODEL_PATH))
    print(f"[train] Model saved → {MODEL_PATH}.zip")


if __name__ == "__main__":
    main()
