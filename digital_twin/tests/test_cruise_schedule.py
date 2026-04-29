from datetime import datetime, timezone

import pytest

from digital_twin.cruise_schedule import InvalidScenarioPathError, active_at, load_manifest, resolve_manifest_path


def test_load_manifest_returns_list():
    manifest = load_manifest("digital_twin/scenarios/las_palmas_baseline.json")
    assert len(manifest) == 3
    assert all("vessel_name" in cruise for cruise in manifest)


def test_active_at_returns_only_docked_now():
    manifest = load_manifest("digital_twin/scenarios/las_palmas_baseline.json")
    now = datetime(2026, 4, 29, 10, 0, tzinfo=timezone.utc)
    docked = active_at(manifest, now)
    assert isinstance(docked, list)
    assert {cruise["vessel_name"] for cruise in docked} == {"AIDAnova", "MSC Bellissima"}


def test_resolve_manifest_path_rejects_escape():
    with pytest.raises(InvalidScenarioPathError):
        resolve_manifest_path("../secrets.json")
