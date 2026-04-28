# Hito 5.4.4 — Panel "Torre de Control"

> Status: **Done** (2026-04-28)
> Fase: 5.4 — Digital Twin
> Predecesor: 5.4.3 (telemetría real al twin)
> Sucesor: QA final Fase 5

## Objetivo

Vista admin que consume `/state` del Digital Twin cada 5 segundos y
muestra:

- KPIs en tiempo real (lockers libres/ocupados, drivers online,
  drivers disponibles, requests activas, tiempo de match 15m).
- Mapa Leaflet con todos los lockers (color por estado) y drivers
  (color por estado).

## Entregables

| Archivo | Función |
|---|---|
| `cruise-connect-main/src/services/twin.ts` | cliente HTTP del twin (read-only, lee `VITE_TWIN_URL`) |
| `cruise-connect-main/src/pages/ControlTowerPage.tsx` | página `/admin/control-tower` con KPIs + mapa + auto-refresh 5s |
| `cruise-connect-main/src/App.tsx` | route protegida con `allowedRoles={["ADMIN"]}` |
| `cruise-connect-main/src/pages/AdminDashboard.tsx` | enlace "Torre" en navbar admin |
| `cruise-connect-main/src/__tests__/twin-client.test.ts` | 3 tests con `vi.stubEnv` |
| `envs/{staging,production}.env.example` | añadido `VITE_TWIN_URL` |

## UI

```
┌─ Torre de Control ──────────────────────── env: production · 14:32:05 · 5s ─┐
│                                                                             │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌────────────┐         │
│ │  4   │ │  1   │ │  0   │ │  3   │ │  2   │ │  5   │ │   28.5s    │         │
│ │ /5   │ │ /5   │ │ /5   │ │ /3   │ │ /3   │ │      │ │            │         │
│ │libres│ │ocup. │ │fueras│ │ondrv │ │availb│ │activ │ │ match 15m  │         │
│ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └────────────┘         │
│                                                                             │
│ ┌─────────────────────────────────────────────────────────────────┐         │
│ │                                                                 │         │
│ │   [mapa Leaflet con CircleMarkers de lockers + drivers]         │         │
│ │   verde=free amarillo=reserved rojo=occupied gris=out_of_svc    │         │
│ │   azul=available naranja=busy morado=breaking gris=offline      │         │
│ │                                                                 │         │
│ └─────────────────────────────────────────────────────────────────┘         │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Decisiones técnicas

1. **Lazy-loaded** (`React.lazy`) — la página vive en `/admin/...`,
   no la carga ningún usuario que no sea ADMIN.
2. **Polling 5s vs WebSocket** — para Hito 5.4.4 polling HTTP es
   suficiente (volumen <100 actualizaciones/min) y simplifica.
   WebSocket dedicado se queda como mejora futura si admins se quejan
   de "lag percibido" >5s.
3. **Read-only** — la Torre nunca modifica estado del twin.
4. **Manejo de error visible** — si el twin no responde, banner rojo
   "⚠ Twin no responde: <error>" pero la página sigue mostrando los
   últimos KPIs conocidos (no se vacía).
5. **Sin SDK Leaflet adicional** — usa `react-leaflet` que ya está
   en dependencies (lo usa `DriverMap` y `ClientTrackingMap`).

## Verificación

- tsc --noEmit limpio.
- 0 errores de lint (7 warnings preexistentes en otros archivos).
- 13 test files / 82 tests PASS (incluye los 3 nuevos del cliente twin).

## Próximo

QA final de Fase 5: ejecutar suite completa, validar Terraform de
nuevo, verificar dashboards, smoke test E2E si Fly está accesible,
y push final.
