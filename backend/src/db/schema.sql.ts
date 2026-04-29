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
  signing_public_key JSONB NULL,
  signing_key_algorithm TEXT NULL CHECK(signing_key_algorithm IN ('ECDSA_P256_SHA256')),
  signing_key_status TEXT NOT NULL DEFAULT 'UNREGISTERED' CHECK(signing_key_status IN ('UNREGISTERED','ACTIVE','REVOKED')),
  signing_key_registered_at TIMESTAMPTZ NULL,
  signing_key_rotated_at TIMESTAMPTZ NULL,
  vehicle_identifier TEXT,
  accessibility_profile TEXT CHECK(accessibility_profile IN ('standard','pmr','age_advanced')) DEFAULT 'standard',
  device_identifier TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS signing_public_key JSONB NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS signing_key_algorithm TEXT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS signing_key_status TEXT NOT NULL DEFAULT 'UNREGISTERED';
ALTER TABLE users ADD COLUMN IF NOT EXISTS signing_key_registered_at TIMESTAMPTZ NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS signing_key_rotated_at TIMESTAMPTZ NULL;

-- ─── LOCKERS ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lockers (
  id SERIAL PRIMARY KEY,
  label TEXT NOT NULL UNIQUE,
  size_category TEXT NOT NULL DEFAULT 'S' CHECK(size_category IN ('S','M','L')),
  is_occupied BOOLEAN NOT NULL DEFAULT FALSE,
  current_request_id INTEGER NULL,
  access_code TEXT NULL,
  hub_id TEXT DEFAULT 'LPA-PUERTO',
  hw_status TEXT NOT NULL DEFAULT 'ONLINE' CHECK(hw_status IN ('ONLINE','OUT_OF_SERVICE','MAINTENANCE')),
  last_sync_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Idempotent migration: add hw_status if this table already exists without it
ALTER TABLE lockers ADD COLUMN IF NOT EXISTS hw_status TEXT NOT NULL DEFAULT 'ONLINE' CHECK(hw_status IN ('ONLINE','OUT_OF_SERVICE','MAINTENANCE'));

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
  status TEXT NOT NULL CHECK(status IN ('REQUESTED','ACCEPTED','CONFIRMATION_PENDING','IN_PROGRESS','DEPOSITED','PICKED_UP','CANCELLED')),
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

-- ─── NOTIFICATION TEMPLATES ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_templates (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'es' CHECK(locale IN ('es','en','ca')),
  channel TEXT NOT NULL CHECK(channel IN ('push','sms','both')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(key, locale, channel)
);

-- ─── USER NOTIFICATION PREFERENCES ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_notification_prefs (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  push_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sms_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  locale TEXT NOT NULL DEFAULT 'es' CHECK(locale IN ('es','en','ca')),
  phone TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── PUSH SUBSCRIPTIONS (VAPID) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── PRICING RULES ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pricing_rules (
  id SERIAL PRIMARY KEY,
  package_size TEXT NOT NULL CHECK(package_size IN ('SMALL','MEDIUM','LARGE')),
  base_price_cents INTEGER NOT NULL CHECK(base_price_cents > 0),
  currency TEXT NOT NULL DEFAULT 'eur',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── PAYMENTS ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES pickup_requests(id),
  client_id INTEGER NOT NULL REFERENCES users(id),
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'eur',
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK(status IN ('PENDING','AUTHORIZED','CAPTURED','REFUNDED','FAILED','CANCELLED')),
  stripe_payment_intent_id TEXT UNIQUE,
  stripe_client_secret TEXT,
  captured_at TIMESTAMPTZ NULL,
  refunded_at TIMESTAMPTZ NULL,
  refund_reason TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── PAYMENT REFUNDS ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_refunds (
  id SERIAL PRIMARY KEY,
  payment_id INTEGER NOT NULL REFERENCES payments(id),
  stripe_refund_id TEXT UNIQUE NOT NULL,
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  reason TEXT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK(status IN ('PENDING','SUCCEEDED','FAILED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── STRIPE WEBHOOK EVENTS ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── LOCKER HARDWARE EVENTS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS locker_hw_events (
  id TEXT PRIMARY KEY,
  locker_id INTEGER NOT NULL REFERENCES lockers(id),
  event_type TEXT NOT NULL CHECK(event_type IN ('OPEN','CLOSE','STATUS_CHECK','EMERGENCY_OPEN','MARKED_OUT_OF_SERVICE','MARKED_ONLINE')),
  actor_id INTEGER NULL REFERENCES users(id),  -- NULL means automated/system event
  metadata JSONB NULL,
  signature TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── AUDIT EVENTS ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  request_id INTEGER NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('REQUESTED','ASSIGNED','CONFIRMATION_PENDING','HANDSHAKE_VALIDATED','IN_PROGRESS','DEPOSITED','PICKED_UP','CANCELLED','RATE_LIMIT_BLOCK','HANDSHAKE_RENEWED','PAYMENT_CREATED','PAYMENT_CAPTURED','PAYMENT_REFUNDED','PAYMENT_FAILED')),
  actor_id INTEGER NOT NULL,
  metadata JSONB NULL,
  signature TEXT NOT NULL,
  block_index INTEGER NOT NULL DEFAULT 0,
  previous_event_hash TEXT NULL,
  event_hash TEXT NOT NULL DEFAULT '',
  receipt_payload JSONB NULL,
  receipt_hash TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS block_index INTEGER NOT NULL DEFAULT 0;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS previous_event_hash TEXT NULL;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS event_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS receipt_payload JSONB NULL;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS receipt_hash TEXT NULL;

-- ─── CUSTODY CHALLENGES ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS custody_challenges (
  id TEXT PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES pickup_requests(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK(event_type IN ('HANDSHAKE_VALIDATED','DEPOSITED','PICKED_UP')),
  challenge_payload JSONB NOT NULL,
  canonical_message TEXT NOT NULL,
  challenge_hash TEXT NOT NULL,
  previous_block_hash TEXT NULL,
  payload_digest TEXT NOT NULL,
  required_signers JSONB NOT NULL,
  signatures JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','COMMITTED','REVOKED','EXPIRED')),
  expires_at TIMESTAMPTZ NULL,
  committed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

-- ─── REFRESH TOKENS ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  family_id TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ NULL,
  replaced_by TEXT NULL
);

-- ─── LOGIN ATTEMPTS ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS login_attempts (
  id SERIAL PRIMARY KEY,
  ip TEXT NOT NULL,
  email TEXT NOT NULL,
  success BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── GPS POSITIONS ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gps_positions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  accuracy_m DOUBLE PRECISION NULL,
  device_ts TIMESTAMPTZ NULL,
  server_ts TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
CREATE INDEX IF NOT EXISTS idx_audit_events_request_block_index ON audit_events(request_id, block_index);
CREATE INDEX IF NOT EXISTS idx_audit_events_event_hash ON audit_events(event_hash);
CREATE INDEX IF NOT EXISTS idx_custody_challenges_request_event_status ON custody_challenges(request_id, event_type, status);
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

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_notification_templates_key ON notification_templates(key, locale);

CREATE INDEX IF NOT EXISTS idx_locker_hw_events_locker_id ON locker_hw_events(locker_id);
CREATE INDEX IF NOT EXISTS idx_locker_hw_events_created_at ON locker_hw_events(created_at);

CREATE INDEX IF NOT EXISTS idx_payments_request_id ON payments(request_id);
CREATE INDEX IF NOT EXISTS idx_payments_client_id ON payments(client_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_stripe_pi ON payments(stripe_payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_payment_refunds_payment_id ON payment_refunds(payment_id);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family_id ON refresh_tokens(family_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_created ON login_attempts(ip, created_at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_email_created ON login_attempts(email, created_at);
CREATE INDEX IF NOT EXISTS idx_gps_positions_user_ts ON gps_positions(user_id, server_ts DESC);

-- ─── TELEMETRY STATE SNAPSHOTS ───────────────────────────────────────────────
-- Stores periodic state-tensor snapshots for RL training and offline debugging.
CREATE TABLE IF NOT EXISTS telemetry_state_snapshots (
  id SERIAL PRIMARY KEY,
  snapshot JSONB NOT NULL,
  driver_count INTEGER NOT NULL DEFAULT 0,
  active_request_count INTEGER NOT NULL DEFAULT 0,
  locker_occupancy_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
  max_urgency DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_telemetry_snapshots_created_at ON telemetry_state_snapshots(created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- HITO 4.3.3 — Indices compuestos para queries frecuentes (Phase 4 audit)
-- ═══════════════════════════════════════════════════════════════════════════

-- pickup_requests: filtro por driver + status + orden por created_at
CREATE INDEX IF NOT EXISTS idx_pickup_requests_driver_status_created
  ON pickup_requests(driver_id, status, created_at DESC);

-- pickup_requests: filtro por client + status (lista "mis envios")
CREATE INDEX IF NOT EXISTS idx_pickup_requests_client_status_created
  ON pickup_requests(client_id, status, created_at DESC);

-- pickup_requests: pendientes globales por created_at (lista driver dispatch)
CREATE INDEX IF NOT EXISTS idx_pickup_requests_status_created
  ON pickup_requests(status, created_at DESC);

-- notifications: lista por usuario y orden por fecha (paginacion cursor)
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications(user_id, created_at DESC);

-- notifications: contador de no leidas
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications(user_id) WHERE read = FALSE;

-- audit_events: paginacion cursor en historial
CREATE INDEX IF NOT EXISTS idx_audit_events_request_created
  ON audit_events(request_id, created_at DESC);

-- payments: dashboard admin filtrado por status + creado
CREATE INDEX IF NOT EXISTS idx_payments_status_created
  ON payments(status, created_at DESC);

-- gps_positions: sondeo del ultimo (user_id, server_ts) cubierto ya por
-- idx_gps_positions_user_ts; verificar via EXPLAIN ANALYZE post-deploy.

`;
