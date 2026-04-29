# Hito H-5.4 — gitleaks + pre-commit framework

**Severidad:** INFO
**Owner:** Cualquiera
**Esfuerzo:** ~1 hora
**Estado:** ✅ Cerrado

## Cambios

### `.pre-commit-config.yaml` (nuevo)

Dos repositorios de hooks:

1. `gitleaks/gitleaks@v8.18.4` — escaneo declarativo de secretos en los
   archivos staged.
2. `pre-commit/pre-commit-hooks@v4.6.0` — pack estándar:
   - `detect-private-key` — bloquea PEMs en el commit.
   - `end-of-file-fixer` — fuerza newline al final.
   - `trailing-whitespace` — limpia espacios en blanco al final de línea.
   - `check-yaml` — valida sintaxis YAML.
   - `check-merge-conflict` — bloquea commits con marcas `<<<<<<<`.
   - `check-added-large-files` — bloquea archivos > 2 MB.

Las exclusiones (`*.svg`, `*.lock`, `*.lockb`, `package-lock.json`,
`*.snap`) se aplican a `end-of-file-fixer` y `trailing-whitespace` para
no estropear archivos generados.

### `scripts/install-hooks.sh` (modificado)

Detecta si `pre-commit` (el framework Python) está instalado:

- **Si está**: ejecuta `pre-commit install` (opción preferida).
- **Si no**: instala el fallback bash `scripts/pre-commit-secrets.sh` que
  invoca `scripts/secrets-audit.sh`.

Esto preserva el flujo histórico para devs sin Python pero sube la
calidad para devs con pre-commit.

## Instalación (instrucciones para el equipo)

```bash
# Una sola vez por máquina:
pip install pre-commit          # Linux/macOS: brew install pre-commit
./scripts/install-hooks.sh      # configura el hook en .git/hooks/

# Verificar:
pre-commit run --all-files      # corre todos los hooks sobre todo el repo
```

## Verificación

```
$ python3 -c "import yaml; d=yaml.safe_load(open('.pre-commit-config.yaml')); \
              print('repos:', len(d['repos']))"
repos: 2

$ test -x scripts/install-hooks.sh && echo "install-hooks.sh executable"
install-hooks.sh executable
```

## Por qué dos capas

- El hook bash propio (`scripts/secrets-audit.sh` + `scripts/pre-commit-secrets.sh`)
  ya existía desde el ciclo anterior y bloquea unos cuantos patrones.
  Útil como fallback offline.
- `gitleaks` es la herramienta industry-standard, mantiene un catálogo de
  patrones (>30 proveedores cloud, tokens GH, claves AWS/GCP, JWT, etc.),
  y se actualiza vía Dependabot (configurado en H-4.2).
- El framework `pre-commit` permite que toda la lista de hooks viva en
  `.pre-commit-config.yaml` versionado, sin tener que enviar instructions
  ad-hoc a cada dev.

## Trazabilidad

- Hoja de ruta: capítulo 5, hito H-5.4.
- Tag: `hito-H-5.4-completed`.
