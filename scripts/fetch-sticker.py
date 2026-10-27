#!/usr/bin/env python3
"""Turn an animated sticker (APNG/GIF) into flair frame files.

The artwork is third-party and stays out of the repository: this script writes
frames into the flair lookup directory (by default
~/.config/opencode/flair/frames), never into the kit itself.

The default mode converts a file you already have. Any animation ffmpeg can read
works: APNG (a .png with several frames), animated WebP (Telegram/WhatsApp
stickers), GIF, or a short MP4/WebM. A still image does not qualify - the flair
needs at least two frames. Frames are cropped to the visible area, flattened onto
an opaque colour (xterm.js paints transparent pixels as a checkerboard), resampled
to the plugin's 12 fps and scaled to a TUI-friendly width.

Usage:
    ./scripts/fetch-sticker.py ~/Downloads/cat.gif
    ./scripts/fetch-sticker.py --out ~/somewhere ~/Downloads/cat.webp

    # Opt-in download. SigStick's terms forbid automated interaction with their
    # service and collecting their catalogue, so this is off by default and only
    # fetches one pack when you ask for it.
    ./scripts/fetch-sticker.py --pack <pack-id-or-url>

Nothing is written into the kit itself; frames go to
~/.config/opencode/flair/frames unless --out says otherwise.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

API = "https://api.sigstick.com/v1/stickerPack/{pack}"
WIDTH = 160
FPS = 12
MAX_FRAMES = 64


def default_out() -> Path:
    """Return the default frame directory, honouring FLAIR_DIR."""
    if env := os.environ.get("FLAIR_DIR"):
        return Path(env).expanduser() / "frames"
    return Path.home() / ".config" / "opencode" / "flair" / "frames"

# Flattening colour. The cat-whip art is drawn on green, so matching it keeps the
# sticker's own background instead of drawing a frame around it.
BACKGROUND = "0x02FD09"
# SigStick's CDN refuses requests without a browser-like agent.
AGENT = "Mozilla/5.0 (X11; Linux x86_64) opencode-kit-fetch-sticker"


def open_url(url: str):
    request = urllib.request.Request(url, headers={"User-Agent": AGENT, "Accept": "*/*"})
    return urllib.request.urlopen(request, timeout=60)


def pack_id(value: str) -> str:
    """Accept a bare pack id or a full SigStick pack URL."""
    if "/" not in value:
        return value
    tail = value.rstrip("/").split("/pack/")[-1]
    return tail.split("-")[0]


def sticker_url(pack: str) -> str:
    with open_url(API.format(pack=pack)) as response:
        payload = json.load(response)
    stickers = payload["data"]["stickers"]
    if not stickers:
        raise SystemExit(f"pack {pack} has no stickers")
    return stickers[0]["url"]


def run(command: list[str]) -> subprocess.CompletedProcess:
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        raise SystemExit(f"command failed: {' '.join(command)}\n{result.stderr.strip()}")
    return result


def run_bytes(command: list[str]) -> bytes:
    result = subprocess.run(command, capture_output=True)
    if result.returncode != 0:
        raise SystemExit(f"command failed: {' '.join(command)}\n{result.stderr.decode(errors='replace').strip()}")
    return result.stdout


def probe_size(frame: Path) -> tuple[int, int]:
    result = run([
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height", "-of", "csv=p=0", str(frame),
    ])
    width, height = result.stdout.strip().split(",")[:2]
    return int(width), int(height)


def alpha_bbox(frames: list[Path], threshold: int = 8) -> tuple[int, int, int, int] | None:
    """Union bounding box of the visible pixels, from the alpha channel.

    The sticker is an APNG: the transparent margin has to be trimmed, otherwise
    the artwork carries a band on every side once it is drawn in the TUI.
    """
    width, height = probe_size(frames[0])
    left, top, right, bottom = width, height, -1, -1
    for frame in frames:
        raw = run_bytes(["ffmpeg", "-v", "error", "-i", str(frame), "-f", "rawvideo", "-pix_fmt", "rgba", "-"])
        for y in range(height):
            row = y * width * 4
            alpha = raw[row:row + width * 4:4]
            if not alpha or max(alpha) <= threshold:
                continue
            xs = [x for x, value in enumerate(alpha) if value > threshold]
            left, right = min(left, xs[0]), max(right, xs[-1])
            top, bottom = min(top, y), max(bottom, y)
    if right < 0:
        return None
    return (right - left + 1, bottom - top + 1, left, top)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("source", nargs="?", help="animated sticker file to convert (PNG/GIF/WebP)")
    parser.add_argument("--pack", default=None, help="download a SigStick pack id/URL instead of reading a file")
    parser.add_argument("--out", default=None, help="frame directory (default: ~/.config/opencode/flair/frames)")
    parser.add_argument("--width", type=int, default=WIDTH, help=f"frame width in pixels (default {WIDTH})")
    parser.add_argument("--background", default=BACKGROUND, help=f"flatten colour (default {BACKGROUND})")
    args = parser.parse_args()

    for tool in ("ffmpeg", "ffprobe"):
        if shutil.which(tool) is None:
            raise SystemExit(f"{tool} is required")

    if not args.source and not args.pack:
        parser.error("give a sticker file, or --pack <id|url> to download one")
    out = Path(args.out).expanduser() if args.out else default_out()

    with tempfile.TemporaryDirectory(prefix="sticker-") as tmp:
        tmp_path = Path(tmp)
        source = tmp_path / "sticker.png"

        if args.pack:
            pack = pack_id(args.pack)
            url = sticker_url(pack)
            print(f"manifest: {pack}\ndownload: {url}")
            with open_url(url) as response:
                source.write_bytes(response.read())
        else:
            local = Path(args.source).expanduser()
            if not local.is_file():
                raise SystemExit(f"not a file: {local}")
            print(f"input: {local}")
            source.write_bytes(local.read_bytes())

        raw_dir = tmp_path / "raw"
        raw_dir.mkdir()
        # Resample to the plugin's frame rate: it plays at 12 fps, so a 30 fps
        # video would otherwise carry frames that are never shown.
        run(["ffmpeg", "-v", "error", "-y", "-i", str(source), "-r", str(FPS), str(raw_dir / "f%03d.png")])
        raw = sorted(raw_dir.glob("f*.png"))
        if not raw:
            raise SystemExit("no frames decoded; is this a readable animation?")
        if len(raw) < 2:
            raise SystemExit(
                "the input has a single frame; the flair needs an animation "
                "(APNG, animated WebP, GIF or a short video)"
            )
        if len(raw) > MAX_FRAMES:
            print(f"note: {len(raw)} frames decoded, keeping the first {MAX_FRAMES}")
            raw = raw[:MAX_FRAMES]

        box = alpha_bbox(raw)
        src_w, src_h = probe_size(raw[0])
        if box:
            cw, ch, cx, cy = box
        else:
            cw, ch, cx, cy = src_w, src_h, 0, 0
        crop = f"crop={cw}:{ch}:{cx}:{cy}"
        height = max(1, round(ch * args.width / cw / 2) * 2)  # even height keeps yuv happy

        staging = tmp_path / "frames"
        staging.mkdir()

        for frame in raw:
            stages = [crop, f"scale={args.width}:{height}", "format=rgba"]
            chain = ",".join(part for part in stages if part)
            run([
                "ffmpeg", "-v", "error", "-y",
                "-f", "lavfi", "-i", f"color=c={args.background}:s={args.width}x{height}",
                "-i", str(frame),
                "-filter_complex", f"[1:v]{chain}[fg];[0:v][fg]overlay=format=auto",
                "-frames:v", "1", "-pix_fmt", "rgb24", str(staging / frame.name),
            ])

        # Swap the completed staging directory into place so a failure never
        # leaves the live frames directory partially deleted.
        out.parent.mkdir(parents=True, exist_ok=True)
        shutil.rmtree(out, ignore_errors=True)
        shutil.move(str(staging), str(out))

    frames = sorted(out.glob("f*.png"))
    print(f"crop: {cw}x{ch}+{cx}+{cy}  output: {args.width}x{height}")
    print(f"wrote {len(frames)} frames to {out}\nrestart the TUI to pick them up")
    return 0


if __name__ == "__main__":
    sys.exit(main())
