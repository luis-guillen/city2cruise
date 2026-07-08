# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**City2Cruise — Shop&Drop Port Hub** is a last-mile logistics platform for cruise ship passengers in Barcelona. It enables tourists to drop off urban purchases at smart lockers near the port with complete traceability and real-time notifications.

Key roles: Cruise passenger (client), driver (collection & deposit), admin (user management & analytics).

## Common Development Commands

### Setup & Installation
```bash
npm install                    # Install dependencies
cp .env.example .env          # Set up environment variables
npm run start:all             # Run frontend + backend together (spawns dev servers on ports 9100 & 9000)
```

### Development
```bash
npm run dev                   # Start Vite dev server (http://localhost:9100)
npm run dev:backend           # Start backend (http://localhost:9000)
npm run build                 # Production build → dist/
npm run preview               # Preview production build locally
npm run build:analyze         # Generate bundle analysis (check dist/bundle-stats.html)
```

### Testing
```bash
npm test                      # Run all unit tests (Vitest, jsdom)
npm run test:watch           # Watch mode for tests
npm run test:a11y            # Run accessibility tests
npm run test:a11y:strict     # Strict a11y tests (A11Y_STRICT=1)
npm run coverage             # Generate coverage report
```

### E2E Testing (Playwright)
```bash
npm run e2e                  # Run all E2E tests
npm run e2e:ui               # Interactive Playwright UI mode
npm run e2e:debug            # Debug mode with step-by-step control
npm run e2e:install          # Install Playwright browsers & dependencies
npm run e2e:report           # View HTML report from last run
```

### Linting & Code Quality
```bash
npm run lint                 # Run ESLint checks
npm run db:reset             # Reset backend database (runs `cd ../backend && npm run db:reset`)
```

### Docker
```bash
docker build -t city2cruise-frontend .
docker-compose up --build    # Full stack with backend
```

## Architecture

### High-Level Structure

```
Frontend (React SPA) ──HTTP REST──> Backend (Node.js + Express)
   :9100               WebSocket         :9000
     │                 (Socket.IO)         │
     └────────────────────────┬────────────┘
                              │
                         SQLite DB
                       (better-sqlite3)
```

### Frontend Architecture

**Stack:** React 18 + Vite + TypeScript + Tailwind CSS + shadcn/ui + Leaflet Maps

**Key Layers:**
- **Pages** (`src/pages/`): Five main page components
  - `LoginPage.tsx` — Authentication
  - `ClientDashboard.tsx` — Cruise passenger interface (request pickups, track status)
  - `DriverDashboard.tsx` — Driver interface (accept jobs, real-time location)
  - `AdminDashboard.tsx` — Admin analytics & user management
  - `ControlTowerPage.tsx` — Dispatch/monitoring center
  
- **Components** (`src/components/`): Reusable UI building blocks
  - `ClientTrackingMap.tsx` — Real-time passenger tracking (uses Leaflet + Socket.IO)
  - `DriverMap.tsx` — Driver's live map with nearby pickup requests
  - `NotificationBell.tsx` — Real-time notifications
  - `StatusBadge.tsx` — Order status display
  - `ui/` — Base shadcn/ui components (dialogs, buttons, forms, etc.)
  
- **Services** (`src/services/api.ts`): Axios HTTP client respecting `VITE_API_URL`
  
- **Socket.IO** (`src/socket.ts`): Real-time client (respects `VITE_SOCKET_URL`)
  
- **Context** (`src/context/`): Global state
  - `AppContext.tsx` — User auth, current order, UI state
  - `AccessibilityContext.tsx` — A11y preferences (colors, focus management)
  
- **Tests** (`src/__tests__/`): Vitest + @testing-library/react
  
- **Utils** (`src/utils/`): Helpers
  - `geofence.ts` — Geo-distance calculations
  - `routing.ts` — Navigation utilities
  - `sanitize.ts` — DOMPurify for XSS prevention
  - `throttle.ts` — Debounce/throttle for map interactions
  - `errors.ts` — Error parsing
  - `logger.ts` — Client-side logging (Sentry)

### Key Technical Decisions

1. **Environment Variables**: Two main URLs
   - `VITE_API_URL` (default: `http://localhost:9000/api`) — REST API base
   - `VITE_SOCKET_URL` (default: `http://localhost:9000`) — WebSocket server

2. **PWA Strategy** (vite-plugin-pwa + Workbox):
   - Registration type: `"prompt"` (user decides when to refresh, not auto-refresh)
   - API calls: NetworkFirst (5s timeout, offline fallback to cache)
   - Static assets (.js, .css, .woff2, .ttf): CacheFirst (30-day expiry)
   - OSM tiles: CacheFirst (30-day expiry) — **must precede image cache rule** to avoid opaque response caching issues
   - HTML/navigation: StaleWhileRevalidate

3. **Code Splitting** (manual chunks in vite.config.ts):
   - `leaflet` — Leaflet + react-leaflet
   - `recharts` — Chart library
   - `radix` — Radix UI components
   - `stripe` — Stripe integration
   - `date` — date-fns + react-day-picker
   - `router` — react-router-dom
   - `query` — TanStack Query
   - `i18n` — i18next + react-i18next
   - `vendor` — other node_modules

4. **Form Validation**: Zod schemas (single-source-of-truth with backend via `@city2cruise/api-types` alias pointing to `../backend/src/schemas`)

5. **Map Library**: Leaflet + react-leaflet for OpenStreetMap
   - Real-time driver location updates via Socket.IO
   - Marker clustering for multiple drivers

6. **Real-Time Communication**: Socket.IO for:
   - Driver location broadcasting
   - Order status changes
   - Notifications
   - Handshake verification between passenger & driver

7. **Accessibility (A11y)**:
   - ARIA attributes, semantic HTML
   - Keyboard navigation
   - Color contrast testing (axe-core)
   - Separate test suite: `npm run test:a11y`

8. **Testing Strategy**:
   - Unit tests: Vitest + jsdom
   - E2E tests: Playwright (see `e2e/` directory)
   - Coverage target: tracked via `npm run coverage`
   - A11y: axe-core integrated (`vitest-axe`)

9. **CSS**: Tailwind CSS v3 + shadcn/ui components
   - No custom CSS outside Tailwind (DRY principle)
   - PostCSS for polyfills

10. **State Management**: React Context + TanStack Query (React Query)
    - Auth context in `AppContext`
    - Server state (API responses) via React Query

## Code Patterns

### Protected Routes
Routes require authentication via `<ProtectedRoute>` wrapper. JWT stored in localStorage, validated on app load.

### Real-Time Updates
- **Maps**: Leaflet map re-renders on Socket.IO `driver:location` events
- **Notifications**: Sonner toast library (non-blocking, auto-dismiss)
- **Orders**: Order state synced via WebSocket, reflected in context

### API Integration
All HTTP calls through `services/api.ts` (Axios instance). No raw fetch().
```typescript
import api from "@/services/api";
api.get('/orders/1').then(...)
```

### Form Handling
Use React Hook Form with Zod schema validation (colocated in forms or imported from backend schemas).

### Accessibility
- Use semantic HTML (not just divs)
- Add `aria-label` for icon-only buttons
- Test with: `npm run test:a11y`
- Keyboard navigation required for all interactive elements

## Environment Variables

Create `.env` from `.env.example`:
```
VITE_API_URL=http://localhost:9000/api
VITE_SOCKET_URL=http://localhost:9000
```

For staging/production, adjust URLs accordingly.

## Critical Dependencies

- **React 18.3** — UI framework
- **Vite 6.0** — Build tool & dev server
- **TypeScript 5.8** — Type safety
- **Tailwind 3.4** — Utility CSS
- **shadcn/ui** — Component library (Radix UI primitives + Tailwind)
- **Leaflet 1.9** — Map rendering (OSM)
- **Socket.IO Client 4.8** — Real-time WebSocket
- **axios 1.15** — HTTP client
- **React Router 6.30** — Page routing
- **TanStack Query 5.83** — Server state management
- **react-hook-form 7.61** — Form state
- **zod 3.25** — Schema validation
- **sonner 1.7** — Toast notifications
- **Vitest 3.2** — Unit testing (jsdom environment)
- **Playwright 1.59** — E2E testing

## Known Issues & Technical Notes

1. **Map Tile Caching**: OSM tiles rule in `vite.config.ts` must come **before** the general images cache rule. Cached opaque cross-origin responses can cause `ERR_FAILED` on subsequent loads.

2. **PWA Update Strategy**: Uses `registerType: "prompt"` instead of auto-refresh to avoid interrupting user actions (e.g., during order submission).

3. **Bundle Size**: Chunk size warning limit set to 500KB. Monitor via `npm run build:analyze`.

4. **A11y Test Strictness**: Two levels:
   - Standard: `npm run test:a11y`
   - Strict: `npm run test:a11y:strict` (requires `A11Y_STRICT=1` env var)

5. **Backend Dependency**: Backend must be running on `:9000` for frontend dev server to work properly (API calls, WebSocket connections).

6. **Database Schema**: Frontend consumes API contracts (Zod schemas) from backend at `../backend/src/schemas` via `@city2cruise/api-types` alias. Keep in sync with backend.

## Project-Specific Conventions

1. **File Naming**: Components are `.tsx`, utilities are `.ts`, tests are `.test.tsx`
2. **No Custom CSS**: All styling via Tailwind classes. No separate .css files for component styles.
3. **Single Source of Truth**: API types defined in backend, imported into frontend via alias
4. **Socket.IO Events**: Namespaced (e.g., `driver:location`, `order:updated`)
5. **Error Handling**: Use `src/utils/errors.ts` to parse API errors for user-friendly messages
6. **Logging**: Use `src/observability/sentry.ts` for production error tracking

## Getting Help

- Technical architecture: See `MEMORIA_TECNICA.md` (Spanish, comprehensive)
- Frontend troubleshooting: Check component tests in `__tests__/`
- E2E test issues: Review `playwright.config.ts` and `e2e/` directory
