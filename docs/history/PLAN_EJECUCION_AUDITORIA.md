# PLAN DE EJECUCION — CORRECCIONES AUDITORIA CITY2CRUISE

## Instrucciones de uso

Este plan esta dividido en **30 pasos** agrupados en **4 fases**. Cada paso es una instruccion autocontenida que puedes copiar y pegar directamente a Claude Opus 4.6.

**Reglas:**

1. Ejecuta los pasos EN ORDEN (las dependencias estan calculadas)
2. Un paso por conversacion (no saturar el contexto)
3. Al terminar cada paso, verifica que compila/funciona antes de pasar al siguiente
4. Los pasos marcados con `[PARALLEL]` pueden ejecutarse en la misma sesion si quieres
5. Cada paso tiene un **comando de verificacion** para confirmar que se completo bien

---

## FASE 0 — PREPARACION Y SEGURIDAD INMEDIATA (Pasos 1-4)

> Objetivo: cerrar vulnerabilidades criticas y preparar el terreno

---

### PASO 1 — Gitignore y seguridad de secretos

**Prioridad:** CRITICA
**Tiempo estimado:** 5 minutos
**Dependencias:** Ninguna

```
INSTRUCCION PARA CLAUDE:

Estoy trabajando en el proyecto City2Cruise ubicado en la carpeta actual.
Necesito que hagas lo siguiente:

1. Crea el archivo `backend/.gitignore` con estas exclusiones:
   - .env
   - node_modules/
   - dist/
   - database.sqlite
   - database.sqlite-wal
   - database.sqlite-shm
   - *.log
   - coverage/

2. Crea el archivo `backend/.env.example` como template con:
   - PORT=9000
   - JWT_SECRET=<GENERA_UN_SECRETO_SEGURO_DE_64_CHARS>
   - DB_FILE=./database.sqlite
   - FRONTEND_URL=http://localhost:9100
   - NODE_ENV=development

3. En el archivo `backend/.env` actual, reemplaza el JWT_SECRET
   "super_secret_jwt_key_demo" por un string aleatorio seguro de 64
   caracteres hexadecimales. Genera uno real con crypto.

4. Verifica que `cruise-connect-main/.gitignore` ya existe y que
   incluye node_modules y .env.

No toques nada mas. Solo estos archivos.
```

**Verificacion:** `cat backend/.gitignore && cat backend/.env.example && grep JWT_SECRET backend/.env`

---

### PASO 2 — Corregir bug de AdminDashboard (campos inexistentes)

**Prioridad:** CRITICA
**Tiempo estimado:** 10 minutos
**Dependencias:** Ninguna

```
INSTRUCCION PARA CLAUDE:

En el proyecto City2Cruise, hay un bug en el AdminDashboard del frontend.

PROBLEMA: El archivo `cruise-connect-main/src/pages/AdminDashboard.tsx`
referencia campos `user.ordered_count` y `user.deposited_count` que NO
existen en la respuesta de la API. La API en `backend/src/routes/admin.ts`
(GET /admin/users) retorna `requestsCount` como unico contador.

TAREA:
1. Lee `backend/src/routes/admin.ts` para ver exactamente que campos
   retorna la API de admin.
2. Lee `cruise-connect-main/src/pages/AdminDashboard.tsx` para ver que
   campos usa el frontend.
3. Haz UNA de estas dos opciones (la que sea mas coherente):
   a) Corrige el frontend para usar los campos reales de la API, O
   b) Amplia la API de admin para retornar contadores desglosados
      (total_requests, deposited_count, picked_up_count) y actualiza
      el frontend para usarlos.
4. Prefiero la opcion (b) porque aporta mas valor al dashboard.

No toques ningun otro archivo.
```

**Verificacion:** El AdminDashboard renderiza correctamente los contadores.

---

### PASO 3 — Parametrizar URLs de API en frontend

**Prioridad:** CRITICA
**Tiempo estimado:** 10 minutos
**Dependencias:** Ninguna

```
INSTRUCCION PARA CLAUDE:

En el proyecto City2Cruise, las URLs del backend estan hardcodeadas en
el frontend. Necesito parametrizarlas.

TAREA:
1. En `cruise-connect-main/src/services/api.ts`, la baseURL esta
   hardcodeada como "http://localhost:9000/api". Cambiala para que use
   `import.meta.env.VITE_API_URL || "http://localhost:9000/api"`.

2. En `cruise-connect-main/src/socket.ts`, la URL del socket esta
   hardcodeada como "http://localhost:9000". Cambiala para que use
   `import.meta.env.VITE_SOCKET_URL || "http://localhost:9000"`.

3. Crea el archivo `cruise-connect-main/.env.example` con:
   VITE_API_URL=http://localhost:9000/api
   VITE_SOCKET_URL=http://localhost:9000

4. Si no existe `cruise-connect-main/.env`, crea uno con los mismos
   valores para desarrollo local.

No toques ningun otro archivo.
```

**Verificacion:** `grep "import.meta.env" cruise-connect-main/src/services/api.ts cruise-connect-main/src/socket.ts`

---

### PASO 4 — Hashear codigos sensibles (handshake + locker)

**Prioridad:** CRITICA
**Tiempo estimado:** 20 minutos
**Dependencias:** Ninguna

```
INSTRUCCION PARA CLAUDE:

En el proyecto City2Cruise, los codigos de handshake (4 digitos) y locker
(6 digitos) se almacenan en texto plano en la base de datos SQLite.
Segun la memoria tecnica, deben estar hasheados con bcrypt.

TAREA:
1. Lee estos archivos para entender el flujo actual:
   - backend/src/routes/requests.ts (genera handshake_code y locker_code)
   - backend/src/routes/lockers.ts (valida locker_code)

2. Modifica la GENERACION de codigos:
   - Cuando se genera handshake_code (en accept request), hashea con
     bcrypt antes de almacenar en BD. Pero DEVUELVE el codigo plano
     al conductor en la respuesta (solo una vez).
   - Cuando se genera locker_code (en deposit), hashea con bcrypt
     antes de almacenar. DEVUELVE el codigo plano en la notificacion
     y respuesta al cliente (solo una vez).

3. Modifica la VALIDACION de codigos:
   - En confirm-driver, usa bcrypt.compare() para validar el
     handshake_code en lugar de comparacion directa.
   - En POST /lockers/open, usa bcrypt.compare() para validar el
     locker_code en lugar de comparacion directa.

4. Usa salt rounds de 10 (no 12, para no penalizar latencia en
   operaciones criticas de tiempo).

5. Actualiza los tests existentes si es necesario para que sigan pasando.

IMPORTANTE: No cambies la longitud de los codigos, solo como se almacenan
y validan. El usuario sigue viendo codigos de 4 y 6 digitos.
```

**Verificacion:** `cd backend && npm test`

---

## FASE 1 — MODELO DE DATOS Y AUDITORIA (Pasos 5-11)

> Objetivo: ampliar el modelo de datos para alinearlo con la memoria tecnica

---

### PASO 5 — Ampliar esquema de base de datos (nuevas tablas)

**Prioridad:** ALTA
**Tiempo estimado:** 25 minutos
**Dependencias:** Paso 1-4 completados

```
INSTRUCCION PARA CLAUDE:

En el proyecto City2Cruise, el modelo de datos actual tiene solo 4 tablas
(users, lockers, pickup_requests, notifications). Segun la memoria
tecnica necesitamos ampliar significativamente el esquema.

TAREA:
Lee el archivo `backend/src/db/schema.sql.ts` actual y amplialo
anadiendo las siguientes tablas y campos:

NUEVAS TABLAS:

1. `merchants` (sistema de comercios B2B):
   - id TEXT PRIMARY KEY
   - business_name TEXT NOT NULL
   - email TEXT UNIQUE NOT NULL
   - phone TEXT
   - address TEXT
   - latitude REAL
   - longitude REAL
   - integration_status TEXT DEFAULT 'pending'
     CHECK(integration_status IN ('pending','active','suspended'))
   - subscription_tier TEXT DEFAULT 'free'
     CHECK(subscription_tier IN ('free','premium'))
   - api_key_hash TEXT
   - created_at TEXT DEFAULT (datetime('now'))
   - updated_at TEXT DEFAULT (datetime('now'))

2. `audit_events` (log de trazabilidad inmutable):
   - id TEXT PRIMARY KEY
   - request_id TEXT REFERENCES pickup_requests(id)
   - event_type TEXT NOT NULL
     CHECK(event_type IN ('REQUESTED','ASSIGNED','CONFIRMATION_PENDING',
     'HANDSHAKE_VALIDATED','IN_PROGRESS','DEPOSITED','PICKED_UP',
     'CANCELLED','RATE_LIMIT_BLOCK','LOCKER_OPEN','LOCKER_CLOSE',
     'NETWORK_FAILURE'))
   - actor_id TEXT NOT NULL
   - actor_role TEXT CHECK(actor_role IN ('CLIENT','DRIVER','ADMIN','SYSTEM'))
   - latitude REAL
   - longitude REAL
   - metadata TEXT (JSON string)
   - event_signature TEXT (HMAC-SHA256)
   - created_at TEXT DEFAULT (datetime('now'))
   Agregar indice: CREATE INDEX idx_audit_request ON audit_events(request_id)
   Agregar indice: CREATE INDEX idx_audit_type ON audit_events(event_type)

3. `handshake_attempts` (tracking de intentos):
   - id TEXT PRIMARY KEY
   - request_id TEXT NOT NULL REFERENCES pickup_requests(id)
   - driver_id TEXT NOT NULL REFERENCES users(id)
   - attempt_number INTEGER NOT NULL
   - result TEXT CHECK(result IN ('success','failure'))
   - failure_reason TEXT
   - latitude REAL
   - longitude REAL
   - created_at TEXT DEFAULT (datetime('now'))
   Agregar indice: CREATE INDEX idx_hsa_request ON handshake_attempts(request_id)

4. `cruise_manifest` (horarios de cruceros):
   - id TEXT PRIMARY KEY
   - vessel_name TEXT NOT NULL
   - vessel_id TEXT
   - scheduled_arrival TEXT NOT NULL
   - scheduled_all_aboard TEXT NOT NULL
   - scheduled_departure TEXT NOT NULL
   - estimated_passengers INTEGER
   - port TEXT DEFAULT 'Las Palmas'
   - created_at TEXT DEFAULT (datetime('now'))

CAMPOS NUEVOS EN TABLAS EXISTENTES:

En `pickup_requests`:
   - merchant_id TEXT REFERENCES merchants(id) (nullable)
   - volume_category TEXT DEFAULT 'SMALL'
     CHECK(volume_category IN ('SMALL','MEDIUM','LARGE'))
     (cambiar la constraint actual para incluir LARGE)
   - locker_code_expires_at TEXT (para TTL del PIN)
   - handshake_attempts_count INTEGER DEFAULT 0
   - client_latitude REAL
   - client_longitude REAL
   - driver_latitude_pickup REAL
   - driver_longitude_pickup REAL
   - driver_latitude_deposit REAL
   - driver_longitude_deposit REAL

En `users`:
   - vehicle_identifier TEXT (para conductores: matricula)
   - accessibility_profile TEXT DEFAULT 'standard'
     CHECK(accessibility_profile IN ('standard','pmr','age_advanced'))
   - device_identifier TEXT

En `lockers`:
   - hub_id TEXT DEFAULT 'hub_las_palmas_01'
   - size_category TEXT DEFAULT 'M'
     CHECK(size_category IN ('S','M','L'))
   - last_sync_at TEXT

IMPORTANTE:
- Mantener la compatibilidad con el codigo existente (no romper nada)
- Usar CREATE TABLE IF NOT EXISTS para las nuevas tablas
- Los nuevos campos en tablas existentes deben ser nullables o tener DEFAULT
- Si hay seed data, actualizala para incluir datos en las nuevas tablas
- Actualiza tambien el archivo de reset si existe

No toques rutas ni logica de negocio, solo el esquema.
```

**Verificacion:** `cd backend && npx ts-node src/db/reset.ts` (o equivalente) sin errores

---

### PASO 6 — Implementar servicio de auditoria (AuditService)

**Prioridad:** ALTA
**Tiempo estimado:** 20 minutos
**Dependencias:** Paso 5

```
INSTRUCCION PARA CLAUDE:

Necesito crear un servicio de auditoria para el proyecto City2Cruise.
Este servicio es CRITICO porque la memoria tecnica describe un sistema
de trazabilidad con firmas criptograficas para el programa Puertos 4.0.

TAREA:
1. Crea el archivo `backend/src/services/AuditService.ts` con:

   - Funcion `logAuditEvent(params)` que:
     a) Genera un ID unico (usa el createId de @paralleldrive/cuid2
        que ya esta en el proyecto)
     b) Calcula firma HMAC-SHA256 usando:
        HMAC-SHA256(request_id + event_type + actor_id + timestamp,
        process.env.JWT_SECRET)
        Usa el modulo crypto nativo de Node.js
     c) Inserta registro en la tabla audit_events
     d) Nunca lanza excepcion (catch + console.error, no debe romper
        el flujo principal)

   - Funcion `getAuditTrail(requestId)` que:
     a) Retorna todos los eventos de una solicitud ordenados por created_at
     b) Incluye todos los campos

   - Funcion `verifyEventSignature(event)` que:
     a) Recalcula el HMAC y compara con el almacenado
     b) Retorna boolean

   Los tipos de eventos validos son:
   REQUESTED, ASSIGNED, CONFIRMATION_PENDING, HANDSHAKE_VALIDATED,
   IN_PROGRESS, DEPOSITED, PICKED_UP, CANCELLED, RATE_LIMIT_BLOCK

2. Integra las llamadas a logAuditEvent en `backend/src/routes/requests.ts`:
   - Al crear solicitud: logAuditEvent(REQUESTED, clientId)
   - Al aceptar: logAuditEvent(ASSIGNED, driverId)
   - Al confirmar handshake: logAuditEvent(HANDSHAKE_VALIDATED, clientId)
   - Al depositar: logAuditEvent(DEPOSITED, driverId)

3. Integra en `backend/src/routes/lockers.ts`:
   - Al abrir locker: logAuditEvent(PICKED_UP, clientId)

IMPORTANTE: Las llamadas a logAuditEvent deben ser fire-and-forget
(no await, o con catch), para no bloquear el flujo principal.
```

**Verificacion:** Ejecutar el flujo completo y verificar que audit_events tiene registros

---

### PASO 7 — Implementar rate limiting de handshake (3 intentos por orden)

**Prioridad:** ALTA
**Tiempo estimado:** 15 minutos
**Dependencias:** Paso 5

```
INSTRUCCION PARA CLAUDE:

En City2Cruise, segun la memoria tecnica, el handshake debe tener un
maximo de 3 intentos por orden. Al 4to intento fallido se debe bloquear
y notificar para intervencion de soporte L1.

TAREA:
1. Lee `backend/src/routes/requests.ts`, la ruta POST /:id/confirm-driver

2. Modifica esa ruta para:
   a) ANTES de validar el codigo, consultar en `handshake_attempts`
      cuantos intentos fallidos existen para ese request_id
   b) Si hay >= 3 intentos fallidos, rechazar con 423 Locked:
      { error: "Handshake bloqueado. Maximo de intentos alcanzado.
      Contacte soporte L1.", code: "RATE_LIMIT_PIN_EXCEEDED" }
   c) Si el codigo es INCORRECTO, insertar en handshake_attempts:
      { request_id, driver_id, attempt_number, result: 'failure',
        failure_reason: 'PIN_MISMATCH' }
      Incrementar handshake_attempts_count en pickup_requests
      Llamar a logAuditEvent con tipo RATE_LIMIT_BLOCK si es el 3er fallo
   d) Si el codigo es CORRECTO, insertar en handshake_attempts:
      { request_id, driver_id, attempt_number, result: 'success' }

3. No modifiques el seed ni la estructura de tablas (ya se hizo en paso 5)
```

**Verificacion:** `cd backend && npm test`

---

### PASO 8 — Implementar TTL del codigo de locker

**Prioridad:** ALTA
**Tiempo estimado:** 10 minutos
**Dependencias:** Paso 5

```
INSTRUCCION PARA CLAUDE:

En City2Cruise, el PIN de apertura de 6 digitos del locker debe expirar
a las 23:59 del mismo dia en que se genero (segun la memoria tecnica).

TAREA:
1. Lee `backend/src/routes/requests.ts` donde se genera el locker_code
   (en la ruta de deposit)

2. Al generar el locker_code, calcula tambien locker_code_expires_at:
   - Debe ser las 23:59:59 del dia actual en UTC
   - Formato ISO: new Date().toISOString().split('T')[0] + 'T23:59:59.000Z'
   - Almacenalo en el campo locker_code_expires_at de pickup_requests

3. Lee `backend/src/routes/lockers.ts` donde se valida el codigo

4. En la validacion del locker code, DESPUES de validar que el codigo
   coincide (bcrypt.compare), verificar que:
   - locker_code_expires_at existe
   - new Date() < new Date(locker_code_expires_at)
   - Si ha expirado, retornar 410 Gone:
     { error: "Codigo de locker expirado. Contacte soporte.",
       code: "OTP_EXPIRED" }

No modifiques otros archivos.
```

**Verificacion:** Test manual o unitario verificando rechazo despues de medianoche.

---

### PASO 9 — Implementar validacion GPS de proximidad en handshake

**Prioridad:** ALTA
**Tiempo estimado:** 15 minutos
**Dependencias:** Paso 4 (hasheo de codigos)

```
INSTRUCCION PARA CLAUDE:

Segun la memoria tecnica de City2Cruise, el handshake no solo requiere
el codigo PIN de 4 digitos, sino tambien que conductor y cliente esten
a menos de 50 metros de distancia (validacion GPS anti-fraude).

TAREA:
1. Lee `backend/src/routes/requests.ts`, ruta POST /:id/confirm-driver
2. Lee `backend/src/utils/geo.ts` para ver la funcion haversineDistance

3. Modifica POST /:id/confirm-driver para:
   a) Aceptar campos opcionales en el body: { code, latitude, longitude }
   b) Si latitude y longitude estan presentes Y la solicitud tiene
      coordenadas del conductor (driver_latitude, driver_longitude del
      ultimo location update), calcular la distancia con haversineDistance
   c) Si la distancia es > 0.05 (50 metros en km), rechazar con 403:
      { error: "Validacion de proximidad fallida. Distancia excesiva.",
        code: "GPS_PROXIMITY_FAILED",
        distance_meters: Math.round(distancia * 1000) }
   d) Si no se envian coordenadas, permitir el handshake igualmente
      (para compatibilidad con el flujo actual y casos sin GPS)
   e) Guardar las coordenadas del cliente en client_latitude/client_longitude
      de pickup_requests si se proporcionan

4. Asegurate de que el Haversine que usas esta en km (ya deberia estarlo)
5. Actualiza los tests existentes si fallan por el nuevo parametro

IMPORTANTE: La validacion GPS es OPCIONAL en el body (para no romper
el flujo actual), pero se valida SI se proporcionan las coordenadas.
```

**Verificacion:** `cd backend && npm test`

---

### PASO 10 — Implementar busqueda radial en cascada (3km > 5km > 7km)

**Prioridad:** ALTA
**Tiempo estimado:** 25 minutos
**Dependencias:** Paso 5

```
INSTRUCCION PARA CLAUDE:

En City2Cruise, cuando un cliente crea una solicitud, actualmente se
buscan conductores en un radio de 3km y si no hay ninguno se hace un
broadcast generico. La memoria tecnica dice que debe haber una cascada:
3km (45s) -> 5km (45s) -> 7km (45s), y si no hay conductores en ninguno,
encolar y notificar al usuario.

TAREA:
1. Crea `backend/src/services/GeoDispatchService.ts` con:

   a) Funcion `startCascadeSearch(requestId, coordinates, io)`:
      - Busca conductores activos en radio 3km
      - Si encuentra, emite Socket.IO "request:new" solo a esos conductores
      - Si no encuentra, programa un setTimeout de 45 segundos
      - A los 45s, busca en 5km
      - Si encuentra en 5km pero no en 3km, emite a los nuevos
      - Si no encuentra, programa otro setTimeout de 45s
      - A los 90s, busca en 7km
      - Si encuentra, emite a los nuevos
      - Si despues de 7km no hay respuesta (135s totales), marca la
        solicitud con un campo `escalated = true` y emite una notificacion
        al cliente diciendo "No se encontro conductor disponible.
        Su solicitud esta en cola."
      - Retorna inmediatamente al cliente (la cascada es asincrona)

   b) Almacena los timeouts activos en un Map<requestId, NodeJS.Timeout>
      para poder cancelarlos si un conductor acepta antes de que expire

   c) Funcion `cancelCascade(requestId)` que limpia los timeouts

2. En `backend/src/routes/requests.ts`:
   - En POST /api/requests (crear solicitud), reemplaza la logica actual
     de broadcast por una llamada a startCascadeSearch
   - En POST /api/requests/:id/accept, llama a cancelCascade(requestId)

3. Anade en `backend/src/config/env.ts` las variables:
   - SEARCH_RADII: [3, 5, 7] (en km)
   - CASCADE_TIMEOUT: 45000 (en ms)

IMPORTANTE: La busqueda sigue usando haversineDistance de utils/geo.ts.
La cascada es asincrona (no bloquea la respuesta al cliente).
```

**Verificacion:** Test manual creando solicitud sin conductores cerca, verificar logs de cascada

---

### PASO 11 — Parametrizar ubicacion geografica (Barcelona / Las Palmas)

**Prioridad:** MEDIA
**Tiempo estimado:** 15 minutos
**Dependencias:** Paso 5

```
INSTRUCCION PARA CLAUDE:

En City2Cruise, el codigo esta hardcodeado para Barcelona pero la memoria
tecnica describe el proyecto para Las Palmas de Gran Canaria.

TAREA:
1. En `backend/src/config/env.ts`, anade variables de area de servicio:
   SERVICE_AREA_NAME: process.env.SERVICE_AREA_NAME || 'Barcelona'
   SERVICE_AREA_CENTER_LAT: parseFloat(process.env.SERVICE_AREA_CENTER_LAT || '41.3851')
   SERVICE_AREA_CENTER_LON: parseFloat(process.env.SERVICE_AREA_CENTER_LON || '2.1734')
   SERVICE_AREA_SCOPE: process.env.SERVICE_AREA_SCOPE || 'Barcelona, Spain'

2. En `backend/src/routes/locations.ts`, reemplaza el string hardcodeado
   "Barcelona, Spain" por config.SERVICE_AREA_SCOPE

3. En `backend/.env.example`, anade las variables con valores para
   Las Palmas:
   SERVICE_AREA_NAME=Las Palmas
   SERVICE_AREA_CENTER_LAT=28.1235
   SERVICE_AREA_CENTER_LON=-15.4363
   SERVICE_AREA_SCOPE=Las Palmas de Gran Canaria, Spain

4. En `backend/.env` (desarrollo), deja Barcelona como default

5. Crea un archivo `backend/src/db/seed_lp.ts` (Las Palmas) con:
   - 3 conductores con coordenadas de Las Palmas (cerca del puerto)
   - 5 lockers con nombres de zonas portuarias de Las Palmas
   - Coordenadas de referencia:
     Puerto de La Luz: 28.1468, -15.4170
     Parque Santa Catalina: 28.1413, -15.4308
     Muelle de Santa Catalina: 28.1445, -15.4265

No modifiques la base de datos actual de desarrollo.
```

**Verificacion:** `grep SERVICE_AREA backend/src/config/env.ts`

---

## FASE 2 — ENDPOINTS B2A Y FUNCIONALIDADES CLAVE (Pasos 12-18)

> Objetivo: implementar features visibles para evaluadores de la subvencion

---

### PASO 12 — Crear endpoints de metricas B2A para la APLP

**Prioridad:** ALTA
**Tiempo estimado:** 25 minutos
**Dependencias:** Paso 5, 6

```
INSTRUCCION PARA CLAUDE:

El dashboard para la Autoridad Portuaria (APLP) es un requisito del
programa Puertos 4.0. Necesito crear los endpoints de metricas.

TAREA:
1. Crea o amplia `backend/src/routes/admin.ts` con estos nuevos endpoints
   (todos protegidos con requireAuth + requireRole('ADMIN')):

   a) GET /api/admin/metrics/throughput
      Retorna:
      {
        total_requests: count,
        by_status: { REQUESTED: n, IN_PROGRESS: n, DEPOSITED: n, PICKED_UP: n },
        lockers_total: n,
        lockers_occupied: n,
        lockers_available: n,
        occupancy_rate: porcentaje,
        avg_rotation_today: promedio de veces que cada locker se uso hoy
      }

   b) GET /api/admin/metrics/timing
      Retorna:
      {
        avg_assignment_time_seconds: promedio de tiempo entre REQUESTED y aceptacion,
        avg_delivery_time_seconds: promedio entre aceptacion y DEPOSITED,
        avg_total_time_seconds: promedio entre REQUESTED y PICKED_UP,
        requests_today: count,
        requests_this_week: count
      }
      (Calcula tiempos usando los timestamps de pickup_requests)

   c) GET /api/admin/fleet-status
      Retorna:
      {
        total_drivers: count de users con role=DRIVER,
        active_drivers: count de conductores con ubicacion reciente (<5 min),
        on_delivery: count de conductores con solicitud IN_PROGRESS,
        available: total_drivers - on_delivery
      }

   d) GET /api/admin/audit-trail/:requestId
      Retorna: array de audit_events para esa solicitud (usa AuditService)

   e) GET /api/admin/audit-trail
      Retorna: ultimos 100 eventos de auditoria (paginado con ?page=1&limit=100)

2. Registra las nuevas rutas en `backend/src/routes/index.ts`
```

**Verificacion:** `curl -H "Authorization: Bearer <admin_token>" http://localhost:9000/api/admin/metrics/throughput`

---

### PASO 13 — Mejorar AdminDashboard frontend con metricas

**Prioridad:** ALTA
**Tiempo estimado:** 30 minutos
**Dependencias:** Paso 12

```
INSTRUCCION PARA CLAUDE:

Ahora que tenemos endpoints de metricas B2A, necesito que el
AdminDashboard del frontend los muestre visualmente.

TAREA:
1. Lee el archivo `cruise-connect-main/src/pages/AdminDashboard.tsx` actual

2. Redisena el AdminDashboard para que tenga 3 secciones con tabs:

   TAB 1 - "Metricas" (por defecto):
   - 4 cards de KPI en fila:
     * Total solicitudes (de throughput)
     * Lockers ocupados / total (con barra de progreso)
     * Tiempo medio de entrega (de timing, en minutos)
     * Conductores activos (de fleet-status)
   - Grafico de barras (usa recharts que ya esta en las dependencias)
     mostrando solicitudes por estado (REQUESTED, IN_PROGRESS, DEPOSITED, PICKED_UP)

   TAB 2 - "Flota":
   - Tabla con conductores: nombre, email, estado (activo/inactivo), solicitudes completadas
   - Datos de fleet-status + lista de drivers

   TAB 3 - "Usuarios":
   - La tabla de usuarios existente (corregida en paso 2)
   - Boton de eliminar usuario

   TAB 4 - "Auditoria":
   - Input para buscar por ID de solicitud
   - Tabla con trail de eventos de auditoria
   - Columnas: Fecha, Tipo de evento, Actor, Firma

3. Usa los componentes shadcn/ui existentes (Card, Tabs, Table, Badge, Progress)
4. Haz las llamadas API usando el servicio api.ts existente
5. Anade loading states y error handling

Las llamadas a la API deben ser:
- GET /api/admin/metrics/throughput
- GET /api/admin/metrics/timing
- GET /api/admin/fleet-status
- GET /api/admin/users (existente)
- GET /api/admin/audit-trail/:requestId
```

**Verificacion:** Abrir http://localhost:9100 con usuario admin y ver las metricas

---

### PASO 14 — Crear rutas CRUD de merchants (comercios B2B)

**Prioridad:** ALTA
**Tiempo estimado:** 20 minutos
**Dependencias:** Paso 5

```
INSTRUCCION PARA CLAUDE:

El sistema de comercios (merchants) B2B esta completamente ausente en
el codigo pero es parte del modelo de negocio descrito en la memoria.

TAREA:
1. Crea `backend/src/routes/merchants.ts` con:

   a) POST /api/merchants/register (publico por ahora)
      Body: { business_name, email, phone, address, latitude, longitude }
      Validar con Zod
      Crear merchant con integration_status='pending'
      Retornar merchant creado

   b) GET /api/merchants (protegido, ADMIN)
      Retorna lista de todos los merchants

   c) GET /api/merchants/nearby (protegido, CLIENT)
      Query: ?lat=X&lon=Y&radius=2
      Retorna merchants activos dentro del radio (usando haversineDistance)

   d) PUT /api/merchants/:id/status (protegido, ADMIN)
      Body: { integration_status: 'active' | 'suspended' }
      Actualiza el estado del merchant

   e) GET /api/merchants/:id (protegido, ADMIN o el propio merchant)
      Retorna detalle del merchant

2. Registra las rutas en `backend/src/routes/index.ts`

3. Anade validacion Zod para los schemas del body

4. Actualiza el seed para incluir 2-3 merchants de ejemplo
```

**Verificacion:** `curl -X POST http://localhost:9000/api/merchants/register -H "Content-Type: application/json" -d '{"business_name":"Tienda Test","email":"test@test.com"}'`

---

### PASO 15 — Anadir validacion Zod a todos los endpoints

**Prioridad:** MEDIA
**Tiempo estimado:** 20 minutos
**Dependencias:** Paso 5

```
INSTRUCCION PARA CLAUDE:

Actualmente solo el endpoint de registro usa validacion Zod. Necesito
que todos los endpoints tengan validacion de esquema.

TAREA:
1. Crea `backend/src/middleware/validateSchema.ts`:
   - Exporta una funcion middleware factory: validateBody(schema: ZodSchema)
   - Si la validacion falla, retorna 400 con los errores de Zod formateados
   - Si pasa, llama a next()

2. Crea `backend/src/schemas/` directorio con:

   a) `request.schemas.ts`:
      - createRequestSchema: { description: string (opcional),
        pickup_address: string (min 3), latitude: number, longitude: number }
      - confirmDriverSchema: { code: string (4 chars),
        latitude: number (opcional), longitude: number (opcional) }
      - depositSchema: { locker_id: string (opcional) }

   b) `locker.schemas.ts`:
      - openLockerSchema: { code: string (6 chars) }

   c) `auth.schemas.ts`:
      (mueve los schemas existentes de routes/auth.ts aqui)

3. Aplica validateBody(schema) como middleware en cada ruta relevante
   en routes/requests.ts, routes/lockers.ts, y routes/auth.ts

4. Asegurate de que los tests existentes siguen pasando
```

**Verificacion:** `cd backend && npm test` + probar con body invalido que retorne 400

---

### PASO 16 — Anadir la categoria volumetrica LARGE

**Prioridad:** MEDIA
**Tiempo estimado:** 10 minutos
**Dependencias:** Paso 5

```
INSTRUCCION PARA CLAUDE:

La memoria tecnica describe 3 categorias volumetricas: SMALL (1-3kg),
MEDIUM (3-8kg) y LARGE/voluminous (10-12kg, 40-50L). El codigo solo
tiene SMALL y MEDIUM.

TAREA:
1. En `backend/src/db/schema.sql.ts`, la constraint de volume_category
   ya deberia incluir LARGE (del paso 5). Verificalo.

2. En `backend/src/routes/requests.ts`, donde se crea una solicitud:
   - Permitir 'LARGE' como valor valido de volume_category

3. En `backend/src/routes/requests.ts`, donde se asigna un locker
   (deposit), verificar que el locker asignado tiene un size_category
   compatible:
   - SMALL request -> locker S, M, o L
   - MEDIUM request -> locker M o L
   - LARGE request -> solo locker L
   Si no hay locker del tamano adecuado, retornar 409 con mensaje
   "No hay locker disponible del tamano requerido"

4. En el frontend ClientDashboard, si hay un selector de tamano para
   la solicitud, anade la opcion LARGE. Si no lo hay, anadelo como
   un select con las 3 opciones.

5. Actualiza los schemas Zod si ya existen (del paso 15)
```

**Verificacion:** Crear solicitud con volume_category=LARGE

---

### PASO 17 — Implementar logging estructurado

**Prioridad:** MEDIA
**Tiempo estimado:** 15 minutos
**Dependencias:** Ninguna

```
INSTRUCCION PARA CLAUDE:

El proyecto City2Cruise usa console.log/console.error en todo el backend.
Necesito logging estructurado en JSON para produccion.

TAREA:
1. Instala pino: `npm install pino pino-pretty`
   (pino-pretty solo como devDependency)

2. Crea `backend/src/utils/logger.ts`:
   - Exporta un logger configurado con pino
   - En desarrollo: usa pino-pretty con colores
   - En produccion: JSON por defecto
   - Nivel: 'debug' en desarrollo, 'info' en produccion

3. Reemplaza los console.log/console.error mas importantes en:
   - server.ts (startup messages)
   - routes/requests.ts (operaciones criticas)
   - routes/lockers.ts (apertura de lockers)
   - sockets/io.ts (conexiones/desconexiones)
   - utils/errors.ts (error handler global)
   - services/AuditService.ts (si existe)

4. En el error handler global, usa logger.error con contexto:
   logger.error({ err, path: req.path, method: req.method }, 'Unhandled error')

No reemplaces TODOS los console.log, solo los de rutas principales
y errores. Deja los de seeds/debug como estan.
```

**Verificacion:** `cd backend && npm run dev` y verificar que los logs salen en formato limpio

---

### PASO 18 — Extraer Service Layer (RequestService)

**Prioridad:** MEDIA
**Tiempo estimado:** 30 minutos
**Dependencias:** Pasos 5-10 completados

```
INSTRUCCION PARA CLAUDE:

La logica de negocio esta actualmente en los route handlers. Necesito
extraerla a una capa de servicios para mejor testeabilidad y
mantenibilidad.

TAREA:
1. Crea `backend/src/services/RequestService.ts` con estos metodos:
   (cada metodo recibe los parametros necesarios y la instancia de db)

   a) createRequest(db, { userId, description, pickupAddress, lat, lon, volumeCategory })
      -> Contiene la logica de INSERT + busqueda de conductores cercanos
      -> Retorna { request, nearbyDrivers }

   b) acceptRequest(db, { requestId, driverId })
      -> Contiene la logica transaccional de aceptacion + generacion de handshake_code
      -> Retorna { request, handshakeCode }

   c) confirmHandshake(db, { requestId, clientId, code, lat?, lon? })
      -> Contiene validacion de codigo + proximidad GPS + rate limiting
      -> Retorna { request }

   d) depositRequest(db, { requestId, driverId, lockerId? })
      -> Contiene logica transaccional de deposito + asignacion de locker + generacion de codigo
      -> Retorna { request, lockerCode }

   e) getClientRequests(db, { userId })
      -> Retorna solicitudes del cliente con su historial

2. Crea `backend/src/services/LockerService.ts` con:
   a) openLocker(db, { code, userId })
      -> Validacion de codigo + TTL + liberacion de locker
      -> Retorna { request, locker }

   b) getAvailableLockers(db, { sizeCategory? })
      -> Retorna lockers disponibles

3. Refactoriza `backend/src/routes/requests.ts` y `routes/lockers.ts`
   para que llamen a los servicios en lugar de tener la logica inline.
   Los route handlers solo deben:
   - Extraer parametros del request
   - Llamar al servicio
   - Enviar la respuesta HTTP
   - Emitir eventos Socket.IO

4. Asegurate de que TODOS los tests existentes siguen pasando tras la
   refactorizacion.

IMPORTANTE: Es una refactorizacion pura. El comportamiento observable
(API responses, WebSocket events) NO debe cambiar.
```

**Verificacion:** `cd backend && npm test` (todos los tests deben pasar igual)

---

## FASE 3 — INFRAESTRUCTURA Y PWA (Pasos 19-24)

> Objetivo: alinear con la arquitectura descrita en la memoria

---

### PASO 19 — Crear Dockerfile y docker-compose

**Prioridad:** ALTA
**Tiempo estimado:** 20 minutos
**Dependencias:** Pasos 1-18 idealmente completados

```
INSTRUCCION PARA CLAUDE:

La memoria tecnica describe despliegue con Docker. Necesito crear los
archivos de contenerizacion.

TAREA:
1. Crea `backend/Dockerfile`:
   - Multi-stage build
   - Stage 1 (builder): Node 20 Alpine, npm ci, npm run build
   - Stage 2 (runtime): Node 20 Alpine, copiar dist/ y node_modules/
   - EXPOSE 9000
   - CMD ["node", "dist/index.js"]
   - Crear .dockerignore con: node_modules, dist, database.sqlite*, .env

2. Crea `cruise-connect-main/Dockerfile`:
   - Multi-stage build
   - Stage 1 (builder): Node 20 Alpine, npm ci, npm run build
   - Stage 2 (runtime): nginx:alpine, copiar dist/ a /usr/share/nginx/html
   - EXPOSE 80
   - Copiar una config nginx basica que haga SPA fallback (try_files)

3. Crea `cruise-connect-main/nginx.conf` para SPA routing:
   - Servir archivos estaticos
   - Fallback a index.html para rutas de React Router
   - Proxy /api/* y /socket.io/* al backend (upstream backend:9000)

4. Crea `docker-compose.yml` en la raiz del proyecto con servicios:
   - backend:
     build: ./backend
     ports: 9000:9000
     environment: NODE_ENV, JWT_SECRET, DB_FILE, FRONTEND_URL
     volumes: ./backend/database.sqlite:/app/database.sqlite
   - frontend:
     build: ./cruise-connect-main
     ports: 80:80
     depends_on: backend

5. Crea `docker-compose.dev.yml` que extienda el anterior con:
   - Volumen montado para hot-reload del backend
   - Variables de desarrollo

6. Crea `.dockerignore` en ambas carpetas (backend y frontend)
```

**Verificacion:** `docker-compose build` (debe completar sin errores)

---

### PASO 20 — Implementar PWA (manifest + Service Worker)

**Prioridad:** ALTA
**Tiempo estimado:** 20 minutos
**Dependencias:** Paso 3

```
INSTRUCCION PARA CLAUDE:

La memoria tecnica describe City2Cruise como una PWA (Progressive Web
App) con capacidades offline. Actualmente es una SPA normal.

TAREA:
1. Instala el plugin de PWA para Vite:
   cd cruise-connect-main && npm install vite-plugin-pwa -D

2. Crea `cruise-connect-main/public/manifest.json`:
   {
     "name": "City2Cruise - Shop&Drop Port Hub",
     "short_name": "City2Cruise",
     "description": "Plataforma de logistica de ultima milla para cruceristas",
     "start_url": "/",
     "display": "standalone",
     "background_color": "#ffffff",
     "theme_color": "#0EA5E9",
     "icons": [
       { "src": "/favicon.ico", "sizes": "64x64", "type": "image/x-icon" }
     ]
   }

3. Configura vite-plugin-pwa en `vite.config.ts`:
   - registerType: 'autoUpdate'
   - Estrategia: CacheFirst para assets, NetworkFirst para API
   - Runtime caching para /api/* con NetworkFirst
   - Incluir manifest

4. Anade la etiqueta meta theme-color y link al manifest en `index.html`

5. En `cruise-connect-main/src/main.tsx`, registra el service worker
   si el plugin no lo hace automaticamente.

NOTA: No necesitamos IndexedDB completo por ahora. El service worker
con caching basico de assets ya cumple con el requisito minimo de PWA.
```

**Verificacion:** `cd cruise-connect-main && npm run build` + verificar que se genera sw.js en dist/

---

### PASO 21 — Integrar DriverMap en DriverDashboard

**Prioridad:** MEDIA
**Tiempo estimado:** 15 minutos
**Dependencias:** Ninguna

```
INSTRUCCION PARA CLAUDE:

En City2Cruise, existe un componente `DriverMap.tsx` con mapa Leaflet
que nunca se usa. Necesito integrarlo en el DriverDashboard.

TAREA:
1. Lee `cruise-connect-main/src/components/DriverMap.tsx` para entender
   su interfaz (props que acepta)

2. Lee `cruise-connect-main/src/pages/DriverDashboard.tsx` para ver
   la estructura actual

3. Integra DriverMap en DriverDashboard:
   - Anadelo como una seccion visible cuando el conductor tiene
     solicitudes pendientes
   - Pasale las solicitudes pendientes como marcadores
   - Pasale la ubicacion actual del conductor como centro del mapa
   - El mapa debe mostrar: posicion del conductor (marcador azul) +
     solicitudes pendientes cercanas (marcadores rojos con popup que
     muestra la direccion y permite aceptar)

4. Si DriverMap necesita props que no tiene, modifica su interfaz
   para aceptar lo que necesita

5. Asegurate de que los estilos de Leaflet se cargan correctamente
   (leaflet CSS import)

NOTA: react-leaflet ya esta en las dependencias del proyecto.
```

**Verificacion:** Abrir http://localhost:9100 como conductor y ver el mapa con solicitudes

---

### PASO 22 — Limpiar codigo muerto

**Prioridad:** BAJA
**Tiempo estimado:** 10 minutos
**Dependencias:** Paso 21

```
INSTRUCCION PARA CLAUDE:

Hay codigo muerto en el frontend de City2Cruise. Limpialo.

TAREA:
1. `cruise-connect-main/src/pages/Index.tsx` retorna null.
   - Verificar que ninguna ruta lo usa en App.tsx
   - Si no se usa, eliminalo
   - Si se usa como ruta "/", reemplaza por redirect a /login

2. `cruise-connect-main/src/hooks/use-toast.ts` (el custom, con
   reducer) parece duplicado con `components/ui/use-toast.ts`.
   - Verificar cual se importa en la app
   - Eliminar el que no se use
   - Si ambos se usan, consolidar en uno

3. `cruise-connect-main/src/components/ui/toaster.tsx` puede no
   usarse si toda la app usa sonner.
   - Verificar si se importa en algun sitio
   - Si no se usa, eliminarlo

4. Verificar que no hay imports rotos despues de la limpieza

IMPORTANTE: Solo elimina cosas que CONFIRMES que no se importan en
ningun otro archivo. Usa grep para verificar antes de eliminar.
```

**Verificacion:** `cd cruise-connect-main && npm run build` (sin warnings de imports)

---

### PASO 23 — Configurar CI/CD basico (GitHub Actions)

**Prioridad:** MEDIA
**Tiempo estimado:** 15 minutos
**Dependencias:** Ninguna

```
INSTRUCCION PARA CLAUDE:

La memoria tecnica describe un pipeline CI/CD. Crea una configuracion
basica de GitHub Actions.

TAREA:
1. Crea `.github/workflows/ci.yml`:

   name: CI
   on:
     push: { branches: [main, develop] }
     pull_request: { branches: [main] }

   jobs:
     backend-test:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with: { node-version: '20' }
         - run: cd backend && npm ci
         - run: cd backend && npm run build
         - run: cd backend && npm test

     frontend-build:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with: { node-version: '20' }
         - run: cd cruise-connect-main && npm ci
         - run: cd cruise-connect-main && npm run build

     lint:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with: { node-version: '20' }
         - run: cd cruise-connect-main && npm ci
         - run: cd cruise-connect-main && npx eslint src/

2. Si no existe script "build" en backend/package.json, anadelo:
   "build": "tsc"

3. Asegurate de que el frontend tiene el script "build" funcional.

No configures deploy automatico por ahora, solo CI (build + test + lint).
```

**Verificacion:** Verificar que el YAML es valido y que `npm test` y `npm run build` pasan localmente

---

### PASO 24 — Configurar cobertura de tests con threshold

**Prioridad:** MEDIA
**Tiempo estimado:** 10 minutos
**Dependencias:** Ninguna

```
INSTRUCCION PARA CLAUDE:

La memoria tecnica dice >80% de cobertura de tests. Configura Jest
para medirla.

TAREA:
1. En `backend/jest.config.ts` o `backend/package.json` (donde este
   la config de Jest), anade:
   - collectCoverage: true
   - coverageDirectory: 'coverage'
   - coverageReporters: ['text', 'lcov', 'json-summary']
   - coveragePathIgnorePatterns: ['/node_modules/', '/dist/', '/__tests__/']
   - coverageThreshold: {
       global: { branches: 60, functions: 60, lines: 60, statements: 60 }
     }
   (Empezamos con 60% como meta realista, subiremos a 80% cuando
   haya mas tests)

2. En backend/package.json, anade scripts:
   "test:coverage": "jest --coverage"
   "test:watch": "jest --watch"

3. En `cruise-connect-main/vitest.config.ts` o package.json, configura
   cobertura similar para vitest:
   - coverage.provider: 'v8'
   - coverage.reporter: ['text', 'lcov']

4. Anade 'coverage/' a ambos .gitignore

5. Ejecuta `cd backend && npm run test:coverage` y reporta el resultado.
```

**Verificacion:** `cd backend && npm run test:coverage` muestra reporte de cobertura

---

## FASE 4 — TESTING Y DOCUMENTACION (Pasos 25-30)

> Objetivo: cerrar las carencias de testing y documentar lo implementado

---

### PASO 25 — Tests unitarios frontend: LoginPage y ProtectedRoute

**Prioridad:** ALTA
**Tiempo estimado:** 20 minutos
**Dependencias:** Paso 22

```
INSTRUCCION PARA CLAUDE:

El frontend tiene 0% de cobertura real de tests. Necesito empezar con
los componentes criticos.

TAREA:
1. Primero verifica que vitest esta bien configurado leyendo
   vitest.config.ts y el test placeholder existente.

2. Instala testing-library si no esta:
   cd cruise-connect-main && npm install -D @testing-library/react
   @testing-library/jest-dom @testing-library/user-event

3. Crea `cruise-connect-main/src/__tests__/LoginPage.test.tsx`:
   - Test: renderiza correctamente con tabs Login/Registro
   - Test: tab Login tiene campos email y password
   - Test: tab Registro tiene campos name, email, password
   - Test: muestra error si se envia formulario vacio
   - Mockea el servicio api.ts y AppContext

4. Crea `cruise-connect-main/src/__tests__/ProtectedRoute.test.tsx`:
   - Test: redirige a /login si no hay token en contexto
   - Test: renderiza children si hay token valido
   - Test: redirige si el rol no coincide
   - Mockea AppContext

5. Elimina o reemplaza `src/test/example.test.ts` con un test real

6. Ejecuta los tests y asegurate de que pasan.

NOTA: Usa React Testing Library best practices. Testea comportamiento,
no implementacion.
```

**Verificacion:** `cd cruise-connect-main && npx vitest run`

---

### PASO 26 — Tests unitarios frontend: StatusBadge y NotificationBell

**Prioridad:** MEDIA
**Tiempo estimado:** 15 minutos
**Dependencias:** Paso 25

```
INSTRUCCION PARA CLAUDE:

Continuando con los tests frontend de City2Cruise.

TAREA:
1. Crea `cruise-connect-main/src/__tests__/StatusBadge.test.tsx`:
   - Test: renderiza badge con estado REQUESTED y texto correcto
   - Test: renderiza con estado CONFIRMATION_PENDING
   - Test: renderiza con estado IN_PROGRESS
   - Test: renderiza con estado DEPOSITED
   - Test: renderiza con estado PICKED_UP
   - Test: cada estado tiene un color/variante diferente

2. Crea `cruise-connect-main/src/__tests__/NotificationBell.test.tsx`:
   - Test: renderiza sin notificaciones (sin badge de conteo)
   - Test: muestra badge con numero cuando hay notificaciones no leidas
   - Test: al hacer click abre panel de notificaciones
   - Mockea las llamadas a la API

3. Ejecuta todos los tests frontend.
```

**Verificacion:** `cd cruise-connect-main && npx vitest run`

---

### PASO 27 — Tests backend: audit service y cascade search

**Prioridad:** MEDIA
**Tiempo estimado:** 20 minutos
**Dependencias:** Pasos 6, 7, 10

```
INSTRUCCION PARA CLAUDE:

Necesito tests para las nuevas funcionalidades del backend de City2Cruise.

TAREA:
1. Crea `backend/src/__tests__/audit.test.ts`:
   - Test: logAuditEvent inserta correctamente en audit_events
   - Test: la firma HMAC se genera y almacena
   - Test: verifyEventSignature retorna true para evento valido
   - Test: verifyEventSignature retorna false si se manipulan datos
   - Test: getAuditTrail retorna eventos ordenados por fecha
   - Test: el flujo completo genera 5 eventos de auditoria
     (REQUESTED -> ASSIGNED -> HANDSHAKE_VALIDATED -> DEPOSITED -> PICKED_UP)

2. Crea `backend/src/__tests__/handshake-ratelimit.test.ts`:
   - Test: primer intento fallido se registra en handshake_attempts
   - Test: segundo y tercer intento fallido se registran
   - Test: cuarto intento es rechazado con 423
   - Test: intento exitoso se registra y permite continuar
   - Test: despues de exito, no se permiten mas intentos

3. Ejecuta todos los tests del backend.
```

**Verificacion:** `cd backend && npm test` (todos pasan)

---

### PASO 28 — Tests backend: merchants y metricas admin

**Prioridad:** MEDIA
**Tiempo estimado:** 15 minutos
**Dependencias:** Pasos 12, 14

```
INSTRUCCION PARA CLAUDE:

Mas tests para el backend de City2Cruise.

TAREA:
1. Crea `backend/src/__tests__/merchants.test.ts`:
   - Test: POST /merchants/register crea merchant correctamente
   - Test: POST /merchants/register rechaza datos invalidos (sin nombre)
   - Test: GET /merchants (como admin) retorna lista
   - Test: GET /merchants/nearby filtra por radio correctamente
   - Test: PUT /merchants/:id/status actualiza estado

2. Crea `backend/src/__tests__/admin-metrics.test.ts`:
   - Test: GET /admin/metrics/throughput retorna estructura correcta
   - Test: GET /admin/metrics/timing retorna tiempos validos
   - Test: GET /admin/fleet-status retorna contadores de conductores
   - Test: GET /admin/audit-trail/:id retorna eventos de auditoria
   - Test: endpoints de admin son inaccesibles sin token admin

3. Reutiliza los helpers de tests existentes (setupTestDb, etc.)

4. Ejecuta todos los tests.
```

**Verificacion:** `cd backend && npm run test:coverage` (verificar que cobertura sube)

---

### PASO 29 — Crear script de load testing basico (k6)

**Prioridad:** BAJA
**Tiempo estimado:** 15 minutos
**Dependencias:** Pasos 1-18

```
INSTRUCCION PARA CLAUDE:

La memoria tecnica menciona load testing con k6. Crea un script basico.

TAREA:
1. Crea directorio `k6/` en la raiz del proyecto

2. Crea `k6/load-test.js`:
   - Importar { check, sleep } from 'k6'
   - Importar http from 'k6/http'

   - Scenario 1: "smoke" (5 VUs, 30s)
   - Scenario 2: "average" (50 VUs, 2min)
   - Scenario 3: "peak" (200 VUs, 1min)

   - Flujo por usuario virtual:
     a) POST /api/auth/login (con credenciales de test)
     b) GET /api/requests (obtener solicitudes)
     c) POST /api/requests (crear solicitud con datos aleatorios)
     d) sleep(1-3s)

   - Thresholds:
     http_req_duration: ['p(95)<500']
     http_req_failed: ['rate<0.05']

3. Crea `k6/README.md` con instrucciones de como ejecutar:
   - Instalar k6
   - Tener el backend corriendo
   - Ejecutar: k6 run k6/load-test.js
   - Ejecutar con escenario especifico: k6 run --scenario=peak k6/load-test.js
```

**Verificacion:** El archivo k6/load-test.js existe y tiene sintaxis k6 valida

---

### PASO 30 — Actualizar documentacion y memoria tecnica

**Prioridad:** BAJA
**Tiempo estimado:** 15 minutos
**Dependencias:** Todos los pasos anteriores

```
INSTRUCCION PARA CLAUDE:

Despues de todas las correcciones, necesito actualizar la documentacion
del proyecto City2Cruise.

TAREA:
1. Actualiza `cruise-connect-main/README.md` con:
   - Descripcion actualizada del proyecto
   - Stack tecnologico real
   - Instrucciones de instalacion y ejecucion (backend + frontend)
   - Variables de entorno necesarias
   - Como ejecutar tests
   - Como ejecutar con Docker
   - Estructura del proyecto actualizada

2. Crea `backend/README.md` con:
   - Descripcion del backend
   - Requisitos (Node 20, SQLite)
   - Setup: npm install, crear .env desde .env.example
   - Ejecucion: npm run dev / npm start
   - Tests: npm test / npm run test:coverage
   - Endpoints API documentados (tabla con metodo, ruta, descripcion, auth)
   - Modelo de datos (lista de tablas con campos principales)

3. Actualiza el RESPUESTA_CONSULTAS_TECNICAS.md si hay algo que
   ya no sea preciso tras los cambios realizados.

4. NO modifiques la memoria tecnica justificativa original (.docx).
   Es un documento oficial de la subvencion.

IMPORTANTE: La documentacion debe reflejar el estado REAL del codigo
despues de las correcciones, no el estado futuro ideal.
```

**Verificacion:** Leer los README y verificar que las instrucciones son correctas y completas

---

## RESUMEN VISUAL DEL PLAN

```
FASE 0 (Seguridad inmediata)     FASE 1 (Modelo + Auditoria)
├── Paso 1: .gitignore + secrets  ├── Paso 5: Schema ampliado
├── Paso 2: Fix AdminDashboard    ├── Paso 6: AuditService
├── Paso 3: URLs parametrizadas   ├── Paso 7: Rate limit handshake
└── Paso 4: Hashear codigos       ├── Paso 8: TTL locker code
                                  ├── Paso 9: GPS proximidad
                                  ├── Paso 10: Cascada 3>5>7km
                                  └── Paso 11: Parametrizar geo

FASE 2 (B2A + Features)          FASE 3 (Infra + PWA)
├── Paso 12: Endpoints metricas   ├── Paso 19: Docker
├── Paso 13: AdminDashboard v2    ├── Paso 20: PWA
├── Paso 14: CRUD merchants       ├── Paso 21: Integrar DriverMap
├── Paso 15: Zod validacion       ├── Paso 22: Limpiar codigo muerto
├── Paso 16: Categoria LARGE      ├── Paso 23: GitHub Actions CI
├── Paso 17: Logging pino         └── Paso 24: Config cobertura
└── Paso 18: Service Layer

FASE 4 (Testing + Docs)
├── Paso 25: Tests Login/Protected
├── Paso 26: Tests Badge/Bell
├── Paso 27: Tests audit/cascade
├── Paso 28: Tests merchants/admin
├── Paso 29: k6 load testing
└── Paso 30: Documentacion
```

## DEPENDENCIAS CRITICAS

```
Paso 5 ──> Pasos 6, 7, 8, 10, 11, 12, 14, 16
Paso 6 ──> Pasos 12, 13, 27
Paso 4 ──> Paso 9
Paso 12 ──> Paso 13
Paso 5-10 ──> Paso 18
Paso 3 ──> Paso 20
Paso 25 ──> Paso 26
```

## NOTAS PARA EL OPERADOR

1. **Si un paso falla**, no pases al siguiente dependiente.
   Pide a Claude que arregle el fallo primero.

2. **Despues de cada fase**, ejecuta `cd backend && npm test` para
   verificar que nada se ha roto.

3. **Los pasos de una misma fase** generalmente pueden ejecutarse
   en paralelo si no tienen dependencias directas entre si.

4. **Estima total:** ~60-80 interacciones con Claude, repartidas
   en 4-6 sesiones de trabajo.

5. **Prioridad si tienes poco tiempo:** Haz solo Fase 0 + Pasos
   5, 6, 12, 13, 19. Eso cubre las correcciones criticas y los
   elementos mas visibles para evaluadores de la subvencion.
