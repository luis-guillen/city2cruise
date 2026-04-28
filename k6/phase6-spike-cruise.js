/**
 * Hito 6.4.1 — Carga PICO simulando llegada de crucero.
 *
 * Patrón: 200 VUs en 2 minutos (ramp-up agresivo), sostener 5 min, ramp-down.
 * Simula 2000 pasajeros bajando del crucero y abriendo la app.
 *
 * Threshold:
 *   - p95 < 1000ms bajo carga pico (más permisivo que normal)
 *   - <1% errors
 */
import http from 'k6/http';
import { sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:9000';
const CLIENT_EMAIL = __ENV.CLIENT_EMAIL || 'client@test.com';
const CLIENT_PASSWORD = __ENV.CLIENT_PASSWORD || 'password123';

export const options = {
  scenarios: {
    cruise_arrival: {
      executor: 'ramping-vus',
      startVUs: 10,
      stages: [
        { duration: '2m', target: 200 },   // pico llegada
        { duration: '5m', target: 200 },   // sostener
        { duration: '2m', target: 50 },    // se dispersan
        { duration: '1m', target: 0 },     // se acaba el día
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    'http_req_failed': ['rate<0.01'],
    'http_req_duration': ['p(95)<1000'],
  },
};

export function setup() {
  const r = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify({
    email: CLIENT_EMAIL, password: CLIENT_PASSWORD,
  }), { headers: { 'Content-Type': 'application/json' } });
  return { token: r.json('token') };
}

export default function (data) {
  const headers = { Authorization: `Bearer ${data.token}`, 'Content-Type': 'application/json' };

  // 70% lecturas, 30% escrituras (patrón realista de pasajeros consultando)
  if (Math.random() < 0.7) {
    http.get(`${BASE_URL}/api/requests/mine`, { headers });
  } else {
    http.post(`${BASE_URL}/api/requests`, JSON.stringify({
      location: 'Puerto de Las Palmas',
      latitude: 28.1230, longitude: -15.4370,
      packageSize: 'SMALL',
    }), { headers });
  }
  sleep(0.5 + Math.random() * 1.5);
}
