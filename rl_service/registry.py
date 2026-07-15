"""
File-based model registry (MLOps §4.4).

A dependency-light, git-friendly model registry: an index (`registry/registry.json`,
tracked) plus one immutable directory per version holding the checkpoint, metadata,
evaluation summary, promotion decision and model card. Model blobs are gitignored
(regenerable); everything else is tracked for auditability.

Promotion to `production` is gated by the promotion policy
(`rl_service.validation.promotion`) — a model that does not pass is refused unless
`--force`. On production promotion the checkpoint is synced back into
`rl_service/artifacts/` so the serving container loads the production model.

CLI:
  python -m rl_service.registry register [--version ID] [--stage candidate]
  python -m rl_service.registry list
  python -m rl_service.registry promote --version ID [--to production] [--force]
  python -m rl_service.registry current
"""
from __future__ import annotations

import argparse
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

from .validation.promotion import evaluate_promotion
from .model_card import render_model_card

_HERE = Path(__file__).resolve().parent
ARTIFACTS_DIR = _HERE / "artifacts"
REGISTRY_DIR = _HERE / "registry"
REGISTRY_INDEX = REGISTRY_DIR / "registry.json"
DOCS_CARD = _HERE.parent / "docs" / "MODEL_CARD.md"

MODEL_NAME = "cruise_dispatch_ppo"


def _load_index() -> dict:
    if REGISTRY_INDEX.exists():
        return json.loads(REGISTRY_INDEX.read_text())
    return {"models": [], "production": None}


def _save_index(idx: dict) -> None:
    REGISTRY_DIR.mkdir(parents=True, exist_ok=True)
    REGISTRY_INDEX.write_text(json.dumps(idx, indent=2))


def _find(idx: dict, version: str):
    return next((m for m in idx["models"] if m["version"] == version), None)


def _metrics(summary: dict) -> dict:
    b, conv, fid = summary["benchmark"], summary["convergence"], summary["fidelity"]
    metrics = {
        "reward_ppo": round(b["rl_ppo"]["mean_reward"], 2),
        "reward_greedy": round(b["greedy"]["mean_reward"], 2),
        "reward_random": round(b["random"]["mean_reward"], 2),
        "coeff_var": round(conv["coeff_var"], 4),
        "reality_gap_avg_pct": round(fid["delta_avg_pct"], 4),
    }
    # Phase-2 baselines (absent in phase-1 summaries).
    for name in ("cascade", "patient"):
        if name in b:
            metrics[f"reward_{name}"] = round(b[name]["mean_reward"], 2)
    return metrics


def register(version: str | None = None, source: Path = ARTIFACTS_DIR,
             stage: str = "candidate") -> str:
    meta = json.loads((source / f"{MODEL_NAME}.meta.json").read_text())
    summary = json.loads((source / "summary.json").read_text())
    if version is None:
        ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        version = f"ppo-{ts}-{meta.get('gitSha', 'nosha')}"

    vdir = REGISTRY_DIR / version
    vdir.mkdir(parents=True, exist_ok=True)
    shutil.copy(source / f"{MODEL_NAME}.zip", vdir / "model.zip")
    (vdir / "meta.json").write_text(json.dumps(meta, indent=2))
    (vdir / "summary.json").write_text(json.dumps(summary, indent=2))

    promotion = evaluate_promotion(summary)
    (vdir / "promotion.json").write_text(json.dumps(promotion, indent=2))
    (vdir / "model_card.md").write_text(render_model_card(version, stage, meta, summary, promotion))

    idx = _load_index()
    entry = {
        "version": version,
        "createdAt": meta.get("lastTrainedAt"),
        "gitSha": meta.get("gitSha"),
        "stage": stage,
        "metrics": _metrics(summary),
        "promotable": promotion["promote"],
        "surpassesGreedy": promotion["surpasses_greedy"],
        "path": f"registry/{version}",
    }
    idx["models"] = [m for m in idx["models"] if m["version"] != version] + [entry]
    _save_index(idx)
    print(f"[registry] registered {version}  stage={stage}  promotable={promotion['promote']}")
    return version


def promote(version: str, to: str = "production", force: bool = False) -> None:
    idx = _load_index()
    entry = _find(idx, version)
    if entry is None:
        raise SystemExit(f"[registry] unknown version {version}")

    vdir = REGISTRY_DIR / version
    promotion = json.loads((vdir / "promotion.json").read_text())
    if to == "production" and not promotion["promote"] and not force:
        raise SystemExit(f"[registry] REFUSED: {version} fails promotion policy "
                         f"{promotion['checks']}. Use --force to override.")

    # Re-render the model card so it reflects the new stage.
    meta = json.loads((vdir / "meta.json").read_text())
    summary = json.loads((vdir / "summary.json").read_text())
    card = render_model_card(version, to, meta, summary, promotion)
    (vdir / "model_card.md").write_text(card)

    if to == "production":
        for m in idx["models"]:
            if m["stage"] == "production":
                m["stage"] = "archived"
        idx["production"] = version
        # Sync the production checkpoint into artifacts/ so serving loads it.
        shutil.copy(vdir / "model.zip", ARTIFACTS_DIR / f"{MODEL_NAME}.zip")
        shutil.copy(vdir / "meta.json", ARTIFACTS_DIR / f"{MODEL_NAME}.meta.json")
        DOCS_CARD.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(vdir / "model_card.md", DOCS_CARD)

    entry["stage"] = to
    _save_index(idx)
    print(f"[registry] promoted {version} → {to}")


def list_models() -> None:
    idx = _load_index()
    if not idx["models"]:
        print("[registry] empty")
        return
    print(f"{'VERSION':40s} {'STAGE':11s} {'PPO':>7s} {'GREEDY':>7s} {'PROMOTABLE':>10s}")
    for m in idx["models"]:
        mk = m["metrics"]
        star = " *" if m["version"] == idx.get("production") else "  "
        print(f"{m['version']:40s} {m['stage']:11s} {mk['reward_ppo']:7.1f} "
              f"{mk['reward_greedy']:7.1f} {str(m['promotable']):>10s}{star}")


def current() -> None:
    idx = _load_index()
    prod = idx.get("production")
    if not prod:
        print("[registry] no production model")
        return
    entry = _find(idx, prod)
    print(json.dumps({"production": prod, **entry}, indent=2))


def main() -> None:
    ap = argparse.ArgumentParser(description="CruiseDispatch model registry")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p_reg = sub.add_parser("register")
    p_reg.add_argument("--version")
    p_reg.add_argument("--stage", default="candidate")
    sub.add_parser("list")
    p_prom = sub.add_parser("promote")
    p_prom.add_argument("--version", required=True)
    p_prom.add_argument("--to", default="production")
    p_prom.add_argument("--force", action="store_true")
    sub.add_parser("current")
    args = ap.parse_args()

    if args.cmd == "register":
        register(version=args.version, stage=args.stage)
    elif args.cmd == "list":
        list_models()
    elif args.cmd == "promote":
        promote(args.version, args.to, args.force)
    elif args.cmd == "current":
        current()


if __name__ == "__main__":
    main()
