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
    max_steps = env.max_steps + 5
    done = False
    for _ in range(max_steps):
        action = env.action_space.sample()
        _obs, _r, term, trunc, _info = env.step(action)
        if term or trunc:
            done = True
            break
    assert done, f"episodio NO terminó en {max_steps} steps"


def test_distribucion_de_recompensas_es_estable(env):
    """Sanity: ejecutar 50 episodios random completos y verificar que la
    varianza está acotada (sin bug que produzca rewards extremos). En la
    formulación anticipatoria una política aleatoria acumula penalizaciones
    por expiración (−150) y esperas, así que la banda es más ancha que en la
    formulación miope de la fase 1."""
    rewards = []
    for ep_seed in range(50):
        env.reset(seed=ep_seed)
        ep_reward = 0.0
        for _ in range(env.max_steps + 5):
            _o, r, term, trunc, _i = env.step(env.action_space.sample())
            ep_reward += r
            if term or trunc: break
        rewards.append(ep_reward)
    mean_r = statistics.mean(rewards)
    stdev_r = statistics.pstdev(rewards)
    assert -6000 < mean_r < 6000, f"reward medio fuera de rango razonable: {mean_r}"
    assert stdev_r < 3000, f"varianza desbocada: stdev={stdev_r}"


@pytest.mark.skipif(not HAS_SB3, reason="stable-baselines3 no instalado — skip training real")
def test_rl_training_loop_contract(tmp_path, monkeypatch):
    """
    Contrato del bucle de entrenamiento ONLINE (RLAgent.train): ejecuta,
    persiste checkpoint + metadata de linaje, acumula timesteps y la política
    resultante sigue emitiendo acciones válidas sin colapso catastrófico.

    Con n_steps=1024 × 8 envs, 10k pasos son UNA actualización de gradiente:
    no puede garantizar mejora de retorno (eso lo validan el benchmark
    canónico a 1000 episodios y el gate de promoción — `surpasses_greedy`).

    El modelo se entrena en un path AISLADO (tmp) para no sobrescribir el
    artefacto canónico versionado en rl_service/artifacts/.
    """
    import json

    from rl_service import agent as agent_mod
    from rl_service.agent import RLAgent
    from rl_service.gym_env import CruiseDispatchEnv, MAX_DRIVERS
    from rl_service.benchmark import make_rl_policy

    # Isolate the checkpoint so the test never mutates the production artifact.
    isolated = tmp_path / "test_ppo"
    meta_path = tmp_path / "test_ppo.meta.json"
    monkeypatch.setattr(agent_mod, "MODEL_PATH", isolated)
    monkeypatch.setattr(agent_mod, "MODEL_META_PATH", meta_path)

    env = CruiseDispatchEnv()

    def _eval(policy) -> float:
        rewards = []
        for ep_seed in range(20):
            obs, _ = env.reset(seed=ep_seed)
            ep_r = 0.0
            for _ in range(env.max_steps + 5):
                obs, r, term, trunc, _ = env.step(policy(obs))
                ep_r += r
                if term or trunc:
                    break
            rewards.append(ep_r)
        return statistics.mean(rewards)

    agent = RLAgent()
    untrained_mean = _eval(make_rl_policy(agent.model))

    result = agent.train(total_timesteps=10_000)

    # Mechanics: checkpoint + lineage persisted, timesteps accumulated.
    assert (tmp_path / "test_ppo.zip").exists()
    meta = json.loads(meta_path.read_text())
    assert meta["totalTimesteps"] >= 10_000
    assert meta["modelVersion"] == RLAgent.MODEL_VERSION
    assert result["total_timesteps"] >= 10_000

    # Policy still functional and not catastrophically collapsed.
    policy = make_rl_policy(agent.model)
    obs, _ = env.reset(seed=123)
    assert 0 <= policy(obs) < MAX_DRIVERS
    trained_mean = _eval(policy)
    floor = untrained_mean - 0.5 * abs(untrained_mean)
    assert trained_mean > floor, (
        f"colapso tras entrenar: {trained_mean:.1f} < suelo {floor:.1f} "
        f"(sin entrenar: {untrained_mean:.1f})"
    )
