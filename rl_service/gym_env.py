"""
CruiseDispatchEnv — Gymnasium environment for the driver-dispatch RL problem.

Problem framing
───────────────
At each step the agent picks one available driver (0-indexed) to handle the
most-urgent pending pickup request. The chosen driver is then repositioned to
that request location, so each action affects future ETAs. The episode ends
when every request is covered.

Observation  Box(shape=(OBS_DIM=69,), float32, clipped to [0,1])
Action       Discrete(MAX_DRIVERS=10)
Reward       (0.5 × urgency + 0.5 × (1 - eta_norm)) × 100
             -10 for invalid actions (out-of-range index or no driver available)

Normalisation bounds match the Las Palmas service area configured in env.ts
SERVICE_AREA_VIEWBOX = "-15.55,27.99,-15.35,28.22"
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
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


@dataclass
class SimRequest:
    request_id: int
    lat: float
    lon: float
    urgency: float          # [0, 1]


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
    Episode lifecycle:
      reset()  → randomly generate drivers and pending requests
      step(a)  → assign available_drivers[a] to the most urgent pending request
               → episode ends when all requests are assigned or drivers exhausted

    Reward design (per assignment):
      base   = (0.5 × urgency + 0.5 × (1 − eta_norm)) × 100    ∈ [0, 100]
      bonus  = +30 if urgency > 0.7 and eta_norm < 0.25         (fast handling of urgent)
      penalty = −10 for invalid action index
    """

    metadata: dict = {"render_modes": []}

    def __init__(
        self,
        n_drivers: int = 6,
        n_requests: int = 10,
        max_steps: int = 20,
        domain_randomization: bool = False,
    ) -> None:
        super().__init__()
        self.n_drivers = min(n_drivers, MAX_DRIVERS)
        self.n_requests = n_requests
        self.max_steps = max_steps
        self.domain_randomization = domain_randomization

        self.observation_space = spaces.Box(
            low=0.0, high=1.0, shape=(OBS_DIM,), dtype=np.float32
        )
        self.action_space = spaces.Discrete(MAX_DRIVERS)

        self._drivers: list[SimDriver] = []
        self._pending: list[SimRequest] = []
        self._step_count = 0
        self._locker_occ = 0.5
        self._episode_reward = 0.0
        self._sim_minutes = 0
        self._assigned_etas: list[float] = []

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
        n_r = self.np_random.integers(1, self.n_requests + 1)

        self._drivers = self._gen_drivers(int(n_d))
        self._pending = sorted(
            self._gen_requests(int(n_r)),
            key=lambda r: r.urgency,
            reverse=True,
        )
        self._step_count = 0
        base_occ = float(self.np_random.uniform(0.1, 0.9))
        self._locker_occ = min(1.0, base_occ + self._locker_failure_p)
        self._episode_reward = 0.0
        self._sim_minutes = int(self.np_random.integers(0, 1440))
        self._assigned_etas = []

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

    def render(self) -> None:
        pass  # text rendering intentionally omitted for headless training

    # ── Observation builder ────────────────────────────────────────────────────

    def _build_obs(self) -> np.ndarray:
        # Recompute eta_norm for each available driver toward the current target
        if self._pending:
            tgt = self._pending[0]
            for d in self._drivers:
                if d.is_available:
                    d.eta_norm = self._eta_norm(d, tgt)

        max_urg = max((r.urgency for r in self._pending), default=0.0)
        active_norm = min(1.0, len(self._pending) / MAX_ACTIVE_REQUESTS)
        clusters = self._pseudo_clusters()

        obs = TensorEncoder.encode(
            self._drivers,
            clusters,
            self._locker_occ,
            max_urg,
            active_norm,
            time_of_day_norm=self._sim_minutes / 1440.0,
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
