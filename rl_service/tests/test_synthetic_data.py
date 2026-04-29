"""
Hito 3.4 — Synthetic data generator tests.

Validates:
  - Episode schema exposes drivers, requests, locker_occupancy
  - Driver/request fields are within Las Palmas service area bounds
  - Same seed produces identical episodes (reproducibility)
  - Urgency is in [0, 1]
"""
from __future__ import annotations

from rl_service.synthetic_data import (
    SyntheticEpisode,
    SyntheticDriver,
    SyntheticRequest,
    generate_episode,
)


def test_generate_episode_returns_dataclass():
    ep = generate_episode(seed=42)
    assert isinstance(ep, SyntheticEpisode)
    assert len(ep.drivers) >= 2
    assert len(ep.requests) >= 1
    assert all(isinstance(d, SyntheticDriver) for d in ep.drivers)
    assert all(isinstance(r, SyntheticRequest) for r in ep.requests)
    assert all(0.0 <= r.urgency <= 1.0 for r in ep.requests)
    assert 0.0 <= ep.locker_occupancy <= 1.0


def test_generate_episode_reproducible():
    a = generate_episode(seed=42)
    b = generate_episode(seed=42)
    assert a == b
    assert a.drivers == b.drivers
    assert a.requests == b.requests


def test_generate_episode_different_seed_differs():
    a = generate_episode(seed=1)
    b = generate_episode(seed=2)
    assert a != b


def test_drivers_within_service_area():
    ep = generate_episode(seed=7, n_drivers=20, n_requests=5)
    for d in ep.drivers:
        assert 27.99 <= d.lat <= 28.22
        assert -15.55 <= d.lon <= -15.35
        assert 3.0 <= d.speed_mps <= 12.0
