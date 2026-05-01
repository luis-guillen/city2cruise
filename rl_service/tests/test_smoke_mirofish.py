from __future__ import annotations

import json
from pathlib import Path

import httpx

from scripts.smoke_mirofish import run_smoke_check


class SmokeBootstrapHandler:
    def __init__(self) -> None:
        self.task_calls = 0

    def _handler(self, request: httpx.Request) -> httpx.Response:
        if request.url.path == "/health":
            return httpx.Response(200, json={"status": "ok", "service": "mirofish"})

        if request.url.path == "/api/graph/build":
            body = json.loads(request.content)
            assert body["project_id"].startswith("proj_")
            return httpx.Response(200, json={"success": True, "data": {"task_id": "task-bootstrap"}})

        if request.url.path == "/api/graph/task/task-bootstrap":
            self.task_calls += 1
            if self.task_calls == 1:
                return httpx.Response(200, json={"success": True, "data": {"status": "processing", "progress": 55}})
            return httpx.Response(200, json={"success": True, "data": {"status": "completed", "result": {"graph_id": "graph-bootstrap"}}})

        if request.url.path == "/api/simulation/create":
            body = json.loads(request.content)
            assert body["graph_id"] == "graph-bootstrap"
            return httpx.Response(200, json={"success": True, "data": {"simulation_id": "sim_001"}})

        if request.url.path == "/api/simulation/prepare":
            body = json.loads(request.content)
            assert body["simulation_id"] == "sim_001"
            return httpx.Response(200, json={"success": True, "data": {"simulation_id": "sim_001", "status": "preparing", "task_id": "prepare-task"}})

        if request.url.path == "/api/simulation/prepare/status":
            return httpx.Response(200, json={"success": True, "data": {"simulation_id": "sim_001", "status": "ready", "already_prepared": True}})

        if request.url.path == "/api/simulation/sim_001":
            return httpx.Response(200, json={
                "success": True,
                "data": {
                    "simulation_id": "sim_001",
                    "drivers": [{"driver_id": 1, "lat": 28.1, "lon": -15.4}],
                    "lockers": [{"id": 1, "status": "occupied"}],
                    "requests": [{"cruise_id": 7, "minutes_to_deadline": 20, "urgency": 0.9}],
                    "aggregates": {"lockers_total": 1, "lockers_occupied": 1, "drivers_total": 1, "drivers_online": 1, "requests_active": 1},
                },
            })

        raise AssertionError(f"Unexpected path: {request.url.path}")


def test_run_smoke_check(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/health":
            return httpx.Response(200, json={"status": "ok", "service": "mirofish"})

        if request.url.path == "/api/simulation/create":
            body = json.loads(request.content)
            assert body["project_id"] == "proj-1"
            assert body["graph_id"] == "graph-1"
            return httpx.Response(200, json={"success": True, "data": {"simulation_id": "sim_001"}})

        if request.url.path == "/api/simulation/prepare":
            body = json.loads(request.content)
            assert body["simulation_id"] == "sim_001"
            return httpx.Response(200, json={"success": True, "data": {"simulation_id": "sim_001", "status": "preparing"}})

        if request.url.path == "/api/simulation/prepare/status":
            return httpx.Response(200, json={"success": True, "data": {"simulation_id": "sim_001", "status": "ready", "already_prepared": True}})

        if request.url.path == "/api/simulation/sim_001":
            return httpx.Response(200, json={
                "success": True,
                "data": {
                    "simulation_id": "sim_001",
                    "drivers": [{"driver_id": 1, "lat": 28.1, "lon": -15.4}],
                    "lockers": [{"id": 1, "status": "occupied"}],
                    "requests": [{"cruise_id": 7, "minutes_to_deadline": 20, "urgency": 0.9}],
                    "aggregates": {"lockers_total": 1, "lockers_occupied": 1, "drivers_total": 1, "drivers_online": 1, "requests_active": 1},
                },
            })

        raise AssertionError(f"Unexpected path: {request.url.path}")

    transport = httpx.MockTransport(handler)
    real_client = httpx.Client

    def patched(*args, **kwargs):
        kwargs["transport"] = transport
        return real_client(*args, **kwargs)

    monkeypatch.setattr("rl_service.twin_mirofish_adapter.httpx.Client", patched)

    result = run_smoke_check(
        base_url="http://mirofish.local",
        project_id="proj-1",
        graph_id="graph-1",
        api_key="test-key",
        duration_minutes=5,
        request_rate_per_min=2.0,
        drivers_online=1,
        timeout=2.0,
        poll_interval_seconds=0.01,
        prepare_timeout_seconds=1.0,
    )

    assert result["health"]["status"] == "ok"
    assert result["created"]["data"]["simulation_id"] == "sim_001"
    assert result["scenario"]["simulation_id"] == "sim_001"
    assert result["scenario"]["state_tensor"]["version"] == "mirofish-adapter-v1"
    assert result["scenario"]["state_tensor"]["lockers"]["occupied"] == 1


def test_run_smoke_check_bootstrap(monkeypatch, tmp_path):
    handler = SmokeBootstrapHandler()
    transport = httpx.MockTransport(handler._handler)
    real_client = httpx.Client

    def patched(*args, **kwargs):
        kwargs["transport"] = transport
        return real_client(*args, **kwargs)

    monkeypatch.setattr("scripts.smoke_mirofish.httpx.Client", patched)
    monkeypatch.setattr("rl_service.twin_mirofish_adapter.httpx.Client", patched)

    bootstrap_root = tmp_path / "projects"
    result = run_smoke_check(
        base_url="http://mirofish.local",
        project_id=None,
        graph_id=None,
        api_key="test-key",
        bootstrap=True,
        bootstrap_root=str(bootstrap_root),
        timeout=2.0,
        poll_interval_seconds=0.01,
        prepare_timeout_seconds=1.0,
    )

    project_dirs = list(bootstrap_root.iterdir())
    assert len(project_dirs) == 1
    project_json = project_dirs[0] / "project.json"
    assert project_json.exists()
    assert result["scenario"]["state_tensor"]["version"] == "mirofish-adapter-v1"
    assert result["scenario"]["simulation_id"] == "sim_001"
