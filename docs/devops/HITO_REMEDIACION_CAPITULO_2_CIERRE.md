# Cierre del Capítulo 2 — Hardening corto plazo

**Fecha de cierre:** 2026-04-29
**Rama:** `FINAL` (commits `5a78b2a` → `103807e`)
**Hitos cubiertos:** H-2.1, H-2.2, H-2.3, H-2.4 — todos cerrados.

## Resumen

| Hito | Severidad | Hallazgo | Estado | Tag |
| --- | --- | --- | --- | --- |
| H-2.1 | MEDIO | S-06 — CORS permisivo | ✅ | `hito-H-2.1-completed` |
| H-2.2 | BAJO  | S-08 — console.log en producción | ✅ | `hito-H-2.2-completed` |
| H-2.3 | BAJO  | S-09 — archivos residuales | ✅ | `hito-H-2.3-completed` |
| H-2.4 | INFO  | I-01 — falta de ESLint backend | ✅ | `hito-H-2.4-completed` |

## Criterio de salida

| Criterio | Resultado |
| --- | --- |
| Backend `npx eslint src` | exit 0; 0 errors. |
| Frontend `npx eslint .` | exit 0; 0 errors. |
| Backend `npx tsc --noEmit` | clean. |
| Frontend `npx tsc --noEmit` | clean. |
| Backend `npx jest env.test.ts cors.test.ts` | 10/10 passed. |
| Frontend `npx vitest run` | 22 suites, 127/127 passed. |
| Frontend `npm run build` | 0 warnings, OK. |
| `grep console.log\\s*(` (excluding `__tests__/`) backend + frontend | sin coincidencias. |
| `grep '192\\.168\\.\\|BGscsMyO1ynE\\|0XNrTZGcDO'` backend/src | sin coincidencias. |
| `npm audit --audit-level=high` backend | exit 0, 0 vulns. |
| `npm audit --audit-level=high` frontend | exit 0, 10 moderates residuales (vite/vitest/esbuild). |
| Bugs `no-floating-promises` / `no-misused-promises` cazados por el nuevo lint | 4 detectados, 4 arreglados (pickupReminderJob, GeoDispatchService cascade scheduler, LockerSyncService, sockets/io socket.join). |

## Avances notables

- **CORS hardening** queda observable: Sentry alerta cualquier rechazo,
  útil para detectar drift de configuración o probes externos.
- **Logger frontend** centralizado en `src/utils/logger.ts`: debug/info
  silenciados en prod, error reportado a Sentry, warn siempre visible.
- **Backend lint type-checked** activo en CI: rama futura ya no podrá
  introducir promesas mal manejadas sin que el job `backend` falle.

## Próximos pasos

- Capítulo 3 — Observabilidad y auditoría continua (H-3.1 a H-3.5).
- Pendientes de runtime que el owner tiene que ejecutar localmente
  (heredados de Capítulo 1): rotar VAPID en Fly, validar imágenes Docker,
  validar cabeceras contra staging real, correr `docker scout cves`.
