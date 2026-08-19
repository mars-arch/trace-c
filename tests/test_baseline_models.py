import unittest

import numpy as np

from scripts.baseline_models import spectral_residual_window_scores, temporal_sequence_starts


class SpectralResidualCausalityTest(unittest.TestCase):
    def test_future_perturbation_cannot_change_earlier_window_scores(self):
        t = np.arange(32, dtype=np.float64)
        values = np.stack([np.sin(t / 3), np.cos(t / 5)], axis=1)

        original = spectral_residual_window_scores(values, window_size=4, context=16)
        changed = values.copy()
        changed[16:] += np.array([1000.0, -750.0])
        perturbed = spectral_residual_window_scores(changed, window_size=4, context=16)

        np.testing.assert_allclose(original[:4], perturbed[:4], rtol=0, atol=0)


class TemporalSequenceSplitTest(unittest.TestCase):
    def test_training_and_validation_sequences_share_no_observations(self):
        train_starts, validation_starts = temporal_sequence_starts(
            n_observations=200, sequence_length=20, stride=4, validation_fraction=0.1
        )

        self.assertLessEqual(train_starts[-1] + 20, validation_starts[0])
        self.assertEqual(validation_starts[0], 180)


if __name__ == "__main__":
    unittest.main()
