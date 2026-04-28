/**
 * Hito 6.4.1 — Carga normal: 50 VUs durante 10 min.
 *
 * Objetivos:
 *   - p95 < 500 ms en operaciones de escritura
 *   - p95 < 200 ms en operaciones de lectura
 *   - 0 errores 5xx
 *   - tasa éxito >99.5%
 */
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Counter } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:9000';
const CLIENT_EMAIL = __ENV.CLIENT_EMAIL || 'client@test.com';
const CLIENT_PASSWORD = __ENV.CLIENT_PASSWORD || 'password123';

const writeLatency = new Trend('write_latency_ms', true);
const readLatency = new Trend('read_latency_ms', true);
const errors5xx = new Counter('http_5xx');

export const options = {
  scenarios: {
    normal_load: {
      executor: 'constant-vus',
      vus: 50,
      duration: '10m',
    },
  },
  thresholds: {
    'http_req_failed': ['rate<0.005'],     // <0.5% errores
    'http_5xx': ['count<10'],
    'write_latency_ms': ['p(95)<500'],
    'read_latency_ms': ['p(95)<200'],
  },
};

let token = null;

export function setup() {
  const r = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify({
    email: CLIENT_EMAIL, password: CLIENT_PASSWORD,
  }), { headers: { 'Content-Type': 'application/json' } });
  return { token: r.json('token') };
}

export default function (data) {
  const headers = { Authorization: `Bearer ${data.token}` };

  group('reads', () => {
    const r = http.get(`${BASE_URL}/api/requests/mine`, { headers });
    readLatency.add(r.timings.duration);
    if (r.status >= 500) errors5xx.add(1);
    check(r, { 'GET /requests/mine status<500': (x) => x.status < 500 });
  });

  group('writes', () => {
    const r = http.post(`${BASE_URL}/api/requests`, JSON.stringify({
      location: 'Las Palmas centro',
      latitude: 28.1235 + Math.random() * 0.01,
      longitude: -15.4363 + Math.random() * 0.01,
      packageSize: 'SMALL',
    }), { headers: { ...headers, 'Content-Type': 'application/json' } });
    writeLatency.add(r.timings.duration);
    if (r.status >= 500) errors5xx.add(1);
  });

  sleep(1 + Math.random());
}
