#!/usr/bin/env python3
"""Render the GhostAck demo from frames captured from the running product."""

from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFont


ROOT = Path(__file__).resolve().parent
ASSETS = ROOT / "assets"
CAPTURE = ROOT / "capture"
FFMPEG = os.environ.get("FFMPEG_BIN", "ffmpeg")
SIZE = (1920, 1080)
ACID = "#bcff38"


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    name = "Arial Bold.ttf" if bold else "Arial.ttf"
    return ImageFont.truetype(f"/System/Library/Fonts/Supplemental/{name}", size)


def cover() -> Path:
    base = Image.open(ASSETS / "ghostack-00-ready.jpg").convert("RGB").resize(SIZE)
    base = ImageEnhance.Brightness(base).enhance(0.28)
    draw = ImageDraw.Draw(base, "RGBA")
    draw.rectangle((0, 0, 1920, 1080), fill=(4, 8, 6, 105))
    draw.rectangle((96, 92, 160, 130), fill=ACID)
    draw.text((108, 99), "G//A", font=font(15, True), fill="#080b0a")
    draw.text((178, 99), "GHOSTACK", font=font(19, True), fill="#edf3ee")
    draw.text((96, 295), "KILL THE BROWSER.", font=font(69, True), fill="#edf3ee")
    draw.text((96, 380), "PROVE IT HAPPENED ONCE.", font=font(69, True), fill="#8c9890")
    draw.text((101, 500), "CHAOS TESTING FOR BROWSER AGENTS", font=font(21), fill=ACID)
    draw.text((101, 550), "Real Solari failure injection · one effect · zero duplicates", font=font(24), fill="#b4beb7")
    draw.line((101, 675, 1320, 675), fill=(188, 255, 56, 130), width=2)
    draw.text((101, 710), "RITWIJ ARYAN PARMAR", font=font(18, True), fill="#edf3ee")
    draw.text((101, 744), "OpenTelemetry · PostgreSQL · Ed25519 signed evidence", font=font(17), fill="#849088")
    output = ROOT / "ghostack-cover.jpg"
    base.save(output, quality=95)
    return output


def run(*args: str) -> None:
    subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def still(source: Path, destination: Path, seconds: int, label: str) -> None:
    vf = (
        "scale=1920:1080,"
        "zoompan=z='min(zoom+0.00012,1.025)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
        f"d={seconds * 30}:s=1920x1080:fps=30,"
        f"drawtext=fontfile=/System/Library/Fonts/Supplemental/Arial.ttf:text='{label}':"
        "x=80:y=h-75:fontsize=18:fontcolor=white@0.75:box=1:boxcolor=black@0.55:boxborderw=14"
    )
    run("-loop", "1", "-i", str(source), "-t", str(seconds), "-vf", vf, "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(destination))


def live_sequence(destination: Path) -> None:
    # 27 screenshots were captured while the reviewer-triggered run was executing.
    # Slowing them down preserves every observed state without inventing animation.
    run(
        "-framerate", "8", "-i", str(CAPTURE / "frame-%03d.jpg"),
        "-vf", "scale=1920:1080,setpts=3.2*PTS,fps=30",
        "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(destination),
    )


def main() -> None:
    cover_path = cover()
    with tempfile.TemporaryDirectory(prefix="ghostack-video-") as temporary:
        tmp = Path(temporary)
        scenes = [tmp / f"scene-{index}.mp4" for index in range(5)]
        still(cover_path, scenes[0], 7, "GhostAck / browser-agent chaos testing")
        still(ASSETS / "ghostack-00-ready.jpg", scenes[1], 9, "Reviewer-triggered control lab")
        live_sequence(scenes[2])
        still(ASSETS / "ghostack-02-crash.jpg", scenes[3], 15, "OUTCOME_UNKNOWN / retry is unsafe")
        still(ASSETS / "ghostack-03-proof.jpg", scenes[4], 21, "COMMITTED / one effect / zero duplicates / proof signed")
        concat = tmp / "concat.txt"
        concat.write_text("".join(f"file '{scene}'\n" for scene in scenes), encoding="utf-8")
        silent = tmp / "silent.mp4"
        run("-f", "concat", "-safe", "0", "-i", str(concat), "-c", "copy", str(silent))
        run(
            "-i", str(silent), "-i", str(ROOT / "narration.aiff"),
            "-filter_complex", "[1:a]highpass=f=80,lowpass=f=11000,acompressor=threshold=-18dB:ratio=2.5:attack=15:release=180,loudnorm=I=-16:TP=-1.5:LRA=7[a]",
            "-map", "0:v:0", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart",
            str(ROOT / "ghostack-demo.mp4"),
        )
    print(ROOT / "ghostack-demo.mp4")


if __name__ == "__main__":
    main()
