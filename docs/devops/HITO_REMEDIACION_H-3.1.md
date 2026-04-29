# Hito H-3.1 — Activar `strict` (modo transición) (S-10, 1/4)

**Severidad:** MEDIO
**Owner:** Frontend
**Esfuerzo:** ~1 jornada (resultó <30 min porque el código ya cumplía
strictFunctionTypes / strictBindCallApply / useUnknownInCatchVariables).
**Estado:** ✅ Cerrado

## Cambio

`cruise-connect-main/tsconfig.app.json` activa el modo `strict: true` con
**dos flags explícitamente desactivados** para introducirlos en hitos
posteriores y poder verificar cada paso por separado:

```jsonc
"strict": true,
"noImplicitAny": false,         // se activará en H-3.3
"strictNullChecks": false,      // se activará en H-3.2
"strictFunctionTypes": true,    // ya activo
"strictBindCallApply": true,    // ya activo
"alwaysStrict": true,
"useUnknownInCatchVariables": true,
```

## Verificación

```
$ cd cruise-connect-main && npx tsc --noEmit
(sin errores, exit 0)
```

El código ya se compilaba sin errores con `strictFunctionTypes`,
`strictBindCallApply` y `useUnknownInCatchVariables` activos: ningún
módulo pasaba funciones con varianza incorrecta ni accedía a `e.message`
sin estrechar el tipo del catch.

## Trazabilidad

- Auditoría: hallazgo `S-10` (1/4).
- Hoja de ruta: capítulo 3, hito H-3.1.
- Tag: `hito-H-3.1-completed`.
