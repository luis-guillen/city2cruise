"""
Hito 5.4.2 — tests del bridge sim-to-real entre rl_service y digital_twin.
Sin servidor real: usamos httpx.MockTransport.
"""
import json

import httpx
import pytest

from rl_service.twin_bridge import TwinClient, train_with_twin_scenarios


def _mock_handler(request: httpx.Request) -> httpx.Response:
    if request.url.path == "/health":
        return httpx.Response(200, json={"status": "ok", "service": "twin"})
    if request.url.path == "/state":
        return httpx.Response(200, json={
            "timestamp": "2026-04-28T14:00:00Z",
            "env": "simulation",
            "lockers": [{"id": 1, "label": "L-01", "latitude": 28.1, "longitude": -15.4,
                         "status": "free", "occupancy_pct": 0,
                         "last_change_at": "2026-04-28T14:00:00Z"}],
            "drivers": [],
            "requests": [],
            "aggregates": {
                "lockers_total": 1, "lockers_free": 1, "lockers_occupied": 0,
                "lockers_out": 0, "drivers_total": 0, "drivers_online": 0,
                "drivers_available": 0, "requests_active": 0,
                "avg_match_seconds_15m": 0.0,
            },
        })
    if request.url.path == "/state/aggregates":
        return httpx.Response(200, json={"lockers_total": 1, "drivers_online": 0})
    if request.url.path == "/scenario/run":
        body = json.loads(request.content)
        return httpx.Response(200, json={
            "name": body["name"],
            "duration_minutes": body["duration_minutes"],
            "requests_simulated": 60,
            "requests_completed": 50,
            "requests_failed": 10,
            "avg_match_seconds": 28.5,
            "p95_match_seconds": 110.0,
            "final_aggregates": {
                "lockers_total": 1, "lockers_free": 1, "lockers_occupied": 0,
                "lockers_out": 0, "drivers_total": 0, "drivers_online": 0,
                "drivers_available": 0, "requests_active": 0,
                "avg_match_seconds_15m": 0.0,
            },
        })
    return httpx.Response(404)


@pytest.fixture
def patched_client(monkeypatch):
    """Sustituye httpx.Client por uno con MockTransport."""
    transport = httpx.MockTransport(_mock_handler)
    real_client = httpx.Client

    def patched(*args, **kwargs):
        kwargs["transport"] = transport
        return real_client(*args, **kwargs)

    monkeypatch.setattr("rl_service.twin_bridge.httpx.Client", patched)
    return transport


def test_health(patched_client):
    c = TwinClient(base_url="http://twin-mock")
    h = c.health()
    assert h["status"] == "ok"


def test_get_state(patched_client):
    c = TwinClient(base_url="http://twin-mock")
    s = c.get_state()
    assert s["env"] == "simulation"
    assert s["lockers"][0]["label"] == "L-01"


def test_run_scenario_returns_metrics(patched_client):
    c = TwinClient(base_url="http://twin-mock")
    r = c.run_scenario(name="test-1", duration_minutes=15, request_rate_per_min=4.0,
                      drivers_online=5, seed=42)
    assert r["requests_simulated"] == 60
    assert r["requests_completed"] == 50
    assert r["p95_match_seconds"] == 110.0


def test_train_with_twin_scenarios_aggregates(patched_client):
    """Stub agent: train() devuelve un dict simple."""
    class StubAgent:
        def train(self, total_timesteps):
            return {"timesteps": total_timesteps, "loss_final": 0.05}

    c = TwinClient(base_url="http://twin-mock")
    out = train_with_twin_scenarios(StubAgent(), twin=c, n_scenarios=3, minutes_per_scenario=10)
    assert out["n_scenarios"] == 3
    assert out["total_simulated_requests"] == 60 * 3
    assert out["train_timesteps"] >= 2000
    assert "loss_final" in out["train_metrics"]


def test_train_skips_if_no_train_method(patched_client):
    c = TwinClient(base_url="http://twin-mock")
    out = train_with_twin_scenarios(object(), twin=c, n_scenarios=1)
    assert out["train_metrics"]["skipped"] is True
