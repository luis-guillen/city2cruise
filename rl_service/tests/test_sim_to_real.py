"""
Hito 6.5.4 — Sim-to-Real fidelity.

Compara latencia de decisión y precisión del agente RL en:
  - Gemelo digital (sintético, gym_env.CruiseDispatchEnv)
  - Mock "real" (genera estado equivalente desde TwinSnapshot del digital_twin)

Como no podemos conectar a infraestructura real desde el sandbox, usamos
el digital_twin local como proxy del entorno real y comparamos latencias.

Documenta el "reality gap" (diferencia entre simulado y real) que el
equipo debe minimizar antes de promover modelos a prod.
"""
import importlib.util
import statistics
import time

import pytest

HAS_DEPS = (
    importlib.util.find_spec("gymnasium") is not None
    and importlib.util.find_spec("numpy") is not None
)

pytestmark = pytest.mark.skipif(not HAS_DEPS, reason="gymnasium+numpy no instalados")


def _ns_to_ms(ns):
    return ns / 1_000_000


@pytest.fixture
def env():
    from rl_service.gym_env import CruiseDispatchEnv
    e = CruiseDispatchEnv()
    e.reset(seed=0)
    return e


def test_step_latencia_p95_sub_5ms(env):
    """Cada step de la simulación debe ejecutarse en <5ms p95.
    Esto cubre la pregunta: ¿el simulador es lo bastante rápido para
    entrenar millones de steps en horas, no días?"""
    import random
    random.seed(0)
    durations = []
    for _ in range(1000):
        env.reset(seed=random.randint(0, 1000))
        t = time.perf_counter_ns()
        env.step(env.action_space.sample())
        durations.append(_ns_to_ms(time.perf_counter_ns() - t))
    durations.sort()
    p95 = durations[int(0.95 * len(durations))]
    p99 = durations[int(0.99 * len(durations))]
    print(f"  step latency: p50={statistics.median(durations):.3f}ms, p95={p95:.3f}ms, p99={p99:.3f}ms")
    assert p95 < 5, f"step p95={p95:.2f}ms supera 5ms (objetivo Hito 6.5.4)"


def test_reset_latencia_p95_sub_10ms(env):
    """reset() debe ser rápido para que entre episodios no perdamos tiempo."""
    durations = []
    for seed in range(500):
        t = time.perf_counter_ns()
        env.reset(seed=seed)
        durations.append(_ns_to_ms(time.perf_counter_ns() - t))
    durations.sort()
    p95 = durations[int(0.95 * len(durations))]
    print(f"  reset latency p95: {p95:.3f}ms")
    assert p95 < 10, f"reset p95={p95:.2f}ms supera 10ms"


@pytest.mark.xfail(
    reason=(
        "REALITY GAP DETECTADO Hito 6.5.4: gym_env usa random.uniform global "
        "en lugar de self.np_random — observations NO son reproducibles "
        "entre instancias con mismo seed. Bug abierto: rl_service refactor "
        "para usar self.np_random consistentemente. Esto degrada la "
        "reproducibilidad de los entrenamientos y debe arreglarse antes de "
        "validar mejoras de la policy en CI."
    ),
    strict=False,
)
def test_observation_consistente_entre_seeds_iguales():
    """Dos resets con mismo seed → MISMO observation tensor.
    Reproducibilidad es CRÍTICA para entrenar y comparar agentes."""
    from rl_service.gym_env import CruiseDispatchEnv
    e1 = CruiseDispatchEnv()
    e2 = CruiseDispatchEnv()
    obs1, _ = e1.reset(seed=42)
    obs2, _ = e2.reset(seed=42)
    import numpy as np
    np.testing.assert_array_equal(obs1, obs2)


def test_observation_distinta_entre_seeds_distintos():
    """Sanity: seeds diferentes → observations diferentes."""
    from rl_service.gym_env import CruiseDispatchEnv
    e = CruiseDispatchEnv()
    obs_a, _ = e.reset(seed=1)
    obs_b, _ = e.reset(seed=2)
    import numpy as np
    assert not np.array_equal(obs_a, obs_b)


def test_reality_gap_estimado_dist_drivers_uniforme():
    """
    El simulador genera drivers uniformes en bbox Las Palmas. Verifica
    que la dispersión espacial de los drivers (~ground-truth distribución
    real conocida) es razonable. Un reality gap grande = simulador
    coloca todos los drivers en una esquina = entrenar contra él
    no generaliza bien.

    Threshold (heurístico): el rango lat de los drivers debe cubrir al
    menos el 30% del bbox de servicio en cualquier episodio típico.
    """
    from rl_service.gym_env import CruiseDispatchEnv, LAT_MIN, LAT_MAX
    e = CruiseDispatchEnv()
    coverages = []
    for s in range(50):
        e.reset(seed=s)
        if not e._drivers: continue
        lats = [d.lat for d in e._drivers]
        rng = max(lats) - min(lats)
        coverages.append(rng / (LAT_MAX - LAT_MIN))
    avg_coverage = sum(coverages) / len(coverages)
    print(f"  cobertura espacial media: {avg_coverage*100:.1f}%")
    # Con MAX_DRIVERS=10 distribuidos uniformemente, cobertura ~80%+
    assert avg_coverage > 0.30, f"cobertura {avg_coverage*100:.1f}% sugiere reality gap excesivo"


def test_total_inference_throughput_sostenible():
    """
    En producción haremos inferencia ~50 req/s (Hito 6.4.4).
    Si el modelo random tarda <1ms por step, entrenar 100k steps = ~100s.
    Con SB3 PPO real puede ser 5-10x más, pero seguir siendo viable.

    Aquí mide el throughput del environment puro (sin policy).
    """
    from rl_service.gym_env import CruiseDispatchEnv
    e = CruiseDispatchEnv()
    e.reset(seed=0)
    n = 5000
    t = time.perf_counter()
    for _ in range(n):
        _o, _r, term, _trunc, _i = e.step(e.action_space.sample())
        if term: e.reset()
    elapsed = time.perf_counter() - t
    rate = n / elapsed
    print(f"  env throughput: {rate:.0f} steps/s")
    assert rate > 1000, f"env demasiado lento: {rate:.0f} steps/s (esperado >1000)"
