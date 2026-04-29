# Hito H-3.3 — Erradicar `any` y activar `noImplicitAny` (S-10, 3/4)

**Severidad:** MEDIO
**Owner:** Frontend
**Esfuerzo:** ~1 jornada (real: <30 min — ver nota).
**Estado:** ✅ Cerrado
**Depende de:** H-3.2.

## Inventario inicial

```
$ grep -rn ': any\\|<any>\\|as any' cruise-connect-main/src \\
    --include='*.ts' --include='*.tsx' | grep -v __tests__
3 ocurrencias, todas en cruise-connect-main/src/test/setup.ts
```

La auditoría estimaba 45 ocurrencias. La realidad de `phase2-4` son 3, y
todas son **en el bootstrap de vitest** (test setup, no producción), ya
**con `// eslint-disable-next-line @typescript-eslint/no-explicit-any`** y
justificación pegada al uso:

1. `expect.extend(matchers as any)` — registro de matchers de `vitest-axe`
   cuyo tipo no es exportado por la librería.
2. `} as any` — mock de `window.matchMedia` (la signatura completa requiere
   muchas props que jsdom no necesita).
3. `(window as any).IntersectionObserver = …` — mock de la API.

El criterio H-3.3 cubre exactamente este caso: "0 ocurrencias de `any` en
src/ (excluyendo tests con justificación)".

## Cambios

### `cruise-connect-main/tsconfig.app.json` y `tsconfig.json` (root)

```jsonc
"noImplicitAny": true,    // antes: false (transición)
```

### `cruise-connect-main/eslint.config.js`

Nueva regla:

```js
"@typescript-eslint/no-explicit-any": "error",
```

A partir de aquí, cualquier nuevo `any` en código de producción rompe el
`Lint (eslint)` step del CI.

## Verificación

```
$ npx tsc --noEmit                    → 0 errores, exit 0.
$ npx eslint .                        → 0 errores, 5 warnings preexistentes
                                        (react-hooks/exhaustive-deps, fuera
                                        de alcance H-3.3).
$ npx vitest run                      → 22 suites, 127/127 passed.
$ npm run build                       → 0 warnings, OK.
```

## Trazabilidad

- Auditoría: hallazgo `S-10` (3/4).
- Hoja de ruta: capítulo 3, hito H-3.3.
- Tag: `hito-H-3.3-completed`.
