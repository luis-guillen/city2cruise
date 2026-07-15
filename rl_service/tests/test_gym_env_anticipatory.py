"""
Unit tests for the phase-2 anticipatory mechanics of CruiseDispatchEnv:
resource contention (busy/release), hold actions, hard all-aboard deadlines,
waiting costs and paired-seed reproducibility.
"""

from __future__ import annotations

import importlib.util

import numpy as np
import pytest

HAS_BASE_DEPS = (
    importlib.util.find_spec("gymnasium") is not None
    and importlib.util.find_spec("numpy") is not None
)
pytestmark = pytest.mark.skipif(
    not HAS_BASE_DEPS, reason="gymnasium+numpy no instalados — skip RL tests"
)

from rl_service.gym_env import (  # noqa: E402
    CruiseDispatchEnv,
    EXPIRY_PENALTY,
    HOLD_CAP_S,
    MAX_DRIVERS,
    OBS_PER_DRIVER,
)


@pytest.fixture
def env():
    e = CruiseDispatchEnv(n_drivers=8, anticipatory=True)
    e.reset(seed=42)
    return e


def _first_free_slot(e: CruiseDispatchEnv) -> int:
    for i, d in enumerate(e._drivers):
        if d.is_available:
            return i
    raise AssertionError("no free driver at a decision point")


def test_assignment_marks_driver_busy_and_releases(env):
    """A dispatched driver becomes busy (contention) and frees up later."""
    slot = _first_free_slot(env)
    env.step(slot)
    driver = env._drivers[slot]
    if driver.is_available:
        # The auto-advance may already have released them; then busy_until
        # must be in the past.
        assert driver.busy_until_s <= env._clock_s
    else:
        assert driver.busy_until_s > env._clock_s
        # Force the clock past the release and confirm the driver frees up.
        env._clock_s = driver.busy_until_s + 1.0
        env._release_drivers()
        assert driver.is_available


def test_busy_driver_slot_is_a_capped_hold(env):
    """Choosing a busy driver advances the clock (≤ HOLD_CAP_S) without the
    invalid-action penalty spike."""
    slot = _first_free_slot(env)
    env.step(slot)
    busy_slots = [i for i, d in enumerate(env._drivers) if not d.is_available]
    if not busy_slots:
        pytest.skip("driver already released by the auto-advance")
    t0 = env._clock_s
    _obs, reward, _term, _trunc, _info = env.step(busy_slots[0])
    # The hold advanced the clock, bounded by the cap (plus the auto-advance
    # to the next decision point, which can move further).
    assert env._clock_s > t0
    # A hold's direct cost is waiting (a few points/min), never the flat -10.
    assert reward > -EXPIRY_PENALTY or env._expired > 0


def test_empty_slot_is_invalid(env):
    """Slots beyond the fleet size are invalid: flat penalty applies."""
    _obs, reward, _term, _trunc, _info = env.step(len(env._drivers))
    assert reward <= -10.0


def test_expiry_charges_penalty():
    """A request whose deadline passes while waiting costs EXPIRY_PENALTY."""
    env = CruiseDispatchEnv(n_drivers=8, anticipatory=True)
    env.reset(seed=7)
    total_expired = 0
    # Play a deliberately bad policy (always hold on a busy slot if any,
    # otherwise dispatch slot 0) and confirm expiries surface in info and
    # are charged through the reward.
    done = trunc = False
    rewards = []
    info: dict = {}
    while not (done or trunc):
        busy = [i for i, d in enumerate(env._drivers) if not d.is_available]
        action = busy[0] if busy else _first_free_slot(env)
        _o, r, done, trunc, info = env.step(action)
        rewards.append(r)
        total_expired = info.get("expired", 0)
    assert total_expired > 0, "bad policy should miss at least one deadline"
    # Expiries must show up as large negative reward spikes.
    assert min(rewards) <= -EXPIRY_PENALTY


def test_infeasible_dispatch_counts_as_expiry(env):
    """If no driver can reach the target before its deadline, the dispatch is
    rejected and charged as a miss (the luggage misses the ship)."""
    # Manufacture the situation directly: shrink the head deadline.
    assert env._pending, "expected a pending request at the first decision"
    env._pending[0].deadline_s = env._clock_s + 1.0
    slot = _first_free_slot(env)
    served_before = env._served
    _obs, reward, _t, _tr, _info = env.step(slot)
    assert env._expired >= 1
    assert env._served == served_before
    assert reward <= -EXPIRY_PENALTY + 1e-6


def test_paired_seeds_are_reproducible():
    """Same seed ⇒ identical schedule, drivers and observations (paired-seed
    benchmarking depends on this)."""
    a = CruiseDispatchEnv(n_drivers=8, anticipatory=True)
    b = CruiseDispatchEnv(n_drivers=8, anticipatory=True)
    obs_a, _ = a.reset(seed=99)
    obs_b, _ = b.reset(seed=99)
    np.testing.assert_array_equal(obs_a, obs_b)
    for _ in range(5):
        sa = a.step(0)
        sb = b.step(0)
        np.testing.assert_array_equal(sa[0], sb[0])
        assert sa[1] == sb[1]


def test_observation_contract_intact(env):
    """OBS layout unchanged: 69 dims in [0,1]; busy drivers flagged 0 with
    eta_norm = remaining busy time."""
    slot = _first_free_slot(env)
    obs, *_ = env.step(slot)
    assert obs.shape == (69,)
    assert (obs >= 0).all() and (obs <= 1).all()
    d = env._drivers[slot]
    if not d.is_available:
        base = slot * OBS_PER_DRIVER
        assert obs[base + 4] == 0.0
        remaining_norm = min(1.0, (d.busy_until_s - env._clock_s) / 900.0)
        assert obs[base + 3] == pytest.approx(remaining_norm, abs=1e-5)


def test_action_space_still_discrete_10(env):
    assert env.action_space.n == MAX_DRIVERS
