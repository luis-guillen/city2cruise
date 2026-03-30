import { check, sleep } from 'k6';
import http from 'k6/http';

// ── Configuration ─────────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || 'http://localhost:9000';

export const options = {
  scenarios: {
    smoke: {
      executor: 'constant-vus',
      vus: 5,
      duration: '30s',
      tags: { scenario: 'smoke' },
    },
    average: {
      executor: 'constant-vus',
      vus: 50,
      duration: '2m',
      startTime: '35s', // starts after smoke
      tags: { scenario: 'average' },
    },
    peak: {
      executor: 'constant-vus',
      vus: 200,
      duration: '1m',
      startTime: '160s', // starts after average
      tags: { scenario: 'peak' },
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.05'],
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const HEADERS_JSON = { 'Content-Type': 'application/json' };

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const PICKUP_LOCATIONS = [
  { address: 'Puerto de Barcelona, Moll de la Fusta', lat: 41.3760, lon: 2.1812 },
  { address: 'La Barceloneta, Barcelona', lat: 41.3795, lon: 2.1886 },
  { address: 'Passeig de Gràcia 43, Barcelona', lat: 41.3960, lon: 2.1618 },
  { address: 'Mercat de la Boqueria, Barcelona', lat: 41.3818, lon: 2.1722 },
];

// ── Virtual User Flow ─────────────────────────────────────────────────────────

export default function () {
  // Step 1 — Login
  const loginPayload = JSON.stringify({
    email: 'client@test.com',
    password: 'password123',
  });

  const loginRes = http.post(`${BASE_URL}/api/auth/login`, loginPayload, {
    headers: HEADERS_JSON,
  });

  const loginOk = check(loginRes, {
    'login status 200': (r) => r.status === 200,
    'login returns token': (r) => {
      try {
        return JSON.parse(r.body).token !== undefined;
      } catch {
        return false;
      }
    },
  });

  if (!loginOk) {
    sleep(1);
    return;
  }

  const token = JSON.parse(loginRes.body).token;
  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  // Step 2 — GET current request
  const mineRes = http.get(`${BASE_URL}/api/requests/mine`, {
    headers: authHeaders,
  });

  check(mineRes, {
    'mine status 200 or 404': (r) => r.status === 200 || r.status === 404,
  });

  // Step 3 — Create a new pickup request (only if no active request)
  if (mineRes.status === 404 || (mineRes.status === 200 && JSON.parse(mineRes.body) === null)) {
    const loc = PICKUP_LOCATIONS[randomInt(0, PICKUP_LOCATIONS.length - 1)];
    const requestPayload = JSON.stringify({
      pickupLocation: loc.address,
      latitude: loc.lat + (Math.random() * 0.002 - 0.001),
      longitude: loc.lon + (Math.random() * 0.002 - 0.001),
      packageSize: ['SMALL', 'MEDIUM', 'LARGE'][randomInt(0, 2)],
    });

    const createRes = http.post(`${BASE_URL}/api/requests`, requestPayload, {
      headers: authHeaders,
    });

    check(createRes, {
      'create request status 200': (r) => r.status === 200,
    });
  }

  // Step 4 — Wait
  sleep(randomInt(1, 3));
}
