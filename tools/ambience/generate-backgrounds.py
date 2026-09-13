#!/usr/bin/env python3
"""
Generate a **fallback** set of ten scene backgrounds (batch A6).

## This is not what ships

The scenes the app ships are photoreal, and they come from `ruslanmv/yourfriend`
— see `assets/ambient/PROVENANCE.md`. Running this script **overwrites them**
with abstract stand-ins. Do that only deliberately.

## Why it exists anyway

The shipped art is Apache-2.0 and properly licensed upstream, so this is not a
licensing workaround — PROVENANCE.md records the chain.

It is insurance of a duller kind. The art lives in another repository, and a
project whose only art comes from somewhere else cannot ship the day that
somewhere else becomes unavailable, changes, or turns out to be wrong for the
product. The output here is a deterministic function of this file: Apache-2.0 by
construction, with no third-party provenance to trace at all — no photograph, no
stock terms, no model-output rights question, no attribution chain, not even a
licence file in another repository. If the photoreal set ever has to come out,
the feature still works, and it works the same day.

It is only possible because the catalogue (`assets/ambient/backgrounds.json`)
names **paths, not pixels**. Either set drops into the same ten paths and
nothing else in the feature changes.

## What it produces

Abstract layered landscapes: gradient skies, a light source, horizon bands,
silhouettes, water. Soft, low-contrast, and empty through the middle third,
because a viewport background is seen peripherally and must never compete with
the avatar standing in front of it. They read as *somewhere* at a glance. They
are not photographs and do not pretend to be.

## Running it

    python3 tools/ambience/generate-backgrounds.py

Seeded per scene, so the output is byte-identical run to run. Needs Pillow and
numpy, which are **not** repository dependencies — this is a one-off authoring
tool, not part of the app or its build, and there is no build.
"""

import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W, H = 1920, 1080
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
OUT = os.path.join(ROOT, 'assets', 'ambient')

# 82 keeps every scene comfortably under 160 KB while staying free of banding in
# the sky gradients, which is where WebP artefacts show first.
QUALITY = 82


def vgrad(stops):
    """A vertical gradient from (position 0..1, RGB) stops, as an H x W x 3 array."""
    ys = np.linspace(0.0, 1.0, H)
    positions = np.array([s[0] for s in stops])
    channels = []
    for c in range(3):
        values = np.array([float(s[1][c]) for s in stops])
        channels.append(np.interp(ys, positions, values))
    column = np.stack(channels, axis=1)
    return np.repeat(column[:, None, :], W, axis=1)


def glow(img, cx, cy, radius, colour, strength=1.0):
    """A soft radial light. Added, not blended, so it reads as emitted light."""
    ys, xs = np.mgrid[0:H, 0:W]
    d = np.sqrt(((xs - cx) / radius) ** 2 + ((ys - cy) / radius) ** 2)
    falloff = np.clip(1.0 - d, 0.0, 1.0) ** 2.2
    for c in range(3):
        img[:, :, c] += falloff * colour[c] * strength
    return img


def horizon_mask(y, softness=2.0):
    """1 below the horizon, 0 above, with a soft edge — haze, not a cut line."""
    ys = np.arange(H)[:, None]
    return np.clip((ys - y) / softness, 0.0, 1.0) * np.ones((1, W))


def water(img, horizon, tint, shimmer_seed, shimmer=0.06):
    """
    Reflect the sky downward and break it up with horizontal shimmer.

    The reflection is what makes a two-gradient image read as water rather than
    as two gradients: the sea carries the sky's own colours, compressed.
    """
    rng = np.random.default_rng(shimmer_seed)
    h = int(horizon)
    below = horizon_mask(horizon, softness=6.0)
    # Compress the sky into the sea band, flipped. This is what makes two
    # gradients read as water: the sea carries the sky's own colours.
    band_h = H - h
    if band_h > 0 and h > 1:
        src = np.flipud(img[:h])
        idx = np.clip((np.linspace(0, src.shape[0] - 1, band_h) * 0.55).astype(int), 0, src.shape[0] - 1)
        reflected = src[idx]
        target = img[h:, :, :]
        blend = np.linspace(0.55, 0.2, band_h)[:, None, None]
        img[h:, :, :] = target * (1 - blend) + reflected * blend

    # Vary in x as well as y. A row-constant value is a scanline, not a ripple — the first
    # version of this read as interlacing artefacts across the whole sea.
    rows = np.convolve(rng.normal(0.0, 1.0, H), np.ones(13) / 13, mode='same')
    cols = np.convolve(rng.normal(0.0, 1.0, W), np.ones(180) / 180, mode='same')
    ripple = rows[:, None] * (0.45 + 0.55 * (cols[None, :] - cols.min()) / (np.ptp(cols) + 1e-6))
    img += (below * ripple)[:, :, None] * shimmer * 255.0
    for c in range(3):
        img[:, :, c] += below * tint[c]
    return img


def ridges(draw, y, colour, seed, amplitude=90, steps=9, alpha=255):
    """A mountain silhouette, as a filled polygon across the full width."""
    rng = np.random.default_rng(seed)
    xs = np.linspace(-40, W + 40, steps)
    peaks = rng.uniform(0.25, 1.0, steps) ** 1.4
    points = [(float(x), float(y - p * amplitude)) for x, p in zip(xs, peaks)]
    draw.polygon(points + [(W + 40, H), (-40, H)], fill=colour + (alpha,))


def stars(img, count, seed, brightness=1.0, band=None):
    """Point stars, plus an optional soft galactic band."""
    rng = np.random.default_rng(seed)
    for _ in range(count):
        x = rng.integers(0, W)
        y = int(abs(rng.normal(0, 0.45)) * H * 0.7)
        if y >= H:
            continue
        v = rng.uniform(0.35, 1.0) ** 2 * 255 * brightness
        img[y, x, :] += v
        if v > 170:
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                if 0 <= y + dy < H and 0 <= x + dx < W:
                    img[y + dy, x + dx, :] += v * 0.3
    if band is not None:
        ys, xs = np.mgrid[0:H, 0:W]
        d = np.abs((ys - (band * H)) - (xs - W / 2) * 0.18) / (H * 0.16)
        img += (np.clip(1 - d, 0, 1) ** 2)[:, :, None] * np.array([26.0, 24.0, 38.0])
    return img


def finish(img, name, blur=0.0, vignette=0.22):
    """Vignette, clamp, optional blur, write WebP."""
    if vignette:
        ys, xs = np.mgrid[0:H, 0:W]
        d = np.sqrt(((xs - W / 2) / (W / 2)) ** 2 + ((ys - H / 2) / (H / 2)) ** 2)
        img *= (1.0 - np.clip(d - 0.55, 0, 1) * vignette)[:, :, None]
    out = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8), 'RGB')
    if blur:
        out = out.filter(ImageFilter.GaussianBlur(blur))
    path = os.path.join(OUT, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    out.save(path, 'WEBP', quality=QUALITY, method=6)
    print(f'{name:46s} {os.path.getsize(path) / 1024:6.1f} KB')


def overlay(img, build):
    """Draw RGBA shapes over the array and composite them back."""
    base = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8), 'RGB').convert('RGBA')
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    build(ImageDraw.Draw(layer))
    return np.asarray(Image.alpha_composite(base, layer).convert('RGB')).astype(np.float64)


# ── the ten scenes ────────────────────────────────────────────────────────────


def ocean_sunrise():
    img = vgrad([
        (0.00, (38, 62, 110)), (0.30, (120, 122, 158)), (0.52, (232, 168, 122)),
        (0.62, (255, 206, 150)), (0.66, (244, 176, 126)), (1.00, (70, 88, 118)),
    ])
    img = glow(img, W * 0.62, H * 0.63, 420, (120, 78, 30), 1.0)
    img = glow(img, W * 0.62, H * 0.63, 95, (150, 120, 60), 1.2)
    img = water(img, H * 0.66, (10, 6, 0), 11, shimmer=0.05)
    # The glitter path: the sun's reflection, narrowing towards the horizon.
    rng = np.random.default_rng(12)
    for i in range(420):
        y = H * 0.665 + (i / 420.0) ** 1.6 * H * 0.33
        spread = 18 + (i / 420.0) * 300
        x = W * 0.62 + rng.normal(0, spread)
        if 0 <= int(x) < W and int(y) < H:
            img[int(y), int(x), :] += rng.uniform(40, 150) * np.array([1.0, 0.82, 0.6])
    finish(img, 'light/ocean-sunrise.webp', blur=0.6)


def ocean_moonlight():
    img = vgrad([
        (0.00, (6, 10, 26)), (0.35, (14, 24, 52)), (0.58, (30, 46, 84)),
        (0.64, (46, 66, 106)), (1.00, (8, 14, 32)),
    ])
    img = stars(img, 480, 21, brightness=0.7)
    img = glow(img, W * 0.30, H * 0.26, 300, (34, 44, 74), 1.0)
    img = glow(img, W * 0.30, H * 0.26, 52, (150, 158, 180), 1.1)
    img = water(img, H * 0.64, (2, 6, 14), 22, shimmer=0.045)
    rng = np.random.default_rng(23)
    for i in range(320):
        y = H * 0.645 + (i / 320.0) ** 1.5 * H * 0.35
        x = W * 0.30 + rng.normal(0, 14 + (i / 320.0) * 210)
        if 0 <= int(x) < W and int(y) < H:
            img[int(y), int(x), :] += rng.uniform(25, 95) * np.array([0.78, 0.85, 1.0])
    finish(img, 'dark/ocean-moonlight.webp', blur=0.6)


def mountain_lake():
    img = vgrad([
        (0.00, (70, 122, 176)), (0.30, (142, 186, 218)), (0.50, (206, 222, 230)),
        (0.56, (188, 206, 214)), (1.00, (58, 92, 122)),
    ])
    img = glow(img, W * 0.78, H * 0.18, 360, (60, 52, 30), 0.7)
    img = overlay(img, lambda d: (
        ridges(d, H * 0.57, (96, 116, 140), 31, amplitude=150, steps=8, alpha=210),
        ridges(d, H * 0.575, (62, 80, 102), 32, amplitude=95, steps=11, alpha=255),
    ))
    img = water(img, H * 0.575, (0, 4, 10), 33, shimmer=0.035)
    finish(img, 'light/mountain-lake.webp', blur=0.5)


def mountain_lake_night():
    img = vgrad([
        (0.00, (8, 14, 34)), (0.34, (20, 32, 60)), (0.52, (44, 60, 90)),
        (0.56, (34, 48, 74)), (1.00, (10, 16, 34)),
    ])
    img = stars(img, 560, 41, brightness=0.8, band=0.22)
    img = overlay(img, lambda d: (
        ridges(d, H * 0.58, (26, 36, 58), 42, amplitude=160, steps=8, alpha=230),
        ridges(d, H * 0.585, (14, 20, 36), 43, amplitude=100, steps=11, alpha=255),
    ))
    img = water(img, H * 0.585, (2, 4, 12), 44, shimmer=0.03)
    finish(img, 'dark/mountain-lake-night.webp', blur=0.5)


def _foliage(rng, palette, density=520, alpha=20):
    """
    Foliage massed at the frame edges, thinning towards the middle.

    Scattered evenly it reads as camouflage — which is what the first version of this looked
    like. Banking it left and right instead gives the eye an opening to look *through*, which is
    what makes a flat green field read as a garden.

    It also keeps the centre empty, and that is the harder-won half. An earlier draft put a
    stone path up the middle; it read as a bright wedge in precisely the third of the frame the
    avatar occupies. Anything with contrast in the centre of a viewport background competes with
    the character, however pretty it looks on its own.
    """

    def draw(d):
        for _ in range(density):
            side = -1 if rng.random() < 0.5 else 1
            x = W / 2 + side * (0.30 + rng.random() ** 0.55 * 0.78) * W / 2
            y = rng.uniform(-80, H + 40)
            r = rng.uniform(50, 150) * (0.6 + abs(x - W / 2) / (W / 2))
            v = rng.uniform(0.5, 1.15)
            d.ellipse(
                [x - r, y - r * 0.78, x + r, y + r * 0.78],
                fill=(int(palette[0] * v), int(palette[1] * v), int(palette[2] * v), alpha),
            )

    return draw


def meditation_garden():
    img = vgrad([
        (0.00, (188, 208, 172)), (0.22, (156, 188, 142)), (0.44, (120, 158, 106)),
        (0.56, (104, 140, 96)), (0.66, (138, 134, 108)), (1.00, (112, 104, 84)),
    ])
    img = glow(img, W * 0.30, H * 0.12, 620, (126, 116, 52), 0.9)
    rng = np.random.default_rng(51)

    img = overlay(img, _foliage(rng, (86, 128, 82)))
    finish(img, 'light/meditation-garden.webp', blur=3.4, vignette=0.32)


def meditation_garden_night():
    img = vgrad([
        (0.00, (12, 26, 32)), (0.28, (16, 36, 42)), (0.54, (20, 44, 46)),
        (0.66, (24, 32, 32)), (1.00, (12, 20, 22)),
    ])
    rng = np.random.default_rng(61)

    img = overlay(img, _foliage(rng, (22, 50, 44), density=480, alpha=24))
    # Two lanterns, the only warm light in the scene, and the reason the path is readable.
    img = glow(img, W * 0.17, H * 0.60, 210, (100, 64, 24), 1.0)
    img = glow(img, W * 0.17, H * 0.60, 24, (154, 112, 52), 1.15)
    img = glow(img, W * 0.84, H * 0.70, 165, (82, 52, 20), 0.9)
    img = glow(img, W * 0.84, H * 0.70, 18, (134, 96, 44), 1.05)
    finish(img, 'dark/meditation-garden-night.webp', blur=3.0, vignette=0.36)


def coastal_terrace():
    img = vgrad([
        (0.00, (96, 150, 198)), (0.28, (164, 200, 224)), (0.46, (214, 226, 226)),
        (0.50, (80, 142, 170)), (0.70, (52, 110, 142)), (0.72, (226, 214, 196)),
        (1.00, (176, 160, 142)),
    ])
    img = glow(img, W * 0.70, H * 0.20, 420, (72, 62, 36), 0.8)
    img = water(img, H * 0.50, (0, 6, 12), 71, shimmer=0.03)
    # Terrace floor starts at 0.72; lay flagstone seams and a railing over it.
    def terrace(d):
        for i in range(1, 7):
            y = H * 0.72 + (i / 6.0) ** 1.7 * H * 0.28
            d.line([(0, y), (W, y)], fill=(148, 132, 114, 70), width=2)
        for i in range(-3, 12):
            x0 = W * 0.5 + i * 190
            d.line([(x0, H * 0.72), (W * 0.5 + i * 330, H)], fill=(148, 132, 114, 55), width=2)
        d.rectangle([0, H * 0.695, W, H * 0.715], fill=(232, 224, 210, 190))
        for i in range(16):
            x = i * (W / 15.0)
            d.rectangle([x - 7, H * 0.715, x + 7, H * 0.79], fill=(226, 216, 202, 150))
    img = overlay(img, terrace)
    finish(img, 'light/coastal-terrace.webp', blur=0.7, vignette=0.26)


def coastal_terrace_twilight():
    img = vgrad([
        (0.00, (26, 26, 62)), (0.24, (62, 46, 94)), (0.40, (132, 74, 104)),
        (0.47, (198, 110, 98)), (0.50, (52, 48, 86)), (0.70, (30, 32, 62)),
        (0.72, (58, 50, 54)), (1.00, (38, 32, 38)),
    ])
    img = glow(img, W * 0.34, H * 0.47, 400, (92, 48, 34), 0.9)
    img = stars(img, 220, 81, brightness=0.55)
    img = water(img, H * 0.50, (6, 2, 8), 82, shimmer=0.035)

    def terrace(d):
        for i in range(1, 7):
            y = H * 0.72 + (i / 6.0) ** 1.7 * H * 0.28
            d.line([(0, y), (W, y)], fill=(86, 74, 78, 60), width=2)
        d.rectangle([0, H * 0.695, W, H * 0.715], fill=(110, 96, 96, 170))
        for i in range(16):
            x = i * (W / 15.0)
            d.rectangle([x - 7, H * 0.715, x + 7, H * 0.79], fill=(104, 90, 92, 135))
    img = overlay(img, terrace)
    img = glow(img, W * 0.09, H * 0.66, 150, (92, 58, 22), 0.95)
    img = glow(img, W * 0.09, H * 0.66, 18, (140, 100, 44), 1.0)
    finish(img, 'dark/coastal-terrace-twilight.webp', blur=0.7, vignette=0.3)


def open_sky():
    img = vgrad([
        (0.00, (58, 118, 186)), (0.35, (112, 162, 212)), (0.70, (176, 206, 230)),
        (1.00, (216, 230, 238)),
    ])
    rng = np.random.default_rng(91)

    def clouds(d):
        for _ in range(90):
            cx, cy = rng.uniform(-200, W + 200), rng.uniform(-40, H * 0.95)
            for _ in range(16):
                r = rng.uniform(60, 230)
                x = cx + rng.normal(0, 150)
                y = cy + rng.normal(0, 34)
                d.ellipse([x - r, y - r * 0.42, x + r, y + r * 0.42],
                          fill=(255, 255, 255, 26))
    img = overlay(img, clouds)
    img = glow(img, W * 0.76, H * 0.22, 520, (56, 48, 30), 0.7)
    finish(img, 'light/open-sky.webp', blur=2.6, vignette=0.2)


def starlight_sky():
    img = vgrad([
        (0.00, (4, 6, 20)), (0.45, (10, 14, 38)), (0.78, (18, 22, 50)),
        (1.00, (8, 10, 26)),
    ])
    img = stars(img, 1500, 101, brightness=1.0, band=0.46)
    img = glow(img, W * 0.5, H * 0.46, 760, (14, 14, 30), 1.0)
    finish(img, 'dark/starlight-sky.webp', blur=0.45, vignette=0.26)


SCENES = [
    ocean_sunrise, ocean_moonlight, mountain_lake, mountain_lake_night,
    meditation_garden, meditation_garden_night, coastal_terrace,
    coastal_terrace_twilight, open_sky, starlight_sky,
]

if __name__ == '__main__':
    for scene in SCENES:
        scene()
    total = sum(
        os.path.getsize(os.path.join(dirpath, f))
        for dirpath, _, files in os.walk(OUT) for f in files if f.endswith('.webp')
    )
    print(f'\ntotal {total / 1024 / 1024:.2f} MB across 10 files')
