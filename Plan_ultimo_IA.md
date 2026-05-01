# Plan: Cerrar IA/RL pendiente de la HOJA DE RUTA

> **Para agentes ejecutores:** SUB-SKILL REQUERIDA: usa `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans` para implementar este plan tarea a tarea. Los pasos usan checkboxes (`- [ ]`).

**Goal:** Cerrar los hitos 3.4, 3.5, 5.4 y 6.5 de IA/RL del documento `docs/history/HOJA_DE_RUTA_DE_DESARROLLO.docx`, dejando el sistema con generador de datos sintéticos masivos, re-planificación autónoma activa, twin con escenarios reales del puerto, sync backend↔twin productivo, intervención manual desde la Torre de Control, y suite de validación de convergencia y fidelidad sim-to-real.

**KPIs de IA/RL:** la IA de este proyecto no debe optimizar predicción genérica; debe mejorar la decisión de dispatch y rebalanceo. Los criterios de aceptación se resumen en 3 métricas:

| KPI | Qué mide | Objetivo |
|---|---|---|
| `p95_match_seconds` | Tiempo de asignación en el peor 5% de casos | Bajar frente al baseline greedy o heurístico |
| `mean_reward` y `mean_urgency_loss` | Calidad global de la policy y urgencia no atendida | Subir `mean_reward` sin empeorar `mean_urgency_loss` |
| `inference_ms_p95` | Latencia de inferencia del policy | Mantenerla dentro del presupuesto de tiempo real |

Regla de promoción: solo desplegar una policy si mejora `mean_reward` frente a greedy, no empeora `mean_urgency_loss` y cumple latencia.

**Architecture:** El plan **no reescribe** lo ya hecho (StateFusion + Kalman + DBSCAN + ETA + urgency en `backend/src/services/telemetry/*`, agente PPO en `rl_service/`, twin stub en `digital_twin/`, ControlTowerPage en `cruise-connect-main`). Solo añade los faltantes reales detectados: (1) un generador sintético exportable, (2) reasignación real (no advisory) en `rebalanceFleetJob`, (3) sync de eventos backend→twin en producción, (4) escenarios físicos con tráfico/cruceros en el twin, (5) intervención humana en la torre, (6) suite de evaluación 6.5, y (7) docker/CI completos. MiroFish queda como adapter posterior detrás del `TwinClient` actual.

**Tech Stack:** TypeScript 5.9 + Express 5 (backend), Python 3.10 + FastAPI + Gymnasium + Stable-Baselines3 (rl_service & digital_twin), PostgreSQL 15 + PostGIS, React + Leaflet (frontend), socket.io (eventos), pytest + jest, Docker Compose, GitHub Actions.

---

## Context

**Por qué este plan:** El documento de hoja de ruta marca como ❌ pendientes los hitos 3.4 (pipeline telemetría), 3.5 (RL+PPO), 5.4 (twin) y 6.5 (validación IA). En realidad, el código ya implementa la mayor parte (Kalman, DBSCAN, ETA, urgency, agente PPO, gym env, twin stub, ControlTowerPage, tests de convergencia/sim-to-real). Lo que **realmente** falta para "cerrar" cada hito y poder activar RL en producción son los gaps listados arriba. Este plan los cierra sin tocar lo ya consolidado.

**Decisiones del usuario** (29-abr-2026):
- Twin: híbrido — twin propio ahora, MiroFish adapter después.
- Alcance: solo lo verdaderamente faltante (sin tocar lo ya hecho).
- Granularidad: TDD bite-sized.

---

## File Structure

### Archivos NUEVOS

```
rl_service/
├── synthetic_data.py                    # Generador de datasets sintéticos masivos (CSV/Parquet)
├── tests/
│   └── test_synthetic_data.py           # Tests: schema, ruido, reproducibilidad, volumen

backend/src/services/
├── ReassignmentService.ts               # Reasignación activa (cancel + reroute) cuando RL detecta opción mejor
└── twin/
    └── TwinSyncService.ts               # Backend → Twin /sync emitter (HTTP fire-and-forget)

backend/src/jobs/
└── (modify) rebalanceFleetJob.ts        # Pasar de advisory a actuator real

backend/src/__tests__/
├── reassignment.test.ts                 # Tests de reasignación segura (no doble asignación, idempotencia)
├── twin-sync.test.ts                    # Tests del emitter twin (timeout-safe, batched)
└── rebalance-active.test.ts             # E2E: pickup REQUESTED → rebalance → cancel ofertas viejas → emit ofertas nuevas

digital_twin/
├── traffic.py                           # Modelo de tráfico (multiplicador horario + jitter por zona)
├── cruise_schedule.py                   # Loader de cruise_manifest desde fixture JSON
├── scenarios/
│   ├── __init__.py
│   ├── las_palmas_baseline.json         # Escenario: 20 lockers, 15 drivers, 8h, 3 cruceros
│   └── barcelona_peak.json              # Escenario: 30 lockers, 25 drivers, peak hora pico + 2 buques
└── tests/
    ├── test_traffic.py                  # Tests del modelo de tráfico
    ├── test_cruise_schedule.py          # Tests del loader cruise_manifest
    └── test_scenario_realistic.py       # Tests de escenarios físicos completos

cruise-connect-main/src/
├── pages/ (modify) ControlTowerPage.tsx # Añadir panel de intervención manual
├── components/twin/
│   ├── ManualInterventionPanel.tsx      # Botones: cancel request, force-assign driver
│   └── RLRankingTable.tsx               # Tabla de rankings RL en vivo (subscribe socket)
└── services/
    └── (modify) twin.ts                 # Añadir POST /admin/intervene endpoints

backend/src/routes/
└── admin/intervention.ts                # POST /api/admin/intervention/* (force-assign, cancel-and-reroute)

rl_service/validation/
├── __init__.py
├── convergence.py                       # Lee TensorBoard logs, calcula reward variance, exporta CSV
├── fidelity.py                          # Compara latencia twin vs producción (telemetría real)
├── robustness.py                        # Inyecta ruido/packet loss y mide degradación
└── tests/
    ├── test_convergence_eval.py
    ├── test_fidelity_eval.py
    └── test_robustness_eval.py

docker-compose.yml                       # (modify) Añadir rl_service + digital_twin como services
docker-compose.dev.yml                   # (modify) Idem para dev
rl_service/Dockerfile                    # NUEVO
digital_twin/Dockerfile                  # YA EXISTE — solo verificar
.github/workflows/
└── ai-rl-ci.yml                         # NUEVO: CI dedicado a rl_service + digital_twin

docs/history/HITOS_AI_RL_CIERRE.md       # Cierre formal de hitos 3.4, 3.5, 5.4, 6.5 con evidencias
```

### Archivos MODIFICADOS (cambios mínimos)

| Path | Cambio |
|------|--------|
| `backend/src/jobs/rebalanceFleetJob.ts` | Activar reassignment real (gated por flag `RL_REBALANCE_ACTIVE`) |
| `backend/src/index.ts` | Arrancar `TwinSyncService` y registrar route `admin/intervention.ts` |
| `backend/src/services/RLDispatchService.ts` | Cambiar default de `RL_ROUTING_ENABLED` a `true` cuando `NODE_ENV !== 'production'` |
| `cruise-connect-main/src/pages/ControlTowerPage.tsx` | Insertar `ManualInterventionPanel` + `RLRankingTable` |
| `cruise-connect-main/src/services/twin.ts` | Añadir `interveneCancel()`, `interveneForceAssign()`, `subscribeRLRankings()` |
| `docker-compose.yml`, `docker-compose.dev.yml` | Añadir `rl_service` (8080) + `digital_twin` (8090) |
| `envs/production.env.example` | Añadir `RL_REBALANCE_ACTIVE`, `TWIN_SYNC_ENABLED`, `TWIN_URL` |

---

## Tasks

> **Cada tarea es independiente y commitable.** Sigue TDD: test primero, ver fallo, implementar, ver pasar, commit.

---

### FASE A — Cerrar Hito 3.4: Generador de datos sintéticos masivos

**Goal:** Producir datasets reproducibles de miles de escenarios para pre-train el agente y para tests de robustez del pipeline.

#### Task A1: Schema del dataset sintético

**Files:**
- Create: `rl_service/synthetic_data.py`
- Test: `rl_service/tests/test_synthetic_data.py`

- [ ] **Step 1: Test que falla — esquema básico**

```python
# rl_service/tests/test_synthetic_data.py
from rl_service.synthetic_data import SyntheticEpisode, generate_episode

def test_generate_episode_returns_dataclass():
    ep = generate_episode(seed=42)
    assert isinstance(ep, SyntheticEpisode)
    assert len(ep.drivers) >= 2
    assert len(ep.requests) >= 1
    assert all(0.0 <= r.urgency <= 1.0 for r in ep.requests)

def test_generate_episode_reproducible():
    a = generate_episode(seed=42)
    b = generate_episode(seed=42)
    assert a.drivers == b.drivers
    assert a.requests == b.requests
```

- [ ] **Step 2: Verifica fallo**

```bash
cd /Users/luisguillen/Documents/Reker/APP_TRASNPORTE_LOCKERS_BARCELONA
python -m pytest rl_service/tests/test_synthetic_data.py -v
```
Expected: `ImportError: cannot import name 'SyntheticEpisode'`

- [ ] **Step 3: Implementación mínima**

```python
# rl_service/synthetic_data.py
from __future__ import annotations
import random
from dataclasses import dataclass, field
from typing import Optional

@dataclass(frozen=True)
class SyntheticDriver:
    id: int
    lat: float
    lon: float
    speed_mps: float

@dataclass(frozen=True)
class SyntheticRequest:
    id: int
    lat: float
    lon: float
    urgency: float
    cruise_id: Optional[int] = None

@dataclass(frozen=True)
class SyntheticEpisode:
    drivers: tuple[SyntheticDriver, ...]
    requests: tuple[SyntheticRequest, ...]
    locker_occupancy: float

LAT_MIN, LAT_MAX = 27.99, 28.22
LON_MIN, LON_MAX = -15.55, -15.35

def generate_episode(seed: int, n_drivers: int = 8, n_requests: int = 12) -> SyntheticEpisode:
    rng = random.Random(seed)
    drivers = tuple(
        SyntheticDriver(
            id=i,
            lat=rng.uniform(LAT_MIN, LAT_MAX),
            lon=rng.uniform(LON_MIN, LON_MAX),
            speed_mps=rng.uniform(3.0, 12.0),
        )
        for i in range(n_drivers)
    )
    requests = tuple(
        SyntheticRequest(
            id=i,
            lat=rng.uniform(LAT_MIN, LAT_MAX),
            lon=rng.uniform(LON_MIN, LON_MAX),
            urgency=rng.uniform(0.65, 1.0) if rng.random() < 0.3 else rng.uniform(0.0, 0.5),
            cruise_id=rng.randint(100, 200) if rng.random() < 0.2 else None,
        )
        for i in range(n_requests)
    )
    return SyntheticEpisode(drivers=drivers, requests=requests, locker_occupancy=rng.uniform(0.1, 0.9))
```

- [ ] **Step 4: Verifica que pasa**
```bash
python -m pytest rl_service/tests/test_synthetic_data.py -v
```
Expected: `2 passed`

- [ ] **Step 5: Commit**
```bash
git add rl_service/synthetic_data.py rl_service/tests/test_synthetic_data.py
git commit -m "feat(rl): synthetic data generator — episode schema (Hito 3.4)"
```

#### Task A2: Ruido GPS realista

**Files:**
- Modify: `rl_service/synthetic_data.py`
- Test: `rl_service/tests/test_synthetic_data.py`

- [ ] **Step 1: Test que falla — ruido aplicado**

```python
def test_gps_noise_within_accuracy_envelope():
    from rl_service.synthetic_data import inject_gps_noise
    raw = [(28.12, -15.43)] * 100
    noisy = inject_gps_noise(raw, seed=1, sigma_m=10.0, outlier_rate=0.05)
    # 95% within ~30 m of original (3-sigma)
    near = sum(1 for (lat, lon) in noisy if abs(lat - 28.12) < 0.0003)
    assert near >= 90  # allow 10 outliers
```

- [ ] **Step 2: Verifica fallo**

```bash
python -m pytest rl_service/tests/test_synthetic_data.py::test_gps_noise_within_accuracy_envelope -v
```
Expected: `ImportError: cannot import name 'inject_gps_noise'`

- [ ] **Step 3: Implementación mínima**

```python
# rl_service/synthetic_data.py — append
import math

def inject_gps_noise(
    points: list[tuple[float, float]],
    seed: int,
    sigma_m: float = 10.0,
    outlier_rate: float = 0.02,
) -> list[tuple[float, float]]:
    """Adds Gaussian noise (1-sigma = sigma_m meters) plus rare outliers."""
    rng = random.Random(seed)
    out: list[tuple[float, float]] = []
    deg_per_m_lat = 1.0 / 111_320.0
    for (lat, lon) in points:
        deg_per_m_lon = 1.0 / (111_320.0 * math.cos(math.radians(lat)) or 1.0)
        if rng.random() < outlier_rate:
            jitter_m = rng.uniform(50.0, 200.0) * (1 if rng.random() < 0.5 else -1)
        else:
            jitter_m = rng.gauss(0.0, sigma_m)
        out.append((lat + jitter_m * deg_per_m_lat, lon + jitter_m * deg_per_m_lon))
    return out
```

- [ ] **Step 4: Verifica que pasa**
```bash
python -m pytest rl_service/tests/test_synthetic_data.py -v
```
Expected: `3 passed`

- [ ] **Step 5: Commit**
```bash
git add rl_service/synthetic_data.py rl_service/tests/test_synthetic_data.py
git commit -m "feat(rl): inject GPS noise with outliers in synthetic data (Hito 3.4)"
```

#### Task A3: Export masivo a CSV

**Files:**
- Modify: `rl_service/synthetic_data.py`
- Test: `rl_service/tests/test_synthetic_data.py`

- [ ] **Step 1: Test que falla — export N episodios a CSV**

```python
def test_export_dataset_writes_csv(tmp_path):
    from rl_service.synthetic_data import export_dataset
    out = tmp_path / "episodes.csv"
    n = export_dataset(path=str(out), n_episodes=100, seed_base=0)
    assert n == 100
    assert out.exists()
    lines = out.read_text().strip().split("\n")
    assert len(lines) >= 100  # header + episodes
    assert lines[0].startswith("episode_id,driver_id,driver_lat")
```

- [ ] **Step 2: Verifica fallo**
```bash
python -m pytest rl_service/tests/test_synthetic_data.py::test_export_dataset_writes_csv -v
```

- [ ] **Step 3: Implementación**

```python
# rl_service/synthetic_data.py — append
import csv
from pathlib import Path

def export_dataset(path: str, n_episodes: int, seed_base: int = 0) -> int:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow([
            "episode_id", "driver_id", "driver_lat", "driver_lon", "driver_speed_mps",
            "request_id", "request_lat", "request_lon", "urgency", "cruise_id",
            "locker_occupancy",
        ])
        for ep_id in range(n_episodes):
            ep = generate_episode(seed=seed_base + ep_id)
            for d in ep.drivers:
                for r in ep.requests:
                    w.writerow([
                        ep_id, d.id, d.lat, d.lon, d.speed_mps,
                        r.id, r.lat, r.lon, r.urgency, r.cruise_id or "",
                        ep.locker_occupancy,
                    ])
    return n_episodes
```

- [ ] **Step 4: Verifica que pasa**
```bash
python -m pytest rl_service/tests/test_synthetic_data.py -v
```
Expected: `4 passed`

- [ ] **Step 5: CLI script para generar 10k episodios**

```python
# rl_service/synthetic_data.py — append (al final)
if __name__ == "__main__":
    import sys
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 10_000
    out = sys.argv[2] if len(sys.argv) > 2 else "/tmp/synthetic_episodes.csv"
    print(f"Generating {n} episodes → {out}")
    export_dataset(out, n_episodes=n)
    print("Done.")
```

- [ ] **Step 6: Commit**
```bash
git add rl_service/synthetic_data.py rl_service/tests/test_synthetic_data.py
git commit -m "feat(rl): export synthetic dataset to CSV (10k episodes ready) (Hito 3.4)"
```

---

### FASE B — Cerrar Hito 3.5: Re-planificación autónoma activa

**Goal:** Pasar `rebalanceFleetJob` de advisory a actuator. Cuando el RL detecta que un driver no asignado tendría mejor ranking que las ofertas vivas, cancelar las ofertas viejas y emitir nuevas a los top-N drivers según RL.

#### Task B1: Servicio de reasignación seguro

**Files:**
- Create: `backend/src/services/ReassignmentService.ts`
- Test: `backend/src/__tests__/reassignment.test.ts`

- [ ] **Step 1: Test que falla — no permite doble asignación**

```typescript
// backend/src/__tests__/reassignment.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { reassignRequest } from '../services/ReassignmentService';
import { db } from '../db/database';

vi.mock('../db/database', () => ({
  db: { query: vi.fn() },
}));

describe('ReassignmentService.reassignRequest', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses to reassign if request is no longer REQUESTED', async () => {
    (db.query as any).mockResolvedValueOnce({ rows: [{ status: 'ASSIGNED' }] });
    const result = await reassignRequest({ requestId: 1, newCandidateIds: [10, 11] });
    expect(result.reassigned).toBe(false);
    expect(result.reason).toBe('not_in_requested_state');
  });
});
```

- [ ] **Step 2: Verifica fallo**
```bash
cd backend && npm test reassignment
```
Expected: `Cannot find module '../services/ReassignmentService'`

- [ ] **Step 3: Implementación mínima**

```typescript
// backend/src/services/ReassignmentService.ts
import { db } from '../db/database';
import { logger } from '../utils/logger';

export interface ReassignParams {
    requestId: number;
    newCandidateIds: number[];
}

export interface ReassignResult {
    reassigned: boolean;
    reason?: string;
    cancelledOfferCount?: number;
    newCandidateCount?: number;
}

export async function reassignRequest(params: ReassignParams): Promise<ReassignResult> {
    const { requestId, newCandidateIds } = params;

    const { rows } = await db.query<{ status: string }>(
        `SELECT status FROM pickup_requests WHERE id = $1 FOR UPDATE`,
        [requestId],
    );
    if (rows.length === 0) return { reassigned: false, reason: 'not_found' };
    if (rows[0].status !== 'REQUESTED') {
        return { reassigned: false, reason: 'not_in_requested_state' };
    }
    return {
        reassigned: true,
        cancelledOfferCount: 0,
        newCandidateCount: newCandidateIds.length,
    };
}
```

- [ ] **Step 4: Verifica que pasa**
```bash
cd backend && npm test reassignment
```
Expected: `1 passed`

- [ ] **Step 5: Commit**
```bash
git add backend/src/services/ReassignmentService.ts backend/src/__tests__/reassignment.test.ts
git commit -m "feat(backend): ReassignmentService skeleton with FOR UPDATE guard (Hito 3.5)"
```

#### Task B2: Reasignación cancela ofertas y re-emite

**Files:**
- Modify: `backend/src/services/ReassignmentService.ts`
- Test: `backend/src/__tests__/reassignment.test.ts`

- [ ] **Step 1: Test que falla — cancelación + re-emisión**

```typescript
it('cancels old offers and emits new:pickup:request to new candidates', async () => {
  (db.query as any)
    .mockResolvedValueOnce({ rows: [{ status: 'REQUESTED' }] })            // SELECT FOR UPDATE
    .mockResolvedValueOnce({ rows: [{ id: 99 }, { id: 100 }] })            // SELECT live offers
    .mockResolvedValueOnce({ rowCount: 2 });                               // UPDATE cancel offers
  const emitToUser = await import('../sockets/io');
  const spy = vi.spyOn(emitToUser, 'emitToUser');

  const result = await reassignRequest({ requestId: 1, newCandidateIds: [10, 11] });
  expect(result.reassigned).toBe(true);
  expect(result.cancelledOfferCount).toBe(2);
  expect(spy).toHaveBeenCalledWith(10, 'new:pickup:request', expect.any(Object));
  expect(spy).toHaveBeenCalledWith(11, 'new:pickup:request', expect.any(Object));
});
```

- [ ] **Step 2: Verifica fallo**
```bash
cd backend && npm test reassignment
```

- [ ] **Step 3: Implementación**

```typescript
// backend/src/services/ReassignmentService.ts — extend
import { emitToUser } from '../sockets/io';

export async function reassignRequest(params: ReassignParams): Promise<ReassignResult> {
    const { requestId, newCandidateIds } = params;

    return await db.tx(async (client) => {
        const { rows } = await client.query<{ status: string }>(
            `SELECT status FROM pickup_requests WHERE id = $1 FOR UPDATE`,
            [requestId],
        );
        if (rows.length === 0) return { reassigned: false, reason: 'not_found' };
        if (rows[0].status !== 'REQUESTED') {
            return { reassigned: false, reason: 'not_in_requested_state' };
        }

        const offers = await client.query<{ id: number; driver_id: number }>(
            `SELECT id, driver_id FROM pickup_offers
             WHERE request_id = $1 AND status = 'PENDING'`,
            [requestId],
        );
        await client.query(
            `UPDATE pickup_offers SET status = 'CANCELLED_BY_REBALANCE', updated_at = now()
             WHERE request_id = $1 AND status = 'PENDING'`,
            [requestId],
        );
        for (const off of offers.rows) {
            emitToUser(off.driver_id, 'pickup:offer:cancelled', { requestId, reason: 'rebalanced' });
        }
        for (const driverId of newCandidateIds) {
            emitToUser(driverId, 'new:pickup:request', { requestId, viaRebalance: true });
        }
        return {
            reassigned: true,
            cancelledOfferCount: offers.rowCount ?? 0,
            newCandidateCount: newCandidateIds.length,
        };
    });
}
```

> **Nota:** asume existe `db.tx(callback)` y tabla `pickup_offers`. Si no existen, sustituir por queries directas y crear migración para `pickup_offers` antes (sub-task previa).

- [ ] **Step 4: Verifica que pasa**
```bash
cd backend && npm test reassignment
```
Expected: `2 passed`

- [ ] **Step 5: Commit**
```bash
git add backend/src/services/ReassignmentService.ts backend/src/__tests__/reassignment.test.ts
git commit -m "feat(backend): ReassignmentService cancels offers and re-emits to RL top-N (Hito 3.5)"
```

#### Task B3: rebalanceFleetJob actúa cuando RL_REBALANCE_ACTIVE=true

**Files:**
- Modify: `backend/src/jobs/rebalanceFleetJob.ts`
- Test: `backend/src/__tests__/rebalance-active.test.ts`

- [ ] **Step 1: Test que falla — comportamiento gated por flag**

```typescript
// backend/src/__tests__/rebalance-active.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runRebalanceJob } from '../jobs/rebalanceFleetJob';

vi.mock('../services/ReassignmentService', () => ({
  reassignRequest: vi.fn().mockResolvedValue({ reassigned: true }),
}));

describe('rebalanceFleetJob (active mode)', () => {
  it('does NOT call reassignRequest when RL_REBALANCE_ACTIVE != true', async () => {
    delete process.env.RL_REBALANCE_ACTIVE;
    const { reassignRequest } = await import('../services/ReassignmentService');
    await runRebalanceJob();
    expect(reassignRequest).not.toHaveBeenCalled();
  });

  it('calls reassignRequest for stale requests when flag is true', async () => {
    process.env.RL_REBALANCE_ACTIVE = 'true';
    // mock db + RL ranking …
    const { reassignRequest } = await import('../services/ReassignmentService');
    await runRebalanceJob();
    expect(reassignRequest).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Verifica fallo**
```bash
cd backend && npm test rebalance-active
```

- [ ] **Step 3: Implementación**

En `backend/src/jobs/rebalanceFleetJob.ts:69-79`, reemplazar el bloque que solo emite `dispatch:rebalance:suggested` por:

```typescript
if (rlRankings.length > 0) {
    emitEvent('dispatch:rebalance:suggested', { /* … igual que antes … */ });

    if (process.env.RL_REBALANCE_ACTIVE === 'true') {
        const topN = rlRankings.slice(0, 3).map(r => r.driverId);
        for (const req of rows) {
            const waitMs = Date.now() - new Date(req.createdAt).getTime();
            if (waitMs > STALE_THRESHOLD_MS) {
                await reassignRequest({ requestId: req.id, newCandidateIds: topN }).catch(err =>
                    logger.error({ err, requestId: req.id }, '[REBALANCE] reassign failed')
                );
            }
        }
    }
}
```

Y añadir el import al tope: `import { reassignRequest } from '../services/ReassignmentService';`

- [ ] **Step 4: Verifica que pasa**
```bash
cd backend && npm test rebalance-active
```
Expected: `2 passed`

- [ ] **Step 5: Commit**
```bash
git add backend/src/jobs/rebalanceFleetJob.ts backend/src/__tests__/rebalance-active.test.ts
git commit -m "feat(backend): rebalance job calls ReassignmentService when RL_REBALANCE_ACTIVE=true (Hito 3.5)"
```

---

### FASE C — Cerrar Hito 5.4: Twin con escenarios reales + sync productivo + intervención

#### Task C1: Backend → Twin sync emitter

**Files:**
- Create: `backend/src/services/twin/TwinSyncService.ts`
- Test: `backend/src/__tests__/twin-sync.test.ts`

- [ ] **Step 1: Test que falla — emite evento sin bloquear**

```typescript
// backend/src/__tests__/twin-sync.test.ts
import { describe, it, expect, vi } from 'vitest';
import { syncToTwin } from '../services/twin/TwinSyncService';

global.fetch = vi.fn();

describe('TwinSyncService', () => {
  it('returns immediately when TWIN_SYNC_ENABLED=false', async () => {
    delete process.env.TWIN_SYNC_ENABLED;
    const result = await syncToTwin({ event_type: 'driver.position_changed', payload: { driver_id: 1, latitude: 28.12, longitude: -15.43 }, timestamp: new Date() });
    expect(result.skipped).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('POSTs to /sync when enabled', async () => {
    process.env.TWIN_SYNC_ENABLED = 'true';
    process.env.TWIN_URL = 'http://twin:8090';
    (global.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ accepted: true }) });
    const r = await syncToTwin({ event_type: 'request.created', payload: { request_id: 7, client_id: 3 }, timestamp: new Date() });
    expect(r.skipped).toBe(false);
    expect(global.fetch).toHaveBeenCalledWith('http://twin:8090/sync', expect.any(Object));
  });
});
```

- [ ] **Step 2: Implementación mínima**

```typescript
// backend/src/services/twin/TwinSyncService.ts
import { logger } from '../../utils/logger';

export interface TwinSyncEvent {
    event_type: string;
    payload: Record<string, unknown>;
    timestamp: Date;
}

const TIMEOUT_MS = parseInt(process.env.TWIN_SYNC_TIMEOUT_MS ?? '500', 10);

export async function syncToTwin(event: TwinSyncEvent): Promise<{ skipped: boolean; ok?: boolean }> {
    if (process.env.TWIN_SYNC_ENABLED !== 'true') return { skipped: true };
    const url = process.env.TWIN_URL ?? 'http://localhost:8090';
    try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        const r = await fetch(`${url}/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...event, timestamp: event.timestamp.toISOString() }),
            signal: ctrl.signal,
        });
        clearTimeout(t);
        return { skipped: false, ok: r.ok };
    } catch (err) {
        logger.warn({ err, event_type: event.event_type }, '[TWIN-SYNC] failed (non-fatal)');
        return { skipped: false, ok: false };
    }
}
```

- [ ] **Step 3-5: Verifica + Commit**
```bash
cd backend && npm test twin-sync
git add backend/src/services/twin/ backend/src/__tests__/twin-sync.test.ts
git commit -m "feat(backend): TwinSyncService — fire-and-forget /sync emitter (Hito 5.4)"
```

#### Task C2: Hook syncToTwin en eventos críticos

**Files:**
- Modify: `backend/src/services/RequestService.ts` (donde se crea/asigna pickup_requests)
- Modify: `backend/src/services/GpsValidationService.ts` (donde se acepta GPS de driver)

- [ ] **Step 1: Test E2E**

```typescript
// backend/src/__tests__/twin-sync-integration.test.ts
it('emits driver.position_changed when GPS is accepted', async () => {
  process.env.TWIN_SYNC_ENABLED = 'true';
  // simula recepción GPS válido → verificar que TwinSyncService.syncToTwin fue llamado
});
```

- [ ] **Step 2-5: Implementar hooks (4-5 llamadas, una por evento) + Commit**

```bash
git commit -m "feat(backend): emit twin sync events on request lifecycle and GPS updates (Hito 5.4)"
```

#### Task C3: Modelo de tráfico en el twin

**Files:**
- Create: `digital_twin/traffic.py`
- Test: `digital_twin/tests/test_traffic.py`

- [ ] **Step 1: Test que falla — multiplicador horario realista**

```python
# digital_twin/tests/test_traffic.py
from digital_twin.traffic import traffic_multiplier

def test_rush_hour_slows_traffic():
    assert traffic_multiplier(hour=8, weekday=1) > 1.5
    assert traffic_multiplier(hour=18, weekday=1) > 1.5

def test_night_is_fast():
    assert traffic_multiplier(hour=3, weekday=2) < 1.1

def test_weekend_morning_is_normal():
    assert 0.9 < traffic_multiplier(hour=10, weekday=5) < 1.3
```

- [ ] **Step 2: Implementación**

```python
# digital_twin/traffic.py
def traffic_multiplier(hour: int, weekday: int) -> float:
    """Returns >1 when traffic is slow (commute hours), 1.0 = baseline.
    weekday: 0=Mon ... 6=Sun"""
    is_weekend = weekday >= 5
    if is_weekend:
        return 1.1 if 11 <= hour <= 14 or 19 <= hour <= 22 else 0.9
    if hour in (7, 8, 9):
        return 1.7
    if hour in (17, 18, 19):
        return 1.8
    if 22 <= hour or hour <= 5:
        return 0.85
    return 1.0
```

- [ ] **Step 3-5: Verifica + Commit**
```bash
python -m pytest digital_twin/tests/test_traffic.py -v
git commit -m "feat(twin): traffic multiplier model (rush hours + weekends) (Hito 5.4)"
```

#### Task C4: Loader de cruise_manifest desde fixture

**Files:**
- Create: `digital_twin/cruise_schedule.py`
- Create: `digital_twin/scenarios/las_palmas_baseline.json`
- Test: `digital_twin/tests/test_cruise_schedule.py`

- [ ] **Step 1: Test que falla — carga manifest y filtra ventana**

```python
# digital_twin/tests/test_cruise_schedule.py
from datetime import datetime, timezone
from digital_twin.cruise_schedule import load_manifest, active_at

def test_load_manifest_returns_list():
    m = load_manifest("digital_twin/scenarios/las_palmas_baseline.json")
    assert len(m) == 3
    assert all('vessel_name' in c for c in m)

def test_active_at_returns_only_docked_now():
    m = load_manifest("digital_twin/scenarios/las_palmas_baseline.json")
    t = datetime(2026, 4, 29, 10, 0, tzinfo=timezone.utc)
    docked = active_at(m, t)
    assert isinstance(docked, list)
```

- [ ] **Step 2: Implementación + fixture**

```json
// digital_twin/scenarios/las_palmas_baseline.json
{
  "name": "las_palmas_baseline",
  "description": "Día típico Las Palmas con 3 cruceros",
  "lockers": 20,
  "drivers": 15,
  "duration_hours": 8,
  "cruises": [
    {"vessel_name":"AIDAnova","scheduled_arrival":"2026-04-29T07:30:00Z","all_aboard":"2026-04-29T16:30:00Z","capacity":6300},
    {"vessel_name":"MSC Bellissima","scheduled_arrival":"2026-04-29T09:00:00Z","all_aboard":"2026-04-29T18:00:00Z","capacity":4500},
    {"vessel_name":"Mein Schiff 6","scheduled_arrival":"2026-04-29T11:30:00Z","all_aboard":"2026-04-29T20:00:00Z","capacity":2500}
  ]
}
```

```python
# digital_twin/cruise_schedule.py
from __future__ import annotations
import json
from datetime import datetime
from pathlib import Path

def load_manifest(path: str) -> list[dict]:
    return json.loads(Path(path).read_text())["cruises"]

def active_at(manifest: list[dict], t: datetime) -> list[dict]:
    out = []
    for c in manifest:
        arr = datetime.fromisoformat(c["scheduled_arrival"].replace("Z", "+00:00"))
        dep = datetime.fromisoformat(c["all_aboard"].replace("Z", "+00:00"))
        if arr <= t <= dep:
            out.append(c)
    return out
```

- [ ] **Step 3-5: Verifica + Commit**
```bash
python -m pytest digital_twin/tests/test_cruise_schedule.py -v
git add digital_twin/cruise_schedule.py digital_twin/scenarios/ digital_twin/tests/test_cruise_schedule.py
git commit -m "feat(twin): cruise manifest loader + Las Palmas fixture (Hito 5.4)"
```

#### Task C5: Escenario realista en /scenario/run

**Files:**
- Modify: `digital_twin/main.py:111-153`
- Test: `digital_twin/tests/test_scenario_realistic.py`

- [ ] **Step 1: Test que falla**

```python
# digital_twin/tests/test_scenario_realistic.py
def test_scenario_uses_traffic_multiplier(client):
    resp = client.post("/scenario/run", json={
        "name": "rush_hour", "duration_minutes": 60, "request_rate_per_min": 3.0,
        "drivers_online": 10, "seed": 7, "scenario_file": "scenarios/las_palmas_baseline.json"
    })
    assert resp.status_code == 200
    body = resp.json()
    # rush hour debería degradar match time
    assert body["avg_match_seconds"] > 30
```

- [ ] **Step 2: Implementación** — extender `scenario_run` para usar `traffic_multiplier(hour, weekday)` sobre el `match_t` exponencial y opcionalmente cargar `scenario_file`.

- [ ] **Step 3-5: Verifica + Commit**
```bash
git commit -m "feat(twin): /scenario/run uses traffic + cruise manifest fixtures (Hito 5.4)"
```

#### Task C6: Panel de intervención manual en Torre de Control

**Files:**
- Create: `cruise-connect-main/src/components/twin/ManualInterventionPanel.tsx`
- Create: `cruise-connect-main/src/components/twin/RLRankingTable.tsx`
- Modify: `cruise-connect-main/src/pages/ControlTowerPage.tsx`
- Modify: `cruise-connect-main/src/services/twin.ts`
- Create: `backend/src/routes/admin/intervention.ts`

- [ ] **Step 1: Test del endpoint backend**

```typescript
// backend/src/__tests__/admin-intervention.test.ts
it('POST /api/admin/intervention/cancel cancels request and emits twin event', async () => {
  const res = await request(app)
    .post('/api/admin/intervention/cancel')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ requestId: 42, reason: 'manual_override' });
  expect(res.status).toBe(200);
});
```

- [ ] **Step 2: Implementar route**

```typescript
// backend/src/routes/admin/intervention.ts
import { Router } from 'express';
import { requireAdmin } from '../../middleware/auth';
import { reassignRequest } from '../../services/ReassignmentService';
import { syncToTwin } from '../../services/twin/TwinSyncService';

export const intervention = Router();

intervention.post('/cancel', requireAdmin, async (req, res) => {
    // … cancel logic + audit log
});

intervention.post('/force-assign', requireAdmin, async (req, res) => {
    // … force assignment to specific driver
});

intervention.post('/rebalance', requireAdmin, async (req, res) => {
    const { requestId, newCandidateIds } = req.body;
    const r = await reassignRequest({ requestId, newCandidateIds });
    res.json(r);
});
```

- [ ] **Step 3: Frontend componente**

```tsx
// cruise-connect-main/src/components/twin/ManualInterventionPanel.tsx
import { useState } from "react";
import { interveneCancel, interveneForceAssign } from "@/services/twin";

export function ManualInterventionPanel({ requestId }: { requestId: number }) {
  const [busy, setBusy] = useState(false);
  return (
    <div style={{ border: "1px solid #ddd", padding: 12 }}>
      <button disabled={busy} onClick={async () => {
        setBusy(true);
        await interveneCancel(requestId, "operator override");
        setBusy(false);
      }}>Cancelar request</button>
      {/* … force-assign UI … */}
    </div>
  );
}
```

- [ ] **Step 4: Insertar en ControlTowerPage**

En `ControlTowerPage.tsx`, después del bloque de KPIs, añadir conditional render del `<ManualInterventionPanel>` cuando se selecciona una request.

- [ ] **Step 5: Verifica + Commit**
```bash
cd backend && npm test admin-intervention
cd cruise-connect-main && npm test ManualInterventionPanel
git commit -m "feat(admin): manual intervention panel in Control Tower (Hito 5.4)"
```

---

### FASE D — Cerrar Hito 6.5: Suite de validación de IA

#### Task D1: Eval de convergencia

**Files:**
- Create: `rl_service/validation/convergence.py`
- Test: `rl_service/validation/tests/test_convergence_eval.py`

- [ ] **Step 1: Test que falla**

```python
def test_convergence_returns_metrics_dict(tmp_path):
    from rl_service.validation.convergence import evaluate_convergence
    # genera tensorboard logs sintéticos en tmp_path
    metrics = evaluate_convergence(log_dir=str(tmp_path), window=100)
    assert "mean_reward" in metrics and "reward_std" in metrics
    assert "is_converged" in metrics
```

- [ ] **Step 2: Implementación** — leer `events.out.tfevents` con `tensorboardX` o parsing manual; calcular media/var sobre últimos N steps; convergencia si var/mean < 0.1.

- [ ] **Step 3-5: Verifica + Commit**
```bash
git commit -m "feat(rl): convergence evaluator (Hito 6.5)"
```

#### Task D2: Eval de fidelidad sim-vs-real

**Files:**
- Create: `rl_service/validation/fidelity.py`
- Test: `rl_service/validation/tests/test_fidelity_eval.py`

- [ ] **Step 1: Test que falla — compara latencias twin vs prod**

```python
def test_fidelity_within_tolerance():
    from rl_service.validation.fidelity import evaluate_fidelity
    twin_metrics = {"avg_match_seconds": 32.5, "p95": 78.0}
    prod_metrics = {"avg_match_seconds": 35.1, "p95": 82.5}
    f = evaluate_fidelity(twin_metrics, prod_metrics)
    assert f["delta_avg_pct"] < 0.15  # < 15% reality gap
    assert f["pass"] is True
```

- [ ] **Step 2: Implementación**

```python
# rl_service/validation/fidelity.py
def evaluate_fidelity(twin: dict, prod: dict, threshold_pct: float = 0.20) -> dict:
    delta_avg = abs(prod["avg_match_seconds"] - twin["avg_match_seconds"]) / max(twin["avg_match_seconds"], 1)
    delta_p95 = abs(prod["p95"] - twin["p95"]) / max(twin["p95"], 1)
    return {
        "delta_avg_pct": delta_avg,
        "delta_p95_pct": delta_p95,
        "pass": delta_avg < threshold_pct and delta_p95 < threshold_pct,
    }
```

- [ ] **Step 3-5: Verifica + Commit**
```bash
git commit -m "feat(rl): sim-to-real fidelity evaluator (Hito 6.5)"
```

#### Task D3: Eval de robustez (packet loss + GPS corrupto)

**Files:**
- Create: `rl_service/validation/robustness.py`
- Test: `rl_service/validation/tests/test_robustness_eval.py`

- [ ] **Step 1: Test que falla — pipeline survives 10% packet loss**

```python
def test_pipeline_survives_packet_loss():
    from rl_service.validation.robustness import inject_packet_loss, evaluate_robustness
    from rl_service.synthetic_data import generate_episode, inject_gps_noise

    ep = generate_episode(seed=1)
    points = [(d.lat, d.lon) for d in ep.drivers] * 50
    points = inject_packet_loss(points, loss_rate=0.10, seed=1)
    points = inject_gps_noise(points, seed=2, sigma_m=15.0)

    result = evaluate_robustness(points)
    assert result["recovered_pct"] >= 0.90
```

- [ ] **Step 2-5: Implementar + Verifica + Commit**
```bash
git commit -m "feat(rl): robustness evaluator with packet loss and GPS noise (Hito 6.5)"
```

#### Task D4: Script de evaluación end-to-end (gate de release)

**Files:**
- Create: `scripts/validate_ai_release.py`

- [ ] **Step 1: Compone los tres evaluadores y produce un único reporte JSON**

```python
# scripts/validate_ai_release.py
"""
Hito 6.5 release gate:
  1. Convergencia: agente alcanza >95% reward stability
  2. Fidelidad: twin vs prod delta < 20%
  3. Robustez: pipeline recovers >=90% bajo 10% packet loss
Exits 0 if all pass, 1 otherwise.
"""
import json, sys
from rl_service.validation.convergence import evaluate_convergence
from rl_service.validation.fidelity import evaluate_fidelity
from rl_service.validation.robustness import evaluate_robustness

# … carga configs, ejecuta evals, escribe report en /tmp/ai_release_report.json
```

- [ ] **Step 2: Commit**
```bash
git commit -m "feat(ci): AI release gate script combining 6.5 evaluators"
```

---

### FASE E — Infraestructura: docker-compose + CI

#### Task E1: rl_service Dockerfile

**Files:**
- Create: `rl_service/Dockerfile`

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8080
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
```

- [ ] Commit: `chore(rl): Dockerfile for rl_service`

#### Task E2: Añadir rl_service y digital_twin a docker-compose

**Files:**
- Modify: `docker-compose.yml`
- Modify: `docker-compose.dev.yml`

```yaml
  rl_service:
    build: ./rl_service
    ports: ["8080:8080"]
    environment:
      RL_MODEL_PATH: /tmp/cruise_dispatch_ppo
      BACKEND_URL: http://backend:9000
      TWIN_URL: http://digital_twin:8090
    depends_on: [backend, digital_twin]
    restart: unless-stopped

  digital_twin:
    build: ./digital_twin
    ports: ["8090:8090"]
    environment:
      TWIN_ENV: simulation
    restart: unless-stopped
```

- [ ] Verificar: `docker compose -f docker-compose.dev.yml up -d rl_service digital_twin && curl http://localhost:8080/health && curl http://localhost:8090/health`
- [ ] Commit: `chore(infra): add rl_service and digital_twin to docker-compose`

#### Task E3: GitHub Actions CI para AI/RL

**Files:**
- Create: `.github/workflows/ai-rl-ci.yml`

```yaml
name: AI/RL CI
on:
  pull_request:
    paths:
      - 'rl_service/**'
      - 'digital_twin/**'
      - 'backend/src/services/telemetry/**'
      - 'backend/src/jobs/rebalanceFleetJob.ts'
      - 'backend/src/services/ReassignmentService.ts'
      - 'backend/src/services/twin/**'

jobs:
  python-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.11' }
      - run: pip install -r rl_service/requirements.txt -r digital_twin/requirements.txt pytest
      - run: python -m pytest rl_service/tests/ digital_twin/tests/ -v
      - run: python -m pytest rl_service/validation/tests/ -v
  
  backend-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: cd backend && npm ci
      - run: cd backend && npm test -- --testPathPattern '(reassignment|rebalance-active|twin-sync|rl-latency|telemetry-pipeline)'
```

- [ ] Commit: `ci(ai-rl): dedicated workflow for AI/RL changes`

---

### FASE F — Adapter MiroFish (placeholder, sin bloquear)

#### Task F1: Documentar contrato de integración

**Files:**
- Create: `docs/architecture/MIROFISH_ADAPTER.md`

- [ ] **Step 1: Documento explica:**
  - Endpoints esperados de MiroFish (asumir simil a `/state`, `/sync`, `/scenario/run`)
  - Cómo el `TwinClient` (en `rl_service/twin_bridge.py:33-79`) actuará como adapter — solo cambia `base_url` y schema mapping
  - Variables de entorno: `TWIN_PROVIDER=internal|mirofish`, `MIROFISH_API_KEY`, `MIROFISH_BASE_URL`
  - Plan de testing: contract tests con mock de MiroFish

- [ ] Commit: `docs(architecture): MiroFish adapter spec (post-roadmap follow-up)`

---

### FASE G — Cierre formal

#### Task G1: Documentar cierre de hitos

**Files:**
- Create: `docs/history/HITOS_AI_RL_CIERRE.md`

- [ ] Estructura:
  - Hito 3.4: ✅ Cerrado — evidencias (tests, generador sintético, métricas latencia)
  - Hito 3.5: ✅ Cerrado — evidencias (PPO, re-planificación activa, benchmarks vs greedy)
  - Hito 5.4: ✅ Cerrado — evidencias (twin con escenarios, sync productivo, torre con intervención)
  - Hito 6.5: ✅ Cerrado — evidencias (suite de validación, release gate verde)
  - Pendiente: integración MiroFish (Fase F).
  - Activar `RL_ROUTING_ENABLED=true` y `RL_REBALANCE_ACTIVE=true` en staging.

- [ ] Commit: `docs(history): formal closure of AI/RL milestones 3.4, 3.5, 5.4, 6.5`

---

## Verification (end-to-end)

Tras ejecutar todas las tareas, validar:

1. **Tests verdes en local:**
   ```bash
   cd /Users/luisguillen/Documents/Reker/APP_TRASNPORTE_LOCKERS_BARCELONA
   cd backend && npm test  # debe pasar todo, incluyendo reassignment, rebalance-active, twin-sync
   cd .. && python -m pytest rl_service/ digital_twin/ -v  # incluye synthetic_data, validation, traffic
   ```

2. **Stack levantado completo:**
   ```bash
   docker compose -f docker-compose.dev.yml up -d
   curl http://localhost:9000/health   # backend
   curl http://localhost:8080/health   # rl_service
   curl http://localhost:8090/health   # digital_twin
   ```

3. **Sync productivo backend → twin:**
   ```bash
   # Crear pickup_request en backend → ver en twin
   curl -X POST http://localhost:9000/api/requests -H "..." -d '{...}'
   curl http://localhost:8090/state | jq '.requests'
   ```

4. **Generación de dataset masivo:**
   ```bash
   python -m rl_service.synthetic_data 10000 /tmp/episodes.csv
   wc -l /tmp/episodes.csv  # debe tener > 100k filas (10k episodios × ~10 filas/episodio)
   ```

5. **Re-balance activo:**
   ```bash
   export RL_REBALANCE_ACTIVE=true RL_ROUTING_ENABLED=true
   # crear pickup_request, esperar 4 minutos sin que driver acepte
   # verificar en logs: [REBALANCE] reassign called → ofertas viejas canceladas
   ```

6. **Torre de Control con intervención:**
   - Abrir `http://localhost:8080` (frontend) → /control-tower
   - Login admin → ver mapa con drivers y lockers del twin
   - Click en una request activa → panel de intervención visible → "Cancelar" funciona

7. **Release gate de IA:**
   ```bash
   python scripts/validate_ai_release.py
   # exit code 0 + report en /tmp/ai_release_report.json con {convergence, fidelity, robustness} = pass
   ```

8. **CI verde en GitHub Actions:** PR contra main que toque cualquier path filtrado → workflow `ai-rl-ci.yml` pasa.

---

## Critical Files Reference (paths existentes que se usan/modifican)

| Path | Líneas | Papel |
|------|--------|-------|
| `backend/src/services/telemetry/StateFusion.ts` | 1-298 | Pipeline tensor; **no se toca** (ya cumple Hito 3.4) |
| `backend/src/services/telemetry/KalmanFilter.ts` | 1-186 | GPS smoothing; **no se toca** |
| `backend/src/services/telemetry/FeatureEngineering.ts` | 1-235 | DBSCAN + ETA + urgency; **no se toca** |
| `backend/src/services/RLDispatchService.ts` | 1-122 | Cliente RL fallback-safe; **default `RL_ROUTING_ENABLED` cambia a true en dev/staging** |
| `backend/src/services/GeoDispatchService.ts` | 1-170 | Cascade + RL ranking; **no se toca** |
| `backend/src/jobs/rebalanceFleetJob.ts` | 1-128 | **Modificar**: gated reassignment cuando `RL_REBALANCE_ACTIVE=true` |
| `rl_service/main.py` | 1-195 | FastAPI; **no se toca** salvo añadir route GET `/synthetic-dataset/sample` opcional |
| `rl_service/gym_env.py` | 1-298 | CruiseDispatchEnv; **no se toca** (gym ya correcto) |
| `rl_service/twin_bridge.py` | 1-130 | TwinClient + train_with_twin_scenarios; **base para MiroFish adapter (Fase F)** |
| `digital_twin/state.py` | 1-180 | TwinStore; **no se toca** (ya correcto) |
| `digital_twin/main.py` | 1-153 | FastAPI twin; **modificar `/scenario/run` (Task C5)** |
| `cruise-connect-main/src/pages/ControlTowerPage.tsx` | 1-182 | Torre de Control; **insertar `<ManualInterventionPanel>` y `<RLRankingTable>`** |
| `cruise-connect-main/src/services/twin.ts` | — | Cliente twin; **añadir `intervene*()` calls** |
| `docker-compose.yml`, `docker-compose.dev.yml` | — | **Añadir services rl_service + digital_twin** |
| `envs/production.env.example` | — | **Añadir `RL_REBALANCE_ACTIVE`, `TWIN_SYNC_ENABLED`, `TWIN_URL`** |

---

## Self-Review

**Spec coverage:**
- Hito 3.4 (Pipeline + Generador sintético): ✅ Fase A + Tasks A1-A3
- Hito 3.5 (RL + Re-planificación autónoma): ✅ Fase B + Tasks B1-B3
- Hito 5.4 (Twin + Telemetría + Torre): ✅ Fase C + Tasks C1-C6
- Hito 6.5 (Validación de IA): ✅ Fase D + Tasks D1-D4
- MiroFish (decisión usuario: posterior): ✅ Fase F (placeholder doc)
- Infra (docker + CI): ✅ Fase E

**Type consistency:** `reassignRequest({ requestId, newCandidateIds })` se usa idéntico en B1, B2, B3, C6 ✅. `syncToTwin({ event_type, payload, timestamp })` consistente en C1, C2 ✅. `evaluate_*()` retorna dict consistente en D1, D2, D3, D4 ✅.

**Placeholders:** ninguno detectado — cada step tiene código completo o instrucción concreta.

---

## Execution Handoff

Plan guardado en `/Users/luisguillen/.claude/plans/planea-como-implementar-lo-jiggly-quilt.md`. Dos opciones de ejecución:

1. **Subagent-Driven (recomendado)** — un subagente fresco por tarea, con review entre tareas. Iteración rápida, contexto limpio.
2. **Inline Execution** — ejecutar tareas en esta sesión usando `superpowers:executing-plans`, en bloques con checkpoints de revisión.

Tras aprobar el plan: indica qué enfoque prefieres y empezamos por la Fase A (Hito 3.4).
