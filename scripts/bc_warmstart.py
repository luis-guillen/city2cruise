#!/usr/bin/env python3
"""
bc_warmstart.py — behaviour-cloning warm start for the PPO dispatch agent.

Bootstraps the PPO policy by imitating the hand-crafted anticipatory heuristic
(``benchmark.patient_policy``: greedy dispatch + capped holds for soon-to-free
drivers), then the canonical pipeline fine-tunes it with reinforcement learning:

  python scripts/bc_warmstart.py                       # → artifacts/bc_init.zip
  python -m rl_service.train_tfm --init-from rl_service/artifacts/bc_init \\
         --timesteps 600000 --learning-rate 1e-4 --ent-coef 0.003

Rationale (thesis §4.2, phase 2): pure PPO exploration converges slowly toward
the hold behaviour that beats myopic dispatch; cloning the heuristic first puts
the policy in the right basin and lets RL improve past it (imitation → RL,
standard practice in the dispatch literature).

The demonstration episodes use TRAINING conditions (domain randomization ON)
and seeds disjoint from the evaluation range (42..1041), so no eval leakage.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from stable_baselines3 import PPO                       # noqa: E402
from stable_baselines3.common.env_util import make_vec_env  # noqa: E402
import torch                                            # noqa: E402

from rl_service.agent import HYPERPARAMS               # noqa: E402
from rl_service.gym_env import CruiseDispatchEnv       # noqa: E402
from rl_service.benchmark import patient_policy        # noqa: E402

DEMO_SEED_BASE = 100_000  # disjoint from the eval seed range 42..1041


def collect_demonstrations(n_episodes: int) -> tuple[np.ndarray, np.ndarray]:
    env = CruiseDispatchEnv(n_drivers=8, domain_randomization=True, anticipatory=True)
    obs_buf: list[np.ndarray] = []
    act_buf: list[int] = []
    for ep in range(n_episodes):
        obs, _ = env.reset(seed=DEMO_SEED_BASE + ep)
        done = trunc = False
        while not (done or trunc):
            action = patient_policy(obs)
            obs_buf.append(obs.copy())
            act_buf.append(action)
            obs, _r, done, trunc, _i = env.step(action)
    return np.asarray(obs_buf, dtype=np.float32), np.asarray(act_buf, dtype=np.int64)


def behaviour_clone(model: PPO, obs: np.ndarray, acts: np.ndarray,
                    epochs: int, batch_size: int, lr: float) -> None:
    policy = model.policy
    policy.set_training_mode(True)
    optimizer = torch.optim.Adam(policy.parameters(), lr=lr)
    n = len(obs)
    obs_t = torch.as_tensor(obs, device=model.device)
    act_t = torch.as_tensor(acts, device=model.device)

    for epoch in range(epochs):
        perm = torch.randperm(n)
        total, correct, loss_sum = 0, 0, 0.0
        for start in range(0, n, batch_size):
            idx = perm[start:start + batch_size]
            dist = policy.get_distribution(obs_t[idx])
            log_prob = dist.log_prob(act_t[idx])
            loss = -log_prob.mean()
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()

            with torch.no_grad():
                pred = dist.distribution.probs.argmax(dim=-1)
                correct += int((pred == act_t[idx]).sum())
                total += len(idx)
                loss_sum += float(loss) * len(idx)
        print(f"[bc] epoch {epoch + 1}/{epochs}  loss={loss_sum / total:.4f}  "
              f"accuracy={correct / total:.1%}")
    policy.set_training_mode(False)


def main() -> None:
    ap = argparse.ArgumentParser(description="BC warm start from the patient heuristic")
    ap.add_argument("--episodes", type=int, default=3000)
    ap.add_argument("--epochs", type=int, default=5)
    ap.add_argument("--batch-size", type=int, default=1024)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--out", default=str(ROOT / "rl_service" / "artifacts" / "bc_init"))
    args = ap.parse_args()

    torch.manual_seed(42)
    np.random.seed(42)

    print(f"[bc] collecting demonstrations from patient_policy "
          f"({args.episodes} episodes, DR on, seeds {DEMO_SEED_BASE}+)…")
    obs, acts = collect_demonstrations(args.episodes)
    holds = (obs[np.arange(len(acts)), acts * 5 + 4] < 0.5).mean()
    print(f"[bc] dataset: {len(obs):,} decisions  (hold share {holds:.1%})")

    vec_env = make_vec_env(
        lambda: CruiseDispatchEnv(n_drivers=8, domain_randomization=True, anticipatory=True),
        n_envs=8,
    )
    hp = {k: v for k, v in HYPERPARAMS.items() if k not in ("policy", "net_arch")}
    model = PPO(
        HYPERPARAMS["policy"], vec_env, verbose=0, seed=42,
        policy_kwargs={"net_arch": HYPERPARAMS["net_arch"]}, **hp,
    )
    behaviour_clone(model, obs, acts, args.epochs, args.batch_size, args.lr)

    model.save(args.out)
    print(f"[bc] saved warm-start checkpoint → {args.out}.zip")


if __name__ == "__main__":
    main()
