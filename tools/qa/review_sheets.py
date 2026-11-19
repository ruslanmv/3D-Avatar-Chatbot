#!/usr/bin/env python3
"""
VA5 / LM5. Review sheets from the motion tools' frames: what a person looks at, not the numbers.

    python3 tools/qa/review_sheets.py pair <ref run> <target run> [--out pair.png]
    python3 tools/qa/review_sheets.py compare <living-motion-compare out dir>
    python3 tools/qa/review_sheets.py gallery <motion-gallery out dir> [animation review runs ...]

pair     Two `audits/animations/run.mjs` runs of the same clip(s): the reference (an outside clip
         on its own rig, `--avatar-file`) and hers (`--avatars`). One block per clip: the
         reference's frames in the top row, hers below, the same instants in the same columns —
         so a wrong elbow, a lost arch or a different timing is seen at a glance.

compare  The folders `tools/qa/living-motion-compare.mjs` writes (one per scenario): a sheet per
         scenario (the held preset over the layered frame, per view, per instant), a playback GIF
         at 10 fps, and a plot of the pelvis, spine, chest and head angles off the held pose over
         six seconds (+ is backwards: arching, head back).

gallery  GIFs and one index.html of every motion we support, grouped by how it was made: the
         frames `tools/qa/motion-gallery.mjs` writes (presets, transition, shows, living layer)
         plus any `audits/animations/run.mjs` runs (the CC0 dances, the clip library).

Needs Pillow only (the system python3 has it). Output goes beside the input, under
`audits/*/runs/` — gitignored; frames of Private poses are never committed.
"""
import argparse
import glob
import json
import os
import re

from PIL import Image, ImageDraw


# ------------------------------------------------------------------------------------------ pair
def shots_by_clip(run):
    """{clip key: [frame paths in order]} from a run's `shots/`, the avatar prefix taken off."""
    out = {}
    for p in sorted(glob.glob(os.path.join(run, "shots", "*.jpg")) + glob.glob(os.path.join(run, "shots", "*.png"))):
        name = os.path.basename(p)
        m = re.match(r"^[^-]+-(.*)-(\d+)\.(jpg|png)$", name)
        if not m:
            continue
        out.setdefault(m.group(1), []).append((int(m.group(2)), p))
    return {k: [p for _, p in sorted(v)] for k, v in out.items()}


def pair(ref, target, out, height):
    a, b = shots_by_clip(ref), shots_by_clip(target)
    keys = [k for k in a if k in b] or ([next(iter(a))] if a and len(b) == 1 else [])
    if not keys and len(a) == 1 and len(b) == 1:
        keys = [None]
    blocks = []
    for k in keys:
        top = a[k] if k else next(iter(a.values()))
        bottom = b[k] if k else next(iter(b.values()))
        n = min(len(top), len(bottom))
        row = lambda paths: [Image.open(p).convert("RGB") for p in paths[:n]]
        t, u = row(top), row(bottom)
        w = int(t[0].width * height / t[0].height)
        block = Image.new("RGB", (w * n, height * 2 + 4), "black")
        for i in range(n):
            block.paste(t[i].resize((w, height)), (i * w, 0))
            block.paste(u[i].resize((w, height)), (i * w, height + 4))
        blocks.append((k or "clip", block))
    if not blocks:
        raise SystemExit("no clip present in both runs")
    W = max(bl.width for _, bl in blocks)
    sheet = Image.new("RGB", (W, sum(bl.height + 22 for _, bl in blocks)), "white")
    y = 0
    d = ImageDraw.Draw(sheet)
    for k, bl in blocks:
        d.text((6, y + 5), f"{k}   top: reference ({os.path.basename(ref)})   bottom: hers ({os.path.basename(target)})", fill="black")
        sheet.paste(bl, (0, y + 22))
        y += bl.height + 22
    sheet.save(out)
    print(out)


# --------------------------------------------------------------------------------------- compare
TIMES = ["0.00", "0.65", "1.30", "1.95", "2.60"]


def crop(path, th):
    im = Image.open(path).convert("RGB")
    w, h = im.size
    im = im.crop((int(w * 0.2), int(h * 0.08), int(w * 0.8), int(h * 0.92)))
    return im.resize((int(im.width * th / im.height), th))


def compare(base):
    for d in sorted(p for p in glob.glob(os.path.join(base, "*")) if os.path.isdir(p)):
        name = os.path.basename(d)
        offs = glob.glob(f"{d}/off-*.png")
        if not offs:
            continue
        views = sorted({os.path.basename(p).split("-")[1] for p in offs})
        times = [t for t in TIMES if os.path.exists(f"{d}/off-{views[0]}-{t}.png")]
        th = 260
        tw = crop(f"{d}/off-{views[0]}-{times[0]}.png", th).width
        sheet = Image.new("RGB", (tw * len(times) + 70, 34 + len(views) * 2 * (th + 18)), "white")
        dr = ImageDraw.Draw(sheet)
        dr.text((6, 6), f"{name}: preset as held (layer off) / same + living layer, at " + ", ".join(t + " s" for t in times), fill="black")
        y = 30
        for view in views:
            for side, tag in (("off", "held"), ("on", "layer")):
                dr.text((4, y + th // 2), f"{view}\n{tag}", fill="black")
                for i, t in enumerate(times):
                    sheet.paste(crop(f"{d}/{side}-{view}-{t}.png", th), (70 + i * tw, y))
                y += th + 18
        sheet.save(f"{base}/{name}-sheet.png")

        frames = [crop(p, 360) for p in sorted(glob.glob(f"{d}/play-*.png"))]
        if frames:
            frames[0].save(f"{base}/{name}-playback.gif", save_all=True, append_images=frames[1:], duration=100, loop=0)

        tj = f"{d}/trajectory.json"
        if os.path.exists(tj):
            plot(json.load(open(tj)), f"{base}/{name}-angles.png", name)
        print(name)


def plot(traj, out, title):
    W, H, pad = 760, 300, 44
    im = Image.new("RGB", (W, H), "white")
    dr = ImageDraw.Draw(im)
    keys = [("hips", (200, 60, 60)), ("spine", (60, 140, 60)), ("chest", (60, 90, 200)), ("head", (150, 60, 170))]
    vals = [r.get(k, 0) for r in traj for k, _ in keys]
    lo, hi = min(vals + [-1]), max(vals + [1])
    tmax = max(r["t"] for r in traj) or 1
    X = lambda t: pad + (W - 2 * pad) * t / tmax
    Y = lambda v: H - pad - (H - 2 * pad) * (v - lo) / (hi - lo)
    dr.line([(pad, Y(0)), (W - pad, Y(0))], fill=(200, 200, 200))
    for k, col in keys:
        dr.line([(X(r["t"]), Y(r.get(k, 0))) for r in traj], fill=col, width=2)
    dr.text((pad, 8), f"{title}: degrees off the held pose about her own right (+ = backwards), 0-{tmax:.0f} s", fill="black")
    x = pad
    for k, col in keys:
        dr.rectangle([x, 28, x + 10, 36], fill=col)
        dr.text((x + 14, 25), k, fill="black")
        x += 80
    dr.text((4, Y(hi) - 6), f"{hi:.0f}", fill="black")
    dr.text((4, Y(lo) - 6), f"{lo:.0f}", fill="black")
    dr.text((pad, H - pad + 8), "0 s", fill="black")
    dr.text((W - pad - 22, H - pad + 8), f"{tmax:.0f} s", fill="black")
    im.save(out)


# --------------------------------------------------------------------------------------- gallery
METHOD_LABEL = {
    "hand-authored-preset": "Hand-authored poses",
    "procedural-transition": "Procedural pose blending",
    "converted-cc0-clip": "Converted CC0 dances",
    "composed-show": "Composed shows",
    "procedural-layer": "Living motion layer",
    "library": "Clip library (not made by Claude)",
}


def gif(frames, out, fps, height=360):
    ims = []
    for p in frames:
        im = Image.open(p).convert("RGB")
        w, h = im.size
        im = im.crop((int(w * 0.18), int(h * 0.06), int(w * 0.82), int(h * 0.94)))
        ims.append(im.resize((int(im.width * height / im.height), height)))
    if ims:
        ims[0].save(out, save_all=True, append_images=ims[1:], duration=int(1000 / fps), loop=0)
    return bool(ims)


def gallery(base, runs):
    """GIFs and an index.html: motion-gallery frames (manifest.json) plus animation-review runs."""
    out = os.path.join(base, "gallery")
    os.makedirs(out, exist_ok=True)
    cards = []
    man = os.path.join(base, "manifest.json")
    if os.path.exists(man):
        m = json.load(open(man))
        for it in m["items"]:
            frames = sorted(glob.glob(os.path.join(base, it["dir"], "*.jpg")))
            name = it["dir"] + ".gif"
            if gif(frames, os.path.join(out, name), it.get("fps", 8)):
                cards.append(dict(it, gif=name, avatar=m.get("vrm", "")))
    for run in runs:
        rep = os.path.join(run, "report.json")
        info = {}
        if os.path.exists(rep):
            r = json.load(open(rep))
            for c in r.get("rows") or r.get("clips") or (r if isinstance(r, list) else []):
                if isinstance(c, dict) and c.get("id"):
                    info[re.sub(r"[^A-Za-z0-9]+", "_", str(c["id"]))] = c
        for key, frames in shots_by_clip(run).items():
            c = info.get(key, {})
            cid = str(c.get("id", key))
            cc0 = "vrma-cc0" in cid or "vrma_cc0" in key
            name = f"{os.path.basename(run)}-{key}.gif"[-120:]
            if gif(frames, os.path.join(out, name), 4):
                cards.append({
                    "id": cid.split("/")[-1],
                    "kind": "clip",
                    "method": "converted-cc0-clip" if cc0 else "library",
                    "batch": "VA2" if cc0 else "",
                    "what": c.get("category", "") + (f" · verdict {c['verdict']}" if c.get("verdict") else ""),
                    "note": f"animation review run {os.path.basename(run)}",
                    "gif": name,
                })
    order = list(METHOD_LABEL)
    cards.sort(key=lambda c: (order.index(c["method"]) if c.get("method") in order else 99, c["id"]))
    html = [
        "<!doctype html><meta charset=utf-8><title>Motion gallery</title>",
        "<style>body{background:#111;color:#ddd;font:14px system-ui;margin:16px}h2{margin:28px 0 8px}"
        ".g{display:flex;flex-wrap:wrap;gap:12px}.c{background:#1c1c1c;border-radius:8px;padding:8px;width:260px}"
        ".c img{width:100%;border-radius:4px;background:#000}.t{font-weight:600;margin:6px 0 2px}"
        ".m{display:inline-block;font-size:11px;padding:1px 6px;border-radius:9px;background:#333;margin-right:4px}"
        ".w{font-size:12px;color:#aaa}</style>",
        "<h1>Motion gallery</h1><p class=w>Every motion we support, tagged by how it was made "
        "(src/gltf-viewer/MotionProvenance.js). Built by tools/qa/motion-gallery.mjs and review_sheets.py gallery.</p>",
    ]
    for method in order + [None]:
        group = [c for c in cards if (c.get("method") == method) or (method is None and c.get("method") not in order)]
        if not group:
            continue
        html.append(f"<h2>{METHOD_LABEL.get(method, 'Other')} ({len(group)})</h2><div class=g>")
        for c in group:
            html.append(
                f"<div class=c><img src='{c['gif']}' loading=lazy><div class=t>{c['id']}</div>"
                f"<span class=m>{c.get('kind','')}</span><span class=m>{c.get('method') or ''}</span>"
                f"<span class=m>{c.get('batch') or ''}</span><div class=w>{c.get('what','')}</div>"
                f"<div class=w>{c.get('note','')}</div></div>"
            )
        html.append("</div>")
    open(os.path.join(out, "index.html"), "w").write("\n".join(html))
    json.dump(cards, open(os.path.join(out, "gallery.json"), "w"), indent=1)
    print(os.path.join(out, "index.html"), len(cards), "items")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("pair")
    p.add_argument("ref")
    p.add_argument("target")
    p.add_argument("--out", default=None)
    p.add_argument("--height", type=int, default=380)
    c = sub.add_parser("compare")
    c.add_argument("base")
    g = sub.add_parser("gallery")
    g.add_argument("base", help="motion-gallery.mjs output (with manifest.json)")
    g.add_argument("runs", nargs="*", help="audits/animations/run.mjs run folders to include")
    a = ap.parse_args()
    if a.cmd == "pair":
        pair(a.ref, a.target, a.out or os.path.join(a.target, "pair.png"), a.height)
    elif a.cmd == "gallery":
        gallery(a.base, a.runs)
    else:
        compare(a.base)
