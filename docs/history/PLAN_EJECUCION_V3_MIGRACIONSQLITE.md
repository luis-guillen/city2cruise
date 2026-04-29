# PLAN DE EJECUCIÓN V3: MIGRACIÓN A POSTGRESQL + POSTGIS 🐘🌍

Este documento contiene la guía secuencial y detallada que deberás seguir (Claude/IA o desarrollador responsable) para migrar por completo la aplicación Cruise Connect, actualmente basada en `better-sqlite3` (síncrono y local), a una arquitectura **PostgreSQL** con la extensión **PostGIS** para potenciar el módulo de geolocalización.

---

## 🎯 Objetivo Arquitectónico
- **Asincronía Real**: Migrar todas las operaciones bloqueantes a un pool de conexiones `async/await`.
- **Topología Geoespacial**: Reemplazar la lógica de distancia manual (Haversine en código JS) con potentes queries de radio espacial directas a base de datos utilizando `ST_Distance` y `ST_DWithin` de PostGIS.
- **Escalabilidad y Concurrencia**: Transicionar a un motor de base de datos robusto capaz de administrar peticiones altamente transaccionales sin locks de escritura a nivel de base.

---

## FASE 1: Preparación del Entorno y Dependencias

### Paso 1: Configurar dependencias
1. Eliminar la dependencia antigua de SQLite: `npm uninstall better-sqlite3 @types/better-sqlite3`.
2. Instalar el cliente nativo de PostgreSQL: `npm install pg`.
3. Instalar tipados: `npm install -D @types/pg`.

### Paso 2: Orquestación Local (Docker Compose)
1. Modificar o crear el archivo `docker-compose.yml` en el root del proyecto.
2. Añadir un servicio para la base de datos usando la imagen `postgis/postgis:15-3.3-alpine`.
3. Configurar variables de entorno iniciales en `.env.example` y `.env`:
   - `DATABASE_URL=postgres://user:password@localhost:5432/cruise_connect`

---

## FASE 2: Traducción del Esquema SQL (Schema Definitions)

### Paso 3: Tipos y Restricciones
Modificar el archivo `backend/src/db/schema.sql.ts` convirtiéndolo a dialecto PostgreSQL:
1. Reemplazar `INTEGER PRIMARY KEY AUTOINCREMENT` por `SERIAL PRIMARY KEY` (o `INTEGER GENERATED ALWAYS AS IDENTITY`).
2. Mantener `TEXT`, `REAL`, `INTEGER` pero ajustar tipos específicos donde beneficie (por ej. `TIMESTAMP WITH TIME ZONE` para fechas en lugar de `TEXT`).
3. Reemplazar `lat REAL` y `lon REAL` (donde corresponda) por un tipo Point de PostGIS:
   ```sql
   CREATE EXTENSION IF NOT EXISTS postgis;
   -- Añadir columnas espaciales
   ALTER TABLE users ADD COLUMN location GEOGRAPHY(Point, 4326);
   ALTER TABLE pickup_requests ADD COLUMN pickup_location_geo GEOGRAPHY(Point, 4326);
   ```
*(Opcional: puedes mantener latitude y longitude de momento si la migración se desea escalonada, pero la integración nativa es mejor)*

---

## FASE 3: Reemplazo del Adaptador de Conexión (Driver)

### Paso 4: Refactorización de `database.ts`
1. Cambiar el archivo `backend/src/db/database.ts`.
2. Reemplazar la instanciación de `better-sqlite3` por un `Pool` de `pg`.
3. Exportar métodos query estándar para la aplicación:
   ```typescript
   export const query = (text: string, params?: any[]) => pool.query(text, params);
   ```
4. Ajustar el método `initDB` para ejecutar el script adaptado de Postgres.
5. Emocionante: ¡Asegurar que las tablas se crean en orden secuencial teniendo en cuenta claves foráneas! Postgres es estricto con los constraints durante la creación.

---

## FASE 4: Refactorización de las Consultas SQL

### Paso 5: Modificación Sintáctica (Parámetros)
1. Buscar sistemáticamente en el código cualquier ocurrencia de `db.prepare(...)`.
2. Cambiar la sintaxis de variables insertadas `?` a sintaxis Postgres: `$1`, `$2`, `$3`, etc.
3. Cambiar métodos antiguos por los nuevos del Pool (`.get()` pasa a `rows[0]`, `.all()` pasa a `rows`, `.run()` pasa a ejecutar el statement verificando `rowCount`).

### Paso 6: Transformación Asíncrona ✨
1. **CRÍTICO:** `better-sqlite3` es síncrono. Ahora todas las queries hacia Postgres usarán llamadas de red y **DEBEN** estar provistas de un `await`.
2. Inspeccionar todas las funciones en `backend/src/services/` (`RequestService`, `GeoDispatchService`, `AuditService`, etc.) y convertirlas a `async` / `await` propagando el cambio a los routers y sockets.

### Paso 7: Devolución de IDs (RETURNING)
1. Reemplazar `info.lastInsertRowid`.
2. Añadir la cláusula `RETURNING id` o `RETURNING *` al final de los sentencias `INSERT` o `UPDATE` para extraer los datos creados o modificados.

### Paso 8: Adaptar Transacciones
1. Postgres no utiliza las llamadas automáticas `.transaction()` de `better-sqlite3`.
2. Deberás crear un helper de transacción que ejecute:
   ```typescript
   const client = await pool.connect();
   try {
       await client.query('BEGIN');
       // ... lógicas
       await client.query('COMMIT');
   } catch (e) {
       await client.query('ROLLBACK');
       throw e;
   } finally {
       client.release();
   }
   ```
3. Sustituir todas las transacciones existentes en `RequestService.ts`.

---

## FASE 5: Adopción y Operación Geoespacial

### Paso 9: Inserción de Coordenadas
Refactorizar inserciones cuando se suministran latitudes y longitudes:
```sql
UPDATE users SET location = ST_SetSRID(ST_MakePoint($1, $2), 4326) WHERE id = $3;
```

### Paso 10: Consultas Espaciales en Cascada (GeoDispatchService)
1. Eliminar la iteración manual que se hace en JavaScript dentro de `notifyDriversInRadius()`.
2. Lanzar una sola Request a PostGIS que devuelva directamente a todos los conductores aptos y disponibles cruzando su geografía:
   ```sql
   SELECT id FROM users 
   WHERE role = 'DRIVER' 
   AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($1, $2), 4326), $3 * 1000); 
   -- $3 es radiusKm. ST_DWithin usando ::geography lo cuenta en metros.
   ```
3. Refactorizar el cálculo de distancia manual (`calculateDistance` en JS) sustituyéndolo por `ST_Distance`. Esto evitará que cargues objetos innecesarios en memoria y mejorará mil veces el rendimiento ante flotas de conductores amplias.

---

## FASE 6: Entornos de Pruebas (Tests)

### Paso 11: Entorno de Jest
1. El archivo `backend/src/__tests__/helpers.ts` levanta en estos momentos `:memory:`. SQLite in-memory debe cambiar.
2. **Estrategia sugerida**: Utiliza `pg-mem` si es posible para queries simples, o implementar variables especiales que apunten a una base de datos local de testing (ej: `cruise_connect_test`) que se purga (truncate) con cada ejecución de `setupTestDb()`.
3. Ajustar los tests para que todas las llamadas asíncronas originadas a bases de datos falsas simulen Promesas de la forma que lo haría Postgres. 

### Paso 12: Validación
1. Ejecutar todos los scripts `npm run test` y comprobar la solidez transaccional y el correcto funcionamiento del nuevo PostGIS.
2. Probar en frontend manualmente (Start up App/Docker).

---

🚀 **NOTA PARA EL MODELO:** Mantén especial diligencia al localizar queries con `better-sqlite3` que no tengan un bloque `try/catch` directo para gestionar los nuevos posibles rejections de Promesas, asegurando que `globalErrorHandler` actúa sobre las excepciones en las cadenas nuevas.
