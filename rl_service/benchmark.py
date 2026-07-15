"""
benchmark.py — baseline comparison for the dispatch policies (TFM phase 2).

Compares the PPO agent against four baselines on the anticipatory
CruiseDispatchEnv (paired seeds — every policy replays the exact same
episode setups):

  greedy     nearest-ETA myopic dispatch (idealised oracle baseline)
  random     uniform choice among FREE drivers
  cascade    proxy of the production heuristic (GeoDispatchService):
             3→5→7 km radius cascade, nearest inside the first non-empty ring
  patient    hand-crafted anticipatory heuristic: greedy dispatch EXCEPT when
             the best free driver is far and a busy one frees up soon — then
             hold for the release. Proves the anticipation ceiling exists
             BEFORE any RL training (greedy cannot express the hold decision)
  rl_ppo     PPO policy, argmax of action probabilities over free drivers
             (faithful to serving: the backend takes the best available)

An alternative anticipatory heuristic (``coverage_policy``: cluster-coverage
and fast-driver preservation) was evaluated and does NOT beat greedy — under
deadline pressure, deviating from min-ETA dispatch costs more fleet capacity
than the preserved coverage returns. Kept for reference/ablation.

Legacy (phase 1, myopic env) variants are kept as ``*_legacy`` so the
published phase-1 numbers stay reproducible (see test_legacy_regression.py).

Metrics reported
────────────────
  mean_reward         Mean cumulative episode reward
  p95_reward          95th-percentile episode reward
  mean_queue_left     Requests still unserved at episode end (pending+future)
  mean_urgency_loss   Mean dynamic urgency of unserved requests
  mean_expired        Requests that missed their all-aboard deadline
  mean_utilization    Fleet busy-time share
  mean_inference_ms   Wall-clock ms per policy query

Usage
─────
  python -m rl_service.benchmark            # quick run (N=200)
  python -m rl_service.benchmark 1000      # full validation run
  python -m rl_service.benchmark 200 --legacy   # phase-1 formulation
"""

from __future__ import annotations

import importlib.util
import math
import pathlib
import random
import statistics
import sys
import time
from dataclasses import dataclass, field
from typing import Callable, Optional

import numpy as np

from .gym_env import (
    CruiseDispatchEnv,
    CLUSTER_CENTROIDS,
    LAT_MIN, LAT_MAX, LON_MIN, LON_MAX,
    MAX_CLUSTERS,
    MAX_DRIVERS,
    MAX_ETA_S,
    OBS_PER_CLUSTER,
    OBS_PER_DRIVER,
)
from .agent import HYPERPARAMS, MODEL_PATH

BENCHMARK_MODEL_PATH = MODEL_PATH.with_name(f"{MODEL_PATH.name}_benchmark_v3")

# Bounding-box spans in metres (for recovering distances from normalised obs).
_LAT_SPAN_M = (LAT_MAX - LAT_MIN) * 111_320.0
_LON_SPAN_M = (LON_MAX - LON_MIN) * 111_320.0 * math.cos(math.radians((LAT_MIN + LAT_MAX) / 2))

_CLUSTER_OFFSET = MAX_DRIVERS * OBS_PER_DRIVER

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
    mean_assign_eta: float = 0.0        # mean normalised ETA of chosen assignments
    mean_expired: float = 0.0           # requests that missed their deadline
    mean_utilization: float = 0.0       # fleet busy-time share
    all_rewards: list[float] = field(default_factory=list)

    @property
    def mean_assign_seconds(self) -> float:
        """Assignment-time proxy in seconds (eta_norm × MAX_ETA_S ceiling)."""
        return self.mean_assign_eta * 900.0

    def summary(self) -> str:
        return (
            f"[{self.policy_name:12s}] "
            f"reward mean={self.mean_reward:8.2f}  p95={self.p95_reward:8.2f}  "
            f"assign_eta_s={self.mean_assign_seconds:6.1f}  "
            f"queue_left={self.mean_queue_left:.2f}  "
            f"expired={self.mean_expired:.2f}  "
            f"urgency_loss={self.mean_urgency_loss:.3f}  "
            f"util={self.mean_utilization:.2f}  "
            f"step_ms={self.mean_inference_ms:.2f}"
        )


# ─── Observation helpers ──────────────────────────────────────────────────────

def _free_slots(obs: np.ndarray) -> list[int]:
    return [
        i for i in range(MAX_DRIVERS)
        if obs[i * OBS_PER_DRIVER + 4] > 0.5
    ]


def _driver_dist_m(obs: np.ndarray, slot: int) -> float:
    """Recover driver→target distance from eta_norm (exact with DR off)."""
    base = slot * OBS_PER_DRIVER
    speed_mps = max(float(obs[base + 2]) * 30.0, 2.0)
    return float(obs[base + 3]) * MAX_ETA_S * speed_mps


def _cluster_eta_norm(obs: np.ndarray, slot: int, cluster: int) -> float:
    """Approximate normalised ETA from a driver slot to a cluster centroid."""
    dbase = slot * OBS_PER_DRIVER
    cbase = _CLUSTER_OFFSET + cluster * OBS_PER_CLUSTER
    dlat = (float(obs[dbase + 0]) - float(obs[cbase + 0])) * _LAT_SPAN_M
    dlon = (float(obs[dbase + 1]) - float(obs[cbase + 1])) * _LON_SPAN_M
    dist_m = math.hypot(dlat, dlon)
    speed_mps = max(float(obs[dbase + 2]) * 30.0, 2.0)
    return min(1.0, dist_m / speed_mps / MAX_ETA_S)


# ─── Baseline policies (anticipatory, slot convention) ───────────────────────

def greedy_policy(obs: np.ndarray) -> int:
    """Myopic nearest-ETA dispatch: free driver slot with the lowest eta_norm."""
    free = _free_slots(obs)
    if not free:
        return 0
    return int(min(free, key=lambda i: float(obs[i * OBS_PER_DRIVER + 3])))


def random_policy(obs: np.ndarray) -> int:
    """Uniform choice among free drivers (a blind 0–9 pick would only measure
    invalid-action penalties under resource contention, not dispatch quality)."""
    free = _free_slots(obs)
    if not free:
        return 0
    return int(random.choice(free))


def cascade_policy(obs: np.ndarray) -> int:
    """
    Proxy of the production GeoDispatchService heuristic: broadcast in radius
    rings of 3 → 5 → 7 km and take the nearest driver inside the first ring
    with candidates (stand-in for the first driver to accept); fall back to
    the global nearest when every ring is empty.
    """
    free = _free_slots(obs)
    if not free:
        return 0
    dists = {i: _driver_dist_m(obs, i) for i in free}
    for radius_m in (3_000.0, 5_000.0, 7_000.0):
        ring = [i for i in free if dists[i] <= radius_m]
        if ring:
            return int(min(ring, key=lambda i: dists[i]))
    return int(min(free, key=lambda i: dists[i]))


def coverage_policy(
    obs: np.ndarray, kappa: float = 1.0, speed_kappa: float = 0.5
) -> int:
    """
    Hand-crafted anticipatory heuristic (ceiling proof for the RL agent).
    Nearest-ETA penalised by two opportunity costs of spending a driver:
      • cluster-coverage loss — for every demand cluster where the driver is
        the best free option, losing them raises the cluster's best response
        time to the second-best free driver;
      • speed preservation — fast drivers are the only ones able to meet
        tight all-aboard deadlines across town, so spending them on routine
        work while wave demand is incoming is penalised proportionally.
    """
    free = _free_slots(obs)
    if not free:
        return 0
    if len(free) == 1:
        return free[0]

    counts = [
        float(obs[_CLUSTER_OFFSET + c * OBS_PER_CLUSTER + 2])
        for c in range(MAX_CLUSTERS)
    ]
    incoming = sum(counts)
    cluster_etas = {
        c: {j: _cluster_eta_norm(obs, j, c) for j in free}
        for c in range(MAX_CLUSTERS)
        if counts[c] > 0.0
    }

    def cost(j: int) -> float:
        eta_j = float(obs[j * OBS_PER_DRIVER + 3])
        loss = 0.0
        for c, etas in cluster_etas.items():
            best = min(free, key=lambda i: etas[i])
            if best != j:
                continue
            others = [etas[i] for i in free if i != j]
            second = min(others) if others else 1.0
            loss += counts[c] * max(0.0, second - etas[j])
        speed_j = float(obs[j * OBS_PER_DRIVER + 2])
        return eta_j + kappa * loss + speed_kappa * incoming * speed_j

    return int(min(free, key=cost))


def patient_policy(
    obs: np.ndarray,
    eta_thresh_s: float = 300.0,
    wait_thresh_s: float = 180.0,
) -> int:
    """
    Anticipatory hold heuristic (ceiling proof for the RL agent): dispatch
    greedy, EXCEPT when the best free driver is far (> eta_thresh_s) and a
    busy driver frees up soon (< wait_thresh_s) — then hold for that driver
    instead of burning a long trip. Released drivers sit at demand hotspots
    (their last delivery), so a short wait usually beats a distant dispatch.
    Myopic baselines cannot express this decision.
    """
    free = _free_slots(obs)
    if not free:
        return 0
    best_free = min(free, key=lambda i: float(obs[i * OBS_PER_DRIVER + 3]))
    best_free_eta_s = float(obs[best_free * OBS_PER_DRIVER + 3]) * MAX_ETA_S

    if best_free_eta_s > eta_thresh_s:
        busy = [i for i in range(MAX_DRIVERS) if i not in free
                and obs[i * OBS_PER_DRIVER + 0] > 0.0]
        soon = [
            i for i in busy
            if float(obs[i * OBS_PER_DRIVER + 3]) * MAX_ETA_S < wait_thresh_s
        ]
        if soon:
            return int(min(
                soon, key=lambda i: float(obs[i * OBS_PER_DRIVER + 3])
            ))
    return best_free


# ─── Legacy (phase 1) policy variants — myopic env, available-list convention ─

def greedy_policy_legacy(obs: np.ndarray) -> int:
    """Phase-1 greedy: index into the available-driver list with minimum eta."""
    available_etas: list[float] = []
    for i in range(MAX_DRIVERS):
        base = i * OBS_PER_DRIVER
        if obs[base + 4] > 0.5:
            available_etas.append(float(obs[base + 3]))
    if not available_etas:
        return 0
    return int(min(range(len(available_etas)), key=lambda j: available_etas[j]))


def random_policy_legacy(obs: np.ndarray) -> int:  # noqa: ARG001
    return random.randint(0, MAX_DRIVERS - 1)


def make_rl_policy_legacy(model) -> Callable[[np.ndarray], int]:
    """Phase-1 RL wrapper: clamp the raw action into the available range."""
    def _policy(obs: np.ndarray) -> int:
        action, _ = model.predict(obs, deterministic=True)
        available = sum(
            1
            for i in range(MAX_DRIVERS)
            if obs[i * OBS_PER_DRIVER + 4] > 0.5
        )
        if available <= 0:
            return 0
        return int(min(int(action), available - 1))
    return _policy


# ─── Episode runner ───────────────────────────────────────────────────────────

def run_episodes(
    policy: Callable[[np.ndarray], int],
    n_episodes: int,
    seed: int = 42,
    policy_name: str = "unknown",
    anticipatory: bool = True,
) -> BenchmarkResult:
    """Run `n_episodes` paired-seed episodes with `policy` and collect metrics."""
    random.seed(seed)  # make the random-baseline actions reproducible across runs
    rewards: list[float] = []
    queues: list[float] = []
    urgency_losses: list[float] = []
    expired: list[float] = []
    utilizations: list[float] = []
    inference_times: list[float] = []  # total per episode, divided by steps later
    step_counts: list[int] = []
    assign_etas: list[float] = []

    if anticipatory:
        env = CruiseDispatchEnv(n_drivers=8, anticipatory=True)
    else:
        env = CruiseDispatchEnv(
            n_drivers=8, n_requests=12, max_steps=20, anticipatory=False
        )

    for ep in range(n_episodes):
        obs, _info = env.reset(seed=seed + ep)
        done = truncated = False
        ep_reward = 0.0
        ep_steps = 0
        ep_inference_ns = 0.0
        info: dict = {}

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
        expired.append(float(info.get("expired", 0)))
        utilizations.append(float(info.get("utilization", 0.0)))
        assign_etas.extend(env._assigned_etas)
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
        mean_assign_eta=statistics.mean(assign_etas) if assign_etas else 0.0,
        mean_expired=statistics.mean(expired),
        mean_utilization=statistics.mean(utilizations),
        all_rewards=rewards,
    )


def _mean_pending_urgency(env: CruiseDispatchEnv) -> float:
    """Average urgency of requests still pending at episode end (0 if none)."""
    pending = getattr(env, "_pending", [])
    if not pending:
        return 0.0
    if env.anticipatory:
        clock = getattr(env, "_clock_s", 0.0)
        return sum(r.urgency_at(clock) for r in pending) / len(pending)
    return sum(r.urgency for r in pending) / len(pending)


# ─── Paired statistics ────────────────────────────────────────────────────────

def paired_delta_ci95(
    rewards_a: list[float],
    rewards_b: list[float],
    n_boot: int = 10_000,
    seed: int = 123,
) -> dict[str, float]:
    """
    Bootstrap CI of the paired per-seed reward delta (a − b). Both lists must
    come from run_episodes with the same seed so episode i is the same setup.
    """
    a = np.asarray(rewards_a, dtype=np.float64)
    b = np.asarray(rewards_b, dtype=np.float64)
    n = min(len(a), len(b))
    deltas = a[:n] - b[:n]
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, n, size=(n_boot, n))
    boot_means = deltas[idx].mean(axis=1)
    return {
        "mean_delta": float(deltas.mean()),
        "ci95_low": float(np.percentile(boot_means, 2.5)),
        "ci95_high": float(np.percentile(boot_means, 97.5)),
    }


# ─── RL policy wrapper (requires stable_baselines3) ──────────────────────────

def _existing_slots(obs: np.ndarray) -> list[int]:
    """Slots holding a real driver (free or busy). Empty padding slots encode
    speed_norm=0; every generated driver has speed ≥ 3 m/s (speed_norm ≥ 0.1)."""
    return [
        i for i in range(MAX_DRIVERS)
        if obs[i * OBS_PER_DRIVER + 2] > 0.01
    ]


def make_rl_policy(model) -> Callable[[np.ndarray], int]:
    """
    Wrap a loaded SB3 PPO model as a callable policy: argmax of the action
    probabilities over slots holding a REAL driver. Picking a busy driver is a
    legitimate HOLD decision (wait for that driver instead of dispatching a
    distant free one) — the anticipatory capability the agent trains with. Only
    empty padding slots are masked out. In serving terms a hold surfaces as the
    ranking placing a soon-to-free driver above every free one, upon which the
    dispatch layer keeps the request queued for the next cascade tick.
    """
    import torch

    def _policy(obs: np.ndarray) -> int:
        with torch.no_grad():
            obs_t = torch.as_tensor(
                obs[np.newaxis, :].astype(np.float32), device=model.device
            )
            features = model.policy.extract_features(obs_t)
            latent_pi, _ = model.policy.mlp_extractor(features)
            logits = model.policy.action_net(latent_pi)
            probs = torch.softmax(logits, dim=-1).cpu().numpy()[0]
        candidates = _existing_slots(obs)
        if not candidates:
            return 0
        return int(max(candidates, key=lambda i: float(probs[i])))

    return _policy


def load_or_train_benchmark_model(total_timesteps: int = 300_000):
    """
    Load a benchmark-specific PPO checkpoint or train one on demand.

    The generic service checkpoint may come from a different env version or a
    short smoke-training run; the benchmark needs a canonical model trained on
    the current benchmark environment.
    """
    from stable_baselines3 import PPO
    from stable_baselines3.common.env_util import make_vec_env

    model_zip = pathlib.Path(f"{BENCHMARK_MODEL_PATH}.zip")
    if model_zip.exists():
        return PPO.load(str(BENCHMARK_MODEL_PATH))

    vec_env = make_vec_env(
        lambda: CruiseDispatchEnv(
            n_drivers=8, domain_randomization=True, anticipatory=True
        ),
        n_envs=8,
    )
    hp = {k: v for k, v in HYPERPARAMS.items() if k not in ("policy", "net_arch")}
    model = PPO(
        HYPERPARAMS["policy"],
        vec_env,
        verbose=0,
        policy_kwargs={"net_arch": HYPERPARAMS["net_arch"]},
        **hp,
    )
    model.learn(total_timesteps=total_timesteps, progress_bar=False)
    BENCHMARK_MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    model.save(str(BENCHMARK_MODEL_PATH))
    return model


# ─── Main entry point ─────────────────────────────────────────────────────────

def run_benchmark(
    n_episodes: int = 200,
    seed: int = 42,
    anticipatory: bool = True,
    model=None,
) -> dict[str, BenchmarkResult]:
    """
    Run every baseline and (if SB3 available) the RL policy over paired-seed
    episodes. Returns a dict keyed by policy name.
    """
    results: dict[str, BenchmarkResult] = {}
    mode = "anticipatory" if anticipatory else "legacy (phase 1)"

    print(f"\n=== CruiseDispatch Benchmark  N={n_episodes}  seed={seed}  mode={mode} ===\n")

    if anticipatory:
        baselines = [
            ("greedy", greedy_policy),
            ("random", random_policy),
            ("cascade", cascade_policy),
            ("patient", patient_policy),
        ]
    else:
        baselines = [
            ("greedy", greedy_policy_legacy),
            ("random", random_policy_legacy),
        ]

    for name, policy in baselines:
        res = run_episodes(
            policy, n_episodes, seed=seed, policy_name=name, anticipatory=anticipatory
        )
        results[name] = res
        print(res.summary())

    # RL policy (skip gracefully if SB3/torch not installed)
    has_sb3 = importlib.util.find_spec("stable_baselines3") is not None
    if has_sb3:
        try:
            if model is None:
                model = load_or_train_benchmark_model()
            wrapper = make_rl_policy(model) if anticipatory else make_rl_policy_legacy(model)
            rl = run_episodes(
                wrapper, n_episodes, seed=seed, policy_name="rl_ppo",
                anticipatory=anticipatory,
            )
            results["rl_ppo"] = rl
            print(rl.summary())

            greedy = results["greedy"]
            ci = paired_delta_ci95(rl.all_rewards, greedy.all_rewards)
            print(
                f"\nΔ(rl_ppo − greedy) = {ci['mean_delta']:+.2f} "
                f"[IC95: {ci['ci95_low']:+.2f}, {ci['ci95_high']:+.2f}] "
                f"({rl.mean_reward / greedy.mean_reward - 1.0:+.1%} mean reward)"
            )
        except Exception as exc:
            print(f"[benchmark] RL policy error (non-fatal): {exc}")
    else:
        print("[benchmark] stable_baselines3 not installed — skipping RL policy")

    print()
    return results


if __name__ == "__main__":
    args = [a for a in sys.argv[1:]]
    legacy = "--legacy" in args
    nums = [a for a in args if not a.startswith("--")]
    n = int(nums[0]) if nums else 200
    run_benchmark(n_episodes=n, anticipatory=not legacy)
