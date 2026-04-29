"""Carga y consulta de manifests de cruceros para escenarios."""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path


class InvalidScenarioPathError(ValueError):
    """Raised when a scenario fixture path escapes the approved directory."""


def _scenario_root() -> Path:
    return Path(__file__).resolve().parent


def scenario_fixtures_dir() -> Path:
    return (_scenario_root() / "scenarios").resolve()


def resolve_manifest_path(path: str) -> Path:
    candidate = Path(path)
    fixtures_dir = scenario_fixtures_dir()

    if candidate.is_absolute():
        resolved = candidate.resolve()
    elif candidate.parts and candidate.parts[0] == "scenarios":
        resolved = (_scenario_root() / candidate).resolve()
    elif candidate.parts and candidate.parts[0] == "digital_twin":
        repo_root = _scenario_root().parent
        resolved = (repo_root / candidate).resolve()
    else:
        resolved = (fixtures_dir / candidate).resolve()

    try:
        resolved.relative_to(fixtures_dir)
    except ValueError as exc:
        raise InvalidScenarioPathError(f"scenario_file must stay under {fixtures_dir}") from exc

    return resolved


def load_manifest(path: str) -> list[dict]:
    data = json.loads(resolve_manifest_path(path).read_text())
    return data["cruises"]


def active_at(manifest: list[dict], t: datetime) -> list[dict]:
    out: list[dict] = []
    for cruise in manifest:
        arr = datetime.fromisoformat(cruise["scheduled_arrival"].replace("Z", "+00:00"))
        dep = datetime.fromisoformat(cruise["all_aboard"].replace("Z", "+00:00"))
        if arr <= t <= dep:
            out.append(cruise)
    return out
