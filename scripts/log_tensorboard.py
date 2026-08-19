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
from pathlib import Path
from typing import Any

import numpy as np

ROOT = Path(__file__).resolve().parents[1]


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
    parser.add_argument("--logdir", default=str(ROOT / "runs/trace-c-baselines"))
    args = parser.parse_args()

    try:
        from tensorboardX import SummaryWriter
    except ImportError as exc:
        raise SystemExit(
            "tensorboardX is required for this export; install requirements-baselines.txt "
            "or run with a Python that provides tensorboardX"
        ) from exc

    history = json.loads((ROOT / "data/reports/ae-training-history.json").read_text())
    report = json.loads((ROOT / "data/reports/baselines-report.json").read_text())
    writer = SummaryWriter(log_dir=args.logdir)
    try:
        log_baseline_tensorboard(writer, history, report)
        writer.flush()
    finally:
        writer.close()
    print(f"wrote TensorBoard events -> {args.logdir}")


if __name__ == "__main__":
    main()
