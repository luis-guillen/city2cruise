from digital_twin.traffic import traffic_multiplier


def test_rush_hour_slows_traffic():
    assert traffic_multiplier(hour=8, weekday=1) > 1.5
    assert traffic_multiplier(hour=18, weekday=1) > 1.5


def test_night_is_fast():
    assert traffic_multiplier(hour=3, weekday=2) < 1.1


def test_weekend_morning_is_normal():
    assert 0.9 < traffic_multiplier(hour=10, weekday=5) < 1.3
