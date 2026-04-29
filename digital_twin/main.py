"""
City2Cruise Digital Twin — FastAPI entry point.

Hito 5.4.1: stub funcional.
- /health, /state, /state/lockers, /state/drivers
- /sync (backend → twin) acepta SyncEvent y muta el store
- /scenario/run ejecuta una simulación sintética y devuelve métricas
"""
from __future__ import annotations

import asyncio
import json
import os
import random
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from . import __version__
from .cruise_schedule import (
    InvalidScenarioPathError,
    active_at,
    load_manifest,
    resolve_manifest_path,
)
from .schemas import (
    ScenarioRequest,
    ScenarioResult,
    SyncEvent,
    TwinSnapshot,
)
from .state import get_store
from .traffic import traffic_multiplier


@asynccontextmanager
async def lifespan(_app: FastAPI):
    print(f"[twin] starting v{__version__} env={os.environ.get('TWIN_ENV', 'simulation')}")
    yield
    print("[twin] shutdown")


app = FastAPI(
    title="City2Cruise Digital Twin",
    version=__version__,
    description="Réplica virtual del sistema City2Cruise (Hito 5.4.1)",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("TWIN_CORS_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ──────────────────────────────────────────────────────────────────────────
# Health
# ──────────────────────────────────────────────────────────────────────────

@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "service": "city2cruise-twin",
        "version": __version__,
        "env": os.environ.get("TWIN_ENV", "simulation"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# ──────────────────────────────────────────────────────────────────────────
# Snapshots
# ──────────────────────────────────────────────────────────────────────────

@app.get("/state", response_model=TwinSnapshot)
def state():
    return get_store().snapshot()


@app.get("/state/lockers")
def state_lockers():
    s = get_store()
    return {"lockers": [l.model_dump() for l in s.lockers.values()], "count": len(s.lockers)}


@app.get("/state/drivers")
def state_drivers():
    s = get_store()
    return {"drivers": [d.model_dump() for d in s.drivers.values()], "count": len(s.drivers)}


@app.get("/state/aggregates")
def state_aggregates():
    return get_store().compute_aggregates().model_dump()


# ──────────────────────────────────────────────────────────────────────────
# Sync (backend → twin)
# ──────────────────────────────────────────────────────────────────────────

@app.post("/sync", status_code=202)
async def sync(event: SyncEvent):
    try:
        await get_store().apply_event(event)
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=f"Missing payload field: {exc}") from exc
    return {"accepted": True, "event_type": event.event_type}


# ──────────────────────────────────────────────────────────────────────────
# Simulación sintética (Hito 5.4.1 — stub)
# ──────────────────────────────────────────────────────────────────────────

@app.post("/scenario/run", response_model=ScenarioResult)
async def scenario_run(req: ScenarioRequest):
    """
    Ejecuta una simulación poisson de demanda contra el estado actual del
    twin. No muta el store; devuelve métricas.

    Implementación de stub: muy simplificada. Cada request "elige" un
    driver random disponible y el match time se modela como exponencial.
    """
    rng = random.Random(req.seed)

    store = get_store()
    drivers_pool = req.drivers_online
    effective_duration_minutes = req.duration_minutes
    expected_requests = int(effective_duration_minutes * req.request_rate_per_min)
    scenario_anchor = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    manifest: list[dict] = []

    try:
        if req.scenario_file:
            manifest = load_manifest(req.scenario_file)
            if manifest:
                first_arrival = min(
                    datetime.fromisoformat(c["scheduled_arrival"].replace("Z", "+00:00"))
                    for c in manifest
                )
                scenario_anchor = first_arrival

            scenario_path = resolve_manifest_path(req.scenario_file)
            scenario_payload = _load_scenario_metadata(scenario_path)
            drivers_pool = int(scenario_payload.get("drivers", drivers_pool))
            if "duration_hours" in scenario_payload and req.duration_minutes == ScenarioRequest.model_fields["duration_minutes"].default:
                effective_duration_minutes = int(float(scenario_payload["duration_hours"]) * 60)
                expected_requests = int(effective_duration_minutes * req.request_rate_per_min)
    except InvalidScenarioPathError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"Scenario fixture not found: {req.scenario_file}") from exc
    except (KeyError, ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=400, detail=f"Invalid scenario fixture: {req.scenario_file}") from exc

    completed = 0
    failed = 0
    match_times: list[float] = []

    for request_idx in range(expected_requests):
        if drivers_pool == 0:
            failed += 1
            continue

        minute_offset = request_idx / max(req.request_rate_per_min, 1e-6)
        current_time = scenario_anchor + timedelta(minutes=minute_offset)
        traffic_factor = traffic_multiplier(current_time.hour, current_time.weekday())
        active_cruises = active_at(manifest, current_time) if manifest else []
        cruise_pressure = _cruise_pressure_multiplier(active_cruises)

        match_t = rng.expovariate(1 / 30.0) * traffic_factor * cruise_pressure
        if match_t > 300:  # > 5 min se considera fallo
            failed += 1
        else:
            completed += 1
            match_times.append(match_t)

    match_times.sort()
    p95_idx = max(0, int(0.95 * len(match_times)) - 1)
    return ScenarioResult(
        name=req.name,
        duration_minutes=effective_duration_minutes,
        requests_simulated=expected_requests,
        requests_completed=completed,
        requests_failed=failed,
        avg_match_seconds=round(sum(match_times) / max(1, len(match_times)), 1),
        p95_match_seconds=round(match_times[p95_idx] if match_times else 0.0, 1),
        final_aggregates=store.compute_aggregates(),
    )


def _load_scenario_metadata(path: Path) -> dict:
    return json.loads(path.read_text())


def _cruise_pressure_multiplier(active_cruises: list[dict]) -> float:
    if not active_cruises:
        return 1.0

    total_capacity = sum(int(c.get("capacity", 0)) for c in active_cruises)
    # 2k pax ~ +5% pressure, capped to avoid runaway times.
    return min(1.35, 1.0 + (total_capacity / 2000.0) * 0.05)
