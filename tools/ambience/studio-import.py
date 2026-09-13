#!/usr/bin/env python3
"""
Turn a 3D-Ambience-Studio environment into scenes this app can actually show.

## The mismatch this exists to close

`ruslanmv/3D-Ambience-Studio` publishes **2:1 equirectangular panoramas** — 4096×2048 desktop,
2048×1024 Quest — plus an `environment.json` describing lighting presets, particle effects and
ambient audio.

This app's ambience feature consumes something quite different: a **flat backplate** assigned to
`scene.background` as a plain `Texture`, cropped to the viewport with `repeat`/`offset`. Drop an
equirect panorama into that path unchanged and three.js does not know it is a panorama: it
stretches the 2:1 projection across a 16:9 rectangle, and the result is the familiar
horizontally-squashed, vertically-bowed look — poles smeared, horizon curved, nothing lining up
with the avatar's floor.

Setting `mapping = EquirectangularReflectionMapping` would fix the projection, but it is not the
answer here either: in r147 that routes through `WebGLCubeMaps.get()`, which builds a
`WebGLCubeRenderTarget` at `image.height / 2` and costs the source texture *plus* the cube —
tens of megabytes for a Quest panorama — and it replaces the cover crop with a live 360° view
that no longer has a fixed composition to author against.

So this **reprojects**: it takes one perspective view out of the panorama, through the exact
camera this app renders the avatar with. The output is a flat backplate whose horizon, floor
convergence and vanishing lines already agree with the projection the avatar is drawn in, which
is the whole point of `docs/BACKPLATE_PRODUCTION.md`.

    360° equirect  ──►  [ this script: sample along camera rays ]  ──►  flat 1920×1080 backplate
     (Studio)              30° vFOV, 16:9, 1.72° down                    (what ViewerEngine wants)

## The camera is not level, and that is the whole trick

`ViewerEngine.frameObject` places the eye at `target + normalize(0, 0.03, 1) × distance`, a
downward tilt of about 1.72°. `CalibrationGeometry` computes what that puts where: the horizon at
44.4% of frame height rather than 50%. Reprojecting with a level camera would produce an image
that is *correctly undistorted* and still wrong, with its horizon 60 px from where the avatar's
feet expect it. The tilt is applied here for exactly that reason.

## Usage

    python3 tools/ambience/studio-import.py <environment-dir> --scene sea --out-id ambient:cove

`<environment-dir>` is a published Studio environment: `environment.json` beside its
`panorama-*.webp` files. Writes a landscape and a portrait backplate into `assets/ambient/` and
prints a catalogue entry for `assets/ambient/backgrounds.json`.

Needs Pillow and numpy — an authoring tool, not a dependency of the app, which has no build step.
"""

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]

# The two projections this app ships. Kept in step with
# src/gltf-viewer/ambience/CalibrationGeometry.js — if those change, change these.
PROFILES = {
    "landscape": {"fov": 30.0, "width": 1920, "height": 1080, "dir": "light"},
    "portrait": {"fov": 42.0, "width": 1080, "height": 1920, "dir": "light"},
}

# frameObject's eye lift: normalize(0, 0.03, 1). See the header.
EYE_LIFT = 0.03
PITCH_RAD = math.atan2(EYE_LIFT, 1.0)

# Studio's category enum → this app's vocabulary. Studio has ten, the resolver understands a
# different set; anything unmapped falls back to 'relax' rather than inventing a category the
# resolver would score as nothing.
CATEGORY_MAP = {
    "relax": "relax",
    "meditation": "meditation",
    "study": "study",
    "sleep": "sleep",
    "nature": "nature",
    "cozy": "cozy",
    "fantasy": "fantasy",
    "focus": "study",
    "chill": "relax",
    "seasonal": "nature",
}


def reproject(panorama: Image.Image, fov_deg: float, width: int, height: int, yaw_deg: float = 0.0) -> Image.Image:
    """
    One perspective view out of an equirectangular panorama.

    For every output pixel a ray is built in camera space, pitched down by the engine's own
    tilt, yawed to whatever part of the panorama the manifest points at, then converted to a
    longitude/latitude and sampled. Bilinear, because nearest sampling on a sky gradient bands
    visibly and skies are most of what these panoramas are.
    """
    src = np.asarray(panorama.convert("RGB"), dtype=np.float32)
    sh, sw, _ = src.shape

    tan_v = math.tan(math.radians(fov_deg) / 2.0)
    aspect = width / height

    # Pixel centres in NDC, scaled to the frustum at unit depth.
    xs = (2.0 * (np.arange(width) + 0.5) / width - 1.0) * tan_v * aspect
    ys = (1.0 - 2.0 * (np.arange(height) + 0.5) / height) * tan_v
    gx, gy = np.meshgrid(xs, ys)
    gz = -np.ones_like(gx)  # three.js cameras look down -Z

    norm = np.sqrt(gx * gx + gy * gy + gz * gz)
    dx, dy, dz = gx / norm, gy / norm, gz / norm

    # Pitch down by the engine's eye lift, about X.
    cp, sp = math.cos(-PITCH_RAD), math.sin(-PITCH_RAD)
    ry = dy * cp - dz * sp
    rz = dy * sp + dz * cp
    dy, dz = ry, rz

    # Yaw, so a manifest can say which way the scene faces.
    if yaw_deg:
        cy, sy = math.cos(math.radians(yaw_deg)), math.sin(math.radians(yaw_deg))
        rx = dx * cy + dz * sy
        rz2 = -dx * sy + dz * cy
        dx, dz = rx, rz2

    lon = np.arctan2(dx, -dz)
    lat = np.arcsin(np.clip(dy, -1.0, 1.0))

    u = (lon / (2.0 * math.pi) + 0.5) * sw - 0.5
    v = (0.5 - lat / math.pi) * sh - 0.5

    u0 = np.floor(u).astype(np.int64)
    v0 = np.floor(v).astype(np.int64)
    fu = (u - u0)[..., None]
    fv = (v - v0)[..., None]

    # Longitude wraps; latitude clamps. Getting that backwards puts a seam down the middle or
    # mirrors the sky at the poles.
    u0m, u1m = u0 % sw, (u0 + 1) % sw
    v0m = np.clip(v0, 0, sh - 1)
    v1m = np.clip(v0 + 1, 0, sh - 1)

    top = src[v0m, u0m] * (1 - fu) + src[v0m, u1m] * fu
    bottom = src[v1m, u0m] * (1 - fu) + src[v1m, u1m] * fu
    out = top * (1 - fv) + bottom * fv
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGB")


def repo_relative(path: Path) -> str:
    """Path relative to the repo when it lives there, absolute when it does not.

    `--assets` pointing somewhere else is legitimate (a scratch run, a staging directory), and
    `relative_to` raises rather than degrading — so a perfectly reasonable invocation crashed
    after having already written both files.
    """
    try:
        return path.relative_to(ROOT).as_posix()
    except ValueError:
        return path.as_posix()


def load_environment(directory: Path) -> dict:
    manifest = directory / "environment.json"
    if not manifest.exists():
        sys.exit(f"no environment.json in {directory}")
    return json.loads(manifest.read_text(encoding="utf-8"))


def pick_panorama(directory: Path, env: dict) -> Path:
    """Prefer the desktop variant: it is the highest resolution the Studio publishes."""
    variants = env.get("variants", {})
    for key in ("desktop", "mobile", "quest"):
        variant = variants.get(key)
        if isinstance(variant, dict) and variant.get("type") == "panorama" and variant.get("background"):
            candidate = directory / variant["background"]
            if candidate.exists():
                return candidate
    for fallback in sorted(directory.glob("panorama-*.webp")):
        return fallback
    sys.exit(f"no panorama found in {directory}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("environment", type=Path, help="a published Studio environment directory")
    parser.add_argument("--scene", required=True, help="scene slug for the id, e.g. 'cove'")
    parser.add_argument("--variant", default="day", help="variant slug, e.g. 'day' or 'night'")
    parser.add_argument("--yaw", type=float, default=None, help="override the manifest's yawDegrees")
    parser.add_argument("--assets", type=Path, default=ROOT / "assets" / "ambient")
    args = parser.parse_args()

    env = load_environment(args.environment)
    source = pick_panorama(args.environment, env)
    yaw = args.yaw if args.yaw is not None else float(env.get("orientation", {}).get("yawDegrees", 0.0))

    with Image.open(source) as panorama:
        w, h = panorama.size
        if abs(w / h - 2.0) > 0.01:
            sys.exit(f"{source.name} is {w}x{h}, not 2:1 equirectangular — this is not a Studio panorama")
        # Dark variants land in dark/, everything else in light/. The Studio has no such split;
        # this app's catalogue does, and the category is the only signal available.
        subdir = "dark" if env.get("category") in {"sleep"} or "night" in env.get("tags", []) else "light"
        written = {}
        for name, profile in PROFILES.items():
            out_dir = args.assets / subdir
            out_dir.mkdir(parents=True, exist_ok=True)
            suffix = "" if name == "landscape" else "-portrait"
            out = out_dir / f"{env['id']}{suffix}.webp"
            view = reproject(panorama, profile["fov"], profile["width"], profile["height"], yaw)
            view.save(out, "WEBP", quality=86, method=6)
            written[name] = out
            print(f"{repo_relative(out)}  {profile['width']}x{profile['height']}  {out.stat().st_size / 1024:.0f} KB")

    entry = {
        "id": f"ambient:{args.scene}:{args.variant}",
        "type": "image",
        "label": env.get("name", args.scene.title()),
        "variantLabel": args.variant.title(),
        "src": repo_relative(written["landscape"]),
        "thumb": repo_relative(written["landscape"]),
        "focalPoint": "center",
        "intensity": 1,
        "category": CATEGORY_MAP.get(env.get("category", ""), "relax"),
        "tags": sorted({t.lower() for t in env.get("tags", []) if isinstance(t, str)}),
    }
    print("\nAdd to assets/ambient/backgrounds.json under \"scenes\":\n")
    print(json.dumps(entry, indent=2))
    print(
        "\nNote: the portrait file is written but the catalogue has no portrait variant yet —\n"
        "one src per scene. See docs/STUDIO_INTEGRATION.md."
    )


if __name__ == "__main__":
    main()
