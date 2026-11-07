#!/usr/bin/env python3
"""Evidence-first, serial Playwright audit of Try-On looks and Forge garments.

Requires the 3D-Avatar-Chatbot app, with a WebGL-capable Chromium, to be running.
No screenshot is marked successful unless the intended look and sittingDesk pose land.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import html
import json
import re
import sys
import time
from pathlib import Path

from playwright.sync_api import TimeoutError as PlaywrightTimeout
from playwright.sync_api import sync_playwright

VIEWS = {"front": 0, "side": 90, "back": 180, "opposite-side": -90}
GL_ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]


def slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")[:70] or "unnamed"


def save_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def state(page) -> dict:
    return page.evaluate("""() => {
      const t = s => document.querySelector(s)?.textContent?.trim() || '';
      const chosen = document.querySelector('.nexus-look-rail-item[aria-pressed="true"]');
      const pose = window.vrPoseSystem;
      const viewer = window.NEXUS_VIEWER;
      return {name:t('.nexus-stage-look-name'), description:t('.nexus-stage-look-desc'),
        count:t('.nexus-stage-count'), lookKey:chosen?.getAttribute('data-look-key') || '',
        pose:pose?.getCurrentPreset?.() || '',
        avatarReady:!!viewer?.avatarManager?.currentRoot,
        cameraReady:!!viewer?.camera && !!viewer?.controls,
        canvas:!!document.querySelector('.avatar-preview-wrap canvas'),
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
    rail = page.locator('.nexus-look-rail-item')
    index = next((i for i in range(rail.count())
                  if rail.nth(i).get_attribute('data-look-key') == look['key']), None)
    if index is None:
        raise RuntimeError(f"Look disappeared from rail: {look['name']}")
    target = rail.nth(index)
    target.click(timeout=timeout * 1000)
    page.wait_for_function("""key => {
      const current=document.querySelector('.nexus-look-rail-item[aria-pressed="true"]');
      return !!window.NEXUS_VIEWER?.avatarManager?.currentRoot && current?.getAttribute('data-look-key')===key;
    }""", arg=look["key"], timeout=timeout * 1000)
    page.wait_for_timeout(800)


def open_catalog(page, timeout: int) -> None:
    if page.locator(".nexus-catalog-overlay").count():
        return
    if page.locator(".nexus-try-on-look-rail.is-folded").count():
        page.locator(".nexus-look-rail-title").click()
    page.locator(".nexus-look-rail-edit").click()
    page.locator(".nexus-catalog-overlay").wait_for(state="visible", timeout=timeout * 1000)
    page.wait_for_function("""() => !!document.querySelector('.nexus-catalog-cats button') ||
      !!document.querySelector('.nexus-catalog-error')""", timeout=timeout * 1000)
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
            items.append({"category": label, "category_index": cat_index,
                          "item_index": item_index, **entry})
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
    page.wait_for_function("""() => !document.querySelector('.nexus-catalog-overlay') ||
       !!document.querySelector('.nexus-catalog-error')""", timeout=timeout * 1000)
    error = page.locator(".nexus-catalog-error")
    if error.count() and error.first.inner_text().strip():
        raise RuntimeError(error.first.inner_text().strip())
    ready(page, timeout)
    page.wait_for_function("""previous => {
      const active=document.querySelector('.nexus-look-rail-item[aria-pressed="true"]');
      return !!active && active.getAttribute('data-look-key') !== previous;
    }""", arg=previous_key, timeout=timeout * 1000)
    page.wait_for_timeout(1000)


def apply_sitting_desk(page) -> None:
    result = page.evaluate("""() => {
      const p = window.vrPoseSystem;
      if (!p || typeof p.applyPreset !== 'function' || typeof p.getCurrentPreset !== 'function')
        return {ok:false, error:'vrPoseSystem is unavailable'};
      p.claimBones?.();
      p.applyPreset('sittingDesk', 0);
      return {ok:p.getCurrentPreset()==='sittingDesk', current:p.getCurrentPreset()};
    }""")
    if not result.get("ok"):
        raise RuntimeError(f"Sitting (Desk) did not apply: {result}")


def remember_camera(page) -> None:
    ok = page.evaluate("""() => {
      const v=window.NEXUS_VIEWER;
      if (!v?.camera?.position || !v?.controls?.target) return false;
      window.__wardrobeAuditCamera={position:v.camera.position.toArray(),
        target:v.controls.target.toArray()}; return true;
    }""")
    if not ok:
        raise RuntimeError("Cannot capture baseline camera")


def camera_view(page, degrees: int) -> None:
    result = page.evaluate("""degrees => {
      const v=window.NEXUS_VIEWER, base=window.__wardrobeAuditCamera;
      if (!v?.camera || !v?.controls || !base) return false;
      const [x,y,z]=base.position, [tx,ty,tz]=base.target;
      const dx=x-tx, dz=z-tz, angle=degrees*Math.PI/180;
      v.controls.target.set(tx,ty,tz);
      v.camera.position.set(tx+dx*Math.cos(angle)+dz*Math.sin(angle), y,
        tz+dz*Math.cos(angle)-dx*Math.sin(angle));
      v.controls.update(); return true;
    }""", degrees)
    if not result:
        raise RuntimeError("Cannot orient camera for requested view")


def capture_views(page, folder: Path, views: list[str], settle_ms: int) -> dict:
    apply_sitting_desk(page)
    remember_camera(page)
    results = {}
    for view in views:
        camera_view(page, VIEWS[view])
        page.wait_for_timeout(settle_ms)
        current = state(page)
        if current["pose"] != "sittingDesk" or not current["avatarReady"] or not current["canvas"]:
            raise RuntimeError(f"Avatar/pose not ready during {view}: {current}")
        page.screenshot(path=str(folder / f"{view}.png"), animations="disabled")
        results[view] = {"image": f"{view}.png", "look": current["name"],
                         "description": current["description"], "pose": current["pose"]}
    camera_view(page, 0)
    return results


def report(out: Path, rows: list[dict], views: list[str]) -> None:
    total = len(rows)
    passed = sum(row["status"] == "ok" for row in rows)
    lines = ["# Wardrobe Sitting (Desk) visual audit", "",
             f"Captured: {passed}/{total} entries. Failed: {total-passed}.", "",
             "Review the screenshots for garment/body penetration, exposed foundation,",
             "unexpected fabric patches, missing meshes, wrong item labels,",
             "camera framing, clipping and UI occlusion. These are human-review prompts,",
             "not automatically confirmed defects.", "",
             "| Source | Garment / look | Status | Description | Images |", "|---|---|---|---|---|"]
    tiles = []
    for r in rows:
        name = r["name"]
        folder = r["folder"]
        status = r["status"]
        desc = r.get("description", "") if status == "ok" else r.get("error", "")
        rel = lambda v: f"{folder}/{v}.png"
        links = " ".join(f"[{v}]({rel(v)})" for v in views if (out / rel(v)).exists())
        safe = lambda s: str(s).replace("|", "\\|").replace("\n", " ")
        lines.append(f"| {safe(r['source'])} | {safe(name)} | {status} | {safe(desc)} | {links} |")
        shots = "".join(f'<figure><img loading="lazy" src="{html.escape(rel(v), quote=True)}" alt="{html.escape(name + " " + v, quote=True)}"><figcaption>{html.escape(v)}</figcaption></figure>'
                        for v in views if (out / rel(v)).exists())
        tiles.append(f'<section><h2>{html.escape(name)}</h2><p>{html.escape(r["source"])} · {html.escape(status)} · {html.escape(desc)}</p><div class="shots">{shots}</div></section>')
    (out / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (out / "report.html").write_text(
        '<!doctype html><html lang="en"><meta charset="utf-8"><title>Wardrobe QA</title>'
        '<style>body{font:16px system-ui;background:#10151d;color:#e6f3f7;margin:28px}'
        '.shots{display:flex;gap:12px;overflow-x:auto}figure{margin:0;min-width:240px}'
        'img{max-width:360px;width:100%;border:1px solid #455566}section{border-bottom:1px solid #3b4a56;padding:22px 0}'
        'figcaption{padding:6px}</style><h1>Sitting (Desk) wardrobe QA</h1>'
        f'<p>Captured {passed} of {total} entries. Review all angles manually.</p>' + "".join(tiles) + "</html>",
        encoding="utf-8",
    )


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://localhost:8080/", help="Avatar app origin")
    parser.add_argument("--forge-url", help="Override Forge endpoint (default: app configuration)")
    parser.add_argument("--avatar", help="Optional bundled avatar file, e.g. fem_vroid.vrm")
    parser.add_argument("--source", choices=("looks", "catalog", "both"), default="both")
    parser.add_argument("--out", type=Path, help="Output directory; default UTC-stamped runs/<id>")
    parser.add_argument("--size", default="1440x900", help="Browser viewport WIDTHxHEIGHT")
    parser.add_argument("--views", default="front,side,back", help="Comma-separated front,side,back,opposite-side")
    parser.add_argument("--color", choices=("black", "white", "red", "blue", "beige"), default="black")
    parser.add_argument("--max-items", type=int, default=0, help="0=all, otherwise first N per source")
    parser.add_argument("--load-timeout", type=int, default=180, help="Avatar and look load, seconds")
    parser.add_argument("--generate-timeout", type=int, default=360, help="Each Forge job, seconds")
    parser.add_argument("--settle-ms", type=int, default=1500, help="Render stabilization per image")
    parser.add_argument("--delay", type=float, default=2.0, help="Pause between Forge jobs, seconds")
    parser.add_argument("--resume", action="store_true", help="Skip completed entries in --out")
    parser.add_argument("--headful", action="store_true")
    options = parser.parse_args()
    options.views = [v.strip() for v in options.views.split(",") if v.strip()]
    if not options.views or any(v not in VIEWS for v in options.views):
        parser.error("--views must include front,side,back or opposite-side")
    if not re.fullmatch(r"[1-9][0-9]*x[1-9][0-9]*", options.size):
        parser.error("--size must be WIDTHxHEIGHT")
    if options.max_items < 0 or options.delay < 0:
        parser.error("--max-items and --delay must be non-negative")
    return options


def main() -> int:
    opts = parse_args()
    out = opts.out or Path(__file__).parent / "runs" / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out.mkdir(parents=True, exist_ok=True)
    previous = {}
    if opts.resume and (out / "manifest.json").exists():
        previous = {r["id"]: r for r in json.loads((out / "manifest.json").read_text())["entries"]}
    entries = []
    errors = []
    width, height = map(int, opts.size.split("x"))

    def record(entry: dict):
        entries.append(entry)
        save_json(out / "manifest.json", {"url": opts.url, "pose": "sittingDesk", "views": opts.views,
                                          "viewport": opts.size, "entries": entries})
        report(out, entries, opts.views)

    def should_skip(entry_id: str) -> bool:
        old = previous.get(entry_id, {})
        return old.get("status") == "ok" and all((out / old.get("folder", "") / f"{v}.png").exists() for v in opts.views)

    with sync_playwright() as playwright:
        import os
        browser = playwright.chromium.launch(headless=not opts.headful,
                                             executable_path=os.getenv("PLAYWRIGHT_CHROMIUM") or None,
                                             args=GL_ARGS)
        context = browser.new_context(viewport={"width": width, "height": height},
                                      device_scale_factor=1, ignore_https_errors=True)
        if opts.forge_url or opts.avatar:
            cfg = json.dumps({"forge": opts.forge_url, "avatar": opts.avatar})
            context.add_init_script("""(() => {
              const {forge,avatar} = """ + cfg + """;
              if (forge) {localStorage.setItem('wardrobe_forge_mode','custom'); localStorage.setItem('wardrobe_forge_url',forge);}
              if (avatar) localStorage.setItem('nexus_selected_avatar_file',avatar);
            })();""")
        page = context.new_page()
        page.audit_url = opts.url
        page.on("pageerror", lambda error: errors.append({"type": "javascript", "message": str(error)}))
        page.on("response", lambda response: errors.append({"type": "http", "status": response.status,
                                                            "url": response.url}) if response.status >= 400 else None)
        try:
            open_try_on(page, opts.load_timeout)
            looks = rail_looks(page)
            if not looks:
                raise RuntimeError("No available outfits in the Try-On rail")
            baseline = looks[0]
            inventory = []
            if opts.source in ("catalog", "both"):
                inventory = catalog_items(page, opts.load_timeout)
                if not inventory:
                    raise RuntimeError("Forge catalog returned no garments")
            save_json(out / "inventory.json", {"looks": looks, "garments": inventory})
            queue = []
            if opts.source in ("looks", "both"):
                for item in looks[:opts.max_items or None]:
                    queue.append(("looks", item))
            if opts.source in ("catalog", "both"):
                for item in inventory[:opts.max_items or None]:
                    queue.append(("catalog", item))
            for index, (source, item) in enumerate(queue, 1):
                name = item["name"]
                entry_id = (f"look-{slug(item['key'])}" if source == "looks" else
                            f"garment-{item['category_index']:02d}-{item['item_index']:02d}-{slug(name)}")
                folder = f"{source}/{entry_id}"
                path = out / folder
                path.mkdir(parents=True, exist_ok=True)
                if should_skip(entry_id):
                    entry = previous[entry_id]
                    print(f"[{index}/{len(queue)}] SKIP {source}: {name}", flush=True)
                    record(entry)
                    continue
                start_errors = len(errors)
                entry = {"id": entry_id, "source": source, "name": name, "folder": folder,
                         "category": item.get("category", ""), "status": "error"}
                print(f"[{index}/{len(queue)}] {source}: {name}", flush=True)
                try:
                    if source == "looks":
                        wear_look(page, item, opts.load_timeout)
                    else:
                        # Avoid a cumulative outfit: return to the same shipped baseline before each garment.
                        wear_look(page, baseline, opts.load_timeout)
                        apply_catalog_item(page, item, opts.generate_timeout, opts.color, path)
                    entry["images"] = capture_views(page, path, opts.views, opts.settle_ms)
                    entry["description"] = state(page)["description"] or name
                    entry["lookKey"] = state(page)["lookKey"]
                    entry["status"] = "ok"
                except Exception as exc:
                    entry["error"] = f"{type(exc).__name__}: {exc}"
                    try:
                        page.screenshot(path=str(path / "failure-ui.png"), timeout=10000)
                    except Exception:
                        pass
                    print(f"  ERROR: {entry['error']}", file=sys.stderr, flush=True)
                    # A failed Forge job leaves the modal open; clear it for the next item.
                    try:
                        close = page.locator(".nexus-catalog-header button")
                        if close.count() and close.first.is_enabled():
                            close.first.click(timeout=5000)
                    except Exception:
                        pass
                entry["browserErrors"] = errors[start_errors:]
                record(entry)
                if source == "catalog":
                    time.sleep(opts.delay)
        finally:
            save_json(out / "browser-errors.json", errors)
            browser.close()
    print(f"Wrote audit to {out} (successful {sum(e['status']=='ok' for e in entries)}/{len(entries)})")
    return 1 if any(e["status"] != "ok" for e in entries) else 0


if __name__ == "__main__":
    sys.exit(main())