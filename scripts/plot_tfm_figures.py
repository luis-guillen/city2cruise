#!/usr/bin/env python3
"""
plot_tfm_figures.py — regenerates the TFM evidence figures from the canonical
training artifacts (rl_service/artifacts/), so the thesis figures are always
reproducible from data:

  Figura 9   docs/figures/fig9_convergencia.png    ← rewards.csv
  Figura 10  docs/figures/fig10_benchmark.png      ← benchmark.json
  Figura 11  docs/figures/fig11_reality_gap.png    ← fidelity.json

Usage:
  python scripts/plot_tfm_figures.py [--out docs/figures]
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "rl_service" / "artifacts"

POLICY_LABELS = {
    "random": "Aleatoria",
    "cascade": "Cascada\n(prod.)",
    "greedy": "Greedy\n(min-ETA)",
    "patient": "Patient\n(anticip.)",
    "rl_ppo": "PPO (RL)",
}
POLICY_ORDER = ["random", "cascade", "greedy", "patient", "rl_ppo"]
COLORS = {
    "random": "#b0b7c3",
    "cascade": "#8d99ae",
    "greedy": "#457b9d",
    "patient": "#2a9d8f",
    "rl_ppo": "#e63946",
}


def _style(ax):
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(axis="y", alpha=0.3, linewidth=0.6)
    ax.set_axisbelow(True)


def fig9_convergencia(out_dir: Path) -> Path:
    steps, rewards = [], []
    with (ARTIFACTS / "rewards.csv").open() as fh:
        for row in csv.DictReader(fh):
            steps.append(int(row["step"]))
            rewards.append(float(row["reward"]))

    fig, ax = plt.subplots(figsize=(8, 4.5), dpi=200)
    ax.plot(steps, rewards, color="#457b9d", linewidth=1.2, alpha=0.55,
            label="Recompensa media por rollout")
    # Rolling mean for readability
    k = max(1, len(rewards) // 25)
    smooth = [
        sum(rewards[max(0, i - k):i + 1]) / len(rewards[max(0, i - k):i + 1])
        for i in range(len(rewards))
    ]
    ax.plot(steps, smooth, color="#e63946", linewidth=2.2,
            label=f"Media móvil (k={k})")
    ax.set_xlabel("Pasos de entrenamiento")
    ax.set_ylabel("Recompensa media de episodio")
    ax.set_title("Convergencia del entrenamiento PPO — formulación anticipatoria")
    ax.text(0.02, 0.04,
            "Inicialización: clonación de la heurística anticipatoria (BC)\n"
            "+ fine-tuning PPO con randomización de dominio",
            transform=ax.transAxes, fontsize=9, va="bottom",
            bbox=dict(boxstyle="round,pad=0.35", fc="#f2f6fa", ec="#457b9d", lw=0.8))
    ax.legend(frameon=False, loc="lower right")
    _style(ax)
    fig.tight_layout()
    out = out_dir / "fig9_convergencia.png"
    fig.savefig(out)
    plt.close(fig)
    return out


def fig10_benchmark(out_dir: Path) -> Path:
    bench = json.loads((ARTIFACTS / "benchmark.json").read_text())
    policies = [p for p in POLICY_ORDER if p in bench]
    rewards = [bench[p]["mean_reward"] for p in policies]
    expired = [bench[p].get("mean_expired", 0.0) for p in policies]

    fig, (ax1, ax2) = plt.subplots(
        1, 2, figsize=(11, 4.6), dpi=200, gridspec_kw={"width_ratios": [3, 2]}
    )

    xs = range(len(policies))
    bars = ax1.bar(xs, rewards, color=[COLORS[p] for p in policies], width=0.62)
    for b, v in zip(bars, rewards):
        ax1.text(b.get_x() + b.get_width() / 2, v + max(rewards) * 0.012,
                 f"{v:,.0f}", ha="center", va="bottom", fontsize=9, fontweight="bold")
    ax1.set_xticks(list(xs))
    ax1.set_xticklabels([POLICY_LABELS[p] for p in policies], fontsize=8.5)
    ax1.set_ylabel("Recompensa media de episodio")
    ax1.set_title("Recompensa media (N=1000 episodios pareados)")
    _style(ax1)

    imp = bench.get("improvement", {})
    if "reward_vs_greedy_pct" in imp:
        ci = imp.get("delta_vs_greedy_ci95", {})
        note = f"PPO vs greedy: {imp['reward_vs_greedy_pct']:+.1%}"
        if ci:
            note += f"\nΔ IC95: [{ci.get('ci95_low', 0):+.0f}, {ci.get('ci95_high', 0):+.0f}]"
        ax1.text(0.02, 0.97, note, transform=ax1.transAxes, fontsize=9,
                 va="top", ha="left",
                 bbox=dict(boxstyle="round,pad=0.35", fc="#fff3f3", ec="#e63946", lw=0.8))

    bars2 = ax2.bar(xs, expired, color=[COLORS[p] for p in policies], width=0.62)
    for b, v in zip(bars2, expired):
        ax2.text(b.get_x() + b.get_width() / 2, v + max(expired + [0.1]) * 0.015,
                 f"{v:.2f}", ha="center", va="bottom", fontsize=9)
    ax2.set_xticks(list(xs))
    ax2.set_xticklabels([POLICY_LABELS[p] for p in policies], fontsize=8.5)
    ax2.set_ylabel("Solicitudes expiradas por episodio")
    ax2.set_title("Deadlines all-aboard incumplidos")
    _style(ax2)

    fig.suptitle("Benchmark de políticas de despacho — entorno anticipatorio (DR off)",
                 fontsize=12, y=1.02)
    fig.tight_layout()
    out = out_dir / "fig10_benchmark.png"
    fig.savefig(out, bbox_inches="tight")
    plt.close(fig)
    return out


def fig11_reality_gap(out_dir: Path) -> Path:
    fid = json.loads((ARTIFACTS / "fidelity.json").read_text())
    labels = ["Tiempo medio de matching (s)", "Tiempo p95 de matching (s)"]
    twin = [fid["twin_avg_match_seconds"], fid["twin_p95_match_seconds"]]
    prod = [fid["prod_avg_match_seconds"], fid["prod_p95_match_seconds"]]
    deltas = [fid["delta_avg_pct"], fid["delta_p95_pct"]]

    fig, ax = plt.subplots(figsize=(7.5, 4.4), dpi=200)
    xs = range(len(labels))
    w = 0.34
    b1 = ax.bar([x - w / 2 for x in xs], twin, w, label="Gemelo digital (sim)",
                color="#457b9d")
    b2 = ax.bar([x + w / 2 for x in xs], prod, w, label="Referencia representativa",
                color="#e9a23b")
    for bars in (b1, b2):
        for b in bars:
            ax.text(b.get_x() + b.get_width() / 2, b.get_height() + 1,
                    f"{b.get_height():.1f}", ha="center", va="bottom", fontsize=9)
    for x, d in zip(xs, deltas):
        ax.text(x, max(twin[x], prod[x]) + 8, f"gap {d * 100:.1f} %",
                ha="center", fontsize=10, fontweight="bold", color="#2a2a2a")
    ax.set_xticks(list(xs))
    ax.set_xticklabels(labels)
    ax.set_ylabel("Segundos")
    ax.set_ylim(0, max(twin + prod) * 1.25)
    ax.set_title(f"Reality gap sim-real (umbral 20 %) — pass={fid['pass']}")
    ax.legend(frameon=False)
    _style(ax)
    fig.tight_layout()
    out = out_dir / "fig11_reality_gap.png"
    fig.savefig(out)
    plt.close(fig)
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="Regenerate TFM figures from artifacts")
    ap.add_argument("--out", default=str(ROOT / "docs" / "figures"))
    args = ap.parse_args()
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    for fn in (fig9_convergencia, fig10_benchmark, fig11_reality_gap):
        path = fn(out_dir)
        print(f"[figures] wrote {path}")


if __name__ == "__main__":
    main()
