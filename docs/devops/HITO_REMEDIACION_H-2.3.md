# Hito H-2.3 — Limpieza de archivos residuales (S-09)

**Severidad:** BAJO
**Owner:** Cualquiera
**Esfuerzo:** ~10 minutos
**Estado:** ✅ Cerrado
**Depende de:** H-1.2 (no perder los overrides ya añadidos en `package.json`).

## Cambios

- Eliminado: `cruise-connect-main/package.json.backup` (archivo de migración).
- `git mv cruise-connect-main/start_all.sh` → `scripts/dev-start-all.sh`.
- `git mv cruise-connect-main/fix_vulnerabilities.sh` → `scripts/audit/fix-frontend-vulns.sh`.
- `chmod +x` reaplicado tras el `mv`.

## Verificación

```
$ ls cruise-connect-main/*.backup cruise-connect-main/start_all.sh \
     cruise-connect-main/fix_vulnerabilities.sh
ls: ... No such file or directory   ← PASS

$ ls scripts/dev-start-all.sh scripts/audit/fix-frontend-vulns.sh
-rwxr-xr-x scripts/audit/fix-frontend-vulns.sh
-rwxr-xr-x scripts/dev-start-all.sh

$ grep -rln 'start_all\.sh\|fix_vulnerabilities\.sh\|package\.json\.backup' . \
    --exclude-dir=node_modules --exclude-dir=.git
./scripts/audit/fix-frontend-vulns.sh   ← self-references al backup temporal interno
```

Las únicas coincidencias residuales son dentro del propio script
`fix-frontend-vulns.sh`, donde crea/restaura un `package.json.backup`
temporal como parte de su flujo de rollback automático. No son rutas a
ficheros externos eliminados.

## Trazabilidad

- Auditoría: hallazgo `S-09`.
- Hoja de ruta: capítulo 2, hito H-2.3.
- Tag: `hito-H-2.3-completed`.
