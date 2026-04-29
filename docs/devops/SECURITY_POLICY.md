# Política de manejo de CVEs y advisories

**Owner del proceso:** Backend lead.
**Última revisión:** 2026-04-29 (Hito H-4.3 del programa de remediación).
**Audiencia:** equipo de ingeniería, on-call y reviewers de PR.

## 1. Scope

Esta política aplica a:

- Advisories detectados por `npm audit` (backend + frontend).
- Vulnerabilidades en imágenes base reportadas por `docker scout cves`.
- Hallazgos del workflow `zap-baseline.yml` sobre staging.
- CVEs en imágenes Python (digital_twin, rl_service) detectados por
  `pip-audit` o `safety`.
- Reportes externos al `security@` o vía GitHub Security Advisories.

## 2. Niveles de severidad y SLA

| Severidad | Acción inmediata | SLA de fix | Política de release |
| --- | --- | --- | --- |
| **CRITICAL** | Bloquea CI y bloquea cualquier release pendiente. Crear incidente de severidad equivalente. | 24-48 h. | No se mergea ni despliega nada hasta cerrar el CVE o aceptar excepción documentada por el CISO/lead. |
| **HIGH** | PR de fix abierto en menos de 48 h. CI sigue verde mientras tanto. | **7 días naturales**. | Si transcurridos 7 días no hay fix mergeado, se bloquean releases hasta resolver. |
| **MODERATE** | Triage en el siguiente sprint. | **30 días naturales**. | No bloquea releases; se trackea como deuda activa. |
| **LOW** | Triage informativo. | Próximo sprint disponible. | No bloquea nada; se cierra cuando convenga junto a otras deudas. |
| **INFO** | Sólo registro. | Sin SLA. | — |

## 3. Mecánica del CI

- `npm audit --audit-level=high` se ejecuta en cada PR (job `Frontend
  (lint + tsc + vitest + build)` y job `Backend`). Cualquier hallazgo high+
  rompe el job y bloquea el merge.
- `zap-baseline.yml` corre nightly contra staging. Hallazgo high+ abre
  issue automático con label `security`.
- `docker scout cves` se ejecuta en `cd-frontend.yml` y `cd.yml` antes del
  push a Fly. Hallazgo high+ aborta el deploy.

## 4. Excepciones

Las excepciones existen — no todo se puede arreglar inmediatamente. La regla:

1. Abrir un **issue de GitHub** con label `security-debt`.
2. **Cuerpo obligatorio del issue**:
   - CVE / GHSA / advisor ID.
   - Severidad y razón de la excepción (no patch upstream, breaking
     change con coste alto, etc.).
   - **Caducidad**: fecha máxima de revisión (no se permiten excepciones
     "indefinidas"; máx 90 días).
   - Mitigación temporal en producción (WAF rule, feature flag, RBAC,
     restricción de input, etc.).
   - Owner del issue.
3. **Aprobación**: backend lead o CISO. La aprobación se registra como
   comentario en el issue.
4. **Renovación**: si la caducidad llega y el CVE sigue abierto, el issue se
   re-revisa explícitamente (no se renueva por inacción). Si no se renueva,
   el bloqueo se restaura automáticamente al expirar.

Ejemplos legítimos:

- Patch upstream aún no liberado y la dependencia es transitiva sin
  alternativa.
- Breaking change masivo (ej: vite 5 → 6) que requiere coordinación de
  varios PRs.
- Vector explotable solo en `dev` con autenticación local (ej: `esbuild`
  dev-server con CORS).

## 5. Workflow operativo

```
┌─────────────────────────────────────────────────────────────────────┐
│  npm audit --audit-level=high  /  Dependabot PR  /  ZAP nightly     │
│                          ↓                                          │
│   ¿severidad?                                                       │
│      ├─ critical → bloquear releases + incidente + fix < 48h        │
│      ├─ high     → PR fix < 48h; bloquea release a los 7 días       │
│      ├─ moderate → triage al sprint; bloquea release a los 30 días  │
│      └─ low      → backlog                                          │
│                          ↓                                          │
│   ¿hay fix viable?                                                  │
│      ├─ sí  → npm install + override + tests + docs/devops/HITO_*.md│
│      └─ no  → issue label security-debt + caducidad < 90d + owner    │
└─────────────────────────────────────────────────────────────────────┘
```

## 6. Documentación obligatoria de cada fix

Cada CVE cerrado se acompaña de un commit con conventional message:

```
fix(security): close <package> <severity> advisory (<H-X.Y>, <S-NN>)

<descripción del cambio + referencias GHSA + verificación>
Closes #H-X.Y
```

Si el alcance lo justifica (≥ MODERATE), también se crea
`docs/devops/HITO_REMEDIACION_<id>.md` con evidencia (`npm audit` antes/
después, `docker scout cves` antes/después, etc.).

## 7. Re-auditoría periódica

- Cada 30 días: re-ejecutar `npm audit` + `docker scout cves` + `zap-
  baseline` y comparar con el snapshot anterior. Resultados archivados en
  `docs/devops/audits/post-remediation/<YYYY-MM>/`.
- Cada 90 días: revisar issues con label `security-debt` y caducidades.

## 8. Contacto

- Reporte de vulnerabilidades responsables: `security@city2cruise.com`.
- En GitHub: usar Security Advisory privado del repositorio.
- No reportar CVEs como issue público.
