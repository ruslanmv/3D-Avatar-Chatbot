#!/usr/bin/env python3
"""Generate the complete Scene Tale ambience art set with the OpenAI Images API.

The production contract is deliberately small:
- one independently composed landscape image per registered scene -> 1920x1080 WebP
- one independently composed portrait image per registered scene -> 1080x1920 WebP
- Stage 1 thumbnails reuse the landscape file, so there is no second image library to drift

The API key is read only from OPENAI_API_KEY. It is never accepted as a command-line value,
printed, written to disk, or embedded in prompts/metadata.

Examples:
    OPENAI_API_KEY=... python tools/scene-tale/generate-scene-tale-art.py --dry-run
    OPENAI_API_KEY=... python tools/scene-tale/generate-scene-tale-art.py --all --overwrite
    OPENAI_API_KEY=... python tools/scene-tale/generate-scene-tale-art.py \
        --scene coastal-terrace-twilight --overwrite
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import random
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
PROMPTS_PATH = ROOT / "tools" / "scene-tale" / "scene-art-prompts.json"
ART_MANIFEST_PATH = ROOT / "assets" / "ambient" / "scene-tale-art.json"
BACKGROUNDS_PATH = ROOT / "assets" / "ambient" / "backgrounds.json"
API_URL = "https://api.openai.com/v1/images/generations"
DEFAULT_MODEL = "gpt-image-2.5-sunburst"
DEFAULT_QUALITY = "high"
LANDSCAPE_REQUEST = "1920x1088"  # API-friendly source; final crop is 1920x1080.
PORTRAIT_REQUEST = "1088x1920"   # API-friendly source; final crop is 1080x1920.
LANDSCAPE_FALLBACK = "1536x1024"
PORTRAIT_FALLBACK = "1024x1536"
LANDSCAPE_FINAL = (1920, 1080)
PORTRAIT_FINAL = (1080, 1920)
ALLOWED_QUALITY = {"low", "medium", "high", "xhigh", "max", "auto"}


def _load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _scene_rows() -> list[dict[str, Any]]:
    prompts = _load_json(PROMPTS_PATH)
    art = _load_json(ART_MANIFEST_PATH)
    backgrounds = _load_json(BACKGROUNDS_PATH)

    prompt_by_key = {row["key"]: row for row in prompts.get("scenes", [])}
    background_by_id = {row["id"]: row for row in backgrounds.get("scenes", [])}
    rows: list[dict[str, Any]] = []

    for item in art.get("scenes", []):
        key = item.get("generationKey")
        prompt = prompt_by_key.get(key)
        background = background_by_id.get(item.get("id"))
        if not key or not prompt or not background:
            raise SystemExit(f"Scene art metadata is incomplete for {item.get('id') or key}")
        if item.get("hero") != background.get("src") or item.get("portrait") != background.get("srcPortrait"):
            raise SystemExit(f"Scene Tale art paths drifted from backgrounds.json for {item['id']}")
        rows.append({**item, "prompt": prompt["prompt"]})

    if len(rows) != len(prompt_by_key) or len(rows) != len(background_by_id):
        raise SystemExit("Prompt pack, Scene Tale art manifest, and ambience catalogue must cover the same scenes")
    return rows


def _build_prompt(shared: str, composition: str, scene_prompt: str, label: str) -> str:
    return "\n\n".join(
        [
            shared.strip(),
            composition.strip(),
            f"SCENE LABEL: {label}",
            f"SCENE: {scene_prompt.strip()}",
            "OUTPUT RULES: no text, no UI, no people, no logos, no watermark. Render one finished environmental illustration only.",
        ]
    )


def _post_image(*, api_key: str, model: str, quality: str, prompt: str, size: str, fallback_size: str) -> bytes:
    """Generate one image. Falls back to a standard size only when the custom size is rejected."""

    def request(request_size: str) -> bytes:
        payload = json.dumps(
            {
                "model": model,
                "prompt": prompt,
                "size": request_size,
                "quality": quality,
                "output_format": "png",
            }
        ).encode("utf-8")
        req = urllib.request.Request(
            API_URL,
            data=payload,
            method="POST",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "User-Agent": "3D-Avatar-Chatbot-scene-tale-art/1.0",
            },
        )
        with urllib.request.urlopen(req, timeout=240) as response:
            body = json.loads(response.read().decode("utf-8"))
        data = body.get("data") or []
        if not data:
            raise RuntimeError("Images API returned no image data")
        item = data[0]
        encoded = item.get("b64_json")
        if encoded:
            return base64.b64decode(encoded)
        url = item.get("url")
        if url:
            with urllib.request.urlopen(url, timeout=120) as response:
                return response.read()
        raise RuntimeError("Images API response contained neither b64_json nor url")

    retries = 4
    for attempt in range(retries):
        try:
            return request(size)
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:1200]
            # Some image-model versions accept arbitrary 16-multiple sizes, while older
            # deployments accept only standard sizes. Fall back without changing the final
            # production dimensions.
            if exc.code == 400 and size != fallback_size and ("size" in detail.lower() or "dimension" in detail.lower()):
                return request(fallback_size)
            if exc.code not in {408, 409, 429, 500, 502, 503, 504} or attempt == retries - 1:
                raise RuntimeError(f"Images API HTTP {exc.code}: {detail}") from exc
            time.sleep((2 ** attempt) + random.random())
        except (urllib.error.URLError, TimeoutError) as exc:
            if attempt == retries - 1:
                raise RuntimeError(f"Images API network failure: {exc}") from exc
            time.sleep((2 ** attempt) + random.random())
    raise RuntimeError("Images API retry loop exhausted")


def _cover_crop(image: Image.Image, target: tuple[int, int]) -> Image.Image:
    """Center-cover to the exact production aspect ratio, then resize with Lanczos."""
    image = image.convert("RGB")
    target_w, target_h = target
    source_ratio = image.width / image.height
    target_ratio = target_w / target_h
    if source_ratio > target_ratio:
        new_w = round(image.height * target_ratio)
        left = max(0, (image.width - new_w) // 2)
        image = image.crop((left, 0, left + new_w, image.height))
    elif source_ratio < target_ratio:
        new_h = round(image.width / target_ratio)
        top = max(0, (image.height - new_h) // 2)
        image = image.crop((0, top, image.width, top + new_h))
    return image.resize(target, Image.Resampling.LANCZOS)


def _write_webp(raw: bytes, path: Path, target: tuple[int, int]) -> None:
    with Image.open(io.BytesIO(raw)) as source:
        image = _cover_crop(source, target)
        path.parent.mkdir(parents=True, exist_ok=True)
        image.save(path, "WEBP", quality=92, method=6)
    with Image.open(path) as check:
        if check.size != target:
            raise RuntimeError(f"Wrote {path} at {check.size}, expected {target}")


def _jobs(rows: list[dict[str, Any]], selected: set[str]) -> list[dict[str, Any]]:
    prompts = _load_json(PROMPTS_PATH)
    jobs: list[dict[str, Any]] = []
    for row in rows:
        if selected and row["generationKey"] not in selected:
            continue
        jobs.extend(
            [
                {
                    "key": row["generationKey"],
                    "variant": "landscape",
                    "label": row["label"],
                    "path": ROOT / row["hero"],
                    "request_size": LANDSCAPE_REQUEST,
                    "fallback_size": LANDSCAPE_FALLBACK,
                    "target": LANDSCAPE_FINAL,
                    "prompt": _build_prompt(prompts["sharedPrompt"], prompts["landscapeComposition"], row["prompt"], row["label"]),
                },
                {
                    "key": row["generationKey"],
                    "variant": "portrait",
                    "label": row["label"],
                    "path": ROOT / row["portrait"],
                    "request_size": PORTRAIT_REQUEST,
                    "fallback_size": PORTRAIT_FALLBACK,
                    "target": PORTRAIT_FINAL,
                    "prompt": _build_prompt(prompts["sharedPrompt"], prompts["portraitComposition"], row["prompt"], row["label"]),
                },
            ]
        )
    return jobs


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--all", action="store_true", help="Generate all registered Scene Tale scenes")
    parser.add_argument("--scene", action="append", default=[], help="Generate one generationKey; may be repeated")
    parser.add_argument("--model", default=os.environ.get("SCENE_TALE_IMAGE_MODEL", DEFAULT_MODEL))
    parser.add_argument("--quality", default=os.environ.get("SCENE_TALE_IMAGE_QUALITY", DEFAULT_QUALITY))
    parser.add_argument("--overwrite", action="store_true", help="Replace existing production WebP files")
    parser.add_argument("--dry-run", action="store_true", help="Print the complete job plan without using the API")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.quality not in ALLOWED_QUALITY:
        raise SystemExit(f"Unsupported quality {args.quality!r}; choose one of {sorted(ALLOWED_QUALITY)}")
    rows = _scene_rows()
    known = {row["generationKey"] for row in rows}
    requested = set(args.scene)
    unknown = requested - known
    if unknown:
        raise SystemExit(f"Unknown scene key(s): {', '.join(sorted(unknown))}")
    if not args.all and not requested:
        raise SystemExit("Choose --all or at least one --scene <generationKey>")
    selected = set() if args.all else requested
    jobs = _jobs(rows, selected)

    if args.dry_run:
        print(json.dumps(
            {
                "model": args.model,
                "quality": args.quality,
                "jobCount": len(jobs),
                "jobs": [
                    {
                        "scene": job["key"],
                        "variant": job["variant"],
                        "requestSize": job["request_size"],
                        "targetSize": f"{job['target'][0]}x{job['target'][1]}",
                        "output": str(job["path"].relative_to(ROOT)),
                        "prompt": job["prompt"],
                    }
                    for job in jobs
                ],
            },
            indent=2,
            ensure_ascii=False,
        ))
        return 0

    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise SystemExit("OPENAI_API_KEY is required. Put it in the environment, never in source or CLI arguments.")

    failures: list[str] = []
    for index, job in enumerate(jobs, start=1):
        path: Path = job["path"]
        relative = path.relative_to(ROOT)
        if path.exists() and not args.overwrite:
            print(f"[{index}/{len(jobs)}] skip existing {relative} (use --overwrite to replace)")
            continue
        print(f"[{index}/{len(jobs)}] generate {job['label']} [{job['variant']}] -> {relative}", flush=True)
        try:
            raw = _post_image(
                api_key=api_key,
                model=args.model,
                quality=args.quality,
                prompt=job["prompt"],
                size=job["request_size"],
                fallback_size=job["fallback_size"],
            )
            _write_webp(raw, path, job["target"])
            print(f"  wrote {relative} ({path.stat().st_size // 1024} KiB)", flush=True)
        except Exception as exc:  # continue the batch so one transient scene does not hide the rest
            failures.append(f"{job['key']}:{job['variant']}: {exc}")
            print(f"  ERROR {failures[-1]}", file=sys.stderr, flush=True)

    if failures:
        print("\nGeneration completed with failures:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1

    print(f"\nGenerated {len(jobs)} Scene Tale assets. Run the ambience and Scene Tale tests before committing them.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
