# Guía de capturas para la memoria del TFM

Pasos para obtener capturas reales y coherentes de la aplicación City2Cruise,
en particular del panel **"Ranking de IA"** de la Torre de Control (ya funcional
tras cablear el evento `rl:rankings`).

## 0. Requisito previo: modelo entrenado

El agente PPO ya está entrenado y versionado en `rl_service/artifacts/`
(`cruise_dispatch_ppo.zip`). El microservicio lo carga automáticamente al
arrancar (`RL_MODEL_PATH` por defecto apunta a esa carpeta). Para reentrenar:

```bash
cd rl_service && ./.venv/bin/python -m rl_service.train_tfm --timesteps 100000
```

## 1. Levantar el stack (con RL activado)

`docker-compose.dev.yml` ya trae `RL_ROUTING_ENABLED=true` y el servicio
`rl_service`. Levanta todo:

```bash
docker compose -f docker-compose.dev.yml up --build
```

Comprueba que el microservicio RL responde y sirve el modelo entrenado:

```bash
curl -s http://localhost:8080/health          # {"status":"ok"...}
curl -s http://localhost:8080/metrics          # modelVersion=ppo-v2, modelExists=true
```

## 2. Captura del panel "Ranking de IA" (Torre de Control)

1. Asegúrate de tener **conductores demo conectados** (drivercerca / drivermedio /
   driverlejos) para que el estado tenga conductores que rankear.
2. Inicia sesión como **admin** y abre la **Torre de Control** (`ControlTowerPage`).
3. En otra sesión/pestaña, como **crucerista**, crea una **solicitud de recogida**.
   Esto dispara la cascada de despacho (`GeoDispatchService`), que llama al agente
   PPO y **emite `rl:rankings`** con `{requestId, rankings, modelVersion, inferenceMs}`.
4. En la Torre de Control, **selecciona esa solicitud**. El panel pasará de
   "ANALIZANDO…" a **"IA LISTA"** y mostrará la tabla de conductores ordenados por
   puntuación del PPO, con la cabecera `ppo-v2 · N ms`.
5. Captura el panel. → **Figuras 6 y 12** de la memoria (vista crucerista y vista
   conductor con asignación del agente PPO).

> Si el panel se queda en "ANALIZANDO…": revisa que `RL_ROUTING_ENABLED=true`, que
> `rl_service` esté arriba (`/health`), y que haya conductores elegibles (conectados
> y en radio, o sin GPS aún). El evento solo se emite cuando el agente produce un
> ranking no vacío.

## 3. Resto de capturas que usa la memoria

| Figura | Qué capturar | Dónde |
|--------|--------------|-------|
| Fig. 6 | Pantalla del crucerista buscando conductor (con panel IA) | ClientDashboard + Torre |
| Fig. 7 | Recibo digital de custodia (hash de bloque, quórum, "VALIDADO POR BLOCKCHAIN") | Tras completar un depósito |
| Fig. 8 | Verificación doble factor PIN + GPS al abrir el locker | Flujo conductor→locker |
| Fig. 12 | Interfaz del conductor con asignación activa y ruta al locker | DriverDashboard |

## 4. Figuras de resultados (ya generadas, no requieren captura)

Las Figuras 9, 10 y 11 (convergencia, comparativa de políticas y reality gap) ya
se han regenerado con datos reales del entrenamiento y están insertadas en
`Memoria_TFM_v2.1.docx`. Sus fuentes están en `rl_service/artifacts/`
(`rewards.csv`, `benchmark.json`, `fidelity.json`).
