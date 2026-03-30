# City2Cruise — Shop&Drop Port Hub

Plataforma de logística de última milla para cruceristas. Permite recoger las compras urbanas de los pasajeros y depositar los paquetes en smart lockers cercanos al puerto, con trazabilidad completa y notificaciones en tiempo real.

---

## Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| UI | React 18, Vite, TypeScript |
| Estilos | Tailwind CSS, shadcn/ui |
| Mapas | react-leaflet, Leaflet |
| Tiempo real | Socket.IO client |
| Notificaciones | Sonner (toast) |
| PWA | vite-plugin-pwa, Workbox |
| Tests | Vitest, @testing-library/react |

---

## Requisitos

- Node.js >= 20
- Backend corriendo en `http://localhost:9000` (ver `backend/README.md`)

---

## Instalación y ejecución

```bash
# 1. Clonar e instalar dependencias
cd cruise-connect-main
npm install

# 2. Copiar variables de entorno
cp .env.example .env

# 3. Arrancar en modo desarrollo
npm run dev
```

La app estará disponible en `http://localhost:5173`.

### Producción

```bash
npm run build      # genera dist/
npm run preview    # previsualiza el build
```

---

## Variables de entorno

| Variable | Valor por defecto | Descripción |
|----------|-------------------|-------------|
| `VITE_API_URL` | `http://localhost:9000/api` | URL base de la API REST |
| `VITE_SOCKET_URL` | `http://localhost:9000` | URL del servidor Socket.IO |

Edita `.env` para apuntar a entornos distintos (staging, producción, etc.).

---

## Tests

```bash
# Ejecutar todos los tests
npm test

# Con cobertura
npm run coverage

# Modo watch
npm run test:watch
```

Los tests usan **Vitest** con jsdom. Los componentes se testean con `@testing-library/react`.

---

## Docker

```bash
# Build de la imagen (nginx sirve el SPA + proxy a backend)
docker build -t city2cruise-frontend .

# Con docker-compose (incluye backend)
docker-compose up --build
```

El `nginx.conf` incluido hace proxy de `/api/` y `/socket.io/` al backend y sirve el SPA con fallback a `index.html`.

---

## Estructura del proyecto

```
cruise-connect-main/
├── public/
│   └── manifest.json         # PWA manifest
├── src/
│   ├── components/
│   │   ├── ui/               # shadcn/ui base components
│   │   ├── DriverMap.tsx     # Mapa leaflet para conductores
│   │   ├── NotificationBell.tsx
│   │   └── StatusBadge.tsx
│   ├── pages/
│   │   ├── LoginPage.tsx
│   │   ├── ClientDashboard.tsx
│   │   ├── DriverDashboard.tsx
│   │   └── AdminDashboard.tsx
│   ├── services/
│   │   └── api.ts            # Axios client (respeta VITE_API_URL)
│   ├── socket.ts             # Socket.IO client (respeta VITE_SOCKET_URL)
│   ├── context/AppContext.tsx
│   └── __tests__/            # Tests de componentes y páginas
├── .env.example
├── Dockerfile
├── nginx.conf
└── vite.config.ts
```

---

## Credenciales de demo

Después de ejecutar `cd backend && npm run seed-lp`:

| Rol | Email | Contraseña |
|-----|-------|------------|
| Administrador | `admin@demo.com` | `password123` |
| Cliente | `client@test.com` | `password123` |
| Conductor 1 | `driver1@demo.com` | `password123` |
| Conductor 2 | `driver2@demo.com` | `password123` |
| Conductor 3 | `driver3@demo.com` | `password123` |
