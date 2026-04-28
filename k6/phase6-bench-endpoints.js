/**
 * Hito 6.4.2 — Benchmark por endpoint con SLOs específicos.
 *
 * Mide p50/p90/p95/p99 por endpoint y aplica los SLOs:
 *   - reads (GET):  p95 < 200ms
 *   - writes (POST/PATCH/DELETE): p95 < 500ms
 *
 * Output incluye un breakdown por endpoint que se exporta a JSON para
 * incluirlo en el "Informe de capacidad" (Hito 6.4.4).
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:9000';
const CLIENT_EMAIL = __ENV.CLIENT_EMAIL || 'client@test.com';
const CLIENT_PASSWORD = __ENV.CLIENT_PASSWORD || 'password123';

// Trends por endpoint
const tHealth = new Trend('endpoint_health', true);
const tMine = new Trend('endpoint_get_mine', true);
const tHistory = new Trend('endpoint_get_history', true);
const tCreate = new Trend('endpoint_post_create', true);
const tNotifs = new Trend('endpoint_get_notifs', true);

export const options = {
  scenarios: {
    bench: {
      executor: 'constant-vus',
      vus: 30,
      duration: '5m',
    },
  },
  thresholds: {
    'endpoint_health': ['p(95)<100'],            // SLO health: <100ms
    'endpoint_get_mine': ['p(95)<200'],          // SLO read: <200ms
    'endpoint_get_history': ['p(95)<300'],       // SLO read pesado (paginated)
    'endpoint_get_notifs': ['p(95)<200'],
    'endpoint_post_create': ['p(95)<500'],       // SLO write: <500ms
    'http_req_failed': ['rate<0.005'],
  },
};

export function setup() {
  const r = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify({
    email: CLIENT_EMAIL, password: CLIENT_PASSWORD,
  }), { headers: { 'Content-Type': 'application/json' } });
  return { token: r.json('token') };
}

export default function (data) {
  const auth = { Authorization: `Bearer ${data.token}` };
  const json = { ...auth, 'Content-Type': 'application/json' };

  // 1. /health (sin auth)
  const h = http.get(`${BASE_URL}/health`);
  tHealth.add(h.timings.duration);

  // 2. /api/requests/mine (read autenticado)
  const m = http.get(`${BASE_URL}/api/requests/mine`, { headers: auth });
  tMine.add(m.timings.duration);

  // 3. /api/requests/history (read pesado paginated)
  const hist = http.get(`${BASE_URL}/api/requests/history?limit=20`, { headers: auth });
  tHistory.add(hist.timings.duration);

  // 4. /api/notifications (read)
  const n = http.get(`${BASE_URL}/api/notifications`, { headers: auth });
  tNotifs.add(n.timings.duration);

  // 5. /api/requests (write) — sólo cada 5 iter para no saturar DB
  if (Math.random() < 0.2) {
    const c = http.post(`${BASE_URL}/api/requests`, JSON.stringify({
      location: 'Las Palmas',
      latitude: 28.1235, longitude: -15.4363,
      packageSize: 'SMALL',
    }), { headers: json });
    tCreate.add(c.timings.duration);
  }

  sleep(1);
}

export function handleSummary(data) {
  const summary = {};
  ['endpoint_health','endpoint_get_mine','endpoint_get_history',
   'endpoint_get_notifs','endpoint_post_create'].forEach(name => {
    const m = data.metrics[name];
    if (m) {
      summary[name] = {
        p50: m.values['p(50)'],
        p90: m.values['p(90)'],
        p95: m.values['p(95)'],
        p99: m.values['p(99)'],
        avg: m.values.avg,
        count: m.values.count,
      };
    }
  });
  return {
    'k6/.results/bench-endpoints.json': JSON.stringify({ generated: new Date().toISOString(), summary }, null, 2),
    stdout: JSON.stringify(summary, null, 2),
  };
}
