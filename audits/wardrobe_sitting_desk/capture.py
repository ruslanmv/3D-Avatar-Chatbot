#!/usr/bin/env python3
"""Evidence-first wardrobe audit.

Opens the avatar app, enumerates Try-On looks and the live Forge catalog, and
captures each applied garment in standing and seated poses from four camera
orbits. A pose is not photographed until the cloth correction reports applied,
skipped, or failed. On this tree that phase is recorded by the page init
script, because VRPoseSystem no longer has clothStatus(). Screenshots are
never invented: a miss is an explicit status.

`--inventory-only` does not open a browser and does not generate garments. It
records the live catalog and marks every garment not-captured.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import html
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from quality import (
    assess_metrics,
    classify_failure,
    image_delta,
    known_issue_records,
    metric_issue,
    preview_issue,
    rank_issues,
    summarize,
    visual_issue,
)

# Camera orbits around the controls target. This is not an avatar yaw.
# `side` and `opposite-side` are the names the first runner used.
VIEWS = {
    "front": 0,
    "right": 90,
    "side": 90,
    "back": 180,
    "left": 270,
    "opposite-side": -90,
}
POSES = {
    "standing": "standingRelaxed",
    "sittingDesk": "sittingDesk",
    "sittingWide": "sittingWide",
    "sittingCrossed": "sittingCrossed",
}
# Locomotion is a follow state machine. There is no Pose Studio frame to hold.
UNSUPPORTED_POSES = {
    "walking": (
        "AvatarLocomotionSystem walks by following the viewer. It is not a Pose Studio "
        "preset, so a still audit has no walk frame to apply."
    ),
}
CAMERA_METHOD = "camera-orbit"
DEFAULT_FORGE = "https://ruslanmv-3d-wardrobe-forge.hf.space"
GL_ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
CANONICAL_VIEWS = ("front", "right", "back", "left")


def slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")[:70] or "unnamed"


def save_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def view_angle(name: str) -> int:
    if name not in VIEWS:
        raise KeyError(name)
    return VIEWS[name]


def state(page) -> dict:
    return page.evaluate("""() => {
      const t = s => document.querySelector(s)?.textContent?.trim() || '';
      const chosen = document.querySelector('.nexus-look-rail-item[aria-pressed="true"]');
      const pose = window.vrPoseSystem;
      const viewer = window.NEXUS_VIEWER;
      const cloth = window.__auditReadCloth ? window.__auditReadCloth() : {phase:'', pending:0};
      return {name:t('.nexus-stage-look-name'), description:t('.nexus-stage-look-desc'),
        count:t('.nexus-stage-count'), lookKey:chosen?.getAttribute('data-look-key') || '',
        pose:pose?.getCurrentPreset?.() || '',
        avatarReady:!!viewer?.avatarManager?.currentRoot,
        cameraReady:!!viewer?.camera && !!viewer?.controls,
        canvas:!!document.querySelector('.avatar-preview-wrap canvas'),
        clothPhase: cloth.phase || '',
        clothPending: cloth.pending || 0,
        error:t('.nexus-catalog-error')};
    }""")


def ready(page, timeout: int) -> None:
    page.wait_for_function(
        "() => !!window.NEXUS_VIEWER?.avatarManager?.currentRoot && !!window.NEXUS_VIEWER?.camera && !!window.NEXUS_VIEWER?.controls",
        timeout=timeout * 1000,
    )
    page.locator(".nexus-look-rail-item").first.wait_for(state="attached", timeout=timeout * 1000)


def open_try_on(page, timeout: int) -> None:
    page.goto(page.audit_url, wait_until="load", timeout=timeout * 1000)
    page.wait_for_function("() => !!window.NEXUS_VIEWER?.avatarManager?.currentRoot", timeout=timeout * 1000)
    launcher = page.locator("#nexus-bd-together-launcher")
    if launcher.is_visible():
        launcher.click()
    else:
        page.locator("#mobile-menu-btn").click()
        page.locator("#nexus-bd-together-drawer-item").click()
    page.locator('.nexus-bd-together-tile[data-activity="try-on-haul"]').click(timeout=timeout * 1000)
    ready(page, timeout)
    title = page.locator(".nexus-look-rail-title")
    if "is-folded" in (page.locator(".nexus-try-on-look-rail").get_attribute("class") or ""):
        title.click()


def rail_looks(page) -> list[dict]:
    return page.locator(".nexus-look-rail-item").evaluate_all("""els => els.map((el, index) => ({
        index, name:el.getAttribute('title') || el.textContent.trim(),
        key:el.getAttribute('data-look-key') || '',
        preview:el.querySelector('img')?.src || ''
    }))""")


def wear_look(page, look: dict, timeout: int) -> None:
    # Use the stable look key, not the caption: several looks can have the same name.
    rail = page.locator(".nexus-look-rail-item")
    index = next(
        (i for i in range(rail.count()) if rail.nth(i).get_attribute("data-look-key") == look["key"]),
        None,
    )
    if index is None:
        raise RuntimeError(f"Look disappeared from rail: {look['name']}")
    target = rail.nth(index)
    target.click(timeout=timeout * 1000)
    page.wait_for_function(
        """key => {
      const current=document.querySelector('.nexus-look-rail-item[aria-pressed="true"]');
      return !!window.NEXUS_VIEWER?.avatarManager?.currentRoot && current?.getAttribute('data-look-key')===key;
    }""",
        arg=look["key"],
        timeout=timeout * 1000,
    )
    page.wait_for_timeout(800)


def open_catalog(page, timeout: int) -> None:
    if page.locator(".nexus-catalog-overlay").count():
        return
    if page.locator(".nexus-try-on-look-rail.is-folded").count():
        page.locator(".nexus-look-rail-title").click()
    page.locator(".nexus-look-rail-edit").click()
    page.locator(".nexus-catalog-overlay").wait_for(state="visible", timeout=timeout * 1000)
    page.wait_for_function(
        """() => !!document.querySelector('.nexus-catalog-cats button') ||
      !!document.querySelector('.nexus-catalog-error')""",
        timeout=timeout * 1000,
    )
    error = page.locator(".nexus-catalog-error")
    if error.count():
        raise RuntimeError(f"Forge catalog unavailable: {error.first.inner_text()}")


def catalog_items(page, timeout: int) -> list[dict]:
    open_catalog(page, timeout)
    categories = page.locator(".nexus-catalog-cats button").all_inner_texts()
    items = []
    for cat_index, label in enumerate(categories):
        page.locator(".nexus-catalog-cats button").nth(cat_index).click()
        cards = page.locator(".nexus-catalog-card")
        names = cards.evaluate_all("""els => els.map(x => ({
            name:x.querySelector('.nexus-catalog-name')?.textContent?.trim() || '',
            preview:x.querySelector('img')?.src || ''
        }))""")
        for item_index, entry in enumerate(names):
            items.append({"category": label, "category_index": cat_index, "item_index": item_index, **entry})
    close = page.locator(".nexus-catalog-header button").first
    close.click()
    page.locator(".nexus-catalog-overlay").wait_for(state="hidden", timeout=timeout * 1000)
    return items


def apply_catalog_item(page, item: dict, timeout: int, color: str, folder: Path) -> None:
    open_catalog(page, timeout)
    page.locator(".nexus-catalog-cats button").nth(item["category_index"]).click()
    card = page.locator(".nexus-catalog-card").nth(item["item_index"])
    name = card.locator(".nexus-catalog-name").inner_text()
    if name != item["name"]:
        raise RuntimeError(f"Catalog changed: expected {item['name']!r}, found {name!r}")
    card.click()
    swatch = page.locator(f'.nexus-catalog-swatch[aria-label="{color}"]')
    if swatch.count():
        swatch.click()
    page.screenshot(path=str(folder / "catalog-ui.png"), animations="disabled")
    previous_key = state(page)["lookKey"]
    page.locator(".nexus-catalog-primary").click()
    # Never infer success from the click. Forge can refuse jobs or fail while fitting.
    page.wait_for_function(
        """() => !document.querySelector('.nexus-catalog-overlay') ||
       !!document.querySelector('.nexus-catalog-error')""",
        timeout=timeout * 1000,
    )
    error = page.locator(".nexus-catalog-error")
    if error.count() and error.first.inner_text().strip():
        raise RuntimeError(error.first.inner_text().strip())
    ready(page, timeout)
    page.wait_for_function(
        """previous => {
      const active=document.querySelector('.nexus-look-rail-item[aria-pressed="true"]');
      return !!active && active.getAttribute('data-look-key') !== previous;
    }""",
        arg=previous_key,
        timeout=timeout * 1000,
    )
    page.wait_for_timeout(1000)


def remember_camera(page) -> None:
    ok = page.evaluate("""() => {
      const v=window.NEXUS_VIEWER;
      if (!v?.camera?.position || !v?.controls?.target) return false;
      window.__wardrobeAuditCamera={position:v.camera.position.toArray(),
        target:v.controls.target.toArray(), fov:v.camera.fov, method:'camera-orbit'};
      return true;
    }""")
    if not ok:
        raise RuntimeError("Cannot capture baseline camera")


def camera_view(page, degrees: int) -> None:
    result = page.evaluate(
        """degrees => {
      const v=window.NEXUS_VIEWER, base=window.__wardrobeAuditCamera;
      if (!v?.camera || !v?.controls || !base) return false;
      const [x,y,z]=base.position, [tx,ty,tz]=base.target;
      const dx=x-tx, dz=z-tz, angle=degrees*Math.PI/180;
      v.controls.target.set(tx,ty,tz);
      v.camera.position.set(tx+dx*Math.cos(angle)+dz*Math.sin(angle), y,
        tz+dz*Math.cos(angle)-dx*Math.sin(angle));
      if (base.fov) v.camera.fov = base.fov;
      v.camera.updateProjectionMatrix?.();
      v.controls.update(); return true;
    }""",
        degrees,
    )
    if not result:
        raise RuntimeError("Cannot orient camera for requested view")


def apply_pose(page, pose_id: str, timeout: int) -> dict:
    preset = POSES[pose_id]
    result = page.evaluate(
        """preset => {
      const p = window.vrPoseSystem;
      if (!p || typeof p.applyPreset !== 'function' || typeof p.getCurrentPreset !== 'function')
        return {ok:false, error:'vrPoseSystem is unavailable'};
      p.claimBones?.();
      p.applyPreset(preset, 0);
      return {ok:p.getCurrentPreset()===preset, current:p.getCurrentPreset()};
    }""",
        preset,
    )
    if not result.get("ok"):
        raise RuntimeError(f"{pose_id} did not apply: {result}")
    # pending counts down for two frames, then the worker runs. Idle right after
    # applyPreset means the countdown has not started; do not treat it as done.
    # This tree has no clothStatus(). The init script records phase on cloth.
    page.wait_for_function(
        """preset => {
      const p = window.vrPoseSystem;
      if (!p || p.getCurrentPreset?.() !== preset) return false;
      const status = window.__auditReadCloth ? window.__auditReadCloth() : {phase:'', pending:0};
      if (status.pending) return false;
      if (window.NEXUS_POSE_CLOTH_ENABLED === false) return true;
      return status.phase === 'applied' || status.phase === 'skipped' || status.phase === 'failed';
    }""",
        arg=preset,
        timeout=timeout * 1000,
    )
    measured = page.evaluate("""() => {
      const status = window.__auditReadCloth ? window.__auditReadCloth() : {phase:'', metrics:[]};
      return {phase: status.phase || '', metrics: status.metrics || []};
    }""")
    # PoseClothCorrection is loaded in the worker, not on the page, so the gate
    # is applied here from the metrics the worker already returned.
    measured["gate"] = assess_metrics(measured.get("metrics"))
    return measured


def capture_pose(page, folder: Path, pose_id: str, views: list[str], settle_ms: int, cloth_timeout: int) -> dict:
    cloth = apply_pose(page, pose_id, cloth_timeout)
    pose_dir = folder / pose_id
    pose_dir.mkdir(parents=True, exist_ok=True)
    images = {}
    for view in views:
        camera_view(page, VIEWS[view])
        page.wait_for_timeout(settle_ms)
        current = state(page)
        if current["pose"] != POSES[pose_id] or not current["avatarReady"] or not current["canvas"]:
            raise RuntimeError(f"Avatar/pose not ready during {pose_id}/{view}: {current}")
        page.screenshot(path=str(pose_dir / f"{view}.png"), animations="disabled")
        images[view] = f"{pose_id}/{view}.png"
    camera_view(page, 0)
    return {
        "status": "ok",
        "preset": POSES[pose_id],
        "clothPhase": cloth.get("phase") or "",
        "gate": cloth.get("gate"),
        "metrics": cloth.get("metrics") or [],
        "images": images,
        "camera": CAMERA_METHOD,
    }


# master no longer exposes vrPoseSystem.clothStatus() or PoseClothCorrector.phase.
# The capture records phase itself: release() goes idle, correct() goes pending,
# and the promise settles applied, skipped, or failed. clothStatus() is still
# preferred when a build has it.
CLOTH_OBSERVER_JS = """
window.__auditReadCloth = () => {
  const p = window.vrPoseSystem;
  if (!p) return { phase: '', pending: 0, metrics: [] };
  if (typeof p.clothStatus === 'function') {
    const status = p.clothStatus() || {};
    return { phase: status.phase || '', pending: status.pending || 0, metrics: status.metrics || [] };
  }
  const cloth = p.cloth;
  return {
    phase: (cloth && cloth.phase) || '',
    pending: p._clothPending || 0,
    metrics: (cloth && cloth.last) || [],
  };
};
(() => {
  const arm = () => {
    const cloth = window.vrPoseSystem && window.vrPoseSystem.cloth;
    if (!cloth || cloth.__auditPhase) return !!cloth;
    const release = cloth.release.bind(cloth);
    const correct = cloth.correct.bind(cloth);
    cloth.phase = 'idle';
    cloth.release = function (root) {
      cloth.phase = 'idle';
      return release(root);
    };
    cloth.correct = function (root) {
      cloth.phase = 'pending';
      return Promise.resolve(correct(root)).then(
        (result) => {
          cloth.phase = result ? 'applied' : 'skipped';
          return result;
        },
        (error) => {
          cloth.phase = 'failed';
          throw error;
        }
      );
    };
    cloth.__auditPhase = true;
    return true;
  };
  const timer = setInterval(() => { if (arm()) clearInterval(timer); }, 100);
})();
"""


def context_init_script(opts) -> str:
    cfg = json.dumps({"forge": opts.forge_url, "avatar": opts.avatar})
    return (
        """(() => {
          const {forge,avatar} = """
        + cfg
        + """;
          if (forge) {localStorage.setItem('wardrobe_forge_mode','custom'); localStorage.setItem('wardrobe_forge_url',forge);}
          if (avatar) localStorage.setItem('nexus_selected_avatar_file',avatar);
        })();"""
        + CLOTH_OBSERVER_JS
    )


def ui_issue(control: dict, evidence: str) -> dict:
    return {
        "id": f"WARDROBE-UI-{slug(control.get('command') or 'control')}-{slug(evidence)}",
        "title": f"Stage control {control.get('command') or 'control'} is not hittable",
        "garmentId": "",
        "garmentName": "",
        "category": "ui",
        "pose": "",
        "camera": "",
        "expected": "Turn, Save and Next are visible and receive the hit.",
        "actual": json.dumps(control),
        "evidence": [evidence],
        "severity": "P2",
        "reproducibility": "this viewport",
        "suspectedCause": "Overlay collision or a control outside the viewport.",
        "confirmedCause": "",
        "owner": "3D-Avatar-Chatbot",
        "component": "src/wardrobe/TryOnStageExperience.js",
        "proposedFix": "Inspect the UI screenshot before moving the control.",
        "retest": "not retested",
        "status": "open",
    }


def record_ui(page, out: Path, name: str, viewport: str, issues: list) -> None:
    controls = stage_controls(page)
    save_json(out / f"{name}.json", {"viewport": viewport, "controls": controls})
    page.screenshot(path=str(out / f"{name}.png"), animations="disabled")
    for control in controls:
        if control["shown"] and (not control["hit"] or control["clipped"]):
            issues.append(ui_issue(control, f"{name}.png"))


def stage_controls(page) -> list[dict]:
    """Which stage buttons are actually hittable. A control under another layer is a UI defect."""
    return page.evaluate("""() => {
      const out = [];
      for (const el of document.querySelectorAll('.nexus-stage-action')) {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        const shown = r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
        let hit = false;
        if (shown) {
          const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          hit = !!(at && (at === el || el.contains(at)));
        }
        out.push({command: el.getAttribute('data-command') || '', shown, hit,
          clipped: shown && (r.bottom > window.innerHeight + 1 || r.right > window.innerWidth + 1 || r.top < -1 || r.left < -1)});
      }
      return out;
    }""")


def image_map(out: Path, row: dict, views: list[str]) -> list[tuple[str, str]]:
    found = []
    poses = row.get("poses") or {}
    if poses:
        for pose, info in poses.items():
            if info.get("status") != "ok":
                continue
            for view in views:
                rel = f"{row['folder']}/{pose}/{view}.png"
                if (out / rel).exists():
                    found.append((f"{pose}/{view}", rel))
        return found
    for view in views:
        rel = f"{row['folder']}/{view}.png"
        if (out / rel).exists():
            found.append((view, rel))
    return found


def report(out: Path, rows: list[dict], views: list[str], issues: list[dict] | None = None) -> None:
    issues = rank_issues(issues or [])
    total = len(rows)
    passed = sum(row["status"] == "ok" for row in rows)
    summary = summarize(rows, issues)
    lines = [
        "# Wardrobe visual audit",
        "",
        f"Captured: {passed}/{total} entries. Failed: {sum(row['status'] == 'error' for row in rows)}. "
        f"Not captured: {sum(row['status'] == 'not-captured' for row in rows)}.",
        "",
        f"Pose slots with screenshots: {summary['poseSlotsCaptured']}/{summary['poseSlotsExpected']}.",
        f"Release ready: {'yes' if summary['releaseReady'] else 'no'}.",
        "",
        "A changed screenshot is a review item, not an automatic defect. "
        "Penetration and span-drop numbers come from the pose cloth correction.",
        "",
        "| Source | Garment / look | Status | Failure | Description | Images |",
        "|---|---|---|---|---|---|",
    ]
    tiles = []
    for row in rows:
        name = row["name"]
        status = row["status"]
        desc = row.get("description", "") if status == "ok" else row.get("error") or row.get("reason") or ""
        shots = image_map(out, row, views)
        links = " ".join(f"[{label}]({rel})" for label, rel in shots)
        safe = lambda s: str(s).replace("|", "\\|").replace("\n", " ")
        lines.append(
            f"| {safe(row.get('source', ''))} | {safe(name)} | {status} | {safe(row.get('failureClass', ''))} | {safe(desc)} | {links} |"
        )
        figures = "".join(
            f'<figure><img loading="lazy" src="{html.escape(rel, quote=True)}" alt="{html.escape(name + " " + label, quote=True)}"><figcaption>{html.escape(label)}</figcaption></figure>'
            for label, rel in shots
        )
        tiles.append(
            f"<section><h2>{html.escape(str(name))}</h2><p>{html.escape(str(row.get('source', '')))} · {html.escape(status)} · {html.escape(str(desc))}</p><div class=\"shots\">{figures}</div></section>"
        )
    if issues:
        lines += ["", "## Issues", "", "| Id | Severity | Status | Garment | Pose | Actual |", "|---|---|---|---|---|---|"]
        for issue in issues:
            lines.append(
                f"| {issue.get('id', '')} | {issue.get('severity', '')} | {issue.get('status', '')} | "
                f"{str(issue.get('garmentName', '')).replace('|', '/')} | {issue.get('pose', '')} | "
                f"{str(issue.get('actual', '')).replace('|', '/').replace(chr(10), ' ')} |"
            )
    (out / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    blocker = ", ".join(summary["releaseBlockers"]) or "none"
    (out / "report.html").write_text(
        '<!doctype html><html lang="en"><meta charset="utf-8"><title>Wardrobe QA</title>'
        "<style>body{font:16px system-ui;background:#10151d;color:#e6f3f7;margin:28px}"
        ".shots{display:flex;gap:12px;overflow-x:auto}figure{margin:0;min-width:240px}"
        "img{max-width:360px;width:100%;border:1px solid #455566}section{border-bottom:1px solid #3b4a56;padding:22px 0}"
        "figcaption{padding:6px}</style><h1>Wardrobe QA</h1>"
        f"<p>Captured {passed} of {total} entries. Release blockers: {html.escape(blocker)}.</p>"
        + "".join(tiles)
        + "</html>",
        encoding="utf-8",
    )
    save_json(out / "summary.json", summary)


def compare_baseline(out: Path, rows: list[dict], baseline: Path, views: list[str], threshold: float) -> list[dict]:
    findings = []
    if not baseline:
        return findings
    for row in rows:
        if row.get("status") != "ok":
            continue
        for _label, rel in image_map(out, row, views):
            current = out / rel
            previous = baseline / rel
            if not previous.exists():
                continue
            delta = image_delta(previous, current)
            if delta["meanAbs"] <= threshold:
                continue
            finding = visual_issue(row["id"], row["name"], "", _label, delta, threshold)
            finding["evidence"] = [rel, str(previous)]
            findings.append(finding)
    return findings


def unsupported_poses() -> dict:
    return {pose: {"status": "unsupported", "reason": reason} for pose, reason in UNSUPPORTED_POSES.items()}


def metric_findings(entry: dict) -> list[dict]:
    """Gate misses stored on a captured entry. --resume must rebuild these, because
    the fresh-capture loop is the only other place that appends them."""
    found = []
    poses = entry.get("poses") or {}
    if not isinstance(poses, dict):
        return found
    for pose_id, captured in poses.items():
        if not isinstance(captured, dict):
            continue
        for finding in (captured.get("gate") or {}).get("issues") or []:
            found.append(
                metric_issue(
                    entry.get("id") or "",
                    entry.get("name") or "",
                    entry.get("category") or "",
                    pose_id,
                    finding,
                )
            )
    return found


def entry_complete(out: Path, entry: dict, views: list[str], poses: list[str]) -> bool:
    if entry.get("status") != "ok":
        return False
    recorded = entry.get("poses") or {}
    for pose in poses:
        info = recorded.get(pose) or {}
        if info.get("status") != "ok":
            return False
        for view in views:
            if not (out / entry.get("folder", "") / pose / f"{view}.png").exists():
                return False
    return True


def fetch_catalog(forge_url: str, timeout: int = 60) -> dict:
    url = forge_url.rstrip("/") + "/v1/catalog/garments"
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def catalog_garments(payload: dict) -> list[dict]:
    garments = []
    for category in payload.get("categories") or []:
        label = category.get("label") or category.get("id") or ""
        for garment in category.get("garments") or []:
            garments.append(
                {
                    "id": garment.get("id") or "",
                    "name": garment.get("name") or "",
                    "category": label,
                    "categoryId": category.get("id") or "",
                    "description": garment.get("description") or "",
                    "hem": garment.get("hem") or "",
                    "silhouette": garment.get("silhouette") or "",
                    "previewStatus": garment.get("previewStatus") or "",
                    "previewUrl": garment.get("previewUrl") or "",
                }
            )
    return garments


def matching_items(items: list[dict], only: str | None = None, key: str | None = None, key_field: str = "key") -> list[dict]:
    """Filter a rail or a catalog. An exact name wins over a substring.

    `--only Pencil` matches every name that contains it, so Grey Pencil Skirt
    is selected ahead of Black Pencil Mini Skirt. An exact name, or `--look-key`,
    is how a retest stays on the same outfit.
    """
    chosen = list(items)
    if key:
        chosen = [item for item in chosen if item.get(key_field) == key]
    if only:
        needle = only.lower()
        exact = [item for item in chosen if (item.get("name") or "").lower() == needle]
        chosen = exact or [item for item in chosen if needle in (item.get("name") or "").lower()]
    return chosen


def inventory_rows(garments: list[dict]) -> tuple[list[dict], list[dict]]:
    rows = []
    issues = known_issue_records()
    for garment in garments:
        poses = {pose: {"status": "not-captured", "reason": "inventory-only; no browser capture"} for pose in POSES}
        poses.update(unsupported_poses())
        rows.append(
            {
                "id": f"garment-{slug(garment['id'] or garment['name'])}",
                "source": "catalog",
                "name": garment["name"],
                "garmentId": garment["id"],
                "folder": f"screenshots/{slug(garment['id'] or garment['name'])}",
                "category": garment["category"],
                "description": garment["description"],
                "status": "not-captured",
                "reason": "Catalog enumerated. Garment was not applied and no screenshot was taken.",
                "previewStatus": garment["previewStatus"],
                "poses": poses,
            }
        )
        if garment["previewStatus"] != "ready" or not garment["previewUrl"]:
            issues.append(preview_issue(garment["category"], garment["id"], garment["name"], garment["previewStatus"]))
    return rows, rank_issues(issues)


def write_readiness(out: Path, summary: dict, note: str) -> None:
    blockers = summary.get("releaseBlockers") or []
    lines = [
        "# Wardrobe release readiness",
        "",
        note,
        "",
        f"- Entries: {summary.get('entries', 0)}",
        f"- By status: {json.dumps(summary.get('byStatus') or {}, sort_keys=True)}",
        f"- Pose slots captured: {summary.get('poseSlotsCaptured', 0)} / {summary.get('poseSlotsExpected', 0)} "
        f"(accounted, including documented unsupported poses: {summary.get('poseSlotsAccounted', 0)})",
        f"- Issues: {summary.get('issues', 0)} by severity {json.dumps(summary.get('bySeverity') or {}, sort_keys=True)}",
        f"- Release blockers: {', '.join(blockers) if blockers else 'none'}",
        f"- Recommendation: {'release-ready' if summary.get('releaseReady') else 'not release-ready'}",
        "",
        "A mechanism-corrected defect stays a blocker until a live capture of the same avatar, pose and camera shows it gone.",
        "",
    ]
    (out / "READINESS.md").write_text("\n".join(lines), encoding="utf-8")


def run_inventory(opts, out: Path) -> int:
    forge = opts.forge_url or DEFAULT_FORGE
    try:
        payload = fetch_catalog(forge)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        save_json(out / "fatal-error.json", {"error": f"{type(exc).__name__}: {exc}", "failureClass": "infrastructure"})
        print(f"FATAL: {exc}", file=sys.stderr)
        return 2
    garments = catalog_garments(payload)
    rows, issues = inventory_rows(garments)
    save_json(
        out / "inventory.json",
        {
            "forge": forge,
            "fetchedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "schemaVersion": payload.get("schemaVersion"),
            "totalTemplates": payload.get("totalTemplates"),
            "visibleCount": payload.get("visibleCount"),
            "previewCount": payload.get("previewCount"),
            "garments": garments,
            "unsupportedPoses": UNSUPPORTED_POSES,
            "cameraMethod": CAMERA_METHOD,
            "capture": "not-run",
        },
    )
    save_json(out / "manifest.json", {"mode": "inventory-only", "pose": list(POSES), "views": list(CANONICAL_VIEWS), "entries": rows})
    save_json(out / "issues.json", {"issues": issues})
    report(out, rows, list(CANONICAL_VIEWS), issues)
    summary = summarize(rows, issues)
    write_readiness(
        out,
        summary,
        f"Live catalog {forge} returned {len(garments)} public garments "
        f"({payload.get('visibleCount')} visible, {payload.get('previewCount')} previews). "
        "No garment was applied and no screenshot was taken.",
    )
    print(f"Wrote inventory of {len(garments)} garments to {out}")
    return 0


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://localhost:8080/", help="Avatar app origin")
    parser.add_argument("--forge-url", help="Forge origin. Inventory default is the public Space.")
    parser.add_argument("--avatar", help="Optional bundled avatar file, e.g. fem_vroid.vrm")
    parser.add_argument("--source", choices=("looks", "catalog", "both"), default="both")
    parser.add_argument("--out", type=Path, help="Output directory; default UTC-stamped runs/<id>")
    parser.add_argument("--size", default="1440x900", help="Browser viewport WIDTHxHEIGHT")
    parser.add_argument("--views", default="front,right,back,left", help="Comma-separated camera names")
    parser.add_argument("--poses", default="standing,sittingDesk,sittingWide,sittingCrossed")
    parser.add_argument("--color", choices=("black", "white", "red", "blue", "beige"), default="black")
    parser.add_argument("--max-items", type=int, default=0, help="0=all, otherwise first N per source")
    parser.add_argument("--load-timeout", type=int, default=180, help="Avatar and look load, seconds")
    parser.add_argument("--generate-timeout", type=int, default=360, help="Each Forge job, seconds")
    parser.add_argument("--cloth-timeout", type=int, default=30, help="Seconds to wait for cloth correction")
    parser.add_argument("--settle-ms", type=int, default=400, help="Render stabilization per image, after cloth is ready")
    parser.add_argument("--delay", type=float, default=2.0, help="Pause between Forge jobs, seconds")
    parser.add_argument("--resume", action="store_true", help="Skip completed entries in --out")
    parser.add_argument("--headful", action="store_true")
    parser.add_argument("--only", help="Capture only entries whose name contains this text. An exact name wins.")
    parser.add_argument("--skip", default="", help="Comma-separated names to leave uncaptured. An exact name matches.")
    parser.add_argument("--look-key", help="Capture only the Try-On look with this data-look-key")
    parser.add_argument("--cloth", choices=("on", "off"), default="on", help="off photographs skinning before the correction")
    parser.add_argument("--inventory-only", action="store_true", help="Fetch the live catalog and do not generate or capture")
    parser.add_argument("--mobile-ui", action="store_true", help="Also record stage-control hit targets at 390x844")
    parser.add_argument("--baseline", type=Path, help="Previous run directory for pixel comparison")
    parser.add_argument("--diff-threshold", type=float, default=0.02, help="Mean absolute difference above this is a review item")
    options = parser.parse_args(argv)
    options.views = [v.strip() for v in options.views.split(",") if v.strip()]
    options.poses = [p.strip() for p in options.poses.split(",") if p.strip()]
    if not options.views or any(v not in VIEWS for v in options.views):
        parser.error("--views must be chosen from " + ", ".join(VIEWS))
    if not options.poses or any(p not in POSES for p in options.poses):
        parser.error("--poses must be chosen from " + ", ".join(POSES))
    if not re.fullmatch(r"[1-9][0-9]*x[1-9][0-9]*", options.size):
        parser.error("--size must be WIDTHxHEIGHT")
    options.skip = {part.strip() for part in options.skip.split(",") if part.strip()}
    if options.max_items < 0 or options.delay < 0 or options.diff_threshold < 0:
        parser.error("--max-items, --delay and --diff-threshold must be non-negative")
    return options


def playwright_browser(opts, width: int, height: int, mobile: bool = False):
    from playwright.sync_api import sync_playwright

    controller = sync_playwright().start()
    import os

    browser = controller.chromium.launch(
        headless=not opts.headful,
        executable_path=os.getenv("PLAYWRIGHT_CHROMIUM") or None,
        args=GL_ARGS,
    )
    kwargs = {
        "viewport": {"width": width, "height": height},
        "device_scale_factor": 2 if mobile else 1,
        "ignore_https_errors": True,
        "is_mobile": mobile,
        "has_touch": mobile,
    }
    if mobile:
        kwargs["user_agent"] = (
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
            "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
        )
    context = browser.new_context(**kwargs)
    return controller, browser, context


def main(argv=None) -> int:
    opts = parse_args(argv)
    out = opts.out or Path(__file__).parent / "runs" / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out.mkdir(parents=True, exist_ok=True)
    if opts.inventory_only:
        return run_inventory(opts, out)
    previous = {}
    if opts.resume and (out / "manifest.json").exists():
        previous = {r["id"]: r for r in json.loads((out / "manifest.json").read_text())["entries"]}
    entries = []
    errors = []
    issues = known_issue_records()
    width, height = map(int, opts.size.split("x"))

    def persist():
        save_json(
            out / "manifest.json",
            {
                "url": opts.url,
                "poses": opts.poses,
                "unsupportedPoses": UNSUPPORTED_POSES,
                "views": opts.views,
                "cameraMethod": CAMERA_METHOD,
                "viewport": opts.size,
                "entries": entries,
            },
        )
        save_json(out / "issues.json", {"issues": rank_issues(issues)})
        report(out, entries, opts.views, issues)

    def record(entry: dict):
        entries.append(entry)
        persist()

    controller = browser = None
    try:
        controller, browser, context = playwright_browser(opts, width, height)
        context.add_init_script(context_init_script(opts))
        page = context.new_page()
        page.audit_url = opts.url
        if opts.cloth == "off":
            page.add_init_script("window.NEXUS_POSE_CLOTH_ENABLED = false;")
        page.on("pageerror", lambda error: errors.append({"type": "javascript", "message": str(error)}))
        page.on(
            "response",
            lambda response: errors.append({"type": "http", "status": response.status, "url": response.url})
            if response.status >= 400
            else None,
        )
        open_try_on(page, opts.load_timeout)
        remember_camera(page)
        if opts.mobile_ui:
            record_ui(page, out, "ui-desktop", opts.size, issues)
            mobile_context = browser.new_context(
                viewport={"width": 390, "height": 844},
                device_scale_factor=2,
                is_mobile=True,
                has_touch=True,
                user_agent=(
                    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
                    "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
                ),
            )
            mobile_context.add_init_script(context_init_script(opts))
            mobile_page = mobile_context.new_page()
            mobile_page.audit_url = opts.url
            try:
                open_try_on(mobile_page, opts.load_timeout)
                record_ui(mobile_page, out, "ui-mobile", "390x844", issues)
            finally:
                mobile_context.close()
        looks = rail_looks(page)
        if not looks:
            raise RuntimeError("No available outfits in the Try-On rail")
        baseline = looks[0]
        inventory = []
        if opts.source in ("catalog", "both"):
            inventory = catalog_items(page, opts.load_timeout)
            if not inventory:
                raise RuntimeError("Forge catalog returned no garments")
        save_json(out / "inventory.json", {"looks": looks, "garments": inventory, "cameraMethod": CAMERA_METHOD})
        looks = matching_items(looks, opts.only, opts.look_key)
        inventory = matching_items(inventory, opts.only)
        queue = []
        if opts.source in ("looks", "both"):
            queue.extend(("looks", item) for item in looks[: opts.max_items or None])
        if opts.source in ("catalog", "both"):
            queue.extend(("catalog", item) for item in inventory[: opts.max_items or None])
        if not queue:
            raise RuntimeError(f"No look or garment matches {opts.only!r}" if opts.only else "Nothing to capture")
        for index, (source, item) in enumerate(queue, 1):
            name = item["name"]
            entry_id = (
                f"look-{slug(item['key'])}"
                if source == "looks"
                else f"garment-{item['category_index']:02d}-{item['item_index']:02d}-{slug(name)}"
            )
            folder = f"screenshots/{source}/{entry_id}"
            path = out / folder
            path.mkdir(parents=True, exist_ok=True)
            if name in opts.skip:
                print(f"[{index}/{len(queue)}] SKIP {source}: {name} (--skip)", flush=True)
                record(
                    {
                        "id": entry_id,
                        "source": source,
                        "name": name,
                        "folder": folder,
                        "category": item.get("category", ""),
                        "status": "not-captured",
                        "reason": "Named in --skip. The cloth correction on this mesh did not finish in a still capture.",
                        "poses": unsupported_poses(),
                    }
                )
                continue
            if opts.resume and entry_complete(out, previous.get(entry_id, {}), opts.views, opts.poses):
                print(f"[{index}/{len(queue)}] SKIP {source}: {name}", flush=True)
                restored = previous[entry_id]
                record(restored)
                issues.extend(metric_findings(restored))
                continue
            start_errors = len(errors)
            entry = {
                "id": entry_id,
                "source": source,
                "name": name,
                "folder": folder,
                "category": item.get("category", ""),
                "status": "error",
                "poses": unsupported_poses(),
            }
            print(f"[{index}/{len(queue)}] {source}: {name}", flush=True)
            phase = "apply"
            try:
                if source == "looks":
                    wear_look(page, item, opts.load_timeout)
                else:
                    wear_look(page, baseline, opts.load_timeout)
                    phase = "generation"
                    apply_catalog_item(page, item, opts.generate_timeout, opts.color, path)
                for pose_id in opts.poses:
                    phase = "pose"
                    captured = capture_pose(page, path, pose_id, opts.views, opts.settle_ms, opts.cloth_timeout)
                    entry["poses"][pose_id] = captured
                    issues.extend(metric_findings({**entry, "poses": {pose_id: captured}}))
                entry["description"] = state(page)["description"] or name
                entry["lookKey"] = state(page)["lookKey"]
                entry["status"] = "ok"
            except Exception as exc:
                entry["error"] = f"{type(exc).__name__}: {exc}"
                entry["failureClass"] = classify_failure(entry["error"], phase)
                try:
                    page.screenshot(path=str(path / "failure-ui.png"), timeout=10000)
                except Exception:
                    pass
                print(f"  ERROR ({entry['failureClass']}): {entry['error']}", file=sys.stderr, flush=True)
                try:
                    close = page.locator(".nexus-catalog-header button")
                    if close.count() and close.first.is_enabled():
                        close.first.click(timeout=5000)
                except Exception:
                    pass
                # A cloth job that never reports can leave the worker busy, and every later
                # garment then waits out the same timeout. Reload so the next one starts clean.
                if entry["failureClass"] == "infrastructure":
                    try:
                        open_try_on(page, opts.load_timeout)
                        remember_camera(page)
                        print("  reloaded Try-On after the timeout", flush=True)
                    except Exception as recover_error:
                        print(f"  reload failed: {recover_error}", file=sys.stderr, flush=True)
            entry["browserErrors"] = errors[start_errors:]
            record(entry)
            if source == "catalog":
                time.sleep(opts.delay)
        if opts.baseline:
            issues.extend(compare_baseline(out, entries, opts.baseline, opts.views, opts.diff_threshold))
            persist()
    except Exception as exc:
        fatal = {"error": f"{type(exc).__name__}: {exc}", "failureClass": classify_failure(str(exc), "startup"), "browserErrors": errors}
        save_json(out / "fatal-error.json", fatal)
        print(f"FATAL: {fatal['error']}", file=sys.stderr, flush=True)
        return 2
    finally:
        save_json(out / "browser-errors.json", errors)
        if browser:
            browser.close()
        if controller:
            controller.stop()
    summary = summarize(entries, rank_issues(issues))
    save_json(out / "issues.json", {"issues": rank_issues(issues)})
    write_readiness(out, summary, "Browser capture finished. Counts below are this run only.")
    report(out, entries, opts.views, issues)
    ok = sum(entry["status"] == "ok" for entry in entries)
    print(f"Wrote audit to {out} (successful {ok}/{len(entries)})")
    if any(entry["status"] != "ok" for entry in entries):
        return 1
    return 0


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).parent))
    sys.exit(main())
