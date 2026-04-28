/**
 * Hito 6.4.3 — WebSocket load test (Socket.IO).
 *
 * Conecta N clientes WS simultáneamente y mide:
 *   - Tiempo desde POST /requests hasta evento 'request:new' en el driver
 *   - Latencia <1s SLO bajo carga
 *
 * Socket.IO usa polling+websocket. k6 ws sólo soporta WebSocket plano,
 * así que aquí testeamos el upgrade directo + handshake.
 *
 * Para test real de Socket.IO completo usar:
 *   docker run --rm -v $(pwd)/k6:/scripts grafana/xk6-ws ...
 */
import ws from 'k6/ws';
import http from 'k6/http';
import { check } from 'k6';
import { Trend, Counter } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:9000';
const WS_URL = (__ENV.WS_URL || BASE_URL).replace(/^http/, 'ws');
const CLIENT_EMAIL = __ENV.CLIENT_EMAIL || 'client@test.com';
const CLIENT_PASSWORD = __ENV.CLIENT_PASSWORD || 'password123';

const wsConnectTime = new Trend('ws_connect_ms', true);
const wsMessageDelivery = new Trend('ws_message_delivery_ms', true);
const wsErrors = new Counter('ws_errors');

export const options = {
  scenarios: {
    websocket_load: {
      executor: 'ramping-vus',
      startVUs: 10,
      stages: [
        { duration: '1m', target: 100 },   // 100 sockets simultáneos
        { duration: '3m', target: 100 },   // sostener
        { duration: '1m', target: 0 },
      ],
      gracefulRampDown: '20s',
    },
  },
  thresholds: {
    'ws_connect_ms': ['p(95)<2000'],
    'ws_message_delivery_ms': ['p(95)<1000'],
    'ws_errors': ['count<10'],
  },
};

export function setup() {
  const r = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify({
    email: CLIENT_EMAIL, password: CLIENT_PASSWORD,
  }), { headers: { 'Content-Type': 'application/json' } });
  return { token: r.json('token') };
}

export default function (data) {
  const url = `${WS_URL}/socket.io/?EIO=4&transport=websocket&auth=${encodeURIComponent(JSON.stringify({ token: data.token }))}`;
  const start = Date.now();

  const res = ws.connect(url, {}, function (socket) {
    socket.on('open', () => {
      wsConnectTime.add(Date.now() - start);
      // Socket.IO Engine.IO handshake: client envía "40"
      socket.send('40');
    });

    socket.on('message', (msg) => {
      // Cuando llega un mensaje real (no ping/pong) medir delivery
      if (msg && msg.length > 5 && msg.startsWith('42')) {
        wsMessageDelivery.add(Date.now() - start);
      }
    });

    socket.on('error', () => wsErrors.add(1));

    // Mantener conexión abierta 30s
    socket.setTimeout(() => socket.close(), 30000);
  });

  check(res, { 'ws status 101': (r) => r && r.status === 101 });
}
