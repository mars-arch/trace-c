"""Pure scoring helpers shared by the baseline trainer and its tests."""

from __future__ import annotations

import numpy as np


def temporal_sequence_starts(
    n_observations: int,
    sequence_length: int,
    stride: int,
    validation_fraction: float,
) -> tuple[np.ndarray, np.ndarray]:
    """Return non-overlapping temporal train/validation sequence starts."""
    validation_start = int(n_observations * (1.0 - validation_fraction))
    train = np.arange(0, validation_start - sequence_length + 1, stride)
    validation = np.arange(
        validation_start, n_observations - sequence_length + 1, stride
    )
    if len(train) == 0 or len(validation) == 0:
        raise ValueError("not enough observations for non-overlapping train/validation sequences")
    return train, validation


def spectral_residual_saliency(x: np.ndarray, smoothing: int = 3) -> np.ndarray:
    """Return spectral-residual saliency for one finite 1-D context."""
    amp = np.abs(np.fft.fft(x))
    log_amp = np.log(np.maximum(amp, 1e-9))
    kernel = np.ones(smoothing) / smoothing
    avg = np.convolve(log_amp, kernel, mode="same")
    spectral = np.exp(log_amp - avg) * np.fft.fft(x) / np.maximum(amp, 1e-9)
    return np.abs(np.fft.ifft(spectral))


def spectral_residual_window_scores(
    values: np.ndarray, window_size: int, context: int = 1440
) -> list[float]:
    """Score each window from a context ending exactly at that window.

    Recomputing at each window boundary is intentional. A chunked FFT that
    assigns saliency to every point in the chunk lets early windows observe
    later values from that same chunk.
    """
    if values.ndim != 2:
        raise ValueError("values must have shape (time, streams)")
    if window_size < 1 or context < window_size:
        raise ValueError("require context >= window_size >= 1")

    n, streams = values.shape
    scores: list[float] = []
    for w in range(n // window_size):
        end = (w + 1) * window_size
        start = max(0, end - context)
        score = 0.0
        for stream in range(streams):
            saliency = spectral_residual_saliency(values[start:end, stream])
            score = max(score, float(np.max(saliency[-window_size:])))
        scores.append(score)
    return scores
