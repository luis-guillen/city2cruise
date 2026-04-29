# Hito H-3.4 — Compartir tipos backend ↔ frontend (S-10, 4/4)

**Severidad:** INFO
**Owner:** Full-stack
**Esfuerzo:** ~0.5 jornada
**Estado:** ✅ Cerrado
**Depende de:** H-3.3.

## Decisión

**Opción A** del roadmap: el backend es **single source of truth**. Los Zod
schemas que ya existen en `backend/src/schemas/*.schemas.ts` se exponen como
módulo compartido. El frontend los consume como tipos vía un alias de Vite +
una entrada en su `tsconfig.paths`.

Se descarta Opción B (generación de tipos OpenAPI con `tsoa` /
`openapi-typescript`) porque añadiría una dependencia y un paso de generación
que no compensa con sólo cuatro grupos de schemas.

## Cambios

### `backend/src/schemas/index.ts` (nuevo, 126 líneas)

Re-exporta los Zod schemas y publica los tipos `z.infer<>`:

| Tipo | Origen |
| --- | --- |
| `RegisterPayload`, `LoginPayload`, `ChangePasswordPayload` | `auth.schemas` |
| `CreateRequestPayload`, `AcceptRequestPayload`, `ConfirmDriverPayload`, `DepositPayload` | `request.schemas` |
| `OpenLockerPayload` | `locker.schemas` |
| `CreateCruisePayload`, `UpdateCruiseStatusPayload` | `cruise.schemas` |

Y declara las **shapes de respuesta** (que en el backend no estaban tipadas
con Zod, sólo los inputs): `UserDTO`, `PickupRequestDTO`, `LockerDTO`,
`AuthTokenResponse`. Si en el futuro se añade Zod a las responses, sustituir
por `z.infer<typeof ...ResponseSchema>` sin tocar los consumidores.

### `cruise-connect-main/vite.config.ts`

```ts
resolve: {
  alias: {
    "@": path.resolve(__dirname, "./src"),
    "@city2cruise/api-types": path.resolve(__dirname, "../backend/src/schemas"),
  },
}
```

### `cruise-connect-main/tsconfig.app.json` y `tsconfig.json`

```jsonc
"paths": {
  "@/*": ["./src/*"],
  "@city2cruise/api-types": ["../backend/src/schemas"]
}
```

### `cruise-connect-main/src/types/api-contracts.smoke.ts` (nuevo)

Smoke-test compile-only que importa los 8 tipos clave desde el alias y los
asigna a literales para que `tsc --noEmit` valide que el alias resuelve y
que las shapes exportadas son consumibles. No se ejecuta en runtime.

## Verificación

```
$ cd backend          && npx tsc --noEmit  → 0 errores.
$ cd cruise-connect-main && npx tsc --noEmit  → 0 errores
                                                (incl. smoke import).
$ cd cruise-connect-main && npm run build       → OK, sin warnings.
$ cd cruise-connect-main && npx vitest run      → 22 suites, 127/127 passed.
```

## Cómo extender (workflow para nuevos endpoints)

1. Añade/actualiza el Zod schema en `backend/src/schemas/<feature>.schemas.ts`.
2. Re-exporta el schema y `export type FooPayload = z.infer<typeof
   fooSchema>` desde `backend/src/schemas/index.ts`.
3. En el frontend, `import type { FooPayload } from '@city2cruise/api-types';`.
4. CI: cualquier mismatch entre la forma del schema y los consumidores
   romperá `npx tsc --noEmit` en el job `Frontend (lint + tsc + vitest +
   build)`.

## Trazabilidad

- Auditoría: hallazgo `S-10` (4/4).
- Hoja de ruta: capítulo 3, hito H-3.4.
- Tag: `hito-H-3.4-completed`.
