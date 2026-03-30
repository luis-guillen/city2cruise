# Load Testing — City2Cruise

Tests de carga con [k6](https://k6.io/) para el backend de City2Cruise.

## Requisitos

1. Instalar k6:
   ```bash
   # macOS
   brew install k6

   # Linux
   sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
     --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
   echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
     | sudo tee /etc/apt/sources.list.d/k6.list
   sudo apt-get update && sudo apt-get install k6
   ```

2. Tener el backend corriendo:
   ```bash
   cd backend && npm run dev
   ```

3. Asegurarse de que existe el usuario de test en la base de datos:
   ```bash
   cd backend && npm run seed-bcn
   ```

## Ejecutar los tests

### Todos los escenarios (smoke → average → peak)
```bash
k6 run k6/load-test.js
```

### Con URL personalizada
```bash
k6 run -e BASE_URL=http://mi-servidor:9000 k6/load-test.js
```

### Solo un escenario
```bash
# Smoke (5 VUs, 30s) — validación rápida
k6 run --scenario smoke k6/load-test.js

# Average load (50 VUs, 2min) — carga normal
k6 run --scenario average k6/load-test.js

# Peak load (200 VUs, 1min) — pico de tráfico
k6 run --scenario peak k6/load-test.js
```

### Con salida detallada a JSON
```bash
k6 run --out json=results.json k6/load-test.js
```

## Escenarios

| Escenario | VUs | Duración | Inicio |
|-----------|-----|----------|--------|
| `smoke`   | 5   | 30s      | 0s     |
| `average` | 50  | 2min     | 35s    |
| `peak`    | 200 | 1min     | 160s   |

## Thresholds

| Métrica | Umbral |
|---------|--------|
| `http_req_duration` | p(95) < 500ms |
| `http_req_failed`   | tasa < 5%     |

## Flujo simulado por usuario virtual

1. `POST /api/auth/login` — autenticación
2. `GET /api/requests/mine` — obtener solicitud activa
3. `POST /api/requests` — crear nueva solicitud (si no hay activa)
4. `sleep(1–3s)` — pausa realista entre acciones
