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

import csv
import math
import random
from dataclasses import dataclass
from pathlib import Path
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


_CSV_HEADER = (
    "episode_id",
    "driver_id",
    "driver_lat",
    "driver_lon",
    "driver_speed_mps",
    "request_id",
    "request_lat",
    "request_lon",
    "urgency",
    "cruise_id",
    "locker_occupancy",
)


def export_dataset(
    path: str,
    n_episodes: int,
    seed_base: int = 0,
    n_drivers: int = 8,
    n_requests: int = 12,
) -> int:
    """
    Write n_episodes synthetic episodes to a CSV file. Each row is the
    Cartesian product (driver × request) of the episode, so each episode
    contributes n_drivers × n_requests rows.

    Returns the number of episodes written.
    """
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(_CSV_HEADER)
        for ep_id in range(n_episodes):
            ep = generate_episode(
                seed=seed_base + ep_id,
                n_drivers=n_drivers,
                n_requests=n_requests,
            )
            for d in ep.drivers:
                for r in ep.requests:
                    w.writerow([
                        ep_id,
                        d.id,
                        f"{d.lat:.6f}",
                        f"{d.lon:.6f}",
                        f"{d.speed_mps:.3f}",
                        r.id,
                        f"{r.lat:.6f}",
                        f"{r.lon:.6f}",
                        f"{r.urgency:.4f}",
                        r.cruise_id if r.cruise_id is not None else "",
                        f"{ep.locker_occupancy:.4f}",
                    ])
    return n_episodes


if __name__ == "__main__":
    import sys

    n = int(sys.argv[1]) if len(sys.argv) > 1 else 10_000
    out = sys.argv[2] if len(sys.argv) > 2 else "/tmp/synthetic_episodes.csv"
    print(f"Generating {n} episodes → {out}")
    export_dataset(out, n_episodes=n)
    print("Done.")
