# rl_service — RL dispatch agent

A FastAPI microservice serving a **PPO reinforcement-learning agent**
(Stable-Baselines3) that ranks drivers for cruise-passenger luggage pickups. This is the
core AI contribution of [City2Cruise](../README.md).

**Headline result:** in an anticipatory dispatch formulation, the agent beats the
production nearest-ETA heuristic by **+16.7 %** and a hand-crafted anticipatory heuristic
by **+6.3 %**, with **31.7 % fewer missed all-aboard deadlines** (1000 paired-seed
held-out episodes, 95 % bootstrap CI of the paired delta vs greedy: **[+226, +296]**).

---

## The two-phase story

This is the part worth reading — it is a case study in *diagnosing* an RL result instead
of just reporting a number.

### Phase 1 — greedy is optimal by construction

The first environment (`CruiseDispatchEnv(anticipatory=False)`, still reproducible) framed
dispatch as a **myopic one-step** problem: every request exists from reset, drivers are
never busy, and each step assigns the single most-urgent pending request.

The agent converged (`coeff_var ≈ 0.036`) and clearly beat random (182.7 vs 151.3, +20.7 %)
— but **never beat greedy** (295.5). That is not a training failure: the per-step reward is
`(0.5·urgency + 0.5·(1 − eta_norm))·100`, the target is *fixed* to the most-urgent request,
so the only quantity the action controls is `eta_norm`, which the nearest-ETA greedy
minimises exactly. Greedy is the `argmax` of the controllable reward **by construction**.
No algorithm (DQN, A2C, …) would beat it here — the ceiling is the MDP, not the optimiser.

Phase-1 numbers are pinned by [`tests/test_legacy_regression.py`](tests/test_legacy_regression.py)
and archived in the registry (`registry/ppo-v2-canonical/`).

### Phase 2 — redesign so anticipation pays

The environment was reformulated as an **event-driven semi-MDP** over a 2-hour horizon
where non-myopic decisions matter:

- **Temporal arrivals** — requests arrive over time in 2–3 **cruise waves** (12–17 requests
  clustered around fixed port zones) plus a Poisson background, instead of all at reset.
- **Resource contention** — an assigned driver becomes **busy** for travel + service time
  (4–8 min), so spending the wrong driver before a wave starves coverage.
- **Hard deadlines** — each pickup carries an all-aboard deadline (15–25 min); missing it
  costs −150.
- **Strategic wait** — choosing a busy driver is a legitimate **hold** (wait ≤ 90 s for a
  soon-to-free nearby driver rather than dispatching a distant one). Myopic policies cannot
  express this.

The 69-dim observation, `Discrete(10)` action space and the HTTP serving contract are
**unchanged** — only the dynamics changed. The `available` flag and demand clusters (which
now carry the known cruise agenda) turn from redundant features into informative signals.

**Before training anything**, a go/no-go gate proves the ceiling exists: a hand-crafted
`patient` heuristic (greedy + capped holds) beats greedy by 8–11 % on paired seeds. Only
then is RL trained — otherwise there would be nothing to learn.

## Method — behaviour cloning → PPO

Pure PPO from scratch stalls (~1500 reward at 1M steps): the anticipatory hold behaviour is
too far from the myopic attractor to discover by exploration. So the canonical model uses
the standard **imitation → reinforcement** recipe:

1. **Behaviour cloning** ([`scripts/bc_warmstart.py`](../scripts/bc_warmstart.py)) — clone
   the `patient` heuristic over 195,164 decisions generated with domain randomization and
   seeds disjoint from the eval range (no leakage).
2. **PPO fine-tuning** ([`train_tfm.py`](train_tfm.py)) — 600k steps, `γ = 0.995`, lr 1e-4,
   reward normalization. The agent surpasses the very heuristic that initialised it.

Hyperparameters live in [`agent.py`](agent.py) (`HYPERPARAMS`) and are logged to MLflow +
the model card for lineage.

## Results

1000 paired-seed held-out episodes (domain randomization off, identical episodes per policy):

| Policy | Mean reward | Assign ETA (s) | Missed deadlines/ep |
|---|---:|---:|---:|
| **PPO (RL)** | **1819.4** | 378.4 | **1.92** |
| Patient (anticipatory heuristic) | 1711.2 | 378.3 | 2.35 |
| Greedy (nearest-ETA, idealised) | 1558.6 | 401.7 | 2.81 |
| Cascade (production heuristic proxy) | 1349.1 | 417.5 | 3.54 |
| Random | 1303.5 | 429.3 | 3.63 |

Statistical rigor: **paired seeds** (every policy replays the same episodes) and a
**bootstrap 95 % CI** of the per-seed delta (PPO − greedy = **[+226, +296]**, excludes zero).

![Benchmark](../docs/figures/fig10_benchmark.png)

## Serving

The trained checkpoint is baked into the Docker image and served over HTTP — **no DB or
backend required** to try the agent:

```bash
docker build -t city2cruise-rl . && docker run -p 8080:8080 city2cruise-rl
open http://localhost:8080/docs      # interactive Swagger UI
```

| Endpoint | Purpose |
|---|---|
| `POST /assign` | Rank drivers for a `StateTensorInput` → `{ rankings, modelVersion, inferenceMs }` |
| `GET /health` | Liveness + `modelExists` |
| `GET /metrics/prometheus` | Model metrics (inference latency, prediction score, version) |
| `GET /metrics` | JSON metrics (lineage: timesteps, lastTrainedAt, gitSha) |
| `POST /train`, `/train_from_twin` | Online training hooks |

The backend posts the structured `StateTensor` directly (schema mirrored in
[`schemas.py`](schemas.py) ↔ `backend/.../StateFusion.ts`); the 69-dim encoding happens
inside `agent.get_rankings()`, so the observation can be reformulated without breaking the
contract. Inference is < 20 ms.

## MLOps

| Concern | Where |
|---|---|
| Model registry (`candidate→staging→production`) | [`registry.py`](registry.py) |
| Governed promotion gate (`surpasses_greedy ≥ 1.05`, fidelity, robustness) | [`validation/promotion.py`](validation/promotion.py) |
| Auto-generated model card | [`model_card.py`](model_card.py) → [`../docs/MODEL_CARD.md`](../docs/MODEL_CARD.md) |
| Experiment tracking (MLflow + TensorBoard) | [`train_tfm.py`](train_tfm.py) |
| Drift detection (PSI data + KS/MAPE concept) | [`monitoring/drift.py`](monitoring/drift.py), [`../scripts/drift_report.py`](../scripts/drift_report.py) |
| Continuous training (drift → retrain → gate → promote) | [`../scripts/ct_pipeline.py`](../scripts/ct_pipeline.py) |
| Model observability (Prometheus/Grafana) | [`observability.py`](observability.py), [`../observability/grafana/rl-model-dashboard.json`](../observability/grafana/rl-model-dashboard.json) |

Current production model: `ppo-v3-anticipatory` (`surpasses_greedy = true`); the phase-1
`ppo-v2-canonical` is archived as traceable evidence of the redesign.

## Reproduce

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-train.txt

# 1. Behaviour-cloning warm start from the anticipatory heuristic
python ../scripts/bc_warmstart.py

# 2. PPO fine-tuning + benchmark + artifacts (MLflow, figures data)
python -m rl_service.train_tfm --init-from rl_service/artifacts/bc_init \
  --timesteps 600000 --learning-rate 1e-4 --ent-coef 0.003 --eval-episodes 1000

# 3. Benchmark any checkpoint against all 5 policies
python -m rl_service.benchmark 1000

# 4. Regenerate the result figures
python ../scripts/plot_tfm_figures.py
```

## Tests

```bash
python -m pytest rl_service/            # 77 tests
```

Covers: env mechanics (contention, holds, expiries, paired-seed reproducibility), the
phase-1 regression pin, the anticipation-ceiling proof (`patient > greedy`), the promotion
policy, drift detection, and serving latency.

## Layout

```
rl_service/
├── gym_env.py        # CruiseDispatchEnv (myopic + anticipatory formulations)
├── agent.py          # RLAgent: load/train/serve, HYPERPARAMS, get_rankings()
├── benchmark.py      # greedy / random / cascade / patient / rl_ppo + paired-CI
├── train_tfm.py      # canonical training pipeline + MLflow + artifacts
├── registry.py       # file-based model registry + governed promotion
├── validation/       # promotion policy, convergence/fidelity/robustness gates
├── monitoring/       # PSI + KS/MAPE drift
├── observability.py  # Prometheus model metrics
├── main.py           # FastAPI app (/assign, /health, /metrics…)
├── artifacts/        # committed evidence: checkpoint, benchmark.json, figures data
└── registry/         # versioned model cards + promotion decisions
```
