"""Modelo simple de tráfico para simulaciones del twin."""
from __future__ import annotations


def traffic_multiplier(hour: int, weekday: int) -> float:
    """Returns >1 when traffic is slow (commute hours), 1.0 = baseline.

    weekday: 0=Mon ... 6=Sun
    """
    hour = hour % 24
    weekday = weekday % 7
    is_weekend = weekday >= 5

    if is_weekend:
        if 11 <= hour <= 14 or 19 <= hour <= 22:
            return 1.1
        if 9 <= hour <= 18:
            return 1.0
        return 0.9

    if hour in (7, 8, 9):
        return 1.7
    if hour in (17, 18, 19):
        return 1.8
    if 22 <= hour or hour <= 5:
        return 0.85
    return 1.0
