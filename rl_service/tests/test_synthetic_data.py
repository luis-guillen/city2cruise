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
    inject_gps_noise,
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


def test_gps_noise_reproducible():
    raw = [(28.12, -15.43)] * 10
    a = inject_gps_noise(raw, seed=1, sigma_m=10.0)
    b = inject_gps_noise(raw, seed=1, sigma_m=10.0)
    assert a == b


def test_gps_noise_within_accuracy_envelope():
    """With sigma=10m, ~95% of points should be within 30m (3-sigma)."""
    raw = [(28.12, -15.43)] * 200
    noisy = inject_gps_noise(raw, seed=42, sigma_m=10.0, outlier_rate=0.0)
    # 0.0003 deg lat ≈ 33 m
    near = sum(1 for (lat, _) in noisy if abs(lat - 28.12) < 0.0003)
    assert near >= 180  # ≥ 90 % within 3-sigma envelope


def test_gps_noise_produces_outliers_when_rate_positive():
    """With outlier_rate=0.5, should see displacements ≥ 50 m frequently."""
    raw = [(28.12, -15.43)] * 100
    noisy = inject_gps_noise(raw, seed=3, sigma_m=5.0, outlier_rate=0.5)
    # 50 m displacement ≈ 0.00045 deg lat — count points outside that envelope
    outliers = sum(1 for (lat, _) in noisy if abs(lat - 28.12) > 0.00045)
    assert outliers >= 30  # ~half should be outliers


def test_gps_noise_zero_outlier_rate_keeps_close():
    raw = [(28.12, -15.43)] * 50
    noisy = inject_gps_noise(raw, seed=9, sigma_m=5.0, outlier_rate=0.0)
    for (lat, lon) in noisy:
        # 5-sigma envelope = 25 m ≈ 0.000225 deg — very lax bound
        assert abs(lat - 28.12) < 0.0005
        assert abs(lon - (-15.43)) < 0.0005
