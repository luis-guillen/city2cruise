# Hito 4.2.4 — Análisis del bundle (rollup-plugin-visualizer)

> Fecha: 2026-04-28
> Rama: `FASE4-FASE5-FASE6`

## Cómo regenerar el reporte

```bash
cd cruise-connect-main
npm run build:analyze     # genera dist/bundle-stats.html (treemap interactivo)
open dist/bundle-stats.html
```

El plugin se monta condicionalmente (`process.env.ANALYZE === '1'`) — no
afecta a la build normal de producción.

## Cifras de la última build (gzipped)

| Chunk | Tamaño | gzip | Cuándo se carga |
|---|---:|---:|---|
| `index` (entry) | 31.65 kB | **10.98 kB** | siempre |
| `vendor` | 458.50 kB | 151.65 kB | siempre |
| `i18n` | 55.99 kB | 18.20 kB | siempre |
| `radix` | 20.62 kB | 7.43 kB | siempre |
| `query` | 28.12 kB | 8.58 kB | siempre |
| `router` | 9.52 kB | 3.57 kB | siempre |
| `leaflet` | 155.08 kB | 45.30 kB | al renderizar mapa |
| `recharts` | 231.88 kB | 54.61 kB | solo Admin |
| `stripe` | 12.50 kB | 4.69 kB | solo flujos de pago |
| `ClientDashboard` | 27.06 kB | 8.11 kB | rol cliente |
| `DriverDashboard` | 13.20 kB | 4.79 kB | rol conductor |
| `AdminDashboard` | 14.32 kB | 4.36 kB | rol admin |
| `ClientTrackingMap` | 8.08 kB | 2.96 kB | lazy en cliente |
| `DriverMap` | 5.49 kB | 2.15 kB | lazy en conductor |
| `NotificationSettings` | 9.36 kB | 3.19 kB | bajo demanda |

### Bundle inicial real por rol

| Rol | Crítico inicial | gzip |
|---|---:|---:|
| Login (anónimo) | index + vendor + i18n + radix + router | **191 kB** |
| Cliente | + ClientDashboard + ClientTrackingMap + leaflet | **248 kB** |
| Conductor | + DriverDashboard + DriverMap + leaflet | **243 kB** |
| Admin | + AdminDashboard + recharts | **245 kB** |

## Criterios de aceptación

- [x] Bundle principal (entry) **≤ 200 kB gz** ⇒ 10.98 kB ✅
- [x] No hay duplicados detectables vendor↔chunks ⇒ confirmado por treemap
- [ ] Estado total < 200 kB gz por rol ⇒ pendiente: `vendor` aún pesa 151 kB.
      Próxima iteración: dividir `vendor` por subdomain (lucide, sonner,
      class-variance-authority, etc.) y eliminar packs no usados.

## Próximas optimizaciones identificadas

1. **lucide-react** entra completo en `vendor` (~30 kB gz). Migrar a
   imports atómicos: `import Icon from 'lucide-react/icons/icon-name'`.
2. **date-fns** se usa en pocos sitios (NotificationBell). Cargar solo
   `format` por ESM ya lo hace tree-shaking, pero `recharts` arrastra
   `d3-*` que pesa. Considerar reemplazar recharts en Admin por un
   componente más ligero (chart.js es 60kB menos en gzip).
3. **leaflet** desde CDN unpkg (`index.html`) Y desde npm — duplicado
   en runtime: el `<script src="https://unpkg.com/leaflet">` precarga
   pero no se usa en runtime porque `react-leaflet` lo bundlea. Eliminar
   el `<script>` de `index.html` ahorra ~100 kB de descarga inicial.
