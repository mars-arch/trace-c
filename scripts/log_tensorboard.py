"""Export committed baseline evidence to TensorBoard event files.

The model-training Python on this machine has torch/sklearn, while the
TensorBoard Python has tensorboardX. Keeping this as a JSON-to-events step
makes that split explicit and also lets a clean environment run both steps
with one Python installation.

Usage:
  python3 scripts/log_tensorboard.py [--logdir runs/trace-c-baselines]
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

ROOT = Path(__file__).resolve().parents[1]


def verify_committed_artifacts(project_root: Path) -> None:
    """Run the canonical verifier before exporting any reported metric."""
    try:
        result = subprocess.run(
            ["bun", "run", "scripts/verify-artifacts.ts"],
            cwd=project_root,
            capture_output=True,
            text=True,
            check=False,
        )
    except FileNotFoundError as exc:
        raise SystemExit("bun is required to verify TensorBoard evidence") from exc
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        raise SystemExit(detail or "committed artifact verification failed")


def validate_tensorboard_inputs(history: dict, scores: dict, report: dict) -> None:
    """Refuse to combine evidence produced from different inputs or trainers."""
    if history.get("trainer_sha256") != scores.get("trainer_sha256"):
        raise ValueError("training history trainer provenance mismatch")
    if history.get("series_sha256") != scores.get("series_sha256"):
        raise ValueError("training history series mismatch")
    reported = report.get("score_artifact") or {}
    if reported.get("trainer_sha256") != scores.get("trainer_sha256"):
        raise ValueError("comparison report trainer provenance mismatch")
    if reported.get("series_sha256") != scores.get("series_sha256"):
        raise ValueError("comparison report series mismatch")


def default_run_dir(root: Path, trainer_sha256: str, run_id: str) -> Path:
    """Put every invocation in its own TensorBoard run directory."""
    return root / f"{trainer_sha256[:12]}-{run_id}"


def claim_explicit_logdir(logdir: Path) -> Path:
    """Atomically reserve an explicit output directory for one exporter."""
    logdir.mkdir(parents=True, exist_ok=True)
    claim_path = logdir / ".trace-c-tensorboard.claim"
    try:
        descriptor = os.open(
            claim_path,
            os.O_CREAT | os.O_EXCL | os.O_WRONLY,
            0o644,
        )
    except FileExistsError as exc:
        raise SystemExit(
            f"refusing to use {logdir}; directory is already claimed by another export"
        ) from exc

    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as claim:
            claim.write(f"pid={os.getpid()}\n")
        # Check only after acquiring the claim. This closes the race where a
        # prior exporter finishes and releases its claim between our check and
        # reservation: its event file is then visible here.
        if any(logdir.glob("events.out.tfevents.*")):
            raise SystemExit(f"refusing to mix TensorBoard runs in non-empty {logdir}")
    except BaseException:
        claim_path.unlink(missing_ok=True)
        raise

    return claim_path


def log_baseline_tensorboard(writer: Any, history: dict, report: dict) -> None:
    """Write loss curves, parameter histograms, and comparison evidence."""
    for epoch in history.get("epochs", []):
        step = int(epoch["epoch"])
        writer.add_scalar("conv_ae/loss/train", float(epoch["train_loss"]), step)
        writer.add_scalar("conv_ae/loss/validation", float(epoch["val_loss"]), step)

    for name, snapshots in (history.get("weights_by_epoch") or {}).items():
        for step, values in enumerate(snapshots):
            writer.add_histogram(
                f"conv_ae/weights/{name}", np.asarray(values, dtype=np.float32), step
            )

    rows = list(report.get("baselines") or [])
    if report.get("trace_c"):
        rows.append(report["trace_c"])
    for row in rows:
        detector = row["detector"]
        for year in ("2019", "2020"):
            segment = row.get(f"y{year}") or {}
            for event in segment.get("known_events") or []:
                if event.get("rank") is not None:
                    writer.add_scalar(
                        f"comparison/{detector}/{year}/event_rank/{event['id']}",
                        int(event["rank"]),
                        0,
                    )
            for field in ("calibration", "calibration_precovid"):
                for calibration in segment.get(field) or []:
                    prefix = (
                        f"comparison/{detector}/{year}/{field}/"
                        f"p_{calibration['level']}"
                    )
                    writer.add_scalar(
                        prefix + "/observed", float(calibration["observed"]), 0
                    )
                    writer.add_scalar(
                        prefix + "/expected_null", float(calibration["expected_null"]), 0
                    )

    writer.add_text("comparison/protocol", report.get("protocol") or "", 0)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--logdir", help="empty output directory; defaults to a new run")
    args = parser.parse_args()

    try:
        from tensorboardX import SummaryWriter
    except ImportError as exc:
        raise SystemExit(
            "tensorboardX is required for this export; install requirements-baselines.txt "
            "or run with a Python that provides tensorboardX"
        ) from exc

    verify_committed_artifacts(ROOT)

    history_path = ROOT / "data/reports/ae-training-history.json"
    scores_path = ROOT / "data/reports/baseline-scores.json"
    report_path = ROOT / "data/reports/baselines-report.json"
    history = json.loads(history_path.read_text())
    scores = json.loads(scores_path.read_text())
    report = json.loads(report_path.read_text())
    validate_tensorboard_inputs(history, scores, report)

    claim_path: Path | None = None
    if args.logdir:
        logdir = Path(args.logdir)
        claim_path = claim_explicit_logdir(logdir)
    else:
        run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + f"-{os.getpid()}"
        logdir = default_run_dir(
            ROOT / "runs/trace-c-baselines", history["trainer_sha256"], run_id
        )

    try:
        writer = SummaryWriter(log_dir=str(logdir))
        try:
            log_baseline_tensorboard(writer, history, report)
            writer.flush()
        finally:
            writer.close()
    finally:
        if claim_path is not None:
            claim_path.unlink(missing_ok=True)
    print(f"wrote TensorBoard events -> {logdir}")


if __name__ == "__main__":
    main()
