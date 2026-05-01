#!/usr/bin/env python3
"""Smoke check for a live MiroFish twin provider.

This validates the lifecycle used by rl_service:
- health
- create_simulation
- prepare_simulation
- poll_prepare_status
- get_state
- run_scenario

The script is intentionally small and deterministic so it can be reused in
staging, local docker-compose runs, or ad-hoc operator checks.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import uuid
from pathlib import Path
from typing import Any

import httpx

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from rl_service.twin_mirofish_adapter import MiroFishTwinAdapter


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Smoke test a live MiroFish provider")
    parser.add_argument("--base-url", required=True, help="MiroFish base URL, e.g. http://localhost:5001")
    parser.add_argument("--project-id", default=None, help="MiroFish project identifier")
    parser.add_argument("--graph-id", default=None, help="Optional graph identifier")
    parser.add_argument("--api-key", default=None, help="Optional MiroFish API key")
    parser.add_argument("--simulation-id", default=None, help="Optional pre-existing simulation id")
    parser.add_argument("--bootstrap", action="store_true", help="Create a richer smoke project in the local MiroFish repo before running the smoke")
    parser.add_argument(
        "--bootstrap-root",
        default=None,
        help="Path to the MiroFish backend/uploads/projects directory used for bootstrap",
    )
    parser.add_argument(
        "--bootstrap-project-name",
        default="RL Smoke Project",
        help="Project name used when bootstrapping a local MiroFish project",
    )
    parser.add_argument("--drivers-online", type=int, default=5)
    parser.add_argument("--duration-minutes", type=int, default=5)
    parser.add_argument("--request-rate-per-min", type=float, default=2.0)
    parser.add_argument("--timeout", type=float, default=10.0)
    parser.add_argument("--poll-interval-seconds", type=float, default=2.0)
    parser.add_argument("--prepare-timeout-seconds", type=float, default=180.0)
    return parser.parse_args()


def _default_bootstrap_ontology() -> dict[str, Any]:
    return {
        "entity_types": [
            {
                "name": "Developer",
                "description": "Software developer participating in the discussion.",
                "attributes": [
                    {"name": "full_name", "type": "text", "description": "Developer full name"},
                    {"name": "org_name", "type": "text", "description": "Company or team"},
                ],
                "examples": ["Alice Nguyen", "Marco Silva"],
            },
            {
                "name": "Apiprovider",
                "description": "API service provider or platform company.",
                "attributes": [
                    {"name": "api_name", "type": "text", "description": "API name"},
                    {"name": "service_url", "type": "text", "description": "Service URL"},
                ],
                "examples": ["OpenAPI Cloud", "DataWave API"],
            },
            {
                "name": "SoftwareCompany",
                "description": "Software company or startup involved in the story.",
                "attributes": [
                    {"name": "company_name", "type": "text", "description": "Company name"},
                    {"name": "industry", "type": "text", "description": "Industry"},
                ],
                "examples": ["CloudForge", "ByteWave"],
            },
            {
                "name": "TechBlogger",
                "description": "A technology blogger covering the event.",
                "attributes": [
                    {"name": "blog_url", "type": "text", "description": "Blog URL"},
                    {"name": "specialty", "type": "text", "description": "Coverage specialty"},
                ],
                "examples": ["TechPulse", "DevNotes"],
            },
            {
                "name": "Itjournalist",
                "description": "An IT journalist or reporter.",
                "attributes": [
                    {"name": "media_outlet", "type": "text", "description": "Media outlet"},
                    {"name": "beat", "type": "text", "description": "Reporting beat"},
                ],
                "examples": ["Wired", "The Verge"],
            },
            {
                "name": "Programmer",
                "description": "A programmer or engineer.",
                "attributes": [
                    {"name": "programming_languages", "type": "text", "description": "Languages"},
                    {"name": "github_username", "type": "text", "description": "GitHub username"},
                ],
                "examples": ["Linus Torvalds", "Ada Lovelace"],
            },
            {
                "name": "TechInfluencer",
                "description": "A tech influencer or content creator.",
                "attributes": [
                    {"name": "social_media_handle", "type": "text", "description": "Social handle"},
                    {"name": "followers", "type": "integer", "description": "Follower count"},
                ],
                "examples": ["MKBHD", "Linus Tech Tips"],
            },
            {
                "name": "StartupFounder",
                "description": "A founder or executive behind the startup.",
                "attributes": [
                    {"name": "startup_name", "type": "text", "description": "Startup name"},
                    {"name": "funding", "type": "text", "description": "Funding status"},
                ],
                "examples": ["Maya Chen", "Ethan Brooks"],
            },
            {
                "name": "Person",
                "description": "Any individual person not fitting a specific role.",
                "attributes": [
                    {"name": "full_name", "type": "text", "description": "Full name"},
                ],
                "examples": ["Citizen", "Reader"],
            },
            {
                "name": "Organization",
                "description": "Any organization not fitting a specific role.",
                "attributes": [
                    {"name": "org_name", "type": "text", "description": "Organization name"},
                ],
                "examples": ["Company", "Agency"],
            },
        ],
        "edge_types": [
            {
                "name": "WORKS_FOR",
                "description": "An individual works for an organization.",
                "source_targets": [
                    {"source": "Developer", "target": "SoftwareCompany"},
                    {"source": "Programmer", "target": "SoftwareCompany"},
                    {"source": "StartupFounder", "target": "SoftwareCompany"},
                ],
                "attributes": [],
            },
            {
                "name": "COLLABORATES_WITH",
                "description": "A person or organization collaborates with another entity.",
                "source_targets": [
                    {"source": "Developer", "target": "Apiprovider"},
                    {"source": "SoftwareCompany", "target": "Apiprovider"},
                    {"source": "TechBlogger", "target": "SoftwareCompany"},
                ],
                "attributes": [],
            },
            {
                "name": "REPORTS_ON",
                "description": "A journalist or blogger reports on an entity.",
                "source_targets": [
                    {"source": "Itjournalist", "target": "SoftwareCompany"},
                    {"source": "TechBlogger", "target": "Apiprovider"},
                ],
                "attributes": [],
            },
            {
                "name": "SUPPORTS",
                "description": "An entity publicly supports another entity.",
                "source_targets": [
                    {"source": "TechInfluencer", "target": "SoftwareCompany"},
                    {"source": "Person", "target": "Organization"},
                ],
                "attributes": [],
            },
            {
                "name": "OPPOSES",
                "description": "An entity publicly opposes another entity.",
                "source_targets": [
                    {"source": "Person", "target": "Organization"},
                    {"source": "Itjournalist", "target": "Organization"},
                ],
                "attributes": [],
            },
        ],
        "analysis_summary": "Bootstrap ontology for a technology news smoke test.",
    }


def _default_bootstrap_text() -> str:
    return (
        "Alice Nguyen is a senior Developer at CloudForge, where she integrates OpenAPI Cloud services "
        "into a new logistics dashboard. Marco Silva, a Programmer at ByteWave, collaborates with "
        "OpenAPI Cloud and supports the rollout. Maya Chen founded HarborAI, a SoftwareCompany that "
        "ships alerting tools for operators. TechBlogger Nia Patel wrote a feature about the launch, "
        "and IT journalist Javier Gomez from Wired reported on the partnership. Influencer Sam Lee "
        "shared the news with followers, while readers and citizens discussed the impact on the wider "
        "Organization network around the software ecosystem."
    )


def _bootstrap_project(root: Path, project_name: str) -> tuple[str, dict[str, Any]]:
    project_id = f"proj_{uuid.uuid4().hex[:12]}"
    now = "2026-05-01T00:00:00"
    text = _default_bootstrap_text()
    ontology = _default_bootstrap_ontology()

    project_dir = root / project_id
    files_dir = project_dir / "files"
    project_dir.mkdir(parents=True, exist_ok=True)
    files_dir.mkdir(parents=True, exist_ok=True)

    (project_dir / "extracted_text.txt").write_text(text, encoding="utf-8")
    project = {
        "project_id": project_id,
        "name": project_name,
        "status": "ontology_generated",
        "created_at": now,
        "updated_at": now,
        "files": [{"filename": "smoke.txt", "size": len(text.encode("utf-8"))}],
        "total_text_length": len(text),
        "ontology": ontology,
        "analysis_summary": ontology["analysis_summary"],
        "graph_id": None,
        "graph_build_task_id": None,
        "simulation_requirement": "Bootstrap project for a technology smoke test.",
        "chunk_size": 500,
        "chunk_overlap": 50,
        "error": None,
    }
    (project_dir / "project.json").write_text(json.dumps(project, ensure_ascii=False, indent=2), encoding="utf-8")
    return project_id, project


def _build_bootstrapped_graph(base_url: str, project_id: str) -> str:
    client = httpx.Client(timeout=120.0)
    build = client.post(f"{base_url.rstrip('/')}/api/graph/build", json={"project_id": project_id, "graph_name": "RL Smoke Bootstrap Graph"})
    build.raise_for_status()
    payload = build.json()
    if not payload.get("success"):
        raise RuntimeError(payload)

    task_id = payload["data"]["task_id"]
    deadline = time.monotonic() + 900.0

    while time.monotonic() < deadline:
        task = client.get(f"{base_url.rstrip('/')}/api/graph/task/{task_id}")
        task.raise_for_status()
        data = task.json().get("data", {})
        status = data.get("status")
        if status in {"completed", "failed"}:
            if status == "failed":
                raise RuntimeError(json.dumps(data, ensure_ascii=False))
            result = data.get("result") or {}
            graph_id = result.get("graph_id")
            if not graph_id:
                raise RuntimeError(f"Graph build completed without graph_id: {json.dumps(data, ensure_ascii=False)}")
            return graph_id
        time.sleep(5)

    raise TimeoutError(f"Graph build timed out for project {project_id}")


def run_smoke_check(
    *,
    base_url: str,
    project_id: str | None = None,
    graph_id: str | None = None,
    api_key: str | None = None,
    simulation_id: str | None = None,
    bootstrap: bool = False,
    bootstrap_root: str | None = None,
    bootstrap_project_name: str = "RL Smoke Project",
    drivers_online: int = 5,
    duration_minutes: int = 5,
    request_rate_per_min: float = 2.0,
    timeout: float = 10.0,
    poll_interval_seconds: float = 2.0,
    prepare_timeout_seconds: float = 180.0,
) -> dict[str, Any]:
    if bootstrap:
        resolved_root = Path(bootstrap_root) if bootstrap_root else REPO_ROOT.parent / "MiroFish" / "backend" / "uploads" / "projects"
        project_id, _ = _bootstrap_project(resolved_root, bootstrap_project_name)
        graph_id = _build_bootstrapped_graph(base_url, project_id)

    if not project_id:
        raise ValueError("project_id is required unless bootstrap=True")

    adapter = MiroFishTwinAdapter(
        base_url=base_url,
        api_key=api_key,
        project_id=project_id,
        graph_id=graph_id,
        timeout=timeout,
        poll_interval_seconds=poll_interval_seconds,
        prepare_timeout_seconds=prepare_timeout_seconds,
    )

    health = adapter.health()
    created = None
    prepared = None
    snapshot = None

    if simulation_id is None:
        created = adapter.create_simulation()
        simulation_id = created["data"]["simulation_id"] if isinstance(created, dict) and "data" in created else created["simulation_id"]
        prepared = adapter.prepare_simulation(simulation_id)
        prepared_data = prepared.get("data", prepared) if isinstance(prepared, dict) else {}
        adapter._wait_for_ready(simulation_id=simulation_id, task_id=prepared_data.get("task_id"))
        snapshot = adapter.get_state(simulation_id)
    else:
        snapshot = adapter.get_state(simulation_id)

    scenario = adapter.run_scenario(
        name="mirofish-smoke",
        duration_minutes=duration_minutes,
        request_rate_per_min=request_rate_per_min,
        drivers_online=drivers_online,
        seed=42,
    )

    return {
        "health": health,
        "created": created,
        "prepared": prepared,
        "snapshot": snapshot,
        "scenario": scenario,
    }


def main() -> int:
    args = _parse_args()
    result = run_smoke_check(
        base_url=args.base_url,
        project_id=args.project_id,
        graph_id=args.graph_id,
        api_key=args.api_key,
        simulation_id=args.simulation_id,
        bootstrap=args.bootstrap,
        bootstrap_root=args.bootstrap_root,
        bootstrap_project_name=args.bootstrap_project_name,
        drivers_online=args.drivers_online,
        duration_minutes=args.duration_minutes,
        request_rate_per_min=args.request_rate_per_min,
        timeout=args.timeout,
        poll_interval_seconds=args.poll_interval_seconds,
        prepare_timeout_seconds=args.prepare_timeout_seconds,
    )
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
