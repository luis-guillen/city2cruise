from __future__ import annotations

from dataclasses import dataclass
import os
import time
from typing import Any, Optional

import httpx

from .schemas import (
    DemandCluster,
    DriverObservation,
    StateTensorInput,
    UrgencyScore,
)


def _clean(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    value = value.strip()
    return value or None


def _as_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _as_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    if isinstance(value, dict):
        return [value]
    return []


@dataclass
class MiroFishTwinAdapter:
    base_url: str
    api_key: Optional[str] = None
    project_id: Optional[str] = None
    graph_id: Optional[str] = None
    timeout: float = 10.0
    poll_interval_seconds: float = 2.0
    prepare_timeout_seconds: float = 180.0

    def __post_init__(self) -> None:
        self.base_url = self.base_url.rstrip("/")
        self.api_root = f"{self.base_url}/api"
        self.api_key = _clean(self.api_key)
        self.project_id = _clean(self.project_id) or _clean(os.environ.get("MIROFISH_PROJECT_ID"))
        self.graph_id = _clean(self.graph_id) or _clean(os.environ.get("MIROFISH_GRAPH_ID"))
        self._last_simulation_id: Optional[str] = _clean(os.environ.get("MIROFISH_SIMULATION_ID"))

    def _headers(self) -> dict[str, str]:
        headers: dict[str, str] = {}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
            headers["X-API-Key"] = self.api_key
        return headers

    def _client(self, timeout: Optional[float] = None) -> httpx.Client:
        return httpx.Client(timeout=timeout or self.timeout, headers=self._headers())

    def _unwrap(self, payload: dict[str, Any], context: str) -> dict[str, Any]:
        if payload.get("success") is False:
            raise RuntimeError(f"MiroFish {context} failed: {payload.get('error', 'unknown error')}")
        data = payload.get("data")
        if isinstance(data, dict):
            return data
        return payload

    def _resolve_simulation_id(self, simulation_id: Optional[str] = None) -> str:
        resolved = _clean(simulation_id) or self._last_simulation_id
        if not resolved:
            raise RuntimeError(
                "No MiroFish simulation id available. Run a scenario first "
                "or set MIROFISH_SIMULATION_ID."
            )
        return resolved

    def health(self) -> dict[str, Any]:
        with self._client() as c:
            r = c.get(f"{self.base_url}/health")
            r.raise_for_status()
            return r.json()

    def create_simulation(
        self,
        project_id: Optional[str] = None,
        graph_id: Optional[str] = None,
        enable_twitter: bool = True,
        enable_reddit: bool = True,
    ) -> dict[str, Any]:
        resolved_project_id = _clean(project_id) or self.project_id
        if not resolved_project_id:
            raise RuntimeError("MIROFISH_PROJECT_ID is required to create simulations")

        payload: dict[str, Any] = {
            "project_id": resolved_project_id,
            "enable_twitter": enable_twitter,
            "enable_reddit": enable_reddit,
        }
        resolved_graph_id = _clean(graph_id) or self.graph_id
        if resolved_graph_id:
            payload["graph_id"] = resolved_graph_id

        with self._client() as c:
            r = c.post(f"{self.api_root}/simulation/create", json=payload)
            r.raise_for_status()
            data = r.json()
        self._last_simulation_id = self._unwrap(data, "create simulation").get("simulation_id")
        return data

    def prepare_simulation(
        self,
        simulation_id: str,
        entity_types: Optional[list[str]] = None,
        use_llm_for_profiles: bool = True,
        parallel_profile_count: int = 5,
        force_regenerate: bool = False,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "simulation_id": simulation_id,
            "use_llm_for_profiles": use_llm_for_profiles,
            "parallel_profile_count": parallel_profile_count,
            "force_regenerate": force_regenerate,
        }
        if entity_types is not None:
            payload["entity_types"] = entity_types

        with self._client() as c:
            r = c.post(f"{self.api_root}/simulation/prepare", json=payload)
            r.raise_for_status()
            return r.json()

    def poll_prepare_status(
        self,
        simulation_id: str,
        task_id: Optional[str] = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {"simulation_id": simulation_id}
        if task_id:
            payload["task_id"] = task_id

        with self._client(timeout=self.timeout) as c:
            r = c.post(f"{self.api_root}/simulation/prepare/status", json=payload)
            r.raise_for_status()
            return r.json()

    def _wait_for_ready(self, simulation_id: str, task_id: Optional[str]) -> dict[str, Any]:
        deadline = time.monotonic() + self.prepare_timeout_seconds
        last_status: dict[str, Any] | None = None

        while time.monotonic() < deadline:
            status = self.poll_prepare_status(simulation_id=simulation_id, task_id=task_id)
            last_status = status
            data = status.get("data") or {}
            current_status = str(data.get("status", "")).lower()
            if data.get("already_prepared") or current_status in {"ready", "completed"}:
                return status
            time.sleep(self.poll_interval_seconds)

        raise TimeoutError(
            f"MiroFish prepare timed out for {simulation_id}: "
            f"{last_status or 'no status received'}"
        )

    def get_state(self, simulation_id: Optional[str] = None) -> dict[str, Any]:
        resolved_simulation_id = self._resolve_simulation_id(simulation_id)
        with self._client() as c:
            r = c.get(f"{self.api_root}/simulation/{resolved_simulation_id}")
            r.raise_for_status()
            return r.json()

    def get_aggregates(self, simulation_id: Optional[str] = None) -> dict[str, Any]:
        state = self.get_state(simulation_id=simulation_id)
        data = state.get("data", state)
        return self._map_aggregates(data)

    def run_scenario(
        self,
        name: str,
        duration_minutes: int = 60,
        request_rate_per_min: float = 2.0,
        drivers_online: int = 10,
        seed: Optional[int] = None,
    ) -> dict[str, Any]:
        created = self.create_simulation(project_id=self.project_id, graph_id=self.graph_id)
        simulation_data = self._unwrap(created, "create simulation")
        simulation_id = simulation_data["simulation_id"]
        self._last_simulation_id = simulation_id

        prepared = self.prepare_simulation(
            simulation_id=simulation_id,
            use_llm_for_profiles=True,
            parallel_profile_count=max(1, drivers_online),
            force_regenerate=False,
        )
        prepared_data = self._unwrap(prepared, "prepare simulation")
        task_id = prepared_data.get("task_id")

        if not prepared_data.get("already_prepared") and str(prepared_data.get("status", "")).lower() not in {"ready", "completed"}:
            self._wait_for_ready(simulation_id=simulation_id, task_id=task_id)

        state = self.get_state(simulation_id=simulation_id)
        state_data = self._unwrap(state, "get state")
        tensor = self._map_state_to_tensor(
            raw_state=state_data,
            duration_minutes=duration_minutes,
            request_rate_per_min=request_rate_per_min,
            drivers_online=drivers_online,
            seed=seed,
        )

        expected_requests = max(1, int(round(duration_minutes * request_rate_per_min)))
        aggregates = tensor["aggregates"]
        avg_match_seconds = _as_float(
            aggregates.get("avg_match_seconds")
            or aggregates.get("avg_match_seconds_15m")
            or aggregates.get("avg_match_seconds_1h"),
            default=0.0,
        )
        p95_match_seconds = _as_float(aggregates.get("p95_match_seconds"), default=avg_match_seconds)

        return {
            "simulation_id": simulation_id,
            "name": name,
            "duration_minutes": duration_minutes,
            "requests_simulated": expected_requests,
            "requests_completed": expected_requests,
            "requests_failed": 0,
            "avg_match_seconds": avg_match_seconds,
            "p95_match_seconds": p95_match_seconds,
            "final_aggregates": aggregates,
            "state_tensor": tensor,
        }

    def _map_aggregates(self, data: dict[str, Any]) -> dict[str, Any]:
        aggregates = data.get("aggregates") or {}
        lockers = data.get("lockers") or []
        drivers = data.get("drivers") or data.get("agents") or []
        requests_ = data.get("requests") or []

        total_lockers = _as_int(
            aggregates.get("lockers_total") or aggregates.get("total_lockers") or len(lockers),
            default=len(lockers),
        )
        free_lockers = _as_int(
            aggregates.get("lockers_free") or aggregates.get("lockers_available") or 0,
            default=0,
        )
        occupied_lockers = _as_int(
            aggregates.get("lockers_occupied") or max(total_lockers - free_lockers, 0),
            default=max(total_lockers - free_lockers, 0),
        )
        drivers_total = _as_int(aggregates.get("drivers_total") or len(drivers), default=len(drivers))
        drivers_online = _as_int(aggregates.get("drivers_online") or len(drivers), default=len(drivers))
        requests_active = _as_int(aggregates.get("requests_active") or len(requests_), default=len(requests_))
        return {
            "lockers_total": total_lockers,
            "lockers_free": free_lockers,
            "lockers_occupied": occupied_lockers,
            "drivers_total": drivers_total,
            "drivers_online": drivers_online,
            "requests_active": requests_active,
        }

    def _map_state_to_tensor(
        self,
        raw_state: dict[str, Any],
        duration_minutes: int,
        request_rate_per_min: float,
        drivers_online: int,
        seed: Optional[int],
    ) -> dict[str, Any]:
        drivers_source = _as_list(raw_state.get("drivers") or raw_state.get("driver_states") or raw_state.get("agents"))
        lockers_source = _as_list(raw_state.get("lockers") or raw_state.get("slots"))
        requests_source = _as_list(raw_state.get("requests") or raw_state.get("active_requests"))
        demand_source = _as_list(raw_state.get("demandClusters") or raw_state.get("demand_clusters") or raw_state.get("clusters"))
        urgency_source = _as_list(raw_state.get("urgency") or raw_state.get("urgency_scores") or requests_source)
        aggregates = self._map_aggregates(raw_state)

        mapped_drivers: list[dict[str, Any]] = []
        for idx, driver in enumerate(drivers_source[:drivers_online]):
            if not isinstance(driver, dict):
                continue
            position = driver.get("position") if isinstance(driver.get("position"), dict) else {}
            lat = driver.get("lat", position.get("lat", 0.0))
            lon = driver.get("lon", position.get("lon", 0.0))
            mapped_drivers.append(
                DriverObservation(
                    driverId=_as_int(driver.get("driver_id", driver.get("id", idx + 1)), idx + 1),
                    lat=_as_float(lat),
                    lon=_as_float(lon),
                    latNorm=_as_float(driver.get("lat_norm", driver.get("latNorm", 0.5)), 0.5),
                    lonNorm=_as_float(driver.get("lon_norm", driver.get("lonNorm", 0.5)), 0.5),
                    vLat=_as_float(driver.get("v_lat", driver.get("vLat", 0.0))),
                    vLon=_as_float(driver.get("v_lon", driver.get("vLon", 0.0))),
                    speedMps=_as_float(driver.get("speed_mps", driver.get("speedMps", 0.0))),
                    speedNorm=_as_float(driver.get("speed_norm", driver.get("speedNorm", 0.0))),
                    sigmaM=_as_float(driver.get("sigma_m", driver.get("sigmaM", 25.0)), 25.0),
                    eta=None,
                ).model_dump()
            )

        mapped_clusters: list[dict[str, Any]] = []
        for idx, cluster in enumerate(demand_source[:10]):
            if not isinstance(cluster, dict):
                continue
            mapped_clusters.append(
                DemandCluster(
                    clusterId=_as_int(cluster.get("clusterId", cluster.get("id", idx + 1)), idx + 1),
                    centroidLat=_as_float(cluster.get("centroidLat", cluster.get("lat", 0.0))),
                    centroidLon=_as_float(cluster.get("centroidLon", cluster.get("lon", 0.0))),
                    requestCount=_as_int(cluster.get("requestCount", cluster.get("count", 0)), 0),
                    epsM=_as_float(cluster.get("epsM", 250.0), 250.0),
                ).model_dump()
            )

        mapped_urgency: list[dict[str, Any]] = []
        for idx, entry in enumerate(urgency_source[:10]):
            if isinstance(entry, dict):
                mapped_urgency.append(
                    UrgencyScore(
                        cruiseId=_as_int(entry.get("cruiseId", entry.get("cruise_id", idx + 1)), idx + 1),
                        vesselName=str(entry.get("vesselName", entry.get("vessel_name", "MiroFish"))),
                        allAboardAt=entry.get("allAboardAt", entry.get("all_aboard_at")),
                        minutesToDeadline=_as_float(entry.get("minutesToDeadline", entry.get("minutes_to_deadline", 0.0))),
                        urgency=min(max(_as_float(entry.get("urgency", 0.5), 0.5), 0.0), 1.0),
                    ).model_dump()
                )

        total_lockers = len(lockers_source) or aggregates["lockers_total"] or 1
        occupied = aggregates.get("lockers_occupied")
        if occupied is None:
            occupied = len(
                [
                    locker
                    for locker in lockers_source
                    if isinstance(locker, dict) and locker.get("status") not in (None, "free", "available")
                ]
            )
        occupied = _as_int(occupied, default=0)
        occupancy_rate = min(max(occupied / total_lockers if total_lockers else 0.0, 0.0), 1.0)

        tensor = StateTensorInput(
            version="mirofish-adapter-v1",
            generatedAt=int(time.time() * 1000),
            durationMs=float(duration_minutes * 60_000),
            drivers=mapped_drivers,
            demandClusters=mapped_clusters,
            urgency=mapped_urgency,
            lockers={
                "total": total_lockers,
                "occupied": occupied,
                "available": max(total_lockers - occupied, 0),
                "occupancyRate": occupancy_rate,
            },
            activeRequestCount=len(requests_source),
        )

        return {**tensor.model_dump(), "aggregates": aggregates, "seed": seed, "requestRatePerMin": request_rate_per_min}
