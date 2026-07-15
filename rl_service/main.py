"""
CruiseDispatch RL microservice — FastAPI entry point.

Endpoints
─────────
GET  /health                 Liveness probe
GET  /metrics                Model metadata and training stats
POST /assign                 Rank drivers for a given state tensor (main inference)
POST /train                  Trigger a training run (async background task)

Run
───
uvicorn rl_service.main:app --host 0.0.0.0 --port 8080 --workers 1

Environment variables
─────────────────────
RL_MODEL_PATH   Path prefix for the .zip checkpoint (default: rl_service/artifacts/cruise_dispatch_ppo)
BACKEND_URL     Backend base URL for pulling state tensors (default: http://localhost:9000)
INTERNAL_KEY    X-Internal-Key for backend /api/internal endpoints
"""

from __future__ import annotations

import time
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException, BackgroundTasks, Response
from fastapi.middleware.cors import CORSMiddleware

from .agent import RLAgent
from . import observability as obs
from .twin_bridge import TwinClient, train_with_twin_scenarios
from .schemas import (
    AssignRequest,
    AssignResponse,
    TrainRequest,
    TrainResponse,
    SnapshotMeta,
)

# ─── App lifecycle ────────────────────────────────────────────────────────────

_agent: Optional[RLAgent] = None
_is_training = False


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _agent
    print("[main] Loading RL agent...")
    _agent = RLAgent()
    meta = _agent.metadata()
    obs.set_model_info(meta["modelVersion"], meta.get("totalTimesteps"))
    print("[main] Agent ready")
    yield
    print("[main] Shutting down")


app = FastAPI(
    title="CruiseDispatch RL Service",
    description="PPO-based driver-dispatch microservice for City2Cruise (Sprint 3.E)",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # restrict in production to backend origin
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


# ─── Dependency ───────────────────────────────────────────────────────────────

def get_agent() -> RLAgent:
    if _agent is None:
        raise HTTPException(status_code=503, detail="Agent not initialised")
    return _agent


# ─── Routes ───────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    agent = get_agent()
    return {
        "status": "ok",
        "modelVersion": agent.MODEL_VERSION,
        "modelReady": True,
    }


@app.get("/metrics", response_model=SnapshotMeta)
async def metrics():
    meta = get_agent().metadata()
    return SnapshotMeta(
        totalTimesteps=meta["totalTimesteps"],
        modelVersion=meta["modelVersion"],
        lastTrainedAt=meta["lastTrainedAt"],
    )


@app.get("/metrics/prometheus")
async def metrics_prometheus():
    """Model-serving metrics in Prometheus text format (scraped by Prometheus)."""
    data, content_type = obs.prometheus_latest()
    return Response(content=data, media_type=content_type)


@app.post("/assign", response_model=AssignResponse)
async def assign(body: AssignRequest):
    """
    Rank available drivers for the most urgent pending request in the state tensor.
    Returns drivers sorted by RL confidence score (descending).
    Inference is synchronous and designed to complete in < 20 ms.
    """
    t0 = time.monotonic()
    agent = get_agent()

    rankings = agent.get_rankings(body.state)

    inference_s = time.monotonic() - t0
    obs.record_inference(inference_s, rankings)
    inference_ms = inference_s * 1000
    return AssignResponse(
        requestId=body.requestId,
        rankings=rankings,
        modelVersion=agent.MODEL_VERSION,
        inferenceMs=round(inference_ms, 2),
    )


@app.post("/train", response_model=TrainResponse)
async def train(body: TrainRequest, background_tasks: BackgroundTasks):
    """
    Trigger a PPO training run in the background.
    Only one training run executes at a time; subsequent calls queue.
    """
    global _is_training
    agent = get_agent()

    if _is_training:
        raise HTTPException(status_code=409, detail="Training already in progress")

    async def _run():
        global _is_training
        _is_training = True
        try:
            agent.train(total_timesteps=body.timesteps)
        finally:
            _is_training = False

    background_tasks.add_task(_run)

    return TrainResponse(
        status="training_started",
        timesteps=body.timesteps,
    )


# ─── Hito 5.4.2 — Sim-to-Real con Digital Twin ──────────────────────────────

@app.post("/train_from_twin")
async def train_from_twin(
    n_scenarios: int = 5,
    minutes_per_scenario: int = 30,
    drivers_online: int = 10,
    request_rate_per_min: float = 2.0,
    background_tasks: BackgroundTasks = None,
):
    """
    Hito 5.4.2 — Pipeline sim-to-real.
    Ejecuta N escenarios sintéticos en el Digital Twin y dispara un train()
    del agente con timesteps proporcionales al volumen simulado.

    Devuelve un resumen sincrónico del run (escenarios + timesteps);
    el train del modelo corre en background si tarda mucho.
    """
    global _is_training
    agent = get_agent()

    if _is_training:
        raise HTTPException(status_code=409, detail="Training already in progress")

    twin = TwinClient()
    try:
        twin.health()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Twin no accesible: {exc}") from exc

    _is_training = True
    try:
        result = train_with_twin_scenarios(
            agent=agent,
            twin=twin,
            n_scenarios=n_scenarios,
            minutes_per_scenario=minutes_per_scenario,
            drivers_online=drivers_online,
            request_rate=request_rate_per_min,
        )
    finally:
        _is_training = False

    return result
