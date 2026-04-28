"""
Hito 5.4.2 — Sim-to-Real bridge entre rl_service y digital_twin.

Permite:
  1. Tirar del estado del twin como fuente de entrenamiento online
     (en lugar de o en complemento al gym sintético).
  2. Exponer un endpoint /train_from_twin que ejecuta N escenarios
     del twin y entrena el agente sobre las trayectorias resultantes.
  3. Exportar el modelo entrenado a un path que el backend pueda
     cargar (RL_MODEL_PATH) — esto cierra el ciclo sim-to-real:

     digital_twin → rl_service.train → modelo .zip → backend usa modelo

Uso (desde main.py):
    from .twin_bridge import TwinClient, train_with_twin_scenarios

API HTTP esperada del twin:
    GET  /state                     → TwinSnapshot
    POST /scenario/run              → ScenarioResult
"""
from __future__ import annotations

import os
import time
from typing import Any, Optional

import httpx


DEFAULT_TWIN_URL = os.environ.get("TWIN_URL", "http://localhost:8090")


class TwinClient:
    """Cliente HTTP minimalista para el Digital Twin."""

    def __init__(self, base_url: Optional[str] = None, timeout: float = 10.0) -> None:
        self.base_url = (base_url or DEFAULT_TWIN_URL).rstrip("/")
        self._timeout = timeout

    def health(self) -> dict[str, Any]:
        with httpx.Client(timeout=self._timeout) as c:
            r = c.get(f"{self.base_url}/health")
            r.raise_for_status()
            return r.json()

    def get_state(self) -> dict[str, Any]:
        """Snapshot completo del twin."""
        with httpx.Client(timeout=self._timeout) as c:
            r = c.get(f"{self.base_url}/state")
            r.raise_for_status()
            return r.json()

    def get_aggregates(self) -> dict[str, Any]:
        with httpx.Client(timeout=self._timeout) as c:
            r = c.get(f"{self.base_url}/state/aggregates")
            r.raise_for_status()
            return r.json()

    def run_scenario(
        self,
        name: str,
        duration_minutes: int = 60,
        request_rate_per_min: float = 2.0,
        drivers_online: int = 10,
        seed: Optional[int] = None,
    ) -> dict[str, Any]:
        """Ejecuta un escenario sintético en el twin y devuelve métricas."""
        body = {
            "name": name,
            "duration_minutes": duration_minutes,
            "request_rate_per_min": request_rate_per_min,
            "drivers_online": drivers_online,
        }
        if seed is not None:
            body["seed"] = seed
        with httpx.Client(timeout=self._timeout * 3) as c:
            r = c.post(f"{self.base_url}/scenario/run", json=body)
            r.raise_for_status()
            return r.json()


def train_with_twin_scenarios(
    agent: Any,
    twin: Optional[TwinClient] = None,
    n_scenarios: int = 5,
    minutes_per_scenario: int = 30,
    drivers_online: int = 10,
    request_rate: float = 2.0,
) -> dict[str, Any]:
    """
    Entrena el agente sobre N escenarios del twin.

    Implementación stub Hito 5.4.2: ejecuta los escenarios para generar
    métricas de "performance bajo demanda real-ish" y arranca un train()
    del agente con timesteps proporcionales. La pipeline completa
    (extraer trayectorias específicas del twin como replay buffer)
    se difiere a 5.4.3 cuando el twin tenga telemetría real.
    """
    twin = twin or TwinClient()
    started_at = time.time()
    scenario_results: list[dict[str, Any]] = []

    for i in range(n_scenarios):
        result = twin.run_scenario(
            name=f"sim2real-{i}",
            duration_minutes=minutes_per_scenario,
            request_rate_per_min=request_rate,
            drivers_online=drivers_online,
            seed=42 + i,
        )
        scenario_results.append(result)

    # Ejecutar training del agente con steps proporcionales al volumen simulado
    total_requests = sum(r["requests_simulated"] for r in scenario_results)
    timesteps = max(2_000, total_requests * 100)  # heurística: 100 steps por request

    train_metrics = agent.train(total_timesteps=timesteps) if hasattr(agent, "train") else {
        "skipped": True,
        "reason": "agent.train not callable",
    }

    return {
        "elapsed_seconds": round(time.time() - started_at, 2),
        "n_scenarios": n_scenarios,
        "total_simulated_requests": total_requests,
        "train_timesteps": timesteps,
        "train_metrics": train_metrics,
        "scenarios": scenario_results,
    }
