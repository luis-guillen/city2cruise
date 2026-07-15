"""Tests for the model promotion policy (MLOps §4.4, phase-2 anticipatory)."""
from rl_service.validation.promotion import evaluate_promotion


def _summary(ppo, rnd, grd, converged=True, fid=True):
    return {
        "convergence": {"is_converged": converged},
        "fidelity": {"pass": fid},
        "benchmark": {
            "rl_ppo": {"mean_reward": ppo},
            "random": {"mean_reward": rnd},
            "greedy": {"mean_reward": grd},
        },
    }


# Canonical numbers of the production model (ppo-v3-anticipatory, N=1000,
# seed 42): PPO 1819.44, random 1303.53, greedy 1558.59 → +39.6 % vs random,
# ratio 1.167 vs greedy.
V3 = (1819.44, 1303.53, 1558.59)

# Phase-1 canonical numbers (ppo-v2-canonical, myopic formulation): PPO does
# NOT surpass greedy there — greedy is optimal by construction.
V2 = (182.68, 151.34, 295.49)


def test_promotes_canonical_v3_model():
    r = evaluate_promotion(_summary(*V3))
    assert r["promote"] is True
    assert r["surpasses_greedy"] is True
    assert r["checks"]["surpasses_greedy_margin"] is True
    assert r["checks"]["beats_random"] and r["checks"]["above_greedy_floor"]


def test_rejects_model_not_surpassing_greedy():
    # Matches greedy but misses the ≥5 % surpass margin → held back.
    r = evaluate_promotion(_summary(1560.0, 1303.53, 1558.59))
    assert r["surpasses_greedy"] is True          # barely above…
    assert r["checks"]["surpasses_greedy_margin"] is False  # …but no margin
    assert r["promote"] is False


def test_rejects_model_not_beating_random():
    r = evaluate_promotion(_summary(1300.0, 1303.53, 1558.59))
    assert r["promote"] is False
    assert r["checks"]["beats_random"] is False


def test_rejects_non_converged():
    assert evaluate_promotion(_summary(*V3, converged=False))["promote"] is False


def test_rejects_fidelity_fail():
    assert evaluate_promotion(_summary(*V3, fid=False))["promote"] is False


def test_phase1_policy_promotes_legacy_model_without_surpass_requirement():
    # The phase-1 decision stays reproducible: the myopic-formulation model
    # promoted by beating random within the greedy floor, with the greedy
    # limitation reported honestly.
    r = evaluate_promotion(_summary(*V2), require_surpass_greedy=False)
    assert r["promote"] is True
    assert r["surpasses_greedy"] is False
    assert "surpasses_greedy_margin" not in r["checks"]


def test_phase2_policy_rejects_legacy_model():
    # Under the phase-2 policy the phase-1 model would NOT ship.
    r = evaluate_promotion(_summary(*V2))
    assert r["promote"] is False
    assert r["checks"]["surpasses_greedy_margin"] is False
