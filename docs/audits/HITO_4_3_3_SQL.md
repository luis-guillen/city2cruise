# Hito 4.3.3 — Optimización SQL + paginación cursor

> Fecha: 2026-04-28
> Rama: `FASE4-FASE5-FASE6`
> Stack: PostgreSQL 15 + PostGIS 3.3, pg 8.x

## 1. Índices nuevos (compuestos)

Los índices simples ya existentes (`idx_pickup_requests_status`, `..._client_id`,
etc.) **no cubren** las queries más calientes del backend, que filtran por
varias columnas a la vez. Añadidos:

| Índice | Cubre | Beneficio |
|---|---|---|
| `idx_pickup_requests_driver_status_created` | `WHERE driver_id=$1 AND status=$2 ORDER BY created_at DESC` | Lista driver "mis pickups" |
| `idx_pickup_requests_client_status_created` | `WHERE client_id=$1 AND status=$2 ORDER BY created_at DESC` | Lista cliente "mis envíos" |
| `idx_pickup_requests_status_created` | `WHERE status='REQUESTED' ORDER BY created_at DESC` | Cola pendiente del dispatch |
| `idx_notifications_user_created` | `WHERE user_id=$1 ORDER BY created_at DESC` (paginación) | Listado notifs del cliente |
| `idx_notifications_user_unread` (partial) | `WHERE user_id=$1 AND read=FALSE` | Contador del badge — escanea solo no-leídas |
| `idx_audit_events_request_created` | `WHERE request_id=$1 ORDER BY created_at DESC` | Historial paginado |
| `idx_payments_status_created` | `WHERE status=$1 ORDER BY created_at DESC` | Dashboard admin pagos |

Idempotentes (`IF NOT EXISTS`), aplicados en cada `initDB()`.

## 2. EXPLAIN ANALYZE — playbook

Ejecutar dentro del contenedor `db` (o psql local):

```sql
-- Cola de pendientes (driver dispatch)
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, pickup_location, package_size, latitude, longitude, created_at
FROM pickup_requests
WHERE status = 'REQUESTED'
ORDER BY created_at DESC
LIMIT 50;
-- Esperado: Index Scan using idx_pickup_requests_status_created, no Seq Scan.

-- Notificaciones cliente, paginación cursor
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, type, title, message, read, created_at
FROM notifications
WHERE user_id = $1
  AND (created_at, id) < ($2::timestamptz, $3::int)
ORDER BY created_at DESC, id DESC
LIMIT 31;
-- Esperado: Index Scan using idx_notifications_user_created.

-- Búsqueda geoespacial (driver más cercano a un punto)
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, ST_Distance(location, ST_MakePoint($1, $2)::geography) AS d
FROM users
WHERE role = 'DRIVER'
  AND ST_DWithin(location, ST_MakePoint($1, $2)::geography, 5000)
ORDER BY location <-> ST_MakePoint($1, $2)::geography
LIMIT 10;
-- Esperado: Index Scan using idx_users_location (GIST). Latencia objetivo <50ms.
```

Si alguna sigue mostrando Seq Scan, comprobar:
1. `ANALYZE pickup_requests;` — estadísticas frescas tras carga inicial.
2. `pg_stat_user_indexes` para confirmar uso real.

## 3. Paginación cursor

`backend/src/db/pagination/cursor.ts` expone:

```ts
const { items, nextCursor } = await paginate<NotificationDTO>(pg, {
  baseQuery: 'SELECT id, type, title, message, read, created_at FROM notifications WHERE user_id = $1',
  baseParams: [userId],
  orderColumn: 'created_at',
  idColumn: 'id',
  limit,
  cursor: req.query.cursor as string | undefined,
});
```

El cursor es base64url-encoded `{ts, id}`. El cliente lo guarda y lo
devuelve en `?cursor=...`. La query keyset usa el índice compuesto y
es O(log n) en vez de O(n+offset) del `OFFSET/LIMIT`.

**Ventajas vs `OFFSET/LIMIT`:**
- Latencia constante incluso en page 10000.
- Sin saltos cuando se insertan filas durante la paginación (consistencia
  inmutable: `(created_at, id)` es único monotónico).
- Cap forzado a 200 items/page para evitar abuso.

## 4. Próximos pasos (no incluidos en este hito)

- Sustituir los `OFFSET/LIMIT` actuales en `routes/admin.ts` (audit-trail
  / payments listing) por `paginate()`.
- Crear materialized view `mv_locker_occupancy` refrescada cada minuto
  para el panel admin (evita scan de pickup_requests en cada hit).
- Habilitar `pg_stat_statements` en producción para identificar las top
  10 queries por tiempo total.
