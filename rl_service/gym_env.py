"""
CruiseDispatchEnv — Gymnasium environment for the driver-dispatch RL problem.

Problem framing (two formulations, TFM phases)
──────────────────────────────────────────────
Phase 1 — myopic (``anticipatory=False``): every request exists from reset,
drivers are never busy, and each step assigns the most-urgent pending request.
In this formulation the reward is maximised per-step by picking the closest
driver, so the greedy nearest-ETA heuristic is optimal by construction. Kept
verbatim so the phase-1 results remain reproducible.

Phase 2 — anticipatory (``anticipatory=True``, default): an event-driven
semi-MDP over a 2-hour horizon. Requests arrive over time in cruise-ship
waves plus a Poisson background, assigned drivers stay busy for travel +
service time (resource contention), and pending requests accrue waiting costs
and can expire against their all-aboard deadline. Myopic dispatch is no
longer optimal: spending the wrong driver right before a demand wave starves
coverage when the urgent burst lands.

Observation  Box(shape=(OBS_DIM=69,), float32, clipped to [0,1])  — layout
             identical in both modes (serving contract unchanged).
Action       Discrete(MAX_DRIVERS=10) — driver slot index. In anticipatory
             mode picking an empty or busy slot is invalid (-10 and a 30 s
             tick); in legacy mode the action indexes the available-driver
             list (equivalent, since every driver is always available).
Reward       assignment = (0.5 × urgency + 0.5 × (1 - eta_norm)) × 100
                          (+30 urgent-and-fast bonus)   — both modes
             anticipatory extras: waiting cost (1 + 3·urgency)/min per
             pending request, −150 per expired/unserved request.

Normalisation bounds match the Las Palmas service area configured in env.ts
SERVICE_AREA_VIEWBOX = "-15.55,27.99,-15.35,28.22"
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional

import numpy as np
import gymnasium as gym
from gymnasium import spaces

# ─── Constants ────────────────────────────────────────────────────────────────

MAX_DRIVERS = 10
MAX_CLUSTERS = 5
MAX_ETA_S = 900          # 15 min — normalisation ceiling for ETA
MAX_ACTIVE_REQUESTS = 50

OBS_PER_DRIVER = 5       # [lat_norm, lon_norm, speed_norm, eta_norm, available]
OBS_PER_CLUSTER = 3      # [lat_norm, lon_norm, count_norm]
OBS_GLOBAL = 4           # [locker_occ, max_urgency, active_req_norm, time_of_day]
OBS_DIM = MAX_DRIVERS * OBS_PER_DRIVER + MAX_CLUSTERS * OBS_PER_CLUSTER + OBS_GLOBAL
# = 50 + 15 + 4 = 69

# Service-area bounds (Las Palmas)
LAT_MIN, LAT_MAX = 27.99, 28.22
LON_MIN, LON_MAX = -15.55, -15.35

# ─── Anticipatory-mode constants ──────────────────────────────────────────────

HORIZON_S = 7200.0             # 2 h of simulated operations per episode
HARD_HORIZON_S = HORIZON_S + 1800.0
URGENCY_WINDOW_S = 2700.0      # urgency ramps 0→1 over the last 45 min to deadline
SERVICE_RANGE_S = (240.0, 480.0)   # drive luggage to locker + deposit (4–8 min)
WAIT_BASE = 1.0                # waiting cost: points per request-minute
WAIT_URG = 3.0                 # extra waiting cost weight on urgency
EXPIRY_PENALTY = 150.0         # missed all-aboard deadline / unserved at truncation
INVALID_TICK_S = 30.0          # simulated delay charged to an invalid action
HOLD_CAP_S = 90.0              # max clock advance per hold decision (re-evaluate)
FUTURE_DEMAND_WINDOW_S = 1800.0  # known cruise agenda lookahead for cluster counts
WAVE_TIME_RANGE_S = (900.0, 6300.0)
WAVE_MIN_SEPARATION_S = 1800.0
WAVE_SIGMA_S = 240.0
WAVE_DEADLINE_RANGE_S = (900.0, 1500.0)    # all-aboard 15–25 min after arrival
BG_DEADLINE_RANGE_S = (2700.0, 5400.0)
BG_MEAN_REQUESTS = 8.0
CLUSTER_NEAR_M = 1000.0        # pending requests within 1 km count toward a cluster

# Fixed demand zones (Las Palmas): port first — cruise waves concentrate there.
CLUSTER_CENTROIDS: list[tuple[float, float]] = [
    (28.1454, -15.4269),   # Puerto / Muelle Santa Catalina
    (28.1067, -15.4136),   # Vegueta–Triana
    (28.1396, -15.4439),   # Playa de Las Canteras
    (28.1287, -15.4370),   # Mesa y López
    (28.0997, -15.4519),   # Ciudad Alta / Escaleritas
]
WAVE_CLUSTER_WEIGHTS = [0.40, 0.15, 0.15, 0.15, 0.15]
WAVE_POS_SIGMA_DEG = (0.0045, 0.0051)      # ≈ 500 m spread around the centroid
BG_POS_SIGMA_DEG = (0.0072, 0.0082)        # ≈ 800 m spread for background demand


# ─── Normalisation helpers ────────────────────────────────────────────────────

def norm_lat(lat: float) -> float:
    return max(0.0, min(1.0, (lat - LAT_MIN) / (LAT_MAX - LAT_MIN)))


def norm_lon(lon: float) -> float:
    return max(0.0, min(1.0, (lon - LON_MIN) / (LON_MAX - LON_MIN)))


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6_371_000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))


# ─── Episode data structures ──────────────────────────────────────────────────

@dataclass
class SimDriver:
    driver_id: int
    lat: float
    lon: float
    lat_norm: float
    lon_norm: float
    speed_mps: float
    speed_norm: float
    eta_norm: float = 0.0
    is_available: bool = True
    busy_until_s: float = 0.0


@dataclass
class SimRequest:
    request_id: int
    lat: float
    lon: float
    urgency: float                  # [0, 1] — static urgency (legacy mode)
    arrival_s: float = 0.0
    deadline_s: float = float("inf")

    def urgency_at(self, t: float) -> float:
        """Dynamic urgency: ramps 0→1 as the all-aboard deadline approaches."""
        if math.isinf(self.deadline_s):
            return self.urgency
        return max(0.0, min(1.0, 1.0 - (self.deadline_s - t) / URGENCY_WINDOW_S))


# ─── Observation encoder ──────────────────────────────────────────────────────

class TensorEncoder:
    """
    Converts driver + cluster state into a fixed-size float32 observation.
    Slots beyond the actual driver/cluster count are zero-padded.
    """

    @staticmethod
    def encode(
        drivers: list[SimDriver],
        clusters: list[tuple[float, float, float]],  # (lat_norm, lon_norm, count_norm)
        locker_occupancy: float,
        max_urgency: float,
        active_count_norm: float,
        time_of_day_norm: Optional[float] = None,
    ) -> np.ndarray:
        obs = np.zeros(OBS_DIM, dtype=np.float32)

        # Empty/padding driver slots get the worst possible ETA (1.0) so the
        # policy is never lured into selecting a non-existent driver — a
        # zero-padded eta (0.0) would otherwise look like the closest driver.
        for i in range(MAX_DRIVERS):
            obs[i * OBS_PER_DRIVER + 3] = 1.0

        for i, d in enumerate(drivers[:MAX_DRIVERS]):
            base = i * OBS_PER_DRIVER
            obs[base + 0] = d.lat_norm
            obs[base + 1] = d.lon_norm
            obs[base + 2] = d.speed_norm
            obs[base + 3] = d.eta_norm
            obs[base + 4] = 1.0 if d.is_available else 0.0

        cluster_offset = MAX_DRIVERS * OBS_PER_DRIVER
        for i, (clat, clon, ccount) in enumerate(clusters[:MAX_CLUSTERS]):
            base = cluster_offset + i * OBS_PER_CLUSTER
            obs[base + 0] = clat
            obs[base + 1] = clon
            obs[base + 2] = ccount

        global_offset = cluster_offset + MAX_CLUSTERS * OBS_PER_CLUSTER
        if time_of_day_norm is None:
            time_of_day_norm = 0.0
        obs[global_offset + 0] = float(np.clip(locker_occupancy, 0.0, 1.0))
        obs[global_offset + 1] = float(np.clip(max_urgency, 0.0, 1.0))
        obs[global_offset + 2] = float(np.clip(active_count_norm, 0.0, 1.0))
        obs[global_offset + 3] = float(np.clip(time_of_day_norm, 0.0, 1.0))

        return obs


# ─── Gymnasium environment ────────────────────────────────────────────────────

class CruiseDispatchEnv(gym.Env):
    """
    Episode lifecycle (anticipatory, default):
      reset()  → generate drivers + a seeded arrival schedule (cruise waves +
                 Poisson background); fast-forward to the first decision point
      step(a)  → assign driver slot `a` to the most urgent pending request,
                 mark the driver busy (travel + service), then auto-advance to
                 the next decision point accruing waiting costs / expiries
      done     → every scheduled request has been served or expired

    Legacy lifecycle (``anticipatory=False``) reproduces the phase-1 myopic
    formulation verbatim (all requests at reset, drivers never busy).
    """

    metadata: dict = {"render_modes": []}

    def __init__(
        self,
        n_drivers: int = 6,
        n_requests: int = 10,
        max_steps: Optional[int] = None,
        domain_randomization: bool = False,
        anticipatory: bool = True,
    ) -> None:
        super().__init__()
        self.n_drivers = min(n_drivers, MAX_DRIVERS)
        self.n_requests = n_requests
        self.anticipatory = anticipatory
        self.max_steps = max_steps if max_steps is not None else (120 if anticipatory else 20)
        self.domain_randomization = domain_randomization

        self.observation_space = spaces.Box(
            low=0.0, high=1.0, shape=(OBS_DIM,), dtype=np.float32
        )
        self.action_space = spaces.Discrete(MAX_DRIVERS)

        self._drivers: list[SimDriver] = []
        self._pending: list[SimRequest] = []
        self._future: list[SimRequest] = []
        self._waves: list[tuple[float, int, int]] = []   # (t_wave, n_requests, cluster_idx)
        self._step_count = 0
        self._locker_occ = 0.5
        self._episode_reward = 0.0
        self._sim_minutes = 0
        self._assigned_etas: list[float] = []
        self._clock_s = 0.0
        self._served = 0
        self._expired = 0
        self._busy_time_s = 0.0

        # Domain-randomization parameters — resampled each episode when enabled,
        # held at neutral values otherwise so evaluation stays deterministic.
        self._traffic_factor = 1.0      # urban-traffic multiplier on ETAs
        self._service_noise_s = 0.0     # additive service-time noise (seconds)
        self._locker_failure_p = 0.0    # extra locker occupancy from out-of-service units
        self._iot_jitter = 0.0          # sensor/comms latency → observation jitter

    # ── Gym interface ──────────────────────────────────────────────────────────

    def reset(
        self,
        *,
        seed: Optional[int] = None,
        options: Optional[dict] = None,
    ) -> tuple[np.ndarray, dict]:
        super().reset(seed=seed)

        self._sample_domain_parameters()

        n_d = self._sample_driver_count()

        if not self.anticipatory:
            # Legacy (phase 1) reset — RNG call sequence preserved verbatim.
            n_r = self.np_random.integers(1, self.n_requests + 1)
            self._drivers = self._gen_drivers(int(n_d))
            self._pending = sorted(
                self._gen_requests(int(n_r)),
                key=lambda r: r.urgency,
                reverse=True,
            )
            self._future = []
            self._step_count = 0
            base_occ = float(self.np_random.uniform(0.1, 0.9))
            self._locker_occ = min(1.0, base_occ + self._locker_failure_p)
            self._episode_reward = 0.0
            self._sim_minutes = int(self.np_random.integers(0, 1440))
            self._assigned_etas = []
            return self._build_obs(), {}

        self._drivers = self._gen_drivers(int(n_d))
        self._pending = []
        self._future = self._gen_arrival_schedule()
        self._step_count = 0
        base_occ = float(self.np_random.uniform(0.1, 0.9))
        self._locker_occ = min(1.0, base_occ + self._locker_failure_p)
        self._episode_reward = 0.0
        self._sim_minutes = int(self.np_random.integers(0, 1440))
        self._assigned_etas = []
        self._clock_s = 0.0
        self._served = 0
        self._expired = 0
        self._busy_time_s = 0.0

        # Fast-forward to the first decision point (no pending yet → zero cost).
        self._advance_to_next_decision()
        return self._build_obs(), {}

    # ── Domain randomization ────────────────────────────────────────────────────

    def _sample_domain_parameters(self) -> None:
        """
        Resample the environment-dynamics parameters for a new episode.

        With domain randomization enabled the agent is trained across a family of
        simulators (Tobin et al., 2017) so the learned policy is robust to the
        reality gap. Neutral values are used otherwise so held-out evaluation and
        the baseline benchmark stay deterministic and directly comparable.
        """
        if not self.domain_randomization:
            self._traffic_factor = 1.0
            self._service_noise_s = 0.0
            self._locker_failure_p = 0.0
            self._iot_jitter = 0.0
            return
        self._traffic_factor = float(self.np_random.uniform(0.7, 1.8))
        self._service_noise_s = float(self.np_random.uniform(0.0, 90.0))
        self._locker_failure_p = float(self.np_random.uniform(0.0, 0.15))
        self._iot_jitter = float(self.np_random.uniform(0.0, 0.04))

    def _sample_driver_count(self) -> int:
        if not self.domain_randomization:
            return self.n_drivers
        lo = max(2, self.n_drivers - 2)
        hi = min(MAX_DRIVERS, self.n_drivers + 2)
        return int(self.np_random.integers(lo, hi + 1))

    def _eta_norm(self, driver: SimDriver, target: SimRequest) -> float:
        """Normalised ETA of `driver` toward `target`, including the episode's
        traffic multiplier and additive service-time noise."""
        dist_m = haversine_m(driver.lat, driver.lon, target.lat, target.lon)
        eta_s = dist_m / max(driver.speed_mps, 2.0)
        eta_s = eta_s * self._traffic_factor + self._service_noise_s
        return min(1.0, eta_s / MAX_ETA_S)

    def step(self, action: int) -> tuple[np.ndarray, float, bool, bool, dict]:
        if not self.anticipatory:
            return self._step_legacy(action)
        return self._step_anticipatory(action)

    def _step_legacy(self, action: int) -> tuple[np.ndarray, float, bool, bool, dict]:
        self._step_count += 1

        if not self._pending:
            return self._build_obs(), 0.0, True, False, {"reason": "no_pending"}

        available = [d for d in self._drivers if d.is_available]

        if not available or action >= len(available):
            reward = -10.0
        else:
            target = self._pending[0]
            driver = available[action]
            eta_norm = self._eta_norm(driver, target)
            eta_s = eta_norm * MAX_ETA_S

            reward = (0.5 * target.urgency + 0.5 * (1.0 - eta_norm)) * 100.0
            if target.urgency > 0.7 and eta_norm < 0.25:
                reward += 30.0  # urgent request handled fast

            self._assigned_etas.append(eta_norm)
            driver.eta_norm = eta_norm
            driver.lat = target.lat
            driver.lon = target.lon
            driver.lat_norm = norm_lat(target.lat)
            driver.lon_norm = norm_lon(target.lon)
            self._pending.pop(0)
            self._sim_minutes = (self._sim_minutes + max(1, int(math.ceil(eta_s / 60.0)))) % 1440

        self._episode_reward += reward

        done = not self._pending
        truncated = self._step_count >= self.max_steps

        return self._build_obs(), reward, done, truncated, {
            "episode_reward": self._episode_reward,
            "remaining_requests": len(self._pending),
        }

    def _step_anticipatory(self, action: int) -> tuple[np.ndarray, float, bool, bool, dict]:
        self._step_count += 1

        if not self._pending and not self._future:
            return self._build_obs(), 0.0, True, False, {"reason": "no_pending"}

        slot = int(action)
        in_range = slot < len(self._drivers)

        if not in_range:
            # Empty slot: invalid — fixed penalty plus a 30 s dispatch delay so
            # the agent cannot stall the simulation for free.
            reward = -10.0
            cost, expired = self._advance_time(INVALID_TICK_S)
            reward -= cost + EXPIRY_PENALTY * expired
            cost, expired = self._advance_to_next_decision()
            reward -= cost + EXPIRY_PENALTY * expired
        elif not self._drivers[slot].is_available:
            # Busy slot: legitimate HOLD decision — wait for that driver to
            # free up instead of burning a long trip from a distant free
            # driver. Waiting costs and expiries accrue naturally, so holding
            # is only profitable when the released driver's position beats the
            # best free ETA by more than the wait. Myopic baselines never hold.
            # The advance is capped (HOLD_CAP_S) so a single decision never
            # jumps minutes of simulation: the dispatcher re-evaluates, and the
            # agent expresses longer waits by chaining holds.
            hold_until = self._drivers[slot].busy_until_s
            dt = min(max(0.0, hold_until - self._clock_s), HOLD_CAP_S)
            cost, expired = self._advance_time(dt)
            reward = -(cost + EXPIRY_PENALTY * expired)
            cost, expired = self._advance_to_next_decision()
            reward -= cost + EXPIRY_PENALTY * expired
        else:
            self._sort_pending()
            target = self._pending.pop(0)
            driver = self._drivers[int(action)]
            eta_norm = self._eta_norm(driver, target)
            eta_s = eta_norm * MAX_ETA_S

            if self._clock_s + eta_s > target.deadline_s:
                # Infeasible dispatch: no driver reaches the passenger before
                # all-aboard — the luggage misses the ship. The dispatcher
                # rejects it (driver stays free) but the miss is charged like
                # an expiry. Letting queues build past this point is what the
                # anticipatory policy must prevent.
                self._expired += 1
                reward = -EXPIRY_PENALTY
                cost, expired = self._advance_to_next_decision()
                reward -= cost + EXPIRY_PENALTY * expired
            else:
                urgency = target.urgency_at(self._clock_s)

                reward = (0.5 * urgency + 0.5 * (1.0 - eta_norm)) * 100.0
                if urgency > 0.7 and eta_norm < 0.25:
                    reward += 30.0  # urgent request handled fast

                service_s = float(
                    self.np_random.uniform(*SERVICE_RANGE_S)
                ) + self._service_noise_s
                busy_s = eta_s + service_s
                driver.busy_until_s = self._clock_s + busy_s
                driver.is_available = False
                self._busy_time_s += busy_s

                self._assigned_etas.append(eta_norm)
                driver.lat = target.lat
                driver.lon = target.lon
                driver.lat_norm = norm_lat(target.lat)
                driver.lon_norm = norm_lon(target.lon)
                self._served += 1

                cost, expired = self._advance_to_next_decision()
                reward -= cost + EXPIRY_PENALTY * expired

        terminated = not self._pending and not self._future
        truncated = (
            self._step_count >= self.max_steps
            or self._clock_s > HARD_HORIZON_S
        ) and not terminated

        if truncated:
            unserved = len(self._pending) + len(self._future)
            reward -= EXPIRY_PENALTY * unserved

        self._episode_reward += reward

        return self._build_obs(), reward, terminated, truncated, {
            "episode_reward": self._episode_reward,
            "remaining_requests": len(self._pending) + len(self._future),
            "served": self._served,
            "expired": self._expired,
            "clock_s": self._clock_s,
            "utilization": self._utilization(),
        }

    def render(self) -> None:
        pass  # text rendering intentionally omitted for headless training

    # ── Anticipatory simulation core ────────────────────────────────────────────

    def _sort_pending(self) -> None:
        # Earliest deadline ⇔ highest dynamic urgency (the ramp is monotone).
        self._pending.sort(key=lambda r: r.deadline_s)

    def _release_drivers(self) -> None:
        for d in self._drivers:
            if not d.is_available and d.busy_until_s <= self._clock_s:
                d.is_available = True

    def _materialize_arrivals(self) -> None:
        while self._future and self._future[0].arrival_s <= self._clock_s:
            self._pending.append(self._future.pop(0))

    def _expire_requests(self) -> int:
        alive = [r for r in self._pending if r.deadline_s >= self._clock_s]
        expired = len(self._pending) - len(alive)
        if expired:
            self._pending = alive
            self._expired += expired
        return expired

    def _wait_cost(self, dt_s: float) -> float:
        """Waiting cost accrued by every pending request over `dt_s` seconds."""
        if not self._pending or dt_s <= 0.0:
            return 0.0
        t_mid = self._clock_s + dt_s / 2.0
        per_min = sum(
            WAIT_BASE + WAIT_URG * r.urgency_at(t_mid) for r in self._pending
        )
        return per_min * dt_s / 60.0

    def _advance_time(self, dt_s: float) -> tuple[float, int]:
        """Advance the clock by a fixed amount, accruing costs and expiries."""
        cost = self._wait_cost(dt_s)
        self._clock_s += dt_s
        self._release_drivers()
        self._materialize_arrivals()
        expired = self._expire_requests()
        return cost, expired

    def _advance_to_next_decision(self) -> tuple[float, int]:
        """
        Event-driven advance: jump to the next arrival/release/deadline until a
        decision point (≥1 pending request AND ≥1 free driver) or episode end.
        Returns the accumulated waiting cost and expiry count along the way.
        """
        cost, expired = 0.0, 0
        while True:
            self._release_drivers()
            self._materialize_arrivals()
            expired += self._expire_requests()

            if self._pending and any(d.is_available for d in self._drivers):
                self._sort_pending()
                break
            if not self._pending and not self._future:
                break

            candidates: list[float] = []
            if self._future:
                candidates.append(self._future[0].arrival_s)
            if self._pending:
                busy = [d.busy_until_s for d in self._drivers if not d.is_available]
                if busy:
                    candidates.append(min(busy))
                candidates.append(min(r.deadline_s for r in self._pending))
            if not candidates:
                break
            t_next = max(min(candidates), self._clock_s + 1e-3)
            cost += self._wait_cost(t_next - self._clock_s)
            self._clock_s = t_next
            if self._clock_s > HARD_HORIZON_S:
                break
        return cost, expired

    def _utilization(self) -> float:
        horizon = max(self._clock_s, 1.0) * max(len(self._drivers), 1)
        return min(1.0, self._busy_time_s / horizon)

    # ── Observation builder ────────────────────────────────────────────────────

    def _build_obs(self) -> np.ndarray:
        if self.anticipatory:
            self._sort_pending()
            tgt = self._pending[0] if self._pending else None
            for d in self._drivers:
                if d.is_available:
                    d.eta_norm = self._eta_norm(d, tgt) if tgt is not None else 1.0
                else:
                    # Busy drivers surface their remaining occupation time so the
                    # policy can reason about when the fleet frees up.
                    remaining = max(0.0, d.busy_until_s - self._clock_s)
                    d.eta_norm = min(1.0, remaining / MAX_ETA_S)
            max_urg = max(
                (r.urgency_at(self._clock_s) for r in self._pending), default=0.0
            )
            active_norm = min(1.0, len(self._pending) / MAX_ACTIVE_REQUESTS)
            clusters = self._demand_clusters()
            minutes = (self._sim_minutes + self._clock_s / 60.0) % 1440.0
            time_norm = minutes / 1440.0
        else:
            # Recompute eta_norm for each available driver toward the current target
            if self._pending:
                tgt = self._pending[0]
                for d in self._drivers:
                    if d.is_available:
                        d.eta_norm = self._eta_norm(d, tgt)
            max_urg = max((r.urgency for r in self._pending), default=0.0)
            active_norm = min(1.0, len(self._pending) / MAX_ACTIVE_REQUESTS)
            clusters = self._pseudo_clusters()
            time_norm = self._sim_minutes / 1440.0

        obs = TensorEncoder.encode(
            self._drivers,
            clusters,
            self._locker_occ,
            max_urg,
            active_norm,
            time_of_day_norm=time_norm,
        )

        # IoT/comms latency modelled as bounded sensor jitter on the observation.
        if self._iot_jitter > 0.0:
            noise = self.np_random.normal(0.0, self._iot_jitter, size=obs.shape)
            obs = np.clip(obs + noise.astype(np.float32), 0.0, 1.0).astype(np.float32)

        return obs

    def _pseudo_clusters(self) -> list[tuple[float, float, float]]:
        """Grid-based demand approximation for training (avoids PostGIS dependency)."""
        count_norm = min(1.0, len(self._pending) / 20.0)
        return [
            (norm_lat(r.lat), norm_lon(r.lon), count_norm)
            for r in self._pending[:MAX_CLUSTERS]
        ]

    def _future_demand(self, cluster_idx: int) -> float:
        """Known cruise-agenda demand landing on a cluster within the lookahead
        window (the real dispatcher knows all-aboard schedules via AIS)."""
        total = 0.0
        for t_wave, n_req, c_idx in self._waves:
            if c_idx != cluster_idx or t_wave <= self._clock_s:
                continue
            proximity = 1.0 - (t_wave - self._clock_s) / FUTURE_DEMAND_WINDOW_S
            if proximity > 0.0:
                total += n_req * proximity
        return total

    def _demand_clusters(self) -> list[tuple[float, float, float]]:
        """Fixed demand zones: current pending nearby + known incoming waves."""
        clusters = []
        for idx, (clat, clon) in enumerate(CLUSTER_CENTROIDS):
            near = sum(
                1
                for r in self._pending
                if haversine_m(r.lat, r.lon, clat, clon) <= CLUSTER_NEAR_M
            )
            count = near + self._future_demand(idx)
            clusters.append(
                (norm_lat(clat), norm_lon(clon), min(1.0, count / 20.0))
            )
        return clusters

    # ── Episode generators ────────────────────────────────────────────────────

    def _gen_drivers(self, n: int) -> list[SimDriver]:
        drivers = []
        for i in range(n):
            lat = float(self.np_random.uniform(LAT_MIN, LAT_MAX))
            lon = float(self.np_random.uniform(LON_MIN, LON_MAX))
            spd = float(self.np_random.uniform(3.0, 12.0))
            drivers.append(SimDriver(
                driver_id=i,
                lat=lat, lon=lon,
                lat_norm=norm_lat(lat),
                lon_norm=norm_lon(lon),
                speed_mps=spd,
                speed_norm=min(1.0, spd / 30.0),
            ))
        return drivers

    def _gen_requests(self, n: int) -> list[SimRequest]:
        requests = []
        for i in range(n):
            lat = float(self.np_random.uniform(LAT_MIN, LAT_MAX))
            lon = float(self.np_random.uniform(LON_MIN, LON_MAX))
            # ~30 % of requests are cruise-urgent
            urgency = (
                float(self.np_random.uniform(0.65, 1.0))
                if float(self.np_random.random()) < 0.3
                else float(self.np_random.uniform(0.0, 0.5))
            )
            requests.append(SimRequest(request_id=i, lat=lat, lon=lon, urgency=urgency))
        return requests

    def _gen_arrival_schedule(self) -> list[SimRequest]:
        """Seeded arrival schedule: 2–3 cruise waves + Poisson background."""
        rng = self.np_random
        requests: list[SimRequest] = []
        rid = 0

        # ── Cruise waves ──
        n_waves = int(rng.integers(2, 4))
        wave_times: list[float] = []
        for _ in range(n_waves):
            t_wave = float(rng.uniform(*WAVE_TIME_RANGE_S))
            for _ in range(20):
                if all(abs(t_wave - t) >= WAVE_MIN_SEPARATION_S for t in wave_times):
                    break
                t_wave = float(rng.uniform(*WAVE_TIME_RANGE_S))
            wave_times.append(t_wave)

        self._waves = []
        for t_wave in wave_times:
            n_req = int(rng.integers(12, 18))
            c_idx = int(rng.choice(len(CLUSTER_CENTROIDS), p=WAVE_CLUSTER_WEIGHTS))
            clat, clon = CLUSTER_CENTROIDS[c_idx]
            self._waves.append((t_wave, n_req, c_idx))
            for _ in range(n_req):
                arrival = float(
                    np.clip(rng.normal(t_wave, WAVE_SIGMA_S), 0.0, HORIZON_S)
                )
                lat = float(np.clip(rng.normal(clat, WAVE_POS_SIGMA_DEG[0]), LAT_MIN, LAT_MAX))
                lon = float(np.clip(rng.normal(clon, WAVE_POS_SIGMA_DEG[1]), LON_MIN, LON_MAX))
                deadline = arrival + float(rng.uniform(*WAVE_DEADLINE_RANGE_S))
                requests.append(SimRequest(
                    request_id=rid, lat=lat, lon=lon, urgency=0.0,
                    arrival_s=arrival, deadline_s=deadline,
                ))
                rid += 1

        # ── Background demand ──
        n_bg = int(rng.poisson(BG_MEAN_REQUESTS))
        for _ in range(n_bg):
            arrival = float(rng.uniform(0.0, HORIZON_S))
            if float(rng.random()) < 0.7:
                c_idx = int(rng.integers(0, len(CLUSTER_CENTROIDS)))
                clat, clon = CLUSTER_CENTROIDS[c_idx]
                lat = float(np.clip(rng.normal(clat, BG_POS_SIGMA_DEG[0]), LAT_MIN, LAT_MAX))
                lon = float(np.clip(rng.normal(clon, BG_POS_SIGMA_DEG[1]), LON_MIN, LON_MAX))
            else:
                lat = float(rng.uniform(LAT_MIN, LAT_MAX))
                lon = float(rng.uniform(LON_MIN, LON_MAX))
            deadline = arrival + float(rng.uniform(*BG_DEADLINE_RANGE_S))
            requests.append(SimRequest(
                request_id=rid, lat=lat, lon=lon, urgency=0.0,
                arrival_s=arrival, deadline_s=deadline,
            ))
            rid += 1

        requests.sort(key=lambda r: r.arrival_s)
        return requests
