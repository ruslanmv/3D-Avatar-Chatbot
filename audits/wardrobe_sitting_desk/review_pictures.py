#!/usr/bin/env python3
"""Visual review of every catalog picture, for a multimodal coder.

The metric table is not a ship decision. A model that can see the picture
looks at each file, writes what is wrong, and sets review_status to pass
or fail. A release is blocked while any row is not pass.

    # 1. Next picture. Open absolute_path and look at it.
    python audits/wardrobe_sitting_desk/review_pictures.py next \
      --csv audits/wardrobe_sitting_desk/reports/catalog-matrix-2026-11-07/catalog-matrix.csv \
      --run /tmp/wardrobe-catalog-matrix

    # 2. Write the comment you saw, then update that row.
    python audits/wardrobe_sitting_desk/review_pictures.py record \
      --csv audits/wardrobe_sitting_desk/reports/catalog-matrix-2026-11-07/catalog-matrix.csv \
      --picture screenshots/catalog/garment-02-00-a-line-dress/sittingWide/front.png \
      --status fail \
      --comment "Hem fell through the lap. Briefs show in the opening."

    # 3. Production gate. Exit 1 if a single picture is not pass.
    python audits/wardrobe_sitting_desk/review_pictures.py check \
      --csv audits/wardrobe_sitting_desk/reports/catalog-matrix-2026-11-07/catalog-matrix.csv

pass is refused while bug_found is still set. Recapture that garment, rebuild
the CSV, look again, then record pass. See the fix procedure printed by check.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from print_matrix import read_csv, write_csv  # noqa: E402

FIX_PROCEDURE = """
Fix procedure. One picture is enough to block the release.
1. Open the picture named below. Do not raise the cloth gate to hide a number.
2. Hem through the lap: edit the span lift in src/wardrobe/PoseClothCorrection.js,
   keep the unit test, and do not mark it fixed from the fixture alone.
3. Torn edge or crossed-leg stretch: do not add a final relax(). That pulled
   other trousers back inside the body. Change the crease handling instead.
4. Recapture only that garment into a new directory:
   python audits/wardrobe_sitting_desk/capture.py --source catalog --only "<garment_name>" \\
     --avatar fem_vroid.vrm --url http://127.0.0.1:8080/ --out /tmp/wardrobe-retest \\
     --poses <pose>
5. Rebuild the table with print_matrix.py. A changed bug_found clears the old review.
6. Look at the new picture. record --status pass only when bug_found is empty
   and the frame shows a closed garment.
7. Run check again. Ship only when it prints "production: pass" and exits 0.
""".strip()


def pending_rows(rows: list[dict], view: str) -> list[dict]:
    chosen = []
    for row in rows:
        if view and row.get("view") != view:
            continue
        if (row.get("review_status") or "pending").strip() == "pending":
            chosen.append(row)
    return chosen


def next_pictures(rows: list[dict], run_dir: Path | None, view: str, count: int) -> list[dict]:
    items = []
    for row in pending_rows(rows, view)[:count]:
        relative = row.get("picture_path") or ""
        absolute = ""
        if run_dir and relative:
            candidate = run_dir / relative
            if candidate.is_file():
                absolute = str(candidate)
        items.append(
            {
                "picture_path": relative,
                "absolute_path": absolute,
                "garment_id": row.get("garment_id") or "",
                "garment_name": row.get("garment_name") or "",
                "pose": row.get("pose") or "",
                "view": row.get("view") or "",
                "volume_description": row.get("volume_description") or "",
                "bug_found": row.get("bug_found") or "",
                "fixed": row.get("fixed") or "",
            }
        )
    return items


def record_review(rows: list[dict], picture: str, status: str, comment: str) -> str:
    """Update one picture. Returns an error string, or empty on success."""
    if status not in ("pass", "fail"):
        return "status must be pass or fail"
    comment = comment.strip()
    if not comment:
        return "comment is required. Write what you saw in the picture."
    matches = [row for row in rows if (row.get("picture_path") or "") == picture]
    if not matches:
        return f"no row with picture_path {picture}"
    for row in matches:
        if status == "pass" and (row.get("bug_found") or "").strip():
            return (
                "refusing pass. bug_found is still set: "
                + row["bug_found"]
                + ". Recapture until the gate is clean, then look again."
            )
        if status == "pass" and not (row.get("picture_path") or "").strip():
            return "refusing pass. This row has no picture."
        row["review_status"] = status
        row["review_comment"] = comment
    return ""


def block_reasons(rows: list[dict]) -> list[str]:
    """Every row that is not a production pass."""
    reasons = []
    for row in rows:
        name = f"{row.get('garment_name')} {row.get('pose')}/{row.get('view')}"
        path = row.get("picture_path") or "(no picture)"
        status = (row.get("review_status") or "pending").strip()
        if status != "pass":
            comment = (row.get("review_comment") or row.get("bug_found") or "not reviewed").strip()
            reasons.append(f"{name}: review_status={status}. {path}. {comment}")
            continue
        if (row.get("fixed") or "").strip() == "no" or (row.get("bug_found") or "").strip():
            reasons.append(f"{name}: review said pass but the metric gate is still open. {path}")
    return reasons


def command_next(opts) -> int:
    rows = read_csv(opts.csv)
    items = next_pictures(rows, opts.run, opts.view or "", opts.count)
    print(json.dumps(items, indent=2))
    return 0


def command_record(opts) -> int:
    if not opts.picture or not opts.status or opts.comment is None:
        print("record needs --picture, --status pass|fail, and --comment", file=sys.stderr)
        return 2
    rows = read_csv(opts.csv)
    error = record_review(rows, opts.picture, opts.status, opts.comment)
    if error:
        print(error, file=sys.stderr)
        return 2
    write_csv(opts.csv, rows)
    print(f"updated {opts.picture} review_status={opts.status}")
    return 0


def command_check(opts) -> int:
    rows = read_csv(opts.csv)
    reasons = block_reasons(rows)
    counts = {"pass": 0, "fail": 0, "pending": 0}
    for row in rows:
        status = (row.get("review_status") or "pending").strip()
        counts[status] = counts.get(status, 0) + 1
    print(
        f"pictures {len(rows)}  pass {counts.get('pass', 0)}  "
        f"fail {counts.get('fail', 0)}  pending {counts.get('pending', 0)}"
    )
    if not reasons:
        print("production: pass")
        return 0
    print("production: blocked", file=sys.stderr)
    print(FIX_PROCEDURE, file=sys.stderr)
    shown = reasons[: opts.limit]
    for line in shown:
        print(line, file=sys.stderr)
    if len(reasons) > len(shown):
        print(f"... {len(reasons) - len(shown)} more. Filter review_status in the CSV.", file=sys.stderr)
    print(f"{len(reasons)} picture(s) are not pass", file=sys.stderr)
    return 1


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("next", "record", "check"))
    parser.add_argument("--csv", type=Path, required=True, help="catalog-matrix.csv")
    parser.add_argument("--run", type=Path, help="Capture directory, so next can print absolute_path")
    parser.add_argument("--picture", help="picture_path value from the CSV")
    parser.add_argument("--status", choices=("pass", "fail"))
    parser.add_argument("--comment", help="What the picture shows. Required for record.")
    parser.add_argument("--view", choices=("front", "right", "back", "left"), help="Limit next to one camera")
    parser.add_argument("--count", type=int, default=1, help="How many pending pictures next prints")
    parser.add_argument("--limit", type=int, default=15, help="How many blockers check prints")
    return parser.parse_args(argv)


def main(argv=None) -> int:
    opts = parse_args(argv)
    if not opts.csv.is_file():
        print(f"No table at {opts.csv}", file=sys.stderr)
        return 2
    if opts.command == "next":
        return command_next(opts)
    if opts.command == "record":
        return command_record(opts)
    return command_check(opts)


if __name__ == "__main__":
    sys.exit(main())
