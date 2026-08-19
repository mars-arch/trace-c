"""Baseline detectors for the TRACE-C comparison, run under the frozen
protocol's constraints: fit on Jan-Apr 2019 ONLY, score causally (a window's
score never sees data past its own end), same W=4 windows.

Baselines (deliberately the standard practitioner picks):
  conv_ae            1D conv autoencoder (keras-io timeseries-anomaly-detection
                     architecture, ported to torch), day-long sequences,
                     score = reconstruction MSE of the window's 4 positions
                     from the sequence ENDING at the window end (causal).
  pca                linear reconstruction error, k=3 of 6 streams.
  iforest            IsolationForest on per-window [mean, std] features.
  spectral_residual  Microsoft SR saliency recomputed from a trailing context
                     ending at each window, max over streams.

All use GLOBAL per-stream train standardization (no regime conditioning) —
that naivety is part of what the comparison measures.

Inputs : verified NESO inputs; scripts/export-series.ts refreshes the aligned
         data/real/series-export.json before model libraries are imported.
Outputs: data/reports/baseline-scores.json
         data/reports/ae-training-history.json  (loss curves + weight snapshots)

Run with a python that has torch + sklearn + numpy, e.g.:
  /Library/Frameworks/Python.framework/Versions/3.13/bin/python3 scripts/train_baselines.py
Use --preflight-only to verify runtime/raw inputs and refresh the export.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
import subprocess
import sys
from pathlib import Path

from runtime_environment import validate_runtime_environment

ROOT = Path(__file__).resolve().parents[1]
# Fail before importing model libraries, reading data, or starting training.
RUNTIME_VERSIONS = validate_runtime_environment(ROOT)

parser = argparse.ArgumentParser()
parser.add_argument(
    "--preflight-only",
    action="store_true",
    help="verify pinned runtime/raw inputs and refresh the aligned series, then exit",
)
ARGS = parser.parse_args()

# The TypeScript exporter is the only allowed raw-data parser. Running it here
# makes the direct trainer entry point as fail-closed as `bun run baselines`:
# all four raw inputs are checksum-verified and the cached aligned series is
# refreshed before either evidence output can be touched.
export_result = subprocess.run(
    ["bun", "run", "scripts/export-series.ts"],
    cwd=ROOT,
    capture_output=True,
    text=True,
    check=False,
)
if export_result.stdout:
    print(export_result.stdout, end="")
if export_result.returncode != 0:
    if export_result.stderr:
        print(export_result.stderr, end="", file=sys.stderr)
    raise SystemExit(export_result.returncode)
if ARGS.preflight_only:
    print("baseline training preflight verified")
    raise SystemExit(0)

import numpy as np
import torch
import torch.nn as nn
from sklearn.ensemble import IsolationForest

from baseline_models import spectral_residual_window_scores, temporal_sequence_starts

SEED = 42
SEQ = 48  # one day of half-hourly periods
EPOCHS = 40
BATCH = 128

np.random.seed(SEED)
torch.manual_seed(SEED)
torch.set_num_threads(1)
torch.set_num_interop_threads(1)
torch.use_deterministic_algorithms(True)

series_path = ROOT / "data/real/series-export.json"
series_bytes = series_path.read_bytes()
exp = json.loads(series_bytes)
streams = exp["streams"]
dates = exp["dates"]
n = exp["n"]
W = exp["window_size"]
X = np.stack([np.asarray(exp["values"][s], dtype=np.float64) for s in streams], axis=1)  # (n, d)
d = X.shape[1]

train_end = next(i for i, dt in enumerate(dates) if dt >= exp["train_end_date"])
cal_end = next(i for i, dt in enumerate(dates) if dt >= exp["cal_end_date"])
n_windows = n // W

# Global per-stream standardization from the train segment only.
mu = X[:train_end].mean(axis=0)
sd = X[:train_end].std(axis=0)
sd[sd == 0] = 1.0
Z = (X - mu) / sd
if not np.isfinite(Z).all():
    raise ValueError("standardized series contains non-finite values")


def implementation_sha256() -> str:
    digest = hashlib.sha256()
    for path in (
        ROOT / "scripts/baseline_models.py",
        ROOT / "scripts/runtime_environment.py",
        Path(__file__).resolve(),
        ROOT / "requirements-baselines.txt",
        ROOT / ".python-version",
        ROOT / "scripts/export-series.ts",
        ROOT / "src/real.ts",
        ROOT / "src/holdout.ts",
        ROOT / "data/source-checksums.json",
    ):
        digest.update(path.name.encode())
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


SERIES_SHA256 = hashlib.sha256(series_bytes).hexdigest()
TRAINER_SHA256 = implementation_sha256()
VERSIONS = {
    **RUNTIME_VERSIONS,
    "platform": platform.system(),
    "machine": platform.machine(),
}


def window_slices():
    for w in range(n_windows):
        yield w, w * W, w * W + W


# ---------------- conv autoencoder (keras-io architecture, torch) ----------------

class ConvAE(nn.Module):
    def __init__(self, channels: int):
        super().__init__()
        self.net = nn.Sequential(
            nn.Conv1d(channels, 32, 7, stride=2, padding=3),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Conv1d(32, 16, 7, stride=2, padding=3),
            nn.ReLU(),
            nn.ConvTranspose1d(16, 16, 7, stride=2, padding=3, output_padding=1),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.ConvTranspose1d(16, 32, 7, stride=2, padding=3, output_padding=1),
            nn.ReLU(),
            nn.Conv1d(32, channels, 7, padding=3),
        )

    def forward(self, x):  # (b, c, SEQ)
        return self.net(x)


def train_conv_ae():
    train_starts, validation_starts = temporal_sequence_starts(
        train_end, sequence_length=SEQ, stride=4, validation_fraction=0.1
    )
    tr = torch.tensor(
        np.stack([Z[s : s + SEQ].T for s in train_starts]), dtype=torch.float32
    )
    va = torch.tensor(
        np.stack([Z[s : s + SEQ].T for s in validation_starts]), dtype=torch.float32
    )

    model = ConvAE(d)
    opt = torch.optim.Adam(model.parameters(), lr=1e-3)
    loss_fn = nn.MSELoss()
    history = []
    weights_by_epoch: dict[str, list] = {}

    for epoch in range(EPOCHS):
        model.train()
        perm = torch.randperm(len(tr))
        total = 0.0
        for i in range(0, len(tr), BATCH):
            batch = tr[perm[i : i + BATCH]]
            opt.zero_grad()
            loss = loss_fn(model(batch), batch)
            loss.backward()
            opt.step()
            total += loss.item() * len(batch)
        model.eval()
        with torch.no_grad():
            val = loss_fn(model(va), va).item()
        history.append({"epoch": epoch, "train_loss": total / len(tr), "val_loss": val})
        for name, p in model.named_parameters():
            weights_by_epoch.setdefault(name, []).append(
                [round(float(v), 5) for v in p.detach().flatten().tolist()]
            )
        print(f"epoch {epoch:02d}  train {history[-1]['train_loss']:.5f}  val {val:.5f}", flush=True)

    # Causal per-window score: MSE of the window's 4 positions from the
    # sequence ending at the window's last timestep.
    model.eval()
    scores: list[float | None] = [None] * n_windows
    ends, widx = [], []
    for w, t0, t1 in window_slices():
        t_end = t1 - 1
        if t_end - SEQ + 1 < 0:
            continue
        ends.append(Z[t_end - SEQ + 1 : t_end + 1].T)
        widx.append(w)
    seq_t = torch.tensor(np.stack(ends), dtype=torch.float32)
    with torch.no_grad():
        errs = []
        for i in range(0, len(seq_t), 512):
            b = seq_t[i : i + 512]
            e = (model(b) - b) ** 2  # (b, c, SEQ)
            errs.append(e[:, :, -W:].mean(dim=(1, 2)).numpy())
    err = np.concatenate(errs)
    for i, w in enumerate(widx):
        scores[w] = float(err[i])

    (ROOT / "data/reports/ae-training-history.json").write_text(
        json.dumps(
            {
                "schema_version": 2,
                "seed": SEED,
                "series_sha256": SERIES_SHA256,
                "trainer_sha256": TRAINER_SHA256,
                "versions": VERSIONS,
                "training": {
                    "sequence_length": SEQ,
                    "epochs": EPOCHS,
                    "batch_size": BATCH,
                    "weight_snapshot_decimals": 5,
                    "train_sequences": len(tr),
                    "validation_sequences": len(va),
                    "validation_note": (
                        "Diagnostic temporal holdout with no raw-observation overlap; "
                        "global scaling is fit on the full Jan-Apr model-fit segment; "
                        "no early stopping or epoch selection."
                    ),
                },
                "epochs": history,
                "weights_by_epoch": weights_by_epoch,
            },
            sort_keys=True,
        )
    )
    return scores


# ---------------- PCA reconstruction ----------------

def pca_scores():
    Ztr = Z[:train_end]
    _, _, Vt = np.linalg.svd(Ztr - Ztr.mean(axis=0), full_matrices=False)
    Vk = Vt[:3]
    # Explicit reductions avoid a noisy Accelerate/BLAS matmul warning seen
    # with this small (N x 6) matrix on macOS while retaining the same linear
    # projection.
    projected = np.stack([(Z * axis).sum(axis=1) for axis in Vk], axis=1)
    reconstruction = sum(projected[:, k, None] * Vk[k] for k in range(len(Vk)))
    resid = Z - reconstruction
    per_t = (resid**2).sum(axis=1)
    return [float(per_t[t0:t1].mean()) for _, t0, t1 in window_slices()]


# ---------------- Isolation Forest ----------------

def iforest_scores():
    feats = np.array(
        [np.concatenate([Z[t0:t1].mean(axis=0), Z[t0:t1].std(axis=0)]) for _, t0, t1 in window_slices()]
    )
    train_mask = np.array([t1 <= train_end for _, _, t1 in window_slices()])
    clf = IsolationForest(n_estimators=200, random_state=SEED)
    clf.fit(feats[train_mask])
    return [float(v) for v in (-clf.score_samples(feats))]


# ---------------- Spectral Residual (strictly causal) ----------------

def spectral_residual_scores():
    return spectral_residual_window_scores(Z, window_size=W, context=1440)


print("training conv_ae...", flush=True)
conv_ae = train_conv_ae()
print("pca...", flush=True)
pca = pca_scores()
print("iforest...", flush=True)
iforest = iforest_scores()
print("spectral_residual...", flush=True)
sr = spectral_residual_scores()

out = {
    "schema_version": 2,
    "seed": SEED,
    "seq_len": SEQ,
    "n_windows": n_windows,
    "train_end_idx": train_end,
    "cal_end_idx": cal_end,
    "series_sha256": SERIES_SHA256,
    "trainer_sha256": TRAINER_SHA256,
    "versions": VERSIONS,
    "standardization": "global per-stream train mean/std (deliberately regime-naive)",
    "scores": {
        "conv_ae": conv_ae,
        "pca": pca,
        "iforest": iforest,
        "spectral_residual": sr,
    },
}
for name, scores in out["scores"].items():
    finite = [value for value in scores if value is not None]
    if len(finite) == 0 or not np.isfinite(finite).all():
        raise ValueError(f"{name} produced non-finite scores")
(ROOT / "data/reports/baseline-scores.json").write_text(json.dumps(out, sort_keys=True))
print(f"wrote baseline-scores.json ({n_windows} windows × 4 baselines)")
