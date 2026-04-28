/**
 * Hito 4.3.5 — Spike test: 200 VUs durante 30s para detectar leaks.
 *
 *   k6 run --env BASE_URL=http://localhost:9000 k6/phase4-spike.js
 */
import http from 'k6/http';
import { sleep } from 'k6';

export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '15s', target: 200 },
        { duration: '30s', target: 200 },
        { duration: '15s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<800'],
    http_req_failed: ['rate<0.05'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:9000';

export default function () {
  http.get(`${BASE_URL}/api/health`);
  sleep(0.2);
}
