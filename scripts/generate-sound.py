#!/usr/bin/env python3
"""Generate a short synthesized WAV for the OpenCode prompt-sound plugin.

Pure standard library. Produces a mono 48 kHz 16-bit PCM file under
config/plugins/prompt-sound/fallback.wav.
"""

from __future__ import annotations

import math
import os
import random
import struct
import wave
from pathlib import Path
from typing import List

SAMPLE_RATE = 48_000
DURATION = 0.45
PEAK_TARGET = 0.89 * 32_767

FADE_IN = 0.003
FADE_OUT = 0.040

LEAD_END = 0.030
TRANSIENT_START = 0.030
TAIL_START = 0.050

SCRIPT_DIR = Path(__file__).resolve().parent
OUT_PATH = SCRIPT_DIR.parent / "config" / "plugins" / "prompt-sound" / "fallback.wav"


def moving_average_lowpass(samples: List[float], window_size: int) -> List[float]:
    """Simple averaging low-pass filter (no FFT)."""
    if window_size < 2:
        return samples[:]
    half = window_size // 2
    n = len(samples)
    out: List[float] = [0.0] * n
    window: List[float] = []
    total = 0.0
    for i in range(n + half):
        if i < n:
            window.append(samples[i])
            total += samples[i]
        if len(window) > window_size:
            total -= window.pop(0)
        center = i - half
        if 0 <= center < n:
            out[center] = total / len(window)
    return out


def moving_average_highpass(samples: List[float], window_size: int) -> List[float]:
    """Subtract a moving average to remove low frequencies / DC."""
    smoothed = moving_average_lowpass(samples, window_size)
    return [s - avg for s, avg in zip(samples, smoothed)]


def bandpass_tail(
    noise: List[float],
    start_freq: float,
    end_freq: float,
    q: float = 4.0,
) -> List[float]:
    """Chamberlin-style state-variable bandpass with a falling centre frequency.

    The centre frequency sweeps exponentially from ``start_freq`` to ``end_freq``
    over the length of ``noise``.
    """
    n = len(noise)
    if n == 0:
        return []
    out: List[float] = [0.0] * n
    low = 0.0
    band = 0.0
    damping = 1.0 / q
    ratio = end_freq / start_freq
    for i, sample in enumerate(noise):
        t = i / max(1, n - 1)
        freq = start_freq * (ratio ** t)
        # Normalised coefficient for the SVF (good approximation up to ~fs/6).
        f = 2.0 * math.sin(math.pi * freq / SAMPLE_RATE)
        high = sample - low - damping * band
        band += f * high
        low += f * band
        out[i] = band
    return out


def envelope_decay(length: int, tau_seconds: float) -> List[float]:
    """Exponential decay envelope: exp(-t / tau)."""
    return [math.exp(-i / (tau_seconds * SAMPLE_RATE)) for i in range(length)]


def generate_lead(total_samples: int) -> List[float]:
    """Quiet, band-limited rising noise before the main transient."""
    end = int(LEAD_END * SAMPLE_RATE)
    raw = [random.gauss(0.0, 1.0) for _ in range(end)]
    filtered = moving_average_lowpass(raw, window_size=150)
    out: List[float] = [0.0] * total_samples
    for i, sample in enumerate(filtered):
        t = i / end if end else 0.0
        amp = 0.06 * (t ** 2)  # rising from 0 to ~0.06
        out[i] = sample * amp
    return out


def generate_transient(total_samples: int) -> List[float]:
    """Initial hit plus two short reflections."""
    start = int(TRANSIENT_START * SAMPLE_RATE)
    segment_len = int(0.080 * SAMPLE_RATE)
    segment: List[float] = [0.0] * segment_len

    def add_burst(offset_seconds: float, duration_seconds: float, amplitude: float, tau: float) -> None:
        offset = int(offset_seconds * SAMPLE_RATE)
        length = int(duration_seconds * SAMPLE_RATE)
        for i in range(length):
            idx = offset + i
            if idx >= segment_len:
                break
            env = math.exp(-i / (tau * SAMPLE_RATE))
            segment[idx] += amplitude * env * random.gauss(0.0, 1.0)

    # Main hit: a 7 ms burst that decays over ~12 ms.
    add_burst(0.0, 0.007, 1.0, 0.012)
    # Reflections at ~18 ms and ~37 ms after the hit.
    add_burst(0.018, 0.003, 0.35, 0.008)
    add_burst(0.037, 0.003, 0.18, 0.008)

    # High-pass via moving-average subtraction to keep the snap crisp.
    segment = moving_average_highpass(segment, window_size=25)

    out: List[float] = [0.0] * total_samples
    for i, sample in enumerate(segment):
        idx = start + i
        if idx < total_samples:
            out[idx] = sample
    return out


def generate_tail(total_samples: int) -> List[float]:
    """Descending filtered-noise tail plus a faint low-frequency body."""
    start = int(TAIL_START * SAMPLE_RATE)
    length = total_samples - start
    if length <= 0:
        return [0.0] * total_samples

    raw = [random.gauss(0.0, 1.0) for _ in range(length)]
    filtered = bandpass_tail(raw, start_freq=4_000.0, end_freq=400.0, q=4.0)
    env = envelope_decay(length, tau_seconds=0.12)

    out: List[float] = [0.0] * total_samples
    for i in range(length):
        # Noise tail amplitude is kept well below the main transient.
        out[start + i] = filtered[i] * env[i] * 0.35

    # Faint low-frequency body, fast decay.
    sine_start = int(0.055 * SAMPLE_RATE)
    sine_length = total_samples - sine_start
    sine_env = envelope_decay(sine_length, tau_seconds=0.06)
    for i in range(sine_length):
        t = (sine_start + i) / SAMPLE_RATE
        out[sine_start + i] += 0.25 * sine_env[i] * math.sin(2.0 * math.pi * 200.0 * t)

    return out


def apply_fades(samples: List[float]) -> List[float]:
    """Linear fade-in and fade-out at the clip boundaries."""
    n = len(samples)
    fade_in = int(FADE_IN * SAMPLE_RATE)
    fade_out = int(FADE_OUT * SAMPLE_RATE)
    out = samples[:]
    for i in range(min(fade_in, n)):
        out[i] *= i / max(1, fade_in)
    for i in range(min(fade_out, n)):
        out[n - 1 - i] *= i / max(1, fade_out)
    return out


def normalize(samples: List[float]) -> List[int]:
    """Scale to the target peak and convert to 16-bit PCM."""
    peak = max((abs(s) for s in samples), default=0.0)
    if peak == 0.0:
        return [0] * len(samples)
    scale = PEAK_TARGET / peak
    pcm: List[int] = []
    for s in samples:
        value = int(round(s * scale))
        if value > 32_767:
            value = 32_767
        elif value < -32_768:
            value = -32_768
        pcm.append(value)
    return pcm


def write_wav(path: Path, pcm: List[int]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        wav.setnframes(len(pcm))
        wav.writeframes(b"".join(struct.pack("<h", s) for s in pcm))


def main() -> None:
    random.seed(42)
    total_samples = int(DURATION * SAMPLE_RATE)

    samples = [0.0] * total_samples
    lead = generate_lead(total_samples)
    transient = generate_transient(total_samples)
    tail = generate_tail(total_samples)

    for i in range(total_samples):
        samples[i] = lead[i] + transient[i] + tail[i]

    samples = apply_fades(samples)
    pcm = normalize(samples)

    write_wav(OUT_PATH, pcm)

    # Self-check: read back the file we just wrote.
    with wave.open(str(OUT_PATH), "rb") as wav:
        channels = wav.getnchannels()
        rate = wav.getframerate()
        width = wav.getsampwidth()
        frames = wav.getnframes()
    peak = max(abs(s) for s in pcm)
    print(f"Wrote {OUT_PATH}")
    print(f"  duration: {frames / rate:.3f} s")
    print(f"  channels: {channels}, sample rate: {rate} Hz, sample width: {width} bytes")
    print(f"  frames: {frames}, peak level: {peak} ({peak / 32_767:.3f} of full scale)")


if __name__ == "__main__":
    main()
