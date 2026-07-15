# Guía de capturas para la memoria del TFM

Pasos para obtener capturas reales y coherentes de la aplicación City2Cruise,
en particular del panel **"Ranking de IA"** de la Torre de Control (ya funcional
tras cablear el evento `rl:rankings`).

## 0. Requisito previo: modelo entrenado

El agente PPO ya está entrenado y versionado en `rl_service/artifacts/`
(`cruise_dispatch_ppo.zip`, modelo `ppo-v3-anticipatory`: +16,7 % sobre el
greedy en el entorno anticipatorio). El microservicio lo carga automáticamente
al arrancar (`RL_MODEL_PATH` por defecto apunta a esa carpeta). Para
reproducir el entrenamiento canónico (BC warm-start + fine-tuning PPO):

```bash
./rl_service/.venv/bin/python scripts/bc_warmstart.py
./rl_service/.venv/bin/python -m rl_service.train_tfm \
  --init-from rl_service/artifacts/bc_init \
  --timesteps 600000 --learning-rate 1e-4 --ent-coef 0.003
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
curl -s http://localhost:8080/metrics          # modelVersion=ppo-v3-anticipatory, modelExists=true
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
   puntuación del PPO, con la cabecera `ppo-v3-anticipatory · N ms`.
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

Las Figuras 9, 10 y 11 (convergencia, comparativa de políticas y reality gap)
están regeneradas con los datos reales del modelo `ppo-v3-anticipatory`
(PPO 1819,4 > patient 1711,2 > greedy 1558,6 > cascade 1349,1 > random 1303,5;
N = 1000 episodios pareados) e insertadas en `Memoria_TFM_v2.1.docx`. Se
reproducen con `python scripts/plot_tfm_figures.py` a partir de
`rl_service/artifacts/` (`rewards.csv`, `benchmark.json`, `fidelity.json`);
los PNG viven en `docs/figures/`.
