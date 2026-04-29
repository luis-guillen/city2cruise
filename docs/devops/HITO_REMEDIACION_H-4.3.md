# Hito H-4.3 — Política escrita de manejo de CVEs

**Severidad:** INFO
**Owner:** Backend lead (proceso).
**Esfuerzo:** ~30 minutos
**Estado:** ✅ Cerrado

## Cambio

Nuevo `docs/devops/SECURITY_POLICY.md` (111 líneas) que documenta:

1. **Scope** — npm audit, docker scout, ZAP baseline, pip-audit y reportes
   externos.
2. **SLA por severidad**:
   - CRITICAL → bloquea CI y release; fix < 48 h.
   - HIGH → fix < 7 días; bloquea release a los 7 días.
   - MODERATE → triage al sprint; bloquea release a los 30 días.
   - LOW → backlog.
3. **Integración en CI**: `npm audit --audit-level=high` ya falla el job en
   cada PR; ZAP baseline corre nightly y `docker scout cves` corre antes
   del deploy a Fly.
4. **Excepciones**: issue con label `security-debt`, **caducidad obligatoria
   máxima de 90 días**, mitigación temporal documentada, aprobación de
   backend lead/CISO, renovación explícita (nunca por inacción).
5. **Workflow** ASCII con el árbol de decisión.
6. **Documentación obligatoria** de cada fix: commit conventional con
   `fix(security)` + opcional `HITO_REMEDIACION_<id>.md` para advisories
   ≥ MODERATE.
7. **Re-auditoría periódica**: snapshot mensual de npm audit + docker scout
   + ZAP, archivados en `docs/devops/audits/post-remediation/<YYYY-MM>/`.
8. **Contacto**: `security@city2cruise.com` y GitHub Security Advisories
   privadas.

## Trazabilidad

- Hoja de ruta: capítulo 4, hito H-4.3.
- Tag: `hito-H-4.3-completed`.
