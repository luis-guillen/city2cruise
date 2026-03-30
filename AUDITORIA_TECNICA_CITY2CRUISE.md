# AUDITORÍA TÉCNICA DEL PROYECTO CITY2CRUISE: SHOP&DROP PORT HUB

**Fecha:** 17 de marzo de 2026
**Auditor:** Arquitecto de Software Senior / Auditor de Código
**Entidad auditada:** REKER Tech Solutions S.L.
**Versión del documento:** 1.0

---

## 1. Resumen ejecutivo

La presente auditoría técnica revela una **brecha significativa y estructural** entre lo descrito en la Memoria Técnica Justificativa y la implementación real del código fuente. La memoria técnica describe un sistema de producción distribuido, resiliente y multi-tenant con integración IoT, PostgreSQL + PostGIS, Redis, colas de mensajes, microservicios, Docker/Kubernetes, pasarela de pagos, sistema de comercios B2B, dashboard B2A para la Autoridad Portuaria, y un sofisticado sistema de auditoría criptográfica. **La implementación actual es un prototipo funcional (MVP)** con arquitectura monolítica, SQLite como base de datos, 4 tablas (frente a las 8+ descritas), sin integración IoT real, sin sistema de comercios, sin pasarela de pagos, sin Redis, sin Docker, sin colas de mensajes, y sin la mayoría de los endpoints API documentados.

**Nivel de alineación general: ~25-30%** — El núcleo del flujo transaccional (solicitud → asignación → handshake → depósito → recogida) está implementado correctamente, pero la gran mayoría de los subsistemas descritos en la memoria están ausentes o son significativamente más simples que lo documentado.

**Riesgos principales:**

1. **Riesgo de auditoría externa:** Si un evaluador del programa Puertos 4.0 compara la memoria con el código, encontrará discrepancias graves que podrían comprometer la justificación de la subvención.
2. **Riesgo técnico:** Múltiples funcionalidades de seguridad descritas (detección de GPS spoofing, firma criptográfica, rate limiting por intento de handshake, TTL de OTP) no están implementadas.
3. **Riesgo de escalabilidad:** SQLite no soporta concurrencia multi-instancia ni las consultas geoespaciales R-Tree que describe la memoria.
4. **Deuda técnica acumulada:** Componentes frontend no utilizados, referencias a campos inexistentes en el AdminDashboard, tests frontend prácticamente inexistentes.

**Próximos pasos recomendados (orden de prioridad):**

1. Migrar de SQLite a PostgreSQL + PostGIS para alinear con la memoria
2. Implementar el modelo de datos completo (merchants, audit_events, rate_limiting)
3. Añadir los mecanismos de seguridad documentados (rate limiting handshake, TTL OTP, validación GPS proximidad)
4. Crear Dockerfile y docker-compose para alinear con la estrategia de despliegue descrita
5. Implementar el dashboard B2A con los endpoints de métricas para la APLP
6. Ampliar la cobertura de tests (frontend y E2E)

---

## 2. Alcance de la auditoría

### Materiales analizados

| Material | Ubicación | Tipo |
|----------|-----------|------|
| Memoria Técnica Justificativa | `MEMORIA TÉCNICA JUSTIFICATIVA - PORTS.docx` | Documento técnico (~100 páginas, 18 secciones + anexos) |
| Respuesta a Consultas Técnicas | `RESPUESTA_CONSULTAS_TECNICAS.md` | Documento complementario |
| Presupuesto | `PRESUPUESTO_V3.xlsx` | Presupuesto desglosado |
| Backend (Node.js/Express/TypeScript) | `backend/src/` | 22 archivos fuente + 4 archivos de test |
| Frontend (React/TypeScript/Vite) | `cruise-connect-main/src/` | ~25 archivos fuente + 1 archivo de test |
| Configuración | `.env`, `package.json`, `tsconfig.json`, `vite.config.ts` | Archivos de configuración |

### Tipo de comparación realizada

Se ha realizado una auditoría cruzada exhaustiva comparando cada requisito funcional, no funcional, arquitectónico y de seguridad descrito en la memoria técnica contra la evidencia encontrada en el código fuente. Se han analizado: esquemas de base de datos, rutas API, middleware, lógica de negocio, eventos WebSocket, componentes frontend, validaciones, manejo de errores, tests, y configuración de despliegue.

### Limitaciones

1. No se ha ejecutado el código (auditoría estática).
2. No se ha verificado el presupuesto en detalle contra las horas de desarrollo.
3. No se dispone de acceso a repositorios Git para analizar el historial de commits.
4. La memoria contiene secciones con marcadores `[COMPLETAR]` que indican que el propio documento está incompleto.

---

## 3. Comprensión de la memoria técnica

### 3.1 Objetivo de la aplicación

City2Cruise: Shop&Drop Port Hub es una plataforma B2B2C de logística de última milla para cruceristas. Permite a los pasajeros de cruceros en el Puerto de Las Palmas solicitar la recogida de sus compras urbanas, que son transportadas por conductores hasta una red de Smart Lockers (taquillas inteligentes) ubicadas en la terminal de cruceros, donde el pasajero las recoge antes de embarcar mediante un PIN de 6 dígitos.

### 3.2 Requisitos funcionales

| ID | Requisito | Sección de la memoria |
|----|-----------|----------------------|
| RF01 | Registro y autenticación de usuarios (pasajeros, conductores, administradores) con JWT | §9.6.1 |
| RF02 | Creación de solicitudes de recogida geolocalizadas | §2.3, §9.4 |
| RF03 | Matching algorítmico conductor-cliente por proximidad (Haversine, radio 3km) | §2.3.2, §9.5 |
| RF04 | Búsqueda radial en cascada: 3km → 5km → 7km con timeouts de 45s | §9.5, §4.4.1 |
| RF05 | Sistema de handshake con código de 4 dígitos y TTL de 5 minutos | §2.3.3 |
| RF06 | Validación de proximidad GPS (<50m) durante el handshake | §9.6.2, Respuesta Consultas §3.1.2 |
| RF07 | Asignación dinámica de locker (Late Binding) post-validación handshake | §2.3.1 |
| RF08 | Generación de PIN de apertura de 6 dígitos con TTL (expira 23:59 del mismo día) | §2.3.4 |
| RF09 | Comunicación bidireccional en tiempo real (Socket.IO/WebSockets) | §4.4.2, §9.1.4 |
| RF10 | Dashboard B2A para la Autoridad Portuaria (APLP) con métricas y heatmaps | §3.2.1, Respuesta Consultas §3.2 |
| RF11 | Sistema de notificaciones push para pasajeros | §9.3.1 |
| RF12 | Sistema de comercios (merchants) B2B con integración | §14.8, Modelo de datos |
| RF13 | Trazabilidad auditable con log inmutable y firma criptográfica | §3.1.2, Respuesta Consultas §3.1.2 |
| RF14 | Rate limiting de intentos de handshake: máx 3, 4º bloquea y escala a soporte L1 | §9.6 |
| RF15 | Categorías volumétricas: pequeño (1-3kg), mediano (3-8kg), voluminoso (10-12kg) | §2.3 |
| RF16 | Integración con pasarela de pago (Stripe/Adyen) | §14.8.1 |
| RF17 | Integración con manifiesto de cruceros (ventana de servicio) | Modelo de datos |
| RF18 | Canal SMS de contingencia para entrega de OTP | §9.7 |
| RF19 | Perfil de accesibilidad de usuario (estándar, PMR, edad avanzada) | Modelo de datos |
| RF20 | Sistema de ganancias/métricas para conductores | API endpoints |
| RF21 | Administración de usuarios con limpieza en cascada | Implícito |
| RF22 | Historial de solicitudes del cliente | Implícito |
| RF23 | Geofencing: validar coordenadas dentro del área de servicio | §9.6.2 |

### 3.3 Requisitos no funcionales

| ID | Requisito | Fuente |
|----|-----------|--------|
| RNF01 | Tiempo de asignación de conductor: <2 minutos (p90) en radio de 3km | §8.4.1 |
| RNF02 | Transacción completa (solicitud a depósito): <45 minutos | §2.3 |
| RNF03 | Latencia de cálculo geo-dispatch: <200ms bajo carga pico | §9.5 |
| RNF04 | Tasa de éxito de handshake: >95% | §8.4.2 |
| RNF05 | Uptime de hardware Smart Locker: >98% | §8.4 |
| RNF06 | Disponibilidad infraestructura: 99.5% | §9.7 |
| RNF07 | Cumplimiento ACID en transacciones | §4.4.3, §9.6.3 |
| RNF08 | Bloqueo pesimista a nivel de fila (SELECT...FOR UPDATE) | §9.6.3 |
| RNF09 | Resiliencia a cortes de red (buffering, reconexión, HTTP Polling fallback) | §4.4.2 |
| RNF10 | Escalabilidad horizontal con contenedores stateless | §9.1.2 |
| RNF11 | Multi-tenant, multi-hub desde génesis | §4.4.4 |
| RNF12 | Cifrado TLS 1.3 en todas las comunicaciones | §9.6 |
| RNF13 | Cobertura de tests >80% | §Testing |
| RNF14 | PWA con capacidades offline-first (Service Worker, IndexedDB) | §1.2 |
| RNF15 | NPS del usuario: >40 | §8.4.4 |

### 3.4 Arquitectura esperada

La memoria describe una arquitectura de **microservicios contenerizados** con:

- **Frontend:** React 18 + Vite + TypeScript + Tailwind CSS + shadcn/ui (PWA)
- **Backend:** Node.js + Express + TypeScript (stateless, multi-instancia)
- **Base de datos:** PostgreSQL + PostGIS (con R-Tree para consultas geoespaciales)
- **Cache/Pub-Sub:** Redis (distribución de eventos WebSocket entre instancias)
- **Colas de mensajes:** RabbitMQ/SQS/Kafka (para cola de alta demanda)
- **Contenedorización:** Docker + Kubernetes (orquestación)
- **Real-time:** Socket.IO sobre TLS con fallback HTTP Polling
- **IoT:** Conexión WSS bidireccional con controladores de Smart Locker
- **Seguridad:** mTLS entre microservicios, HashiCorp Vault para secretos

### 3.5 Modelo de datos esperado

La memoria describe **8+ entidades principales:**

1. **Orders** (pickup_requests): ~20 campos incluyendo version, cryptographic signatures, timestamps múltiples
2. **Users** (passengers): con device_identifier, jwt_token_hash, accessibility_profile
3. **Drivers**: con vehicle_identifier, status (available/on_delivery/offline), spatial index
4. **Merchants**: business_name, storefront_location, subscription_tier, api_key_hash
5. **LockerCells**: con sensores (magnetic_switch, infrared_occupancy), firmware_version
6. **Audit Events**: log inmutable con event_signature_cryptographic (HMAC-SHA256)
7. **Rate Limiting / Security**: tracking de intentos de handshake por orden
8. **Cruise Manifest**: vessel_id, scheduled_arrival, all_aboard, passenger_count

### 3.6 Seguridad, validaciones y manejo de errores

- JWT con device fingerprinting
- bcrypt para hashing de PINs (salt rounds: 12)
- mTLS entre microservicios
- Rate limiting: 3 intentos máx de handshake, 10 órdenes/día/usuario, 3 intentos OTP
- Validación GPS anti-spoofing (análisis de trayectoria)
- Geofencing (bounding box del área de servicio)
- Cifrado AES-256 para PII
- TDE (Transparent Data Encryption) en PostgreSQL
- Rotación de claves JWT cada 90 días
- Detección de anomalías (colusión conductor-comercio)
- No-repudio: HMAC-SHA256(order_id + driver_id + timestamp + pin_hash)

### 3.7 Pruebas y despliegue esperados

- **Unit testing:** Jest, >80% cobertura
- **Integration testing:** Multi-servicio, transacciones, WebSocket lifecycle
- **E2E testing:** Cypress (frontend) + Postman (backend), 8 escenarios definidos
- **Load testing:** k6/JMeter, 100-500 usuarios concurrentes
- **Security testing:** OWASP Top 10, brute force PIN, JWT tampering, GPS spoofing
- **UAT:** 10 cruceristas, 5 comerciantes, 3 conductores
- **CI/CD:** Git → Build → Tests → Docker → Staging → Smoke → Load → Security → Blue-Green deploy
- **Monitoring:** ELK Stack, Prometheus, Jaeger
- **Backup:** Snapshots diarios, RTO <4h, RPO <1h

---

## 4. Comprensión del código actual

### 4.1 Estructura general del proyecto

```
APP_TRASNPORTE_LOCKERS_BARCELONA/
├── RESPUESTA_CONSULTAS_TECNICAS.md
├── backend/                          # Node.js + Express + TypeScript
│   ├── .env                          # Configuración (JWT_SECRET hardcoded)
│   ├── package.json                  # Dependencias
│   ├── database.sqlite               # Base de datos SQLite
│   ├── src/
│   │   ├── index.ts                  # Entry point
│   │   ├── server.ts                 # Express app factory
│   │   ├── config/env.ts             # Variables de entorno
│   │   ├── auth/                     # JWT + middleware de autenticación
│   │   ├── db/                       # Schema, database, seed, reset
│   │   ├── routes/                   # auth, requests, lockers, admin, notifications, locations, debug
│   │   ├── sockets/io.ts             # Socket.IO server
│   │   ├── middleware/rateLimiter.ts  # Rate limiting global
│   │   ├── types/dto.ts              # Data Transfer Objects
│   │   └── utils/                    # geo.ts (Haversine), dto.ts, errors.ts
│   └── src/__tests__/                # 4 archivos de test + helpers
└── cruise-connect-main/              # React + Vite + TypeScript
    ├── package.json
    ├── src/
    │   ├── App.tsx                   # Router principal
    │   ├── main.tsx                  # Entry point
    │   ├── socket.ts                 # Socket.IO client
    │   ├── services/api.ts           # Axios API client
    │   ├── context/AppContext.tsx     # Estado global
    │   ├── pages/                    # Login, Client, Driver, Admin dashboards
    │   ├── components/               # Navbar, Layout, StatusBadge, DriverMap, NotificationBell
    │   ├── hooks/                    # useSocket, useDriverGeoLocation, use-mobile, use-toast
    │   └── test/                     # 1 test placeholder
    └── vite.config.ts
```

### 4.2 Arquitectura real implementada

La arquitectura real es un **monolito cliente-servidor** compuesto por:

- **Backend monolítico:** Un único servidor Express que maneja todas las rutas, lógica de negocio y WebSockets
- **Frontend SPA:** Aplicación React con Vite (NO es PWA, no tiene Service Worker ni manifest)
- **Base de datos:** SQLite con better-sqlite3 en modo WAL (archivo local, no servidor)
- **Sin Redis, sin colas de mensajes, sin Docker, sin Kubernetes**
- **Sin integración IoT real** (los lockers son entidades puramente lógicas en la BD)

### 4.3 Componentes principales

**Backend:**

| Componente | Archivos | Función real |
|------------|----------|-------------|
| Autenticación | `auth/jwt.ts`, `auth/middleware.ts` | JWT HS256, 24h TTL, RBAC (CLIENT/DRIVER/ADMIN) |
| Base de datos | `db/database.ts`, `db/schema.sql.ts` | SQLite WAL, 4 tablas, seed automático |
| Rutas API | `routes/*.ts` (7 archivos) | REST endpoints para auth, requests, lockers, admin, notifications, locations |
| WebSockets | `sockets/io.ts` | Socket.IO con tracking de ubicación de conductores, broadcast de eventos |
| Geo-engine | `utils/geo.ts` | Fórmula de Haversine pura (sin índices espaciales) |
| Rate limiting | `middleware/rateLimiter.ts` | express-rate-limit (global 100/min, auth 10/min, locker 5/min) |
| DTOs | `types/dto.ts`, `utils/dto.ts` | Transformación y sanitización de datos |

**Frontend:**

| Componente | Archivo | Función real |
|------------|---------|-------------|
| LoginPage | `pages/LoginPage.tsx` | Login/Registro con tabs, validación básica HTML5 |
| ClientDashboard | `pages/ClientDashboard.tsx` | Solicitud, búsqueda ubicación, confirmación handshake, apertura locker, historial |
| DriverDashboard | `pages/DriverDashboard.tsx` | Lista pendientes, aceptación, código handshake, depósito |
| AdminDashboard | `pages/AdminDashboard.tsx` | Lista usuarios, eliminación (con bug en campos referenciados) |
| AppContext | `context/AppContext.tsx` | Estado global con sessionStorage |
| API Service | `services/api.ts` | Axios client con interceptor JWT |
| Socket Hook | `hooks/useSocket.ts` | Conexión WebSocket y manejo de eventos |
| DriverMap | `components/DriverMap.tsx` | Componente Leaflet (CREADO PERO NO UTILIZADO) |

### 4.4 Flujo de datos

```
[Cliente crea solicitud]
  → POST /api/requests
  → INSERT en pickup_requests (status: REQUESTED)
  → Socket.IO broadcast "request:new" a conductores en radio 3km
  → (Fallback: broadcast a todos si no hay conductores cercanos)

[Conductor acepta]
  → POST /api/requests/:id/accept (dentro de db.transaction())
  → UPDATE status → CONFIRMATION_PENDING + genera handshake_code 4 dígitos
  → Socket.IO "request:updated"

[Cliente confirma handshake]
  → POST /api/requests/:id/confirm-driver (body: {code})
  → Valida código + expiración 5min
  → UPDATE status → IN_PROGRESS
  → Socket.IO "request:updated"

[Conductor deposita]
  → POST /api/requests/:id/deposit (dentro de db.transaction())
  → Busca locker libre → asigna → genera locker_code 6 dígitos
  → UPDATE status → DEPOSITED
  → INSERT notificación LOCKER_READY
  → Socket.IO "locker:ready" + "notification:new" al cliente

[Cliente abre locker]
  → POST /api/lockers/open (body: {code})
  → Valida código y status DEPOSITED (dentro de db.transaction())
  → UPDATE status → PICKED_UP + libera locker
```

### 4.5 Configuración, dependencias y despliegue

**Backend (.env):**
```
PORT=9000
JWT_SECRET=super_secret_jwt_key_demo    ⚠️ Secreto hardcoded en .env
DB_FILE=./database.sqlite
FRONTEND_URL=http://localhost:9100
```

**Dependencias backend clave:** express 5.2.1, socket.io 4.8.3, better-sqlite3 12.6.2, bcrypt, jsonwebtoken, zod, helmet, cors, express-rate-limit

**Dependencias frontend clave:** react 18.3, react-router-dom, socket.io-client, axios, tailwindcss, shadcn/ui, react-leaflet, sonner, date-fns

**No existe:** Dockerfile, docker-compose.yml, .github/workflows/, nginx.conf, Procfile, Makefile, ni ningún artefacto de despliegue.

### 4.6 Estado de las pruebas

**Backend (4 archivos de test):**

| Test | Cobertura | Estado |
|------|-----------|--------|
| `integration.test.ts` | Flujo completo solicitud → pickup | Funcional |
| `security.test.ts` | Auth, autorización, validación input, headers HTTP | Funcional |
| `concurrency.test.ts` | Double-accept, double-deposit race conditions | Funcional |
| `geo-matching.test.ts` | Haversine, filtrado por radio, endpoint debug | Funcional |

**Frontend (1 archivo de test):**

| Test | Cobertura | Estado |
|------|-----------|--------|
| `example.test.ts` | `expect(true).toBe(true)` | Placeholder sin valor |

**Cobertura estimada:** Backend ~40-50% de rutas cubiertas; Frontend ~0% de cobertura real.

---

## 5. Matriz de correspondencia entre memoria y código

| ID | Elemento / Requisito | Evidencia en la memoria | Evidencia en el código | Estado | Observaciones técnicas |
|----|---------------------|------------------------|----------------------|--------|----------------------|
| M01 | Stack Frontend: React 18 + Vite + TypeScript + Tailwind + shadcn/ui | §9.1.1 | `cruise-connect-main/package.json` | **Implementado** | Coincide exactamente con lo descrito |
| M02 | Stack Backend: Node.js + Express + TypeScript | §9.1.2 | `backend/package.json` | **Implementado** | Express 5.x usado (no especificado en memoria) |
| M03 | Base de datos: PostgreSQL + PostGIS | §9.1.3 | `backend/src/db/database.ts` usa SQLite (better-sqlite3) | **Diferente** | CRÍTICO: La memoria reconoce SQLite para piloto pero enfatiza PostgreSQL como objetivo; PostGIS completamente ausente |
| M04 | Indexación R-Tree para consultas geoespaciales | §9.5, §1.2 | `utils/geo.ts` solo usa Haversine puro, sin índices | **Ausente** | Sin optimización de Bounding Box ni índices espaciales |
| M05 | Redis para Pub/Sub y sesiones | §Arquitectura | No hay dependencia Redis en package.json | **Ausente** | Impide escalado horizontal de WebSockets |
| M06 | Colas de mensajes (RabbitMQ/SQS/Kafka) | §9.5 | No existe implementación | **Ausente** | Descrito para cola de alta demanda cuando no hay conductores |
| M07 | WebSockets (Socket.IO) bidireccionales | §4.4.2, §9.1.4 | `sockets/io.ts` con eventos completos | **Implementado** | Funcional pero sin fallback HTTP Polling ni heartbeat configurable |
| M08 | JWT con verificación de roles | §9.6.1 | `auth/jwt.ts`, `auth/middleware.ts` | **Implementado** | Funcional con HS256, 24h TTL |
| M09 | JWT con device fingerprinting | §9.6 | No implementado | **Ausente** | No hay hash de dispositivo en el token |
| M10 | Autenticación biométrica para OTP | §API endpoints | No implementado | **Ausente** | La memoria lo describe para recuperación de PIN |
| M11 | Registro de usuarios (CLIENT, DRIVER) | §9.4 | `routes/auth.ts` POST /register con Zod validation | **Implementado** | Solo CLIENT y DRIVER pueden registrarse (ADMIN por seed) |
| M12 | Matching Haversine con radio 3km | §2.3.2, §9.5 | `routes/requests.ts` + `utils/geo.ts` | **Implementado** | Filtrado por radio en creación y en GET /pending |
| M13 | Búsqueda radial en cascada 3km→5km→7km | §9.5, §4.4.1 | Solo radio fijo 3km con broadcast fallback | **Parcial** | FALTA la degradación progresiva con timeouts de 45s |
| M14 | Handshake de 4 dígitos con TTL 5min | §2.3.3 | `routes/requests.ts` POST /:id/accept genera código | **Implementado** | Código generado, expiración validada, renovación disponible |
| M15 | Validación de proximidad GPS (<50m) en handshake | §9.6.2 | No implementado | **Ausente** | CRÍTICO: No se valida distancia física entre conductor y cliente |
| M16 | Rate limiting de handshake: 3 intentos máx | §9.6 | No hay tracking de intentos por orden | **Ausente** | Solo rate limiting global por IP (5/min para locker) |
| M17 | Asignación dinámica de locker (Late Binding) | §2.3.1 | `routes/requests.ts` POST /:id/deposit busca locker libre | **Implementado** | Asignación correcta post-handshake con transacción atómica |
| M18 | PIN de apertura 6 dígitos | §2.3.4 | `routes/requests.ts` genera código, `routes/lockers.ts` valida | **Implementado** | Generación y validación correctas |
| M19 | TTL del PIN (expira 23:59 mismo día) | §2.3.4 | No implementado | **Ausente** | El PIN no tiene expiración temporal |
| M20 | Categorías volumétricas: S/M/L (voluminoso) | §2.3 | Schema solo permite SMALL/MEDIUM | **Parcial** | Falta categoría "voluminous" (10-12kg, 40-50L) |
| M21 | Transacciones atómicas SQLite/ACID | §4.4.3, §9.6.3 | `db.transaction()` en accept, deposit, open | **Implementado** | Correcto uso de transacciones para operaciones críticas |
| M22 | SELECT...FOR UPDATE (bloqueo pesimista a nivel de fila) | §9.6.3 | SQLite usa serialización implícita, no hay SELECT...FOR UPDATE | **Diferente** | SQLite no soporta bloqueo a nivel de fila; el bloqueo es a nivel de base de datos |
| M23 | Modelo de datos: tabla Orders (~20 campos) | §9.3.1 | `pickup_requests` con ~12 campos | **Parcial** | Faltan: version, timestamps múltiples, firma criptográfica, merchant_id |
| M24 | Modelo de datos: tabla Drivers (separada, con status, vehicle_id) | §Modelo datos | Drivers son `users` con role=DRIVER, sin campos adicionales | **Diferente** | No hay tabla separada ni campos específicos de conductor |
| M25 | Modelo de datos: tabla Merchants | §Modelo datos | No existe | **Ausente** | Subsistema de comercios completamente ausente |
| M26 | Modelo de datos: tabla Audit Events (inmutable) | §Modelo datos, §3.1.2 | No existe | **Ausente** | CRÍTICO: Sin trazabilidad auditable ni firmas criptográficas |
| M27 | Modelo de datos: tabla Rate Limiting | §Modelo datos | No existe | **Ausente** | No hay tracking de intentos fallidos por handshake |
| M28 | Modelo de datos: tabla Cruise Manifest | §Modelo datos | No existe | **Ausente** | Sin integración con horarios de cruceros |
| M29 | Modelo de datos: tabla LockerCells con sensores | §Modelo datos | `lockers` tabla simplificada (id, label, is_occupied) | **Parcial** | Sin campos de sensores (magnetic_switch, infrared, firmware) |
| M30 | Modelo de datos: users con accessibility_profile | §Modelo datos | No existe el campo | **Ausente** | Sin perfiles de accesibilidad |
| M31 | API versionada (v1) | §API endpoints | Rutas sin versionado (/api/requests) | **Diferente** | Menor impacto pero no sigue la convención descrita |
| M32 | Endpoints B2A para APLP (heatmaps, throughput, timing, fleet) | §3.2.1, API endpoints | Solo GET /admin/users y DELETE /admin/users/:id | **Ausente** | CRÍTICO: Dashboard de Autoridad Portuaria no implementado |
| M33 | Endpoints de conductor: earnings, telemetry | §API endpoints | No existen | **Ausente** | Sin métricas de ganancias ni telemetría estructurada |
| M34 | Endpoints internos microservicio-a-microservicio (mTLS) | §API endpoints | No existen (monolito) | **Ausente** | La arquitectura es monolítica, no microservicios |
| M35 | Pasarela de pago (Stripe/Adyen) | §14.8.1 | No implementado | **Ausente** | Sin procesamiento de pagos |
| M36 | Canal SMS de contingencia | §9.7 | No implementado | **Ausente** | Sin integración SMS |
| M37 | PWA: Service Worker, offline-first, IndexedDB | §1.2 | No hay manifest.json, ni sw.js, ni IndexedDB | **Ausente** | CRÍTICO: La app NO es PWA pese a describirlo como pilar técnico |
| M38 | HTTP Polling fallback para WebSocket | §4.4.2 | No implementado | **Ausente** | Sin mecanismo de degradación |
| M39 | Heartbeat WebSocket cada 15s | §4.4.2 | Socket.IO tiene pingTimeout/pingInterval por defecto | **Parcial** | Usa defaults de Socket.IO, no configurado explícitamente |
| M40 | Docker / Kubernetes | §Deployment | No existe Dockerfile ni docker-compose | **Ausente** | CRÍTICO para alineación con memoria |
| M41 | CI/CD pipeline | §Deployment | No hay GitHub Actions ni Jenkinsfile | **Ausente** | Sin pipeline automatizado |
| M42 | Monitoring: ELK, Prometheus, Jaeger | §Deployment | No implementado | **Ausente** | Sin infraestructura de observabilidad |
| M43 | Cifrado TLS 1.3 | §9.6 | Backend corre en HTTP plano (localhost:9000) | **Ausente** | Esperado para producción vía reverse proxy |
| M44 | Cifrado AES-256 para PII | §9.6 | No implementado | **Ausente** | PII almacenado en texto plano |
| M45 | Hashing bcrypt para PINs (salt rounds: 12) | §9.6 | bcrypt solo para passwords; PINs almacenados en texto plano | **Diferente** | CRÍTICO: Los códigos handshake y locker no están hasheados |
| M46 | Detección GPS spoofing | §9.6 | No implementado | **Ausente** | Sin análisis de trayectoria ni validación de velocidad |
| M47 | Geofencing del área de servicio | §9.6.2 | No implementado | **Ausente** | Sin validación de bounding box de Las Palmas |
| M48 | HMAC-SHA256 para no-repudio | §9.6 | No implementado | **Ausente** | Sin firmas criptográficas en eventos |
| M49 | Rotación de claves JWT cada 90 días | §9.6 | JWT_SECRET hardcoded en .env | **Ausente** | CRÍTICO: Secreto estático "super_secret_jwt_key_demo" |
| M50 | HashiCorp Vault para gestión de secretos | §Deployment | No implementado | **Ausente** | Secretos en .env sin cifrar |
| M51 | Integración IoT con Smart Lockers (WSS bidireccional) | §9.7 | No implementado | **Ausente** | Lockers son entidades lógicas puras |
| M52 | Notificaciones en tiempo real | §9.3.1 | `routes/notifications.ts` + Socket.IO events | **Implementado** | Funcional con tipo LOCKER_READY |
| M53 | Sistema de locaciones con búsqueda Nominatim | — | `routes/locations.ts` proxy a OSM Nominatim | **No documentado** | Presente en código pero sin documentar en memoria |
| M54 | Endpoint de debug con distancias a conductores | — | `routes/debug.ts` GET /active-drivers | **No documentado** | Herramienta de desarrollo útil pero no documentada |
| M55 | Seed de escenario Barcelona | — | `db/seed_bcn.ts` con coordenadas BCN | **No documentado** | Datos de prueba para Barcelona (vs Las Palmas en la memoria) |
| M56 | Geocodificación restringida a Barcelona | — | `routes/locations.ts` hardcodea "Barcelona, Spain" en Nominatim | **Inconsistente** | La memoria habla de Las Palmas; el código usa Barcelona |
| M57 | Tests unitarios y de integración >80% cobertura | §Testing | 4 test files backend, 1 placeholder frontend | **Parcial** | Backend tiene tests útiles; frontend prácticamente sin tests |
| M58 | E2E testing (Cypress) | §Testing | No existe | **Ausente** | Sin framework E2E |
| M59 | Load testing (k6/JMeter) | §Testing | No existe | **Ausente** | Sin tests de carga |
| M60 | Security testing (OWASP) | §Testing | Parcial en security.test.ts | **Parcial** | Solo tests básicos de auth y headers |
| M61 | RGPD: retención 30 días post-completado | §9.6.4 | No implementado | **Ausente** | Sin política de retención de datos |
| M62 | Sanitización de datos sensibles en WebSocket | §Implícito | `utils/dto.ts` sanitizeForSocket() | **Implementado** | Correcto: elimina lockerCode y handshakeCode de broadcasts |
| M63 | Rate limiting global + por endpoint | §9.6 | `middleware/rateLimiter.ts` (3 niveles) | **Implementado** | Global 100/min, Auth 10/min, Locker 5/min |
| M64 | Helmet para headers HTTP de seguridad | §9.6 | `server.ts` usa helmet() | **Implementado** | Headers X-Content-Type-Options, X-Frame-Options presentes |
| M65 | CORS configurado | §9.6 | `server.ts` con whitelist de orígenes | **Implementado** | Restrictivo en producción |
| M66 | Validación de entrada con Zod | §9.6 | `routes/auth.ts` usa Zod schemas | **Parcial** | Solo en registro; no en todos los endpoints |
| M67 | Máquina de estados finitos (FSM) | §Arquitectura | Flujo REQUESTED→...→PICKED_UP implementado | **Implementado** | Transiciones de estado correctas con validación |

---

## 6. Hallazgos detallados

### 6.1 Funcionalidades ausentes

#### H01 — Sistema de comercios (Merchants) B2B

- **Descripción:** Subsistema completo de gestión de comercios asociados
- **Qué dice la memoria:** Define tabla `merchants` con campos business_name, storefront_location, subscription_tier, api_key_hash, integration_status. Describe modelo B2B de suscripción SaaS para comercios.
- **Qué ocurre en el código:** No existe tabla, modelo, ruta, ni referencia alguna a comercios.
- **Impacto:** ALTO — Es un pilar del modelo de negocio B2B2C descrito.
- **Recomendación:** Crear tabla `merchants` en schema, endpoints CRUD, integración con pickup_requests (campo merchant_id).

#### H02 — Dashboard B2A para la Autoridad Portuaria (APLP)

- **Descripción:** Panel de supervisión con métricas, heatmaps y API REST para la APLP
- **Qué dice la memoria:** §3.2.1 y RESPUESTA_CONSULTAS_TECNICAS describen endpoints de heatmaps de compras, throughput de lockers, métricas de timing, fleet status, y exportación de auditoría.
- **Qué ocurre en el código:** El `AdminDashboard` solo tiene lista de usuarios y botón de eliminar. `routes/admin.ts` solo expone GET /users y DELETE /users/:id.
- **Impacto:** CRÍTICO — Es requisito de la subvención Puertos 4.0 demostrar integración con la APLP.
- **Recomendación:** Crear endpoints: GET /admin/metrics/throughput, GET /admin/metrics/timing, GET /admin/heatmaps, GET /admin/fleet-status. Crear frontend AdminDashboard con gráficos (recharts ya está en dependencias).

#### H03 — Log de auditoría inmutable con firma criptográfica

- **Descripción:** Sistema de trazabilidad con eventos firmados y no-repudiables
- **Qué dice la memoria:** §3.1.2 define 5 eventos trazables (REQUESTED, CONFIRMATION_PENDING, IN_PROGRESS, DEPOSITED, PICKED_UP) con timestamps, coordenadas GPS y firma HMAC-SHA256. La RESPUESTA_CONSULTAS_TECNICAS detalla esto como "Traza Auditable".
- **Qué ocurre en el código:** No existe tabla audit_events ni ningún mecanismo de logging de eventos de negocio.
- **Impacto:** CRÍTICO — La trazabilidad es requisito fundamental del programa Puertos 4.0 (Art. 6.2.a.13º).
- **Recomendación:** Crear tabla `audit_events`, servicio de logging que se invoque en cada transición de estado, implementar firma HMAC-SHA256.

#### H04 — Búsqueda radial en cascada (3km → 5km → 7km)

- **Descripción:** Cuando no hay conductores en 3km, expandir progresivamente
- **Qué dice la memoria:** §9.5 y §4.4.1 describen cascada con timeouts de 45 segundos por radio, máximo 3 ciclos, después encolar en Message Queue y notificar al usuario.
- **Qué ocurre en el código:** `routes/requests.ts` filtra conductores activos en 3km y si no hay ninguno, hace broadcast a todos (sin expansión gradual).
- **Impacto:** ALTO — Comportamiento significativamente diferente del documentado.
- **Recomendación:** Implementar lógica de cascada temporal en el backend (posiblemente con setTimeout o job queue) que expanda el radio progresivamente.

#### H05 — Validación de proximidad GPS (<50m) en handshake

- **Descripción:** El handshake requiere que conductor y cliente estén a <50 metros de distancia
- **Qué dice la memoria:** §9.6.2 describe validación geoespacial anti-fraude combinando PIN + proximidad GPS con tolerancia de 50m.
- **Qué ocurre en el código:** POST /requests/:id/confirm-driver solo valida el código numérico de 4 dígitos. No hay ninguna validación de posición GPS.
- **Impacto:** ALTO — Elimina una capa de seguridad anti-fraude documentada.
- **Recomendación:** Añadir parámetros lat/lon al endpoint confirm-driver y validar distancia Haversine < 0.05km.

#### H06 — PWA con capacidades offline-first

- **Descripción:** Progressive Web App con Service Worker e IndexedDB
- **Qué dice la memoria:** §1.2 describe esto como capacidad fundamental: "se aplican estrategias de offline-first utilizando IndexedDB en el lado del cliente".
- **Qué ocurre en el código:** No existe manifest.json, ni service-worker.js, ni uso de IndexedDB. La app es una SPA estándar sin capacidades offline.
- **Impacto:** ALTO — Descrito como pilar técnico diferencial en la memoria.
- **Recomendación:** Añadir vite-plugin-pwa, crear manifest.json, implementar Service Worker con estrategia cache-first para assets y network-first para API.

#### H07 — Pasarela de pagos (Stripe/Adyen)

- **Descripción:** Procesamiento de pagos por transacción
- **Qué dice la memoria:** §14.8.1 describe integración con Stripe/Adyen mediante tokenización PCI-DSS compliant.
- **Qué ocurre en el código:** No existe ninguna integración de pagos.
- **Impacto:** MEDIO — Necesario para el modelo de negocio pero puede considerarse fase posterior.
- **Recomendación:** Crear módulo de pagos con integración Stripe. Añadir campo price/payment_status a pickup_requests.

#### H08 — Integración con manifiesto de cruceros

- **Descripción:** Consulta de horarios All Aboard para calcular ventanas de servicio
- **Qué dice la memoria:** Modelo de datos incluye tabla cruise_manifest con vessel_id, scheduled_arrival, scheduled_all_aboard, estimated_passenger_count.
- **Qué ocurre en el código:** No existe tabla ni lógica relacionada con horarios de cruceros.
- **Impacto:** MEDIO — Necesario para validar ventanas de servicio y urgencia.
- **Recomendación:** Crear tabla cruise_manifest, endpoint para consulta, y lógica que vincule solicitudes con ventanas temporales de cruceros.

#### H09 — TTL del PIN de apertura de locker

- **Descripción:** El PIN de 6 dígitos debe expirar a las 23:59 del mismo día
- **Qué dice la memoria:** §2.3.4 especifica TTL para el OTP de apertura.
- **Qué ocurre en el código:** El locker_code se genera en el depósito pero nunca se verifica su expiración.
- **Impacto:** MEDIO — Riesgo de seguridad si un código sigue válido indefinidamente.
- **Recomendación:** Añadir campo `locker_code_expires_at` a pickup_requests y validar en POST /lockers/open.

#### H10 — Canal SMS de contingencia para OTP

- **Descripción:** Envío de OTP por SMS si la app falla
- **Qué dice la memoria:** §9.7 describe SMS como canal de respaldo.
- **Qué ocurre en el código:** No existe integración SMS.
- **Impacto:** BAJO — Funcionalidad de contingencia, no crítica para MVP.
- **Recomendación:** Integrar Twilio/AWS SNS como servicio de SMS.

---

### 6.2 Funcionalidades implementadas de forma distinta

#### H11 — Base de datos: SQLite vs PostgreSQL + PostGIS

- **Descripción:** La memoria enfatiza PostgreSQL con PostGIS para indexación R-Tree
- **Qué dice la memoria:** §9.1.3 reconoce SQLite para piloto pero todo el diseño de seguridad, concurrencia y geoespacial está basado en PostgreSQL (SELECT...FOR UPDATE, R-Tree, PostGIS functions).
- **Qué ocurre en el código:** Usa better-sqlite3. La concurrencia se maneja con serialización implícita de SQLite, no con bloqueo a nivel de fila.
- **Impacto:** ALTO — Limita la escalabilidad y no permite las optimizaciones geoespaciales descritas.
- **Recomendación:** Migrar a PostgreSQL + PostGIS. Usar Prisma o Knex.js como ORM para facilitar la transición.

#### H12 — Modelo de datos simplificado

- **Descripción:** 4 tablas en código vs 8+ descritas
- **Qué dice la memoria:** 8+ entidades con campos detallados, relaciones complejas, y campos de auditoría.
- **Qué ocurre en el código:** Solo `users`, `lockers`, `pickup_requests`, `notifications`. La tabla `users` combina pasajeros, conductores y admins sin diferenciación de campos.
- **Impacto:** ALTO — Modelo insuficiente para soportar las funcionalidades descritas.
- **Recomendación:** Ampliar schema según el modelo de la memoria. Considerar tablas separadas para drivers y merchants.

#### H13 — Rate limiting: global por IP vs por orden/usuario

- **Descripción:** El rate limiting descrito es granular (por orden, por usuario); el implementado es genérico por IP
- **Qué dice la memoria:** 3 intentos de handshake por orden, 10 órdenes/día/usuario, 3 intentos OTP/sesión.
- **Qué ocurre en el código:** express-rate-limit por IP: 100/min global, 10/min auth, 5/min locker open.
- **Impacto:** MEDIO — Protección insuficiente contra ataques dirigidos.
- **Recomendación:** Implementar rate limiting a nivel de negocio: contador de intentos en pickup_requests, límite diario de órdenes por usuario.

#### H14 — Hashing de códigos sensibles

- **Descripción:** La memoria especifica bcrypt para PINs; el código almacena en texto plano
- **Qué dice la memoria:** §9.6 describe bcrypt con salt rounds 12 para hashing de códigos handshake y OTP.
- **Qué ocurre en el código:** `handshake_code` y `locker_code` se almacenan como texto plano en la BD y se comparan directamente.
- **Impacto:** MEDIO-ALTO — Si la BD se compromete, todos los códigos activos son legibles.
- **Recomendación:** Hashear códigos con bcrypt antes de almacenar. Comparar con bcrypt.compare() en validación.

#### H15 — Geolocalización hardcodeada a Barcelona vs Las Palmas

- **Descripción:** La memoria habla del Puerto de Las Palmas; el código usa Barcelona
- **Qué dice la memoria:** Proyecto para el Puerto de Las Palmas de Gran Canaria.
- **Qué ocurre en el código:** `routes/locations.ts` busca con scope "Barcelona, Spain". `seed_bcn.ts` tiene coordenadas de Barcelona.
- **Impacto:** MEDIO — Inconsistencia geográfica entre documento y código.
- **Recomendación:** Parametrizar la ubicación (via config). Crear seed para Las Palmas además de Barcelona.

---

### 6.3 Errores o defectos probables

#### H16 — AdminDashboard referencia campos inexistentes

- **Descripción:** El AdminDashboard usa `user.ordered_count` y `user.deposited_count`
- **Qué ocurre:** La API GET /admin/users retorna `requestsCount` (un solo contador). El frontend referencia campos que no existen en la respuesta.
- **Impacto:** MEDIO — Las columnas de la tabla admin probablemente muestran "undefined".
- **Recomendación:** Corregir AdminDashboard para usar `requestsCount` o ampliar la API para retornar contadores desglosados.

#### H17 — Componente DriverMap creado pero no utilizado

- **Descripción:** Se creó un componente Leaflet completo para el mapa del conductor que nunca se renderiza
- **Qué ocurre:** `DriverMap.tsx` existe con funcionalidad de mapa, marcadores y popups, pero `DriverDashboard.tsx` no lo importa ni usa.
- **Impacto:** BAJO — Código muerto que añade complejidad innecesaria.
- **Recomendación:** Integrar DriverMap en DriverDashboard o eliminarlo.

#### H18 — Componente Index.tsx vacío

- **Descripción:** `pages/Index.tsx` retorna null
- **Qué ocurre:** Componente placeholder que no hace nada. La ruta `/` ya apunta a LoginPage.
- **Impacto:** BAJO — Código muerto.
- **Recomendación:** Eliminar o redirigir a login.

#### H19 — Hook useToast custom duplicado

- **Descripción:** Existe un hook useToast personalizado (reducer-based) mientras la app usa Sonner
- **Qué ocurre:** `hooks/use-toast.ts` implementa un sistema de toast completo, pero toda la app usa `sonner` (toast de `sonner`).
- **Impacto:** BAJO — Código muerto/duplicado.
- **Recomendación:** Eliminar el hook custom si no se usa, o migrar consistentemente a uno u otro.

#### H20 — JWT_SECRET hardcodeado como "super_secret_jwt_key_demo"

- **Descripción:** El secreto JWT en .env es un valor demo trivial
- **Qué ocurre:** `JWT_SECRET=super_secret_jwt_key_demo` en `.env`. Además, el `.env` está incluido en el repositorio (no hay `.gitignore` en backend).
- **Impacto:** CRÍTICO en producción — Cualquier persona con acceso al repo puede forjar tokens JWT válidos.
- **Recomendación:** Generar secreto criptográficamente seguro, NO incluir .env en el repositorio, usar variables de entorno del sistema o vault.

#### H21 — Archivo .env incluido en el repositorio sin .gitignore

- **Descripción:** El backend no tiene .gitignore visible; .env con secretos está en el directorio
- **Qué ocurre:** `backend/.env` contiene JWT_SECRET y es accesible en el código fuente.
- **Impacto:** ALTO — Violación de seguridad si se sube a un repositorio público.
- **Recomendación:** Crear `backend/.gitignore` con .env, database.sqlite, node_modules, dist.

---

### 6.4 Problemas de arquitectura y mantenibilidad

#### H22 — Arquitectura monolítica vs microservicios documentados

- **Descripción:** La memoria describe microservicios con mTLS; el código es un monolito
- **Impacto:** ALTO — Brecha fundamental de arquitectura.
- **Recomendación:** Para fase de piloto TRL 7, un monolito modular es aceptable, pero debe documentarse esta decisión explícitamente y planificar la migración.

#### H23 — Ausencia de capa de servicios (Service Layer)

- **Descripción:** La lógica de negocio está directamente en los route handlers
- **Qué ocurre:** `routes/requests.ts` contiene lógica de matching, generación de códigos, validaciones de estado, queries SQL y emisión de WebSocket todo en el mismo handler.
- **Impacto:** MEDIO — Dificulta testing unitario, reutilización y mantenimiento.
- **Recomendación:** Extraer lógica a servicios: `RequestService`, `LockerService`, `GeoService`, `NotificationService`.

#### H24 — Ausencia de Repository Pattern

- **Descripción:** La memoria menciona Repository Pattern como práctica de ingeniería (§1.2); el código hace queries SQL directas en routes
- **Impacto:** MEDIO — No hay abstracción de la capa de persistencia, dificultando la migración a PostgreSQL.
- **Recomendación:** Crear `repositories/`: UserRepository, RequestRepository, LockerRepository, NotificationRepository.

#### H25 — Estado del frontend en sessionStorage (no persistente)

- **Descripción:** `AppContext.tsx` usa sessionStorage, que se borra al cerrar la pestaña
- **Impacto:** BAJO-MEDIO — El usuario pierde sesión al cerrar pestaña (vs localStorage que persiste).
- **Recomendación:** Evaluar si conviene usar localStorage para persistencia entre pestañas/sesiones.

#### H26 — Hardcoding de URLs de API

- **Descripción:** `services/api.ts` tiene `baseURL: "http://localhost:9000/api"` hardcodeado. `socket.ts` tiene `io("http://localhost:9000")`.
- **Impacto:** MEDIO — Impide despliegue en cualquier entorno que no sea local.
- **Recomendación:** Usar variable de entorno VITE_API_URL y VITE_SOCKET_URL.

---

### 6.5 Problemas de seguridad, validación o manejo de errores

#### H27 — PINs y códigos almacenados en texto plano

- **Descripción:** handshake_code (4 dígitos) y locker_code (6 dígitos) no están hasheados
- **Impacto:** ALTO — Compromiso de BD expone todos los códigos activos.
- **Recomendación:** Hashear con bcrypt antes de almacenar; comparar con bcrypt.compare().

#### H28 — Ausencia de validación Zod en la mayoría de endpoints

- **Descripción:** Solo `routes/auth.ts` (register) usa Zod. El resto de endpoints no valida esquemas.
- **Impacto:** MEDIO — Posible inyección de datos malformados.
- **Recomendación:** Añadir schemas Zod para todos los endpoints: create request, accept, confirm-driver, deposit, open locker.

#### H29 — No hay limitación de órdenes por usuario/día

- **Descripción:** La memoria dice 10 órdenes/día/usuario; el código no tiene este límite.
- **Impacto:** BAJO-MEDIO — Posible abuso por creación masiva de solicitudes.
- **Recomendación:** Añadir validación en POST /requests que cuente solicitudes del día.

#### H30 — Error handler global no registra en sistema de logging

- **Descripción:** `utils/errors.ts` globalErrorHandler hace console.error pero no hay sistema de logging estructurado.
- **Impacto:** MEDIO — Dificulta diagnóstico en producción.
- **Recomendación:** Integrar winston o pino para logging estructurado JSON.

#### H31 — CORS demasiado permisivo en desarrollo

- **Descripción:** `server.ts` acepta cualquier localhost:* en desarrollo
- **Impacto:** BAJO — Solo relevante en modo development.
- **Recomendación:** Documentar claramente el comportamiento CORS por entorno.

---

### 6.6 Elementos presentes en código pero no reflejados en la memoria

#### H32 — Endpoint de búsqueda de ubicaciones (Nominatim proxy)

- **Descripción:** `routes/locations.ts` implementa búsqueda de direcciones via Nominatim OSM
- **Qué ocurre en el código:** GET /locations/search?q= proxifica a Nominatim con scope Barcelona.
- **Impacto:** Ninguno negativo — Funcionalidad útil.
- **Recomendación:** Documentar en la memoria como componente de UX.

#### H33 — Endpoint debug de conductores activos

- **Descripción:** `routes/debug.ts` expone /debug/active-drivers con distancias calculadas
- **Impacto:** BAJO — Solo en desarrollo; útil para diagnóstico.
- **Recomendación:** Asegurar que no se expone en producción (ya tiene guard de `config.env !== 'production'`).

#### H34 — Seed de datos para Barcelona

- **Descripción:** `db/seed_bcn.ts` con coordenadas específicas de La Rambla, conductores a diferentes distancias
- **Impacto:** Ninguno — Herramienta de desarrollo.
- **Recomendación:** Crear equivalente para Las Palmas. Documentar scripts de seed.

#### H35 — Renovación de código handshake

- **Descripción:** POST /requests/:id/renew-handshake permite al conductor regenerar el código si expira
- **Impacto:** Positivo — Mejora la UX cuando el código expira.
- **Recomendación:** Documentar en la memoria técnica.

---

### 6.7 Carencias en testing

#### H36 — Frontend sin tests reales

- **Descripción:** `test/example.test.ts` solo tiene `expect(true).toBe(true)`
- **Impacto:** ALTO — 0% de cobertura en frontend.
- **Test cases necesarios:**
  - Renderizado de LoginPage con tabs de login/registro
  - Flujo de creación de solicitud en ClientDashboard
  - Renderizado de StatusBadge con cada estado
  - ProtectedRoute redirecciona sin token
  - NotificationBell muestra conteo correcto
  - Hook useSocket conecta y desconecta correctamente

#### H37 — Ausencia de tests E2E

- **Descripción:** No existe framework de tests E2E (Cypress descrito en memoria)
- **Impacto:** ALTO — No se prueba el flujo completo navegador → backend → BD.
- **Test cases necesarios:**
  - Happy path completo: registro → login → solicitud → aceptación → handshake → depósito → recogida
  - Manejo de errores: código incorrecto, solicitud duplicada, conductor fuera de rango
  - Concurrencia: dos conductores aceptan simultáneamente

#### H38 — Ausencia de tests de carga

- **Descripción:** No existe configuración de k6 ni JMeter
- **Impacto:** MEDIO — No se conoce el rendimiento bajo carga.
- **Recomendación:** Crear scripts k6 para escenarios de 100 y 500 usuarios concurrentes.

#### H39 — Tests backend no miden cobertura

- **Descripción:** Jest está configurado pero no hay reporte de cobertura ni threshold
- **Impacto:** MEDIO — No se puede verificar el requisito de >80% descrito en la memoria.
- **Recomendación:** Añadir `collectCoverage: true`, `coverageThreshold: { global: { branches: 80, functions: 80, lines: 80 } }` a jest.config.ts.

---

## 7. Archivos a modificar

| # | Ruta del archivo | Problema detectado | Cambio recomendado | Prioridad |
|---|-----------------|-------------------|-------------------|-----------|
| 1 | `backend/src/db/schema.sql.ts` | Modelo de datos incompleto (4 tablas vs 8+) | Añadir tablas: merchants, audit_events, handshake_attempts, cruise_manifest. Ampliar campos en pickup_requests y users. | **Crítica** |
| 2 | `backend/.env` | JWT_SECRET hardcodeado como demo | Generar secreto seguro (64 bytes random hex). Añadir template .env.example. | **Crítica** |
| 3 | `backend/src/routes/requests.ts` | Sin cascada 3km→5km→7km; sin validación GPS en handshake; sin rate limiting de intentos por orden | Implementar búsqueda en cascada, validación de proximidad GPS en confirm-driver, contador de intentos por handshake. | **Alta** |
| 4 | `backend/src/routes/lockers.ts` | Sin TTL en locker_code | Validar expiración del código (23:59 del día de generación). | **Alta** |
| 5 | `backend/src/routes/admin.ts` | Solo CRUD de usuarios; falta dashboard B2A | Añadir endpoints: GET /admin/metrics/*, GET /admin/heatmaps/*, GET /admin/fleet-status. | **Alta** |
| 6 | `cruise-connect-main/src/pages/AdminDashboard.tsx` | Referencia campos inexistentes (ordered_count, deposited_count) | Corregir a `requestsCount` o actualizar la API para retornar contadores desglosados. | **Alta** |
| 7 | `cruise-connect-main/src/services/api.ts` | URL hardcodeada http://localhost:9000 | Usar `import.meta.env.VITE_API_URL \|\| 'http://localhost:9000'` | **Alta** |
| 8 | `cruise-connect-main/src/socket.ts` | URL hardcodeada http://localhost:9000 | Usar variable de entorno VITE_SOCKET_URL | **Alta** |
| 9 | `backend/src/routes/locations.ts` | Hardcoded "Barcelona, Spain" | Parametrizar ubicación via config.serviceArea o similar | **Media** |
| 10 | `backend/src/db/database.ts` | Sin logging de eventos de negocio | Añadir función logAuditEvent() que inserte en audit_events | **Alta** |
| 11 | `backend/src/sockets/io.ts` | Sin heartbeat explícito ni config de reconnection | Configurar pingTimeout, pingInterval, acknowledges explícitos | **Media** |
| 12 | `backend/src/utils/dto.ts` | No hashea códigos sensibles | Integrar bcrypt.hash() para handshake_code y locker_code antes de almacenar | **Alta** |
| 13 | `backend/jest.config.ts` | Sin cobertura ni thresholds | Añadir collectCoverage, coverageThreshold >80% | **Media** |
| 14 | `cruise-connect-main/src/pages/DriverDashboard.tsx` | No integra DriverMap | Importar y renderizar DriverMap con pendingRequests | **Media** |
| 15 | `backend/src/server.ts` | Sin logging estructurado | Integrar pino o winston para logging JSON | **Media** |
| 16 | `backend/src/config/env.ts` | Faltan variables para cascada, geofencing, TTL | Añadir: SEARCH_RADII, GEOFENCE_BOUNDS, OTP_TTL, PIN_ATTEMPT_LIMIT | **Media** |
| 17 | `backend/package.json` | Sin scripts de cobertura ni lint | Añadir scripts: "test:coverage", "lint", "lint:fix" | **Baja** |
| 18 | `cruise-connect-main/src/context/AppContext.tsx` | Usa sessionStorage (no persiste entre pestañas) | Evaluar migración a localStorage con expiración | **Baja** |

---

## 8. Archivos nuevos a crear

| # | Archivo nuevo sugerido | Propósito | Motivo | Contenido esperado | Prioridad |
|---|----------------------|-----------|--------|-------------------|-----------|
| 1 | `backend/.gitignore` | Excluir archivos sensibles del repo | .env con secretos está expuesto | .env, node_modules/, dist/, database.sqlite*, *.log | **Crítica** |
| 2 | `backend/.env.example` | Template de variables de entorno | Guía para nuevos desarrolladores sin exponer secretos | Variables con valores placeholder | **Crítica** |
| 3 | `backend/Dockerfile` | Contenerización del backend | La memoria describe Docker como requisito de despliegue | Multi-stage build: Node 20 Alpine, npm ci, build, ejecutar dist/index.js | **Alta** |
| 4 | `docker-compose.yml` | Orquestación local de servicios | Alinear con arquitectura descrita (backend + frontend + PostgreSQL + Redis) | Servicios: backend, frontend, postgres, redis | **Alta** |
| 5 | `backend/src/services/RequestService.ts` | Capa de servicio para lógica de solicitudes | Separar lógica de negocio de route handlers (Repository Pattern mencionado en §1.2) | Métodos: createRequest, acceptRequest, confirmHandshake, deposit, openLocker | **Alta** |
| 6 | `backend/src/services/AuditService.ts` | Servicio de logging de auditoría | Implementar trazabilidad auditable requerida (§3.1.2) | logEvent(orderId, eventType, actorId, coordinates), con HMAC-SHA256 | **Alta** |
| 7 | `backend/src/services/GeoService.ts` | Servicio de geo-dispatching | Encapsular lógica de cascada radial y matching | cascadeSearch(coords, radii[3,5,7], timeout45s), findDriversInRadius() | **Alta** |
| 8 | `backend/src/repositories/RequestRepository.ts` | Repository Pattern para solicitudes | Abstracción de capa de datos (§1.2 del documento) | findById, findByStatus, create, updateStatus, findActive | **Media** |
| 9 | `backend/src/repositories/LockerRepository.ts` | Repository Pattern para lockers | Abstracción de capa de datos | findAvailable, assignToRequest, release, findByCode | **Media** |
| 10 | `backend/src/routes/merchants.ts` | CRUD de comercios B2B | Subsistema merchants ausente (memoria §14.8) | POST /register, GET /profile, PUT /profile, GET /merchants/nearby | **Alta** |
| 11 | `backend/src/middleware/validateSchema.ts` | Middleware genérico de validación Zod | Solo auth.ts valida con Zod; falta en el resto | Middleware factory que valida body/params/query contra schema Zod | **Media** |
| 12 | `backend/src/__tests__/audit.test.ts` | Tests para sistema de auditoría | Sin cobertura de audit logging | Test de inserción, firma HMAC, inmutabilidad, consulta por orden | **Media** |
| 13 | `backend/src/__tests__/cascade-search.test.ts` | Tests para búsqueda en cascada | Feature no implementada aún; necesitará tests | Test de expansión 3→5→7km, timeout, fallback a queue | **Media** |
| 14 | `cruise-connect-main/src/__tests__/LoginPage.test.tsx` | Tests unitarios de LoginPage | Frontend sin tests | Render, form submission, error handling, tab switching | **Media** |
| 15 | `cruise-connect-main/src/__tests__/ClientDashboard.test.tsx` | Tests unitarios de ClientDashboard | Frontend sin tests | Creación solicitud, confirmación handshake, apertura locker | **Media** |
| 16 | `cruise-connect-main/src/__tests__/StatusBadge.test.tsx` | Tests de componente StatusBadge | Frontend sin tests | Render con cada estado, clase CSS correcta | **Baja** |
| 17 | `cruise-connect-main/cypress/` | Framework de tests E2E | E2E ausente (descrito en memoria) | Configuración Cypress + specs para happy path y edge cases | **Media** |
| 18 | `k6/load-test.js` | Scripts de load testing | Carga testing ausente (descrito en memoria) | Escenarios: 100 VUs steady, 500 VUs peak, 6h sustained | **Media** |
| 19 | `cruise-connect-main/public/manifest.json` | Manifiesto PWA | La app no es PWA pese a describirlo en la memoria | name, short_name, icons, start_url, display: standalone | **Alta** |
| 20 | `cruise-connect-main/public/sw.js` | Service Worker | Capacidades offline ausentes | Cache-first para assets, network-first para API | **Alta** |
| 21 | `nginx.conf` | Configuración de reverse proxy | Sin configuración de TLS/proxy para producción | TLS 1.3, proxy_pass a backend, servir frontend estático | **Media** |
| 22 | `backend/src/db/migrations/` | Sistema de migraciones | Ausente; schema.sql.ts aplicado directamente | Migraciones incrementales para cambios de schema | **Media** |
| 23 | `.github/workflows/ci.yml` | Pipeline CI/CD | Ausente (descrito en memoria) | lint, test, build, docker build, deploy | **Media** |

---

## 9. Plan de corrección priorizado

### Fase 1 — Correcciones críticas (Semana 1-2)

| # | Acción | Justificación | Archivos afectados | Dependencias | Prioridad |
|---|--------|--------------|-------------------|-------------|-----------|
| 1.1 | Crear `.gitignore` para backend | Secretos expuestos en repositorio | `backend/.gitignore` (nuevo) | Ninguna | Crítica |
| 1.2 | Rotar JWT_SECRET y crear .env.example | JWT_SECRET demo inseguro | `backend/.env`, `backend/.env.example` (nuevo) | Ninguna | Crítica |
| 1.3 | Corregir AdminDashboard (campos inexistentes) | Bug funcional visible al usuario | `cruise-connect-main/src/pages/AdminDashboard.tsx` | Ninguna | Crítica |
| 1.4 | Parametrizar URLs de API en frontend | Impide despliegue no-local | `services/api.ts`, `socket.ts`, `.env` | Ninguna | Crítica |
| 1.5 | Hashear códigos handshake y locker | Códigos sensibles en texto plano | `routes/requests.ts`, `routes/lockers.ts` | Ninguna | Crítica |

### Fase 2 — Ajustes funcionales (Semana 3-5)

| # | Acción | Justificación | Archivos afectados | Dependencias | Prioridad |
|---|--------|--------------|-------------------|-------------|-----------|
| 2.1 | Ampliar modelo de datos (merchants, audit_events, etc.) | Modelo incompleto vs memoria | `db/schema.sql.ts`, nuevo: migraciones | Fase 1 | Alta |
| 2.2 | Implementar sistema de auditoría con firma HMAC | Requisito de trazabilidad Puertos 4.0 | Nuevo: `services/AuditService.ts`, `audit_events` tabla | 2.1 | Alta |
| 2.3 | Implementar búsqueda radial en cascada (3→5→7km) | Feature documentada no implementada | `routes/requests.ts`, nuevo: `services/GeoService.ts` | Ninguna | Alta |
| 2.4 | Añadir validación GPS de proximidad en handshake | Seguridad anti-fraude documentada | `routes/requests.ts` | Ninguna | Alta |
| 2.5 | Implementar TTL de locker code | PIN sin expiración es riesgo de seguridad | `routes/lockers.ts`, `db/schema.sql.ts` | 2.1 | Alta |
| 2.6 | Crear endpoints B2A para APLP (métricas, heatmaps) | Requisito de subvención Puertos 4.0 | `routes/admin.ts`, nuevo: `AdminDashboard` mejorado | 2.1, 2.2 | Alta |
| 2.7 | Implementar rate limiting por orden (handshake) | Documentado: 3 intentos máx con escalación L1 | `routes/requests.ts`, nuevo tabla `handshake_attempts` | 2.1 | Alta |
| 2.8 | Añadir categoría volumétrica "voluminous" | Memoria describe 3 categorías; código solo tiene 2 | `db/schema.sql.ts`, `routes/requests.ts`, frontend forms | 2.1 | Media |
| 2.9 | Parametrizar ubicación geográfica (Las Palmas / Barcelona) | Código hardcodea Barcelona; memoria dice Las Palmas | `config/env.ts`, `routes/locations.ts`, seed scripts | Ninguna | Media |

### Fase 3 — Refactorización y arquitectura (Semana 6-8)

| # | Acción | Justificación | Archivos afectados | Dependencias | Prioridad |
|---|--------|--------------|-------------------|-------------|-----------|
| 3.1 | Migrar de SQLite a PostgreSQL + PostGIS | Alinear con arquitectura descrita; habilitar R-Tree, SELECT...FOR UPDATE | Todos los archivos de db/, posiblemente usar Prisma/Knex | Fase 2 | Alta |
| 3.2 | Extraer Service Layer | Lógica en route handlers viola SoC; Repository Pattern documentado | Nuevo: services/*.ts, repositories/*.ts | 3.1 | Media |
| 3.3 | Crear Dockerfile y docker-compose | Despliegue contenerizado descrito en memoria | Nuevos: Dockerfile, docker-compose.yml, .dockerignore | 3.1 | Alta |
| 3.4 | Implementar PWA (manifest + Service Worker) | Descrito como pilar técnico | Nuevos: manifest.json, sw.js; config Vite PWA plugin | Ninguna | Alta |
| 3.5 | Integrar logging estructurado (pino/winston) | Sin observabilidad en producción | `server.ts`, nuevo: `logger.ts` | Ninguna | Media |
| 3.6 | Añadir validación Zod a todos los endpoints | Solo register tiene validación de schema | Todos los route handlers | 3.2 | Media |
| 3.7 | Integrar DriverMap en DriverDashboard | Componente creado pero no utilizado | `pages/DriverDashboard.tsx` | Ninguna | Baja |
| 3.8 | Limpiar código muerto | Index.tsx vacío, useToast duplicado | `pages/Index.tsx`, `hooks/use-toast.ts` | Ninguna | Baja |

### Fase 4 — Testing y documentación (Semana 9-11)

| # | Acción | Justificación | Archivos afectados | Dependencias | Prioridad |
|---|--------|--------------|-------------------|-------------|-----------|
| 4.1 | Configurar cobertura Jest con threshold 80% | Requisito de la memoria | `jest.config.ts` | Ninguna | Media |
| 4.2 | Escribir tests unitarios frontend (Login, Client, Driver, components) | 0% cobertura frontend | Nuevos: `__tests__/*.test.tsx` | Ninguna | Alta |
| 4.3 | Configurar e implementar tests E2E (Cypress) | Descrito en memoria, ausente en código | Nuevo: `cypress/` con specs | Fase 3 | Media |
| 4.4 | Crear scripts de load testing (k6) | Descrito en memoria, ausente en código | Nuevo: `k6/load-test.js` | Fase 3 | Media |
| 4.5 | Configurar pipeline CI/CD (GitHub Actions) | Descrito en memoria, ausente | Nuevo: `.github/workflows/ci.yml` | Fase 3 | Media |
| 4.6 | Actualizar memoria técnica con elementos no documentados | Código tiene features no reflejadas (Nominatim, renew handshake, debug tools) | MEMORIA_TECNICA.md | Fase 2, 3 | Baja |

---

## 10. Riesgos si no se corrige

### Riesgo 1: Incumplimiento de requisitos de subvención (CRÍTICO)
La Memoria Técnica Justificativa se presentó al programa Puertos 4.0 del Fondo de Innovación Abierta. Si un evaluador técnico compara la memoria con el código en su estado actual, encontrará que la mayoría de las funcionalidades avanzadas descritas (PostgreSQL + PostGIS, microservicios, Docker, Redis, audit logging criptográfico, PWA offline-first, dashboard B2A, integración IoT, sistema de merchants) no están implementadas. Esto podría resultar en la denegación de la subvención o la obligación de devolución de fondos ya percibidos.

### Riesgo 2: Vulnerabilidades de seguridad (ALTO)
Los códigos de handshake (4 dígitos) y locker (6 dígitos) almacenados en texto plano, combinados con un JWT_SECRET demo y la ausencia de .gitignore, crean vectores de ataque significativos. En un entorno real con equipaje de cruceristas, esto podría resultar en acceso no autorizado a lockers.

### Riesgo 3: Imposibilidad de escalar (ALTO)
SQLite con Haversine puro O(N) no puede soportar el volumen descrito en la memoria (500 usuarios concurrentes, miles de transacciones diarias). Sin Redis, no se pueden escalar WebSockets entre múltiples instancias. Sin Docker, no se puede desplegar en infraestructura cloud.

### Riesgo 4: Imposibilidad de auditoría operativa (ALTO)
Sin el sistema de audit logging, no se puede demostrar trazabilidad de la cadena logística, que es requisito del Art. 6.2.a.13º de la convocatoria. No hay forma de probar quién recogió qué, cuándo, y dónde.

### Riesgo 5: Experiencia de usuario degradada (MEDIO)
Sin PWA/offline-first, la app fallará en zonas con mala cobertura (muelles, terminales). Sin el DriverMap integrado, los conductores no tienen visión geográfica de las solicitudes. El AdminDashboard tiene bugs visibles (campos undefined).

### Riesgo 6: Deuda técnica creciente (MEDIO)
La ausencia de Service Layer, Repository Pattern, tests frontend, y CI/CD hace que cada nueva funcionalidad sea más costosa de desarrollar y más propensa a introducir regresiones. El código muerto (Index.tsx, useToast, DriverMap no usado) genera confusión para nuevos desarrolladores.

---

## 11. Conclusión final

El proyecto City2Cruise presenta un **núcleo funcional sólido** que demuestra dominio técnico del flujo transaccional principal: el ciclo de vida completo de una solicitud de recogida (desde la creación hasta la apertura del locker) está correctamente implementado con protección transaccional contra condiciones de carrera, comunicación en tiempo real via WebSockets, y una interfaz de usuario funcional en español con tres roles diferenciados.

Sin embargo, existe una **brecha crítica** entre la ambición descrita en la Memoria Técnica Justificativa y la implementación actual. La memoria describe un sistema de producción distribuido con microservicios, PostgreSQL + PostGIS, Redis, Docker/Kubernetes, integración IoT real, pasarela de pagos, sistema de comercios B2B, dashboard para la Autoridad Portuaria, audit logging criptográfico, PWA offline-first, y un extenso framework de testing. **La implementación actual es un prototipo/MVP** con arquitectura monolítica, SQLite, 4 tablas, sin contenerización, sin integración IoT, y con cobertura de tests insuficiente.

**La prioridad inmediata debe ser:**

1. **Cerrar las brechas de seguridad** (secretos, hashing de códigos, .gitignore)
2. **Implementar los requisitos vinculados a la subvención** (audit logging, dashboard B2A, trazabilidad)
3. **Alinear la arquitectura** con lo descrito (PostgreSQL, Docker, PWA)
4. **Ampliar la cobertura de tests** para alcanzar el umbral declarado

El proyecto tiene una base técnica viable para evolucionar hacia lo descrito en la memoria, pero requiere un esfuerzo de desarrollo significativo y priorizado para cerrar las brechas identificadas en esta auditoría.

---

## Anexo: Checklist de verificación

| # | Ítem | Estado actual | Acción requerida |
|---|------|--------------|-----------------|
| 1 | .gitignore en backend con .env excluido | ❌ Ausente | Crear inmediatamente |
| 2 | JWT_SECRET seguro (no demo) | ❌ Inseguro | Rotar inmediatamente |
| 3 | Códigos handshake/locker hasheados (bcrypt) | ❌ Texto plano | Implementar en Fase 1 |
| 4 | URLs de API parametrizadas (no localhost) | ❌ Hardcoded | Implementar en Fase 1 |
| 5 | AdminDashboard sin bugs de campos | ❌ Bug activo | Corregir en Fase 1 |
| 6 | PostgreSQL + PostGIS | ❌ Usando SQLite | Migrar en Fase 3 |
| 7 | Tabla merchants | ❌ Ausente | Crear en Fase 2 |
| 8 | Tabla audit_events con HMAC | ❌ Ausente | Crear en Fase 2 |
| 9 | Tabla handshake_attempts | ❌ Ausente | Crear en Fase 2 |
| 10 | Tabla cruise_manifest | ❌ Ausente | Crear en Fase 2 |
| 11 | Búsqueda radial cascada 3→5→7km | ❌ Solo 3km+broadcast | Implementar en Fase 2 |
| 12 | Validación GPS proximidad handshake (<50m) | ❌ Ausente | Implementar en Fase 2 |
| 13 | TTL de locker code (23:59 mismo día) | ❌ Sin expiración | Implementar en Fase 2 |
| 14 | Rate limiting handshake 3 intentos/orden | ❌ Solo por IP global | Implementar en Fase 2 |
| 15 | Endpoints B2A para APLP | ❌ Ausentes | Implementar en Fase 2 |
| 16 | Categoría volumétrica "voluminous" | ❌ Solo S/M | Añadir en Fase 2 |
| 17 | Dockerfile + docker-compose | ❌ Ausentes | Crear en Fase 3 |
| 18 | PWA manifest + Service Worker | ❌ Ausentes | Crear en Fase 3 |
| 19 | Service Layer + Repository Pattern | ❌ Lógica en routes | Refactorizar en Fase 3 |
| 20 | Logging estructurado (pino/winston) | ❌ Solo console.error | Implementar en Fase 3 |
| 21 | Validación Zod en todos los endpoints | ❌ Solo en register | Implementar en Fase 3 |
| 22 | DriverMap integrado en DriverDashboard | ❌ No utilizado | Integrar en Fase 3 |
| 23 | Tests frontend (>80% cobertura) | ❌ 0% cobertura | Escribir en Fase 4 |
| 24 | Tests E2E (Cypress) | ❌ Ausentes | Configurar en Fase 4 |
| 25 | Tests de carga (k6) | ❌ Ausentes | Crear en Fase 4 |
| 26 | CI/CD pipeline (GitHub Actions) | ❌ Ausente | Crear en Fase 4 |
| 27 | Cobertura Jest con threshold 80% | ❌ Sin threshold | Configurar en Fase 4 |
| 28 | Parametrización geográfica (Las Palmas vs BCN) | ❌ Hardcoded BCN | Parametrizar en Fase 2 |
| 29 | Redis para Pub/Sub WebSocket | ❌ Ausente | Implementar en Fase 3 |
| 30 | Pasarela de pagos (Stripe/Adyen) | ❌ Ausente | Evaluar prioridad |
| 31 | Canal SMS contingencia | ❌ Ausente | Evaluar prioridad |
| 32 | Integración manifiesto cruceros | ❌ Ausente | Evaluar prioridad |

---

*Fin del documento de auditoría.*
