# Hito H-4.2 — Activar Dependabot

**Severidad:** INFO
**Owner:** DevOps
**Esfuerzo:** ~30 minutos
**Estado:** ✅ Cerrado

## Cambio

Nuevo archivo `.github/dependabot.yml` (130 líneas) con 10 entradas de
ecosistema cubriendo todas las rutas del monorepo:

| Ecosistema | Directorio | Frecuencia | Límite PRs |
| --- | --- | --- | --- |
| npm | `/cruise-connect-main` | semanal (lunes) | 5 |
| npm | `/backend` | semanal (lunes) | 5 |
| docker | `/backend` | mensual | (default 5) |
| docker | `/cruise-connect-main` | mensual | (default 5) |
| docker | `/digital_twin` | mensual | (default 5) |
| github-actions | `/` | mensual | (default 5) |
| terraform | `/terraform/flyneonupstash` | mensual | (default 5) |
| terraform | `/terraform/aws` | mensual | (default 5) |
| pip | `/digital_twin` | semanal (lunes) | 5 |
| pip | `/rl_service` | semanal (lunes) | 5 |

## Mejoras aplicadas sobre la plantilla del roadmap

- **Conventional commits** — `commit-message.prefix: "chore(deps)"` y
  `include: "scope"` para que cada PR pase el job `commitlint` del CI.
- **Grupos** en npm para reducir ruido:
  - `radix-ui`: agrupa todos los `@radix-ui/*`.
  - `vitest-stack`: agrupa `vitest`, `@vitest/*`, `vite`, `vite-*`, `@vitejs/*`.
  - `typescript-eslint`: agrupa el ecosistema de eslint.
  - Backend agrupa `@sentry/*` y el ecosistema de eslint.
- **Etiquetas** para filtrar en el board (`deps`, `frontend|backend`,
  `docker`, `terraform`, `python`, `ci`, etc.).
- **`versioning-strategy: auto`** — Dependabot decide entre bump en
  `package.json` o sólo en `package-lock.json` según el rango actual.

## Verificación

```
$ python3 -c "import yaml; d=yaml.safe_load(open('.github/dependabot.yml')); print(d['version'], len(d['updates']))"
2 10
```

## Próxima señal de funcionamiento

Una vez mergeado a `main` (o a `FINAL` con la app habilitada en Settings →
Code security → Dependabot version updates), se verá:

- Etiquetas `deps`, `frontend`, `backend`, etc. creadas automáticamente.
- En menos de **7 días** debe llegar el primer PR semanal.
- El primer pase mensual de `docker` y `terraform` aparecerá el día 1 del
  siguiente mes.

## Trazabilidad

- Hoja de ruta: capítulo 4, hito H-4.2.
- Tag: `hito-H-4.2-completed`.
