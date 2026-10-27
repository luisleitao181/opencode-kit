#!/usr/bin/env python3
"""Download the recorded clip used by the flair plugin.

Source: Wikimedia Commons, File:Whip-sound.ogg (a SoundBible recording by
Mike Koenig, CC BY 3.0). We take Commons' MP3 transcode because OpenCode's audio
engine decodes WAV/FLAC/MP3 but not Vorbis. Attribution is in CREDITS.md.

Usage: ./scripts/fetch-mp3.py            (Windows: python scripts\\fetch-mp3.py)
       ./scripts/fetch-mp3.py --check    validate the local copy, no download
Writes: ~/.config/opencode/flair/sound.mp3 by default, or the path given with
        --output (idempotent, verifies the container).
"""

from __future__ import annotations

import argparse
import os
import sys
import urllib.request
from pathlib import Path

SOURCE = (
    "https://upload.wikimedia.org/wikipedia/commons/transcoded/c/c2/"
    "Whip-sound.ogg/Whip-sound.ogg.mp3"
)
DEFAULT_OUT = Path.home() / ".config" / "opencode" / "flair" / "sound.mp3"
USER_AGENT = "opencode-kit/1.0 (local plugin asset)"

BITRATE_KBPS = (0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0)
SAMPLE_RATES = (44100, 48000, 32000, 0)


def frames(data: bytes) -> tuple[int, int, int, int]:
    """Return (offset, sample_rate, bitrate, frame_length) of the first MP3 frame."""
    for i in range(len(data) - 4):
        if data[i] == 0xFF and (data[i + 1] & 0xE0) == 0xE0:
            h1, h2 = data[i + 1], data[i + 2]
            version = (h1 >> 3) & 0b11
            layer = (h1 >> 1) & 0b11
            if version == 1 or layer != 1:  # reserved version, or not Layer III
                continue
            rate = SAMPLE_RATES[(h2 >> 2) & 0b11]
            bitrate = BITRATE_KBPS[(h2 >> 4) & 0xF] * 1000
            if rate == 0 or bitrate == 0:
                continue
            if version == 0:  # MPEG 2.5
                rate //= 4
            elif version == 2:  # MPEG 2
                rate //= 2
            length = 144 * bitrate // rate + ((h2 >> 1) & 1)
            return i, rate, bitrate, length
    raise ValueError("no MP3 frame found")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUT, help="output MP3 path")
    parser.add_argument("--check", action="store_true", help="validate the local copy, no download")
    args = parser.parse_args()

    out_path = args.output.expanduser().resolve()

    if args.check:
        data = out_path.read_bytes()
    else:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        request = urllib.request.Request(SOURCE, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=30) as response:
            data = response.read()

    offset, rate, bitrate, length = frames(data)
    count = round((len(data) - offset) / length)
    duration = count * 1152 / rate

    if not 0.4 <= duration <= 3.0:
        print("unexpected duration", file=sys.stderr)
        return 1

    if not args.check:
        tmp_path = out_path.with_name(out_path.name + ".tmp")
        tmp_path.write_bytes(data)
        os.replace(tmp_path, out_path)

    print(f"file {out_path} ({len(data)} bytes)")
    print(
        f"mpeg offset={offset} rate={rate} Hz bitrate={bitrate // 1000} kbps "
        f"frames={count} duration={duration:.3f} s"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
