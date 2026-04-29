# Hito H-8.4 — Tag, release y comunicación

**Severidad:** —
**Owner:** pablete64 (owner del repo)
**Esfuerzo:** ~30 minutos
**Estado:** ✅ Cerrado parcialmente: **merge a `main` + tag `v1.0.0`
ejecutados**. La GitHub Release (notes en la UI) y la comunicación al
stakeholder son la última acción manual del owner.

## Estado del remoto

```
$ git ls-remote origin main v1.0.0
1a02679...  refs/heads/main
2f5c87d...  refs/tags/v1.0.0
```

`main` ha avanzado por **fast-forward** desde `2a41612` hasta `1a02679`
incorporando los 85 commits de `FINAL` (que ya incluían el trabajo de
`phase2-4` + los 30+ commits de remediación). No hubo conflictos.

## Acciones ejecutadas

```bash
git fetch origin main
git checkout -B main origin/main
git merge --ff-only FINAL          # fast-forward limpio
git tag -a v1.0.0 -m "Release v1.0.0 — Post-remediation audit 2026-04-29 …"
git push origin main
git push origin v1.0.0
```

El mensaje del tag captura el resumen ejecutivo (npm audit a 0,
console.log a 0, strict ON, headers, containers no-root, SBOM/Trivy/
cosign, Dependabot, política CVEs, gitleaks, Game Day DR).

## Acciones pendientes del owner

### Crear la GitHub Release

```bash
gh release create v1.0.0 \
    --title "v1.0.0 — Post-remediation audit 2026-04-29" \
    --notes-file docs/devops/HITO_6_6_REMEDIACION_AUDITORIA.md \
    --target main
```

Alternativa por UI: GitHub → Releases → "Draft a new release" →
selecciona el tag `v1.0.0` → pega el contenido de
`HITO_6_6_REMEDIACION_AUDITORIA.md`.

`semantic-release` está activo en `.releaserc.json` para `main`. Si se
quiere que el bot calcule el siguiente bump y genere el `CHANGELOG.md`
en el próximo merge: dejar este `v1.0.0` como base manual y dejar que
semantic-release tome el control desde `v1.0.1`.

### Comunicación a REKER Tech Solutions

Stakeholder: **REKER Tech Solutions**.

Adjuntar al correo (o subir al espacio compartido):

1. `AUDITORIA_TECNICA_INTEGRAL_2026-04-29.pdf` (fuente del programa).
2. `HOJA_DE_RUTA_REMEDIACION_2026-04-29.pdf` (programa ejecutado).
3. `docs/devops/HITO_6_6_REMEDIACION_AUDITORIA.md` (cierre formal con
   evidencia por hallazgo).
4. URL del Release v1.0.0 en GitHub.

### Borrado opcional de la rama `FINAL`

Una vez el stakeholder firma el cierre, la rama `FINAL` ya no aporta
nada extra: todo su contenido está en `main`. Puede eliminarse:

```bash
git push origin :FINAL    # remoto
git branch -D FINAL       # local (en cualquier copia)
```

Mantenerla un trimestre como referencia tampoco hace daño.

## Re-auditoría a 30 días

Programar para **2026-05-29**:

- Re-correr `npm audit` y comparar con
  `docs/devops/audits/post-remediation/2026-04-29/`.
- Re-correr `docker scout cves` sobre las imágenes en GHCR.
- Disparar `zap-baseline.yml` contra staging.
- Ejecutar el primer pentest interno con
  `docs/devops/audits/post-h82/PENTEST_CHECKLIST.md`.
- Archivar resultados en
  `docs/devops/audits/post-remediation/2026-05-29/`.

## Trazabilidad

- Hoja de ruta: capítulo 8, hito H-8.4.
- Tag: `hito-H-8.4-completed`.
- Tag de release: `v1.0.0`.
