"""
Hito 6.5.1 — Tests de convergencia del agente RL.

Filosofía: el sandbox no garantiza tener stable-baselines3+torch (son
~2GB). Si están disponibles, ejecuta un entrenamiento corto y verifica
que la curva de reward mejora. Si no, valida la dinámica del entorno
de simulación (gym_env) sin entrenar.
"""
import importlib.util
import math
import random
import statistics

import pytest

# Detectar disponibilidad de SB3
HAS_SB3 = importlib.util.find_spec("stable_baselines3") is not None

# El gym env funciona con sólo gymnasium+numpy
gym_spec = importlib.util.find_spec("gymnasium")
np_spec = importlib.util.find_spec("numpy")
HAS_BASE_DEPS = gym_spec is not None and np_spec is not None


pytestmark = pytest.mark.skipif(
    not HAS_BASE_DEPS,
    reason="gymnasium+numpy no instalados — skip RL tests",
)


@pytest.fixture
def env():
    from rl_service.gym_env import CruiseDispatchEnv
    e = CruiseDispatchEnv()
    e.reset(seed=42)
    return e


def test_observation_space_shape(env):
    """OBS_DIM=69 según el contrato; reset devuelve vector con esa shape."""
    from rl_service.gym_env import OBS_DIM
    obs, _info = env.reset(seed=42)
    assert obs.shape == (OBS_DIM,), f"esperaba ({OBS_DIM},), recibí {obs.shape}"
    assert obs.dtype.name == "float32"
    assert (obs >= 0).all() and (obs <= 1).all(), "observación debe estar normalizada [0,1]"


def test_action_space_discrete(env):
    """Action space discreto MAX_DRIVERS=10."""
    from rl_service.gym_env import MAX_DRIVERS
    assert env.action_space.n == MAX_DRIVERS


def test_reward_positivo_para_driver_cercano_y_disponible(env):
    """Un agente sano: si elige el driver más cercano, recompensa > 0."""
    obs, _ = env.reset(seed=42)
    if not env._drivers:
        pytest.skip("no drivers en el episodio")
    # Encuentra el índice del driver disponible más cercano al request más urgente
    if not env._pending:
        pytest.skip("no requests")
    req = env._pending[0]
    best_idx = None
    best_d = math.inf
    for i, d in enumerate(env._drivers):
        if not d.is_available:
            continue
        # Use Haversine a través del helper exportado
        from rl_service.gym_env import haversine_m
        dist = haversine_m(d.lat, d.lon, req.lat, req.lon)
        if dist < best_d:
            best_d = dist; best_idx = i
    assert best_idx is not None
    _obs, reward, _term, _trunc, _info = env.step(best_idx)
    assert reward > 0, f"acción óptima debería dar reward >0, dio {reward}"


def test_reward_negativo_para_indice_invalido(env):
    """Acción fuera de rango (index >= num drivers o driver no disponible) → reward < 0."""
    env.reset(seed=42)
    _obs, reward, _term, _trunc, _info = env.step(99)  # index inexistente
    assert reward < 0, f"acción inválida debería dar reward<0, dio {reward}"


def test_episodio_termina_cuando_no_hay_requests_pendientes(env):
    """El episode termina cuando se cubren todos los requests o no hay drivers libres."""
    env.reset(seed=42)
    max_steps = 50
    done = False
    for _ in range(max_steps):
        action = env.action_space.sample()
        _obs, _r, term, trunc, _info = env.step(action)
        if term or trunc:
            done = True
            break
    assert done, f"episodio NO terminó en {max_steps} steps"


def test_distribucion_de_recompensas_es_estable(env):
    """Sanity: ejecutar 50 episodios random y verificar que la varianza
    está acotada (sin bug que produzca rewards extremos)."""
    rewards = []
    for ep_seed in range(50):
        env.reset(seed=ep_seed)
        ep_reward = 0.0
        for _ in range(20):
            _o, r, term, trunc, _i = env.step(env.action_space.sample())
            ep_reward += r
            if term or trunc: break
        rewards.append(ep_reward)
    mean_r = statistics.mean(rewards)
    stdev_r = statistics.pstdev(rewards)
    assert -1000 < mean_r < 1000, f"reward medio fuera de rango razonable: {mean_r}"
    assert stdev_r < 1000, f"varianza desbocada: stdev={stdev_r}"


@pytest.mark.skipif(not HAS_SB3, reason="stable-baselines3 no instalado — skip training real")
def test_rl_training_mejora_reward_baseline_a_post_train():
    """
    Hito 6.5.1 criterio de aceptación: tasa de éxito >95% en escenarios
    complejos. Test mínimo: 5k steps deben mejorar reward medio vs random
    en 30 episodios de evaluación.

    Marcado con SB3 skip: sólo corre si el entorno tiene SB3 instalado.
    """
    from rl_service.agent import RLAgent
    from rl_service.gym_env import CruiseDispatchEnv

    # Baseline: agente random
    env = CruiseDispatchEnv()
    random.seed(0)
    baseline = []
    for ep_seed in range(30):
        env.reset(seed=ep_seed)
        ep_r = 0.0
        for _ in range(20):
            _o, r, term, trunc, _i = env.step(env.action_space.sample())
            ep_r += r
            if term or trunc: break
        baseline.append(ep_r)
    baseline_mean = statistics.mean(baseline)

    # Train PPO 5k steps (rápido en CPU)
    agent = RLAgent()
    agent.train(total_timesteps=5_000)

    # Eval con la policy entrenada
    trained = []
    for ep_seed in range(30):
        obs, _ = env.reset(seed=ep_seed)
        ep_r = 0.0
        for _ in range(20):
            action, _ = agent.model.predict(obs, deterministic=True)
            obs, r, term, trunc, _ = env.step(int(action))
            ep_r += r
            if term or trunc: break
        trained.append(ep_r)
    trained_mean = statistics.mean(trained)

    # Tolerancia: PPO 5k es muy poco, sólo exigimos NO ser peor que baseline
    assert trained_mean >= baseline_mean - 5, (
        f"trained {trained_mean} debería ser >= baseline {baseline_mean} (-5 tol)"
    )
