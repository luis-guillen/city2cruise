# Hito H-3.2 — Activar `strictNullChecks` (S-10, 2/4)

**Severidad:** MEDIO
**Owner:** Frontend
**Esfuerzo:** ~1 jornada (real: <30 min, ver nota).
**Estado:** ✅ Cerrado

## Cambio

```jsonc
// cruise-connect-main/tsconfig.app.json
"strictNullChecks": true,    // antes: false (transición de H-3.1)

// cruise-connect-main/tsconfig.json (root)
"strictNullChecks": true,    // antes: false
```

## Verificación

```
$ cd cruise-connect-main && npx tsc --noEmit
(sin errores, exit 0)

$ cd cruise-connect-main && npx vitest run
22 files, 127/127 tests passed.

$ cd cruise-connect-main && npm run build
build OK, 0 warnings.
```

## Nota sobre el esfuerzo real

La auditoría estimaba 1 jornada para arreglar los errores que aflorarían
con `strictNullChecks`. En la práctica, la base ya estaba null-safe: el
equipo había usado optional-chaining (`?.`) y type guards en los puntos
críticos (services, hooks, dashboards) durante el ciclo de FASE 2-4. tsc
no reportó ni un error.

Si en el futuro algún drift introduce nullables no tratados, el CI los
cazará al instante (el pipeline ya corre `tsc --noEmit`).

## Trazabilidad

- Auditoría: hallazgo `S-10` (2/4).
- Hoja de ruta: capítulo 3, hito H-3.2.
- Tag: `hito-H-3.2-completed`.
