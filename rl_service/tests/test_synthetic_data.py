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
    export_dataset,
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


def test_export_dataset_writes_csv(tmp_path):
    out = tmp_path / "episodes.csv"
    n = export_dataset(path=str(out), n_episodes=10, seed_base=0)
    assert n == 10
    assert out.exists()
    lines = out.read_text().strip().split("\n")
    # header + at least one row per episode
    assert len(lines) > 10
    assert lines[0].startswith("episode_id,driver_id,driver_lat")


def test_export_dataset_creates_parent_dirs(tmp_path):
    out = tmp_path / "nested" / "deeper" / "episodes.csv"
    n = export_dataset(path=str(out), n_episodes=2, seed_base=0)
    assert n == 2
    assert out.exists()


def test_export_dataset_rows_match_expected_count(tmp_path):
    """For default n_drivers=8 × n_requests=12 = 96 rows per episode."""
    out = tmp_path / "episodes.csv"
    export_dataset(path=str(out), n_episodes=5, seed_base=100)
    lines = out.read_text().strip().split("\n")
    # header + 5 × 96 rows
    assert len(lines) == 1 + 5 * 8 * 12


def test_export_dataset_reproducible(tmp_path):
    a = tmp_path / "a.csv"
    b = tmp_path / "b.csv"
    export_dataset(path=str(a), n_episodes=3, seed_base=7)
    export_dataset(path=str(b), n_episodes=3, seed_base=7)
    assert a.read_text() == b.read_text()
