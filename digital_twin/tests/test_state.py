"""
Hito 5.4.1 — tests del store del Digital Twin.
Run: pytest digital_twin/tests/
"""
import asyncio
from datetime import datetime, timezone

import pytest

from digital_twin.state import TwinStore
from digital_twin.schemas import (
    SyncEvent,
    LockerStatus,
    DriverStatus,
    RequestPhase,
)


def _ts():
    return datetime.now(timezone.utc)


def test_seed_initial_state():
    s = TwinStore()
    assert len(s.lockers) == 5
    assert len(s.drivers) == 3
    assert len(s.requests) == 0
    agg = s.compute_aggregates()
    assert agg.lockers_free == 5
    assert agg.lockers_occupied == 0
    assert agg.drivers_available == 3


def test_locker_status_changed():
    s = TwinStore()
    e = SyncEvent(
        event_type="locker.status_changed",
        timestamp=_ts(),
        payload={"locker_id": 1, "status": "occupied", "occupancy_pct": 75},
    )
    asyncio.run(s.apply_event(e))
    assert s.lockers[1].status == LockerStatus.occupied
    assert s.lockers[1].occupancy_pct == 75
    agg = s.compute_aggregates()
    assert agg.lockers_free == 4
    assert agg.lockers_occupied == 1


def test_driver_position_and_status():
    s = TwinStore()
    e_pos = SyncEvent(
        event_type="driver.position_changed",
        timestamp=_ts(),
        payload={"driver_id": 101, "latitude": 28.20, "longitude": -15.50},
    )
    asyncio.run(s.apply_event(e_pos))
    assert s.drivers[101].latitude == 28.20

    e_st = SyncEvent(
        event_type="driver.status_changed",
        timestamp=_ts(),
        payload={"driver_id": 101, "status": "busy"},
    )
    asyncio.run(s.apply_event(e_st))
    assert s.drivers[101].status == DriverStatus.busy
    agg = s.compute_aggregates()
    assert agg.drivers_available == 2  # 3 -> 2


def test_request_lifecycle_and_match_time():
    s = TwinStore()
    t0 = datetime(2026, 4, 28, 14, 0, 0, tzinfo=timezone.utc)
    asyncio.run(s.apply_event(SyncEvent(
        event_type="request.created",
        timestamp=t0,
        payload={"request_id": 9001, "client_id": 1, "locker_id": 1},
    )))
    assert s.requests[9001].phase == RequestPhase.requested

    t1 = datetime(2026, 4, 28, 14, 0, 22, tzinfo=timezone.utc)  # 22s later
    asyncio.run(s.apply_event(SyncEvent(
        event_type="request.assigned",
        timestamp=t1,
        payload={"request_id": 9001, "driver_id": 101},
    )))
    assert s.requests[9001].phase == RequestPhase.assigned
    assert s.requests[9001].driver_id == 101
    assert s.recent_match_seconds == [22.0]

    t2 = datetime(2026, 4, 28, 14, 5, 0, tzinfo=timezone.utc)
    asyncio.run(s.apply_event(SyncEvent(
        event_type="request.deposited",
        timestamp=t2,
        payload={"request_id": 9001},
    )))
    assert s.requests[9001].phase == RequestPhase.deposited

    asyncio.run(s.apply_event(SyncEvent(
        event_type="request.completed",
        timestamp=datetime.now(timezone.utc),
        payload={"request_id": 9001},
    )))
    assert s.requests[9001].phase == RequestPhase.completed
    agg = s.compute_aggregates()
    assert agg.requests_active == 0  # completed no cuenta como activa


def test_unknown_locker_id_is_ignored():
    s = TwinStore()
    asyncio.run(s.apply_event(SyncEvent(
        event_type="locker.status_changed",
        timestamp=_ts(),
        payload={"locker_id": 99999, "status": "occupied"},
    )))
    # No exception, no mutation
    assert 99999 not in s.lockers
