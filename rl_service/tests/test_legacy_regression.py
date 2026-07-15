"""
Legacy-regression suite — protects the TFM phase-1 results.

The memoria reports the myopic-formulation benchmark (greedy 295.49,
PPO 182.68, random 151.34 at N=1000, seed 42). CruiseDispatchEnv keeps that
formulation reachable via ``anticipatory=False``; these tests pin the exact
episode dynamics with the phase-1 policy conventions (action = index into the
available-driver list) so refactors of the anticipatory mode can never
silently change the published numbers.

Reference means below are the N=200 prefix of the same seed sequence
(42..241), recomputed once from the canonical N=1000 run.
"""

from __future__ import annotations

import random
import statistics

import numpy as np
import pytest

from rl_service.gym_env import CruiseDispatchEnv, MAX_DRIVERS, OBS_PER_DRIVER

N_EPISODES = 200
SEED = 42

GREEDY_MEAN_200 = 297.7306338500108
RANDOM_MEAN_200 = 151.6140519456821
RL_MEAN_200 = 184.54820619032978


def _greedy_legacy(obs: np.ndarray) -> int:
    available_etas = []
    for i in range(MAX_DRIVERS):
        base = i * OBS_PER_DRIVER
        if obs[base + 4] > 0.5:
            available_etas.append(float(obs[base + 3]))
    if not available_etas:
        return 0
    return int(min(range(len(available_etas)), key=lambda j: available_etas[j]))


def _random_legacy(obs: np.ndarray) -> int:  # noqa: ARG001
    return random.randint(0, MAX_DRIVERS - 1)


def _run_legacy(policy, n_episodes: int = N_EPISODES, seed: int = SEED) -> float:
    """Byte-for-byte replica of the phase-1 benchmark episode runner."""
    random.seed(seed)
    rewards = []
    env = CruiseDispatchEnv(
        n_drivers=8, n_requests=12, max_steps=20, anticipatory=False
    )
    for ep in range(n_episodes):
        obs, _ = env.reset(seed=seed + ep)
        done = truncated = False
        ep_reward = 0.0
        while not (done or truncated):
            obs, reward, done, truncated, _info = env.step(policy(obs))
            ep_reward += reward
        rewards.append(ep_reward)
    return statistics.mean(rewards)


def test_legacy_greedy_reproduces_phase1() -> None:
    assert _run_legacy(_greedy_legacy) == pytest.approx(GREEDY_MEAN_200, abs=1e-6)


def test_legacy_random_reproduces_phase1() -> None:
    assert _run_legacy(_random_legacy) == pytest.approx(RANDOM_MEAN_200, abs=1e-6)


def test_legacy_ppo_checkpoint_reproduces_phase1() -> None:
    sb3 = pytest.importorskip("stable_baselines3")
    from rl_service.registry import REGISTRY_DIR

    checkpoint = REGISTRY_DIR / "ppo-v2-canonical" / "model.zip"
    if not checkpoint.exists():
        pytest.skip("phase-1 checkpoint not present in registry")
    model = sb3.PPO.load(str(checkpoint).removesuffix(".zip"))

    def _rl_legacy(obs: np.ndarray) -> int:
        action, _ = model.predict(obs, deterministic=True)
        available = sum(
            1 for i in range(MAX_DRIVERS) if obs[i * OBS_PER_DRIVER + 4] > 0.5
        )
        if available <= 0:
            return 0
        return int(min(int(action), available - 1))

    assert _run_legacy(_rl_legacy) == pytest.approx(RL_MEAN_200, abs=1e-6)
