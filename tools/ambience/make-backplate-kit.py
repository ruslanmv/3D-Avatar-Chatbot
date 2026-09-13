#!/usr/bin/env python3
"""
The kit for authoring scene art by hand: two guide images and one prompt sheet.

## Why this exists

The ten scenes that ship were not composed for this app's camera. They are good
photographs that happen to be behind her, which is why she can look pasted on:
the horizon is wherever the photographer put it, and the ground under her feet
is whatever was there.

Fixing that needs three numbers per profile — where the horizon sits, where her
feet land, and which band has to stay clear — and those numbers are **not**
guessable. The camera is tilted about 1.72 degrees down, so the horizon is at
44.4% of frame height in landscape rather than the middle, and her feet are at
89.7% rather than the three-quarters mark a person would estimate. Portrait is
different again.

So this reads `assets/ambient/camera-contract.json` — generated from
`CalibrationGeometry.js`, which is the camera itself — and turns it into
something a human or an image model can actually work against. Nothing here
invents a figure. Change the camera, re-run `export-camera-contract.mjs`, re-run
this, and the kit follows.

## What it produces

    guide-landscape.png   1920x1080   upload as a composition reference
    guide-portrait.png    1080x1920
    AMBIENCE_PROMPTS.md               ten scenes x two profiles, ready to paste

The guides are drawn, not described: an image model conditioned on a picture of
the horizon and the standing area does better than one told about them in
words, and a person art-directing in a chat window can point at them.

## Usage

    python3 tools/ambience/make-backplate-kit.py            # → build/backplate-kit/
    python3 tools/ambience/make-backplate-kit.py --out DIR

The output is deliberately not committed. It is a pure function of the contract
and the catalogue, both of which are, and a PNG in git is a thing that goes
stale silently.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
CONTRACT = ROOT / "assets" / "ambient" / "camera-contract.json"
CATALOGUE = ROOT / "assets" / "ambient" / "backgrounds.json"

# Drawn in the flat, unambiguous colours a conditioning image wants: no gradients for a model to
# imitate, and a red horizon that no photograph would contain by accident.
SKY = (150, 170, 190)
GROUND = (120, 110, 100)
HORIZON = (230, 60, 80)
DEPTH = (255, 255, 255)
KEEP_CLEAR = (60, 220, 140)
FOOT = (255, 210, 60)
TEXT = (20, 20, 24)


def font(size: int):
    """A real font where one exists, Pillow's bitmap default where none does.

    Labels are guidance for a person, so an ugly fallback is worth more than a crash on a machine
    with no DejaVu installed.
    """
    for candidate in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ):
        if Path(candidate).exists():
            try:
                return ImageFont.truetype(candidate, size)
            except OSError:
                pass
    return ImageFont.load_default()


def label(draw, xy, text, size, fill=TEXT, background=(255, 255, 255)):
    """Text on a plate, because a label that lands on a white line is a label nobody can read."""
    f = font(size)
    x, y = xy
    box = draw.textbbox((x, y), text, font=f)
    pad = max(3, size // 4)
    draw.rectangle((box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad), fill=background)
    draw.text((x, y), text, font=f, fill=fill)


def render_guide(profile: dict) -> Image.Image:
    width = int(profile["master"]["width"])
    height = int(profile["master"]["height"])
    horizon_y = float(profile["horizonY"])
    foot = profile["footAnchor"]
    safe = profile["safeZone"]
    unit = max(2, round(width / 640))

    image = Image.new("RGB", (width, height), SKY)
    draw = ImageDraw.Draw(image)

    horizon_px = round(horizon_y * height)
    draw.rectangle((0, horizon_px, width, height), fill=GROUND)

    # Longitudinal lines to the vanishing point. The vanishing point of a level floor is on the
    # horizon, directly ahead — so these need no projection maths, only a shared endpoint. Drawing
    # them is what turns a two-tone image into one that reads as a floor receding.
    vanishing = (width / 2, horizon_px)
    for fraction in (-1.5, -1.0, -0.5, 0.0, 0.5, 1.0, 1.5):
        draw.line(
            [(width / 2 + fraction * width, height), vanishing],
            fill=DEPTH,
            width=max(1, unit // 2),
        )

    # Distance lines, from the contract. Each is where a mark that many metres in front of her
    # would land, which is the only honest way to tell an artist how fast the floor should recede.
    for line in profile.get("groundLines", []):
        y = round(float(line["y"]) * height)
        draw.line([(0, y), (width, y)], fill=DEPTH, width=max(1, unit // 2))
        label(draw, (unit * 6, y + unit), f'{line["metres"]} m', max(14, unit * 7))

    draw.line([(0, horizon_px), (width, horizon_px)], fill=HORIZON, width=unit * 2)
    label(draw, (unit * 6, horizon_px - unit * 12), f"HORIZON  {horizon_y * 100:.1f}%", max(16, unit * 8))

    x0 = round(float(safe["x0"]) * width)
    x1 = round(float(safe["x1"]) * width)
    y0 = round(float(safe["y0"]) * height)
    y1 = round(float(safe["y1"]) * height)
    draw.rectangle((x0, y0, x1, y1), outline=KEEP_CLEAR, width=unit * 2)
    label(draw, (x0 + unit * 4, y0 + unit * 4), "AVATAR — KEEP CLEAR", max(16, unit * 7), fill=(10, 80, 50))

    foot_x = round(float(foot["x"]) * width)
    foot_y = round(float(foot["y"]) * height)
    radius = unit * 4
    draw.ellipse((foot_x - radius, foot_y - radius, foot_x + radius, foot_y + radius), fill=FOOT)
    draw.line([(x0, foot_y), (x1, foot_y)], fill=FOOT, width=unit)
    label(draw, (x1 + unit * 4, foot_y - unit * 6), f"FEET  {float(foot['y']) * 100:.1f}%", max(16, unit * 7))

    draw.rectangle((0, 0, width - 1, height - 1), outline=(40, 40, 48), width=unit)
    return image


def prompt_for(profile_name: str, profile: dict, subject: str) -> str:
    """The technical half of the prompt, in the order a model weights it.

    Subject first — it is what the picture is of, and a paragraph of measurements in front of it
    buries that. Then the geometry, then the exclusions. The percentages are repeated in words
    even though the guide image carries them, because not every route accepts a reference image:
    on the OllaBridge path the guide can only travel as text.
    """
    horizon = float(profile["horizonY"]) * 100
    foot = profile["footAnchor"]
    safe = profile["safeZone"]
    master = profile["master"]
    eye = float(profile["eyeHeightMetres"])
    return (
        f"{subject}. "
        f"Empty environment photograph, no people. "
        f"Composed as a background plate for a separately rendered character: "
        f"horizon exactly at {horizon:.1f}% of image height, "
        f"{profile['fovDeg']} degree vertical field of view, "
        f"camera {eye:.2f} m above a level floor and tilted {profile['pitchDeg']:.1f} degrees down. "
        f"Continuous, unobstructed, believable standing surface across the lower part of the frame, "
        f"clearly readable at {float(foot['x']) * 100:.0f}% across and {float(foot['y']) * 100:.1f}% down, "
        f"where the character's feet will meet the ground. "
        f"Keep the band from {float(safe['x0']) * 100:.0f}% to {float(safe['x1']) * 100:.0f}% of the width "
        f"free of prominent foreground objects. "
        f"One identifiable dominant light direction. "
        f"Natural perspective, no fisheye, no ultra-wide distortion, no tilted horizon. "
        f"{master['width']}x{master['height']}."
    )


NEGATIVE = (
    "people, person, character, figure, human, silhouette, cast shadow of a person, "
    "text, watermark, signature, frame, border, fisheye, panorama, warped horizon, "
    "foreground clutter in the centre, objects blocking the floor"
)

REFERENCE_INSTRUCTION = """\
Use the attached guide image as a **spatial reference only**. Do not copy its colours, its lines
or its labels. It marks, in order of importance:

* the red line — where the horizon must sit,
* the green box — the area a character will occupy, which must stay free of prominent detail,
* the yellow dot — where her feet meet the ground, which must be a believable flat standing
  surface,
* the white lines — how fast the floor should recede; each is marked with its real distance.

The output must contain **no person**."""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", default=str(ROOT / "build" / "backplate-kit"))
    args = parser.parse_args()

    contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
    catalogue = json.loads(CATALOGUE.read_text(encoding="utf-8"))
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    written = []
    for name, profile in contract["profiles"].items():
        path = out / f"guide-{name}.png"
        render_guide(profile).save(path)
        written.append(path)

    lines = [
        "# Scene prompts, generated from the camera contract",
        "",
        "Generated by `tools/ambience/make-backplate-kit.py` from",
        "`assets/ambient/camera-contract.json`. Do not hand-edit the numbers here — they come from",
        "`CalibrationGeometry.js`, which is the camera. Re-run the exporter and this script instead.",
        "",
        "Upload `guide-<profile>.png` alongside each prompt.",
        "",
        "## The instruction that goes with the guide image",
        "",
        REFERENCE_INSTRUCTION,
        "",
        "## Negative prompt, every scene",
        "",
        "```",
        NEGATIVE,
        "```",
        "",
    ]

    for name, profile in contract["profiles"].items():
        master = profile["master"]
        lines += [
            f"## {name} — {master['width']}x{master['height']}",
            "",
            f"Horizon **{float(profile['horizonY']) * 100:.1f}%** · "
            f"feet **{float(profile['footAnchor']['y']) * 100:.1f}%** · "
            f"keep clear **{float(profile['safeZone']['x0']) * 100:.1f}%–"
            f"{float(profile['safeZone']['x1']) * 100:.1f}%** of width.",
            "",
        ]
        for scene in catalogue["scenes"]:
            subject = scene["label"]
            if scene.get("variantLabel"):
                subject = f"{subject}, {scene['variantLabel']}"
            lines += [
                f"### {scene['id']}",
                "",
                "```",
                prompt_for(name, profile, subject),
                "```",
                "",
            ]

    sheet = out / "AMBIENCE_PROMPTS.md"
    sheet.write_text("\n".join(lines), encoding="utf-8")
    written.append(sheet)

    for path in written:
        print(f"wrote {path.relative_to(ROOT) if ROOT in path.parents else path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
