"""Pydantic schemas — contrato I/O del Digital Twin."""
from __future__ import annotations
from datetime import datetime
from enum import Enum
from typing import Literal, Optional
from pydantic import BaseModel, Field


class LockerStatus(str, Enum):
    free = "free"
    reserved = "reserved"
    occupied = "occupied"
    out_of_service = "out_of_service"


class DriverStatus(str, Enum):
    offline = "offline"
    available = "available"
    busy = "busy"
    breaking = "breaking"


class RequestPhase(str, Enum):
    requested = "requested"
    assigned = "assigned"
    in_progress = "in_progress"
    deposited = "deposited"
    completed = "completed"
    cancelled = "cancelled"


# ──────────────────────────────────────────────────────────────────────────
# Entidades del gemelo
# ──────────────────────────────────────────────────────────────────────────

class LockerState(BaseModel):
    id: int
    label: str
    latitude: float
    longitude: float
    status: LockerStatus
    occupancy_pct: float = Field(ge=0, le=100, default=0)
    last_change_at: datetime


class DriverState(BaseModel):
    id: int
    name: str
    latitude: float
    longitude: float
    status: DriverStatus
    current_request_id: Optional[int] = None
    last_seen_at: datetime


class RequestState(BaseModel):
    id: int
    client_id: int
    locker_id: Optional[int] = None
    driver_id: Optional[int] = None
    phase: RequestPhase
    created_at: datetime
    last_event_at: datetime


class TwinSnapshot(BaseModel):
    timestamp: datetime
    env: Literal["dev", "staging", "production", "simulation"]
    lockers: list[LockerState]
    drivers: list[DriverState]
    requests: list[RequestState]
    aggregates: "Aggregates"


class Aggregates(BaseModel):
    """Métricas derivadas listas para Grafana / Torre de Control."""
    lockers_total: int
    lockers_free: int
    lockers_occupied: int
    lockers_out: int
    drivers_total: int
    drivers_online: int
    drivers_available: int
    requests_active: int
    avg_match_seconds_15m: float = 0.0


# ──────────────────────────────────────────────────────────────────────────
# Eventos de sincronización (backend → twin)
# ──────────────────────────────────────────────────────────────────────────

class SyncEvent(BaseModel):
    event_type: Literal[
        "locker.status_changed",
        "driver.position_changed",
        "driver.status_changed",
        "request.created",
        "request.assigned",
        "request.deposited",
        "request.completed",
        "request.cancelled",
    ]
    timestamp: datetime
    payload: dict


# ──────────────────────────────────────────────────────────────────────────
# Escenarios de simulación
# ──────────────────────────────────────────────────────────────────────────

class ScenarioRequest(BaseModel):
    name: str = Field(description="Identificador legible del escenario")
    duration_minutes: int = Field(default=60, ge=1, le=1440)
    request_rate_per_min: float = Field(default=2.0, ge=0)
    drivers_online: int = Field(default=10, ge=0)
    seed: Optional[int] = None
    scenario_file: Optional[str] = Field(
        default=None,
        description="Ruta opcional a un fixture JSON con cruceros y parámetros base",
    )


class ScenarioResult(BaseModel):
    name: str
    duration_minutes: int
    requests_simulated: int
    requests_completed: int
    requests_failed: int
    avg_match_seconds: float
    p95_match_seconds: float
    final_aggregates: Aggregates


TwinSnapshot.model_rebuild()
