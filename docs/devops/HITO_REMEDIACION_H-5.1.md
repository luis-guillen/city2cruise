# Hito H-5.1 — SBOM CycloneDX + Trivy en CI (I-02)

**Severidad:** INFO
**Owner:** DevOps
**Esfuerzo:** ~3 horas
**Estado:** ✅ Cerrado (verificación end-to-end queda al primer push a `main`).

## Cambio

Nuevo job `security-scan` en `.github/workflows/cd.yml`, ejecutado tras
`build-push` y obligatorio antes de `deploy-staging` y `deploy-production`.

Para cada imagen (backend y frontend) hace:

1. **SBOM CycloneDX JSON** vía `anchore/sbom-action@v0` sobre el digest
   inmutable que produce `docker/build-push-action`. El SBOM se sube como
   artifact (`sbom-backend.cdx.json` y `sbom-frontend.cdx.json`).
2. **Trivy scan** vía `aquasecurity/trivy-action@0.24.0` con
   `severity: CRITICAL,HIGH`, `exit-code: 1`, `ignore-unfixed: true`. Si
   detecta CVEs HIGH+ con fix disponible, falla el job y bloquea el deploy.
3. **SARIF upload** al tab Security de GitHub vía
   `github/codeql-action/upload-sarif@v3`. Se publica con `if: always()` para
   no perder visibilidad cuando el scan falla.

`build-push` se actualiza:

- `outputs`: ahora expone `backend_digest` y `frontend_digest` además de los
  tags (los digest se usan tanto por `security-scan` como por `sign`).
- Pasos `Build & push backend|frontend`: `id: build_b|build_f` y
  `sbom: true` (el propio buildkit emite un atestado SBOM in-toto adjunto a
  la imagen, complementario al artifact CycloneDX).

## Configuración en cuestión

```yaml
- uses: anchore/sbom-action@v0
  with:
    image: ${{ env.IMAGE_BACKEND }}@${{ needs.build-push.outputs.backend_digest }}
    format: cyclonedx-json
    output-file: sbom-backend.cdx.json
    upload-artifact: true

- uses: aquasecurity/trivy-action@0.24.0
  with:
    image-ref: ${{ env.IMAGE_BACKEND }}@${{ needs.build-push.outputs.backend_digest }}
    format: sarif
    output: trivy-backend.sarif
    severity: CRITICAL,HIGH
    exit-code: '1'
    ignore-unfixed: true
```

## Decisiones explicadas

- **Pin a `aquasecurity/trivy-action@0.24.0`** en vez de `@master` (lo
  recomendado por el roadmap original): queda bajo Dependabot (que
  configuramos en H-4.2), pero no introduce riesgo de breaking change
  silencioso entre runs.
- **Escaneo sobre digest** en vez de tag: garantiza que escaneamos
  exactamente la imagen que se va a publicar; los tags pueden moverse
  entre runs.
- **`ignore-unfixed: true`**: no bloquear deploys por CVEs que no tienen
  patch upstream — esos van al tracker `security-debt` definido en
  `SECURITY_POLICY.md` (H-4.3). Queda visible en el Security tab.
- **SARIF upload con `if: always()`**: aunque el scan falle, las
  vulnerabilidades quedan documentadas en el dashboard de seguridad.

## Verificación

Validación local del YAML:

```
$ python3 -c "import yaml; d=yaml.safe_load(open('.github/workflows/cd.yml')); print(list(d['jobs'].keys()))"
['build-push', 'security-scan', 'sign', 'deploy-staging', 'e2e-staging', 'deploy-production']

$ deploy-staging.needs   = ['build-push', 'security-scan', 'sign']
$ deploy-production.needs = ['build-push', 'security-scan', 'sign', 'deploy-staging']
```

Verificación end-to-end (queda como acción del owner al primer merge a
`main`):

1. Confirmar que aparecen los artifacts `sbom-backend.cdx.json` y
   `sbom-frontend.cdx.json` en la pestaña Actions del run.
2. Confirmar que el tab `Security → Code scanning` muestra entradas
   `trivy-backend` y `trivy-frontend`.
3. Si Trivy hace fallar el deploy: revisar SARIF, abrir issue
   `security-debt` con caducidad si no se puede arreglar inmediatamente.

## Trazabilidad

- Auditoría: hallazgo `I-02`.
- Hoja de ruta: capítulo 5, hito H-5.1.
- Tag: `hito-H-5.1-completed`.
