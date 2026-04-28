"""
In-memory store del Digital Twin.

Un singleton thread-safe con asyncio.Lock para serializar mutaciones
desde el endpoint /sync y desde la simulación.
"""
from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone
from typing import Optional

from .schemas import (
    Aggregates,
    DriverState,
    DriverStatus,
    LockerState,
    LockerStatus,
    RequestPhase,
    RequestState,
    SyncEvent,
    TwinSnapshot,
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


class TwinStore:
    def __init__(self) -> None:
        self.env = os.environ.get("TWIN_ENV", "simulation")
        self.lockers: dict[int, LockerState] = {}
        self.drivers: dict[int, DriverState] = {}
        self.requests: dict[int, RequestState] = {}
        self.recent_match_seconds: list[float] = []
        self._lock = asyncio.Lock()
        self._seed_default()

    def _seed_default(self) -> None:
        """Seed estático: 5 lockers en Las Palmas + 3 drivers."""
        seeds = [
            (1, "L-LP-01", 28.1235, -15.4363),
            (2, "L-LP-02", 28.1289, -15.4321),
            (3, "L-LP-03", 28.1298, -15.4445),
            (4, "L-LP-04", 28.1180, -15.4290),
            (5, "L-LP-05", 28.1322, -15.4385),
        ]
        for lid, label, lat, lon in seeds:
            self.lockers[lid] = LockerState(
                id=lid, label=label, latitude=lat, longitude=lon,
                status=LockerStatus.free, occupancy_pct=0,
                last_change_at=_now(),
            )
        driver_seeds = [
            (101, "Driver Alfa", 28.1240, -15.4360),
            (102, "Driver Bravo", 28.1290, -15.4310),
            (103, "Driver Charlie", 28.1180, -15.4280),
        ]
        for did, name, lat, lon in driver_seeds:
            self.drivers[did] = DriverState(
                id=did, name=name, latitude=lat, longitude=lon,
                status=DriverStatus.available, last_seen_at=_now(),
            )

    # ─── Snapshot ────────────────────────────────────────────────────────
    def snapshot(self) -> TwinSnapshot:
        return TwinSnapshot(
            timestamp=_now(),
            env=self.env,  # type: ignore[arg-type]
            lockers=list(self.lockers.values()),
            drivers=list(self.drivers.values()),
            requests=list(self.requests.values()),
            aggregates=self.compute_aggregates(),
        )

    def compute_aggregates(self) -> Aggregates:
        lockers_total = len(self.lockers)
        lockers_free = sum(1 for l in self.lockers.values() if l.status == LockerStatus.free)
        lockers_occupied = sum(1 for l in self.lockers.values() if l.status == LockerStatus.occupied)
        lockers_out = sum(1 for l in self.lockers.values() if l.status == LockerStatus.out_of_service)

        drivers_total = len(self.drivers)
        drivers_online = sum(1 for d in self.drivers.values() if d.status != DriverStatus.offline)
        drivers_available = sum(1 for d in self.drivers.values() if d.status == DriverStatus.available)

        active = [r for r in self.requests.values() if r.phase not in (RequestPhase.completed, RequestPhase.cancelled)]
        match_avg = sum(self.recent_match_seconds[-100:]) / max(1, len(self.recent_match_seconds[-100:]))

        return Aggregates(
            lockers_total=lockers_total,
            lockers_free=lockers_free,
            lockers_occupied=lockers_occupied,
            lockers_out=lockers_out,
            drivers_total=drivers_total,
            drivers_online=drivers_online,
            drivers_available=drivers_available,
            requests_active=len(active),
            avg_match_seconds_15m=round(match_avg, 1),
        )

    # ─── Sync (backend → twin) ───────────────────────────────────────────
    async def apply_event(self, event: SyncEvent) -> None:
        async with self._lock:
            self._dispatch(event)

    def _dispatch(self, event: SyncEvent) -> None:
        et = event.event_type
        p = event.payload

        if et == "locker.status_changed":
            lid = int(p["locker_id"])
            if lid in self.lockers:
                self.lockers[lid].status = LockerStatus(p["status"])
                self.lockers[lid].occupancy_pct = float(p.get("occupancy_pct", self.lockers[lid].occupancy_pct))
                self.lockers[lid].last_change_at = event.timestamp

        elif et == "driver.position_changed":
            did = int(p["driver_id"])
            if did in self.drivers:
                self.drivers[did].latitude = float(p["latitude"])
                self.drivers[did].longitude = float(p["longitude"])
                self.drivers[did].last_seen_at = event.timestamp

        elif et == "driver.status_changed":
            did = int(p["driver_id"])
            if did in self.drivers:
                self.drivers[did].status = DriverStatus(p["status"])
                self.drivers[did].last_seen_at = event.timestamp

        elif et == "request.created":
            rid = int(p["request_id"])
            self.requests[rid] = RequestState(
                id=rid,
                client_id=int(p["client_id"]),
                locker_id=p.get("locker_id"),
                phase=RequestPhase.requested,
                created_at=event.timestamp,
                last_event_at=event.timestamp,
            )

        elif et == "request.assigned":
            rid = int(p["request_id"])
            if rid in self.requests:
                self.requests[rid].driver_id = int(p["driver_id"])
                self.requests[rid].phase = RequestPhase.assigned
                self.requests[rid].last_event_at = event.timestamp
                # Match time
                delta = (event.timestamp - self.requests[rid].created_at).total_seconds()
                self.recent_match_seconds.append(delta)

        elif et == "request.deposited":
            rid = int(p["request_id"])
            if rid in self.requests:
                self.requests[rid].phase = RequestPhase.deposited
                self.requests[rid].last_event_at = event.timestamp

        elif et == "request.completed":
            rid = int(p["request_id"])
            if rid in self.requests:
                self.requests[rid].phase = RequestPhase.completed
                self.requests[rid].last_event_at = event.timestamp

        elif et == "request.cancelled":
            rid = int(p["request_id"])
            if rid in self.requests:
                self.requests[rid].phase = RequestPhase.cancelled
                self.requests[rid].last_event_at = event.timestamp


_store: Optional[TwinStore] = None


def get_store() -> TwinStore:
    global _store
    if _store is None:
        _store = TwinStore()
    return _store
