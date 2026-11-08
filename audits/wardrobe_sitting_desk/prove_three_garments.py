#!/usr/bin/env python3
"""Prove three garments before the full catalog.

    python audits/wardrobe_sitting_desk/prove_three_garments.py \
        --url "http://127.0.0.1:8080/?cloth=xpbd" \
        --forge-url http://127.0.0.1:8090 \
        --out-prefix /tmp/cloth-contract \
        [--reference-prefix /tmp/cloth-master]

Runs ``capture.py`` once per pilot garment, with exactly the command shape the
cloth work is judged by (``--source catalog``, the avatar ``fem_vroid.vrm``,
four poses, four cameras), into ``<out-prefix>-aline``, ``-pencil`` and
``-pleated``. Then it checks that each run photographed the template it was
asked for and writes ``<out-prefix>-summary.json`` and ``.md``.

Why three, and why this script. A cloth change used to be captured across the
whole catalog, or not at all. The three pilots are the cases that break first:
a dress whose bodice and skirt are two shells 1 mm apart, a hybrid pencil skirt
with a separate waistband, and a pleated mini whose hem folds back on itself.
If these three are not right in all four poses, the other garments will not
be, and a catalog run only takes longer to say so. The script exists so the
proof is the same command every time: the three runs on 2026-11-08 were typed
by hand, and one of them was captured while the code under it was changing.

``--reference-prefix`` points at the same three captures of master (made with
this script and master's URL). When it is given, each garment also gets a
master-versus-candidate sheet from ``compare_with_master.py``, because a
candidate that is worse than master is a regression whatever its gate says
(docs/physics/MASTER_REFERENCE.md).

A garment whose catalog name now resolves to a different template stops the
run for that garment with the reason. Nothing is marked fixed by this script.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

#: (short key, catalog name passed to --only, template the name must resolve to)
GARMENTS = (
    ("aline", "A-line dress", "dress-a-line-v1"),
    ("pencil", "Pencil skirt", "skirt-pencil-v1"),
    ("pleated", "Pleated mini", "skirt-pleated-mini-v1"),
)
POSES = ("standing", "sittingDesk", "sittingWide", "sittingCrossed")
VIEWS = ("front", "right", "back", "left")
AVATAR = "fem_vroid.vrm"
#: The gate the cloth work is held to. Copied, not imported: the capture
#: manifest already carries the limits it applied, and the summary reports
#: those, so a drift here would show up as a disagreement, not a silent pass.
LIMITS = {"maxPenetrationMm": 1, "maxEdgeStretch": 6, "maxSpanDropMm": 8}
TEMPLATE_IN_PREVIEW = re.compile(r"/garments/([a-z0-9-]+)/preview")


def capture_command(python: str, url: str, forge_url: str, name: str, out: Path, extra=()) -> list[str]:
    """The capture.py invocation for one garment, in the agreed shape."""
    return [
        python,
        str(HERE / "capture.py"),
        "--url", url,
        "--forge-url", forge_url,
        "--avatar", AVATAR,
        "--source", "catalog",
        "--only", name,
        "--poses", ",".join(POSES),
        "--views", ",".join(VIEWS),
        "--out", str(out),
        *extra,
    ]


def template_of(run: Path, name: str) -> str | None:
    """The template id the catalog row ``name`` resolved to, from the run's inventory."""
    try:
        inventory = json.loads((run / "inventory.json").read_text())
    except (OSError, ValueError):
        return None
    wanted = name.lower()
    for row in inventory.get("garments") or []:
        if wanted not in (row.get("name") or "").lower():
            continue
        found = TEMPLATE_IN_PREVIEW.search(row.get("preview") or "")
        if found:
            return found.group(1)
    return None


def garment_rows(pose: dict) -> list[dict]:
    """The pose's per-garment metrics, newest shape first, empty when the app reported none."""
    return [row for row in pose.get("metrics") or [] if isinstance(row, dict)]


def summarise(run: Path, key: str, name: str, template: str) -> dict:
    """One garment's result: per pose, status, cloth phase, and the main garment's gate numbers."""
    result = {"key": key, "name": name, "template": template, "run": str(run)}
    resolved = template_of(run, name)
    result["resolvedTemplate"] = resolved
    if resolved != template:
        result["status"] = "wrong-template" if resolved else "not-found"
        return result
    try:
        manifest = json.loads((run / "manifest.json").read_text())
    except (OSError, ValueError) as error:
        result["status"] = f"no-manifest: {error}"
        return result
    entries = manifest.get("entries") or []
    if len(entries) != 1:
        result["status"] = f"expected one entry, found {len(entries)}"
        return result
    entry = entries[0]
    result["status"] = entry.get("status")
    if entry.get("error"):
        result["error"] = entry["error"]
    poses = {}
    for pose_id in POSES:
        pose = (entry.get("poses") or {}).get(pose_id) or {}
        row = {"status": pose.get("status"), "clothPhase": pose.get("clothPhase")}
        gate = pose.get("gate") or {}
        rows = garment_rows(pose)
        # capture.py writes gate.ok = true when it found no issue, and it finds
        # none when the page reported no metrics at all (master has no evidence
        # API). An empty measurement is "not measured", never a pass: the first
        # summary on master printed "pass" for twelve poses nobody had measured.
        if rows and "ok" in gate:
            row["gate"] = "pass" if gate["ok"] else "fail"
        else:
            row["gate"] = "not measured"
        # The garment itself, not its waistband piece or the briefs underneath:
        # the row with no "before" is the solver's; otherwise the first row whose
        # name is not underwear. Every row is kept in the run's own manifest.
        main = next((r for r in rows if r.get("before") is None), None) or next(
            (r for r in rows if not re.search(r"brief|bra\b|panties", r.get("name", ""), re.I)), None
        )
        if main:
            row["garment"] = main.get("name")
            row["after"] = main.get("after")
        poses[pose_id] = row
    result["poses"] = poses
    return result


def markdown(summary: dict) -> str:
    lines = [
        "# Three pilot garments",
        "",
        f"URL `{summary['url']}`, Forge `{summary['forgeUrl']}`, avatar `{AVATAR}`.",
        f"Gate: penetration {LIMITS['maxPenetrationMm']} mm, stretch {LIMITS['maxEdgeStretch']}x, "
        f"span drop {LIMITS['maxSpanDropMm']} mm. Numbers are necessary, not sufficient: read the pictures.",
        "",
        "| Garment | Pose | Status | Cloth | Pen mm | Stretch | Span mm | Gate |",
        "|---|---|---|---|---:|---:|---:|---|",
    ]
    for item in summary["garments"]:
        if "poses" not in item:
            lines.append(f"| {item['name']} | — | {item.get('status')} | | | | | |")
            continue
        for pose_id, row in item["poses"].items():
            after = row.get("after") or {}
            lines.append(
                f"| {item['name']} | {pose_id} | {row.get('status')} | {row.get('clothPhase') or ''} | "
                f"{after.get('maxPenetrationMm', '')} | {after.get('maxEdgeStretch', '')} | "
                f"{after.get('maxSpanDropMm', '')} | {row.get('gate', '')} |"
            )
    if summary.get("sheets"):
        lines += ["", "Master versus candidate:", ""]
        lines += [f"- {key}: `{path}`" for key, path in summary["sheets"].items()]
    return "\n".join(lines) + "\n"


def main(argv=None, run=subprocess.run) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--url", default="http://127.0.0.1:8080/?cloth=xpbd")
    parser.add_argument("--forge-url", default="http://127.0.0.1:8090")
    parser.add_argument("--out-prefix", default="/tmp/cloth-contract", type=Path)
    parser.add_argument("--reference-prefix", type=Path, help="master captures made with this script")
    parser.add_argument("--only", default="", help="comma-separated keys: aline,pencil,pleated")
    parser.add_argument("--python", default=sys.executable)
    parser.add_argument("--no-capture", action="store_true", help="summarise existing captures only")
    parser.add_argument("--load-timeout", default="180")
    parser.add_argument("--generate-timeout", default="600")
    parser.add_argument("--cloth-timeout", default="120")
    args = parser.parse_args(argv)
    keys = {k for k in args.only.split(",") if k} or {key for key, _, _ in GARMENTS}
    extra = ["--load-timeout", args.load_timeout, "--generate-timeout", args.generate_timeout,
             "--cloth-timeout", args.cloth_timeout]
    summary = {"url": args.url, "forgeUrl": args.forge_url, "limits": LIMITS, "garments": [], "sheets": {}}
    for key, name, template in GARMENTS:
        if key not in keys:
            continue
        out = Path(f"{args.out_prefix}-{key}")
        print(f"[prove] {name} ({template}) -> {out}", flush=True)
        if not args.no_capture:
            run(capture_command(args.python, args.url, args.forge_url, name, out, extra), check=False)
        item = summarise(out, key, name, template)
        summary["garments"].append(item)
        if args.reference_prefix and item.get("status") == "ok":
            reference = Path(f"{args.reference_prefix}-{key}")
            sheet = Path(f"{args.out_prefix}-{key}-vs-master.png")
            if (reference / "manifest.json").exists():
                run([args.python, str(HERE / "compare_with_master.py"), "--reference", str(reference),
                     "--candidate", str(out), "--label", "candidate", "--out", str(sheet)], check=False)
                summary["sheets"][key] = str(sheet)
            else:
                print(f"[prove] no master capture at {reference}; sheet skipped", flush=True)
    base = Path(f"{args.out_prefix}-summary")
    base.with_suffix(".json").write_text(json.dumps(summary, indent=2))
    base.with_suffix(".md").write_text(markdown(summary))
    print(f"[prove] wrote {base}.json and {base}.md", flush=True)
    return 0 if all(item.get("status") == "ok" for item in summary["garments"]) else 1


if __name__ == "__main__":
    raise SystemExit(main())
