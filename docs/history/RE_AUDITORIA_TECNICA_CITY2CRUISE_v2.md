# RE-AUDITORÍA TÉCNICA — CITY2CRUISE: SHOP&DROP PORT HUB (v2)

**Fecha:** 24 de marzo de 2026
**Tipo:** Re-auditoría post-correcciones (seguimiento de auditoría v1)
**Proyecto:** City2Cruise — REKER Tech Solutions S.L.

---

## 1. Resumen ejecutivo

Tras la ejecución de los 30 pasos del plan de corrección derivado de la auditoría v1, el proyecto ha experimentado una **mejora sustancial**. El nivel de alineación con la memoria técnica ha pasado de un ~25-30% a un **~65-70%** estimado. Se han abordado correctamente la mayoría de las correcciones críticas de seguridad, se ha ampliado significativamente el modelo de datos, se han creado servicios desacoplados (AuditService, GeoDispatchService, RequestService, LockerService), se ha implementado el dashboard B2A, el sistema de merchants, Docker, PWA, CI/CD y tests tanto en backend como en frontend.

Sin embargo, **persisten hallazgos relevantes** que requieren atención, y se han detectado **nuevos problemas** introducidos durante las correcciones. Este documento detalla exhaustivamente qué se resolvió, qué queda pendiente, y qué problemas nuevos han aparecido.

**Alineación actual por área:**

| Área | Antes | Ahora | Comentario |
|------|-------|-------|------------|
| Seguridad (secretos, hashing) | 20% | 80% | JWT_SECRET rotado, códigos hasheados, .gitignore creado. Falta cifrado PII, device fingerprinting |
| Modelo de datos | 25% | 75% | 7 tablas vs 4 originales. Faltan campos menores y cruise_manifest incompleta |
| Servicios / Arquitectura | 15% | 70% | Service Layer creado. Falta Repository Pattern explícito |
| API B2A (APLP) | 0% | 80% | Endpoints de métricas, flota, auditoría implementados |
| Merchants B2B | 0% | 65% | CRUD completo pero sin flujo de aprobación ni API keys |
| Auditoría criptográfica | 0% | 90% | HMAC-SHA256, trail inmutable, verificación de firma |
| Testing backend | 40% | 70% | 8 archivos de test con 73+ test cases |
| Testing frontend | 0% | 40% | 4 archivos de test + 1 legacy |
| Infraestructura (Docker, CI) | 0% | 75% | Dockerfile, docker-compose, GitHub Actions, PWA |
| Base de datos (PostgreSQL) | 0% | 0% | **SIGUE siendo SQLite** — migración no realizada |
| Redis / Colas de mensajes | 0% | 0% | **No implementado** |
| Integración IoT | 0% | 0% | **No implementado** (fuera del alcance MVP) |
| Pasarela de pagos | 0% | 0% | **No implementado** |

---

## 2. Verificación paso a paso del plan de corrección

### FASE 0 — Seguridad inmediata

| Paso | Descripción | Estado | Evidencia | Observaciones |
|------|------------|--------|-----------|---------------|
| 1 | .gitignore + secretos | **COMPLETADO** | `backend/.gitignore` existe con .env, sqlite, node_modules, dist, coverage. `.env.example` creado. JWT_SECRET es hash de 64 chars hex. | ⚠️ El `.env` con el JWT_SECRET real SIGUE presente en el directorio del proyecto. Si el repo ya fue pusheado antes del .gitignore, el secreto sigue en el historial de git. |
| 2 | Fix AdminDashboard campos | **COMPLETADO** | AdminDashboard usa `total_requests`, `deposited_count`, `picked_up_count`. API admin retorna estos campos via subqueries. | Los campos coinciden correctamente entre frontend y backend. |
| 3 | URLs parametrizadas | **COMPLETADO** | `api.ts` usa `import.meta.env.VITE_API_URL`. `socket.ts` usa `import.meta.env.VITE_SOCKET_URL`. `.env` y `.env.example` creados en frontend. | Correcto, con fallback a localhost. |
| 4 | Hashear códigos | **COMPLETADO** | `RequestService.ts`: handshake_code y locker_code se hashean con bcrypt (10 rounds). Validación con `bcrypt.compare()`. Código plano solo se retorna una vez al usuario. | Implementación correcta. |

### FASE 1 — Modelo de datos y auditoría

| Paso | Descripción | Estado | Evidencia | Observaciones |
|------|------------|--------|-----------|---------------|
| 5 | Ampliar schema | **COMPLETADO** | Schema tiene: users, lockers, pickup_requests (~20 campos), notifications, audit_events, handshake_attempts, merchants. | ⚠️ Tabla `cruise_manifest` NO creada en el schema. Campos `vehicle_identifier`, `accessibility_profile`, `device_identifier` NO aparecen en tabla users. Campo `hub_id` y `last_sync_at` NO aparecen en tabla lockers. Ver hallazgos pendientes. |
| 6 | AuditService | **COMPLETADO** | `AuditService.ts` con `logAuditEvent()`, `getAuditTrail()`, `verifyEventSignature()`. HMAC-SHA256 con `crypto.timingSafeEqual()`. Fire-and-forget pattern. | Implementación sólida y resistente a timing attacks. |
| 7 | Rate limiting handshake | **COMPLETADO** | `RequestService.confirmHandshake()` cuenta intentos en `handshake_attempts` tabla. Max 3 fallos → 423 LOCKED. Audit event RATE_LIMIT_BLOCK. | Test completo con 8 test cases verificando progresión. |
| 8 | TTL locker code | **COMPLETADO** | `locker_code_expires_at` se calcula como `23:59:59.000Z` del día actual. Validación en `LockerService.openLocker()` con error 410 Gone. | ⚠️ PROBLEMA: La expiración usa `.split('T')[0] + 'T23:59:59.000Z'` — esto asume UTC. Si el servidor o usuario está en zona horaria diferente (Canarias = UTC+0/+1), el corte podría ser incorrecto durante horario de verano. |
| 9 | Validación GPS proximidad | **COMPLETADO** | `RequestService.confirmHandshake()` valida distancia < 0.05km (50m) si coordenadas proporcionadas. Error GPS_PROXIMITY_FAILED con distance_meters. | La validación es OPCIONAL (solo si lat/lon se envían). Correcto para compatibilidad. |
| 10 | Búsqueda cascada 3→5→7km | **COMPLETADO** | `GeoDispatchService.ts` con `startCascadeSearch()` implementando 3 fases con timeouts de 45s. Map de cascadas activas. `cancelCascade()` en aceptación. Escalación con status 'escalated'. | ⚠️ PROBLEMAS: (1) No hay garbage collection de cascadas completadas/canceladas en el Map — memory leak potencial. (2) Console.log mezclado con logger pino. (3) No se verifica si conductores ya notificados en fase anterior (podrían recibir notificación duplicada). |
| 11 | Parametrizar geo | **COMPLETADO** | `config.env.ts` tiene SERVICE_AREA_NAME, CENTER_LAT/LON, SCOPE. `locations.ts` usa config.SERVICE_AREA_SCOPE. `seed_lp.ts` creado con coordenadas de Las Palmas. | Correcto. Dos seeds disponibles: Barcelona y Las Palmas. |

### FASE 2 — Endpoints B2A y funcionalidades

| Paso | Descripción | Estado | Evidencia | Observaciones |
|------|------------|--------|-----------|---------------|
| 12 | Endpoints métricas B2A | **COMPLETADO** | `admin.ts`: GET /metrics/throughput, /metrics/timing, /fleet-status, /audit-trail/:id, /audit-trail (paginado). | ⚠️ `/admin/audit-trail` paginated query no tiene índice en created_at → puede ser lento con volumen. El endpoint /fleet-status obtiene `active_drivers` del Map de Socket.IO (no de BD) — correcto pero inconsistente con `on_delivery` que sí viene de BD. |
| 13 | AdminDashboard mejorado | **COMPLETADO** | 4 tabs: Métricas (KPI cards + gráfico barras), Flota, Usuarios, Auditoría. Usa recharts para gráficos. Loading states y error handling. | Implementación completa y funcional. |
| 14 | CRUD merchants | **COMPLETADO** | `merchants.ts`: POST /register (público), GET / (admin), GET /nearby (client), PUT /:id/status (admin), GET /:id (admin). Validación Zod. | ⚠️ PROBLEMAS: (1) POST /register es PÚBLICO — cualquiera puede registrar un merchant sin verificación. (2) No hay generación de api_key_hash (campo en schema pero nunca se rellena). (3) No hay flujo de aprobación automatizado. |
| 15 | Validación Zod todos los endpoints | **COMPLETADO** | `middleware/validateSchema.ts` creado. Schemas en `schemas/`: auth, request, locker. validateBody() aplicado en rutas. | ⚠️ PROBLEMA: `confirmDriverSchema` valida longitud de 4 chars para handshakeCode pero NO valida que sean solo dígitos (podría pasar "abcd"). `openLockerSchema` solo valida `min(1)`, no valida formato de 6 dígitos. |
| 16 | Categoría LARGE | **COMPLETADO** | Schema CHECK incluye SMALL/MEDIUM/LARGE. `RequestService.depositRequest()` mapea tamaños: SMALL→[S,M,L], MEDIUM→[M,L], LARGE→[L]. ClientDashboard tiene selector con 3 opciones. | ⚠️ DriverMap.tsx solo muestra "Pequeño" y "Mediano" en el popup — falta label "Grande" para LARGE. |
| 17 | Logging pino | **COMPLETADO** | `utils/logger.ts` con pino + pino-pretty para dev. Usado en server.ts, AuditService. | ⚠️ INCONSISTENCIA: `GeoDispatchService.ts` y `sockets/io.ts` usan `console.log()` en lugar de `logger`. No todo el código migró a pino. |
| 18 | Service Layer | **COMPLETADO** | `RequestService.ts` (9 funciones), `LockerService.ts` (2 funciones), `AuditService.ts`, `GeoDispatchService.ts`. Rutas delegated a servicios. | Buena separación. ⚠️ Nota: No se creó Repository Pattern explícito (las queries SQL siguen en los servicios, no en repositorios dedicados). Aceptable para el MVP. |

### FASE 3 — Infraestructura y PWA

| Paso | Descripción | Estado | Evidencia | Observaciones |
|------|------------|--------|-----------|---------------|
| 19 | Docker | **COMPLETADO** | `backend/Dockerfile` multi-stage (builder + runtime). `cruise-connect-main/Dockerfile` multi-stage (builder → nginx). `docker-compose.yml` (prod) y `docker-compose.dev.yml` (dev con hot-reload). `nginx.conf` con proxy a backend + WebSocket + SPA fallback. | ⚠️ PROBLEMAS: (1) docker-compose.yml prod usa `JWT_SECRET` inline como variable — debería venir de Docker secrets o env_file. (2) No hay health checks en los servicios. (3) El `backend/.dockerignore` existe pero el `Dockerfile` no se ha verificado que funcione (no se ha hecho docker build). (4) Base de datos SQLite en volumen — no viable para multi-instancia. |
| 20 | PWA | **COMPLETADO** | `public/manifest.json` con name, icons, display:standalone. `vite.config.ts` tiene VitePWA plugin con registerType:autoUpdate. Workbox caching: NetworkFirst para API, CacheFirst para assets. `index.html` tiene `<link rel="manifest">` y meta theme-color. | ⚠️ PROBLEMA: Solo 1 icono (favicon.ico 64x64). PWA requiere al menos iconos de 192x192 y 512x512 para pasar auditoría Lighthouse. No se generará prompt de instalación sin estos iconos. |
| 21 | Integrar DriverMap | **COMPLETADO** | `DriverDashboard.tsx` importa y renderiza DriverMap con props: center, radiusKm, pendingRequests, onAccept, isLoading. | DriverMap se usa correctamente. Bug menor en labels de tamaño (ver paso 16). |
| 22 | Limpiar código muerto | **COMPLETADO** | `pages/Index.tsx` eliminado. `hooks/use-toast.ts` eliminado. `components/ui/toaster.tsx` todavía existe pero es parte de shadcn/ui (no es dead code). | ⚠️ `src/test/example.test.ts` SIGUE existiendo. Contiene un test trivial (`expect(true).toBe(true)`) más un test de formatting de packageSize. Debería moverse a __tests__/ o eliminarse. |
| 23 | CI/CD GitHub Actions | **COMPLETADO** | `.github/workflows/ci.yml` con 3 jobs: backend-test (build + test), frontend-build (build solo), lint. Triggers en push main/develop y PR a main. | ⚠️ PROBLEMA CRÍTICO: El job `frontend-build` NO ejecuta tests. Debería incluir `npm test` o `npx vitest run`. El frontend tiene 4 archivos de tests que no se ejecutan en CI. |
| 24 | Configurar cobertura | **COMPLETADO** | `jest.config.ts`: collectCoverage:true, thresholds: branches 40%, functions 44%, lines 55%, statements 55%. Reporters: text, lcov, json-summary. | ⚠️ Thresholds muy por debajo del 80% que dice la memoria técnica. Esto es pragmático pero debería incrementarse progresivamente. La memoria dice >80%. |

### FASE 4 — Testing y documentación

| Paso | Descripción | Estado | Evidencia | Observaciones |
|------|------------|--------|-----------|---------------|
| 25 | Tests LoginPage + ProtectedRoute | **COMPLETADO** | `LoginPage.test.tsx`: 6 tests (render, campos, validación, submit). `ProtectedRoute.test.tsx`: 4+ tests (redirect sin token, render con auth, redirect por rol). | Tests bien estructurados con mocking de contexto y API. |
| 26 | Tests StatusBadge + NotificationBell | **COMPLETADO** | `StatusBadge.test.tsx`: Test parametrizado para 6 estados + verificación de clases CSS. `NotificationBell.test.tsx`: 6 tests (render, badge count, panel, empty state). | Cobertura adecuada de componentes. |
| 27 | Tests audit + cascade | **PARCIAL** | `audit.test.ts`: 12 tests completos (inserción, firma HMAC, verificación, tampering, flujo HTTP). | ⚠️ NO existe `cascade-search.test.ts`. El GeoDispatchService no tiene tests dedicados — solo se testea indirectamente via integration tests. |
| 28 | Tests merchants + admin metrics | **COMPLETADO** | `merchants.test.ts`: 13 tests (CRUD, validación, geo-nearby, duplicados). `admin-metrics.test.ts`: 11 tests (throughput, timing, fleet, audit trail, paginación). | Buena cobertura de endpoints admin y merchants. |
| 29 | k6 load testing | **COMPLETADO** | `k6/load-test.js` existe con 3 escenarios (smoke, average, peak). `k6/README.md` con instrucciones. | No se ha verificado ejecución. Thresholds: p95 < 500ms, error rate < 5%. |
| 30 | Documentación | **COMPLETADO** | `backend/README.md` con descripción, setup, API docs. `cruise-connect-main/README.md` actualizado. | Documentación funcional. |

---

## 3. Hallazgos nuevos detectados en esta re-auditoría

### 3.1 Campos del schema que NO se implementaron (Paso 5 incompleto)

Los siguientes campos/tablas descritos en el plan de corrección y la memoria técnica NO fueron creados en `schema.sql.ts`:

| Elemento | Descrito en | Estado |
|----------|-------------|--------|
| Tabla `cruise_manifest` (vessel_name, scheduled_arrival, all_aboard, departure, passengers) | Plan paso 5, Memoria §modelo datos | **AUSENTE** |
| Campo `users.vehicle_identifier` (matrícula del conductor) | Plan paso 5 | **AUSENTE** |
| Campo `users.accessibility_profile` (standard/pmr/age_advanced) | Plan paso 5, Memoria §modelo datos | **AUSENTE** |
| Campo `users.device_identifier` (fingerprint de dispositivo) | Plan paso 5, Memoria §9.6 | **AUSENTE** |
| Campo `lockers.hub_id` (identificador de hub multi-punto) | Plan paso 5, Memoria §4.4.4 | **AUSENTE** |
| Campo `lockers.size_category` (S/M/L) | Plan paso 5 | **EXISTE** en schema ✓ |
| Campo `lockers.last_sync_at` | Plan paso 5 | **AUSENTE** |
| Campo `pickup_requests.merchant_id` (FK a merchants) | Plan paso 5, Memoria §modelo datos | **AUSENTE** — No se vinculan solicitudes con merchants |
| Campo `pickup_requests.client_latitude/longitude` | Plan paso 5 | **EXISTE** indirectamente — se usa `latitude/longitude` en pickup_requests ✓ |

**Impacto:** MEDIO. Los campos ausentes no rompen funcionalidad actual pero son necesarios para alinear con la memoria y para features futuras (accesibilidad, multi-hub, trazabilidad de vehículos, integración con cruceros).

### 3.2 Problemas de seguridad persistentes

#### S01 — JWT_SECRET expuesto en .env dentro del repositorio

- **Situación:** El `.gitignore` se creó DESPUÉS de que el `.env` ya existiera en el directorio. Si este directorio fue commiteado previamente a un repo git, el secreto sigue en el historial.
- **Impacto:** ALTO si el repo es público o compartido.
- **Recomendación:** Rotar el JWT_SECRET inmediatamente si el repo fue compartido. Usar `git filter-branch` o BFG Repo Cleaner para purgar el historial.

#### S02 — jwtSecret tiene fallback a string hardcodeado en dev

- **Evidencia:** `config/env.ts` tiene: `jwtSecret: process.env.JWT_SECRET || 'dev_fallback_secret_...'`
- **Impacto:** MEDIO — Si alguien despliega sin variable de entorno, usa un secreto predecible.
- **Recomendación:** En producción, fallar ruidosamente si JWT_SECRET no está definido. Añadir validación: `if (!process.env.JWT_SECRET && config.env === 'production') throw new Error('JWT_SECRET required')`.

#### S03 — Merchant registration abierta sin autenticación

- **Evidencia:** POST /api/merchants/register no tiene `authMiddleware`.
- **Impacto:** MEDIO — Cualquiera puede registrar merchants falsos.
- **Recomendación:** Proteger con authMiddleware + requireRole('ADMIN'), o añadir captcha/verificación email.

#### S04 — Validación Zod incompleta en schemas de códigos

- **Evidencia:** `confirmDriverSchema` acepta cualquier string de 4 chars (no solo dígitos). `openLockerSchema` acepta cualquier string de min 1 char.
- **Impacto:** BAJO — bcrypt.compare() fallará igualmente, pero es mala práctica.
- **Recomendación:** `handshakeCode: z.string().regex(/^\d{4}$/)` y `lockerCode: z.string().regex(/^\d{6}$/)`.

#### S05 — Sin cifrado AES-256 para PII

- **Evidencia en memoria:** §9.6 describe "PII encrypted at application layer before database insertion" con AES-256.
- **Estado actual:** Emails, nombres, direcciones almacenados en texto plano en SQLite.
- **Impacto:** ALTO si se evalúa contra RGPD.
- **Recomendación:** Implementar campo-level encryption para datos sensibles, o documentar que para el MVP/piloto TRL 7 se acepta este riesgo.

#### S06 — Sin device fingerprinting en JWT

- **Evidencia en memoria:** §9.6 describe "JWT tokens include device_id hash derived from device hardware identifiers". Token transfer detection.
- **Estado actual:** JWT solo contiene {id, name, role}. No hay device_id.
- **Impacto:** MEDIO — Tokens pueden ser transferidos entre dispositivos.
- **Recomendación:** Añadir device fingerprint al token y validar en middleware.

### 3.3 Problemas funcionales

#### F01 — DriverMap no muestra etiqueta "Grande" para paquetes LARGE

- **Evidencia:** `DriverMap.tsx` tiene lógica ternaria para tamaño: `sizeLabel = 'Pequeño' : 'Mediano'` — falta tercera opción para LARGE.
- **Impacto:** BAJO — El conductor ve "Mediano" para paquetes LARGE.
- **Recomendación:** Cambiar a: `req.packageSize === 'SMALL' ? 'Pequeño' : req.packageSize === 'MEDIUM' ? 'Mediano' : 'Grande'`.

#### F02 — TTL de locker_code puede ser incorrecto por timezone

- **Evidencia:** Cálculo usa `new Date().toISOString().split('T')[0] + 'T23:59:59.000Z'` — siempre UTC.
- **Impacto:** MEDIO — En Canarias (UTC+0/+1), durante horario de verano (WEST, UTC+1) el corte de medianoche local sería a las 22:59 UTC, no 23:59.
- **Recomendación:** Usar zona horaria del área de servicio (Atlantic/Canary) para calcular medianoche local.

#### F03 — GeoDispatchService tiene memory leak potencial

- **Evidencia:** `activeCascades` Map nunca elimina entradas de cascadas completadas naturalmente (solo `cancelCascade` las limpia, y solo se llama cuando un conductor acepta). Si una cascada llega al final sin aceptación, los timeouts se ejecutan pero la entrada del Map persiste indefinidamente.
- **Impacto:** BAJO para MVP, ALTO para producción con volumen.
- **Recomendación:** Añadir limpieza automática al final de la cascada (en el último timeout) y un cleanup periódico.

#### F04 — renewHandshake existe en RequestService pero no se expone como endpoint funcional

- **Evidencia:** `RequestService.renewHandshake()` implementado. `routes/requests.ts` tiene ruta POST /:id/renew-handshake. `DriverDashboard.tsx` tiene botón que lo llama.
- **Estado:** FUNCIONAL — pero no tiene test dedicado.
- **Impacto:** BAJO.
- **Recomendación:** Añadir test para renovación de handshake.

#### F05 — No hay test para GeoDispatchService (cascada)

- **Evidencia:** `cascade-search.test.ts` NO fue creado (estaba en el plan como paso 27).
- **Impacto:** MEDIO — Feature crítica sin cobertura de test.
- **Recomendación:** Crear test que verifique: cascada 3→5→7, cancelación al aceptar, escalación tras 3 fases, cleanup de timeouts.

#### F06 — LockerService.openLocker() tiene complejidad O(N) con bcrypt

- **Evidencia:** Itera por TODAS las solicitudes DEPOSITED del cliente y hace `bcrypt.compare()` contra cada una para encontrar match.
- **Impacto:** BAJO para MVP (pocas solicitudes simultáneas). MEDIO para producción.
- **Recomendación:** Almacenar un hash de lookup rápido (SHA-256 del código) además del bcrypt, para filtrar candidatos antes de la comparación bcrypt costosa.

### 3.4 Problemas de infraestructura

#### I01 — CI pipeline no ejecuta tests del frontend

- **Evidencia:** `.github/workflows/ci.yml` job `frontend-build` solo hace `npm ci` + `npm run build`. No ejecuta `npx vitest run`.
- **Impacto:** ALTO — Los 4 archivos de tests frontend nunca se ejecutan en CI.
- **Recomendación:** Añadir `npm test` al job frontend-build o crear job separado `frontend-test`.

#### I02 — docker-compose.yml no tiene health checks

- **Evidencia:** Servicios backend y frontend sin healthcheck.
- **Impacto:** MEDIO — Docker no puede detectar si el servicio está realmente operativo.
- **Recomendación:** Añadir `healthcheck: test: ["CMD", "curl", "-f", "http://localhost:9000/api/health"]`.

#### I03 — PWA no pasará auditoría Lighthouse

- **Evidencia:** `manifest.json` solo tiene 1 icono de 64x64 (favicon.ico). Chrome requiere iconos de al menos 192x192 y 512x512 para habilitar install prompt.
- **Impacto:** ALTO para demostración PWA — sin estos iconos, no aparece el prompt "Añadir a pantalla de inicio".
- **Recomendación:** Generar iconos PNG en 192x192 y 512x512. Añadirlos al manifest.

#### I04 — docker-compose prod expone JWT_SECRET como variable

- **Evidencia:** `docker-compose.yml` tiene `JWT_SECRET: ${JWT_SECRET:-default_secret}`.
- **Impacto:** MEDIO — El fallback a "default_secret" es inseguro.
- **Recomendación:** Usar `env_file: .env` o Docker secrets. Eliminar fallback.

### 3.5 Inconsistencias de logging

| Archivo | Usa logger (pino) | Usa console.log/error |
|---------|-------------------|-----------------------|
| server.ts | ✓ | ✗ |
| AuditService.ts | ✓ | ✗ |
| RequestService.ts | Parcial | Parcial |
| GeoDispatchService.ts | ✗ | ✓ |
| sockets/io.ts | ✗ | ✓ |
| routes/locations.ts | ✗ | ✓ |
| routes/requests.ts | ✗ | ✓ (en catch) |

**Recomendación:** Migrar todos los `console.log/error` a `logger.info/error/debug` para consistencia.

---

## 4. Matriz de verificación contra la memoria técnica (actualizada)

| ID | Requisito de la memoria | Estado anterior (v1) | Estado actual (v2) | Pendiente |
|----|------------------------|---------------------|-------------------|-----------|
| M01 | React 18 + Vite + TS + Tailwind + shadcn/ui | ✅ | ✅ | — |
| M02 | Node.js + Express + TypeScript | ✅ | ✅ | — |
| M03 | PostgreSQL + PostGIS | ❌ SQLite | ❌ SQLite | **SIGUE PENDIENTE** — Migración no realizada |
| M04 | R-Tree indexación geoespacial | ❌ | ❌ | Requiere PostgreSQL |
| M05 | Redis Pub/Sub | ❌ | ❌ | **SIGUE PENDIENTE** |
| M06 | Cola de mensajes | ❌ | ❌ Parcial (escalación) | GeoDispatchService escala a estado, pero no hay queue real |
| M07 | Socket.IO bidireccional | ✅ | ✅ | — |
| M08 | JWT + roles | ✅ | ✅ | — |
| M09 | JWT device fingerprinting | ❌ | ❌ | **SIGUE PENDIENTE** |
| M10 | Auth biométrica para OTP | ❌ | ❌ | No viable en web sin WebAuthn |
| M11 | Registro usuarios | ✅ | ✅ | — |
| M12 | Matching Haversine 3km | ✅ | ✅ | — |
| M13 | Cascada 3→5→7km | ❌ | ✅ | Implementado con timeouts |
| M14 | Handshake 4 dígitos + TTL 5min | ✅ | ✅ + bcrypt | — |
| M15 | Validación GPS <50m | ❌ | ✅ | Opcional en body |
| M16 | Rate limit handshake 3 intentos | ❌ | ✅ | Con tabla handshake_attempts |
| M17 | Late Binding locker | ✅ | ✅ | — |
| M18 | PIN 6 dígitos | ✅ | ✅ + bcrypt | — |
| M19 | TTL PIN (23:59) | ❌ | ✅ | ⚠️ Timezone issue |
| M20 | Categorías S/M/L | Parcial | ✅ | DriverMap bug menor |
| M21 | Transacciones ACID | ✅ | ✅ | — |
| M22 | SELECT...FOR UPDATE | ❌ SQLite | ❌ SQLite | Requiere PostgreSQL |
| M23 | Modelo Orders ~20 campos | Parcial | ✅ ~20 campos | Falta merchant_id FK |
| M24 | Tabla Drivers separada | ❌ | ❌ | Drivers siguen siendo users con role=DRIVER |
| M25 | Tabla Merchants | ❌ | ✅ | CRUD completo |
| M26 | Audit Events inmutable | ❌ | ✅ | HMAC-SHA256 implementado |
| M27 | Tabla Rate Limiting | ❌ | ✅ | handshake_attempts |
| M28 | Tabla Cruise Manifest | ❌ | ❌ | **NO CREADA** |
| M29 | Lockers con sensores | Parcial | Parcial | Sin campos de sensores (magnetic_switch, infrared) |
| M30 | Users accessibility_profile | ❌ | ❌ | **NO IMPLEMENTADO** |
| M31 | API versionada (v1) | ❌ | ❌ | Rutas siguen como /api/... sin /v1/ |
| M32 | Endpoints B2A APLP | ❌ | ✅ | throughput, timing, fleet, audit |
| M33 | Driver earnings/telemetry | ❌ | ❌ | **SIGUE PENDIENTE** |
| M34 | Endpoints internos mTLS | ❌ | ❌ | Arquitectura monolítica |
| M35 | Pasarela de pagos | ❌ | ❌ | **SIGUE PENDIENTE** |
| M36 | Canal SMS contingencia | ❌ | ❌ | **SIGUE PENDIENTE** |
| M37 | PWA offline-first | ❌ | ✅ Parcial | Manifest + Workbox, pero sin IndexedDB ni iconos PWA válidos |
| M38 | HTTP Polling fallback | ❌ | ❌ | Socket.IO tiene transports fallback nativo |
| M39 | Heartbeat WS 15s | Parcial | Parcial | Usa defaults Socket.IO |
| M40 | Docker / Kubernetes | ❌ | ✅ Docker | Sin Kubernetes |
| M41 | CI/CD pipeline | ❌ | ✅ Parcial | GitHub Actions pero sin test frontend en CI |
| M42 | Monitoring ELK/Prometheus | ❌ | ❌ | **SIGUE PENDIENTE** |
| M43 | TLS 1.3 | ❌ | Parcial | nginx.conf preparado pero sin certificados |
| M44 | AES-256 para PII | ❌ | ❌ | **SIGUE PENDIENTE** |
| M45 | bcrypt para PINs | ❌ | ✅ | Salt rounds 10 |
| M46 | Detección GPS spoofing | ❌ | ❌ | **SIGUE PENDIENTE** |
| M47 | Geofencing área servicio | ❌ | ❌ | **SIGUE PENDIENTE** — Solo filtro por radio, no bounding box del área |
| M48 | HMAC-SHA256 no-repudio | ❌ | ✅ | En audit events |
| M49 | Rotación JWT 90 días | ❌ | ❌ | **SIGUE PENDIENTE** |
| M50 | HashiCorp Vault | ❌ | ❌ | Variables en .env |
| M51 | IoT Smart Lockers WSS | ❌ | ❌ | No implementado |
| M52 | Notificaciones real-time | ✅ | ✅ | — |
| M53 | Service Layer | ❌ | ✅ | 4 servicios creados |
| M54 | Validación Zod | Parcial | ✅ Casi completo | Schemas creados y aplicados |
| M55 | Tests >80% cobertura | Parcial | ~55-60% backend | Threshold configurado a 55%, memoria dice 80% |
| M56 | Tests E2E Cypress | ❌ | ❌ | **SIGUE PENDIENTE** |
| M57 | Tests de carga | ❌ | ✅ Script k6 | No verificado su ejecución |
| M58 | Logging estructurado | ❌ | ✅ Parcial | Pino instalado pero no en todos los archivos |

---

## 5. Plan de corrección residual priorizado

### Fase A — Correcciones rápidas (1-2 horas)

| # | Acción | Justificación | Archivo(s) | Prioridad |
|---|--------|--------------|-----------|-----------|
| A1 | Añadir `npm test` al job frontend-build en CI | Tests frontend no se ejecutan en CI | `.github/workflows/ci.yml` | **Crítica** |
| A2 | Fix DriverMap label "Grande" para LARGE | Bug visible al usuario | `DriverMap.tsx` | **Alta** |
| A3 | Validar JWT_SECRET obligatorio en producción | Fallback inseguro | `config/env.ts` | **Alta** |
| A4 | Mejorar regex Zod para handshakeCode y lockerCode | Aceptan caracteres no numéricos | `schemas/request.schemas.ts`, `schemas/locker.schemas.ts` | **Media** |
| A5 | Limpiar `src/test/example.test.ts` | Código legacy que debería eliminarse o moverse | `cruise-connect-main/src/test/example.test.ts` | **Baja** |
| A6 | Migrar console.log restantes a logger | Inconsistencia de logging | `GeoDispatchService.ts`, `sockets/io.ts`, `locations.ts` | **Media** |

### Fase B — Campos faltantes del schema (2-3 horas)

| # | Acción | Justificación | Archivo(s) | Prioridad |
|---|--------|--------------|-----------|-----------|
| B1 | Crear tabla cruise_manifest | Requerida por memoria y ausente del schema | `schema.sql.ts` | **Alta** |
| B2 | Añadir campos users: vehicle_identifier, accessibility_profile, device_identifier | Requeridos por memoria | `schema.sql.ts`, `auth.ts` (registro) | **Alta** |
| B3 | Añadir campo pickup_requests.merchant_id + FK | Vincular solicitudes con merchants | `schema.sql.ts`, `RequestService.ts` | **Media** |
| B4 | Añadir campos lockers: hub_id, last_sync_at | Soporte multi-hub | `schema.sql.ts` | **Media** |
| B5 | Generar iconos PWA 192x192 y 512x512 | PWA no pasa Lighthouse sin ellos | `public/manifest.json`, nuevos PNGs | **Alta** |

### Fase C — Mejoras de seguridad y robustez (4-6 horas)

| # | Acción | Justificación | Archivo(s) | Prioridad |
|---|--------|--------------|-----------|-----------|
| C1 | Proteger POST /merchants/register con auth | Endpoint abierto al público | `merchants.ts` | **Alta** |
| C2 | Fix timezone en TTL de locker_code | Puede expirar a hora incorrecta en Canarias | `RequestService.ts` | **Media** |
| C3 | Cleanup de GeoDispatchService Map (garbage collection) | Memory leak potencial | `GeoDispatchService.ts` | **Media** |
| C4 | Añadir health checks a docker-compose | Detección de servicios caídos | `docker-compose.yml` | **Media** |
| C5 | Eliminar fallback JWT_SECRET de docker-compose | Inseguro en producción | `docker-compose.yml` | **Alta** |
| C6 | Añadir índices BD en campos frecuentes | Performance con volumen | `schema.sql.ts` (client_id, driver_id, status en pickup_requests) | **Media** |

### Fase D — Tests faltantes (3-4 horas)

| # | Acción | Justificación | Archivo(s) | Prioridad |
|---|--------|--------------|-----------|-----------|
| D1 | Crear cascade-search.test.ts | GeoDispatchService sin tests directos | Nuevo test file | **Alta** |
| D2 | Crear test de renewHandshake | Feature sin cobertura | En integration.test.ts o nuevo file | **Media** |
| D3 | Crear test de expiración de locker code (TTL) | Feature crítica sin test específico | Nuevo test | **Media** |
| D4 | Subir coverage threshold a 70% | Acercar a la meta del 80% de la memoria | `jest.config.ts` | **Media** |

### Fase E — Elementos diferidos de la memoria (futuro)

Estos elementos NO fueron parte del plan de 30 pasos y siguen pendientes. Son necesarios para alineación completa con la memoria pero pueden diferirse al siguiente sprint:

| # | Elemento | Prioridad para la memoria |
|---|----------|--------------------------|
| E1 | Migración SQLite → PostgreSQL + PostGIS | **ALTA** (pero esfuerzo grande) |
| E2 | Redis para Pub/Sub WebSocket multi-instancia | MEDIA |
| E3 | API versionada (/api/v1/) | BAJA |
| E4 | Endpoint driver earnings/telemetry | MEDIA |
| E5 | Geofencing (bounding box del área de servicio) | MEDIA |
| E6 | Detección GPS spoofing (análisis de trayectoria) | BAJA |
| E7 | Device fingerprinting en JWT | MEDIA |
| E8 | Cifrado AES-256 para PII | ALTA (RGPD) |
| E9 | Rotación automática de JWT signing key | BAJA |
| E10 | Monitoring (ELK/Prometheus) | MEDIA |
| E11 | Tests E2E con Cypress | MEDIA |
| E12 | Pasarela de pagos (Stripe) | MEDIA |
| E13 | Canal SMS contingencia | BAJA |
| E14 | Tabla separada para Drivers | BAJA (refactoring) |

---

## 6. Resumen de archivos pendientes de modificar/crear

### Archivos a MODIFICAR:

| Archivo | Cambio | Prioridad |
|---------|--------|-----------|
| `.github/workflows/ci.yml` | Añadir `npm test` en job frontend | **Crítica** |
| `cruise-connect-main/src/components/DriverMap.tsx` | Fix label "Grande" para LARGE | **Alta** |
| `backend/src/config/env.ts` | Validar JWT_SECRET obligatorio en prod | **Alta** |
| `backend/src/schemas/request.schemas.ts` | Regex `/^\d{4}$/` para handshakeCode | **Media** |
| `backend/src/schemas/locker.schemas.ts` | Regex `/^\d{6}$/` para lockerCode | **Media** |
| `backend/src/db/schema.sql.ts` | Añadir cruise_manifest, campos users, campos lockers, merchant_id en requests | **Alta** |
| `backend/src/services/GeoDispatchService.ts` | Cleanup Map + migrar a logger | **Media** |
| `backend/src/sockets/io.ts` | Migrar console.log a logger | **Media** |
| `docker-compose.yml` | Health checks + eliminar JWT_SECRET fallback | **Alta** |
| `cruise-connect-main/public/manifest.json` | Añadir iconos 192x192 y 512x512 | **Alta** |
| `backend/src/routes/merchants.ts` | Proteger POST /register con auth | **Alta** |
| `backend/src/services/RequestService.ts` | Fix timezone TTL locker_code | **Media** |
| `backend/jest.config.ts` | Subir thresholds progresivamente | **Media** |

### Archivos a CREAR:

| Archivo | Propósito | Prioridad |
|---------|-----------|-----------|
| `backend/src/__tests__/cascade-search.test.ts` | Tests para GeoDispatchService | **Alta** |
| `backend/src/__tests__/locker-ttl.test.ts` | Tests para expiración de código | **Media** |
| `cruise-connect-main/public/icon-192x192.png` | Icono PWA requerido | **Alta** |
| `cruise-connect-main/public/icon-512x512.png` | Icono PWA requerido | **Alta** |

### Archivos a ELIMINAR:

| Archivo | Motivo | Prioridad |
|---------|--------|-----------|
| `cruise-connect-main/src/test/example.test.ts` | Test legacy trivial | **Baja** |

---

## 7. Conclusión

El proyecto ha mejorado de forma notable tras la ejecución del plan de 30 pasos. Las **correcciones críticas de seguridad** se implementaron (hashing de códigos, rotación de secreto, .gitignore), la **arquitectura de servicios** se refactorizó correctamente, el **sistema de auditoría con firmas HMAC** está operativo, y la **infraestructura** (Docker, PWA, CI) está en su lugar.

Los hallazgos residuales más importantes son:

1. **CI no ejecuta tests frontend** — corrección de 1 línea en ci.yml
2. **Campos de schema incompletos** — cruise_manifest, vehicle_identifier, accessibility_profile
3. **PWA sin iconos válidos** — no pasará auditoría Lighthouse
4. **SQLite sigue como BD** — la migración a PostgreSQL es el cambio más impactante pendiente
5. **GeoDispatchService sin tests** y con memory leak potencial
6. **Merchant registration abierta** sin autenticación

El nivel de alineación con la memoria técnica es ahora ~65-70%, suficiente para una demo de piloto TRL 7 pero insuficiente para una auditoría técnica formal contra la memoria. Los elementos de la Fase E (PostgreSQL, Redis, cifrado PII, E2E testing) son los que elevarían la alineación al 85-90%.

---

*Fin de re-auditoría v2.*
