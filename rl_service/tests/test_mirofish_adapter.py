import json

import httpx
import pytest

from rl_service.twin_mirofish_adapter import MiroFishTwinAdapter


def _handler(request: httpx.Request) -> httpx.Response:
    assert request.headers.get("authorization") == "Bearer test-key"
    assert request.headers.get("x-api-key") == "test-key"

    if request.url.path == "/health":
        return httpx.Response(200, json={"status": "ok", "service": "mirofish"})

    if request.url.path == "/api/simulation/create":
        body = json.loads(request.content)
        assert body["project_id"] == "proj-1"
        assert body["graph_id"] == "graph-1"
        return httpx.Response(200, json={
            "success": True,
            "data": {
                "simulation_id": "sim_001",
                "project_id": "proj-1",
                "graph_id": "graph-1",
                "status": "created",
            },
        })

    if request.url.path == "/api/simulation/prepare":
        body = json.loads(request.content)
        assert body["simulation_id"] == "sim_001"
        return httpx.Response(200, json={
            "success": True,
            "data": {
                "simulation_id": "sim_001",
                "task_id": "task_001",
                "status": "preparing",
                "already_prepared": False,
            },
        })

    if request.url.path == "/api/simulation/prepare/status":
        body = json.loads(request.content)
        assert body["simulation_id"] == "sim_001"
        return httpx.Response(200, json={
            "success": True,
            "data": {
                "simulation_id": "sim_001",
                "task_id": "task_001",
                "status": "ready",
                "progress": 100,
                "already_prepared": True,
            },
        })

    if request.url.path == "/api/simulation/sim_001":
        return httpx.Response(200, json={
            "success": True,
            "data": {
                "simulation_id": "sim_001",
                "status": "ready",
                "drivers": [
                    {"driver_id": 1, "lat": 28.1, "lon": -15.4, "speed_mps": 7.5},
                    {"driver_id": 2, "lat": 28.11, "lon": -15.41, "speed_mps": 6.2},
                ],
                "lockers": [
                    {"id": 1, "status": "free"},
                    {"id": 2, "status": "occupied"},
                ],
                "requests": [
                    {
                        "cruise_id": 9,
                        "vessel_name": "MSC Test",
                        "minutes_to_deadline": 40,
                        "urgency": 0.8,
                    }
                ],
                "aggregates": {
                    "lockers_total": 2,
                    "lockers_free": 1,
                    "lockers_occupied": 1,
                    "drivers_total": 2,
                    "drivers_online": 2,
                    "requests_active": 1,
                    "avg_match_seconds": 27.5,
                    "p95_match_seconds": 81.0,
                },
            },
        })

    raise AssertionError(f"Unexpected path: {request.url.path}")


@pytest.fixture
def adapter(monkeypatch):
    transport = httpx.MockTransport(_handler)
    real_client = httpx.Client

    def patched(*args, **kwargs):
        kwargs["transport"] = transport
        return real_client(*args, **kwargs)

    monkeypatch.setattr("rl_service.twin_mirofish_adapter.httpx.Client", patched)
    return MiroFishTwinAdapter(
        base_url="http://mirofish.local",
        api_key="test-key",
        project_id="proj-1",
        graph_id="graph-1",
        timeout=2.0,
        poll_interval_seconds=0.01,
        prepare_timeout_seconds=1.0,
    )


def test_health(adapter):
    out = adapter.health()
    assert out["service"] == "mirofish"


def test_create_prepare_and_state(adapter):
    created = adapter.create_simulation()
    assert created["data"]["simulation_id"] == "sim_001"

    prepared = adapter.prepare_simulation("sim_001")
    assert prepared["data"]["status"] == "preparing"

    status = adapter.poll_prepare_status("sim_001", task_id="task_001")
    assert status["data"]["already_prepared"] is True

    state = adapter.get_state("sim_001")
    assert state["data"]["status"] == "ready"
    assert len(state["data"]["drivers"]) == 2


def test_run_scenario_maps_state_tensor(adapter):
    out = adapter.run_scenario(
        name="integration",
        duration_minutes=15,
        request_rate_per_min=4.0,
        drivers_online=2,
        seed=42,
    )
    assert out["simulation_id"] == "sim_001"
    assert out["requests_simulated"] == 60
    assert out["state_tensor"]["version"] == "mirofish-adapter-v1"
    assert out["state_tensor"]["lockers"]["total"] == 2
    assert out["state_tensor"]["drivers"][0]["driverId"] == 1
    assert out["state_tensor"]["urgency"][0]["cruiseId"] == 9
    assert out["state_tensor"]["aggregates"]["requests_active"] == 1


def test_get_aggregates_uses_state_snapshot(adapter):
    adapter.run_scenario(
        name="integration-2",
        duration_minutes=10,
        request_rate_per_min=2.0,
        drivers_online=2,
    )
    out = adapter.get_aggregates()
    assert out["lockers_total"] == 2
    assert out["drivers_online"] == 2
