/**
 * Hito 4.3.5 — Load test 100 concurrent users (criterio aceptacion).
 *
 * Objetivo: 100 VUs sostenidas durante 2 minutos, p95 < 500 ms, 0 errores 5xx.
 *
 * Uso:
 *   k6 run --env BASE_URL=http://localhost:9000 \
 *          --env CLIENT_EMAIL=client@test.com \
 *          --env CLIENT_PASSWORD=password123 \
 *          k6/phase4-100c.js
 *
 * Reporte HTML:
 *   K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_EXPORT=k6-report.html \
 *   k6 run k6/phase4-100c.js
 */
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Counter, Rate } from 'k6/metrics';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.2/index.js';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:9000';
const CLIENT_EMAIL = __ENV.CLIENT_EMAIL || 'client@test.com';
const CLIENT_PASSWORD = __ENV.CLIENT_PASSWORD || 'password123';

const errors5xx = new Counter('http_errors_5xx');
const authFailures = new Rate('auth_failures');

export const options = {
  scenarios: {
    p4_100c: {
      executor: 'constant-vus',
      vus: 100,
      duration: '2m',
      tags: { milestone: '4.3.5' },
    },
  },
  thresholds: {
    // Criterios de aceptacion del Hito 4.3.5
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.01'],
    http_errors_5xx: ['count==0'],          // 0 errores 5xx
    auth_failures: ['rate<0.05'],
  },
  summaryTrendStats: ['min', 'avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const HEADERS_JSON = { 'Content-Type': 'application/json' };

export function setup() {
  // Pre-login una vez por VU para evitar throttling del rate limiter
  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email: CLIENT_EMAIL, password: CLIENT_PASSWORD }),
    { headers: HEADERS_JSON },
  );
  if (res.status !== 200) {
    throw new Error(`Setup login failed: ${res.status} ${res.body}`);
  }
  const token = JSON.parse(res.body).token;
  return { token };
}

export default function (data) {
  const auth = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${data.token}`,
  };

  group('GET /api/lockers', () => {
    const r = http.get(`${BASE_URL}/api/lockers`, { headers: auth });
    if (r.status >= 500) errors5xx.add(1);
    check(r, {
      'lockers 2xx/3xx': (x) => x.status < 400,
      'lockers <500ms': (x) => x.timings.duration < 500,
    });
  });

  group('GET /api/requests/mine', () => {
    const r = http.get(`${BASE_URL}/api/requests/mine`, { headers: auth });
    if (r.status >= 500) errors5xx.add(1);
    check(r, {
      'mine 2xx/4xx': (x) => x.status === 200 || x.status === 404,
      'mine <500ms': (x) => x.timings.duration < 500,
    });
  });

  group('GET /api/notifications', () => {
    const r = http.get(`${BASE_URL}/api/notifications`, { headers: auth });
    if (r.status === 401 || r.status === 403) authFailures.add(1);
    if (r.status >= 500) errors5xx.add(1);
    check(r, {
      'notifs 2xx/4xx': (x) => x.status < 500,
      'notifs <500ms': (x) => x.timings.duration < 500,
    });
  });

  sleep(0.5);
}

export function handleSummary(data) {
  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    'k6-summary.json': JSON.stringify(data, null, 2),
  };
}
