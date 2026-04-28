"""
Pydantic schemas for the RL microservice.
Mirror the StateTensor TypeScript interface from StateFusion.ts so the backend
can POST the tensor directly without any transformation.
"""

from __future__ import annotations
from typing import Optional
from pydantic import BaseModel


# ─── State tensor inputs (mirrors TypeScript StateTensor) ─────────────────────

class EtaInfo(BaseModel):
    driverId: int
    requestId: int
    estimatedArrivalMs: int
    distanceM: float
    speedMps: float
    distanceNorm: float


class DriverObservation(BaseModel):
    driverId: int
    lat: float
    lon: float
    latNorm: float
    lonNorm: float
    vLat: float
    vLon: float
    speedMps: float
    speedNorm: float
    sigmaM: float
    eta: Optional[EtaInfo] = None


class DemandCluster(BaseModel):
    clusterId: int
    centroidLat: float
    centroidLon: float
    requestCount: int
    epsM: float


class UrgencyScore(BaseModel):
    cruiseId: int
    vesselName: str
    allAboardAt: Optional[str] = None
    minutesToDeadline: float
    urgency: float          # [0,1]


class LockerSummary(BaseModel):
    total: int
    occupied: int
    available: int
    occupancyRate: float    # [0,1]


class StateTensorInput(BaseModel):
    version: str
    generatedAt: int        # Unix ms
    durationMs: float
    drivers: list[DriverObservation]
    demandClusters: list[DemandCluster]
    urgency: list[UrgencyScore]
    lockers: LockerSummary
    activeRequestCount: int


# ─── Response types ────────────────────────────────────────────────────────────

class AssignmentResult(BaseModel):
    driverId: int
    score: float            # RL confidence in [0,1]
    rank: int               # 0 = top recommendation
    etaMs: Optional[float] = None


class AssignRequest(BaseModel):
    state: StateTensorInput
    requestId: Optional[int] = None  # specific request to assign; None = most urgent


class AssignResponse(BaseModel):
    requestId: Optional[int]
    rankings: list[AssignmentResult]
    modelVersion: str
    inferenceMs: float


class TrainRequest(BaseModel):
    timesteps: int = 100_000


class TrainResponse(BaseModel):
    status: str
    timesteps: int


class SnapshotMeta(BaseModel):
    totalTimesteps: int
    modelVersion: str
    lastTrainedAt: Optional[str]
