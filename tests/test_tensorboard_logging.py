import unittest
from pathlib import Path
from subprocess import CompletedProcess
from tempfile import TemporaryDirectory
from unittest.mock import patch

import scripts.log_tensorboard as tensorboard_logging

from scripts.log_tensorboard import (
    default_run_dir,
    log_baseline_tensorboard,
    validate_tensorboard_inputs,
    verify_committed_artifacts,
)


class RecordingWriter:
    def __init__(self):
        self.scalars = []
        self.histograms = []
        self.text = []

    def add_scalar(self, tag, value, step):
        self.scalars.append((tag, value, step))

    def add_histogram(self, tag, values, step):
        self.histograms.append((tag, list(values), step))

    def add_text(self, tag, value, step):
        self.text.append((tag, value, step))


class TensorBoardLoggingTest(unittest.TestCase):
    def test_logs_real_losses_weights_calibration_and_event_ranks(self):
        history = {
            "epochs": [
                {"epoch": 0, "train_loss": 0.8, "val_loss": 0.9},
                {"epoch": 1, "train_loss": 0.5, "val_loss": 0.6},
            ],
            "weights_by_epoch": {"net.0.weight": [[1.0, 2.0], [3.0, 4.0]]},
        }
        report = {
            "protocol": "strictly-prior test protocol",
            "baselines": [
                {
                    "detector": "conv_ae",
                    "y2019": {
                        "calibration": [{"level": 0.05, "observed": 4, "expected_null": 5}],
                        "known_events": [{"id": "EVENT-A", "rank": 7}],
                    },
                    "y2020": {
                        "calibration": [{"level": 0.05, "observed": 6, "expected_null": 5}],
                        "calibration_precovid": [
                            {"level": 0.05, "observed": 4, "expected_null": 3}
                        ],
                        "known_events": [{"id": "EVENT-B", "rank": 3}],
                    },
                }
            ],
        }
        writer = RecordingWriter()

        log_baseline_tensorboard(writer, history, report)

        self.assertIn(("conv_ae/loss/train", 0.5, 1), writer.scalars)
        self.assertIn(("conv_ae/loss/validation", 0.6, 1), writer.scalars)
        self.assertIn(("conv_ae/weights/net.0.weight", [3.0, 4.0], 1), writer.histograms)
        self.assertIn(("comparison/conv_ae/2019/event_rank/EVENT-A", 7, 0), writer.scalars)
        self.assertIn(("comparison/conv_ae/2020/calibration/p_0.05/observed", 6, 0), writer.scalars)
        self.assertIn(
            ("comparison/conv_ae/2020/calibration_precovid/p_0.05/observed", 4, 0),
            writer.scalars,
        )
        self.assertEqual(writer.text, [("comparison/protocol", "strictly-prior test protocol", 0)])

    def test_rejects_history_from_a_different_trainer(self):
        history = {"trainer_sha256": "trainer-a", "series_sha256": "series-a"}
        scores = {"trainer_sha256": "trainer-b", "series_sha256": "series-a"}
        report = {
            "score_artifact": {
                "trainer_sha256": "trainer-b",
                "series_sha256": "series-a",
            }
        }

        with self.assertRaisesRegex(ValueError, "training history trainer provenance mismatch"):
            validate_tensorboard_inputs(history, scores, report)

    def test_default_runs_are_isolated_below_an_artifact_named_directory(self):
        path = default_run_dir(Path("runs"), "abcdef1234567890", "20260819T120000Z-42")

        self.assertEqual(path, Path("runs/abcdef123456-20260819T120000Z-42"))

    def test_refuses_to_log_when_full_report_verification_fails(self):
        failed = CompletedProcess(
            args=["bun"],
            returncode=1,
            stdout="",
            stderr="baseline comparison report body is stale or tampered",
        )
        with patch("scripts.log_tensorboard.subprocess.run", return_value=failed):
            with self.assertRaisesRegex(
                SystemExit, "baseline comparison report body is stale or tampered"
            ):
                verify_committed_artifacts(Path("."))

    def test_explicit_logdir_claim_is_exclusive_until_released(self):
        claim_logdir = getattr(tensorboard_logging, "claim_explicit_logdir", None)
        self.assertTrue(callable(claim_logdir), "atomic logdir claim helper is missing")

        with TemporaryDirectory() as tmp:
            logdir = Path(tmp) / "existing-empty-run"
            logdir.mkdir()
            first_claim = claim_logdir(logdir)
            try:
                with self.assertRaisesRegex(SystemExit, "already claimed"):
                    claim_logdir(logdir)
            finally:
                first_claim.unlink()

            second_claim = claim_logdir(logdir)
            second_claim.unlink()


if __name__ == "__main__":
    unittest.main()
