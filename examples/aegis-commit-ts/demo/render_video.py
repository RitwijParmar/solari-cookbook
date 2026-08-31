from __future__ import annotations

import json
import math
import os
import re
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parent
ASSETS = ROOT / "assets"
EVIDENCE = ROOT.parent / "evidence" / "latest" / "evidence.json"
PORTRAIT = Path(
    os.environ.get(
        "AEGIS_PORTRAIT",
        "/Users/ritwij/Downloads/WhatsApp Image 2026-04-07 at 12.12.08 (1).jpeg",
    )
)
FFMPEG = os.environ["FFMPEG"]
WIDTH, HEIGHT, FPS = 1920, 1080, 30
GREEN = "#63f2ad"
INK = "#f0f7f3"
MUTED = "#a4b7ad"
BG = "#07100d"


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    name = "HelveticaNeue.ttc" if not bold else "HelveticaNeue.ttc"
    return ImageFont.truetype(f"/System/Library/Fonts/{name}", size=size, index=1 if bold else 0)


def duration(path: Path) -> float:
    result = subprocess.run(
        [FFMPEG, "-i", str(path)], capture_output=True, text=True, check=False
    )
    match = re.search(r"Duration: (\d+):(\d+):(\d+(?:\.\d+)?)", result.stderr)
    if not match:
        raise RuntimeError("Could not read narration duration")
    hours, minutes, seconds = match.groups()
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def cover_crop(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    target_w, target_h = size
    scale = max(target_w / image.width, target_h / image.height)
    resized = image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)
    left = (resized.width - target_w) // 2
    top = (resized.height - target_h) // 2
    return resized.crop((left, top, left + target_w, top + target_h))


def add_chrome(frame: Image.Image, url: str) -> Image.Image:
    canvas = Image.new("RGB", (WIDTH, HEIGHT), BG)
    viewport = cover_crop(frame, (WIDTH, HEIGHT - 72))
    canvas.paste(viewport, (0, 72))
    draw = ImageDraw.Draw(canvas)
    draw.rectangle((0, 0, WIDTH, 72), fill="#0b1210")
    for x, color in ((30, "#ff5f57"), (58, "#febc2e"), (86, "#28c840")):
        draw.ellipse((x, 27, x + 16, 43), fill=color)
    draw.rounded_rectangle((132, 17, 1740, 55), radius=18, fill="#17231e")
    draw.text((160, 24), url, font=font(20), fill=MUTED)
    draw.text((1785, 20), "LIVE", font=font(19, True), fill=GREEN)
    return canvas


def make_cover(outro: bool = False) -> Image.Image:
    canvas = Image.new("RGB", (WIDTH, HEIGHT), BG)
    glow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse((950, -380, 2200, 900), fill=(42, 137, 91, 100))
    glow = glow.filter(ImageFilter.GaussianBlur(150))
    canvas = Image.alpha_composite(canvas.convert("RGBA"), glow)

    portrait = cover_crop(Image.open(PORTRAIT).convert("RGB"), (760, 980))
    portrait = ImageEnhance.Contrast(portrait).enhance(1.05)
    mask = Image.new("L", portrait.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, portrait.width, portrait.height), radius=48, fill=255)
    canvas.paste(portrait, (1080, 50), mask)

    draw = ImageDraw.Draw(canvas)
    draw.text((100, 105), "CRASH-CONSISTENT BROWSER OPERATIONS", font=font(26, True), fill=GREEN)
    draw.text((100, 175), "Aegis", font=font(122, True), fill=INK)
    draw.text((100, 285), "Commit", font=font(122, True), fill=INK)
    tagline = "Crash after commit.\nRecover without doing it twice."
    draw.multiline_text((105, 450), tagline, font=font(42), fill=INK, spacing=12)
    draw.text((105, 650), "Ritwij Aryan Parmar", font=font(34, True), fill=GREEN)
    if outro:
        draw.text((105, 725), "github.com/RitwijParmar/solari-cookbook", font=font(25), fill=MUTED)
        draw.text((105, 780), "@harrychow_   @getsolari", font=font(28, True), fill=INK)
    else:
        draw.text((105, 725), "SOLARI BROWSER + SANDBOX  /  GCP CLOUD RUN", font=font(24), fill=MUTED)
    return canvas.convert("RGB")


def terminal_frame(evidence: dict) -> Image.Image:
    image = Image.new("RGB", (WIDTH, HEIGHT), "#050908")
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((85, 85, 1835, 995), radius=24, fill="#0d1512", outline="#294639", width=2)
    draw.rectangle((85, 85, 1835, 155), fill="#15201b")
    for x, color in ((120, "#ff5f57"), (154, "#febc2e"), (188, "#28c840")):
        draw.ellipse((x, 110, x + 18, 128), fill=color)
    lines = [
        ("$ pnpm test", INK),
        ("  tests 9   pass 9   fail 0", GREEN),
        ("", MUTED),
        ("$ pnpm verify:evidence", INK),
        ("  evidence-ok  audit-events=6  browser-sessions=2", GREEN),
        ("  duplicate-effects=0", GREEN),
        ("", MUTED),
        ("$ pnpm audit --audit-level=high", INK),
        ("  No known vulnerabilities found", GREEN),
        ("", MUTED),
        (f"live recovery     {evidence['cases'][0]['durationMs']}ms", MUTED),
        ("target requests   1", MUTED),
        ("target effects    1", GREEN),
    ]
    y = 210
    for text, color in lines:
        draw.text((135, y), text, font=font(31, True), fill=color)
        y += 58
    return image


def caption(frame: Image.Image, label: str, progress: float) -> Image.Image:
    result = frame.copy().convert("RGBA")
    overlay = Image.new("RGBA", result.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    draw.rounded_rectangle((90, 900, 1830, 1035), radius=20, fill=(4, 9, 7, 225), outline=(99, 242, 173, 90), width=2)
    draw.text((130, 932), label, font=font(31, True), fill=INK)
    draw.rectangle((90, 1065, 90 + round(1740 * progress), 1074), fill=GREEN)
    return Image.alpha_composite(result, overlay).convert("RGB")


def zoom(image: Image.Image, amount: float) -> Image.Image:
    amount = max(1.0, amount)
    scaled = image.resize((round(WIDTH * amount), round(HEIGHT * amount)), Image.Resampling.LANCZOS)
    left = (scaled.width - WIDTH) // 2
    top = (scaled.height - HEIGHT) // 2
    return scaled.crop((left, top, left + WIDTH, top + HEIGHT))


def main() -> None:
    evidence = json.loads(EVIDENCE.read_text())
    audio = ROOT / "narration.aiff"
    total = duration(audio)
    boundaries = [0.0, 0.12, 0.31, 0.50, 0.68, 0.84, 1.0]
    sources = [
        make_cover(),
        add_chrome(Image.open(ASSETS / "dashboard-top.png").convert("RGB"), "aegis-commit-demo-980932890834.us-east1.run.app"),
        add_chrome(Image.open(ASSETS / "dashboard-live-case.png").convert("RGB"), "live evidence / recovery timeline"),
        terminal_frame(evidence),
        add_chrome(Image.open(ASSETS / "github-ci.png").convert("RGB"), "github.com/RitwijParmar/solari-cookbook/actions"),
        make_cover(outro=True),
    ]
    labels = [
        "The failure window most browser agents ignore",
        "Live GCP evidence from real Solari infrastructure",
        "Browser #1 dies after commit -> Browser #2 reconciles",
        "Executable proof: tests, audit verification, dependency audit",
        "Public source on default main with green CI",
        "Ritwij Aryan Parmar · Aegis Commit",
    ]

    make_cover().save(ROOT / "aegis-commit-cover.jpg", quality=94)
    output = ROOT / "aegis-commit-demo.mp4"
    command = [
        FFMPEG,
        "-y",
        "-f", "rawvideo",
        "-pix_fmt", "rgb24",
        "-s", f"{WIDTH}x{HEIGHT}",
        "-r", str(FPS),
        "-i", "-",
        "-i", str(audio),
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "21",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "192k",
        "-movflags", "+faststart",
        "-shortest",
        str(output),
    ]
    process = subprocess.Popen(command, stdin=subprocess.PIPE)
    assert process.stdin is not None
    frames = math.ceil(total * FPS)
    for frame_index in range(frames):
        t = frame_index / FPS / total
        segment = max(i for i, start in enumerate(boundaries[:-1]) if t >= start)
        local = (t - boundaries[segment]) / (boundaries[segment + 1] - boundaries[segment])
        frame = zoom(sources[segment], 1 + 0.018 * local)
        frame = caption(frame, labels[segment], t)
        process.stdin.write(frame.tobytes())
    process.stdin.close()
    if process.wait() != 0:
        raise SystemExit("ffmpeg failed")
    print(f"rendered {output} ({total:.1f}s)")


if __name__ == "__main__":
    main()
