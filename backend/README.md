# City2Cruise — Backend

API REST + WebSocket server para la plataforma de logística de última milla City2Cruise.

---

## Requisitos

- Node.js >= 20
- npm >= 9

No se necesita instalar SQLite por separado; `better-sqlite3` incluye el motor como binario nativo.

---

## Setup

```bash
# 1. Instalar dependencias
npm install

# 2. Crear archivo de variables de entorno
cp .env.example .env
# Editar .env y establecer JWT_SECRET y AUDIT_HMAC_SECRET

# 3. Poblar base de datos con datos de demo (Las Palmas de Gran Canaria)
npm run seed-lp

# 4. Arrancar en modo desarrollo (hot reload)
npm run dev
```

El servidor escucha en `http://localhost:9000` por defecto.

---

## Scripts

| Comando | Descripción |
|---------|-------------|
| `npm run dev` | Desarrollo con tsx watch (hot reload) |
| `npm start` | Producción desde `dist/` compilado |
| `npm run build` | Compilar TypeScript → `dist/` |
| `npm test` | Tests Jest (sin cobertura) |
| `npm run test:coverage` | Tests con informe de cobertura |
| `npm run test:watch` | Tests en modo watch |
| `npm run seed-lp` | Seed escenario Las Palmas (producción) |
| `npm run seed-bcn` | Seed escenario Barcelona (legacy) |
| `npm run seed-reset` | Resetear base de datos |

---

## Variables de entorno

| Variable | Requerida | Descripción |
|----------|-----------|-------------|
| `PORT` | No (def. 9000) | Puerto HTTP |
| `JWT_SECRET` | Sí | Clave para firmar tokens JWT |
| `AUDIT_HMAC_SECRET` | Sí | Clave HMAC-SHA256 para firmas de auditoría |
| `NODE_ENV` | No (def. development) | `development` / `production` |
| `SIMULATE_RACE` | No | `true` para simular condiciones de carrera en tests |

---

## API Endpoints

### Auth — `/api/auth`

| Método | Ruta | Descripción | Auth |
|--------|------|-------------|------|
| `POST` | `/auth/register` | Registrar nuevo usuario | No |
| `POST` | `/auth/login` | Login, devuelve JWT | No |

### Requests — `/api/requests`

| Método | Ruta | Descripción | Rol |
|--------|------|-------------|-----|
| `POST` | `/requests` | Crear solicitud de recogida | CLIENT |
| `GET` | `/requests/mine` | Solicitud activa del cliente | CLIENT |
| `GET` | `/requests/history` | Historial del cliente | CLIENT |
| `GET` | `/requests/pending` | Solicitudes pendientes cercanas | DRIVER |
| `GET` | `/requests/my-pickups` | Recogidas asignadas al conductor | DRIVER |
| `POST` | `/requests/:id/accept` | Aceptar solicitud | DRIVER |
| `POST` | `/requests/:id/confirm-driver` | Confirmar handshake (código OTP) | CLIENT |
| `POST` | `/requests/:id/renew-handshake` | Regenerar código handshake | DRIVER |
| `POST` | `/requests/:id/deposit` | Depositar en locker | DRIVER |

### Lockers — `/api/lockers`

| Método | Ruta | Descripción | Rol |
|--------|------|-------------|-----|
| `GET` | `/lockers` | Listar todos los lockers | ADMIN |
| `POST` | `/lockers/:label/open` | Abrir locker con código | CLIENT |

### Admin — `/api/admin`

| Método | Ruta | Descripción | Rol |
|--------|------|-------------|-----|
| `GET` | `/admin/users` | Lista usuarios con estadísticas | ADMIN |
| `DELETE` | `/admin/users/:id` | Eliminar usuario | ADMIN |
| `GET` | `/admin/metrics/throughput` | Volumen de pedidos y ocupación de lockers | ADMIN |
| `GET` | `/admin/metrics/timing` | Tiempos medios de asignación y entrega | ADMIN |
| `GET` | `/admin/fleet-status` | Estado de la flota de conductores | ADMIN |
| `GET` | `/admin/audit-trail/:requestId` | Traza de auditoría por solicitud | ADMIN |
| `GET` | `/admin/audit-trail` | Traza paginada global (`?page=1&limit=100`) | ADMIN |

### Merchants — `/api/merchants`

| Método | Ruta | Descripción | Rol |
|--------|------|-------------|-----|
| `POST` | `/merchants/register` | Registrar comercio | Público |
| `GET` | `/merchants` | Listar todos los comercios | ADMIN |
| `GET` | `/merchants/nearby` | Comercios activos en radio (`?lat&lon&radius`) | CLIENT |
| `PUT` | `/merchants/:id/status` | Actualizar estado de integración | ADMIN |

### Otros

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/debug/full-state` | Estado completo (solo dev) |

---

## Modelo de datos

### `users`
| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | INTEGER PK | |
| `name` | TEXT | |
| `email` | TEXT UNIQUE | |
| `password_hash` | TEXT | bcrypt |
| `role` | TEXT | `CLIENT` / `DRIVER` / `ADMIN` |
| `latitude`, `longitude` | REAL | Posición del conductor (nullable) |

### `lockers`
| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | INTEGER PK | |
| `label` | TEXT UNIQUE | Código visual (ej. "A1") |
| `size_category` | TEXT | `S` / `M` / `L` |
| `is_occupied` | INTEGER | 0 / 1 |
| `access_code` | TEXT | PIN 6 dígitos (nullable) |

### `pickup_requests`
| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | INTEGER PK | |
| `client_id`, `driver_id` | INTEGER FK | |
| `pickup_location` | TEXT | Dirección textual |
| `latitude`, `longitude` | REAL | Coordenadas de recogida |
| `package_size` | TEXT | `SMALL` / `MEDIUM` / `LARGE` |
| `status` | TEXT | Estado actual (ver ciclo de vida) |
| `handshake_code` | TEXT | OTP 4 dígitos (hash bcrypt) |
| `locker_id`, `locker_code` | | Locker asignado y PIN de apertura |

**Ciclo de vida:**
`REQUESTED` → `CONFIRMATION_PENDING` → `IN_PROGRESS` → `DEPOSITED` → `PICKED_UP`

### `audit_events`
| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | TEXT PK | UUID |
| `request_id` | INTEGER | |
| `event_type` | TEXT | Tipo de evento |
| `actor_id` | INTEGER | Usuario que generó el evento |
| `metadata` | TEXT | JSON opcional |
| `signature` | TEXT | HMAC-SHA256 (64 hex chars) |

Cada evento lleva firma HMAC para detección de manipulaciones. Verificable con `verifyEventSignature()`.

### `handshake_attempts`
Registro de intentos de validación del código OTP. Máximo 3 intentos antes de bloqueo HTTP 423.

### `merchants`
Comercios integrados con estado `pending` / `active` / `suspended` y coordenadas para búsqueda por radio.

---

## Arquitectura

```
src/
├── auth/           # JWT middleware y helpers
├── config/         # Variables de entorno (zod)
├── db/             # Schema SQL, init, seeds
├── middleware/     # rateLimiter, validateSchema
├── routes/         # Express routers por dominio
├── schemas/        # Zod schemas de validación
├── services/       # Lógica de negocio
│   ├── RequestService.ts
│   ├── LockerService.ts
│   ├── AuditService.ts
│   └── GeoDispatchService.ts
├── sockets/        # Socket.IO server
└── __tests__/      # Tests de integración con SQLite en memoria
```

El geo-dispatching usa la **fórmula de Haversine** con búsqueda en cascada (3 → 5 → 7 km) para localizar conductores cercanos.

---

## WebSocket events

| Evento | Dirección | Descripción |
|--------|-----------|-------------|
| `driver:location:update` | Client → Server | Actualizar posición GPS del conductor |
| `request:new` | Server → Drivers | Nueva solicitud (geo-dirigida, radio 3km) |
| `request:updated` | Server → All | Cambio de estado de una solicitud |
| `locker:ready` | Server → Client | Locker asignado con código de apertura |
| `notification:new` | Server → Client | Nueva notificación en bandeja |
