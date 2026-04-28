/**
 * Hito 6.4.1 — STRESS test: ramp incremental hasta encontrar punto de ruptura.
 *
 * Aumenta VUs cada 2 min (50 → 100 → 200 → 300 → 400 → 500). El test
 * documenta dónde p95 supera 2s o el error rate supera 5%.
 *
 * NO tiene thresholds de fallo: el objetivo ES romper para localizar el
 * límite. La salida debe analizarse a mano + grafana.
 */
import http from 'k6/http';
import { sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:9000';
const CLIENT_EMAIL = __ENV.CLIENT_EMAIL || 'client@test.com';
const CLIENT_PASSWORD = __ENV.CLIENT_PASSWORD || 'password123';

export const options = {
  scenarios: {
    stress: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 50 },
        { duration: '2m', target: 100 },
        { duration: '2m', target: 200 },
        { duration: '2m', target: 300 },
        { duration: '2m', target: 400 },
        { duration: '2m', target: 500 },
        { duration: '2m', target: 0 },
      ],
      gracefulRampDown: '60s',
    },
  },
  // Sin thresholds que fallen: queremos OBSERVAR el comportamiento
  thresholds: {},
};

export function setup() {
  const r = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify({
    email: CLIENT_EMAIL, password: CLIENT_PASSWORD,
  }), { headers: { 'Content-Type': 'application/json' } });
  return { token: r.json('token') };
}

export default function (data) {
  const headers = { Authorization: `Bearer ${data.token}` };
  http.get(`${BASE_URL}/api/requests/mine`, { headers });
  sleep(0.3);
}
