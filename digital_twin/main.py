"""
City2Cruise Digital Twin — FastAPI entry point.

Hito 5.4.1: stub funcional.
- /health, /state, /state/lockers, /state/drivers
- /sync (backend → twin) acepta SyncEvent y muta el store
- /scenario/run ejecuta una simulación sintética y devuelve métricas
"""
from __future__ import annotations

import asyncio
import os
import random
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from . import __version__
from .schemas import (
    ScenarioRequest,
    ScenarioResult,
    SyncEvent,
    TwinSnapshot,
)
from .state import get_store


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
    if req.seed is not None:
        random.seed(req.seed)

    store = get_store()
    drivers_pool = req.drivers_online
    expected_requests = int(req.duration_minutes * req.request_rate_per_min)

    completed = 0
    failed = 0
    match_times: list[float] = []

    for _ in range(expected_requests):
        if drivers_pool == 0:
            failed += 1
            continue
        match_t = random.expovariate(1 / 30.0)  # media 30s
        if match_t > 300:  # > 5 min se considera fallo
            failed += 1
        else:
            completed += 1
            match_times.append(match_t)

    match_times.sort()
    p95_idx = max(0, int(0.95 * len(match_times)) - 1)
    return ScenarioResult(
        name=req.name,
        duration_minutes=req.duration_minutes,
        requests_simulated=expected_requests,
        requests_completed=completed,
        requests_failed=failed,
        avg_match_seconds=round(sum(match_times) / max(1, len(match_times)), 1),
        p95_match_seconds=round(match_times[p95_idx] if match_times else 0.0, 1),
        final_aggregates=store.compute_aggregates(),
    )
