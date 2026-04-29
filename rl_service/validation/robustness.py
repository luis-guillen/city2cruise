"""Robustness evaluator for degraded GPS/telemetry streams."""
from __future__ import annotations

import random
from dataclasses import dataclass

from rl_service.synthetic_data import LAT_MAX, LAT_MIN, LON_MAX, LON_MIN


@dataclass
class PacketLossSeries:
    points: list[tuple[float, float]]
    original_count: int
    loss_rate: float

    def __iter__(self):
        return iter(self.points)

    def __len__(self):
        return len(self.points)

    def __getitem__(self, index):
        return self.points[index]


def inject_packet_loss(
    points: list[tuple[float, float]],
    loss_rate: float,
    seed: int,
) -> PacketLossSeries:
    rng = random.Random(seed)
    total = len(points)
    drop_count = min(total, max(0, round(total * loss_rate)))
    drop_indexes = set(rng.sample(range(total), drop_count))
    kept = [point for index, point in enumerate(points) if index not in drop_indexes]
    return PacketLossSeries(points=kept, original_count=len(points), loss_rate=loss_rate)


def evaluate_robustness(
    points: list[tuple[float, float]] | PacketLossSeries,
    expected_count: int | None = None,
    service_margin_deg: float = 0.006,
    min_recovered_pct: float = 0.90,
) -> dict:
    if isinstance(points, PacketLossSeries):
        raw_points = points.points
        expected = expected_count or points.original_count
    else:
        raw_points = list(points)
        expected = expected_count or len(raw_points)

    valid_points = [
        (lat, lon)
        for lat, lon in raw_points
        if (LAT_MIN - service_margin_deg) <= lat <= (LAT_MAX + service_margin_deg)
        and (LON_MIN - service_margin_deg) <= lon <= (LON_MAX + service_margin_deg)
    ]
    recovered_pct = len(valid_points) / max(expected, 1)
    invalid_pct = 1.0 - (len(valid_points) / max(len(raw_points), 1))

    return {
        "expected_points": expected,
        "received_points": len(raw_points),
        "valid_points": len(valid_points),
        "recovered_pct": recovered_pct,
        "invalid_pct": invalid_pct,
        "pass": recovered_pct >= min_recovered_pct,
    }
