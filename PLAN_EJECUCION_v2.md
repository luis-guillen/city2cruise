# PLAN DE EJECUCIÓN v2 — Correcciones Residuales City2Cruise

**Fecha:** 24 de marzo de 2026
**Basado en:** RE-AUDITORÍA TÉCNICA v2
**Ejecutor:** Claude Opus 4.6 (paso a paso)
**Total pasos:** 22
**Tiempo estimado total:** 12-16 horas

---

## Notas para el ejecutor

- Cada paso es **autocontenido**: incluye contexto, archivos a tocar, código exacto y verificación.
- Los pasos están ordenados por **dependencia y prioridad** (no ejecutar fuera de orden salvo que se indique).
- Tras cada paso, ejecutar el comando de verificación antes de continuar.
- Los pasos marcados con 🔀 pueden ejecutarse en paralelo con otros del mismo grupo.
- La raíz del proyecto es la carpeta que contiene `backend/` y `cruise-connect-main/`.

---

## FASE A — Correcciones rápidas (Pasos 1-6)

**Tiempo estimado:** 1-2 horas
**Dependencias:** Ninguna entre sí — todos los pasos de esta fase son independientes 🔀

---

### Paso 1 — Añadir tests frontend al CI pipeline

**Problema:** El job `frontend-build` en GitHub Actions solo ejecuta `npm ci` + `npm run build`. Los 4 archivos de test del frontend nunca se ejecutan en CI.

**Archivo:** `.github/workflows/ci.yml`

**Instrucciones:**
1. Abrir `.github/workflows/ci.yml`
2. En el job `frontend-build`, DESPUÉS del step `npm run build`, añadir un step nuevo:

```yaml
      - name: Run frontend tests
        working-directory: ./cruise-connect-main
        run: npx vitest run
```

3. El job completo debería quedar con los steps: checkout → setup node → npm ci → npm run build → npx vitest run

**Verificación:**
```bash
cat .github/workflows/ci.yml | grep -A 5 "vitest"
```
Debe mostrar el nuevo step con `npx vitest run`.

---

### Paso 2 — Fix DriverMap label "Grande" para paquetes LARGE

**Problema:** `DriverMap.tsx` usa un ternario simple que solo muestra "Pequeño" y "Mediano". Los paquetes LARGE se muestran como "Mediano".

**Archivo:** `cruise-connect-main/src/components/DriverMap.tsx`

**Instrucciones:**
1. Buscar la línea que asigna el label de tamaño (ternaria con `packageSize`).
2. Reemplazar la lógica ternaria:

**ANTES (lógica actual):**
```typescript
req.packageSize === 'SMALL' ? 'Pequeño' : 'Mediano'
```

**DESPUÉS:**
```typescript
req.packageSize === 'SMALL' ? 'Pequeño' : req.packageSize === 'MEDIUM' ? 'Mediano' : 'Grande'
```

**Verificación:**
```bash
grep -n "Grande" cruise-connect-main/src/components/DriverMap.tsx
```
Debe encontrar la línea con el nuevo label.

---

### Paso 3 — Validar JWT_SECRET obligatorio en producción

**Problema:** `config/env.ts` tiene fallback `'secret_para_desarrollo_cambiar_en_produccion'` para JWT_SECRET. Si se despliega sin configurar la variable, se usa un secreto predecible.

**Archivo:** `backend/src/config/env.ts`

**Instrucciones:**
1. Localizar la línea: `jwtSecret: process.env.JWT_SECRET || 'secret_para_desarrollo_cambiar_en_produccion'`
2. Reemplazar por:

```typescript
jwtSecret: (() => {
  const secret = process.env.JWT_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('FATAL: JWT_SECRET es obligatorio en producción. Define la variable de entorno.');
  }
  return secret || 'secret_para_desarrollo_cambiar_en_produccion';
})(),
```

**Verificación:**
```bash
grep -A 5 "jwtSecret" backend/src/config/env.ts
```
Debe mostrar la validación con `throw new Error` para producción.

---

### Paso 4 — Mejorar validación Zod en schemas de códigos

**Problema:** `handshakeCode` acepta cualquier string de 4 caracteres (no solo dígitos). `lockerCode` solo valida `min(1)`, no formato de 6 dígitos.

**Archivos:**
- `backend/src/schemas/request.schemas.ts`
- `backend/src/schemas/locker.schemas.ts`

**Instrucciones:**

**Archivo 1 — request.schemas.ts:**
1. Buscar: `handshakeCode: z.string().length(4, 'El código debe tener exactamente 4 dígitos')`
2. Reemplazar por:
```typescript
handshakeCode: z.string().regex(/^\d{4}$/, 'El código debe ser exactamente 4 dígitos numéricos')
```

**Archivo 2 — locker.schemas.ts:**
1. Buscar: `lockerCode: z.string().min(1, 'El código del locker es obligatorio')`
2. Reemplazar por:
```typescript
lockerCode: z.string().regex(/^\d{6}$/, 'El código del locker debe ser exactamente 6 dígitos numéricos')
```

**Verificación:**
```bash
grep -n "regex" backend/src/schemas/request.schemas.ts backend/src/schemas/locker.schemas.ts
```
Debe mostrar los nuevos regex patterns.

**⚠️ IMPORTANTE:** Tras este cambio, verificar que los tests existentes (`handshake-ratelimit.test.ts`) envían códigos de solo dígitos. Si algún test usa letras, actualizar ese test.

---

### Paso 5 — Migrar console.log a logger en GeoDispatchService

**Problema:** `GeoDispatchService.ts` usa `console.log()` extensivamente en lugar del logger pino centralizado.

**Archivo:** `backend/src/services/GeoDispatchService.ts`

**Instrucciones:**
1. Si NO existe ya un import de logger, añadir al inicio del archivo:
```typescript
import logger from '../utils/logger';
```
2. Reemplazar TODAS las ocurrencias:
   - `console.log(...)` → `logger.info(...)`
   - `console.error(...)` → `logger.error(...)`
   - `console.warn(...)` → `logger.warn(...)`

**Nota sobre formato:** Pino usa formato diferente a console.log. Si hay interpolación como `console.log('Fase 1: ${count} conductores')`, convertir a:
```typescript
logger.info({ count, requestId }, 'Fase 1 de cascada completada');
```

**Verificación:**
```bash
grep -n "console\." backend/src/services/GeoDispatchService.ts
```
Debe retornar 0 resultados.

```bash
grep -n "logger\." backend/src/services/GeoDispatchService.ts
```
Debe retornar múltiples resultados.

---

### Paso 6 — Eliminar test legacy example.test.ts

**Problema:** `src/test/example.test.ts` contiene un test trivial (`expect(true).toBe(true)`) que es código legacy. El test de formateo de packageSize que contiene ya está cubierto por los test de componentes.

**Archivo:** `cruise-connect-main/src/test/example.test.ts`

**Instrucciones:**
1. Verificar que el test de packageSize está cubierto en otro lugar:
```bash
grep -r "packageSize\|package_size" cruise-connect-main/src/__tests__/ cruise-connect-main/src/**/*.test.*
```
2. Si está cubierto, eliminar el archivo:
```bash
rm cruise-connect-main/src/test/example.test.ts
```
3. Si el directorio `cruise-connect-main/src/test/` queda vacío, eliminarlo:
```bash
rmdir cruise-connect-main/src/test/ 2>/dev/null || true
```

**Verificación:**
```bash
ls cruise-connect-main/src/test/example.test.ts 2>&1
```
Debe reportar "No such file or directory".

```bash
cd cruise-connect-main && npx vitest run 2>&1 | tail -5
```
Todos los tests deben seguir pasando.

---

## FASE B — Campos faltantes del schema (Pasos 7-11)

**Tiempo estimado:** 2-3 horas
**Dependencias:** Paso 7 es prerequisito de pasos 8-10. Paso 11 es independiente.

---

### Paso 7 — Crear tabla cruise_manifest y ampliar schema

**Problema:** Faltan tabla `cruise_manifest` y varios campos requeridos por la memoria técnica en tablas existentes.

**Archivo:** `backend/src/db/schema.sql.ts`

**Instrucciones:**

**7a — Añadir tabla `cruise_manifest`** (después de la tabla `merchants`):

```sql
CREATE TABLE IF NOT EXISTS cruise_manifest (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vessel_name TEXT NOT NULL,
  imo_number TEXT,
  scheduled_arrival TEXT NOT NULL,
  all_aboard TEXT NOT NULL,
  departure TEXT NOT NULL,
  terminal TEXT,
  estimated_passengers INTEGER DEFAULT 0,
  status TEXT CHECK(status IN ('scheduled','docked','departed','cancelled')) DEFAULT 'scheduled',
  created_at TEXT DEFAULT (datetime('now'))
);
```

**7b — Añadir campos a tabla `users`:**

Modificar el CREATE TABLE de users para incluir estos campos antes de `created_at`:

```sql
vehicle_identifier TEXT,
accessibility_profile TEXT CHECK(accessibility_profile IN ('standard','pmr','age_advanced')) DEFAULT 'standard',
device_identifier TEXT,
```

**7c — Añadir campos a tabla `lockers`:**

Modificar el CREATE TABLE de lockers para incluir:

```sql
hub_id TEXT DEFAULT 'BCN-MAIN',
last_sync_at TEXT,
```

**7d — Añadir campo `merchant_id` a `pickup_requests`:**

Añadir a pickup_requests:

```sql
merchant_id INTEGER REFERENCES merchants(id),
```

**⚠️ NOTA SQLite:** SQLite no soporta ALTER TABLE ADD COLUMN con REFERENCES de forma nativa. Estos campos se añaden al CREATE TABLE. Si hay datos existentes, habrá que recrear las tablas o gestionarlo con IF NOT EXISTS + migration scripts. Para el MVP, modificar directamente los CREATE TABLE statements es aceptable ya que el schema se recrea al inicio.

**Verificación:**
```bash
grep -n "cruise_manifest\|vehicle_identifier\|accessibility_profile\|device_identifier\|hub_id\|last_sync_at\|merchant_id" backend/src/db/schema.sql.ts
```
Debe encontrar todos los nuevos campos y la tabla.

---

### Paso 8 — Actualizar registro de usuarios con nuevos campos

**Problema:** El registro de usuarios no recoge los campos `vehicle_identifier`, `accessibility_profile`, `device_identifier` recién añadidos al schema.

**Archivos:**
- `backend/src/routes/auth.ts` — registro
- `backend/src/schemas/auth.schemas.ts` — schema de validación (si existe)

**Instrucciones:**

1. En el schema Zod de registro, añadir campos opcionales:
```typescript
vehicle_identifier: z.string().optional(),
accessibility_profile: z.enum(['standard', 'pmr', 'age_advanced']).default('standard'),
device_identifier: z.string().optional(),
```

2. En la ruta de registro, incluir estos campos en el INSERT:
```sql
INSERT INTO users (name, email, password_hash, role, vehicle_identifier, accessibility_profile, device_identifier)
VALUES (?, ?, ?, ?, ?, ?, ?)
```

3. Solo `vehicle_identifier` es relevante para DRIVER. `accessibility_profile` para CLIENT. `device_identifier` para todos.

**Verificación:**
```bash
grep -n "vehicle_identifier\|accessibility_profile\|device_identifier" backend/src/routes/auth.ts backend/src/schemas/auth.schemas.ts
```
Debe encontrar los nuevos campos.

---

### Paso 9 — Vincular pickup_requests con merchants

**Problema:** No hay forma de asociar una solicitud de pickup con un merchant. El campo `merchant_id` se añadió al schema en el paso 7 pero no se usa en el servicio.

**Archivos:**
- `backend/src/services/RequestService.ts`
- `backend/src/schemas/request.schemas.ts`

**Instrucciones:**

1. En el schema de creación de request, añadir campo opcional:
```typescript
merchantId: z.number().int().positive().optional(),
```

2. En `RequestService.createRequest()`, incluir `merchant_id` en el INSERT:
   - Extraer `merchantId` del body
   - Añadir al INSERT INTO pickup_requests: `merchant_id`
   - Si se proporciona merchantId, validar que existe en tabla merchants con status 'active'

**Verificación:**
```bash
grep -n "merchant_id\|merchantId" backend/src/services/RequestService.ts backend/src/schemas/request.schemas.ts
```
Debe encontrar referencias al nuevo campo.

---

### Paso 10 — Endpoints CRUD para cruise_manifest

**Problema:** La tabla `cruise_manifest` existe (tras paso 7) pero no hay endpoints para gestionarla.

**Archivos a crear:**
- `backend/src/routes/cruises.ts`
- `backend/src/schemas/cruise.schemas.ts`

**Instrucciones:**

**10a — Crear `backend/src/schemas/cruise.schemas.ts`:**
```typescript
import { z } from 'zod';

export const createCruiseSchema = z.object({
  vessel_name: z.string().min(1, 'Nombre del buque obligatorio'),
  imo_number: z.string().optional(),
  scheduled_arrival: z.string().datetime({ message: 'Formato ISO 8601 requerido' }),
  all_aboard: z.string().datetime({ message: 'Formato ISO 8601 requerido' }),
  departure: z.string().datetime({ message: 'Formato ISO 8601 requerido' }),
  terminal: z.string().optional(),
  estimated_passengers: z.number().int().min(0).default(0),
});

export const updateCruiseStatusSchema = z.object({
  status: z.enum(['scheduled', 'docked', 'departed', 'cancelled']),
});
```

**10b — Crear `backend/src/routes/cruises.ts`:**
- GET `/` — Listar cruceros (filtro por status, paginación) — requiere auth ADMIN
- GET `/:id` — Detalle de crucero — requiere auth
- POST `/` — Crear crucero — requiere auth ADMIN
- PUT `/:id/status` — Actualizar status — requiere auth ADMIN
- GET `/active` — Cruceros activos (scheduled o docked) — requiere auth (todos los roles)

**10c — Registrar rutas en `backend/src/routes/index.ts`:**
```typescript
import { cruisesRouter } from './cruises';
router.use('/cruises', cruisesRouter);
```

**Verificación:**
```bash
ls backend/src/routes/cruises.ts backend/src/schemas/cruise.schemas.ts
```
Ambos deben existir.

```bash
grep "cruises" backend/src/routes/index.ts
```
Debe mostrar la importación y uso del router.

---

### Paso 11 — Generar iconos PWA 192x192 y 512x512 🔀

**Problema:** `manifest.json` solo tiene un icono de 64x64. Chrome no muestra prompt de instalación PWA sin iconos de 192x192 y 512x512.

**Archivos:**
- `cruise-connect-main/public/icon-192x192.png` (nuevo)
- `cruise-connect-main/public/icon-512x512.png` (nuevo)
- `cruise-connect-main/public/manifest.json` (modificar)

**Instrucciones:**

**11a — Generar iconos programáticamente con canvas (Node.js script):**

Crear un script temporal `generate-icons.js`:
```javascript
const { createCanvas } = require('canvas');
const fs = require('fs');

function generateIcon(size, filename) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Fondo gradiente azul (brand color)
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, '#1e40af');
  gradient.addColorStop(1, '#3b82f6');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  // Texto "C2C"
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${size * 0.3}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('C2C', size / 2, size / 2);

  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(filename, buffer);
}

generateIcon(192, 'cruise-connect-main/public/icon-192x192.png');
generateIcon(512, 'cruise-connect-main/public/icon-512x512.png');
console.log('Iconos generados');
```

Ejecutar: `node generate-icons.js` (requiere `npm install canvas` o usar alternativa como `sharp`).

**Alternativa sin dependencias:** Usar un SVG convertido a PNG con `sharp`:
```bash
cd cruise-connect-main && npm install --save-dev sharp
```
Luego generar los iconos con un script que use sharp.

**11b — Actualizar `manifest.json`:**

En el array `icons`, añadir:
```json
{
  "src": "/icon-192x192.png",
  "sizes": "192x192",
  "type": "image/png",
  "purpose": "any maskable"
},
{
  "src": "/icon-512x512.png",
  "sizes": "512x512",
  "type": "image/png",
  "purpose": "any maskable"
}
```

**Verificación:**
```bash
ls -la cruise-connect-main/public/icon-*.png
```
Deben existir ambos archivos con tamaños razonables (>1KB).

```bash
grep -c "icon-" cruise-connect-main/public/manifest.json
```
Debe retornar al menos 2.

---

## FASE C — Seguridad y robustez (Pasos 12-16)

**Tiempo estimado:** 3-4 horas
**Dependencias:** Paso 12 independiente. Paso 13 independiente. Pasos 14-16 independientes entre sí.

---

### Paso 12 — Proteger merchant registration con autenticación

**Problema:** `POST /api/merchants/register` es público — cualquiera puede registrar merchants falsos sin autenticación.

**Archivo:** `backend/src/routes/merchants.ts`

**Instrucciones:**

1. Buscar la ruta `POST /register` (actualmente sin middleware de auth).
2. Añadir `authMiddleware` y `requireRole('ADMIN')`:

```typescript
merchantsRouter.post('/register', authMiddleware, requireRole('ADMIN'), (req, res) => {
```

3. Verificar que `authMiddleware` y `requireRole` están importados en el archivo.

**Verificación:**
```bash
grep -A 1 "post.*register" backend/src/routes/merchants.ts
```
Debe mostrar `authMiddleware` y `requireRole('ADMIN')`.

---

### Paso 13 — Fix timezone en TTL de locker_code

**Problema:** El cálculo de expiración del código de locker usa UTC fijo (`T23:59:59.000Z`). En Canarias durante horario de verano (UTC+1), la medianoche local no coincide con 23:59 UTC.

**Archivo:** `backend/src/services/RequestService.ts`

**Instrucciones:**

1. Buscar la línea:
```typescript
const lockerCodeExpiresAt = new Date().toISOString().split('T')[0] + 'T23:59:59.000Z';
```

2. Reemplazar por una función que calcule la medianoche en la zona horaria del servicio:
```typescript
// Calcular medianoche local del área de servicio
const getEndOfDayLocal = (): string => {
  const tz = 'Atlantic/Canary'; // Zona horaria del área de servicio
  const now = new Date();
  // Obtener fecha local en la zona horaria del servicio
  const localDate = now.toLocaleDateString('en-CA', { timeZone: tz }); // formato YYYY-MM-DD
  // Crear medianoche del día siguiente en la zona horaria local
  const endOfDay = new Date(`${localDate}T23:59:59`);
  // Ajustar al offset de la zona horaria
  const localEndOfDay = new Date(endOfDay.toLocaleString('en-US', { timeZone: tz }));
  const utcEndOfDay = new Date(endOfDay.getTime() + (endOfDay.getTime() - localEndOfDay.getTime()));
  return utcEndOfDay.toISOString();
};

const lockerCodeExpiresAt = getEndOfDayLocal();
```

**Alternativa más simple** (si se prefiere configuración centralizada):
```typescript
import { config } from '../config/env';

// Añadir a config/env.ts: serviceTimezone: process.env.SERVICE_TIMEZONE || 'Atlantic/Canary'
const lockerCodeExpiresAt = (() => {
  const tz = config.serviceTimezone || 'Atlantic/Canary';
  const localDate = new Date().toLocaleDateString('en-CA', { timeZone: tz });
  const midnightLocal = new Date(`${localDate}T23:59:59`);
  // Convertir medianoche local a UTC
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', timeZoneName: 'shortOffset' });
  const parts = formatter.formatToParts(midnightLocal);
  const offsetPart = parts.find(p => p.type === 'timeZoneName');
  // Approach simple: usar el offset de Intl para ajustar
  return new Date(localDate + 'T23:59:59.000Z').toISOString(); // Fallback si la zona es UTC
})();
```

**Recomendación más pragmática:** Añadir `SERVICE_TIMEZONE` a `config/env.ts` y usar la librería nativa de Intl para convertir:

```typescript
const lockerCodeExpiresAt = new Intl.DateTimeFormat('sv-SE', {
  timeZone: config.serviceTimezone || 'Atlantic/Canary',
  year: 'numeric', month: '2-digit', day: '2-digit'
}).format(new Date()) + 'T23:59:59.000Z';
```

**⚠️ Nota:** La solución exacta depende del enfoque que prefiera el desarrollador. Lo importante es que NO se use `new Date().toISOString().split('T')[0]` directamente ya que asume UTC.

**Verificación:**
```bash
grep -n "toISOString.*split" backend/src/services/RequestService.ts
```
Debe retornar 0 resultados (la línea antigua fue eliminada).

---

### Paso 14 — Añadir health checks a docker-compose

**Problema:** Los servicios en `docker-compose.yml` no tienen health checks. Docker no puede detectar si un servicio está realmente operativo.

**Archivo:** `docker-compose.yml`

**Instrucciones:**

1. En el servicio `backend`, añadir:
```yaml
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:9000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s
```

2. En el servicio `frontend`, añadir:
```yaml
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:80"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 5s
```

3. Asegurar que el backend tiene un endpoint `/api/health`. Si no existe, crear uno simple:

**En `backend/src/routes/index.ts`:**
```typescript
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
```

**Nota:** Se usa `wget` en lugar de `curl` porque las imágenes Alpine de Node.js y nginx no incluyen curl por defecto, pero sí wget.

**Verificación:**
```bash
grep -A 6 "healthcheck" docker-compose.yml
```
Debe mostrar health checks para ambos servicios.

```bash
grep "health" backend/src/routes/index.ts
```
Debe mostrar el endpoint /health.

---

### Paso 15 — Añadir índices de rendimiento al schema

**Problema:** Queries frecuentes (por status, client_id, driver_id, created_at) no tienen índices. Con volumen, las consultas serán lentas.

**Archivo:** `backend/src/db/schema.sql.ts`

**Instrucciones:**

Añadir al final del schema (después de todas las tablas):

```sql
-- Índices de rendimiento
CREATE INDEX IF NOT EXISTS idx_pickup_requests_status ON pickup_requests(status);
CREATE INDEX IF NOT EXISTS idx_pickup_requests_client_id ON pickup_requests(client_id);
CREATE INDEX IF NOT EXISTS idx_pickup_requests_driver_id ON pickup_requests(driver_id);
CREATE INDEX IF NOT EXISTS idx_pickup_requests_created_at ON pickup_requests(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_events_request_id ON audit_events(request_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_created_at ON audit_events(created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_handshake_attempts_request_id ON handshake_attempts(request_id);
CREATE INDEX IF NOT EXISTS idx_merchants_integration_status ON merchants(integration_status);
CREATE INDEX IF NOT EXISTS idx_cruise_manifest_status ON cruise_manifest(status);
CREATE INDEX IF NOT EXISTS idx_cruise_manifest_scheduled_arrival ON cruise_manifest(scheduled_arrival);
```

**Verificación:**
```bash
grep -c "CREATE INDEX" backend/src/db/schema.sql.ts
```
Debe retornar 11 (o más si había índices previos).

---

### Paso 16 — Añadir SERVICE_TIMEZONE a config centralizada

**Problema:** No existe configuración para la zona horaria del área de servicio. Esto es necesario para el paso 13 y para futuras funcionalidades dependientes de hora local.

**Archivo:** `backend/src/config/env.ts`

**Instrucciones:**

Añadir al objeto config:
```typescript
serviceTimezone: process.env.SERVICE_TIMEZONE || 'Atlantic/Canary',
```

Actualizar `.env.example` con:
```env
SERVICE_TIMEZONE=Atlantic/Canary
```

**Verificación:**
```bash
grep "serviceTimezone\|SERVICE_TIMEZONE" backend/src/config/env.ts backend/.env.example
```
Debe encontrar ambas referencias.

---

## FASE D — Tests faltantes (Pasos 17-21)

**Tiempo estimado:** 3-4 horas
**Dependencias:** Pasos 17-20 son independientes entre sí 🔀. Paso 21 requiere que pasos 17-20 estén completos.

---

### Paso 17 — Crear cascade-search.test.ts

**Problema:** `GeoDispatchService` es una feature crítica sin tests dedicados. La búsqueda en cascada 3→5→7km con timeouts necesita cobertura directa.

**Archivo a crear:** `backend/src/__tests__/cascade-search.test.ts`

**Instrucciones:**

Crear test file con los siguientes casos de prueba:

```typescript
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
// ... imports necesarios

describe('GeoDispatchService - Cascade Search', () => {

  // Setup: crear usuario CLIENT, varios usuarios DRIVER a diferentes distancias

  describe('Fases de cascada', () => {
    it('debería encontrar conductor en fase 1 (3km) si está dentro del radio', async () => {
      // Crear driver a 2km del cliente, iniciar cascada
      // Verificar que se emite notificación inmediatamente
    });

    it('debería escalar a fase 2 (5km) si no hay conductores en 3km', async () => {
      // Crear driver a 4km, iniciar cascada
      // Esperar timeout fase 1 (mock timers), verificar expansión
    });

    it('debería escalar a fase 3 (7km) si no hay conductores en 5km', async () => {
      // Crear driver a 6km, iniciar cascada
      // Esperar timeout fase 1+2, verificar expansión a 7km
    });

    it('debería marcar como escalated si no hay conductores en ningún radio', async () => {
      // No crear drivers, iniciar cascada
      // Esperar todas las fases, verificar status = 'escalated'
    });
  });

  describe('Cancelación', () => {
    it('debería cancelar cascada cuando un conductor acepta', async () => {
      // Iniciar cascada, aceptar request, verificar cancelCascade
    });

    it('debería limpiar timeouts pendientes al cancelar', async () => {
      // Verificar que activeCascades Map se limpia tras cancelación
    });
  });

  describe('Notificaciones', () => {
    it('no debería notificar conductores ya notificados en fases anteriores', async () => {
      // Verificar deduplicación (si se implementó) o documentar como known issue
    });
  });
});
```

**Nota:** Usar `jest.useFakeTimers()` para controlar los timeouts de 45 segundos sin esperas reales.

**Verificación:**
```bash
cd backend && npx jest cascade-search --verbose 2>&1 | tail -20
```
Todos los tests deben pasar.

---

### Paso 18 — Crear test de renewHandshake

**Problema:** La función `renewHandshake` existe y tiene endpoint pero no tiene test dedicado.

**Archivo:** `backend/src/__tests__/integration.test.ts` (añadir al existente) o crear `backend/src/__tests__/renew-handshake.test.ts`

**Instrucciones:**

Añadir test cases:

```typescript
describe('Renew Handshake', () => {
  it('debería generar nuevo código de 4 dígitos y nueva expiración', async () => {
    // Crear request, aceptarla (genera handshake), renovar
    // Verificar: nuevo código diferente, nueva expiración, attempts reseteados
  });

  it('debería rechazar renovación si request no está en estado accepted', async () => {
    // Intentar renovar request en estado pending o completed
    // Verificar: error 400 o 409
  });

  it('debería retornar el nuevo código en la respuesta', async () => {
    // Verificar que la respuesta incluye handshakeCode
  });

  it('debería crear audit event HANDSHAKE_RENEWED', async () => {
    // Verificar audit trail tras renovación
  });
});
```

**Verificación:**
```bash
cd backend && npx jest renew-handshake --verbose 2>&1 | tail -10
# o si se añadió a integration.test.ts:
cd backend && npx jest integration --verbose 2>&1 | grep -i "renew"
```

---

### Paso 19 — Crear test de expiración de locker code (TTL)

**Problema:** La expiración del código de locker es una feature de seguridad crítica sin test dedicado.

**Archivo a crear:** `backend/src/__tests__/locker-ttl.test.ts`

**Instrucciones:**

```typescript
describe('Locker Code TTL', () => {
  it('debería aceptar código válido antes de expiración', async () => {
    // Crear request → aceptar → deposit → open con código correcto
    // Verificar: 200 OK
  });

  it('debería rechazar código expirado con 410 Gone', async () => {
    // Crear request → aceptar → deposit
    // Modificar locker_code_expires_at en BD a fecha pasada
    // Intentar open → verificar 410
  });

  it('debería tener expiración a fin del día local', async () => {
    // Crear request → aceptar → deposit
    // Verificar que locker_code_expires_at contiene 'T23:59:59'
  });
});
```

**Verificación:**
```bash
cd backend && npx jest locker-ttl --verbose 2>&1 | tail -10
```

---

### Paso 20 — Crear test para endpoints cruise_manifest 🔀

**Problema:** Los endpoints de cruise_manifest (creados en paso 10) necesitan cobertura de tests.

**Archivo a crear:** `backend/src/__tests__/cruises.test.ts`

**Instrucciones:**

```typescript
describe('Cruise Manifest API', () => {
  describe('POST /api/cruises', () => {
    it('debería crear crucero con datos válidos (admin)', async () => { });
    it('debería rechazar sin autenticación', async () => { });
    it('debería rechazar con rol CLIENT', async () => { });
    it('debería validar campos obligatorios', async () => { });
  });

  describe('GET /api/cruises', () => {
    it('debería listar cruceros (admin)', async () => { });
    it('debería filtrar por status', async () => { });
    it('debería paginar resultados', async () => { });
  });

  describe('GET /api/cruises/active', () => {
    it('debería retornar solo cruceros scheduled o docked', async () => { });
  });

  describe('PUT /api/cruises/:id/status', () => {
    it('debería actualizar status', async () => { });
    it('debería rechazar status inválido', async () => { });
  });
});
```

**Verificación:**
```bash
cd backend && npx jest cruises --verbose 2>&1 | tail -15
```

---

### Paso 21 — Subir coverage thresholds

**Problema:** Los umbrales de cobertura están en 40-55%, la memoria técnica requiere >80%.

**Archivo:** `backend/jest.config.ts`

**Instrucciones:**

**Subida progresiva (primera iteración):**
```typescript
coverageThreshold: {
  global: {
    branches: 50,    // era 40
    functions: 55,   // era 44
    lines: 65,       // era 55
    statements: 65,  // era 55
  },
},
```

**⚠️ IMPORTANTE:** Solo subir los thresholds si los tests pasan con los nuevos valores. Ejecutar primero:
```bash
cd backend && npx jest --coverage 2>&1 | grep -A 5 "Coverage summary"
```

Ajustar los thresholds a ~5% por debajo de los valores actuales para que tengan margen pero no sean triviales.

**Verificación:**
```bash
cd backend && npx jest --coverage 2>&1 | tail -20
```
Todos los tests deben pasar con los nuevos thresholds.

---

## FASE E — Mejoras de alineación con memoria (Pasos 22)

**Tiempo estimado:** 1-2 horas
**Nota:** Los elementos grandes de Fase E (PostgreSQL, Redis, E2E Cypress, pagos, etc.) se DIFIEREN intencionalmente. Solo se incluye aquí el versionado de API que es un cambio estructural simple.

---

### Paso 22 — Versionar API con prefijo /v1/

**Problema:** La memoria técnica describe endpoints con versionado (e.g., `/api/v1/requests`). Actualmente las rutas son `/api/requests`, `/api/admin`, etc.

**Archivo:** `backend/src/routes/index.ts`

**Instrucciones:**

1. Crear un router de nivel superior con versionado:

```typescript
import { Router } from 'express';

const apiRouter = Router();
const v1Router = Router();

// Montar todas las rutas existentes bajo v1
v1Router.use('/auth', authRouter);
v1Router.use('/requests', requestsRouter);
v1Router.use('/lockers', lockersRouter);
v1Router.use('/admin', adminRouter);
v1Router.use('/merchants', merchantsRouter);
v1Router.use('/cruises', cruisesRouter);
v1Router.use('/locations', locationsRouter);

// Health check fuera de versionado
apiRouter.get('/health', (req, res) => {
  res.json({ status: 'ok', version: 'v1', timestamp: new Date().toISOString() });
});

// Montar v1
apiRouter.use('/v1', v1Router);

// COMPATIBILIDAD: mantener rutas sin versión como alias de v1 (deprecar en futuro)
apiRouter.use('/', v1Router);

export default apiRouter;
```

2. En `server.ts`, asegurar que se monta como:
```typescript
app.use('/api', apiRouter);
```

Esto hace que tanto `/api/v1/requests` como `/api/requests` funcionen (backward compatible).

**Verificación:**
```bash
# Con el servidor corriendo:
curl http://localhost:9000/api/v1/health
curl http://localhost:9000/api/health
```
Ambas deben retornar `{ status: 'ok', version: 'v1' }`.

```bash
cd backend && npx jest --verbose 2>&1 | tail -5
```
Todos los tests existentes deben seguir pasando (por la compatibilidad con rutas sin versión).

---

## Grafo de dependencias

```
FASE A (independientes entre sí):
  Paso 1 ─┐
  Paso 2 ─┤
  Paso 3 ─┤── Todos en paralelo
  Paso 4 ─┤
  Paso 5 ─┤
  Paso 6 ─┘

FASE B:
  Paso 7 (schema) ──┬── Paso 8 (auth users)
                     ├── Paso 9 (merchant_id requests)
                     └── Paso 10 (CRUD cruise_manifest)
  Paso 11 (iconos PWA) ── independiente

FASE C:
  Paso 12 ─┐
  Paso 13 ─┤── Requiere Paso 16 (timezone config)
  Paso 14 ─┤── Independiente
  Paso 15 ─┤── Requiere Paso 7 (schema con nuevas tablas)
  Paso 16 ─┘── Independiente

FASE D:
  Paso 17 ─┐
  Paso 18 ─┤── Todos en paralelo
  Paso 19 ─┤
  Paso 20 ─┤── Requiere Paso 10 (endpoints cruises)
  Paso 21 ─┘── Requiere Pasos 17-20

FASE E:
  Paso 22 ── Requiere Paso 14 (health endpoint)
```

---

## Resumen de impacto esperado

| Métrica | Antes (v2) | Objetivo tras este plan |
|---------|-----------|------------------------|
| Alineación general | ~65-70% | ~80-85% |
| Tests backend | 73+ tests | ~110+ tests |
| Coverage backend | ~55% | ~65% |
| Seguridad | 80% | ~92% |
| Schema completitud | 75% | ~95% |
| Infraestructura | 75% | ~85% |
| PWA compliance | Parcial | Lighthouse-ready |
| CI pipeline | Parcial (solo backend tests) | Completo (backend + frontend) |

---

## Elementos DIFERIDOS (fuera de este plan)

Estos requieren esfuerzo significativo y se recomiendan para sprints posteriores:

1. **Migración SQLite → PostgreSQL + PostGIS** (2-3 días)
2. **Redis Pub/Sub** (1 día)
3. **Cifrado AES-256 para PII** (1 día)
4. **Tests E2E Cypress** (2 días)
5. **Pasarela de pagos Stripe** (2-3 días)
6. **Device fingerprinting en JWT** (4h)
7. **GPS spoofing detection** (4h)
8. **Monitoring ELK/Prometheus** (1-2 días)
9. **Canal SMS contingencia** (4h)

---

*Fin del plan de ejecución v2.*
