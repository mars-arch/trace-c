import unittest

from scripts.log_tensorboard import log_baseline_tensorboard


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


if __name__ == "__main__":
    unittest.main()
