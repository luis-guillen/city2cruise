from __future__ import annotations

import os
import time
from typing import Any, Optional

import httpx

from .twin_mirofish_adapter import MiroFishTwinAdapter


DEFAULT_TWIN_URL = os.environ.get("TWIN_URL", "http://localhost:8090")


def _current_provider(provider: Optional[str] = None) -> str:
    return (provider or os.environ.get("TWIN_PROVIDER", "internal")).strip().lower()


def _current_base_url(provider: str, base_url: Optional[str]) -> str:
    if provider == "mirofish":
        return (
            base_url
            or os.environ.get("MIROFISH_BASE_URL")
            or DEFAULT_TWIN_URL
        ).rstrip("/")
    return (base_url or DEFAULT_TWIN_URL).rstrip("/")


class TwinClient:
    """Facade that switches between the internal twin and MiroFish."""

    def __init__(
        self,
        base_url: Optional[str] = None,
        timeout: float = 10.0,
        provider: Optional[str] = None,
    ) -> None:
        provider_name = _current_provider(provider)
        resolved_base_url = _current_base_url(provider_name, base_url)

        if provider_name == "mirofish":
            self._impl = MiroFishTwinAdapter(
                base_url=resolved_base_url,
                api_key=os.environ.get("MIROFISH_API_KEY"),
                project_id=os.environ.get("MIROFISH_PROJECT_ID"),
                graph_id=os.environ.get("MIROFISH_GRAPH_ID"),
                timeout=timeout,
            )
        else:
            self._impl = _InternalTwinClient(
                base_url=resolved_base_url,
                timeout=timeout,
            )

    def health(self) -> dict[str, Any]:
        return self._impl.health()

    def get_state(self, simulation_id: Optional[str] = None) -> dict[str, Any]:
        return self._impl.get_state(simulation_id=simulation_id)

    def get_aggregates(self, simulation_id: Optional[str] = None) -> dict[str, Any]:
        return self._impl.get_aggregates(simulation_id=simulation_id)

    def run_scenario(
        self,
        name: str,
        duration_minutes: int = 60,
        request_rate_per_min: float = 2.0,
        drivers_online: int = 10,
        seed: Optional[int] = None,
    ) -> dict[str, Any]:
        return self._impl.run_scenario(
            name=name,
            duration_minutes=duration_minutes,
            request_rate_per_min=request_rate_per_min,
            drivers_online=drivers_online,
            seed=seed,
        )


class _InternalTwinClient:
    def __init__(self, base_url: str, timeout: float = 10.0) -> None:
        self.base_url = base_url.rstrip("/")
        self._timeout = timeout

    def health(self) -> dict[str, Any]:
        with httpx.Client(timeout=self._timeout) as c:
            r = c.get(f"{self.base_url}/health")
            r.raise_for_status()
            return r.json()

    def get_state(self, simulation_id: Optional[str] = None) -> dict[str, Any]:
        del simulation_id
        with httpx.Client(timeout=self._timeout) as c:
            r = c.get(f"{self.base_url}/state")
            r.raise_for_status()
            return r.json()

    def get_aggregates(self, simulation_id: Optional[str] = None) -> dict[str, Any]:
        del simulation_id
        with httpx.Client(timeout=self._timeout) as c:
            r = c.get(f"{self.base_url}/state/aggregates")
            r.raise_for_status()
            return r.json()

    def run_scenario(
        self,
        name: str,
        duration_minutes: int = 60,
        request_rate_per_min: float = 2.0,
        drivers_online: int = 10,
        seed: Optional[int] = None,
    ) -> dict[str, Any]:
        body = {
            "name": name,
            "duration_minutes": duration_minutes,
            "request_rate_per_min": request_rate_per_min,
            "drivers_online": drivers_online,
        }
        if seed is not None:
            body["seed"] = seed
        with httpx.Client(timeout=self._timeout * 3) as c:
            r = c.post(f"{self.base_url}/scenario/run", json=body)
            r.raise_for_status()
            return r.json()


def train_with_twin_scenarios(
    agent: Any,
    twin: Optional[TwinClient] = None,
    n_scenarios: int = 5,
    minutes_per_scenario: int = 30,
    drivers_online: int = 10,
    request_rate: float = 2.0,
) -> dict[str, Any]:
    """
    Train the agent on N twin scenarios and return a reproducible summary.
    """
    twin = twin or TwinClient()
    started_at = time.time()
    scenario_results: list[dict[str, Any]] = []

    for i in range(n_scenarios):
        result = twin.run_scenario(
            name=f"sim2real-{i}",
            duration_minutes=minutes_per_scenario,
            request_rate_per_min=request_rate,
            drivers_online=drivers_online,
            seed=42 + i,
        )
        scenario_results.append(result)

    total_requests = sum(r["requests_simulated"] for r in scenario_results)
    timesteps = max(2_000, total_requests * 100)

    train_metrics = agent.train(total_timesteps=timesteps) if hasattr(agent, "train") else {
        "skipped": True,
        "reason": "agent.train not callable",
    }

    return {
        "elapsed_seconds": round(time.time() - started_at, 2),
        "n_scenarios": n_scenarios,
        "total_simulated_requests": total_requests,
        "train_timesteps": timesteps,
        "train_metrics": train_metrics,
        "scenarios": scenario_results,
    }
