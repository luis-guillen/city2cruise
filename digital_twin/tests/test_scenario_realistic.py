def test_scenario_uses_traffic_multiplier(client):
    response = client.post(
        "/scenario/run",
        json={
            "name": "rush_hour",
            "duration_minutes": 60,
            "request_rate_per_min": 3.0,
            "drivers_online": 10,
            "seed": 7,
            "scenario_file": "scenarios/las_palmas_baseline.json",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["avg_match_seconds"] > 30


def test_scenario_fixture_can_override_drivers_pool(client):
    response = client.post(
        "/scenario/run",
        json={
            "name": "fixture_drivers",
            "duration_minutes": 30,
            "request_rate_per_min": 1.0,
            "drivers_online": 0,
            "seed": 11,
            "scenario_file": "scenarios/las_palmas_baseline.json",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["requests_simulated"] == 30
    assert body["requests_failed"] < body["requests_simulated"]


def test_scenario_fixture_sets_effective_duration_when_default_used(client):
    response = client.post(
        "/scenario/run",
        json={
            "name": "fixture_duration",
            "request_rate_per_min": 1.0,
            "drivers_online": 10,
            "seed": 5,
            "scenario_file": "scenarios/las_palmas_baseline.json",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["duration_minutes"] == 480
    assert body["requests_simulated"] == 480


def test_scenario_rejects_path_outside_fixtures(client):
    response = client.post(
        "/scenario/run",
        json={
            "name": "path_escape",
            "duration_minutes": 60,
            "request_rate_per_min": 1.0,
            "drivers_online": 10,
            "scenario_file": "../README.md",
        },
    )
    assert response.status_code == 400


def test_scenario_same_seed_is_deterministic_per_request(client):
    payload = {
        "name": "deterministic_seed",
        "duration_minutes": 60,
        "request_rate_per_min": 2.0,
        "drivers_online": 10,
        "seed": 17,
        "scenario_file": "scenarios/las_palmas_baseline.json",
    }
    first = client.post("/scenario/run", json=payload)
    second = client.post("/scenario/run", json=payload)
    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json() == second.json()
