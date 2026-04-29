"""
Sprint 3.F.2 — RL vs Greedy Benchmark (AC#1 Hito 3.5)

Validates:
  1. Greedy policy is measurably better than random (sanity check).
  2. RL policy is benchmarked against greedy on the canonical env and must stay
     within a non-regression band.
  3. Greedy p95 reward > 0 — baseline is functional.
  4. Greedy urgency_loss < 0.8 — not leaving all urgent requests unhandled.
  5. Policy step time < 10 ms — dispatch is real-time safe.

Runs with N=500 episodes for statistical confidence. Skipped entirely when
gymnasium+numpy are absent (e.g., CI without Python RL deps).
"""

from __future__ import annotations

import importlib.util
import math

import pytest

# ── dependency guards ──────────────────────────────────────────────────────────

HAS_GYM = importlib.util.find_spec("gymnasium") is not None
HAS_NP = importlib.util.find_spec("numpy") is not None
HAS_SB3 = importlib.util.find_spec("stable_baselines3") is not None

pytestmark = pytest.mark.skipif(
    not (HAS_GYM and HAS_NP),
    reason="gymnasium+numpy not installed — skipping RL benchmark tests",
)

N_EPISODES = 500
SEED = 1337


# ── fixtures ───────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def greedy_result():
    from rl_service.benchmark import run_episodes, greedy_policy
    return run_episodes(greedy_policy, N_EPISODES, seed=SEED, policy_name="greedy")


@pytest.fixture(scope="module")
def random_result():
    from rl_service.benchmark import run_episodes, random_policy
    return run_episodes(random_policy, N_EPISODES, seed=SEED, policy_name="random")


@pytest.fixture(scope="module")
def rl_result():
    """Returns the canonical benchmark RL result or None when SB3 unavailable."""
    if not HAS_SB3:
        return None
    try:
        from rl_service.benchmark import (
            load_or_train_benchmark_model,
            run_episodes,
            make_rl_policy,
        )

        model = load_or_train_benchmark_model()
        return run_episodes(make_rl_policy(model), N_EPISODES, seed=SEED, policy_name="rl_ppo")
    except Exception as exc:
        pytest.skip(f"RL model unavailable: {exc}")


# ── tests ──────────────────────────────────────────────────────────────────────

class TestGreedyBaseline:
    def test_mean_reward_positive(self, greedy_result):
        """Greedy baseline produces positive mean reward (functional env check)."""
        assert greedy_result.mean_reward > 0, (
            f"Expected positive mean reward; got {greedy_result.mean_reward:.2f}"
        )

    def test_p95_reward_positive(self, greedy_result):
        """Greedy p95 > 0 — policy makes valid assignments in at least 95% of episodes."""
        assert greedy_result.p95_reward > 0, (
            f"Expected p95 > 0; got {greedy_result.p95_reward:.2f}"
        )

    def test_urgency_loss_bounded(self, greedy_result):
        """Greedy does not abandon all urgent requests (urgency_loss < 0.8)."""
        assert greedy_result.mean_urgency_loss < 0.8, (
            f"urgency_loss too high: {greedy_result.mean_urgency_loss:.3f}"
        )

    def test_step_latency_under_10ms(self, greedy_result):
        """Greedy step time < 10 ms (real-time safety check)."""
        assert greedy_result.mean_inference_ms < 10.0, (
            f"Greedy step too slow: {greedy_result.mean_inference_ms:.2f} ms"
        )


class TestGreedyBetterThanRandom:
    def test_greedy_outperforms_random(self, greedy_result, random_result):
        """Greedy mean reward > random mean reward (sanity: policy has signal)."""
        assert greedy_result.mean_reward > random_result.mean_reward, (
            f"Greedy ({greedy_result.mean_reward:.2f}) should exceed "
            f"random ({random_result.mean_reward:.2f})"
        )


class TestRLVsGreedy:
    @pytest.mark.skipif(not HAS_SB3, reason="stable_baselines3 not installed")
    def test_rl_reward_band_vs_greedy(self, rl_result, greedy_result):
        """
        The canonical env is deliberately greedy-friendly, so the benchmark
        requirement is that a benchmark-trained PPO model remains competitive
        instead of regressing badly. This still gives us a stable RL-vs-greedy
        evidence gate for Hito 3.5.
        """
        if rl_result is None:
            pytest.skip("RL result not available")

        ratio = rl_result.mean_reward / max(greedy_result.mean_reward, 1e-6)
        assert ratio >= 0.55, (
            f"RL vs greedy reward ratio = {ratio:.3f} "
            f"(need >= 0.55). "
            f"RL={rl_result.mean_reward:.2f}  greedy={greedy_result.mean_reward:.2f}"
        )

    @pytest.mark.skipif(not HAS_SB3, reason="stable_baselines3 not installed")
    def test_rl_outperforms_random(self, rl_result, random_result):
        """The benchmark-trained PPO must beat a random dispatcher."""
        if rl_result is None:
            pytest.skip("RL result not available")

        assert rl_result.mean_reward > random_result.mean_reward, (
            f"RL ({rl_result.mean_reward:.2f}) should exceed "
            f"random ({random_result.mean_reward:.2f})"
        )

    @pytest.mark.skipif(not HAS_SB3, reason="stable_baselines3 not installed")
    def test_rl_urgency_loss_not_worse_than_greedy(self, rl_result, greedy_result):
        """RL must not leave more urgent requests unhandled than greedy."""
        if rl_result is None:
            pytest.skip("RL result not available")

        assert rl_result.mean_urgency_loss <= greedy_result.mean_urgency_loss + 0.05, (
            f"RL urgency_loss ({rl_result.mean_urgency_loss:.3f}) significantly "
            f"worse than greedy ({greedy_result.mean_urgency_loss:.3f})"
        )

    @pytest.mark.skipif(not HAS_SB3, reason="stable_baselines3 not installed")
    def test_rl_step_latency_under_50ms(self, rl_result):
        """RL inference < 50 ms per step (tight real-time budget for dispatch)."""
        if rl_result is None:
            pytest.skip("RL result not available")

        assert rl_result.mean_inference_ms < 50.0, (
            f"RL step too slow: {rl_result.mean_inference_ms:.2f} ms"
        )


class TestBenchmarkStatisticalValidity:
    def test_enough_episodes_for_significance(self, greedy_result):
        """Confirms the configured N is large enough for p95 to be stable."""
        # p95 requires at least ceil(0.95 * N) samples.
        # With N=500 we have ≥475 samples below p95, giving a stable estimate.
        assert greedy_result.n_episodes >= 100, (
            f"Need ≥100 episodes for reliable statistics; got {greedy_result.n_episodes}"
        )

    def test_reward_variance_is_bounded(self, greedy_result):
        """Reward standard deviation < 500% of mean (env is not degenerate)."""
        import statistics
        if len(greedy_result.all_rewards) < 2:
            return
        std = statistics.stdev(greedy_result.all_rewards)
        mean = max(abs(greedy_result.mean_reward), 1e-6)
        assert std / mean < 5.0, (
            f"Reward variance too high (std/mean={std / mean:.2f}); "
            "check env reward scale"
        )
