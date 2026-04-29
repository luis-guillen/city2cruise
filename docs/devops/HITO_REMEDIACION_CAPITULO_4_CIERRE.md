# Cierre del Capítulo 4 — Modernización de dependencias

**Fecha de cierre:** 2026-04-29
**Rama:** `FINAL` (commits `fdee63e` → `f57e302`)
**Hitos cubiertos:** H-4.1, H-4.2, H-4.3 — todos cerrados.

## Resumen

| Hito | Severidad | Hallazgo | Estado | Tag |
| --- | --- | --- | --- | --- |
| H-4.1 | MEDIO | S-05 — esbuild dev-server CORS + cadena vite/vitest | ✅ | `hito-H-4.1-completed` |
| H-4.2 | INFO  | sin proceso recurrente de updates | ✅ | `hito-H-4.2-completed` |
| H-4.3 | INFO  | sin política escrita de CVEs | ✅ | `hito-H-4.3-completed` |

## Estado de seguridad de dependencias

| Lugar | Severidad | Antes (Cap. 0) | Tras Cap. 1 (H-1.2) | Tras Cap. 4 (H-4.1) |
| --- | --- | ---: | ---: | ---: |
| backend  | critical | 0 | 0 | **0** |
| backend  | high     | 0 | 0 | **0** |
| backend  | moderate | 0 | 0 | **0** |
| backend  | low/info | 0 | 0 | **0** |
| frontend | critical | 0 | 0 | **0** |
| frontend | high     | 2 | 0 | **0** |
| frontend | moderate | 5 (→ 10 con drift) | 10 | **0** |
| frontend | low/info | 0 | 0 | **0** |

`npm audit --audit-level=moderate` ahora retorna **exit 0 con 0
vulnerabilidades** en frontend (era exit 0 con 10 moderates) y mantiene 0
en backend. La rama `FINAL` está libre de advisories en cualquier
severidad.

## Proceso recurrente activado

- **Dependabot** en todos los ecosistemas (npm/docker/github-actions/
  terraform/pip), con grupos para reducir ruido (radix-ui, vitest-stack,
  typescript-eslint, sentry) y conventional commits para pasar commitlint.
- **Política de CVEs** documentada con SLA por severidad y proceso de
  excepción con caducidad obligatoria.

## Próximos capítulos

Capítulo 5 — Calidad de código y deuda técnica (H-5.1 a H-5.5).
