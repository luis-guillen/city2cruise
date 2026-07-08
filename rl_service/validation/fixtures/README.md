# Validation fixtures

These JSON files are **representative reference metrics**, not live production
data. They are used by the Sim-to-Real fidelity gate
(`rl_service/validation/fidelity.py`) and its tests to check that the reality
gap stays below the 20 % threshold in a deterministic, reproducible way.

| File | Meaning |
|------|---------|
| `twin_metrics.json` | Assignment-time metrics measured on the Digital Twin simulator (`avg_match_seconds`, `p95`). |
| `prod_metrics.json` | **Reference** assignment-time metrics that emulate real operation. These are representative values, **not** a capture of the production system. |
| `rewards.csv` | Sample convergence series used by the convergence evaluator's unit tests. The canonical training curve is regenerated into `rl_service/artifacts/rewards.csv` by `python -m rl_service.train_tfm`. |

Measuring the reality gap against genuine production telemetry (rather than
against these reference fixtures) is identified as future work in the thesis
(§5.2) and requires access to the confidential City2Cruise operational dataset.
