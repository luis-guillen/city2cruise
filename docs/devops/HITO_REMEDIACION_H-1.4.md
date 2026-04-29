# Hito H-1.4 — Cabeceras de seguridad en Nginx (S-04)

**Severidad:** MEDIO
**Owner:** Frontend / DevOps
**Esfuerzo:** ~1 hora
**Estado:** ✅ Cerrado (verificación final con `securityheaders.com` queda como
acción del owner sobre staging real, mismo gap que el Cap. 0.3).
**Depende de:** H-1.3 (cambio de puerto 8080).

## Cambio

Se añaden 7 cabeceras de seguridad globales en `cruise-connect-main/nginx.conf`,
todas con el modificador `always` para que se emitan también en respuestas 4xx
y 5xx.

| Cabecera | Valor |
| --- | --- |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(self), payment=(self)` |
| `Cross-Origin-Opener-Policy` | `same-origin-allow-popups` (compatible con popup 3DS de Stripe) |
| `Content-Security-Policy` | ver `nginx.conf` — política completa con whitelist Stripe / OSM tiles / Sentry |

### CSP detallada

```
default-src 'self';
script-src  'self' 'wasm-unsafe-eval' https://js.stripe.com https://browser.sentry-cdn.com;
style-src   'self' 'unsafe-inline';
img-src     'self' data: blob: https://*.tile.openstreetmap.org https://tile.openstreetmap.org;
font-src    'self' data:;
connect-src 'self' https://api.stripe.com wss: ws: https://*.sentry.io;
frame-src   https://js.stripe.com https://hooks.stripe.com;
worker-src  'self' blob:;
manifest-src 'self';
object-src  'none';
base-uri    'self';
form-action 'self';
```

Notas:

- `'unsafe-inline'` se mantiene en `style-src` porque Tailwind/shadcn-ui
  inyectan estilos inline; sin esto la SPA no renderiza.
- `'wasm-unsafe-eval'` lo requiere `recharts` (módulo `numeric-1.2.6`).
- Se añade `https://browser.sentry-cdn.com` a `script-src` porque el SDK de
  Sentry puede cargar dinámicamente módulos desde su CDN cuando se usa el
  *loader script* en vez del `import`.
- `connect-src` usa `'self'` porque el frontend habla con el backend a través
  del propio Nginx (mismo origen). `wss:`/`ws:` cubre Socket.IO.

## Verificación

| Comprobación | Resultado |
| --- | --- |
| `crossplane.parse(nginx.conf wrapped in http{})` | OK — sin errores. |
| Balanceo de `{}` | 6 abiertos / 6 cerrados — OK. |
| `grep -c '^    add_header '` | 7 — coincide con el nº objetivo. |
| `add_header always` en cada cabecera | sí — verificado por inspección. |

## Acciones del owner localmente / contra staging real

```bash
# Build + run via docker compose (también verifica H-1.3)
docker compose up -d
sleep 60

# Cabeceras en respuesta SPA
curl -sI http://localhost/ \
    | grep -iE '^(strict-transport|content-security|x-frame|x-content|referrer|permissions|cross-origin)' \
    | tee docs/devops/audits/post-h14/headers-localhost.txt

# Cabeceras en respuesta API (deberían heredar las del server, mismo origen)
curl -sI http://localhost/api/health \
    | grep -iE '^(strict-transport|content-security|x-frame|x-content|referrer|permissions)'

# Validación externa contra staging real
# https://securityheaders.com/?q=staging.city2cruise.es&hide=on&followRedirects=on
# Esperado: nota A (mínimo A-).
```

Pegar los outputs en `docs/devops/audits/post-h14/` y commit
`docs(audit): add H-1.4 security headers evidence`.

## Trazabilidad

- Auditoría: hallazgo `S-04`.
- Hoja de ruta: capítulo 1, hito H-1.4.
- Tag: `hito-H-1.4-completed`.
