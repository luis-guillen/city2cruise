/**
 * Hito 6.4.1 — SOAK test: 50 VUs sostenidas durante 2 horas para detectar
 * memory leaks / connection pool exhaustion / queue accumulation.
 *
 * Threshold:
 *   - latencia NO debe degradarse a lo largo del tiempo
 *   - error rate <1% sostenido
 */
import http from 'k6/http';
import { sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:9000';
const CLIENT_EMAIL = __ENV.CLIENT_EMAIL || 'client@test.com';
const CLIENT_PASSWORD = __ENV.CLIENT_PASSWORD || 'password123';

export const options = {
  scenarios: {
    soak: {
      executor: 'constant-vus',
      vus: 50,
      duration: '2h',
    },
  },
  thresholds: {
    'http_req_failed': ['rate<0.01'],
    'http_req_duration': ['p(95)<1000'],
    // Si la mediana se duplica entre primera y última hora → memory leak
    'http_req_duration{phase:start}': ['p(50)<400'],
    'http_req_duration{phase:end}': ['p(50)<500'],
  },
};

export function setup() {
  const r = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify({
    email: CLIENT_EMAIL, password: CLIENT_PASSWORD,
  }), { headers: { 'Content-Type': 'application/json' } });
  return { token: r.json('token'), startTime: Date.now() };
}

export default function (data) {
  const headers = { Authorization: `Bearer ${data.token}` };
  const elapsed = (Date.now() - data.startTime) / 1000 / 60;  // minutos
  const phase = elapsed < 30 ? 'start' : elapsed > 90 ? 'end' : 'mid';
  const r = http.get(`${BASE_URL}/api/requests/mine`, { headers, tags: { phase } });
  sleep(2);
}
