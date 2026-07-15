"""
Promotion policy (MLOps §4.4) — decides whether a trained model may be promoted
to production. Complements the release gate (convergence + fidelity + robustness,
``scripts/validate_ai_release.py``) by adding the piece it was missing: an
explicit check against the **baseline benchmark**.

Phase-2 policy (anticipatory formulation). In the phase-1 myopic formulation the
greedy heuristic was optimal by construction, so the honest criterion was only
"beat random within a greedy floor". The phase-2 environment (event-driven cruise
waves, driver contention, hold actions, hard all-aboard deadlines) makes myopic
dispatch provably suboptimal, so the policy now REQUIRES surpassing greedy:

  1. converged            — training reward stabilised (coeff_var < 0.10, improving)
  2. fidelity_pass        — sim-to-real reality gap < 20 %
  3. beats_random         — reward improvement over the random baseline ≥ 5 %
  4. above_greedy_floor   — reward ≥ 55 % of the greedy baseline (schema compat)
  5. surpasses_greedy     — reward ≥ 105 % of the greedy baseline

Legacy (phase 1) summaries can be evaluated with ``require_surpass_greedy=False``
to reproduce the phase-1 promotion decision.
"""
from __future__ import annotations

MIN_REWARD_VS_RANDOM = 0.05      # ≥ 5 % better than random
GREEDY_FLOOR_RATIO = 0.55        # ≥ 55 % of greedy reward (no-regression floor)
SURPASS_GREEDY_RATIO = 1.05      # ≥ 105 % of greedy reward (phase-2 requirement)


def evaluate_promotion(summary: dict,
                       min_reward_vs_random: float = MIN_REWARD_VS_RANDOM,
                       greedy_floor: float = GREEDY_FLOOR_RATIO,
                       surpass_greedy_ratio: float = SURPASS_GREEDY_RATIO,
                       require_surpass_greedy: bool = True) -> dict:
    """Apply the promotion policy to a train_tfm ``summary`` dict."""
    conv = summary["convergence"]
    fid = summary["fidelity"]
    b = summary["benchmark"]
    ppo = b["rl_ppo"]["mean_reward"]
    rnd = b["random"]["mean_reward"]
    grd = b["greedy"]["mean_reward"]

    vs_random = (ppo - rnd) / abs(rnd) if rnd else 0.0
    vs_greedy_ratio = ppo / grd if grd else 0.0

    checks = {
        "converged": bool(conv.get("is_converged")),
        "fidelity_pass": bool(fid.get("pass")),
        "beats_random": bool(vs_random >= min_reward_vs_random),
        "above_greedy_floor": bool(vs_greedy_ratio >= greedy_floor),
    }
    if require_surpass_greedy:
        checks["surpasses_greedy_margin"] = bool(vs_greedy_ratio >= surpass_greedy_ratio)

    if require_surpass_greedy:
        notes = ("Phase-2 policy (anticipatory formulation): promotion requires "
                 "surpassing the greedy heuristic by the configured margin, on top "
                 "of convergence, fidelity and the random baseline. In the phase-1 "
                 "myopic formulation greedy was optimal by construction (thesis "
                 "§4.2), which this environment redesign resolved.")
    else:
        notes = ("Phase-1 policy: PPO does not surpass the greedy heuristic "
                 "(structural in the myopic single-dispatch formulation); promotion "
                 "requires beating random and staying within the greedy floor.")

    return {
        "checks": checks,
        "reward_vs_random_pct": round(vs_random, 4),
        "reward_vs_greedy_ratio": round(vs_greedy_ratio, 4),
        "surpasses_greedy": bool(ppo > grd),
        "promote": all(checks.values()),
        "policy": {
            "min_reward_vs_random": min_reward_vs_random,
            "greedy_floor_ratio": greedy_floor,
            "surpass_greedy_ratio": surpass_greedy_ratio if require_surpass_greedy else None,
            "require_surpass_greedy": require_surpass_greedy,
        },
        "notes": notes,
    }
