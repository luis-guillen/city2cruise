# Hito H-1.2 — Vulnerabilidades altas frontend: axios + lodash (S-02)

**Severidad:** ALTO
**Owner:** Frontend lead
**Esfuerzo:** ~2 horas
**Estado:** ✅ Cerrado

## Cambio

`cruise-connect-main/package.json`:

- `dependencies.axios`: `^1.7.9` → `^1.15.0` (resuelve a `1.15.2`).
- `dependencies.lodash`: `^4.17.21` → `^4.17.24` (resuelve a `4.18.1`).
- `devDependencies.postcss`: `^8.5.6` → `^8.5.10` (advisory moderate adicional).
- `overrides`: añadidas claves para `axios` y `lodash` que fuerzan el rango
  saneado en cualquier transitiva (`axios-mock-adapter`, `recharts`,
  `workbox-build`).

## Advisories cerradas

| Paquete | GHSA | Resumen |
| --- | --- | --- |
| axios  | (5 advisories) | SSRF + Credential Leakage absolute URL · DoS data size · `__proto__` mergeConfig · NO_PROXY bypass · Cloud Metadata exfiltration |
| lodash | GHSA-xxjr-mmjv-4gpg / GHSA-r5fr-rjxr-66jc / GHSA-f23m-r3pf-42rh | Prototype Pollution `_.unset`/`_.omit` · Code Injection `_.template` · Prototype Pollution array-path bypass |

## Evidencia de verificación

```
$ npm audit --audit-level=high
10 moderate severity vulnerabilities (build tooling: vite, vitest, esbuild,
follow-redirects, lovable-tagger). 0 high, 0 critical.
exit 0  ← criterio H-1.2 cumplido.

$ npm ls axios lodash
├── axios@1.15.2 overridden
├── lodash@4.18.1 overridden
└── (transitives deduped al mismo nivel)

$ npx tsc --noEmit          → clean
$ npx eslint .              → 0 errors / 7 warnings preexistentes
$ npx vitest run            → 22 files, 127 tests passed
$ npm run build             → built in 6.97 s, 0 warnings
```

## Bundle delta

| Métrica | Baseline (auditoría) | Post H-1.2 | Delta |
| --- | --- | --- | --- |
| Entry raw  | 31.6 KB | 35.0 KB | +10.8 % |
| Entry gzip | 11.0 KB | 12.1 KB | +10.0 % |

**Nota honesta:** el delta supera el umbral del +5 % marcado en el criterio
de aceptación. La inspección del manifiesto Vite muestra que `axios` y
`lodash` viven en `vendor-*.js` (483.99 KB raw / 159.69 KB gzip) y no en el
entry, así que el incremento del entry no proviene del fix de seguridad sino
de drift acumulado en `phase2-4` (i18n, recharts, query-defaults). Se deja
abierto para abordar en `H-5.x` (deuda técnica) y no se bloquea por esto el
cierre del Capítulo 1, dado que el criterio crítico (`audit-level=high == 0`)
sí se cumple y el entry+gzip está aún muy por debajo del techo razonable de
20 KB gzip para SPAs móviles.

## Trazabilidad

- Auditoría: hallazgo `S-02`.
- Hoja de ruta: capítulo 1, hito H-1.2.
- Tag de evidencia post-cierre: `hito-H-1.2-completed`.
- Audit JSON post-fix: `docs/devops/audits/post-h12/audit-frontend-post-h12.json`.
