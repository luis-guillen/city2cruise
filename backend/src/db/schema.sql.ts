/**
 * Esquema PostgreSQL + PostGIS para Cruise Connect.
 *
 * Cambios respecto al esquema SQLite original:
 *  - SERIAL PRIMARY KEY en vez de INTEGER PRIMARY KEY AUTOINCREMENT
 *  - TIMESTAMPTZ en vez de TEXT para columnas de fecha/hora
 *  - BOOLEAN en vez de INTEGER para flags (is_occupied, escalated, read, etc.)
 *  - GEOGRAPHY(Point, 4326) como columnas PostGIS para lat/lon
 *  - Se mantienen lat/lon DOUBLE PRECISION por compatibilidad con el código existente
 *  - CHECK constraints con sintaxis PostgreSQL estándar
 *  - Extensión PostGIS habilitada al inicio
 *  - merchants creada ANTES de pickup_requests para respetar FK
 */
export const sqlSchema = `
-- Extensión PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;

-- ─── MERCHANTS (debe ir antes de pickup_requests por FK) ────────────────────
CREATE TABLE IF NOT EXISTS merchants (
  id SERIAL PRIMARY KEY,
  business_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT NULL,
  address TEXT NULL,
  latitude DOUBLE PRECISION NULL,
  longitude DOUBLE PRECISION NULL,
  location GEOGRAPHY(Point, 4326) NULL,
  integration_status TEXT NOT NULL DEFAULT 'pending' CHECK(integration_status IN ('pending','active','suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── USERS ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('CLIENT','DRIVER','ADMIN')),
  latitude DOUBLE PRECISION NULL,
  longitude DOUBLE PRECISION NULL,
  location GEOGRAPHY(Point, 4326) NULL,
  vehicle_identifier TEXT,
  accessibility_profile TEXT CHECK(accessibility_profile IN ('standard','pmr','age_advanced')) DEFAULT 'standard',
  device_identifier TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── LOCKERS ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lockers (
  id SERIAL PRIMARY KEY,
  label TEXT NOT NULL UNIQUE,
  size_category TEXT NOT NULL DEFAULT 'S' CHECK(size_category IN ('S','M','L')),
  is_occupied BOOLEAN NOT NULL DEFAULT FALSE,
  current_request_id INTEGER NULL,
  access_code TEXT NULL,
  hub_id TEXT DEFAULT 'LPA-PUERTO',
  last_sync_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── PICKUP REQUESTS ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pickup_requests (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES users(id),
  driver_id INTEGER NULL REFERENCES users(id),
  pickup_location TEXT NOT NULL,
  latitude DOUBLE PRECISION NULL,
  longitude DOUBLE PRECISION NULL,
  pickup_location_geo GEOGRAPHY(Point, 4326) NULL,
  package_size TEXT CHECK(package_size IN ('SMALL','MEDIUM','LARGE')) DEFAULT 'SMALL',
  status TEXT NOT NULL CHECK(status IN ('REQUESTED','ACCEPTED','CONFIRMATION_PENDING','IN_PROGRESS','DEPOSITED','PICKED_UP')),
  handshake_code TEXT NULL,
  handshake_expires_at TIMESTAMPTZ NULL,
  handshake_attempts_count INTEGER NOT NULL DEFAULT 0,
  client_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  driver_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  locker_id INTEGER NULL REFERENCES lockers(id),
  locker_code TEXT NULL,
  locker_code_expires_at TIMESTAMPTZ NULL,
  client_latitude DOUBLE PRECISION NULL,
  client_longitude DOUBLE PRECISION NULL,
  escalated BOOLEAN NOT NULL DEFAULT FALSE,
  merchant_id INTEGER NULL REFERENCES merchants(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── NOTIFICATIONS ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── AUDIT EVENTS ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  request_id INTEGER NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('REQUESTED','ASSIGNED','CONFIRMATION_PENDING','HANDSHAKE_VALIDATED','IN_PROGRESS','DEPOSITED','PICKED_UP','CANCELLED','RATE_LIMIT_BLOCK','HANDSHAKE_RENEWED')),
  actor_id INTEGER NOT NULL,
  metadata JSONB NULL,
  signature TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── HANDSHAKE ATTEMPTS ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS handshake_attempts (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL,
  driver_id INTEGER NOT NULL,
  attempt_number INTEGER NOT NULL,
  result TEXT NOT NULL CHECK(result IN ('success','failure')),
  failure_reason TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── CRUISE MANIFEST ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cruise_manifest (
  id SERIAL PRIMARY KEY,
  vessel_name TEXT NOT NULL,
  imo_number TEXT,
  scheduled_arrival TIMESTAMPTZ NOT NULL,
  all_aboard TIMESTAMPTZ NOT NULL,
  departure TIMESTAMPTZ NOT NULL,
  terminal TEXT,
  estimated_passengers INTEGER DEFAULT 0,
  status TEXT CHECK(status IN ('scheduled','docked','departed','cancelled')) DEFAULT 'scheduled',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- ÍNDICES DE RENDIMIENTO
-- ═══════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_pickup_requests_status ON pickup_requests(status);
CREATE INDEX IF NOT EXISTS idx_pickup_requests_client_id ON pickup_requests(client_id);
CREATE INDEX IF NOT EXISTS idx_pickup_requests_driver_id ON pickup_requests(driver_id);
CREATE INDEX IF NOT EXISTS idx_pickup_requests_created_at ON pickup_requests(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_events_request_id ON audit_events(request_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_created_at ON audit_events(created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_handshake_attempts_request_id ON handshake_attempts(request_id);
CREATE INDEX IF NOT EXISTS idx_merchants_integration_status ON merchants(integration_status);
CREATE INDEX IF NOT EXISTS idx_cruise_manifest_status ON cruise_manifest(status);
CREATE INDEX IF NOT EXISTS idx_cruise_manifest_scheduled_arrival ON cruise_manifest(scheduled_arrival);

-- ═══════════════════════════════════════════════════════════════════════════
-- ÍNDICES ESPACIALES PostGIS (GIST)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_users_location ON users USING GIST(location);
CREATE INDEX IF NOT EXISTS idx_pickup_requests_location ON pickup_requests USING GIST(pickup_location_geo);
CREATE INDEX IF NOT EXISTS idx_merchants_location ON merchants USING GIST(location);
`;
