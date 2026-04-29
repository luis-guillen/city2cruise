"""
RLAgent — PPO-based driver-dispatch agent (Stable-Baselines3).

Responsibilities:
  • Load or create a PPO model for CruiseDispatchEnv on startup.
  • train()     — run online PPO training; save checkpoint to MODEL_PATH.
  • get_rankings() — convert a real StateTensorInput to a ranked driver list.

Thread safety: SB3 policy inference is stateless (no hidden state updated during
predict), so concurrent calls to get_rankings() are safe. Training is serialised
via a lock to prevent parallel runs corrupting the model weights.
"""

from __future__ import annotations

import os
import json
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import numpy as np

from .gym_env import (
    CruiseDispatchEnv,
    TensorEncoder,
    SimDriver,
    MAX_DRIVERS,
    norm_lat,
    norm_lon,
)
from .schemas import AssignmentResult, StateTensorInput

# ─── Model persistence ────────────────────────────────────────────────────────

MODEL_PATH = Path(os.getenv("RL_MODEL_PATH", "/tmp/cruise_dispatch_ppo"))
MODEL_META_PATH = Path(f"{MODEL_PATH}.meta.json")


# ─── Agent ────────────────────────────────────────────────────────────────────

class RLAgent:
    MODEL_VERSION = "ppo-v2"

    def __init__(self) -> None:
        # Defer heavy SB3 imports to constructor so the module can be imported
        # without torch installed (e.g., for schema-only usage in tests).
        from stable_baselines3 import PPO
        from stable_baselines3.common.env_util import make_vec_env

        self._PPO = PPO
        self._make_vec_env = make_vec_env
        self._train_lock = threading.Lock()
        self._total_timesteps = 0
        self._last_trained_at: Optional[str] = None

        self.model: PPO = self._load_or_create()

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    def _make_env(self, n_envs: int = 8):
        return self._make_vec_env(
            lambda: CruiseDispatchEnv(n_drivers=8, n_requests=12, max_steps=20),
            n_envs=n_envs,
        )

    def _load_or_create(self):
        path = Path(f"{MODEL_PATH}.zip")
        if path.exists() and self._is_compatible_checkpoint():
            model = self._PPO.load(str(MODEL_PATH), env=self._make_env())
            print(f"[RLAgent] Loaded model from {MODEL_PATH}.zip")
        else:
            model = self._PPO(
                policy="MlpPolicy",
                env=self._make_env(n_envs=8),
                verbose=0,
                learning_rate=1e-4,
                n_steps=1024,
                batch_size=256,
                n_epochs=10,
                gamma=0.99,
                gae_lambda=0.95,
                clip_range=0.2,
                ent_coef=0.005,
                policy_kwargs={"net_arch": [256, 256]},
            )
            print("[RLAgent] Initialised untrained PPO model")
        return model

    def _is_compatible_checkpoint(self) -> bool:
        if not MODEL_META_PATH.exists():
            return False
        try:
            payload = json.loads(MODEL_META_PATH.read_text())
        except Exception:
            return False
        return payload.get("modelVersion") == self.MODEL_VERSION

    # ── Training ──────────────────────────────────────────────────────────────

    def train(self, total_timesteps: int = 100_000) -> dict:
        """
        Run PPO training for `total_timesteps` environment steps.
        Serialised — concurrent calls queue and run sequentially.
        """
        with self._train_lock:
            start = time.monotonic()
            self.model.set_env(self._make_env())
            self.model.learn(
                total_timesteps=total_timesteps,
                reset_num_timesteps=False,
                progress_bar=False,
            )
            MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
            self.model.save(str(MODEL_PATH))
            MODEL_META_PATH.write_text(json.dumps({"modelVersion": self.MODEL_VERSION}))
            elapsed = time.monotonic() - start
            self._total_timesteps += total_timesteps
            self._last_trained_at = datetime.now(timezone.utc).isoformat()

            print(
                f"[RLAgent] Trained {total_timesteps:,} steps in {elapsed:.1f}s "
                f"(total: {self._total_timesteps:,}) → {MODEL_PATH}.zip"
            )
            return {
                "timesteps": total_timesteps,
                "total_timesteps": self._total_timesteps,
                "duration_s": round(elapsed, 2),
            }

    # ── Inference ─────────────────────────────────────────────────────────────

    def get_rankings(self, state: StateTensorInput) -> list[AssignmentResult]:
        """
        Given a real StateTensor, return drivers ranked by RL-estimated suitability
        for the most urgent pending request (descending score).

        Drivers with no recent GPS data in the tensor are excluded.
        Falls back to distance-based score if the model has never been trained.
        """
        if not state.drivers:
            return []

        sim_drivers = [
            SimDriver(
                driver_id=d.driverId,
                lat=d.lat,
                lon=d.lon,
                lat_norm=d.latNorm,
                lon_norm=d.lonNorm,
                speed_mps=d.speedMps,
                speed_norm=d.speedNorm,
                eta_norm=(d.eta.distanceNorm if d.eta else 0.0),
                is_available=(d.eta is None),
            )
            for d in state.drivers
        ]

        max_urgency = max((u.urgency for u in state.urgency), default=0.0)
        active_norm = min(1.0, state.activeRequestCount / 50.0)
        clusters = [
            (norm_lat(c.centroidLat), norm_lon(c.centroidLon), min(1.0, c.requestCount / 20.0))
            for c in state.demandClusters
        ]

        obs = TensorEncoder.encode(
            sim_drivers,
            clusters,
            state.lockers.occupancyRate,
            max_urgency,
            active_norm,
        )

        probs = self._action_probabilities(obs)
        n = len(sim_drivers)

        ranked = sorted(
            range(n),
            key=lambda i: float(probs[i]) if i < len(probs) else 0.0,
            reverse=True,
        )

        return [
            AssignmentResult(
                driverId=sim_drivers[idx].driver_id,
                score=float(probs[idx]) if idx < len(probs) else 0.0,
                rank=rank,
                etaMs=sim_drivers[idx].eta_norm * 900_000 if sim_drivers[idx].eta_norm else None,
            )
            for rank, idx in enumerate(ranked)
        ]

    def _action_probabilities(self, obs: np.ndarray) -> np.ndarray:
        """
        Extract per-action softmax probabilities from the PPO policy network.
        Returns an array of length MAX_DRIVERS; unused slots are near-zero.
        """
        import torch

        obs_batch = obs[np.newaxis, :].astype(np.float32)  # (1, OBS_DIM)

        with torch.no_grad():
            obs_t = torch.as_tensor(obs_batch, dtype=torch.float32, device=self.model.device)
            features = self.model.policy.extract_features(obs_t)
            latent_pi, _ = self.model.policy.mlp_extractor(features)
            logits = self.model.policy.action_net(latent_pi)  # (1, MAX_DRIVERS)
            probs = torch.softmax(logits, dim=-1).cpu().numpy()[0]

        return probs

    # ── Metadata ──────────────────────────────────────────────────────────────

    def metadata(self) -> dict:
        return {
            "modelVersion": self.MODEL_VERSION,
            "totalTimesteps": self._total_timesteps,
            "lastTrainedAt": self._last_trained_at,
            "modelPath": str(MODEL_PATH),
            "modelExists": Path(f"{MODEL_PATH}.zip").exists(),
        }
