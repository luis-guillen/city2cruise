#!/usr/bin/env python3
"""
synthetic_data_generator.py — Sprint 3.D stress-test data injector
====================================================================
Simulates realistic (and adversarial) telemetry for the City2Cruise platform:

  • GPS tracks    — Gaussian noise + configurable outlier injection > 50 m
  • Urgency spikes — cruise manifests with imminent all-aboard deadlines
  • Locker churn  — random occupancy toggling to vary the occupancy-rate feature

Modes:
  normal    Steady-state: 5 drivers, GPS every 2 s, 5 % outlier rate
  stress    High volume:  20 drivers, GPS every 0.5 s, 15 % outlier rate,
            urgency spike every 2 min
  urgency   Focus on urgency: seed cruises departing in 15 / 30 / 60 minutes

Usage:
  python scripts/synthetic_data_generator.py --mode normal --duration 120
  python scripts/synthetic_data_generator.py --mode stress --drivers 20 --duration 300
  python scripts/synthetic_data_generator.py --mode urgency --duration 60
  python scripts/synthetic_data_generator.py --mode normal --help

Dependencies (pip install):
  httpx>=0.27       async HTTP client
  python-socketio[asyncio-client]>=5.11   socket.io client
  psycopg2-binary>=2.9  direct DB seeding for cruise manifest / lockers
  asyncio (stdlib)
"""

import argparse
import asyncio
import json
import math
import random
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from typing import Optional

# ── Optional imports (degrade gracefully if missing) ─────────────────────────
try:
    import httpx
    HAS_HTTPX = True
except ImportError:
    HAS_HTTPX = False
    print("[WARN] httpx not installed — REST calls disabled. pip install httpx", file=sys.stderr)

try:
    import socketio as sio_module
    HAS_SIO = True
except ImportError:
    HAS_SIO = False
    print("[WARN] python-socketio[asyncio-client] not installed — GPS emission disabled.", file=sys.stderr)

try:
    import psycopg2
    import psycopg2.extras
    HAS_PSYCOPG2 = True
except ImportError:
    HAS_PSYCOPG2 = False
    print("[WARN] psycopg2-binary not installed — DB seeding disabled. pip install psycopg2-binary", file=sys.stderr)


# ═══════════════════════════════════════════════════════════════════════════════
# Configuration
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class SimConfig:
    mode: str = "normal"
    base_url: str = "http://localhost:9000"
    db_url: str = "postgresql://cruise:cruise_secret@localhost:5432/cruise_connect"
    n_drivers: int = 5
    gps_interval_s: float = 2.0
    outlier_rate: float = 0.05       # fraction of GPS fixes that are outliers
    outlier_sigma_m: float = 150.0   # std dev of outlier noise in metres
    gps_noise_sigma_m: float = 5.0   # std dev of normal GPS noise
    duration_s: int = 120            # total simulation duration
    urgency_spike_interval_s: float = 120.0  # seconds between urgency injections

    # Las Palmas cruise terminal area (port hub)
    center_lat: float = 28.1400
    center_lon: float = -15.4200
    area_radius_m: float = 3_000     # drivers start within this radius of center

    # Driver accounts to use (must exist in DB; created if --seed-users is set)
    driver_email_template: str = "synthdriver{n}@city2cruise.internal"
    driver_password: str = "SynthPass#2024!"

    # Internal API key for state-tensor validation calls
    internal_api_key: str = "dev_internal_key_change_in_prod"


PRESETS: dict[str, dict] = {
    "normal": {
        "n_drivers": 5,
        "gps_interval_s": 2.0,
        "outlier_rate": 0.05,
        "urgency_spike_interval_s": 300.0,
        "duration_s": 120,
    },
    "stress": {
        "n_drivers": 20,
        "gps_interval_s": 0.5,
        "outlier_rate": 0.15,
        "urgency_spike_interval_s": 60.0,
        "duration_s": 300,
    },
    "urgency": {
        "n_drivers": 3,
        "gps_interval_s": 5.0,
        "outlier_rate": 0.02,
        "urgency_spike_interval_s": 20.0,
        "duration_s": 90,
    },
}


# ═══════════════════════════════════════════════════════════════════════════════
# GPS simulation helpers
# ═══════════════════════════════════════════════════════════════════════════════

DEG_TO_M = 111_139.0


def meters_to_deg_lat(m: float) -> float:
    return m / DEG_TO_M


def meters_to_deg_lon(m: float, lat: float) -> float:
    return m / (DEG_TO_M * math.cos(math.radians(lat)))


def random_point_near(lat: float, lon: float, radius_m: float) -> tuple[float, float]:
    """Uniform random point within `radius_m` metres of (lat, lon)."""
    r = radius_m * math.sqrt(random.random())
    theta = random.uniform(0, 2 * math.pi)
    dlat = meters_to_deg_lat(r * math.cos(theta))
    dlon = meters_to_deg_lon(r * math.sin(theta), lat)
    return lat + dlat, lon + dlon


def add_gps_noise(
    lat: float,
    lon: float,
    sigma_m: float,
    outlier_rate: float,
    outlier_sigma_m: float,
) -> tuple[float, float, float]:
    """
    Add GPS noise. Returns (noisy_lat, noisy_lon, actual_deviation_m).
    `actual_deviation_m` > 50 m marks an outlier the Kalman filter should attenuate.
    """
    is_outlier = random.random() < outlier_rate
    sigma = outlier_sigma_m if is_outlier else sigma_m
    sigma_deg_lat = meters_to_deg_lat(sigma)
    sigma_deg_lon = meters_to_deg_lon(sigma, lat)
    noisy_lat = lat + random.gauss(0, sigma_deg_lat)
    noisy_lon = lon + random.gauss(0, sigma_deg_lon)
    deviation_m = math.sqrt(
        (noisy_lat - lat) ** 2 * DEG_TO_M ** 2
        + (noisy_lon - lon) ** 2 * (DEG_TO_M * math.cos(math.radians(lat))) ** 2
    )
    return noisy_lat, noisy_lon, deviation_m


@dataclass
class DriverState:
    driver_id: int
    email: str
    token: str
    lat: float
    lon: float
    heading: float = field(default_factory=lambda: random.uniform(0, 360))
    speed_mps: float = field(default_factory=lambda: random.uniform(5, 12))
    outlier_count: int = 0
    total_fixes: int = 0

    def step(self, dt: float = 1.0) -> None:
        """Advance position by one random-walk step."""
        # Smooth heading drift (±8° per step)
        self.heading += random.gauss(0, 8)
        self.heading %= 360
        # Speed variation (±0.3 m/s per step, clamped to urban range)
        self.speed_mps = max(2.0, min(15.0, self.speed_mps + random.gauss(0, 0.3)))
        dist = self.speed_mps * dt
        self.lat += meters_to_deg_lat(dist * math.cos(math.radians(self.heading)))
        self.lon += meters_to_deg_lon(dist * math.sin(math.radians(self.heading)), self.lat)


# ═══════════════════════════════════════════════════════════════════════════════
# HTTP / auth helpers
# ═══════════════════════════════════════════════════════════════════════════════

async def login(client: "httpx.AsyncClient", base_url: str, email: str, password: str) -> Optional[str]:
    """Login via REST; return JWT access token or None on failure."""
    try:
        resp = await client.post(f"{base_url}/api/auth/login", json={"email": email, "password": password}, timeout=10)
        if resp.status_code == 200:
            return resp.json().get("accessToken")
        print(f"[AUTH] Login failed for {email}: {resp.status_code} {resp.text[:100]}", file=sys.stderr)
    except Exception as e:
        print(f"[AUTH] Login error for {email}: {e}", file=sys.stderr)
    return None


async def seed_driver_users(db_url: str, n: int, email_tpl: str, password: str) -> None:
    """
    Insert synthetic DRIVER users directly into the DB if they don't exist.
    Uses bcrypt hash matching the plain password above.
    NOTE: Requires bcrypt — pip install bcrypt
    """
    if not HAS_PSYCOPG2:
        print("[SEED] psycopg2 not available — skipping user seeding.", file=sys.stderr)
        return
    try:
        import bcrypt  # type: ignore
    except ImportError:
        print("[SEED] bcrypt not installed — cannot seed users. pip install bcrypt", file=sys.stderr)
        return

    pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

    conn = psycopg2.connect(db_url)
    cur = conn.cursor()
    for i in range(1, n + 1):
        email = email_tpl.format(n=i)
        name = f"SynthDriver {i}"
        cur.execute(
            """INSERT INTO users (name, email, password_hash, role)
               VALUES (%s, %s, %s, 'DRIVER')
               ON CONFLICT (email) DO NOTHING""",
            (name, email, pw_hash),
        )
    conn.commit()
    cur.close()
    conn.close()
    print(f"[SEED] Ensured {n} synthetic driver users exist.")


# ═══════════════════════════════════════════════════════════════════════════════
# GPS emitter — socket.io
# ═══════════════════════════════════════════════════════════════════════════════

async def run_driver_gps(driver: DriverState, cfg: SimConfig, stop_event: asyncio.Event) -> None:
    """Connect via socket.io and emit GPS updates until stop_event is set."""
    if not HAS_SIO:
        print(f"[GPS] Driver {driver.driver_id} — socket.io unavailable, skipping.", file=sys.stderr)
        return

    sio = sio_module.AsyncClient(logger=False, engineio_logger=False)
    url = cfg.base_url.replace("http://", "ws://").replace("https://", "wss://")

    try:
        await sio.connect(url, auth={"token": driver.token}, transports=["websocket"])
    except Exception as e:
        print(f"[GPS] Driver {driver.driver_id} — connect failed: {e}", file=sys.stderr)
        return

    try:
        while not stop_event.is_set():
            driver.step(dt=cfg.gps_interval_s)
            noisy_lat, noisy_lon, deviation_m = add_gps_noise(
                driver.lat, driver.lon,
                cfg.gps_noise_sigma_m,
                cfg.outlier_rate,
                cfg.outlier_sigma_m,
            )
            driver.total_fixes += 1
            if deviation_m > 50:
                driver.outlier_count += 1

            await sio.emit("location:update", {
                "lat": noisy_lat,
                "lon": noisy_lon,
                "accuracy": cfg.gps_noise_sigma_m,
                "timestamp": int(time.time() * 1000),
            })

            await asyncio.sleep(cfg.gps_interval_s)
    finally:
        await sio.disconnect()

    outlier_pct = 100 * driver.outlier_count / max(1, driver.total_fixes)
    print(f"[GPS] Driver {driver.driver_id} done — {driver.total_fixes} fixes, "
          f"{driver.outlier_count} outliers ({outlier_pct:.1f} %)")


# ═══════════════════════════════════════════════════════════════════════════════
# Urgency spike injector — direct DB
# ═══════════════════════════════════════════════════════════════════════════════

_VESSEL_NAMES = [
    "MSC Magnifica", "Costa Luminosa", "AIDAblu", "Royal Princess",
    "Harmony of the Seas", "Norwegian Getaway", "Celebrity Edge",
]

def inject_urgency_spike(db_url: str, minutes_to_deadline: int = 30) -> None:
    """
    Insert a cruise manifest entry with an all_aboard deadline `minutes_to_deadline`
    minutes from now, creating a high-urgency scenario for the feature pipeline.
    """
    if not HAS_PSYCOPG2:
        return
    vessel = random.choice(_VESSEL_NAMES)
    now = datetime.now(timezone.utc)
    all_aboard = now + timedelta(minutes=minutes_to_deadline)
    departure = all_aboard + timedelta(minutes=30)

    conn = psycopg2.connect(db_url)
    cur = conn.cursor()
    cur.execute(
        """INSERT INTO cruise_manifest
               (vessel_name, scheduled_arrival, all_aboard, departure, status, estimated_passengers)
           VALUES (%s, %s, %s, %s, 'docked', %s)""",
        (vessel, now - timedelta(hours=4), all_aboard, departure, random.randint(800, 3500)),
    )
    conn.commit()
    cur.close()
    conn.close()
    print(f"[URGENCY] Injected cruise '{vessel}' — all aboard in {minutes_to_deadline} min "
          f"(urgency ≈ {max(0, 1 - minutes_to_deadline / 240):.2f})")


async def run_urgency_spiker(cfg: SimConfig, stop_event: asyncio.Event) -> None:
    """Periodically inject urgency spikes until stop_event is set."""
    if not HAS_PSYCOPG2:
        print("[URGENCY] psycopg2 unavailable — urgency spikes disabled.", file=sys.stderr)
        return

    while not stop_event.is_set():
        # Vary deadline: 15 / 30 / 60 minutes
        deadline = random.choice([15, 30, 60])
        inject_urgency_spike(cfg.db_url, minutes_to_deadline=deadline)
        await asyncio.sleep(cfg.urgency_spike_interval_s)


# ═══════════════════════════════════════════════════════════════════════════════
# Locker occupancy churn — direct DB
# ═══════════════════════════════════════════════════════════════════════════════

def churn_lockers(db_url: str, target_rate: float = 0.5) -> None:
    """
    Randomly toggle locker is_occupied flags to maintain occupancy near `target_rate`.
    Simulates package deposit / pickup cycles for occupancy-rate feature variation.
    """
    if not HAS_PSYCOPG2:
        return
    conn = psycopg2.connect(db_url)
    cur = conn.cursor()
    cur.execute("SELECT id, is_occupied FROM lockers WHERE hw_status = 'ONLINE'")
    rows = cur.fetchall()
    if not rows:
        cur.close()
        conn.close()
        return

    occupied_count = sum(1 for _, occ in rows if occ)
    total = len(rows)
    current_rate = occupied_count / total if total else 0

    # Flip a random locker to push occupancy toward target_rate
    for locker_id, is_occupied in random.sample(rows, min(3, len(rows))):
        should_occupy = current_rate < target_rate
        if is_occupied != should_occupy:
            cur.execute(
                "UPDATE lockers SET is_occupied = %s, updated_at = NOW() WHERE id = %s",
                (should_occupy, locker_id),
            )

    conn.commit()
    cur.close()
    conn.close()


async def run_locker_churn(cfg: SimConfig, stop_event: asyncio.Event) -> None:
    if not HAS_PSYCOPG2:
        return
    while not stop_event.is_set():
        target = random.uniform(0.2, 0.8)  # vary occupancy target to stress the feature
        churn_lockers(cfg.db_url, target_rate=target)
        await asyncio.sleep(15)  # every 15 s


# ═══════════════════════════════════════════════════════════════════════════════
# State-tensor validation (optional smoke test)
# ═══════════════════════════════════════════════════════════════════════════════

async def validate_state_tensor(client: "httpx.AsyncClient", cfg: SimConfig) -> None:
    """Fetch the state tensor and print a brief summary."""
    try:
        resp = await client.get(
            f"{cfg.base_url}/api/internal/state-tensor",
            headers={"X-Internal-Key": cfg.internal_api_key},
            timeout=10,
        )
        if resp.status_code == 200:
            data = resp.json()
            print(
                f"[TENSOR] version={data.get('version')} "
                f"drivers={len(data.get('drivers', []))} "
                f"clusters={len(data.get('demandClusters', []))} "
                f"urgency_scores={len(data.get('urgency', []))} "
                f"locker_occ={data.get('lockers', {}).get('occupancyRate', 0):.2f} "
                f"pipeline_ms={data.get('durationMs', '?')}"
            )
        else:
            print(f"[TENSOR] HTTP {resp.status_code}: {resp.text[:120]}", file=sys.stderr)
    except Exception as e:
        print(f"[TENSOR] Validation error: {e}", file=sys.stderr)


# ═══════════════════════════════════════════════════════════════════════════════
# Main orchestrator
# ═══════════════════════════════════════════════════════════════════════════════

async def main(cfg: SimConfig, seed_users: bool) -> None:
    print(f"[SIM] Mode={cfg.mode} | Drivers={cfg.n_drivers} | "
          f"GPS interval={cfg.gps_interval_s}s | Outlier rate={cfg.outlier_rate:.0%} | "
          f"Duration={cfg.duration_s}s")

    if seed_users:
        await asyncio.to_thread(
            seed_driver_users,
            cfg.db_url,
            cfg.n_drivers,
            cfg.driver_email_template,
            cfg.driver_password,
        )

    stop_event = asyncio.Event()
    drivers: list[DriverState] = []

    if HAS_HTTPX:
        async with httpx.AsyncClient() as http:
            # Authenticate all drivers
            for i in range(1, cfg.n_drivers + 1):
                email = cfg.driver_email_template.format(n=i)
                token = await login(http, cfg.base_url, email, cfg.driver_password)
                if not token:
                    print(f"[SIM] Skipping driver {i} — auth failed", file=sys.stderr)
                    continue
                start_lat, start_lon = random_point_near(cfg.center_lat, cfg.center_lon, cfg.area_radius_m)
                drivers.append(DriverState(driver_id=i, email=email, token=token, lat=start_lat, lon=start_lon))
            print(f"[SIM] Authenticated {len(drivers)}/{cfg.n_drivers} drivers")

            # Kick off background tasks
            tasks = [
                asyncio.create_task(run_driver_gps(d, cfg, stop_event)) for d in drivers
            ]
            tasks.append(asyncio.create_task(run_urgency_spiker(cfg, stop_event)))
            tasks.append(asyncio.create_task(run_locker_churn(cfg, stop_event)))

            start_time = time.monotonic()
            try:
                while time.monotonic() - start_time < cfg.duration_s:
                    elapsed = time.monotonic() - start_time
                    remaining = cfg.duration_s - elapsed
                    print(f"[SIM] t={elapsed:.0f}s — {remaining:.0f}s remaining", end="\r")
                    # Periodic tensor validation every 30 s
                    await validate_state_tensor(http, cfg)
                    await asyncio.sleep(min(30, remaining))
            except KeyboardInterrupt:
                print("\n[SIM] Interrupted by user")
            finally:
                stop_event.set()
                await asyncio.gather(*tasks, return_exceptions=True)
    else:
        # Fallback: DB-only mode (urgency spikes + locker churn, no GPS)
        print("[SIM] httpx unavailable — running DB-only mode (urgency + lockers)")
        tasks = [
            asyncio.create_task(run_urgency_spiker(cfg, stop_event)),
            asyncio.create_task(run_locker_churn(cfg, stop_event)),
        ]
        await asyncio.sleep(cfg.duration_s)
        stop_event.set()
        await asyncio.gather(*tasks, return_exceptions=True)

    print(f"\n[SIM] Simulation complete — {len(drivers)} drivers ran for {cfg.duration_s}s")
    if drivers:
        total_fixes = sum(d.total_fixes for d in drivers)
        total_outliers = sum(d.outlier_count for d in drivers)
        print(f"[SIM] Total fixes: {total_fixes} | Outliers injected: {total_outliers} "
              f"({100 * total_outliers / max(1, total_fixes):.1f} %)")


# ═══════════════════════════════════════════════════════════════════════════════
# CLI
# ═══════════════════════════════════════════════════════════════════════════════

def parse_args() -> tuple[SimConfig, bool]:
    parser = argparse.ArgumentParser(
        description="City2Cruise synthetic telemetry data generator — Sprint 3.D",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--mode", choices=["normal", "stress", "urgency"], default="normal",
                        help="Simulation preset (default: normal)")
    parser.add_argument("--base-url", default="http://localhost:9000",
                        help="Backend base URL (default: http://localhost:9000)")
    parser.add_argument("--db-url", default="postgresql://cruise:cruise_secret@localhost:5432/cruise_connect",
                        help="PostgreSQL DSN for direct DB seeding")
    parser.add_argument("--drivers", type=int, default=None,
                        help="Number of simulated drivers (overrides mode preset)")
    parser.add_argument("--duration", type=int, default=None,
                        help="Simulation duration in seconds (overrides mode preset)")
    parser.add_argument("--gps-interval", type=float, default=None,
                        help="GPS update interval in seconds (overrides mode preset)")
    parser.add_argument("--outlier-rate", type=float, default=None,
                        help="Fraction of GPS fixes that are outliers, e.g. 0.10 (overrides preset)")
    parser.add_argument("--outlier-sigma", type=float, default=150.0,
                        help="Std dev of outlier noise in metres (default: 150 m)")
    parser.add_argument("--internal-key", default="dev_internal_key_change_in_prod",
                        help="X-Internal-Key for /api/internal/state-tensor validation")
    parser.add_argument("--seed-users", action="store_true",
                        help="Create synthetic DRIVER users in the DB before simulating")

    args = parser.parse_args()

    # Start from mode preset, then apply overrides
    preset = PRESETS[args.mode].copy()
    cfg = SimConfig(
        mode=args.mode,
        base_url=args.base_url,
        db_url=args.db_url,
        n_drivers=args.drivers or preset["n_drivers"],
        gps_interval_s=args.gps_interval if args.gps_interval is not None else preset["gps_interval_s"],
        outlier_rate=args.outlier_rate if args.outlier_rate is not None else preset["outlier_rate"],
        outlier_sigma_m=args.outlier_sigma,
        duration_s=args.duration or preset["duration_s"],
        urgency_spike_interval_s=preset["urgency_spike_interval_s"],
        internal_api_key=args.internal_key,
    )
    return cfg, args.seed_users


if __name__ == "__main__":
    cfg, seed_users = parse_args()
    try:
        asyncio.run(main(cfg, seed_users))
    except KeyboardInterrupt:
        print("\n[SIM] Aborted.")
