#!/usr/bin/env python3
"""Put a candidate's garment captures beside master's, pose by pose.

    python audits/wardrobe_sitting_desk/compare_with_master.py \
        --reference /tmp/cloth-compare-master-aline \
        --candidate /tmp/cloth-candidate-aline --label "my change" \
        --out /tmp/aline-master-vs-candidate.png

Each argument is an ``--out`` directory written by ``capture.py`` for ONE
garment. The sheet has one row per run (master first), and for every pose the
front and right views, cropped to the avatar.

Why this exists. On 2026-11-08 a cloth branch passed its own unit tests and
moved its gate numbers in the right direction, and was still worse than master
in the picture: the seated A-line and pencil skirts dropped off the lap on the
default page, and the opt-in solver tore the standing dress
(docs/physics/MASTER_REFERENCE.md). Numbers measured on the branch alone could
not show that, because master does not report them. The comparison that caught
it was a person looking at master and the branch side by side. This script
makes that the first thing a cloth change produces, not the last.

It does not judge. A changed picture is a review item; a pose where the
candidate looks worse than master is a regression whatever the gate says.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw

POSES = ("standing", "sittingDesk", "sittingWide", "sittingCrossed")
VIEWS = ("front", "right")
#: The avatar's region in capture.py's default 1440x900 frame: the stage panel
#: on the left. Cropping keeps the chat panel out of the comparison.
CROP = (60, 180, 420, 640)
TILE = (260, 330)
LABEL_W = 150
HEADER_H = 30


def entry(run: Path) -> dict:
    """The single garment entry of a capture run. Several entries is a usage error."""
    manifest = json.loads((run / "manifest.json").read_text())
    entries = manifest.get("entries") or []
    if len(entries) != 1:
        raise SystemExit(f"{run}: expected one garment, found {len(entries)}; capture with --only")
    return entries[0]


def frame(run: Path, item: dict, pose: str, view: str) -> Path | None:
    """Path of one picture, or None when that pose was not photographed."""
    shots = (item.get("poses") or {}).get(pose) or {}
    if shots.get("status") != "ok":
        return None
    path = run / item["folder"] / pose / f"{view}.png"
    return path if path.exists() else None


def layout(rows: int, poses=POSES, views=VIEWS) -> tuple[int, int]:
    """Sheet size for ``rows`` runs."""
    return LABEL_W + TILE[0] * len(poses) * len(views), HEADER_H + TILE[1] * rows


def compose(runs: list[tuple[str, Path]], poses=POSES, views=VIEWS) -> Image.Image:
    items = [(label, run, entry(run)) for label, run in runs]
    names = {item["name"] for _, _, item in items}
    if len(names) != 1:
        raise SystemExit(f"runs show different garments: {sorted(names)}")
    sheet = Image.new("RGB", layout(len(items), poses, views), "black")
    draw = ImageDraw.Draw(sheet)
    for column, pose in enumerate(poses):
        draw.text((LABEL_W + column * len(views) * TILE[0] + 8, 8), pose, fill="white")
    for row, (label, run, item) in enumerate(items):
        top = HEADER_H + row * TILE[1]
        draw.text((8, top + TILE[1] // 2), label, fill="yellow")
        for column, pose in enumerate(poses):
            for offset, view in enumerate(views):
                left = LABEL_W + (column * len(views) + offset) * TILE[0]
                path = frame(run, item, pose, view)
                if path is None:
                    draw.text((left + 8, top + TILE[1] // 2), "not captured", fill="red")
                    continue
                with Image.open(path) as picture:
                    tile = picture.convert("RGB").crop(CROP).resize(TILE)
                sheet.paste(tile, (left, top))
    return sheet


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--reference", required=True, type=Path, help="capture.py --out of master")
    parser.add_argument("--candidate", required=True, type=Path, action="append", help="capture.py --out of a change")
    parser.add_argument("--label", action="append", default=[], help="row label for each --candidate, in order")
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args(argv)
    labels = args.label + [run.name for run in args.candidate[len(args.label):]]
    runs = [("master", args.reference)] + list(zip(labels, args.candidate))
    compose(runs).save(args.out)
    print(f"Wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
