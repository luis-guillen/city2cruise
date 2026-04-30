# Cierre formal de hitos AI/RL

## Estado

- Hito 3.4: Cerrado
- Hito 3.5: Cerrado
- Hito 5.4: Cerrado
- Hito 6.5: Cerrado
- Pendiente fuera de roadmap: adapter MiroFish

## Hito 3.4

Evidencias:

- Generador sintético exportable en `rl_service/synthetic_data.py`
- Tests verdes en `rl_service/tests/test_synthetic_data.py`
- Latencia de integración cubierta en `backend/src/__tests__/rl-latency.test.ts`

## Hito 3.5

Evidencias:

- PPO y benchmark reproducible en `rl_service/agent.py`, `rl_service/gym_env.py` y `rl_service/benchmark.py`
- Reasignación activa en `backend/src/services/ReassignmentService.ts`
- Activación del rebalance real en `backend/src/jobs/rebalanceFleetJob.ts`
- Cobertura en `backend/src/__tests__/reassignment.test.ts`, `backend/src/__tests__/rebalance-active.test.ts` y `rl_service/tests/test_rl_benchmark.py`

## Hito 5.4

Evidencias:

- Twin con escenarios físicos en `digital_twin/main.py`, `digital_twin/traffic.py` y `digital_twin/cruise_schedule.py`
- Sync backend a twin en `backend/src/services/twin/TwinSyncService.ts`
- Intervención manual en torre en `backend/src/routes/admin/intervention.ts` y `cruise-connect-main/src/components/twin/ManualInterventionPanel.tsx`
- Cobertura en `digital_twin/tests/`, `backend/src/__tests__/twin-sync.test.ts` y `backend/src/__tests__/admin-intervention.test.ts`

## Hito 6.5

Evidencias:

- Suite de validación en `rl_service/validation/`
- Release gate en `scripts/validate_ai_release.py`
- Fixtures reproducibles para CI en `rl_service/validation/fixtures/`
- Cobertura en `rl_service/validation/tests/`

## Activación recomendada

- Staging: `RL_ROUTING_ENABLED=true`
- Staging: `RL_REBALANCE_ACTIVE=true`
- Backend con `RL_SERVICE_URL` apuntando a `rl_service`
- Backend con `TWIN_URL` apuntando a `digital_twin`
