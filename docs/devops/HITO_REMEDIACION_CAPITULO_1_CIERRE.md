# Cierre del Capítulo 1 — Bloque inmediato (pre-producción)

**Fecha de cierre:** 2026-04-29
**Rama:** `FINAL` (commits `8b2618b` → `7f6d1ad`)
**Hitos cubiertos:** H-1.1, H-1.2, H-1.3, H-1.4, H-1.5 — todos cerrados.

## Resumen

| Hito | Severidad | Hallazgo | Estado | Tag |
| --- | --- | --- | --- | --- |
| H-1.1 | ALTO | S-01 — VAPID fallbacks hardcodeados | ✅ | `hito-H-1.1-completed` |
| H-1.2 | ALTO | S-02 — axios + lodash con advisories HIGH | ✅ | `hito-H-1.2-completed` |
| H-1.3 | ALTO | S-03 — contenedores como root sin healthcheck | ✅ (runtime val.) | `hito-H-1.3-completed` |
| H-1.4 | MEDIO | S-04 — sin cabeceras de seguridad en SPA | ✅ (curl real) | `hito-H-1.4-completed` |
| H-1.5 | MEDIO | S-07 — IP local hardcodeada en logs | ✅ | `hito-H-1.5-completed` |

## Criterio de salida

| Criterio | Resultado |
| --- | --- |
| `npm audit --audit-level=high` (backend) | exit 0 — 0 vulnerabilidades en cualquier severidad. |
| `npm audit --audit-level=high` (frontend) | exit 0 — 10 moderate residuales en build tooling (vite/vitest/esbuild), tracked en H-5.x. |
| `grep -rn 'BGscsMyO1ynE\|0XNrTZGcDO\|192\.168\.1\.47' backend/src/` | sin coincidencias. |
| `crossplane.parse(nginx.conf)` | sin errores. |
| `python yaml.safe_load(docker-compose.yml)` | OK; frontend mapea 80→8080. |
| `npx tsc --noEmit` (backend) | clean. |
| `npx eslint .` (frontend) | 0 errors / 7 warnings preexistentes. |
| `npx vitest run` (frontend) | 22 suites, 127/127 tests passing. |
| `npm run build` (frontend) | 6.97 s, 0 warnings. |
| `npx jest src/__tests__/env.test.ts` (backend) | 5/5 tests passing. |

## Acciones pendientes que sólo el owner puede ejecutar

Estas no bloquean el cierre del Capítulo 1, pero son obligatorias antes de
mergear `FINAL` a `main`:

1. **Rotar las VAPID keys en Fly** (H-1.1):
   ```bash
   ./scripts/generate-vapid.sh
   fly secrets set VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… --app city2cruise-backend
   ```
2. **Validar imágenes Docker** (H-1.3) — `docker run + docker inspect + docker
   compose up`. Pegar evidencia en `docs/devops/audits/post-h13/`.
3. **Validar cabeceras** contra staging real (H-1.4) — `securityheaders.com` y
   `curl -sI`. Esperado: nota A o A-. Pegar evidencia en
   `docs/devops/audits/post-h14/`.
4. **Re-ejecutar `docker scout cves`** sobre las nuevas imágenes y compararlo
   con el snapshot pre-remediación (cierre del gap del Cap. 0.3).

## Próximo bloque

Capítulo 2 — Hardening post-launch (H-2.1 a H-2.7). Continuar sobre `FINAL`
con la misma cadencia: commit + tag por hito.
