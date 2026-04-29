"""
Hito 3.4 — Synthetic data generator for the City2Cruise dispatch agent.

Produces reproducible episodes (drivers + requests + locker occupancy) within the
Las Palmas service area, with the same normalisation bounds used by gym_env.py.

Used by:
  - rl_service.train       → pre-training the PPO agent on synthetic batches
  - rl_service.validation  → robustness / fidelity evaluation
  - tests/                 → deterministic fixtures
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass
from typing import Optional

# Service-area bounds — must match rl_service/gym_env.py
LAT_MIN, LAT_MAX = 27.99, 28.22
LON_MIN, LON_MAX = -15.55, -15.35


@dataclass(frozen=True)
class SyntheticDriver:
    id: int
    lat: float
    lon: float
    speed_mps: float


@dataclass(frozen=True)
class SyntheticRequest:
    id: int
    lat: float
    lon: float
    urgency: float
    cruise_id: Optional[int] = None


@dataclass(frozen=True)
class SyntheticEpisode:
    drivers: tuple[SyntheticDriver, ...]
    requests: tuple[SyntheticRequest, ...]
    locker_occupancy: float


def generate_episode(
    seed: int,
    n_drivers: int = 8,
    n_requests: int = 12,
    cruise_urgent_rate: float = 0.30,
) -> SyntheticEpisode:
    """
    Build one fully-deterministic episode.

    cruise_urgent_rate: fraction of requests tagged as cruise-urgent (urgency > 0.65).
    Driver speed sampled from a urban-realistic [3, 12] m/s range (~10–43 km/h).
    """
    rng = random.Random(seed)

    drivers = tuple(
        SyntheticDriver(
            id=i,
            lat=rng.uniform(LAT_MIN, LAT_MAX),
            lon=rng.uniform(LON_MIN, LON_MAX),
            speed_mps=rng.uniform(3.0, 12.0),
        )
        for i in range(n_drivers)
    )

    requests = tuple(
        SyntheticRequest(
            id=i,
            lat=rng.uniform(LAT_MIN, LAT_MAX),
            lon=rng.uniform(LON_MIN, LON_MAX),
            urgency=(
                rng.uniform(0.65, 1.0)
                if rng.random() < cruise_urgent_rate
                else rng.uniform(0.0, 0.5)
            ),
            cruise_id=rng.randint(100, 200) if rng.random() < 0.2 else None,
        )
        for i in range(n_requests)
    )

    return SyntheticEpisode(
        drivers=drivers,
        requests=requests,
        locker_occupancy=rng.uniform(0.1, 0.9),
    )


def inject_gps_noise(
    points: list[tuple[float, float]],
    seed: int,
    sigma_m: float = 10.0,
    outlier_rate: float = 0.02,
    outlier_min_m: float = 50.0,
    outlier_max_m: float = 200.0,
) -> list[tuple[float, float]]:
    """
    Apply Gaussian noise (1-sigma = sigma_m metres) plus rare hard outliers
    to a list of (lat, lon) points. Reproducible for the same seed.

    The displacement is converted from metres to degrees on the fly using a
    flat-earth approximation per point (good enough at city scale).
    """
    rng = random.Random(seed)
    out: list[tuple[float, float]] = []
    deg_per_m_lat = 1.0 / 111_320.0
    for (lat, lon) in points:
        cos_lat = math.cos(math.radians(lat)) or 1.0
        deg_per_m_lon = 1.0 / (111_320.0 * cos_lat)

        if rng.random() < outlier_rate:
            magnitude = rng.uniform(outlier_min_m, outlier_max_m)
            sign_lat = 1 if rng.random() < 0.5 else -1
            sign_lon = 1 if rng.random() < 0.5 else -1
            jitter_lat_m = magnitude * sign_lat
            jitter_lon_m = magnitude * sign_lon
        else:
            jitter_lat_m = rng.gauss(0.0, sigma_m)
            jitter_lon_m = rng.gauss(0.0, sigma_m)

        out.append((
            lat + jitter_lat_m * deg_per_m_lat,
            lon + jitter_lon_m * deg_per_m_lon,
        ))
    return out
