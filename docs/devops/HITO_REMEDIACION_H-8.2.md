# Hito H-8.2 — Pentest interno (lógica de negocio)

**Severidad:** INFO
**Owner:** Backend / security
**Esfuerzo:** ~1 jornada
**Estado:** ✅ Code-complete (checklist y procedimiento). **La ejecución
y la firma de evidencia se difieren al owner**, igual que H-7.x.

## Cambio

`docs/devops/audits/post-h82/PENTEST_CHECKLIST.md` (114 líneas) cubre los
6 vectores que la auditoría señala como fuera de alcance de las
herramientas automáticas:

1. **Bypass de RBAC** — DRIVER → endpoints CLIENT/ADMIN, MERCHANT →
   endpoints de cliente del locker, manipulación de claim `role`.
2. **Session-fixation con refresh-token** — rotación correcta y
   detección de reuse.
3. **Replay de webhooks Stripe** — idempotencia por `id`, validación
   de `Stripe-Signature`.
4. **IDOR en `/api/requests/:id`** — GET/PATCH/DELETE con id ajeno y
   con id numérico no asignado.
5. **Re-uso de OTP de handshake** — código consumido sólo una vez,
   caducidad, brute-force protegido por rate-limiter.
6. **GPS spoofing** — bordes de `GpsValidationService`: null island,
   velocidad imposible, clock-drift, fuera de viewbox, valores NaN/Inf.

Cada caso tiene una matriz `Sub-caso | Esperado | Resultado` para
firmar tras la prueba.

## Pre-flight

- 3 cuentas de prueba (`pentest-client@`, `pentest-driver@`,
  `pentest-admin@`).
- Burp Suite o `mitmproxy` instalado.
- Aviso en `#city2cruise-oncall` del tráfico anómalo a generar.

## Severidad y umbrales

| Resultado | Acción |
| --- | --- |
| 0 fallos | PASS, firmar el hito. |
| 1+ fallos critical/high | Release bloqueada, issue P1. |
| 1+ fallos moderate | `security-debt` ≤ 30 días. |

## Trazabilidad

- Hoja de ruta: capítulo 8, hito H-8.2.
- Tag: `hito-H-8.2-completed` (la **evidencia firmada** llega como
  `docs(audit): add H-8.2 pentest evidence` tras la corrida real).
