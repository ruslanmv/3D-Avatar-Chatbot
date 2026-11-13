"""One sheet per captured garment: rows are poses, columns are cameras.

Each cell is cropped to the avatar viewport and carries a label: the gate
verdict for that pose, or 'missing' when the frame does not exist.
Usage: python audits/wardrobe_sitting_desk/garment_sheets.py <run_dir> <out_dir>

The prototype of the per-garment review in STABILITY_PLAN.md, phase 4.
"""

import json
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

POSES = ["standing", "sittingDesk", "sittingWide", "sittingCrossed"]
VIEWS = ["front", "right", "back", "left"]
CROP = (20, 80, 440, 640)  # avatar viewport at 1440x900
CELL = (300, 400)
HEAD = 44
LABEL = 22


def font(size):
    for name in ("DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default()


def main(run_dir: Path, out_dir: Path) -> int:
    manifest = json.loads((run_dir / "manifest.json").read_text())
    out_dir.mkdir(parents=True, exist_ok=True)
    big, small = font(22), font(14)
    written = 0
    for entry in manifest["entries"]:
        if entry.get("source") != "catalog":
            continue
        folder = run_dir / entry["folder"]
        w, h = CELL
        sheet = Image.new("RGB", (w * len(VIEWS), HEAD + (h + LABEL) * len(POSES)), (12, 14, 18))
        draw = ImageDraw.Draw(sheet)
        draw.text((10, 10), f"{entry['name']}  ·  {entry.get('status')}", fill="white", font=big)
        for r, pose in enumerate(POSES):
            info = (entry.get("poses") or {}).get(pose) or {}
            gate = info.get("gate") or {}
            if info.get("status") != "ok":
                verdict, colour = f"{pose}: {info.get('status') or 'missing'}", (230, 160, 40)
            elif gate.get("ok"):
                verdict, colour = f"{pose}: gate ok (look at the picture)", (90, 200, 120)
            else:
                misses = "; ".join(
                    f"{i.get('metric')}={i.get('value')}" for i in gate.get("issues", [])[:2]
                )
                verdict, colour = f"{pose}: GATE MISS {misses}", (235, 80, 80)
            y = HEAD + r * (h + LABEL)
            draw.text((8, y + 3), verdict, fill=colour, font=small)
            for c, view in enumerate(VIEWS):
                path = folder / pose / f"{view}.png"
                if path.exists():
                    cell = Image.open(path).convert("RGB").crop(CROP).resize(CELL)
                    sheet.paste(cell, (c * w, y + LABEL))
                draw.text((c * w + 6, y + LABEL + 4), view, fill=(170, 220, 230), font=small)
        slug = re.sub(r"[^a-z0-9]+", "-", entry["name"].lower()).strip("-")
        sheet.save(out_dir / f"{written + 1:02d}-{slug}.jpg", quality=85)
        written += 1
    print(f"wrote {written} garment sheets to {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main(Path(sys.argv[1]), Path(sys.argv[2])))
