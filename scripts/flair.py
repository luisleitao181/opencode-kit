#!/usr/bin/env python3
"""Set up and inspect the optional flair assets.

Flair is one plugin that can play a prompt cue, show an animated sticker, or
both. Assets live outside the repository in a single directory (default
~/.config/opencode/flair, overridable with FLAIR_DIR):

    sound.mp3   recorded whip-crack cue
    fallback.wav  synthetic fallback cue
    frames/f*.png  sticker frames (>=2 to animate)

Subcommands:
    setup           synthesise fallback.wav; optionally fetch the real MP3
                    and/or convert a sticker
    status          show which assets are present and which mode is active

Examples:
    python3 scripts/flair.py setup
    python3 scripts/flair.py setup --sound-real
    python3 scripts/flair.py setup --sticker ~/Downloads/sticker.apng
    FLAIR_DIR=~/my-flair python3 scripts/flair.py status
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
GENERATE_SOUND = SCRIPT_DIR / "generate-sound.py"
FETCH_MP3 = SCRIPT_DIR / "fetch-mp3.py"
FETCH_STICKER = SCRIPT_DIR / "fetch-sticker.py"

SOUND_FILES = ("sound.mp3", "fallback.wav")
FRAME_GLOB = "f*.png"


def flair_dir() -> Path:
    """Return the configured flair asset directory."""
    if env := os.environ.get("FLAIR_DIR"):
        return Path(env).expanduser().resolve()
    return Path.home() / ".config" / "opencode" / "flair"


def run_python(script: Path, *args: str) -> subprocess.CompletedProcess[str]:
    """Run a helper script with the same interpreter and capture output."""
    command = [sys.executable, str(script), *args]
    return subprocess.run(command, text=True, capture_output=True, check=False)


def frame_count(asset_dir: Path) -> int:
    """Count frame files in the frames subdirectory."""
    frames_dir = asset_dir / "frames"
    if not frames_dir.is_dir():
        return 0
    return len(sorted(frames_dir.glob(FRAME_GLOB)))


def has_audio(asset_dir: Path) -> bool:
    """Return True if either preferred audio file exists."""
    return any((asset_dir / name).is_file() for name in SOUND_FILES)


def mode_description(asset_dir: Path) -> tuple[str, str]:
    """Return a short status label and a human-readable description."""
    frames = frame_count(asset_dir)
    audio = has_audio(asset_dir)
    if frames >= 2:
        label = "sticker"
        cue = " + whip-crack cue" if audio else ", no audio cue"
        desc = f"sticker animation ({frames} frames){cue}"
    elif audio:
        label = "sound"
        desc = "sound cue only"
    else:
        label = "disabled"
        desc = "disabled — needs audio, or at least 2 frames" if frames else "disabled — no usable assets"
    return label, desc


def cmd_setup(args: argparse.Namespace) -> int:
    """Generate the fallback cue and optionally fetch real audio / convert a sticker."""
    asset_dir = flair_dir()

    sticker_path: Path | None = None
    if args.sticker:
        sticker_path = Path(args.sticker).expanduser().resolve()
        if not sticker_path.is_file():
            print(f"error: not a file: {sticker_path}", file=sys.stderr)
            return 1

    asset_dir.mkdir(parents=True, exist_ok=True)
    print(f"flair dir: {asset_dir}")

    fallback_out = asset_dir / "fallback.wav"
    result = run_python(GENERATE_SOUND, "--output", str(fallback_out))
    if result.returncode != 0:
        print(result.stdout, end="")
        print(result.stderr, end="", file=sys.stderr)
        return 1
    print(result.stdout, end="")

    if args.sound_real:
        mp3_out = asset_dir / "sound.mp3"
        print("fetching recorded cue...")
        result = run_python(FETCH_MP3, "--output", str(mp3_out))
        print(result.stdout, end="")
        if result.returncode != 0:
            print(result.stderr, end="", file=sys.stderr)
            print("warning: could not fetch sound.mp3; fallback.wav is still available")
        else:
            print("recorded cue installed")

    if sticker_path:
        frames_dir = asset_dir / "frames"
        print(f"converting sticker: {sticker_path}")
        result = run_python(FETCH_STICKER, "--out", str(frames_dir), str(sticker_path))
        print(result.stdout, end="")
        if result.returncode != 0:
            print(result.stderr, end="", file=sys.stderr)
            return 1

    label, desc = mode_description(asset_dir)
    print(f"status: {label} -> {desc}")
    return 0


def cmd_status(_args: argparse.Namespace) -> int:
    """Print the current asset state and active mode."""
    asset_dir = flair_dir()
    print(f"flair dir: {asset_dir}")

    if not asset_dir.exists():
        print("status: disabled -> directory does not exist")
        print("run: python3 scripts/flair.py setup")
        return 0

    frames = frame_count(asset_dir)
    audio = has_audio(asset_dir)
    label, desc = mode_description(asset_dir)

    print(f"  frames: {frames}")
    for name in SOUND_FILES:
        present = "yes" if (asset_dir / name).is_file() else "no"
        print(f"  {name}: {present}")
    print(f"status: {label} -> {desc}")

    if label == "disabled":
        print("run: python3 scripts/flair.py setup")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = parser.add_subparsers(dest="command", required=True)

    setup_parser = sub.add_parser("setup", help="generate or fetch flair assets")
    setup_parser.add_argument(
        "--sound-real",
        action="store_true",
        help="also try to download the recorded sound.mp3 from Wikimedia Commons (network)",
    )
    setup_parser.add_argument(
        "--sticker",
        type=Path,
        help="animated sticker file to convert into frames",
    )
    setup_parser.set_defaults(func=cmd_setup)

    status_parser = sub.add_parser("status", help="show current assets and active mode")
    status_parser.set_defaults(func=cmd_status)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
