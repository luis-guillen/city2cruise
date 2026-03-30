# CRUISE LOCKER BCN — MEMORIA TÉCNICA COMPLETA

> **Proyecto:** Cruise Locker BCN
> **Empresa:** REKER TECH SOLUTIONS
> **Fecha de análisis:** Marzo 2026
> **Versión del documento:** 1.0

---

## ÍNDICE

1. [Visión General del Proyecto](#1-visión-general-del-proyecto)
2. [Arquitectura de Alto Nivel](#2-arquitectura-de-alto-nivel)
3. [Stack Tecnológico](#3-stack-tecnológico)
4. [Estructura de Ficheros](#4-estructura-de-ficheros)
5. [Base de Datos — Esquema Completo](#5-base-de-datos--esquema-completo)
6. [Flujo de Estados de un Pedido](#6-flujo-de-estados-de-un-pedido)
7. [API REST — Referencia Completa](#7-api-rest--referencia-completa)
8. [WebSockets — Protocolo en Tiempo Real](#8-websockets--protocolo-en-tiempo-real)
9. [Sistema de Geo-Dispatch](#9-sistema-de-geo-dispatch-lógica-de-matching)
10. [Seguridad](#10-seguridad)
11. [Flujos de Usuario Detallados](#11-flujos-de-usuario-detallados)
12. [Componentes Frontend — Referencia](#12-componentes-frontend--referencia)
13. [Configuración y Puertos](#13-configuración-y-puertos)
14. [Testing](#14-testing)
15. [Diagrama de Flujo de Datos Completo](#15-diagrama-de-flujo-de-datos-completo)
16. [Diseño UI/UX](#16-diseño-uiux)
17. [Integraciones Externas](#17-integraciones-externas)
18. [Estado Actual / Observaciones Técnicas](#18-estado-actual--observaciones-técnicas)

---

## 1. VISIÓN GENERAL DEL PROYECTO

**Cruise Locker BCN** es una plataforma web de gestión logística urbana diseñada para cruceristas en Barcelona. Permite que turistas de cruceros puedan dejar sus compras del día en taquillas gestionadas de forma segura, usando conductores de transporte que recogen los paquetes en la calle y los depositan en lockers, mientras el crucerista sigue disfrutando la ciudad sin carga.

```
┌─────────────────────────────────────────────────────────────┐
│                    CRUISE LOCKER BCN                         │
│         "Guarda tus compras. Disfruta Barcelona."            │
├──────────────────┬──────────────────┬───────────────────────┤
│    CRUCERISTA    │    CONDUCTOR     │    ADMINISTRADOR       │
│    (CLIENT)      │    (DRIVER)      │    (ADMIN)             │
│                  │                  │                        │
│ • Solicita       │ • Ve pedidos     │ • Gestiona usuarios    │
│   recogida       │   cercanos       │ • Ve estadísticas      │
│ • Hace handshake │ • Acepta y       │ • Elimina cuentas      │
│   con conductor  │   transporta     │                        │
│ • Abre locker    │ • Deposita en    │                        │
│   con PIN        │   taquilla       │                        │
└──────────────────┴──────────────────┴───────────────────────┘
```

### Concepto de negocio

El servicio cubre la necesidad de los cruceristas que pasan el día en Barcelona y no quieren cargar con sus compras hasta volver al barco. El flujo es:

1. El crucerista solicita desde la app una recogida en su ubicación actual.
2. Un conductor cercano acepta el pedido, se encuentra con el crucerista en la calle (verificación presencial via handshake), recoge el paquete y lo deposita en una taquilla física gestionada por Cruise Locker BCN.
3. El crucerista recibe una notificación push con el PIN de apertura y el número de taquilla, y puede recoger sus compras en cualquier momento.

---

## 2. ARQUITECTURA DE ALTO NIVEL

```
┌────────────────────────────────────────────────────────────────────────┐
│                           ARQUITECTURA GENERAL                          │
│                                                                          │
│  ┌──────────────────────────────────┐                                   │
│  │         FRONTEND (React SPA)      │                                   │
│  │         http://localhost:9100      │                                   │
│  │                                   │                                   │
│  │  Vite + React 18 + TypeScript     │                                   │
│  │  Tailwind CSS + shadcn/ui         │ ─────── HTTP REST ──────────────┐ │
│  │  React Router v6                  │                                  │ │
│  │  TanStack Query v5                │ ═══════ WebSocket (Socket.IO) ══╗│ │
│  │  Socket.IO Client v4              │                                 ║│ │
│  │  Leaflet Maps                     │                                 ║│ │
│  └──────────────────────────────────┘                                 ║│ │
│                                                                        ║▼ ▼ │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │                    BACKEND (Node.js + Express)                    │  │
│  │                     http://localhost:9000                          │  │
│  │                                                                    │  │
│  │  Express 5 + TypeScript + tsx                                      │  │
│  │  Helmet · CORS · Rate Limiter · Body Parser                        │  │
│  │  JWT (HS256, 24h) · bcrypt (salt=10)                               │  │
│  │  Zod (validación schemas)                                          │  │
│  │  Socket.IO Server v4                                               │  │
│  │                                                                    │  │
│  │  ┌──────────────────────────────────────────────────────────┐     │  │
│  │  │                  SQLite (better-sqlite3)                   │     │  │
│  │  │              ./database.sqlite (persistente)               │     │  │
│  │  │  users · lockers · pickup_requests · notifications         │     │  │
│  │  └──────────────────────────────────────────────────────────┘     │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌────────────────────────┐                                             │
│  │   API EXTERNA (proxy)   │                                             │
│  │  OpenStreetMap Nominatim│                                             │
│  │  (geocodificación BCN)  │                                             │
│  └────────────────────────┘                                             │
└──────────────────────────────────────────────────────────────────────────┘
```

### Patrón arquitectónico

- **Frontend**: SPA (Single Page Application) con routing del lado del cliente.
- **Backend**: API REST + WebSocket Server monolítico (mismo proceso HTTP).
- **Base de datos**: Embebida (SQLite). Sin servidor de BD separado.
- **Tiempo real**: WebSocket bidireccional sobre Socket.IO.
- **Autenticación**: Stateless JWT (sin sesiones en servidor).

---

## 3. STACK TECNOLÓGICO

### 3.1 Frontend

| Tecnología | Versión | Rol |
|---|---|---|
| React | 18.3.1 | Framework UI |
| TypeScript | 5.8.3 | Tipado estático |
| Vite | 5.4.19 | Bundler + Dev Server |
| React Router DOM | 6.30.1 | Routing SPA |
| TanStack Query | 5.83.0 | Server state management |
| Socket.IO Client | 4.8.3 | WebSockets en tiempo real |
| Axios | 1.13.5 | HTTP client |
| Tailwind CSS | 3.4.17 | Utility-first CSS |
| shadcn/ui + Radix UI | — | Componentes accesibles |
| Leaflet + React Leaflet | 1.9.4 / 4.2.1 | Mapas interactivos |
| Lucide React | 0.462.0 | Iconos |
| Sonner | 1.7.4 | Toast notifications |
| date-fns | 3.6.0 | Formateo de fechas |
| Zod | 3.25.76 | Validación frontend |
| next-themes | 0.3.0 | Dark mode (preparado) |
| React Hook Form | 7.61.1 | Gestión de formularios |
| Vitest | 3.2.4 | Testing unitario |

### 3.2 Backend

| Tecnología | Versión | Rol |
|---|---|---|
| Node.js | — | Runtime |
| Express | 5.2.1 | HTTP server framework |
| TypeScript | 5.9.3 | Tipado estático |
| tsx | 4.21.0 | Dev runner con hot-reload |
| better-sqlite3 | 12.6.2 | ORM-less SQLite |
| Socket.IO | 4.8.3 | WebSocket server |
| jsonwebtoken | 9.0.3 | JWT generación/verificación |
| bcrypt | 6.0.0 | Hash de contraseñas |
| Helmet | 8.1.0 | Cabeceras HTTP seguras |
| CORS | 2.8.6 | Control de origen cruzado |
| express-rate-limit | 8.2.1 | Limitación de peticiones |
| Zod | 3.23.8 | Validación de schemas de entrada |
| dotenv | 17.3.1 | Variables de entorno |
| Jest + Supertest | 30.x / 7.x | Testing de integración |

### 3.3 Fuentes y Diseño

- **Tipografía body**: Inter (Google Fonts, pesos 300–700)
- **Tipografía headings**: Space Grotesk (Google Fonts, pesos 500–700)
- **Paleta de colores**: Sistema HSL via variables CSS (compatible dark mode)
- **Mapa tiles**: CartoDB Voyager (sobre OpenStreetMap, sin clave API)

---

## 4. ESTRUCTURA DE FICHEROS

```
APP_TRASNPORTE_LOCKERS_BARCELONA/
├── cruise-connect-main/              ← FRONTEND (Puerto 9100)
│   ├── index.html                    ← Entry HTML
│   ├── vite.config.ts                ← Vite config (port 9100, alias @)
│   ├── tailwind.config.ts            ← Paleta + tokens de diseño
│   ├── components.json               ← Configuración shadcn/ui
│   ├── tsconfig.json                 ← TypeScript config
│   ├── package.json                  ← Dependencias + scripts
│   ├── postcss.config.js
│   └── src/
│       ├── main.tsx                  ← Entry React (ReactDOM.createRoot)
│       ├── App.tsx                   ← Root: Providers + Router + Routes
│       ├── socket.ts                 ← Instancia singleton Socket.IO
│       ├── index.css                 ← Variables CSS + Tailwind imports
│       ├── context/
│       │   └── AppContext.tsx        ← Estado global (auth + datos)
│       ├── services/
│       │   └── api.ts                ← Axios client + todas las funciones API
│       ├── hooks/
│       │   ├── useSocket.ts          ← Hook WebSocket + event listeners
│       │   ├── useDriverGeoLocation.ts ← GPS continuo + broadcast WebSocket
│       │   └── use-mobile.tsx        ← Detección de pantalla mobile
│       ├── pages/
│       │   ├── LoginPage.tsx         ← Login + Registro
│       │   ├── ClientDashboard.tsx   ← Panel crucerista (principal)
│       │   ├── DriverDashboard.tsx   ← Panel conductor
│       │   ├── AdminDashboard.tsx    ← Panel administrador
│       │   └── NotFound.tsx          ← 404
│       ├── components/
│       │   ├── Layout.tsx            ← Navbar + Outlet + Footer
│       │   ├── Navbar.tsx            ← Barra superior + logout
│       │   ├── NotificationBell.tsx  ← Campana de notificaciones (solo CLIENT)
│       │   ├── ProtectedRoute.tsx    ← Guard de rutas por rol
│       │   ├── StatusBadge.tsx       ← Pill de estado del pedido
│       │   ├── DriverMap.tsx         ← Mapa Leaflet (conductor)
│       │   └── ui/                   ← shadcn/ui (≈40 componentes Radix)
│       └── lib/
│           └── utils.ts              ← cn() helper (clsx + tailwind-merge)
│
└── backend/                          ← BACKEND (Puerto 9000)
    ├── .env                          ← Variables de entorno
    ├── database.sqlite               ← Base de datos SQLite (persistente)
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── index.ts                  ← Entry: initDB + buildServer + initSockets
        ├── server.ts                 ← Express factory (middleware stack)
        ├── config/
        │   └── env.ts                ← Centraliza y exporta variables de entorno
        ├── auth/
        │   ├── jwt.ts                ← generateToken() / verifyToken()
        │   └── middleware.ts         ← authMiddleware + requireRole()
        ├── db/
        │   ├── database.ts           ← Conexión SQLite + initDB()
        │   ├── schema.sql.ts         ← DDL completo como string exportado
        │   ├── reset.ts              ← Seed de reset a estado inicial
        │   └── seed_bcn.ts           ← Seed para pruebas geo Barcelona
        ├── middleware/
        │   └── rateLimiter.ts        ← globalLimiter + authLimiter + lockerOpenLimiter
        ├── routes/
        │   ├── index.ts              ← Router principal + health check
        │   ├── auth.ts               ← POST /register, POST /login
        │   ├── requests.ts           ← CRUD completo pedidos (lógica principal)
        │   ├── lockers.ts            ← POST /open (apertura taquilla)
        │   ├── admin.ts              ← GET/DELETE /admin/users
        │   ├── locations.ts          ← Proxy Nominatim geocodificación
        │   ├── notifications.ts      ← CRUD notificaciones
        │   └── debug.ts              ← Endpoints debug (solo NODE_ENV=development)
        ├── sockets/
        │   └── io.ts                 ← Socket.IO init + mapa activeDrivers
        ├── types/
        │   └── dto.ts                ← Interfaces TypeScript (DTOs)
        ├── utils/
        │   ├── dto.ts                ← buildPickupRequestDTO() + sanitizeForSocket()
        │   ├── errors.ts             ← sendError() + globalErrorHandler
        │   └── geo.ts                ← calculateDistance() fórmula Haversine
        └── __tests__/
            ├── integration.test.ts   ← Flujo end-to-end completo
            ├── concurrency.test.ts   ← Race conditions en aceptar/depositar
            ├── geo-matching.test.ts  ← Tests lógica geoespacial
            ├── security.test.ts      ← Tests JWT, RBAC, rate limiting
            └── helpers.ts            ← Utilidades compartidas de tests
```

---

## 5. BASE DE DATOS — ESQUEMA COMPLETO

### 5.1 Diagrama de entidades

```
┌──────────────────────────────────────────────────────────────────────┐
│                          ESQUEMA SQLite                               │
│                                                                        │
│  ┌─────────────────────────────────┐                                  │
│  │            users                 │                                  │
│  ├─────────────────────────────────┤                                  │
│  │ id          INTEGER PK           │                                  │
│  │ name        TEXT NOT NULL        │                                  │
│  │ email       TEXT UNIQUE NOT NULL │                                  │
│  │ password_hash TEXT NOT NULL      │                                  │
│  │ role        TEXT CHECK           │                                  │
│  │             ('CLIENT'|'DRIVER'|  │                                  │
│  │             'ADMIN')             │                                  │
│  │ latitude    REAL NULL            │ ← coordenadas home del conductor │
│  │ longitude   REAL NULL            │                                  │
│  │ created_at  TEXT NOT NULL        │                                  │
│  └─────────────────────────────────┘                                  │
│           │                    │                                        │
│     client_id (FK)        driver_id (FK)                              │
│           │                    │                                        │
│           ▼                    ▼                                        │
│  ┌──────────────────────────────────────────────────────────────┐     │
│  │                      pickup_requests                           │     │
│  ├──────────────────────────────────────────────────────────────┤     │
│  │ id                INTEGER PK                                   │     │
│  │ client_id         INTEGER FK → users.id                       │     │
│  │ driver_id         INTEGER FK → users.id (NULL hasta asignar)  │     │
│  │ pickup_location   TEXT NOT NULL                                │     │
│  │ latitude          REAL NULL                                    │     │
│  │ longitude         REAL NULL                                    │     │
│  │ package_size      TEXT CHECK ('SMALL'|'MEDIUM')               │     │
│  │ status            TEXT CHECK (6 estados posibles)             │     │
│  │ handshake_code    TEXT NULL  ← PIN 4 dígitos, TTL 5 minutos   │     │
│  │ handshake_expires_at TEXT NULL                                │     │
│  │ client_confirmed  INTEGER (0|1)                               │     │
│  │ driver_confirmed  INTEGER (0|1)                               │     │
│  │ locker_id         INTEGER FK → lockers.id (NULL hasta depositar)│    │
│  │ locker_code       TEXT NULL  ← PIN 6 dígitos apertura taquilla│     │
│  │ created_at        TEXT NOT NULL                               │     │
│  │ updated_at        TEXT NOT NULL                               │     │
│  └──────────────────────────────────────────────────────────────┘     │
│                              │                                          │
│                           locker_id (FK)                               │
│                              ▼                                          │
│  ┌──────────────────────────────────┐                                  │
│  │            lockers                │                                  │
│  ├──────────────────────────────────┤                                  │
│  │ id                  INTEGER PK   │                                  │
│  │ label               TEXT UNIQUE  │ ← Ej: "Taquilla A", "L-001"     │
│  │ is_occupied         INTEGER (0|1)│                                  │
│  │ current_request_id  INTEGER NULL │                                  │
│  │ access_code         TEXT NULL    │ ← Mismo valor que locker_code    │
│  │ updated_at          TEXT NOT NULL│                                  │
│  └──────────────────────────────────┘                                  │
│                                                                         │
│  ┌──────────────────────────────────┐                                  │
│  │          notifications            │                                  │
│  ├──────────────────────────────────┤                                  │
│  │ id         INTEGER PK            │                                  │
│  │ user_id    INTEGER FK → users.id │                                  │
│  │ type       TEXT ('LOCKER_READY') │                                  │
│  │ title      TEXT NOT NULL         │                                  │
│  │ message    TEXT NOT NULL         │                                  │
│  │ read       INTEGER (0|1)         │                                  │
│  │ created_at TEXT NOT NULL         │                                  │
│  └──────────────────────────────────┘                                  │
└──────────────────────────────────────────────────────────────────────┘
```

### 5.2 DDL Completo (SQL)

```sql
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('CLIENT','DRIVER','ADMIN')),
  latitude REAL NULL,
  longitude REAL NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lockers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL UNIQUE,
  is_occupied INTEGER NOT NULL DEFAULT 0,
  current_request_id INTEGER NULL,
  access_code TEXT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pickup_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  driver_id INTEGER NULL,
  pickup_location TEXT NOT NULL,
  latitude REAL NULL,
  longitude REAL NULL,
  package_size TEXT CHECK(package_size IN ('SMALL','MEDIUM')) DEFAULT 'SMALL',
  status TEXT NOT NULL CHECK(status IN (
    'REQUESTED','ACCEPTED','CONFIRMATION_PENDING',
    'IN_PROGRESS','DEPOSITED','PICKED_UP'
  )),
  handshake_code TEXT NULL,
  handshake_expires_at TEXT NULL,
  client_confirmed INTEGER NOT NULL DEFAULT 0,
  driver_confirmed INTEGER NOT NULL DEFAULT 0,
  locker_id INTEGER NULL,
  locker_code TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(client_id) REFERENCES users(id),
  FOREIGN KEY(driver_id) REFERENCES users(id),
  FOREIGN KEY(locker_id) REFERENCES lockers(id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
```

---

## 6. FLUJO DE ESTADOS DE UN PEDIDO

```
                    ┌─────────────┐
                    │  REQUESTED  │  ← Cliente crea solicitud de recogida
                    └──────┬──────┘
                           │
                           │  Driver acepta (POST /requests/:id/accept)
                           │  → genera handshake_code (4 dígitos)
                           │  → handshake_expires_at = ahora + 5 minutos
                           ▼
               ┌─────────────────────┐
               │ CONFIRMATION_PENDING│  ← Driver muestra código en pantalla
               └──────────┬──────────┘  ← Cliente introduce el código
                           │
                           │  Cliente confirma (POST /requests/:id/confirm-driver)
                           │  → valida código y TTL
                           │  → si expirado: pedido vuelve a REQUESTED
                           ▼
                  ┌──────────────┐
                  │  IN_PROGRESS │  ← Driver transporta el paquete al locker
                  └──────┬───────┘
                          │
                          │  Driver deposita (POST /requests/:id/deposit)
                          │  → asigna primer locker libre (ORDER BY id ASC)
                          │  → genera locker_code único (6 dígitos, sin colisión)
                          │  → crea notificación en BD
                          │  → WebSocket privado → cliente
                          ▼
                   ┌────────────┐
                   │  DEPOSITED │  ← Paquete en taquilla física
                   └──────┬─────┘  ← Cliente recibe PIN por notificación
                           │
                           │  Cliente abre taquilla (POST /lockers/open)
                           │  → valida código contra request del cliente
                           │  → status = PICKED_UP
                           │  → locker liberado (is_occupied = 0)
                           ▼
                   ┌────────────┐
                   │  PICKED_UP │  ← Proceso completado ✓
                   └────────────┘

Casos especiales:
• Si handshake expira (5 min sin confirmar) → pedido vuelve a REQUESTED
• El DRIVER puede renovar el código (POST /requests/:id/renew-handshake)
• El estado ACCEPTED existe en el schema pero el flujo actual salta
  directamente de REQUESTED a CONFIRMATION_PENDING al aceptar
```

### 6.1 Tabla de transiciones de estado

| Estado origen | Acción | Actor | Estado destino |
|---|---|---|---|
| `REQUESTED` | Aceptar pedido | DRIVER | `CONFIRMATION_PENDING` |
| `CONFIRMATION_PENDING` | Confirmar código correcto | CLIENT | `IN_PROGRESS` |
| `CONFIRMATION_PENDING` | Código expirado | Sistema | `REQUESTED` |
| `IN_PROGRESS` | Depositar en locker | DRIVER | `DEPOSITED` |
| `DEPOSITED` | Abrir taquilla con PIN | CLIENT | `PICKED_UP` |

---

## 7. API REST — REFERENCIA COMPLETA

### Configuración base

```
Base URL:      http://localhost:9000/api
Autorización:  Authorization: Bearer {JWT_TOKEN}
Content-Type:  application/json
```

### Formato de error estándar

```json
{
  "error": {
    "code": "CONFLICT",
    "message": "El pedido ya no está disponible"
  }
}
```

---

### 7.1 Autenticación

#### POST `/api/auth/register`
Registro de nuevo usuario. **No requiere autenticación.**

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `name` | string | Sí | Nombre del usuario |
| `email` | string | Sí | Email único |
| `password` | string | Sí | Mínimo 6 caracteres |
| `role` | `"CLIENT"` \| `"DRIVER"` | Sí | Rol del usuario |

```json
// Body
{
  "name": "María García",
  "email": "maria@mail.com",
  "password": "abc123",
  "role": "CLIENT"
}

// Response 201
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": { "id": 5, "name": "María García", "role": "CLIENT" }
}
```

**Errores:** `409 CONFLICT` (email ya registrado), `400 BAD_REQUEST` (validación Zod)

---

#### POST `/api/auth/login`
Login de usuario existente. **No requiere autenticación.**

```json
// Body
{ "email": "maria@mail.com", "password": "abc123" }

// Response 200
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 5,
    "name": "María García",
    "role": "CLIENT",
    "latitude": null,
    "longitude": null
  }
}
```

**Errores:** `401 UNAUTHORIZED` (credenciales incorrectas), `400 BAD_REQUEST`

---

### 7.2 Pedidos — Endpoints Cliente

#### POST `/api/requests`
Crear nueva solicitud de recogida. **Rol: CLIENT**

```json
// Body
{
  "pickupLocation": "La Rambla, 55, Barcelona, España",
  "latitude": 41.3809,
  "longitude": 2.1730,
  "packageSize": "SMALL"
}

// Response 200: PickupRequest DTO
```

**Efecto secundario:** Geo-dispatch a conductores dentro de 3km via WebSocket.

---

#### GET `/api/requests/mine`
Obtiene el pedido activo actual del cliente (el más reciente que no sea `PICKED_UP`). **Rol: CLIENT**

```json
// Response 200: PickupRequest | null
```

---

#### GET `/api/requests/history`
Historial completo de pedidos del cliente. **Rol: CLIENT**

```json
// Response 200: PickupRequest[]
```

---

#### POST `/api/requests/:id/confirm-driver`
El cliente confirma la presencia del conductor introduciendo el código handshake. **Rol: CLIENT**

```json
// Body
{ "handshakeCode": "4872" }

// Response 200: PickupRequest (status = IN_PROGRESS)
```

**Errores:** `400 INVALID_CODE` (código incorrecto), `410 GONE` (código expirado), `409 CONFLICT` (estado incorrecto)

---

#### POST `/api/lockers/open`
El cliente "abre" la taquilla introduciendo el PIN de 6 dígitos recibido por notificación. **Rol: CLIENT**

```json
// Body
{ "lockerCode": "847291" }

// Response 200: PickupRequest (status = PICKED_UP)
```

**Efectos secundarios:** Libera el locker (`is_occupied = 0`). Emite `request:updated` por WebSocket.

---

### 7.3 Pedidos — Endpoints Conductor

#### GET `/api/requests/pending`
Lista de pedidos disponibles filtrados geográficamente. **Rol: DRIVER**

Los parámetros son opcionales. Si no se pasan, el backend usa la última posición conocida del driver en `activeDrivers`.

| Query param | Tipo | Descripción |
|---|---|---|
| `lat` | number | Latitud del conductor |
| `lon` | number | Longitud del conductor |
| `radius` | number | Radio en km (default 3) |

```
GET /api/requests/pending?lat=41.387&lon=2.170&radius=3

// Response 200: PickupRequest[]
```

---

#### GET `/api/requests/my-pickups`
Pedidos aceptados/activos asignados al conductor autenticado. **Rol: DRIVER**

Incluye estados: `CONFIRMATION_PENDING`, `IN_PROGRESS`, `DEPOSITED`, `PICKED_UP`.

```json
// Response 200: PickupRequest[]
```

---

#### POST `/api/requests/:id/accept`
El conductor acepta un pedido disponible. **Rol: DRIVER**

```json
// Body (opcional - validación geoespacial)
{
  "driverLat": 41.387,
  "driverLon": 2.170,
  "radiusKm": 3
}

// Response 200: PickupRequest (status = CONFIRMATION_PENDING)
```

**Seguridad:** Usa `db.transaction()` para evitar que dos drivers acepten el mismo pedido simultáneamente.
**Errores:** `409 CONFLICT` (pedido ya aceptado), `403 FORBIDDEN` (fuera de radio)

---

#### POST `/api/requests/:id/renew-handshake`
El conductor renueva el código handshake (si expiró o el cliente no lo vio). **Rol: DRIVER**

```json
// Response 200: PickupRequest (nuevo handshakeCode, nuevo TTL 5min)
```

---

#### POST `/api/requests/:id/deposit`
El conductor marca que ha depositado el paquete en una taquilla. **Rol: DRIVER**

```json
// Body (opcional - fuerza una taquilla específica)
{ "lockerLabel": "Taquilla A" }

// Response 200: PickupRequest (status = DEPOSITED, locker asignado)
```

**Lógica interna (transacción atómica):**
1. Verifica que `status = IN_PROGRESS` y `driver_id = conductor autenticado`
2. Selecciona primer locker libre (`is_occupied = 0 ORDER BY id ASC`)
3. Genera `locker_code` de 6 dígitos (sin colisión con otros lockers ocupados)
4. Actualiza locker → `is_occupied = 1`
5. Actualiza pickup_request → `status = DEPOSITED, locker_id, locker_code`
6. Crea notificación en BD para el cliente
7. Emite WebSocket privado `locker:ready` al cliente
8. Emite WebSocket `notification:new` al cliente
9. Emite WebSocket broadcast `request:updated` (sin códigos)

---

### 7.4 Ubicaciones

#### GET `/api/locations/search?q={query}`
Proxy hacia la API de Nominatim (OpenStreetMap) para geocodificación de calles en Barcelona. **Rol: CLIENT**

```
GET /api/locations/search?q=las+ramblas

// Response 200
[
  {
    "displayName": "La Rambla, Barri Gòtic, Barcelona, Barcelonès...",
    "lat": 41.3809,
    "lon": 2.1730
  },
  ...
]
```

---

### 7.5 Notificaciones

#### GET `/api/notifications`
Lista todas las notificaciones del cliente autenticado, ordenadas por fecha descendente. **Rol: CLIENT**

#### POST `/api/notifications/:id/read`
Marca una notificación como leída. **Rol: CLIENT**

#### DELETE `/api/notifications`
Elimina todas las notificaciones del cliente. **Rol: CLIENT**

---

### 7.6 Admin

#### GET `/api/admin/users`
Lista todos los usuarios no-admin con estadísticas calculadas por SQL. **Rol: ADMIN**

```json
// Response 200
[
  {
    "id": 3,
    "name": "María García",
    "email": "maria@mail.com",
    "role": "CLIENT",
    "created_at": "2026-03-01T10:00:00.000Z",
    "ordered_count": 5,
    "deposited_count": 0
  }
]
```

---

#### DELETE `/api/admin/users/:id`
Elimina un usuario y todos sus datos asociados. **Rol: ADMIN**

**Lógica de cascada manual (transacción):**
- Si `role = CLIENT`: libera lockers ocupados → borra pickup_requests → borra user
- Si `role = DRIVER`: desasigna pedidos (`driver_id = NULL`) → borra user
- Protege contra borrar otro ADMIN

---

### 7.7 Utilidades

#### GET `/api/health`
Estado del servidor. **Sin autenticación.**

```json
// Response 200
{ "status": "OK", "timestamp": "2026-03-12T10:00:00.000Z" }
```

#### GET `/api/debug/full-state`
Estado completo de la BD (users, lockers, requests). **Solo `NODE_ENV=development`.**

---

### 7.8 PickupRequest DTO — Estructura completa

```typescript
interface PickupRequest {
  id: string;
  clientId: number;          // ID del cliente propietario
  driverId: number | null;   // ID del conductor asignado (null si sin asignar)
  clientName: string;        // Nombre del cliente (JOIN con users)
  pickupLocation: string;    // Dirección textual del punto de recogida
  latitude: number | null;   // Coordenadas del punto de recogida
  longitude: number | null;
  packageSize: "SMALL" | "MEDIUM";
  status: "REQUESTED" | "ACCEPTED" | "CONFIRMATION_PENDING"
        | "IN_PROGRESS" | "DEPOSITED" | "PICKED_UP";
  handshakeCode: string | null;      // PIN 4 dígitos. NUNCA viaja por WebSocket
  handshakeExpiresAt: string | null; // ISO timestamp de expiración
  clientConfirmed: boolean;
  driverConfirmed: boolean;
  locker: { id: number; label: string } | null;
  lockerCode: string | null;  // PIN 6 dígitos apertura. NUNCA por WebSocket público
  createdAt: string;          // ISO timestamp
  updatedAt: string;          // ISO timestamp
}
```

---

## 8. WEBSOCKETS — PROTOCOLO EN TIEMPO REAL

### 8.1 Esquema de comunicación

```
┌─────────────────────────────────────────────────────────────────────┐
│                    PROTOCOLO WebSocket (Socket.IO v4)                │
│                                                                       │
│  CLIENTE FRONTEND                     SERVIDOR BACKEND               │
│  ─────────────────                    ──────────────────             │
│                                                                       │
│  socket.connect()  ──── ws handshake + { auth: { token: JWT } } ──► │
│                                                                       │
│                         ◄──── Verificación JWT ────────────          │
│                         ◄──── socket.join("user_<id>") ──────        │
│                                                                       │
│  ─────── EVENTOS EMITIDOS POR EL CLIENTE ────────────────────        │
│                                                                       │
│  [DRIVER ONLY]                                                        │
│  socket.emit("driver:location:update", {lat, lon})  ────────────►   │
│                    ─── activeDrivers.set(userId, {socketId,lat,lon}) │
│                                                                       │
│  ─────── EVENTOS EMITIDOS POR EL SERVIDOR ───────────────────        │
│                                                                       │
│  ◄─── "request:new" (safeDTO sin códigos) ─────────────────          │
│       [emitToSocket: solo a drivers dentro de 3km del pedido]        │
│                                                                       │
│  ◄─── "request:updated" (safeDTO sin códigos) ─────────────          │
│       [emitEvent: broadcast global en cualquier cambio de estado]    │
│                                                                       │
│  ◄─── "locker:ready" { requestId, locker, lockerCode } ─────         │
│       [emitToUser: SOLO al room "user_<clientId>" - privado]         │
│       [Incluye el lockerCode porque es canal privado]                │
│                                                                       │
│  ◄─── "notification:new" { NotificationDTO } ───────────────         │
│       [emitToUser: SOLO al room "user_<clientId>" - privado]         │
│                                                                       │
│  socket.disconnect() ──────────────────────────────────────────►    │
│                         ─── activeDrivers.delete(userId) ──          │
└─────────────────────────────────────────────────────────────────────┘
```

### 8.2 Salas privadas (Rooms)

Cada usuario al conectarse se une automáticamente a su sala privada:
```
socket.join(`user_${user.id}`)
```

Esto permite enviar eventos solo a un usuario específico sin broadcast global:
```typescript
io.to(`user_${clientId}`).emit("locker:ready", payload)
```

### 8.3 Tabla de eventos WebSocket

| Evento | Dirección | Destinatario | Payload | Descripción |
|---|---|---|---|---|
| `driver:location:update` | Cliente → Servidor | — | `{ lat, lon }` | Actualiza posición GPS del conductor |
| `request:new` | Servidor → Cliente | Drivers en radio | PickupRequest (safe) | Nuevo pedido disponible |
| `request:updated` | Servidor → Cliente | Todos | PickupRequest (safe) | Cualquier cambio de estado |
| `locker:ready` | Servidor → Cliente | Solo cliente dueño | `{ requestId, locker, lockerCode }` | Paquete depositado + PIN |
| `notification:new` | Servidor → Cliente | Solo cliente dueño | NotificationDTO | Nueva notificación push |

### 8.4 Seguridad de datos en WebSocket

La función `sanitizeForSocket()` elimina campos sensibles antes de cualquier broadcast público:

```typescript
export const sanitizeForSocket = (dto: PickupRequestDTO): PickupRequestDTO => {
  return {
    ...dto,
    lockerCode: null,     // CRÍTICO: Nunca enviar PIN de taquilla por broadcast
    handshakeCode: null   // CRÍTICO: Nunca enviar código handshake por broadcast
  };
};
```

Los códigos PIN **solo viajan** por los canales:
- `locker:ready` → room privado `user_<clientId>` (canal autenticado)
- HTTP REST privado con `Authorization: Bearer {token}` + verificación de rol

---

## 9. SISTEMA DE GEO-DISPATCH (Lógica de Matching)

### 9.1 Concepto

Sistema de asignación dinámica de pedidos a conductores basado en proximidad geográfica, similar al modelo de Uber/Cabify. Solo los conductores dentro del radio activo reciben notificaciones de nuevos pedidos.

### 9.2 Diagrama

```
┌──────────────────────────────────────────────────────────────────────┐
│                    GEO-DISPATCH (Estilo Uber)                         │
│                                                                        │
│  MAPA EN MEMORIA (backend):                                           │
│  activeDrivers: Map<userId, { socketId, lat, lon }>                  │
│                                                                        │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │                    Barcelona (vista esquemática)                 │  │
│  │                                                                  │  │
│  │    D1 ●                    ← Driver 1 (0.7km de La Rambla)      │  │
│  │       ╲                                                          │  │
│  │        ╲  Radio 3km                                              │  │
│  │         ●─────────────── C = Pedido nuevo en La Rambla          │  │
│  │        ╱                                                         │  │
│  │       ╱  1.3km                                                   │  │
│  │    D2 ●                    ← Driver 2 (dentro del radio ✓)       │  │
│  │                                                                  │  │
│  │                            D3 ●  ← ~8km (Badalona) SKIP ✗       │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

### 9.3 Flujo al crear un pedido

```
POST /api/requests
    │
    ├── Guarda pedido en BD
    │
    ├── Obtiene lista activeDrivers (Map en memoria)
    │
    ├── Para cada driver activo:
    │   ├── Si pedido tiene coords:
    │   │   ├── Calcula distancia Haversine(driver.lat, driver.lon, pedido.lat, pedido.lon)
    │   │   ├── Si distance <= 3km → emitToSocket(driver.socketId, "request:new", safeDTO)
    │   │   └── Si distance > 3km → SKIP (log: [GEO-DISPATCH SKIP])
    │   └── Si pedido sin coords → emitToSocket (broadcast clásico)
    │
    └── Si ningún driver activo → emitEvent global (fallback)
```

### 9.4 Flujo al consultar pedidos pendientes (DRIVER)

```
GET /api/requests/pending
    │
    ├── Si no hay params lat/lon en query:
    │   ├── Busca driver en activeDrivers Map
    │   ├── Si encontrado → usa su última posición conocida, radius=3km
    │   └── Si NO encontrado → retorna [] (sin GPS = sin pedidos visibles)
    │
    ├── Obtiene todos los pedidos con status='REQUESTED'
    │
    └── Filtra por distancia Haversine:
        ├── Si pedido sin coords → siempre visible
        └── Si pedido con coords → solo si distance <= radius
```

### 9.5 Fallback de GPS del conductor

```
Browser GPS ──► OK → socket.emit("driver:location:update", {lat, lon})
               ↓
              FAIL → usa homeCoords (de BD, coords almacenadas en users.latitude/longitude)
               ↓
              NULL → usa Barcelona Centro [41.3851, 2.1734]
```

### 9.6 Fórmula Haversine implementada

```typescript
export function calculateDistance(lat1, lon1, lat2, lon2): number {
    const R = 6371; // Radio de la Tierra en km
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distancia en km
}
```

La misma fórmula está duplicada en el frontend (`DriverDashboard.tsx`) para calcular y mostrar la distancia en la UI del conductor sin necesidad de una llamada extra al servidor.

---

## 10. SEGURIDAD

### 10.1 Capas de seguridad implementadas

```
┌──────────────────────────────────────────────────────────────────────┐
│                       CAPAS DE SEGURIDAD                              │
│                                                                        │
│  1. JWT (JSON Web Token)                                              │
│     • Algoritmo: HS256                                                │
│     • Expiración: 24 horas                                            │
│     • Payload: { id, name, role }                                     │
│     • Almacenamiento frontend: sessionStorage (se limpia al cerrar)   │
│     • WebSocket: token en handshake.auth (no en URL)                  │
│                                                                        │
│  2. CONTRASEÑAS                                                       │
│     • bcrypt con salt factor 10                                       │
│     • Solo se almacena el hash en BD                                  │
│                                                                        │
│  3. CONTROL DE ACCESO POR ROLES (RBAC)                               │
│     requireRole('CLIENT')  → solo cruceristas                         │
│     requireRole('DRIVER')  → solo conductores                         │
│     requireRole('ADMIN')   → solo administradores                     │
│                                                                        │
│  4. RATE LIMITING (por IP)                                            │
│     • Global:      100 requests/minuto (todos los endpoints)          │
│     • Auth:         10 requests/minuto (anti-brute-force login)       │
│     • Locker open:   5 requests/minuto (anti-PIN-guessing)           │
│                                                                        │
│  5. CABECERAS HTTP SEGURAS (Helmet)                                   │
│     X-Content-Type-Options, X-Frame-Options, CSP, etc.               │
│                                                                        │
│  6. CORS WHITELIST                                                    │
│     Orígenes permitidos: localhost:9100, 9101, 9102, 9103            │
│     Peticiones sin origen permitidas (apps móviles / curl)           │
│                                                                        │
│  7. BODY SIZE LIMIT                                                   │
│     Máximo 16kb por request (previene payload abuse / DoS)           │
│                                                                        │
│  8. VALIDACIÓN DE ENTRADA (Zod)                                       │
│     Todos los endpoints con schema explícito                          │
│     IDs en params validados contra /^\d+$/                            │
│                                                                        │
│  9. SANITIZACIÓN DE DATOS SENSIBLES                                   │
│     sanitizeForSocket(): nunca envía lockerCode ni handshakeCode     │
│     por broadcast público WebSocket                                   │
│                                                                        │
│  10. TRANSACCIONES SQLite (Concurrencia)                              │
│      Accept, Deposit y OpenLocker usan db.transaction()              │
│      Evita race conditions con verificación atómica de estado        │
└──────────────────────────────────────────────────────────────────────┘
```

### 10.2 Variables de entorno sensibles

| Variable | Valor demo | Nota producción |
|---|---|---|
| `JWT_SECRET` | `super_secret_jwt_key_demo` | Cambiar por string aleatorio de 64+ chars |
| `DB_FILE` | `./database.sqlite` | Ruta absoluta con backups |
| `PORT` | `9000` | Configurar reverse proxy (nginx) |
| `FRONTEND_URL` | `http://localhost:9100` | URL producción en HTTPS |

---

## 11. FLUJOS DE USUARIO DETALLADOS

### 11.1 Flujo Cliente (Crucerista) completo

```
LOGIN
  │
  ▼
LoginPage: email + password ──► POST /api/auth/login
  │
  ├── JWT guardado en sessionStorage
  ├── homeCoords guardadas en sessionStorage (null para clientes)
  ├── setUser(name, "CLIENT", token)
  └── navigate("/client")
       │
       ▼
  ClientDashboard
  ├── useSocket() → conecta WebSocket con { auth: { token } }
  ├── AppContext.refreshData() → GET /api/requests/mine
  └── NotificationBell → GET /api/notifications
       │
       ▼
  [Sin pedido activo — muestra formulario]
       │
       ├── Autocomplete ubicación:
       │   Input → debounce 600ms → GET /api/locations/search?q=
       │   (proxy a Nominatim, filtra a Barcelona, Spain)
       │   Selección → almacena { displayName, lat, lon }
       │
       ├── Selección tamaño: SMALL (bolsa) / MEDIUM (caja)
       │
       └── "Confirmar Solicitud"
              │ → POST /api/requests { pickupLocation, lat, lon, packageSize }
              │ ← PickupRequest (status = REQUESTED)
              └── setCurrentRequest(newReq)

  [Pedido en REQUESTED]
  ├── StatusBadge: "Solicitado" (amarillo)
  └── Timeline progreso: 1/5 completado

  [Pedido en CONFIRMATION_PENDING]
  ├── StatusBadge: "En encuentro" (ámbar)
  ├── UI: Input 4 dígitos "Código para el cliente"
  └── "Confirmar"
         │ → POST /api/requests/:id/confirm-driver { handshakeCode: "4872" }
         │ ← PickupRequest (status = IN_PROGRESS) si código correcto
         └── ← Error 400 si código incorrecto / 410 si expirado

  [Pedido en IN_PROGRESS]
  ├── StatusBadge: "En traslado" (azul)
  └── Esperando que el conductor deposite...

  [Pedido en DEPOSITED]
  ├── WebSocket "locker:ready" → CustomEvent → UI actualizada
  ├── StatusBadge: "Depositado" (naranja)
  ├── UI: Input 6 dígitos (cliente lee PIN de notificación)
  └── "Abrir"
         │ → POST /api/lockers/open { lockerCode: "847291" }
         │ ← PickupRequest (status = PICKED_UP)
         └── Locker liberado en BD

  [Pedido en PICKED_UP]
  └── Pantalla éxito "¡Compra completada!" + botón nueva solicitud

  NOTIFICACIONES (tiempo real, siempre activas):
  ├── WebSocket "locker:ready" → Toast "Tu paquete está listo 📦"
  ├── WebSocket "notification:new" → Toast + badge en campana
  ├── GET /api/notifications → lista persistente
  ├── POST /api/notifications/:id/read → marcar leída
  └── DELETE /api/notifications → limpiar todas
```

### 11.2 Flujo Conductor (Driver) completo

```
LOGIN
  │
  ▼
DriverDashboard
  ├── useSocket() → conecta WebSocket
  ├── useDriverGeoLocation(enabled=true, homeCoords)
  │   ├── navigator.geolocation.getCurrentPosition()
  │   ├── navigator.geolocation.watchPosition() (continuo, maxAge 30s)
  │   └── Cada posición → socket.emit("driver:location:update", {lat, lon})
  │       Backend: activeDrivers.set(userId, { socketId, lat, lon })
  │
  ├── AppContext.refreshData():
  │   ├── GET /api/requests/pending (geo-filtrado por backend)
  │   └── GET /api/requests/my-pickups
  │
  ├── DriverMap (Leaflet):
  │   ├── Marcador en posición actual del conductor
  │   ├── Círculo de radio (default 3km)
  │   └── Marcadores de pedidos con popup (distancia + tamaño + botón aceptar)
  │
  ├── Sección "Solicitudes pendientes":
  │   └── Para cada pedido:
  │       ├── Cliente: {nombre}
  │       ├── Ubicación: {dirección}
  │       ├── Distancia calculada en frontend (Haversine)
  │       └── Botón "Aceptar"
  │              │ → POST /api/requests/:id/accept
  │              │ ← PickupRequest (status = CONFIRMATION_PENDING)
  │              │   handshakeCode = "4872"
  │              └── Pedido pasa a "Mis recogidas"
  │
  └── Sección "Mis recogidas":
      └── Para cada pedido asignado:
          ├── Si CONFIRMATION_PENDING:
          │   ├── Muestra handshakeCode en grande (ej: "4872")
          │   ├── "Esperando a que el cliente lo introduzca..."
          │   └── Botón "Renovar Código"
          │          → POST /api/requests/:id/renew-handshake
          │          ← Nuevo código + nuevo TTL
          │
          └── Si IN_PROGRESS:
              └── Botón "Depositar en Locker"
                     │ → POST /api/requests/:id/deposit {}
                     │ ← PickupRequest (status = DEPOSITED, locker asignado)
                     └── Sistema: notifica al cliente via WebSocket privado
```

### 11.3 Flujo Administrador completo

```
LOGIN (admin@demo.com / password123)
  │
  ▼
AdminDashboard
  ├── Verifica role === 'ADMIN' (doble check frontend + backend)
  │
  ├── GET /api/admin/users → tabla con todos los usuarios (no-admin)
  │   Columnas:
  │   ├── ID
  │   ├── Nombre + Email
  │   ├── Rol (badge coloreado: azul=CLIENT, naranja=DRIVER)
  │   ├── Paquetes Solicitados (ordered_count, calculado en SQL)
  │   ├── Paquetes Depositados (deposited_count, calculado en SQL)
  │   └── Fecha de Creación
  │
  ├── Botón "Actualizar lista" → re-fetch
  │
  └── Botón eliminar (icono UserX):
         │ → window.confirm("¿Estás seguro...?")
         │ → DELETE /api/admin/users/:id
         │ ← { success: true, message: "..." }
         └── Frontend: filtra usuario de la lista local
```

---

## 12. COMPONENTES FRONTEND — REFERENCIA

### 12.1 Árbol de componentes

```
App.tsx
├── QueryClientProvider (TanStack Query - caché + refetch)
├── TooltipProvider (Radix UI)
├── Toaster (shadcn/ui - toasts tipo alert)
├── Sonner (toasts tipo notificación)
└── AppProvider (Context global)
    └── BrowserRouter
        └── Routes
            ├── Route element={<Layout>}
            │   ├── Navbar
            │   │   ├── Logo "Cruise Locker BCN" + icono Package
            │   │   ├── NotificationBell [solo CLIENT]
            │   │   │   ├── Botón campana + badge contador no leídas
            │   │   │   └── Dropdown lista notificaciones
            │   │   ├── Nombre usuario + Rol
            │   │   └── Botón "Salir" (logout)
            │   └── Outlet
            │       ├── /  → LoginPage
            │       │   ├── Tabs: "Iniciar Sesión" / "Registrarse"
            │       │   ├── Inputs: email, password, (name si registro)
            │       │   └── Selector rol: Crucerista / Conductor (solo registro)
            │       │
            │       ├── /client → [ProtectedRoute allowedRoles=["CLIENT"]]
            │       │   └── ClientDashboard
            │       │       ├── Tabs: "Pedido Actual" / "Historial"
            │       │       ├── [Tab CURRENT - sin pedido activo]
            │       │       │   ├── Sección "Solicitar nueva recogida"
            │       │       │   │   ├── Autocomplete ubicación (Nominatim)
            │       │       │   │   ├── Selector SMALL/MEDIUM
            │       │       │   │   └── Botón "Confirmar Solicitud"
            │       │       │   └── [Vacío - no mostrar nada más]
            │       │       ├── [Tab CURRENT - con pedido activo]
            │       │       │   ├── Sección status card
            │       │       │   │   ├── Grid: Punto de Recogida + Tamaño
            │       │       │   │   ├── StatusBadge
            │       │       │   │   ├── Timeline 6 pasos (barras de color)
            │       │       │   │   ├── Labels: Solicitado→Encuentro→Traslado→Locker→Listo
            │       │       │   │   ├── [Si CONFIRMATION_PENDING] Input handshake 4 dígitos
            │       │       │   │   └── [Si DEPOSITED] Input PIN 6 dígitos + locker label
            │       │       │   └── [Si PICKED_UP] Pantalla éxito
            │       │       └── [Tab HISTORY]
            │       │           └── Lista de PickupRequests pasados (cards)
            │       │
            │       ├── /driver → [ProtectedRoute allowedRoles=["DRIVER"]]
            │       │   └── DriverDashboard
            │       │       ├── Header: título + indicador GPS (lat, lon)
            │       │       ├── DriverMap (Leaflet + React Leaflet)
            │       │       │   ├── TileLayer CartoDB Voyager
            │       │       │   ├── Marker posición conductor
            │       │       │   ├── Circle radio activo
            │       │       │   └── Markers pedidos pendientes (con Popup)
            │       │       ├── Sección "Solicitudes pendientes"
            │       │       │   └── Cards: cliente, ubicación, distancia, botón Aceptar
            │       │       └── Sección "Mis recogidas"
            │       │           └── Cards: cliente, estado, locker, acciones contextuales
            │       │
            │       └── /admin → [ProtectedRoute allowedRoles=["ADMIN"]]
            │           └── AdminDashboard
            │               ├── Header + botón Salir
            │               └── Tabla usuarios con botones eliminar
            │
            └── Route path="*" → NotFound
```

### 12.2 AppContext — Estado global

```typescript
// Tipo del contexto
interface AppState {
  // Auth
  userName: string;
  role: "CLIENT" | "DRIVER" | "ADMIN" | null;
  token: string | null;
  homeCoords: { lat: number; lon: number } | null;

  // Acciones auth
  setUser(name: string, role: Role, token: string, homeCoords?: {...} | null): void;
  logout(): void;

  // Datos en caché
  currentRequest: PickupRequest | null;    // CLIENT: pedido activo
  pendingRequests: PickupRequest[];         // DRIVER: pedidos disponibles
  driverPickups: PickupRequest[];           // DRIVER: mis recogidas activas

  // Actualizadores directos
  setCurrentRequest: Dispatch<...>;
  setPendingRequests: Dispatch<...>;
  setDriverPickups: Dispatch<...>;

  // Refresco basado en rol
  refreshData(): Promise<void>;
  // → Si CLIENT: GET /requests/mine
  // → Si DRIVER: GET /requests/pending + GET /requests/my-pickups
}

// Persistencia: sessionStorage
// Keys: 'userName', 'role', 'token', 'homeCoords'
// Se limpia en logout() y al cerrar la pestaña (sessionStorage)
```

### 12.3 useSocket — Hook WebSocket

```typescript
// Conecta Socket.IO con JWT, registra event listeners
export const useSocket = () => {
  // Al montar:
  socket.auth = { token };
  socket.connect();

  // Listeners:
  socket.on('request:new')     → si DRIVER: refreshData()
  socket.on('request:updated') → refreshData() (todos los roles)
  socket.on('locker:ready')    → si CLIENT: CustomEvent + refreshData()
  socket.on('notification:new')→ si CLIENT: CustomEvent

  // Al desmontar:
  socket.off(...todos)
  socket.disconnect();
};
```

### 12.4 useDriverGeoLocation — Hook GPS

```typescript
// Emite posición GPS continuamente via WebSocket
export function useDriverGeoLocation(enabled: boolean, fallback?): {
  location: { lat, lon } | null;
  error: boolean;
}

// Comportamiento:
// 1. getCurrentPosition() para posición inmediata
// 2. watchPosition() para actualizaciones continuas (maxAge 30s)
// 3. En cada posición: socket.emit("driver:location:update", {lat, lon})
// 4. Si GPS falla: usa fallbackCoords o [41.3851, 2.1734] (BCN centro)
```

### 12.5 StatusBadge — Mapa de estados a colores

| Status | Label visible | Color |
|---|---|---|
| `REQUESTED` | Solicitado | Amarillo (status-requested) |
| `ACCEPTED` | Aceptado | Azul (status-accepted) |
| `CONFIRMATION_PENDING` | En encuentro | Ámbar (amber-100) |
| `IN_PROGRESS` | En traslado | Azul claro (blue-100) |
| `DEPOSITED` | Depositado | Naranja (status-deposited) |
| `PICKED_UP` | Recogido | Verde (status-picked-up) |

---

## 13. CONFIGURACIÓN Y PUERTOS

### 13.1 Puertos

| Servicio | Puerto | Protocolo |
|---|---|---|
| Frontend (Vite dev) | `9100` | HTTP |
| Backend (Express) | `9000` | HTTP |
| WebSocket | `9000` | WS (mismo proceso) |

### 13.2 Variables de entorno — Backend (`backend/.env`)

```env
PORT=9000
JWT_SECRET=super_secret_jwt_key_demo
DB_FILE=./database.sqlite
FRONTEND_URL=http://localhost:9100
SIMULATE_RACE=false
```

> `SIMULATE_RACE=true` activa delays artificiales de 50ms en operaciones críticas para forzar race conditions en tests de concurrencia.

### 13.3 Scripts disponibles

**Frontend (`cruise-connect-main/`):**
```bash
npm run start:all     # Mata puertos 9000/9100/9101/9102 + arranca frontend + backend
npm run dev           # Solo frontend (puerto 9100)
npm run dev:backend   # Solo backend (desde ../backend)
npm run build         # Build producción
npm run build:dev     # Build en modo desarrollo
npm run test          # Tests Vitest (una pasada)
npm run test:watch    # Tests Vitest (watch mode)
npm run lint          # ESLint
npm run preview       # Preview del build de producción
```

**Backend (`backend/`):**
```bash
npm run dev           # tsx watch src/index.ts (hot-reload)
npm run build         # tsc → dist/
npm run start         # node dist/index.js (producción)
npm run seed-reset    # Resetea BD a estado inicial con datos demo
npm run seed-bcn      # Seed geográfico Barcelona (testing geo-dispatch)
npm run test          # Jest + Supertest (forceExit)
```

### 13.4 Cuentas de demostración

| Rol | Email | Contraseña | Notas |
|---|---|---|---|
| ADMIN | `admin@demo.com` | `password123` | Creado en seed-reset |
| CLIENT | `client@demo.com` | `password123` | Cuenta básica |
| DRIVER | `driver@demo.com` | `password123` | Cuenta básica |
| CLIENT (geo) | `rambla@demo.com` | `password123` | Coords: La Rambla (seed-bcn) |
| DRIVER 1 (cerca) | `driver1@demo.com` | `password123` | ~0.7km de La Rambla |
| DRIVER 2 (cerca) | `driver2@demo.com` | `password123` | ~1.3km de La Rambla |
| DRIVER 3 (lejos) | `driver3@demo.com` | `password123` | ~8km (Badalona) — fuera de radio |

---

## 14. TESTING

### 14.1 Tests Backend (`backend/src/__tests__/`)

| Fichero | Tipo | Cobertura |
|---|---|---|
| `integration.test.ts` | E2E | Flujo completo: register → login → create → accept → confirm → deposit → open |
| `concurrency.test.ts` | Race conditions | Dos drivers intentando aceptar el mismo pedido simultáneamente |
| `geo-matching.test.ts` | Unitario | Haversine, drivers dentro/fuera de radio, geo-dispatch correcto |
| `security.test.ts` | Seguridad | JWT inválidos, sin auth, roles incorrectos, rate limits |

**Stack de testing backend:**
- Jest 30.x como runner
- Supertest 7.x para HTTP requests a la app de Express
- ts-jest para TypeScript
- `helpers.ts`: funciones compartidas para crear usuarios/tokens de test

### 14.2 Tests Frontend (`src/test/`)

| Fichero | Framework | Descripción |
|---|---|---|
| `example.test.ts` | Vitest + jsdom | Tests unitarios base |
| `setup.ts` | — | Configuración de testing-library/jest-dom |

---

## 15. DIAGRAMA DE FLUJO DE DATOS COMPLETO

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          FLUJO COMPLETO DE DATOS                             │
│                                                                               │
│  CLIENTE (Browser)          BACKEND (Node.js)          SQLite DB             │
│  ──────────────────         ────────────────           ─────────             │
│                                                                               │
│  1. POST /auth/login ──────► verifyPassword(bcrypt) ──► users table          │
│     ◄── { token, user } ◄──  generateToken(JWT, 24h)                         │
│     sessionStorage.setItem                                                    │
│                                                                               │
│  2. socket.connect() ───────► verifyToken(JWT)                                │
│  [auth: { token }]            socket.join("user_<id>")                       │
│                                                                               │
│  3. [DRIVER] GPS watchPos ──► socket.emit("driver:location:update")          │
│                              activeDrivers.set(userId, {socketId,lat,lon})   │
│                                                                               │
│  4. POST /requests ─────────► INSERT pickup_requests ──► pickup_requests      │
│                               Geo-dispatch:                                  │
│                               for driver in activeDrivers:                   │
│                                 if Haversine(driver, pedido) <= 3km:         │
│                                   emitToSocket("request:new", safeDTO)       │
│                                                                               │
│  5. POST /requests/:id/accept ► db.transaction():      ──► UPDATE requests    │
│                                  check status='REQUESTED'                    │
│                                  handshakeCode = rand(1000-9999)             │
│                                  expiresAt = now + 5min                      │
│                                  UPDATE status='CONFIRMATION_PENDING'        │
│                                 emitEvent("request:updated", safeDTO)        │
│                                                                               │
│  6. POST .../confirm-driver ──► db.transaction():      ──► UPDATE requests    │
│     { handshakeCode: "4872" }   check código == BD                           │
│                                  check expiresAt > now                       │
│                                  UPDATE status='IN_PROGRESS'                 │
│                                 emitEvent("request:updated", safeDTO)        │
│                                                                               │
│  7. POST .../deposit ──────────► db.transaction():     ──► UPDATE lockers     │
│                                  find locker WHERE is_occupied=0             │
│                                  lockerCode = rand(100000-999999)            │
│                                  UPDATE lockers SET is_occupied=1            │
│                                  UPDATE requests SET status='DEPOSITED'      │
│                                  INSERT notifications                        │
│                                 emitToUser(clientId, "locker:ready", {PIN})  │
│                                 emitToUser(clientId, "notification:new")     │
│                                 emitEvent("request:updated", safeDTO)        │
│                                                                               │
│  8. POST /lockers/open ─────────► db.transaction():   ──► UPDATE requests    │
│     { lockerCode: "847291" }      validate code+owner     UPDATE lockers     │
│                                  UPDATE status='PICKED_UP'                   │
│                                  UPDATE locker is_occupied=0                 │
│                                 emitEvent("request:updated", safeDTO)        │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 16. DISEÑO UI/UX

### 16.1 Sistema de Design Tokens (HSL)

| Token CSS | Valor HSL | Color visual | Uso |
|---|---|---|---|
| `--primary` | `213 60% 22%` | Azul marino | Botones primarios, navbar |
| `--accent` | `199 80% 46%` | Cian brillante | CTAs, highlights, links activos |
| `--background` | `210 20% 98%` | Blanco grisáceo | Fondo de página |
| `--card` | `0 0% 100%` | Blanco puro | Fondo de tarjetas |
| `--muted` | `210 20% 96%` | Gris claro | Fondos secundarios |
| `--border` | `214 20% 90%` | Gris suave | Bordes |
| `--destructive` | `0 84% 60%` | Rojo | Errores, eliminar |
| `--status-requested` | `45 93% 58%` | Amarillo | Estado: Solicitado |
| `--status-accepted` | `213 70% 52%` | Azul | Estado: Aceptado |
| `--status-deposited` | `28 87% 55%` | Naranja | Estado: Depositado |
| `--status-picked-up` | `152 60% 42%` | Verde | Estado: Recogido |

### 16.2 Tipografía

- **Headings (h1–h4)**: Space Grotesk — moderna, técnica, pesos 500–700
- **Body/UI**: Inter — limpia, legible en pantalla, pesos 300–700
- **Monospace**: Sistema (códigos PIN, coordenadas GPS)

### 16.3 Layout y Responsive

- Contenido max-width: `max-w-5xl` (1024px)
- Mobile-first con Tailwind breakpoints estándar
- Navbar: sticky, `bg-card/80 backdrop-blur-md`
- Contenido: `mx-auto px-4 py-6` con `flex-1` para footer al fondo

### 16.4 Animaciones

- Entrada de secciones: `animate-in fade-in slide-in-from-bottom-2 duration-300`
- Loading spinners: `animate-spin` (Loader2 de Lucide)
- Indicadores vivos: `animate-pulse` (GPS obteniendo señal, esperando cliente)
- Transiciones: `transition-colors`, `transition-all`

---

## 17. INTEGRACIONES EXTERNAS

### 17.1 OpenStreetMap Nominatim (Geocodificación)

| Aspecto | Detalle |
|---|---|
| URL | `https://nominatim.openstreetmap.org/search` |
| Parámetros | `format=json&limit=5&q={query},Barcelona,Spain` |
| User-Agent | `CruiseConnect/1.0 (info@rekertech.com)` |
| Tipo integración | Proxy en backend (evita CORS + oculta implementación al cliente) |
| Autenticación | Ninguna (servicio público de OSM) |
| Rate limit OSM | 1 req/s por IP (política pública) |
| Datos devueltos | `[{ display_name, lat, lon }]` → mapeado a `{ displayName, lat, lon }` |

**Flujo completo:**
```
Frontend (input usuario) → debounce 600ms → GET /api/locations/search?q=...
    Backend → fetch nominatim.openstreetmap.org → mapea respuesta → retorna al frontend
```

### 17.2 CartoDB / OpenStreetMap (Mapas)

| Aspecto | Detalle |
|---|---|
| Proveedor tiles | CartoDB (Voyager style) |
| URL tiles | `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png` |
| Atribución | OpenStreetMap contributors |
| Autenticación | Ninguna (servicio público) |
| Uso | Solo en `DriverMap.tsx` via React Leaflet |

### 17.3 Browser Geolocation API

| Aspecto | Detalle |
|---|---|
| API | `navigator.geolocation` (estándar W3C) |
| Modo | `enableHighAccuracy: false` (ahorra batería) |
| Timeout | 10 segundos |
| MaxAge caché | 30 segundos |
| Permiso requerido | Sí (usuario debe aceptar el popup del navegador) |
| Fallback | Coordenadas `homeCoords` del usuario en BD, o Barcelona Centro `[41.3851, 2.1734]` |

---

## 18. ESTADO ACTUAL / OBSERVACIONES TÉCNICAS

### 18.1 Funcionalidades implementadas

| Funcionalidad | Estado | Notas |
|---|---|---|
| Frontend SPA completo | ✅ Completo | Funcional end-to-end |
| Backend REST API | ✅ Completo | Todos los endpoints implementados |
| WebSockets tiempo real | ✅ Completo | Geo-dispatch + rooms privadas |
| Sistema de autenticación JWT | ✅ Completo | 24h, sessionStorage |
| Control de acceso RBAC | ✅ Completo | 3 roles, guards frontend + backend |
| Esquema de BD SQLite | ✅ Completo | 4 tablas, FK, transacciones ACID |
| Geo-dispatch Haversine | ✅ Completo | Radio 3km, activeDrivers en memoria |
| Seguridad (Helmet, CORS, rate limit) | ✅ Completo | Capas múltiples |
| Sistema de notificaciones | ✅ Completo | BD + WebSocket push + UI |
| Tests backend | ✅ Completo | Integration, concurrency, geo, security |
| Handshake presencial (PIN 4 dígitos) | ✅ Completo | TTL 5min, renovable |
| Apertura locker (PIN 6 dígitos) | ✅ Completo | Generación segura sin colisión |
| Asignación automática de lockers | ✅ Completo | Primer locker libre disponible |
| Historial de pedidos cliente | ✅ Completo | Tab separado en ClientDashboard |
| Mapa Leaflet (DriverMap) | ✅ Implementado | Componente listo; no integrado aún en DriverDashboard |
| Dark mode | 🔶 Preparado | next-themes instalado, variables CSS listas, no activado |
| Tests frontend | 🔶 Mínimo | Solo archivo de ejemplo con Vitest |
| Paginación | ❌ No implementado | Admin y historial cargan todos los registros |
| Recuperación de contraseña | ❌ No implementado | — |
| Notificaciones para DRIVER | ❌ No implementado | Solo CLIENT recibe notificaciones |
| Configuración para producción | ❌ No preparado | Sin HTTPS, sin PM2, JWT_SECRET expuesta |

### 18.2 Deudas técnicas identificadas

1. **DriverMap no renderizado**: El componente `DriverMap.tsx` está completamente implementado y funcional pero no está integrado en `DriverDashboard.tsx` en la versión actual del código.

2. **Mismatch Admin DTO**: El backend devuelve campos `ordered_count`, `deposited_count`, `created_at`; el frontend los referencia como `user.ordered_count`, `user.deposited_count`, `user.created_at` (funciona), pero la interfaz TypeScript de `getAdminUsers()` declara solo `requestsCount` (legacy).

3. **Códigos hardcodeados**: Las URLs del backend (`http://localhost:9000`) y del WebSocket están hardcodeadas en `src/services/api.ts` y `src/socket.ts`. Deberían ser variables de entorno de Vite (`VITE_API_URL`).

4. **Estado ACCEPTED sin uso**: El schema de BD define el estado `ACCEPTED` en el CHECK constraint, pero el flujo actual salta directamente a `CONFIRMATION_PENDING` al aceptar. No genera problemas pero hay inconsistencia.

5. **Sin paginación**: El endpoint `/api/admin/users` y `/api/requests/history` retornan todos los registros sin límite. En producción con miles de usuarios podría ser un problema de rendimiento.

6. **activeDrivers en memoria**: El mapa de conductores activos se pierde si el backend se reinicia. Para producción habría que usar Redis u otra capa de persistencia distribuida.

---

## APÉNDICE A — CREDENCIALES Y ACCESO RÁPIDO

### Inicio del entorno de desarrollo

```bash
# Desde el directorio raíz del frontend (cruise-connect-main/)
npm install
cd ../backend && npm install && cd ..
npm run start:all
```

La app estará disponible en:
- **Frontend**: http://localhost:9100
- **Backend API**: http://localhost:9000/api
- **Health check**: http://localhost:9000/api/health

### Reset de base de datos

```bash
cd backend && npm run seed-reset
```

### Escenario de prueba geográfico (Barcelona)

```bash
cd backend && npm run seed-bcn
# Crea:
# - rambla@demo.com (CLIENT en La Rambla, 41.3809, 2.1730)
# - driver1@demo.com (DRIVER ~0.7km)
# - driver2@demo.com (DRIVER ~1.3km)
# - driver3@demo.com (DRIVER ~8km — fuera de radio)
```

---

## APÉNDICE B — GLOSARIO

| Término | Definición |
|---|---|
| **Crucerista** | Usuario con rol CLIENT. Turista de crucero que solicita recogida de paquetes. |
| **Conductor** | Usuario con rol DRIVER. Recoge paquetes y los deposita en taquillas. |
| **Locker / Taquilla** | Casillero físico numerado donde se depositan los paquetes. |
| **Handshake** | Proceso de verificación presencial entre conductor y cliente mediante un código PIN de 4 dígitos con TTL de 5 minutos. |
| **Locker Code** | PIN de 6 dígitos generado aleatoriamente para que el cliente pueda "abrir" (simular apertura de) la taquilla. |
| **Geo-dispatch** | Sistema de asignación de pedidos a conductores basado en proximidad geográfica usando la fórmula Haversine. |
| **activeDrivers** | Mapa en memoria del backend que mantiene las posiciones GPS de los conductores conectados. |
| **safeDTO / sanitizeForSocket** | DTO del pedido con los códigos PIN eliminados, seguro para enviar por broadcast WebSocket. |
| **TTL** | Time To Live. Tiempo de vida de un código (handshake = 5 minutos). |
| **DTO** | Data Transfer Object. Estructura de datos estandarizada para la comunicación API. |
| **SPA** | Single Page Application. La aplicación funciona en una sola página HTML con routing del lado del cliente. |
| **RBAC** | Role-Based Access Control. Control de acceso basado en roles. |
| **JWT** | JSON Web Token. Token firmado que contiene la identidad del usuario. |

---

*Documento generado por análisis automático de código fuente — REKER TECH SOLUTIONS / Cruise Locker BCN — Marzo 2026*
