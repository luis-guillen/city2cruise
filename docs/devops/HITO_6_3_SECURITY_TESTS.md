# Hito 6.3 — Tests de seguridad

> Status: **Done** (2026-04-28)

## 6.3.1 — OWASP ZAP scaffolding

| Archivo | Función |
|---|---|
| `.github/workflows/zap-baseline.yml` | Scheduled (semanal lunes 04:00 UTC) + workflow_dispatch con 3 modes (baseline/full/api) |
| `.zap/rules.tsv` | Tuning de reglas — IGNORE falsos positivos, FAIL en XSS/SQLi/RCE |
| `scripts/zap-local.sh` | Script local con docker run para escaneo manual |

3 modes disponibles: baseline (passive, ~5min), full active scan (1h+), api scan (con OpenAPI spec).

## 6.3.2 — Dependency audit gate hardened

CI ahora aplica política de Hito 6.3.2:
- `npm audit --audit-level=critical` → **bloquea CI** si hay vulnerabilidad critical
- `npm audit --audit-level=high` → emite ::warning:: pero permite merge (SLA fix <30d)

Aplicado a frontend y backend en jobs separados de `Security (npm audit + secret scan)`.

## 6.3.3 — Tests RBAC + IDOR (jest, sin DB)

`backend/src/__tests__/rbac.test.ts` — 13 tests PASS:

**RBAC (10 tests):**
- /public sin auth → 200
- /me sin token → 401
- /me con Bearer falso → 401
- /me con token CLIENT válido → 200, devuelve role
- CLIENT NO accede /driver-only → 403
- CLIENT NO accede /admin-only → 403
- DRIVER NO accede /client-only → 403
- DRIVER NO accede /admin-only → 403
- ADMIN NO accede /client-only ni /driver-only (rol estricto) → 403, 403
- Cada rol PUEDE acceder a SU endpoint → 200, 200, 200

**IDOR (3 tests):**
- User #1 puede ver /requests/1 → 200
- User #1 NO puede ver /requests/2 → 403
- Path manipulation (URL-encoded) no rompe el check → 403/404

## 6.3.4 — Tests de rate limiting (jest)

`backend/src/__tests__/rate-limiter.test.ts` — 6 tests PASS:

- authLimiter: permite 10, bloquea 11ª con 429
- authLimiter: respuesta 429 incluye Retry-After o RateLimit-Reset
- lockerOpenLimiter: permite 5, bloquea 6ª
- lockerOpenLimiter: respuesta 429 contiene `code: TOO_MANY_REQUESTS`
- globalLimiter: permite 100, bloquea 101ª
- Verificación skipInTest=true: módulo real es no-op en NODE_ENV=test

Política Hito 6.3.4:
- Login: 10 req/min (ajustable a 5 si se observan ataques)
- API general: 100 req/min
- Locker open / handshake: 5 req/min

Estos límites están definidos en `backend/src/middleware/rateLimiter.ts`
y compartidos vía Redis store cuando está disponible (Hito 4.3.2).

## Tests añadidos a CI sin-DB

`.github/workflows/ci.yml` job Backend ahora ejecuta también:
- `rbac.test.ts`
- `rate-limiter.test.ts`

Total tests sin-DB: 36 (antes 23) → margen de seguridad sin requerir Postgres en CI.
