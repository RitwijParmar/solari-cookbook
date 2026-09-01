#!/usr/bin/env python3
"""Build a natural, pen-annotated demo from fresh frames of the deployed product."""

from __future__ import annotations

import asyncio
import math
import re
import subprocess
from pathlib import Path

import edge_tts
import imageio.v2 as imageio
import imageio_ffmpeg
import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFont


ROOT = Path(__file__).resolve().parent
CAPTURE = ROOT / "capture-v2"
NARRATION = (ROOT / "narration-v2.txt").read_text(encoding="utf-8").strip()
VOICE = "en-IN-PrabhatNeural"
FPS = 30
SOURCE_SIZE = (1600, 900)
OUTPUT_SIZE = (1920, 1080)
INK = "#bcff38"
WARNING = "#ff655b"


def font(size: int, handwritten: bool = False) -> ImageFont.FreeTypeFont:
    path = (
        "/System/Library/Fonts/Supplemental/Chalkboard.ttc"
        if handwritten
        else "/System/Library/Fonts/Supplemental/Arial.ttf"
    )
    return ImageFont.truetype(path, size)


def frame(group: str, index: int) -> Image.Image:
    image = Image.open(CAPTURE / group / f"frame-{index:03d}.jpg").convert("RGB")
    if image.size != SOURCE_SIZE:
        image = image.resize(SOURCE_SIZE, Image.Resampling.LANCZOS)
    return image.resize(OUTPUT_SIZE, Image.Resampling.LANCZOS)


def zoom(image: Image.Image, amount: float) -> Image.Image:
    width, height = image.size
    crop_width = round(width / amount)
    crop_height = round(height / amount)
    left = (width - crop_width) // 2
    top = (height - crop_height) // 2
    return image.crop((left, top, left + crop_width, top + crop_height)).resize(
        image.size, Image.Resampling.LANCZOS
    )


def point(x: int, y: int) -> tuple[int, int]:
    return round(x * OUTPUT_SIZE[0] / SOURCE_SIZE[0]), round(y * OUTPUT_SIZE[1] / SOURCE_SIZE[1])


def partial_path(points: list[tuple[int, int]], progress: float) -> list[tuple[int, int]]:
    if progress <= 0 or len(points) < 2:
        return []
    lengths = [math.dist(a, b) for a, b in zip(points, points[1:])]
    total = sum(lengths)
    target = total * min(progress, 1)
    result = [points[0]]
    travelled = 0.0
    for start, end, length in zip(points, points[1:], lengths):
        if travelled + length <= target:
            result.append(end)
            travelled += length
            continue
        ratio = 0 if length == 0 else (target - travelled) / length
        result.append((round(start[0] + (end[0] - start[0]) * ratio), round(start[1] + (end[1] - start[1]) * ratio)))
        break
    return result


def circle_points(box: tuple[int, int, int, int], samples: int = 90) -> list[tuple[int, int]]:
    left, top, right, bottom = box
    center_x = (left + right) / 2
    center_y = (top + bottom) / 2
    radius_x = (right - left) / 2
    radius_y = (bottom - top) / 2
    return [
        (
            round(center_x + radius_x * math.cos(2 * math.pi * index / samples)),
            round(center_y + radius_y * math.sin(2 * math.pi * index / samples)),
        )
        for index in range(samples + 1)
    ]


def pen_stroke(draw: ImageDraw.ImageDraw, points: list[tuple[int, int]], progress: float, color: str, width: int = 8) -> None:
    visible = partial_path(points, progress)
    if len(visible) < 2:
        return
    draw.line(visible, fill=color, width=width, joint="curve")
    draw.ellipse((visible[-1][0] - 5, visible[-1][1] - 5, visible[-1][0] + 5, visible[-1][1] + 5), fill=color)


def note(draw: ImageDraw.ImageDraw, position: tuple[int, int], text: str, color: str) -> None:
    x, y = position
    text_font = font(33, handwritten=True)
    bounds = draw.textbbox((x, y), text, font=text_font)
    draw.rounded_rectangle((bounds[0] - 18, bounds[1] - 12, bounds[2] + 18, bounds[3] + 12), radius=12, fill=(3, 8, 5, 224))
    draw.text((x, y), text, font=text_font, fill=color, stroke_width=1, stroke_fill=color)


def crash_annotation(image: Image.Image, progress: float) -> Image.Image:
    output = image.copy()
    draw = ImageDraw.Draw(output, "RGBA")
    box = (*point(706, 52), *point(889, 229))
    pen_stroke(draw, circle_points(box), min(progress / 0.48, 1), WARNING, 9)
    underline = [point(752, 214), point(790, 218), point(845, 214)]
    pen_stroke(draw, underline, max(0, (progress - 0.35) / 0.3), WARNING, 8)
    arrow = [point(1048, 214), point(982, 202), point(918, 170), point(887, 145)]
    pen_stroke(draw, arrow, max(0, (progress - 0.5) / 0.3), WARNING, 8)
    if progress > 0.68:
        note(draw, point(1015, 225), "unknown is not zero", WARNING)
    return output


def proof_annotation(image: Image.Image, progress: float) -> Image.Image:
    output = image.copy()
    draw = ImageDraw.Draw(output, "RGBA")
    effect_box = (*point(716, 53), *point(887, 225))
    pen_stroke(draw, circle_points(effect_box), min(progress / 0.35, 1), INK, 9)
    metrics = [point(1280, 143), point(1340, 150), point(1410, 147), point(1480, 151)]
    pen_stroke(draw, metrics, max(0, (progress - 0.28) / 0.32), INK, 8)
    proof_arrow = [point(1515, 355), point(1490, 370), point(1470, 387)]
    pen_stroke(draw, proof_arrow, max(0, (progress - 0.55) / 0.25), INK, 8)
    if progress > 0.66:
        note(draw, point(1225, 465), "1 effect  /  0 duplicates", INK)
    return output


def collision_annotation(image: Image.Image, progress: float) -> Image.Image:
    output = image.copy()
    draw = ImageDraw.Draw(output, "RGBA")
    scenario_box = (*point(73, 210), *point(307, 285))
    pen_stroke(draw, circle_points(scenario_box), min(progress / 0.38, 1), INK, 8)
    arrow = [point(1060, 330), point(1005, 325), point(950, 342)]
    pen_stroke(draw, arrow, max(0, (progress - 0.35) / 0.3), INK, 8)
    if progress > 0.58:
        note(draw, point(1040, 365), "20 callers  →  1 request", INK)
    return output


async def synthesize(path: Path) -> None:
    speech = edge_tts.Communicate(NARRATION, VOICE, rate="+18%", pitch="-6Hz", volume="-2%")
    await speech.save(str(path))


def media_duration(path: Path) -> float:
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    result = subprocess.run([ffmpeg, "-i", str(path)], capture_output=True, text=True, check=False)
    match = re.search(r"Duration: (\d+):(\d+):(\d+(?:\.\d+)?)", result.stderr)
    if match is None:
        raise RuntimeError(f"Unable to read duration for {path}")
    hours, minutes, seconds = match.groups()
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


SCENES = [
    ("intro", 7.0),
    ("setup", 7.0),
    ("live", 18.0),
    ("crash", 9.0),
    ("recovery", 10.0),
    ("proof", 11.0),
    ("collision", 9.0),
    ("outro", 7.0),
]


def scene_image(name: str, progress: float) -> Image.Image:
    if name == "intro":
        return zoom(frame("live", min(11, round(progress * 11))), 1 + 0.025 * progress)
    if name == "setup":
        return frame("live", 12 + min(11, round(progress * 11)))
    if name == "live":
        return frame("live", 24 + min(35, round(progress * 35)))
    if name == "crash":
        return crash_annotation(zoom(frame("live", 60), 1 + 0.025 * progress), progress)
    if name == "recovery":
        return frame("live", 61 + min(34, round(progress * 34)))
    if name == "proof":
        return proof_annotation(zoom(frame("live", 119), 1 + 0.02 * progress), progress)
    if name == "collision":
        return frame("concurrency", min(43, round(progress * 43)))
    return collision_annotation(zoom(frame("concurrency", 43), 1 + 0.018 * progress), progress)


def build() -> None:
    audio = ROOT / "ghostack-voiceover-v2.mp3"
    silent = ROOT / "ghostack-demo-v2-silent.mp4"
    final = ROOT / "ghostack-demo-v2.mp4"
    poster = ROOT / "ghostack-demo-v2-cover.jpg"
    asyncio.run(synthesize(audio))
    audio_duration = media_duration(audio)
    scale = (audio_duration + 1.2) / sum(duration for _, duration in SCENES)
    durations = [(name, duration * scale) for name, duration in SCENES]

    writer = imageio.get_writer(
        silent,
        fps=FPS,
        codec="libx264",
        quality=8,
        macro_block_size=None,
        ffmpeg_params=["-pix_fmt", "yuv420p", "-movflags", "+faststart"],
    )
    try:
        for name, duration in durations:
            total = max(1, round(duration * FPS))
            for index in range(total):
                progress = index / max(1, total - 1)
                rendered = scene_image(name, progress)
                if name == "intro":
                    rendered = ImageEnhance.Contrast(rendered).enhance(1.03)
                writer.append_data(np.asarray(rendered))
    finally:
        writer.close()

    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    subprocess.run(
        [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(silent),
            "-i",
            str(audio),
            "-filter_complex",
            "[1:a]highpass=f=75,lowpass=f=11500,acompressor=threshold=-19dB:ratio=2:attack=20:release=180,loudnorm=I=-16:TP=-1.5:LRA=8[a]",
            "-map",
            "0:v:0",
            "-map",
            "[a]",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-shortest",
            "-movflags",
            "+faststart",
            str(final),
        ],
        check=True,
    )
    silent.unlink(missing_ok=True)
    scene_image("proof", 1).save(poster, quality=94)
    print(f"video={final}")
    print(f"duration={media_duration(final):.2f}s voice={VOICE}")


if __name__ == "__main__":
    build()
