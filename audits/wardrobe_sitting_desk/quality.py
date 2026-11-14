"""Pure checks for the wardrobe audit.

No browser and no Forge. The capture runner and the unit tests both use this so a
failure is classified the same way in a report as in CI.
"""

from __future__ import annotations

import re

import hashlib
from pathlib import Path

# Stable prefixes. The suffix is the first 4 hex chars of SHA-1 over the parts,
# so the same garment and pose keep the same id across runs. WARDROBE-CLIP-001 is
# reserved for the seated skirt opening and is not hashed.
PREFIX = {
    "penetration": "WARDROBE-CLIP",
    "span-drop": "WARDROBE-SPAN",
    "stretch": "WARDROBE-DEFORM",
    "visual-delta": "WARDROBE-VIS",
    "generation": "WARDROBE-GEN",
    "pose": "WARDROBE-POSE",
    "capture": "WARDROBE-CAP",
    "infrastructure": "WARDROBE-INFRA",
    "ui": "WARDROBE-UI",
    "preview": "WARDROBE-UI",
    "inventory": "WARDROBE-INV",
}

SEVERITY_ORDER = {"P0": 0, "P1": 1, "P2": 2, "P3": 3}

# The seated pencil-skirt opening. Confirmed on the two-thigh fixture, not yet
# on a live Try-On photograph: the audit must not call it fixed until that rerun.
KNOWN_CLIP_001 = {
    "id": "WARDROBE-CLIP-001",
    "title": "Seated skirt or dress panel falls through the lap opening",
    "garmentId": "skirt-glam-pencil-mini-v1",
    "garmentName": "Pencil Mini Skirt",
    "category": "Skirts",
    "alsoAppliesTo": "Every garment profileFor marks as span (skirts, dresses, gowns)",
    "avatar": "fem-vroid",
    "pose": "sittingDesk",
    "camera": "front, back",
    "expected": "The skirt stays a single panel across the lap, covering what it covers when she is standing.",
    "actual": (
        "Skinning drops the bridging panel into the opening between the thighs. "
        "The opening is not inside either thigh, so the nearest-surface push leaves it there "
        "and the hem parts. On the two-thigh fixture the panel stays below the thighs "
        "(gap height under 0.43 m while the thigh tops are at 0.46 m) and the measured "
        "drop is 74 mm."
    ),
    "evidence": [
        "tests/wardrobe/pose-cloth-correction.test.js (SD1)",
        "audits/wardrobe_sitting_desk/reports/sd1-span-fixture.png",
        "audits/wardrobe_sitting_desk/reports/evidence/pencil-sittingDesk-cloth-off-front.png",
        "audits/wardrobe_sitting_desk/reports/evidence/pencil-sittingDesk-restward-front.png",
    ],
    "severity": "P1",
    "reproducibility": "deterministic on the fixture; live Try-On capture not yet run",
    "suspectedCause": "Seated deformation or weight painting of the pencil skirt.",
    "confirmedCause": (
        "PoseClothCorrection only pushes a vertex that is inside a surface. "
        "A span vertex in the lap opening has a positive signed distance to both thighs, "
        "so it is never moved. Confirmed by running the same fixture with and without profile 'span'."
    ),
    "owner": "3D-Avatar-Chatbot",
    "component": "src/wardrobe/PoseClothCorrection.js",
    "proposedFix": (
        "Span profile lifts a bridging vertex upward onto the thigh support, and only while "
        "its rest cut is still above it. A move that would leave the cut is reported and not applied."
    ),
    "retest": (
        "Unit retest passed on the fixture: with profile span, maxSpanDropMm goes from above 40 mm "
        "to under 8 mm, and a panel that is still on its cut reports 0 mm. "
        "Live Sitting (Desk) of Black Pencil Mini Skirt, cloth off versus the first "
        "rest-directed lift, did not close the hem: that lift moved the skirt mesh from "
        "124.1 mm to 130.5 mm and the front frame still parts over the lap. "
        "A later upward measurement also flagged a standing Grey Pencil Skirt at 133.9 mm, "
        "which is the hem hanging where it was cut; the gate now ignores a vertex that has "
        "not fallen below its cut. A later look the rail also labels Black Pencil Mini Skirt "
        "(`look_698e7f5cac96421d`, not the bandeau look) went from 59.9 mm to 24.4 mm in "
        "Sitting (Desk), still over the 8 mm gate; standing on that look passed. "
        "The live parted hem is not retested as closed, so this is not marked fixed."
    ),
    "status": "mechanism-corrected",
    "evidenceNote": (
        "audits/wardrobe_sitting_desk/reports/evidence/pencil-sittingDesk-cloth-off-front.png and "
        "pencil-sittingDesk-restward-front.png are the live pair. The rest-directed frame is not an improvement."
    ),
}

# Sitting (Desk) straight jeans. Penetration is cleared and the garment is not a span,
# so the pose-cloth gate reports a pass while the crotch and hips are open. Confirmed
# on a live Try-On frame; standing on the same look is a closed pair of jeans.
KNOWN_DEFORM_002 = {
    "id": "WARDROBE-DEFORM-002",
    "title": "Seated straight jeans open at the hips after penetration is cleared",
    "garmentId": "look-builtin-homepilot-default-fem-vroid-crop-top-jeans",
    "garmentName": "Blue Straight Jeans",
    "category": "Trousers & jeans",
    "avatar": "fem-vroid",
    "pose": "sittingDesk",
    "camera": "front",
    "cameraMethod": "camera-orbit",
    "expected": "The jeans stay a closed garment over the hips and crotch in Sitting (Desk), as they do when she is standing.",
    "actual": (
        "After cloth correction the jeans mesh reports 0 mm penetration and 2.77× edge stretch "
        "(from 37.5 mm and 7.62× before correction). The front frame still shows the legs ballooned "
        "away from the thighs and a gap at the crotch. Standing on the same look is a closed pair of jeans. "
        "The back frame keeps a waistband with a skin gap above it."
    ),
    "evidence": [
        "audits/wardrobe_sitting_desk/reports/evidence/jeans-sittingDesk-front.png",
        "audits/wardrobe_sitting_desk/reports/evidence/jeans-sittingDesk-back.png",
        "audits/wardrobe_sitting_desk/reports/evidence/jeans-standing-front.png",
    ],
    "severity": "P1",
    "reproducibility": "live Try-On, Crop top & jeans, Sitting (Desk), camera orbit, cloth phase applied",
    "suspectedCause": "Skinning opens the crotch seam when the thighs flex, and the push only moves vertices that are inside a surface.",
    "confirmedCause": (
        "The seated jeans are not a span, so the lap lift does not run. "
        "Vertices of the opened seam are outside the body, so maxPenetrationMm reaches 0 "
        "and the 6× stretch gate does not fire on the residual 2.77×. "
        "The photograph is the evidence the metrics miss."
    ),
    "owner": "shared",
    "component": "src/wardrobe/PoseClothCorrection.js and Forge jeans skinning",
    "proposedFix": (
        "Do not cover the opening with an extra opaque surface. "
        "A seam-closure or a corrective shape has to bring the parted panels back together; "
        "the penetration push cannot see a vertex that is already outside."
    ),
    "retest": "not retested; no seam-closure is implemented",
    "status": "open",
}

# Same limits the November captures used. The page never installs the worker
# script on window, so the audit applies the gate to the metrics the worker
# already returned. The current measure() reports penetration and stretch.
# Span drop is checked only when a metric named maxSpanDropMm is present.
GATE = {"maxPenetrationMm": 1, "maxEdgeStretch": 6, "maxSpanDropMm": 8}
_CHECKS = (
    ("penetration", "P1", "maxPenetrationMm"),
    ("stretch", "P2", "maxEdgeStretch"),
    ("span-drop", "P1", "maxSpanDropMm"),
)
#: Meshes that bridge the thighs when she sits, so the span gate applies to them.
_SPANS = re.compile(r"\b(skirt|dress|gown|chemise|slip)\b", re.I)


def issue_id(kind: str, *parts: str) -> str:
    digest = hashlib.sha1("|".join(str(part) for part in parts).encode()).hexdigest()[:4].upper()
    return f"{PREFIX.get(kind, 'WARDROBE-QA')}-{digest}"


def classify_failure(message: str, phase: str = "") -> str:
    """infrastructure, generation, pose, or capture. Visual findings are not exceptions."""
    text = (message or "").lower()
    phase = (phase or "").lower()
    if phase == "startup" or "playwright" in text or "net::" in text or "browser has been closed" in text:
        return "infrastructure"
    if any(word in text for word in ("forge", "catalog", "generation", "generate", "job")):
        return "generation"
    if any(word in text for word in ("pose", "sitting", "cloth", "preset")):
        return "pose"
    if "timeout" in text or "navigation" in text or "target closed" in text:
        return "infrastructure"
    return "capture"


def known_issue_record() -> dict:
    return dict(KNOWN_CLIP_001)


def known_issue_records() -> list[dict]:
    return [dict(KNOWN_CLIP_001), dict(KNOWN_DEFORM_002)]


def assess_metrics(garments: list | None, limits: dict | None = None) -> dict:
    """Quality gate over clothStatus().metrics. A miss is a finding, not an exception."""
    lim = dict(GATE)
    if limits:
        lim.update({key: limits[key] for key in GATE if key in limits})
    findings = []
    for garment in garments or []:
        after = (garment or {}).get("after") or {}
        name = (garment or {}).get("name") or ""
        # A skirt or dress whose span drop was not reported has not passed the span gate: it
        # was never measured. On 2026-11-13 the worker stopped reporting maxSpanDropMm and the
        # A-line's seated hoop read "gate ok"; a missing number must read as a miss.
        if _SPANS.search(name) and not isinstance(after.get("maxSpanDropMm"), (int, float)):
            findings.append(
                {
                    "code": "span-not-measured",
                    "severity": "P1",
                    "garment": name,
                    "metric": "maxSpanDropMm",
                    "value": "missing",
                    "limit": lim["maxSpanDropMm"],
                }
            )
        for code, severity, metric in _CHECKS:
            value = after.get(metric)
            if isinstance(value, (int, float)) and value > lim[metric]:
                findings.append(
                    {
                        "code": code,
                        "severity": severity,
                        "garment": name,
                        "metric": metric,
                        "value": value,
                        "limit": lim[metric],
                    }
                )
    return {"ok": not findings, "issues": findings}


def preview_issue(category: str, garment_id: str, name: str, preview_status: str) -> dict:
    return {
        "id": issue_id("preview", garment_id, "preview"),
        "title": f"Catalog preview missing for {name}",
        "garmentId": garment_id,
        "garmentName": name,
        "category": category,
        "pose": "",
        "camera": "",
        "expected": "A public catalog garment has a ready preview image.",
        "actual": f"previewStatus is {preview_status or 'missing'} and there is no preview URL.",
        "evidence": [],
        "severity": "P3",
        "reproducibility": "live GET /v1/catalog/garments",
        "suspectedCause": "The preview batch has not rendered this template.",
        "confirmedCause": "",
        "owner": "3D-Wardrobe-Forge",
        "component": "assets/catalog/previews",
        "proposedFix": "Render the template preview and publish it. Do not invent a URL.",
        "retest": "not retested",
        "status": "open",
    }


def metric_issue(garment_id: str, garment_name: str, category: str, pose: str, finding: dict) -> dict:
    code = finding.get("code") or "penetration"
    severity = finding.get("severity") or "P2"
    metric = finding.get("metric") or ""
    mesh = finding.get("garment") or garment_name
    return {
        "id": issue_id(code, garment_id, mesh, pose, metric),
        "title": f"{mesh} fails {metric} in {pose}",
        "garmentId": garment_id,
        "garmentName": mesh,
        "category": category,
        "pose": pose,
        "camera": "",
        "expected": f"{metric} at or under {finding.get('limit')}",
        "actual": f"{metric} is {finding.get('value')}",
        "evidence": [],
        "severity": severity,
        "reproducibility": "pose cloth metrics for this capture",
        "suspectedCause": "Pose cloth correction left a measured defect.",
        "confirmedCause": "",
        "owner": "3D-Avatar-Chatbot",
        "component": "src/wardrobe/PoseClothCorrection.js",
        "proposedFix": "Inspect the metric and the screenshots for this pose before changing thresholds.",
        "retest": "not retested",
        "status": "open",
    }


def visual_issue(garment_id: str, garment_name: str, pose: str, view: str, delta: dict, threshold: float) -> dict:
    return {
        "id": issue_id("visual-delta", garment_id, pose, view),
        "title": f"{garment_name} {pose} {view} differs from the baseline",
        "garmentId": garment_id,
        "garmentName": garment_name,
        "category": "",
        "pose": pose,
        "camera": view,
        "expected": f"Mean absolute pixel difference at or under {threshold}. A difference is a review, not a defect.",
        "actual": f"meanAbs {delta.get('meanAbs')} changedFraction {delta.get('changedFraction')}",
        "evidence": [],
        "severity": "P3",
        "reproducibility": "baseline comparison",
        "suspectedCause": "Lighting, cloth correction, or a real garment change.",
        "confirmedCause": "",
        "owner": "shared",
        "component": "audits/wardrobe_sitting_desk",
        "proposedFix": "A person compares the two frames before calling this a defect.",
        "retest": "not retested",
        "status": "needs-review",
        "confirmed": False,
    }


def image_delta(before: Path, after: Path) -> dict:
    """Mean absolute RGB difference in 0..1, and the fraction of pixels that changed.

    Sizes that differ are compared on the smaller image's box after a nearest resize
    of `after`, so a viewport change shows up as a large delta instead of a crash.
    """
    from PIL import Image

    with Image.open(before) as left, Image.open(after) as right:
        a = left.convert("RGB")
        b = right.convert("RGB")
        if a.size != b.size:
            b = b.resize(a.size)
        width, height = a.size
        pixels = width * height
        if pixels == 0:
            return {"meanAbs": 0.0, "changedFraction": 0.0, "width": width, "height": height}
        total = 0
        changed = 0
        for p, q in zip(a.getdata(), b.getdata()):
            d = abs(p[0] - q[0]) + abs(p[1] - q[1]) + abs(p[2] - q[2])
            total += d
            if d:
                changed += 1
    return {
        "meanAbs": round(total / (pixels * 3 * 255), 6),
        "changedFraction": round(changed / pixels, 6),
        "width": width,
        "height": height,
    }


def rank_issues(issues: list[dict]) -> list[dict]:
    return sorted(issues, key=lambda item: (SEVERITY_ORDER.get(item.get("severity"), 9), item.get("id", "")))


def summarize(entries: list[dict], issues: list[dict]) -> dict:
    """Machine-readable rollup. A capture that did not run is not counted as a pass."""
    by_status: dict[str, int] = {}
    expected = 0
    captured = 0
    accounted = 0
    for entry in entries:
        status = entry.get("status") or "missing"
        by_status[status] = by_status.get(status, 0) + 1
        for _pose, info in (entry.get("poses") or {}).items():
            expected += 1
            pose_status = info.get("status")
            if pose_status == "ok":
                captured += 1
                accounted += 1
            elif pose_status == "unsupported":
                # A documented non-pose is an answer, not a missing screenshot.
                accounted += 1
    by_severity: dict[str, int] = {}
    open_blockers = []
    for issue in issues:
        severity = issue.get("severity") or "P3"
        by_severity[severity] = by_severity.get(severity, 0) + 1
        if issue.get("status") in ("open", "mechanism-corrected") and severity in ("P0", "P1"):
            open_blockers.append(issue.get("id"))
    return {
        "entries": len(entries),
        "byStatus": by_status,
        "poseSlotsExpected": expected,
        "poseSlotsCaptured": captured,
        "poseSlotsAccounted": accounted,
        "issues": len(issues),
        "bySeverity": by_severity,
        "releaseBlockers": open_blockers,
        "releaseReady": (
            not open_blockers
            and by_status.get("error", 0) == 0
            and by_status.get("not-captured", 0) == 0
            and expected > 0
            and accounted == expected
            and captured > 0
        ),
    }
