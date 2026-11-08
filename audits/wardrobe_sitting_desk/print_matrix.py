#!/usr/bin/env python3
"""Print the catalog matrix and write the picture table.

Reads a capture directory written by ``capture.py`` (its ``manifest.json`` and
``screenshots/``). It does not open a browser and does not generate garments.

Outputs, under ``--out``:

- ``catalog-matrix.csv`` — one row per picture. Columns are picture path,
  volume description, bug found, solution, fixed (yes / no / n/a), and notes.
- ``sheets/matrix-<pose>.jpg`` — one contact sheet per pose, the same sheets
  used to review Sitting (Wide) and Sitting (Crossed). A red label is a pose
  whose cloth gate missed. Sheets are skipped with ``--no-sheets``.

``fixed`` is never ``yes``. This script only reports the run it was given.
A later coder marks a picture fixed by recapturing it and seeing an empty
bug on that pose. See ``AGENT_MATRIX.md``.

Compare a new CSV with a previous one:

    python audits/wardrobe_sitting_desk/print_matrix.py \\
      --run <new-capture> --baseline-csv <previous.csv>

Exit 1 when a picture that had no bug now has one, a picture that was
``fixed=yes`` is ``fixed=no``, or a picture file that existed is now missing.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

POSES = ("standing", "sittingDesk", "sittingWide", "sittingCrossed")
VIEWS = ("front", "right", "back", "left")
POSE_LABEL = {
    "standing": "Standing (standingRelaxed)",
    "sittingDesk": "Sitting (Desk)",
    "sittingWide": "Sitting (Wide)",
    "sittingCrossed": "Sitting (Crossed)",
}
COLUMNS = (
    "picture_path",
    "garment_id",
    "garment_name",
    "category",
    "pose",
    "view",
    "volume_description",
    "bug_found",
    "solution",
    "fixed",
    "notes",
)

SPAN_SOLUTION = (
    "WARDROBE-CLIP-001 is open. The span lift in src/wardrobe/PoseClothCorrection.js "
    "closed the two-thigh fixture and did not close this live frame. Recapture this "
    "picture and leave fixed as no until maxSpanDropMm is at or under 8."
)
STRETCH_SOLUTION = (
    "Do not finish the cloth correction with an extra relax(); that pulled other "
    "trousers back inside the body. The fresh-pass fold guard did not change the "
    "live crossed-leg number. Recapture this picture before marking fixed."
)
PENETRATION_SOLUTION = (
    "The push already ran. Do not raise the 1 mm gate to hide this number. Inspect "
    "the front frame, then change the push only if the picture shows cloth inside the body."
)
SKIP_SOLUTION = (
    "The cloth correction on this mesh did not finish, so no picture was taken. "
    "Capture it alone with a longer --cloth-timeout. --skip is only a way to let "
    "the rest of the matrix finish."
)


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def inventory_by_name(payload: dict) -> dict:
    return {item["name"]: item for item in payload.get("garments") or [] if item.get("name")}


def volume_description(garment: dict | None, pose: str, view: str) -> str:
    """Catalog volume (silhouette and hem) plus which frame this picture is."""
    frame = f"Frame is {POSE_LABEL.get(pose, pose)}, {view} camera."
    if not garment:
        return frame
    parts = []
    description = (garment.get("description") or "").rstrip(".")
    if description:
        parts.append(description)
    volume = []
    if garment.get("silhouette"):
        volume.append(f"silhouette {garment['silhouette']}")
    if garment.get("hem"):
        volume.append(f"hem {garment['hem']}")
    if volume:
        parts.append(", ".join(volume))
    parts.append(frame.rstrip("."))
    return ". ".join(parts) + "."


def pose_findings(entry: dict, pose: str) -> list[dict]:
    captured = (entry.get("poses") or {}).get(pose) or {}
    if not isinstance(captured, dict):
        return []
    return list((captured.get("gate") or {}).get("issues") or [])


def bug_text(findings: list[dict]) -> str:
    parts = []
    for finding in findings:
        mesh = ((finding.get("garment") or "").split("[")[0]).strip() or "garment"
        metric = finding.get("metric") or "metric"
        parts.append(f"{mesh} {metric}={finding.get('value')} (limit {finding.get('limit')})")
    return " | ".join(parts)


def solution_text(findings: list[dict]) -> str:
    metrics = {finding.get("metric") for finding in findings}
    parts = []
    if "maxSpanDropMm" in metrics:
        parts.append(SPAN_SOLUTION)
    if "maxEdgeStretch" in metrics:
        parts.append(STRETCH_SOLUTION)
    if "maxPenetrationMm" in metrics:
        parts.append(PENETRATION_SOLUTION)
    return " ".join(parts)


def picture_rows(manifest: dict, inventory: dict, run_dir: Path | None) -> list[dict]:
    """One row per pose and camera. ``fixed`` is ``no`` or ``n/a``, never ``yes``."""
    rows = []
    for entry in manifest.get("entries") or []:
        garment = inventory.get(entry.get("name") or "")
        category = (garment or {}).get("category") or entry.get("category") or ""
        garment_id = (garment or {}).get("id") or ""
        folder = entry.get("folder") or ""
        captured = entry.get("status") == "ok"
        for pose in POSES:
            findings = pose_findings(entry, pose) if captured else []
            cloth = (entry.get("poses") or {}).get(pose) or {}
            phase = cloth.get("clothPhase") if isinstance(cloth, dict) else ""
            for view in VIEWS:
                relative = f"{folder}/{pose}/{view}.png" if folder else ""
                exists = bool(run_dir and relative and (run_dir / relative).is_file())
                notes = []
                if not captured:
                    bug = entry.get("reason") or entry.get("error") or "Not captured."
                    solution = SKIP_SOLUTION
                    fixed = "no"
                    notes.append("No picture was generated for this cell.")
                elif findings:
                    bug = bug_text(findings)
                    solution = solution_text(findings)
                    fixed = "no"
                    notes.append("Same gate miss on every camera of this pose. Judge the front frame.")
                else:
                    bug = ""
                    solution = ""
                    fixed = "n/a"
                    notes.append("No gate miss on this pose.")
                if phase:
                    notes.append(f"clothPhase={phase}.")
                if run_dir is not None and relative and not exists and captured:
                    notes.append("Picture file is missing from the capture directory.")
                if fixed == "yes":
                    raise RuntimeError("print_matrix does not mark pictures fixed")
                rows.append(
                    {
                        "picture_path": relative,
                        "garment_id": garment_id,
                        "garment_name": entry.get("name") or "",
                        "category": category,
                        "pose": pose,
                        "view": view,
                        "volume_description": volume_description(garment, pose, view),
                        "bug_found": bug,
                        "solution": solution,
                        "fixed": fixed,
                        "notes": " ".join(notes),
                    }
                )
    return rows


def write_csv(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=COLUMNS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def read_csv(path: Path) -> list[dict]:
    with path.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def regressions(baseline: list[dict], current: list[dict]) -> list[str]:
    """A clean picture that gains a bug, or a fixed picture that opens again."""
    before = {(row.get("garment_name"), row.get("pose"), row.get("view")): row for row in baseline}
    found = []
    for row in current:
        key = (row.get("garment_name"), row.get("pose"), row.get("view"))
        old = before.get(key)
        if old is None:
            continue
        name = f"{key[0]} {key[1]}/{key[2]}"
        if not (old.get("bug_found") or "").strip() and (row.get("bug_found") or "").strip():
            found.append(f"regression: {name} was clean and now has a bug: {row['bug_found']}")
        if (old.get("fixed") or "").strip() == "yes" and (row.get("fixed") or "").strip() == "no":
            found.append(f"regression: {name} was fixed=yes and is now fixed=no")
        old_path = (old.get("picture_path") or "").strip()
        new_path = (row.get("picture_path") or "").strip()
        if old_path and not new_path:
            found.append(f"regression: {name} picture path disappeared")
        old_notes = old.get("notes") or ""
        new_notes = row.get("notes") or ""
        if "Picture file is missing" in new_notes and "missing" not in old_notes:
            found.append(f"regression: {name} picture file is missing")
    return found


def _crop_avatar(path: Path):
    from PIL import Image

    image = Image.open(path).convert("RGB")
    pixels = image.load()
    width, height = image.size
    points = []
    for y in range(80, min(height, 720)):
        for x in range(20, min(width, 460)):
            red, green, blue = pixels[x, y][:3]
            if red > 165 and green > 125 and blue > 105 and red > blue + 18:
                points.append((x, y))
    if len(points) < 50:
        return image.crop((40, 120, 420, 640)).resize((150, 200))
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    box = (
        max(0, min(xs) - 12),
        max(0, min(ys) - 20),
        min(width, max(xs) + 12),
        min(height, max(ys) + 16),
    )
    crop = image.crop(box)
    crop.thumbnail((150, 210), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (150, 210), (8, 10, 16))
    canvas.paste(crop, ((150 - crop.width) // 2, (210 - crop.height) // 2))
    return canvas


def write_sheets(run_dir: Path, manifest: dict, out_dir: Path) -> list[Path]:
    """Contact sheets. One JPEG per pose. Red label means the gate missed."""
    from PIL import Image, ImageDraw, ImageFont

    sheets = out_dir / "sheets"
    sheets.mkdir(parents=True, exist_ok=True)
    entries = [entry for entry in manifest.get("entries") or [] if entry.get("status") == "ok"]
    written = []
    font = ImageFont.load_default()
    cols = 8
    cell_w, cell_h = 150, 232
    for pose in POSES:
        rows = (len(entries) + cols - 1) // cols or 1
        image = Image.new("RGB", (cols * cell_w, rows * cell_h + 28), (6, 8, 14))
        draw = ImageDraw.Draw(image)
        draw.text((8, 6), f"{pose}  ·  {len(entries)} catalog garments", fill=(180, 220, 230))
        for index, entry in enumerate(entries):
            relative = f"{entry.get('folder') or ''}/{pose}/front.png"
            frame = run_dir / relative
            cell = _crop_avatar(frame) if frame.is_file() else Image.new("RGB", (150, 210), (40, 20, 20))
            row, col = divmod(index, cols)
            x, y = col * cell_w, 28 + row * cell_h
            image.paste(cell, (x, y))
            missed = bool(pose_findings(entry, pose))
            color = (255, 140, 120) if missed else (190, 200, 210)
            draw.text((x + 4, y + 212), (entry.get("name") or "")[:18], fill=color, font=font)
        dest = sheets / f"matrix-{pose}.jpg"
        image.save(dest, quality=90)
        written.append(dest)
    return written


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, help="Capture directory that contains manifest.json")
    parser.add_argument(
        "--inventory",
        type=Path,
        help="Catalog inventory JSON. Defaults to the committed 2026-11-07 inventory.",
    )
    parser.add_argument("--out", type=Path, required=True, help="Directory for the CSV and contact sheets")
    parser.add_argument("--baseline-csv", type=Path, help="Previous CSV. Exit 1 on a regression.")
    parser.add_argument("--no-sheets", action="store_true", help="Write the CSV only")
    return parser.parse_args(argv)


def main(argv=None) -> int:
    opts = parse_args(argv)
    if not opts.run:
        print("print_matrix needs --run <capture-directory>", file=sys.stderr)
        return 2
    manifest_path = opts.run / "manifest.json"
    if not manifest_path.is_file():
        print(f"No manifest at {manifest_path}", file=sys.stderr)
        return 2
    inventory_path = opts.inventory
    if inventory_path is None:
        inventory_path = Path(__file__).parent / "reports" / "live-catalog-2026-11-07" / "inventory.json"
    inventory = inventory_by_name(load_json(inventory_path)) if inventory_path.is_file() else {}
    manifest = load_json(manifest_path)
    rows = picture_rows(manifest, inventory, opts.run)
    if any(row["fixed"] == "yes" for row in rows):
        print("Refusing to write fixed=yes. Recapture the picture first.", file=sys.stderr)
        return 2
    dest = opts.out / "catalog-matrix.csv"
    write_csv(dest, rows)
    print(f"Wrote {len(rows)} picture rows to {dest}")
    if not opts.no_sheets:
        for sheet in write_sheets(opts.run, manifest, opts.out):
            print(f"Wrote {sheet}")
    if opts.baseline_csv:
        found = regressions(read_csv(opts.baseline_csv), rows)
        for line in found:
            print(line, file=sys.stderr)
        if found:
            print(f"{len(found)} regression(s) against {opts.baseline_csv}", file=sys.stderr)
            return 1
        print(f"No regressions against {opts.baseline_csv}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
