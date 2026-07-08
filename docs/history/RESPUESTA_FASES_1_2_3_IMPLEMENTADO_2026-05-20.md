# Respuesta técnica consolidada sobre Fases 1, 2 y 3

Fecha de revisión: 2026-05-20  
Base: revisión directa del repo local `APP_TRASNPORTE_LOCKERS_BARCELONA`

## Criterio de esta respuesta

Este documento responde **solo según lo implementado y trazable en el repo**.  
Cuando algo **no está demostrado** por código, tests, fixtures o documentación interna del proyecto, se indica explícitamente como:

- **Implementado**
- **Implementado parcialmente**
- **No encontrado en el repo**
- **Inferido a partir del código, no de una ejecución registrada**

---

## Fase 1 — Pipeline de datos y entorno sintético

### Respuesta corta

Sí, hay un pipeline implementado, pero **no como ETL batch clásico**. Lo que existe en el repo es:

1. **Ingesta online de telemetría GPS** vía Socket.IO.
2. **Validación anti-spoofing** y persistencia en PostgreSQL.
3. **Feature engineering** sobre Postgres/PostGIS.
4. **Fusión de estado** en un `StateTensor` para el microservicio RL.
5. **Snapshots JSONB** para depuración/offline.
6. **Generación/simulación sintética** tanto para episodios RL como para telemetría/GPS/cruceros/ocupación de lockers.

No he encontrado un pipeline tipo Kafka/Airflow/Flink/Spark ni una ingesta histórica masiva separada del backend operativo.

### Flujo implementado

```text
Driver app/socket
  -> event "driver:location:update"
  -> validateAndRecord()
  -> tabla gps_positions
  -> buildStateTensor()
      -> Kalman smoothing
      -> demand density (PostGIS ST_ClusterDBSCAN)
      -> urgency (cruise_manifest)
      -> locker summary
  -> /api/internal/state-tensor
  -> rl_service /assign
```

### Fragmentos de código representativos

#### 1. Ingesta GPS en backend Node.js

Archivo: `backend/src/sockets/io.ts`

```ts
socket.on("driver:location:update", async (data: DriverLocationPayload) => {
  const gpsResult = await validateAndRecord(
    user.id, data.lat, data.lon,
    Number.isFinite(data.deviceTs) ? data.deviceTs : null
  );

  if (!gpsResult.ok) {
    socket.emit('gps:anomaly', { anomaly: gpsResult.anomaly, reason: gpsResult.reason });
    return;
  }

  db.query(
    `UPDATE users SET latitude = $1, longitude = $2,
     location = ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
     WHERE id = $3`,
    [data.lat, data.lon, user.id]
  )
})
```

#### 2. Validación y persistencia de GPS

Archivo: `backend/src/services/GpsValidationService.ts`

```ts
await db.query(
  `INSERT INTO gps_positions (user_id, lat, lon, device_ts, server_ts)
   VALUES ($1, $2, $3, $4, NOW())`,
  [userId, lat, lon, deviceTsMs != null ? new Date(deviceTsMs).toISOString() : null]
)
```

La validación implementada comprueba:

- deriva temporal `deviceTs` vs `serverTs`
- velocidad máxima entre fixes consecutivos

#### 3. Feature engineering espacial con PostGIS

Archivo: `backend/src/services/telemetry/FeatureEngineering.ts`

```ts
SELECT
    id,
    latitude,
    longitude,
    ST_ClusterDBSCAN(pickup_location_geo, $1, $2) OVER () AS cluster_id
FROM pickup_requests
WHERE status IN ('REQUESTED', 'ACCEPTED', 'CONFIRMATION_PENDING')
```

Esto sí demuestra uso real de PostGIS dentro del pipeline de features.

#### 4. Fusión del estado para RL

Archivo: `backend/src/services/telemetry/StateFusion.ts`

```ts
const [drivers, demandClusters, urgency, lockers, countResult] = await Promise.all([
  buildDriverStates(assignments),
  computeDemandDensity(),
  computeUrgency(),
  buildLockerSummary(),
  db.query(`SELECT COUNT(*)::integer AS count
            FROM pickup_requests
            WHERE status NOT IN ('PICKED_UP', 'CANCELLED')`)
]);
```

#### 5. Exposición del tensor interno

Archivo: `backend/src/routes/internal.ts`

```ts
internalRouter.get('/state-tensor', async (req, res) => {
  const tensor = await buildStateTensor();
  saveSnapshot(tensor).catch(() => {});
  res.json(tensor);
});
```

#### 6. Generación de episodios sintéticos para RL

Archivo: `rl_service/synthetic_data.py`

```py
def generate_episode(seed: int, n_drivers: int = 8, n_requests: int = 12,
                     cruise_urgent_rate: float = 0.30) -> SyntheticEpisode:
    drivers = tuple(...)
    requests = tuple(
        SyntheticRequest(
            urgency=(rng.uniform(0.65, 1.0) if rng.random() < cruise_urgent_rate
                     else rng.uniform(0.0, 0.5)),
            cruise_id=rng.randint(100, 200) if rng.random() < 0.2 else None,
        )
    )
```

#### 7. Simulación sintética operativa de GPS/cruceros/lockers

Archivo: `scripts/synthetic_data_generator.py`

```py
await sio.emit("location:update", {
    "lat": noisy_lat,
    "lon": noisy_lon,
    "accuracy": cfg.gps_noise_sigma_m,
    "timestamp": int(time.time() * 1000),
})
```

```py
cur.execute(
    """INSERT INTO cruise_manifest
       (vessel_name, scheduled_arrival, all_aboard, departure, status, estimated_passengers)
       VALUES (%s, %s, %s, %s, 'docked', %s)"""
)
```

```py
cur.execute(
    "UPDATE lockers SET is_occupied = %s, updated_at = NOW() WHERE id = %s",
    (should_occupy, locker_id),
)
```

### Esquema de base de datos PostGIS usado

El esquema está centralizado en `backend/src/db/schema.sql.ts`.

#### Extensión y columnas geoespaciales

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
```

```sql
location GEOGRAPHY(Point, 4326)
pickup_location_geo GEOGRAPHY(Point, 4326)
```

#### Tablas relevantes para Fase 1

##### `users`

- `latitude`, `longitude`
- `location GEOGRAPHY(Point, 4326)`

##### `merchants`

- `latitude`, `longitude`
- `location GEOGRAPHY(Point, 4326)`

##### `pickup_requests`

- `pickup_location`
- `latitude`, `longitude`
- `pickup_location_geo GEOGRAPHY(Point, 4326)`
- `status`
- `locker_id`
- `merchant_id`

##### `gps_positions`

- `user_id`
- `lat`, `lon`
- `accuracy_m`
- `device_ts`
- `server_ts`

##### `cruise_manifest`

- `vessel_name`
- `scheduled_arrival`
- `all_aboard`
- `departure`
- `estimated_passengers`
- `status`

##### `telemetry_state_snapshots`

- `snapshot JSONB`
- `driver_count`
- `active_request_count`
- `locker_occupancy_rate`
- `max_urgency`
- `created_at`

#### Índices espaciales y de soporte

```sql
CREATE INDEX IF NOT EXISTS idx_users_location ON users USING GIST(location);
CREATE INDEX IF NOT EXISTS idx_pickup_requests_location ON pickup_requests USING GIST(pickup_location_geo);
CREATE INDEX IF NOT EXISTS idx_merchants_location ON merchants USING GIST(location);
CREATE INDEX IF NOT EXISTS idx_gps_positions_user_ts ON gps_positions(user_id, server_ts DESC);
```

### Cómo se generan o simulan los datos

#### Cruceros

Hay dos mecanismos:

1. **Tabla operacional** `cruise_manifest`.
2. **Fixtures/escenarios** del twin:
   - `digital_twin/scenarios/las_palmas_baseline.json`
   - `digital_twin/scenarios/barcelona_peak.json`
3. **Inyección sintética online** con `scripts/synthetic_data_generator.py`.

El inyector crea cruceros con deadlines de `all_aboard` en 15, 30 o 60 minutos para tensionar la feature de urgencia.

#### GPS

Dos mecanismos:

1. **Ingesta realista simulada** por Socket.IO:
   - random walk de conductores
   - ruido gaussiano
   - outliers configurables
2. **Persistencia en `gps_positions`** para que luego el pipeline reconstruya tracks recientes y aplique Kalman.

#### Lockers IoT

No he encontrado firmware o simulador hardware de bajo nivel.

Lo implementado es:

1. **Modelo lógico de locker** en BD y twin.
2. **Adapters backend**:
   - `MockAdapter`
   - `RestAdapter`
3. **Simulación sintética de churn** en `scripts/synthetic_data_generator.py`, alterando `is_occupied`.

### Estadísticas del dataset sintético

#### Lo que sí existe en el repo

- Tests de robustez del pipeline con:
  - jitter GPS
  - outliers extremos
  - packet loss del 10%
  - gaps de más de 5 minutos
- Snapshots persistidos en `telemetry_state_snapshots`
- Generador exportable de episodios RL a CSV

#### Lo que no he encontrado

- **No he encontrado en el repo una gráfica ya generada** de distribución temporal del dataset sintético.
- **No he encontrado un CSV grande ya versionado** con estadísticas agregadas de los datos sintéticos.
- **No he encontrado un notebook o dashboard** con histogramas/series temporales del dataset sintético.

#### Tabla derivada a partir de los parámetros por defecto del código

Esto es **inferido del código**, no de una ejecución registrada:

| Fuente sintética | Parámetros por defecto | Volumen derivable |
|---|---|---|
| `rl_service/synthetic_data.py` | `n_drivers=8`, `n_requests=12` | `96` filas por episodio exportado (`8 x 12`) |
| `scripts/synthetic_data_generator.py --mode normal` | `5 drivers`, `120s`, `2s/fix`, `5%` outliers | aprox. `300` fixes GPS si todos los drivers autentican |
| `--mode stress` | `20 drivers`, `300s`, `0.5s/fix`, `15%` outliers | aprox. `12,000` fixes GPS |
| `--mode urgency` | `3 drivers`, `90s`, `5s/fix`, `2%` outliers | aprox. `54` fixes GPS |

#### Escenarios sintéticos del twin encontrados

| Escenario | Cruceros | Drivers | Lockers | Duración |
|---|---:|---:|---:|---:|
| `las_palmas_baseline` | 3 | 15 | 20 | 8 h |
| `barcelona_peak` | 4 | 18 | 28 | 10 h |

#### Seed fijo del twin

El `digital_twin` además arranca con:

- `35 lockers` en Las Palmas
- `3 drivers` seed

Esto sí está hardcodeado en `digital_twin/state.py`.

### Conclusión de Fase 1

La Fase 1 está **implementada parcialmente y de forma operativa** para:

- telemetría GPS
- fusión de estado
- uso de PostGIS
- simulación sintética de cruceros, GPS y ocupación de lockers

No queda demostrado en el repo un pipeline batch/data lake tradicional ni un informe estadístico ya generado del dataset sintético.

---

## Fase 2 — Agente RL (PPO) y Blockchain

### Respuesta corta

#### PPO

- **Sí hay implementación PPO real** en código.
- **Sí hay endpoint de entrenamiento y benchmark**.
- **Sí están los hiperparámetros finales en código**.
- **Sí están definidos espacio de estados y acciones**.
- **Sí existe comparación contra baselines**.
- **No he encontrado una curva real versionada reward vs episodios** generada a partir de un entrenamiento final ejecutado.
- **No he encontrado en el repo un checkpoint entrenado final versionado como artefacto**.

#### Blockchain

- **No he encontrado smart contracts, Solidity, chaincode de Hyperledger ni despliegue on-chain**.
- Lo implementado es una **cadena de custodia permisionada propia**, con:
  - firmas ECDSA de actores
  - HMAC-SHA256
  - hash chaining
  - quorum de 3 validadores
  - almacenamiento file-based o por HTTP entre validadores

Por tanto, si te preguntan “blockchain” en sentido estricto de smart contract/chaincode, la respuesta correcta según el repo es: **no está implementado como blockchain on-chain**.

### PPO: implementación encontrada

#### Hiperparámetros finales

Archivo: `rl_service/agent.py`

```py
model = PPO(
    policy="MlpPolicy",
    env=self._make_env(n_envs=8),
    learning_rate=1e-4,
    n_steps=1024,
    batch_size=256,
    n_epochs=10,
    gamma=0.99,
    gae_lambda=0.95,
    clip_range=0.2,
    ent_coef=0.005,
    policy_kwargs={"net_arch": [256, 256]},
)
```

Los mismos hiperparámetros aparecen también en `rl_service/benchmark.py`.

#### Espacio de estados y acciones en la implementación real

Archivo: `rl_service/gym_env.py`

- Observación:
  - `OBS_DIM = 69`
  - composición:
    - `MAX_DRIVERS=10`
    - `OBS_PER_DRIVER=5`
    - `MAX_CLUSTERS=5`
    - `OBS_PER_CLUSTER=3`
    - `OBS_GLOBAL=4`
- Acción:
  - `Discrete(MAX_DRIVERS=10)`

Resumen:

| Elemento | Valor |
|---|---:|
| Dimensión observación | `69` |
| Tipo observación | `Box(shape=(69,), float32, [0,1])` |
| Espacio de acciones | `Discrete(10)` |
| Nº máximo de drivers modelados | `10` |
| Nº máximo de clusters | `5` |

#### Reward implementado

```py
reward = (0.5 * target.urgency + 0.5 * (1.0 - eta_norm)) * 100.0
if target.urgency > 0.7 and eta_norm < 0.25:
    reward += 30.0
```

Acción inválida:

```py
reward = -10.0
```

### ¿Se ha entrenado el agente PPO?

#### Lo que sí está implementado

- `RLAgent.train(total_timesteps=100_000)`
- endpoint REST `/train`
- endpoint `/train_from_twin`
- benchmark con entrenamiento on-demand de un modelo canónico

#### Lo que no puedo afirmar con el repo

- **No puedo afirmar que exista un entrenamiento final ya ejecutado y congelado**.
- **No he encontrado curvas de convergencia reales ya exportadas**.
- **No he encontrado un artefacto `.zip` de modelo entrenado dentro del repo**.
- **No he encontrado una tabla de resultados final RL vs greedy con números cerrados persistidos**.

Conclusión precisa:

> Hay infraestructura completa para entrenar PPO, pero el repo no demuestra por sí solo un run final documentado con curvas reales de convergencia.

### Curvas de convergencia

#### Sí existe

- un evaluador de convergencia: `rl_service/validation/convergence.py`
- soporte para leer:
  - `rewards.csv`
  - `rewards.jsonl`
  - `events.out.tfevents.jsonl`
- una fixture de ejemplo: `rl_service/validation/fixtures/rewards.csv`

#### No existe

- **No he encontrado una imagen/gráfica committeada** de reward vs episodios.
- La fixture `rewards.csv` parece un dataset sintético/de prueba, no evidencia de un entrenamiento final.

### Comparativa con baseline

Sí existe comparativa contra baselines en `rl_service/benchmark.py` y `rl_service/tests/test_rl_benchmark.py`.

Baselines encontrados:

- `greedy`: conductor disponible con menor `eta_norm`
- `random`

Condiciones verificadas por test:

- greedy > random
- RL > random
- RL no debe degradarse por debajo del `55%` del reward medio de greedy
- RL no debe dejar más urgencia pendiente que greedy + 0.05

Importante:

- `docs/PHASE3_CLOSURE.md` afirma como criterio de aceptación “RL vs greedy, ≥10% improvement”.
- **Pero la evidencia automatizada del test no valida ese +10%**; lo que valida es una banda de no regresión `ratio >= 0.55`.

Eso conviene dejarlo muy claro en cualquier memoria.

### Blockchain / cadena de custodia

### Qué hay implementado realmente

Archivos clave:

- `backend/src/services/CustodyLedgerService.ts`
- `backend/src/routes/custody.ts`
- `backend/src/__tests__/custody-ledger.test.ts`
- `backend/src/__tests__/chain-of-custody.test.ts`

El sistema implementado es:

1. `storageMode: 'PERMISSIONED_CUSTODY_LEDGER'`
2. 3 validadores:
   - `ledger-a`
   - `ledger-b`
   - `ledger-c`
3. quórum mínimo de `2/3`
4. bloques con:
   - `previousBlockHash`
   - `blockHash`
   - `validatorCommitCertificate`
   - firmas de actores y atestación de sistema

#### Fragmento representativo

```ts
const VALIDATOR_IDS = ['ledger-a', 'ledger-b', 'ledger-c'] as const;
```

```ts
export interface CustodySummary {
    storageMode: 'PERMISSIONED_CUSTODY_LEDGER';
    blockHash: string;
    previousBlockHash: string | null;
    ledgerHeight: number;
    quorumProof: ValidatorVote[];
}
```

#### Evidencia explícita de que no es blockchain on-chain

Archivo: `backend/src/__tests__/chain-of-custody.test.ts`

```ts
 * El sistema NO usa blockchain on-chain — usa una cadena de custodia
```

### ¿Hay smart contracts o chaincode?

**No encontrado en el repo.**

No he encontrado:

- archivos `.sol`
- Hardhat/Foundry/Truffle
- chaincode de Hyperledger Fabric
- despliegues EVM
- ABIs
- tests de contratos

### ¿Hay fragmentos de código de transacciones?

Sí, pero **de transacciones del ledger interno**, no de blockchain on-chain.

Ejemplo conceptual:

- preparación de commit
- envío a validadores
- recogida de votos
- comprobación de quórum
- escritura de bloque
- verificación posterior

Eso existe en `CustodyLedgerService.ts`.

### ¿Resultados de throughput TPS?

**No he encontrado TPS del ledger/blockchain en el repo.**

Lo más cercano que sí existe es:

- `Env throughput = 41,159 steps/s`

pero esa cifra, documentada en `docs/devops/HITO_6_5_AI_VALIDATION.md`, corresponde al **throughput del entorno RL/simulador**, no al ledger ni a blockchain.

Conclusión:

> No hay evidencia en el repo de throughput TPS del sistema de custodia/ledger.

---

## Fase 3 — Gemelo Digital y Sim-to-Real

### Respuesta corta

- **Sí existe un digital twin interno implementado** en FastAPI.
- **Sí existe integración opcional con MiroFish** mediante adapter.
- **Sí existen escenarios sintéticos definidos**.
- **Sí existe evaluación de fidelity / reality gap**.
- **No he encontrado evidencia de una instancia viva de MiroFish usada en resultados finales**.
- **No he encontrado un protocolo formal y medido de “adaptación progresiva” más allá de train-from-twin + release gate + validaciones**.

### ¿Está configurado MiroFish?

#### Sí, a nivel de integración de software

Archivos:

- `rl_service/twin_mirofish_adapter.py`
- `rl_service/twin_bridge.py`
- `docs/architecture/MIROFISH_ADAPTER.md`
- `scripts/smoke_mirofish.py`
- tests:
  - `rl_service/tests/test_mirofish_adapter.py`
  - `rl_service/tests/test_smoke_mirofish.py`

Variables detectadas:

- `TWIN_PROVIDER=internal|mirofish`
- `MIROFISH_BASE_URL`
- `MIROFISH_API_KEY`
- `MIROFISH_PROJECT_ID`
- `MIROFISH_GRAPH_ID`
- `MIROFISH_SIMULATION_ID`

#### Pero no puedo afirmar operación real en entorno

No he encontrado en el repo:

- logs de una ejecución real contra una instancia MiroFish viva
- capturas de resultados reales persistidas
- métricas comparativas específicas “internal twin vs MiroFish”

Conclusión precisa:

> MiroFish está integrado a nivel de adapter y smoke tests, pero el repo no demuestra por sí solo una campaña real ejecutada sobre una instancia viva.

### Escenarios sintéticos corridos / definidos

#### Twin interno

Archivo: `digital_twin/main.py`

Existe endpoint:

- `POST /scenario/run`

Modelo:

- demanda poisson simplificada
- presión por tráfico
- presión por cruceros activos
- fallo si `match_t > 300s`

#### Escenarios JSON encontrados

##### `las_palmas_baseline`

- 3 cruceros
- 15 drivers
- 20 lockers
- 8 horas

Cruceros:

- `AIDAnova`
- `MSC Bellissima`
- `Mein Schiff 6`

Capacidad total inferida: `6300 + 4500 + 2500 = 13,300`

##### `barcelona_peak`

- 4 cruceros
- 18 drivers
- 28 lockers
- 10 horas

Cruceros:

- `Wonder of the Seas`
- `MSC World Europa`
- `Costa Toscana`
- `Norwegian Prima`

Capacidad total inferida: `6,988 + 6,334 + 6,554 + 3,215 = 23,091`

#### Seed base del twin

Además del escenario, el store del twin arranca con:

- `35 lockers`
- `3 drivers`

en `digital_twin/state.py`.

### Métricas de desviación simulación vs realidad (“reality gap”)

Sí existe soporte para medirlo.

Archivo: `rl_service/validation/fidelity.py`

La métrica usa:

- `avg_match_seconds`
- `p95_match_seconds`

y calcula:

- `delta_avg_pct`
- `delta_p95_pct`

con threshold por defecto del `20%`.

#### Fixtures encontradas

`rl_service/validation/fixtures/twin_metrics.json`

```json
{
  "avg_match_seconds": 32.5,
  "p95": 78.0
}
```

`rl_service/validation/fixtures/prod_metrics.json`

```json
{
  "avg_match_seconds": 35.1,
  "p95": 82.5
}
```

#### Cálculo derivado

Esto es **derivado de las fixtures**, no de un informe externo:

- `delta_avg_pct = |35.1 - 32.5| / 32.5 = 0.0800` → `8.0%`
- `delta_p95_pct = |82.5 - 78.0| / 78.0 = 0.0577` → `5.8%`

Con el threshold por defecto del `20%`, **pasaría**.

#### Importante

Esto **no demuestra comparación contra realidad operativa real de producción**; demuestra que el repo ya tiene el mecanismo y fixtures para esa validación.

### Resultados del protocolo de adaptación progresiva

#### Implementado

He encontrado:

- `train_with_twin_scenarios()` en `rl_service/twin_bridge.py`
- endpoint `/train_from_twin`
- release gate `scripts/validate_ai_release.py`
- validación de:
  - convergencia
  - fidelity
  - robustness

#### No encontrado

No he encontrado en el repo:

- un documento formal llamado “protocolo de adaptación progresiva”
- fases de rollout con porcentajes reales
- resultados de shadow mode / canary / A-B real
- tabla temporal de adaptación sim-to-real por iteraciones

Conclusión precisa:

> Sí hay pipeline técnico para sim-to-real y gate de validación; no he encontrado evidencia de un protocolo de adaptación progresiva ya ejecutado y documentado con resultados por etapas.

---

## Respuestas directas para reutilizar

### Fase 1

- **¿Pipeline de ingestión de datos implementado?**  
  Sí, pero orientado a telemetría operativa online, no a ETL batch clásico.

- **¿Esquema PostGIS?**  
  Sí: PostgreSQL + PostGIS con columnas `GEOGRAPHY(Point,4326)` en `users`, `merchants` y `pickup_requests`, más índices GIST.

- **¿Cómo se simulan cruceros/GPS/taquillas IoT?**  
  Cruceros: inserción en `cruise_manifest` y escenarios JSON.  
  GPS: Socket.IO + random walk + ruido gaussiano + outliers.  
  Lockers: churn de `is_occupied` y twin/adapters lógicos.

- **¿Estadísticas del dataset sintético?**  
  Hay parámetros y fixtures, pero no he encontrado una gráfica o informe agregado ya generado en el repo. Sí se pueden derivar volúmenes esperados desde el código.

### Fase 2

- **¿PPO entrenado?**  
  El entrenamiento está implementado, pero el repo no demuestra por sí solo un run final congelado con curvas reales de convergencia.

- **¿Hiperparámetros finales?**  
  Sí: `learning_rate=1e-4`, `gamma=0.99`, `clip_range=0.2`, `gae_lambda=0.95`, `n_steps=1024`, `batch_size=256`, `n_epochs=10`, `ent_coef=0.005`, red `[256,256]`.

- **¿Espacio real de estados/acciones?**  
  Estado `69`, acción discreta `10`.

- **¿Comparativa con baseline?**  
  Sí existe benchmark contra `greedy` y `random`, pero no he encontrado una tabla final de resultados numéricos persistida.

- **¿Blockchain/smart contracts/chaincode?**  
  No encontrado. Lo implementado es un ledger permisionado propio, no blockchain on-chain.

- **¿TPS?**  
  No encontrado para el ledger/custodia.

### Fase 3

- **¿MiroFish configurado?**  
  Sí, a nivel de integración por adapter y smoke tests. No queda demostrada una explotación real cerrada en entorno vivo.

- **¿Escenarios sintéticos?**  
  Sí: `las_palmas_baseline` y `barcelona_peak`, además del twin interno con seed de 35 lockers y 3 drivers.

- **¿Reality gap?**  
  Sí existe evaluación y fixtures; con las fixtures actuales el gap derivado es aprox. `8.0%` en media y `5.8%` en p95.

- **¿Adaptación progresiva?**  
  Hay soporte técnico (`train_from_twin` + validation gate), pero no he encontrado resultados documentados de un protocolo progresivo ejecutado por etapas.

---

## Archivos clave revisados

- `backend/src/db/schema.sql.ts`
- `backend/src/sockets/io.ts`
- `backend/src/services/GpsValidationService.ts`
- `backend/src/services/telemetry/FeatureEngineering.ts`
- `backend/src/services/telemetry/StateFusion.ts`
- `backend/src/routes/internal.ts`
- `scripts/synthetic_data_generator.py`
- `rl_service/synthetic_data.py`
- `rl_service/agent.py`
- `rl_service/gym_env.py`
- `rl_service/benchmark.py`
- `rl_service/tests/test_rl_benchmark.py`
- `rl_service/tests/test_rl_convergence.py`
- `backend/src/services/CustodyLedgerService.ts`
- `backend/src/__tests__/chain-of-custody.test.ts`
- `digital_twin/main.py`
- `digital_twin/state.py`
- `digital_twin/scenarios/las_palmas_baseline.json`
- `digital_twin/scenarios/barcelona_peak.json`
- `rl_service/twin_bridge.py`
- `rl_service/twin_mirofish_adapter.py`
- `rl_service/validation/fidelity.py`
- `rl_service/validation/convergence.py`
- `scripts/validate_ai_release.py`

