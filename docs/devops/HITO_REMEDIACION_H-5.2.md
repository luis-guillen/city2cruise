# Hito H-5.2 — Firma de imágenes con cosign (sigstore) (I-02)

**Severidad:** INFO
**Owner:** DevOps
**Esfuerzo:** ~3 horas
**Estado:** ✅ Cerrado (admisión opcional en Fly queda como acción del
owner; ver más abajo).

## Cambio

Nuevo job `sign` en `.github/workflows/cd.yml`, ejecutado tras `build-push`
en paralelo con `security-scan` y obligatorio antes de `deploy-staging` y
`deploy-production`.

Pasos:

1. `sigstore/cosign-installer@v3` — descarga `cosign`.
2. Login a GHCR (necesario para que `cosign sign` pueda anexar la firma a
   la imagen — la firma se publica como un objeto OCI hermano).
3. **Sign keyless OIDC** sobre el digest:
   ```
   COSIGN_EXPERIMENTAL=true cosign sign --yes \
       ghcr.io/<owner>/city2cruise-backend@<digest>
   ```
   El job tiene `permissions.id-token: write` para que cosign pueda
   solicitar el OIDC token de GitHub, derivar la identidad
   `https://github.com/<owner>/<repo>/.github/workflows/cd.yml@<ref>` y
   firmarla con un certificado emitido por Fulcio.
4. **Verify smoke** sobre el mismo digest, confirmando que la firma
   coincide con la identidad esperada:
   ```
   cosign verify \
       --certificate-identity-regexp "https://github.com/<owner>/<repo>/.+" \
       --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
       ghcr.io/<owner>/city2cruise-backend@<digest>
   ```

Las dos imágenes (backend y frontend) se firman y verifican en el mismo
job para mantener todo en un solo lugar y reducir el coste de identidad
del runner.

## Por qué keyless

- No hay material clave que rotar/revocar; el certificado lo emite Fulcio
  por petición y caduca a los 10 minutos.
- La identidad firmante queda anclada al `repository + workflow + ref`, lo
  cual es exactamente lo que queremos verificar al admitir la imagen.
- La transparencia se publica en Rekor (log público) por defecto.

## Cómo verificar manualmente desde tu máquina

```bash
brew install cosign

cosign verify \
    --certificate-identity-regexp "https://github.com/pablete64/APP_TRASNPORTE_LOCKERS_BARCELONA/.+" \
    --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
    ghcr.io/pablete64/city2cruise-backend@sha256:<digest>
```

Si la firma es válida, devuelve la lista de tlog entries. Si no lo es,
sale con código distinto de 0.

## Admisión sólo de imágenes firmadas (acción del owner)

Fly.io no tiene un policy controller nativo, pero puede simularse con un
**init-container** o un step previo a `flyctl deploy` que haga
`cosign verify` y aborte si falla. Recomendación práctica:

1. Añadir un step antes de `flyctl deploy` en `deploy-staging` y
   `deploy-production`:
   ```yaml
   - name: Pre-deploy verify (admission)
     run: |
       cosign verify \
         --certificate-identity-regexp "https://github.com/${{ github.repository }}/.+" \
         --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
         ${{ env.IMAGE_BACKEND }}@${{ needs.build-push.outputs.backend_digest }}
   ```
   Esta verificación ya se hace en el job `sign` (smoke), pero repetirla en
   el deploy garantiza que **alguien no haya promovido manualmente otra
   imagen** entre la firma y el deploy.

2. Si en el futuro se mueve a Kubernetes/OpenShift, usar
   [Kyverno](https://kyverno.io) o
   [Sigstore Policy Controller](https://docs.sigstore.dev/policy-controller/overview/)
   con la misma identidad como admission rule.

Esa segunda capa NO se añade en este hito (se considera fuera de alcance:
sobre Fly no hay admission controller real). Queda documentada como TODO
para H-5.2-extension cuando se mueva a Kubernetes.

## Verificación

```
$ python3 -c "import yaml; d=yaml.safe_load(open('.github/workflows/cd.yml')); j=d['jobs']['sign']; print('steps:', len(j['steps']), 'permissions:', j['permissions'])"
steps: 6 permissions: {'contents': 'read', 'packages': 'write', 'id-token': 'write'}
```

End-to-end queda como acción del owner: tras el primer push a `main`, ver
en Actions el log de `sign`/Verify backend signature; opcionalmente
ejecutar `cosign verify` desde local para auditar.

## Trazabilidad

- Auditoría: hallazgo `I-02`.
- Hoja de ruta: capítulo 5, hito H-5.2.
- Tag: `hito-H-5.2-completed`.
