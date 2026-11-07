# Wardrobe Sitting (Desk) screenshot audit

A **read-only visual QA harness**, except for explicit Forge garment generation: it opens the real avatar app in Playwright, enumerates the built-in/saved **Available outfits** rail and the live public **Customize This Look** catalog, then screenshots each successful outfit in the `sittingDesk` pose from **front, right side and back**. Extra left side: `--views front,side,back,opposite-side`.

This is designed to find clothing bugs such as skin poke-through, lifted hems, wrong materials, missing meshes, UV patches, broken camera views, and UI overlay occlusion. It does **not** perform automated visual defect classification. Each run writes evidence for human review, plus explicit technical failures.

## Run locally

Start the app from the repository root in one terminal (`npm ci && npm start`). From another terminal:

```bash
python -m pip install -r audits/wardrobe_sitting_desk/requirements.txt
python -m playwright install chromium

# Smoke test: one shipped look, does NOT invoke Forge generation
python audits/wardrobe_sitting_desk/capture.py --source looks --max-items 1

# Full audit: all available rail looks AND every public Forge catalog garment
python audits/wardrobe_sitting_desk/capture.py \
  --url http://localhost:8080/ --source both --avatar fem_vroid.vrm \
  --out audits/wardrobe_sitting_desk/runs/full-$(date -u +%Y%m%dT%H%M%SZ)

# Repeat incomplete run without re-generating successful items
python audits/wardrobe_sitting_desk/capture.py --source both \
  --out audits/wardrobe_sitting_desk/runs/YOUR_RUN_ID --resume
```

The live Forge is **optional for rail-only runs**. Full catalog runs need the configured Forge to be reachable and able to generate each garment for the chosen avatar; override with `--forge-url http://localhost:8765` to test a local Forge. The catalog currently displayed by the user lists **62 public garments across 10 categories**; the runner discovers the current number dynamically instead of assuming that inventory is fixed. **A catalog run submits one real Forge job per garment**, potentially slow or expensive; keep it serial and use `--max-items N` for short probes. Default color is black; try `--color white` when inspecting dark garments against the black stage.

For web browsers without a working GPU, launch uses the same software-WebGL flags as `tools/try-on-tour.mjs`. Override the browser with `PLAYWRIGHT_CHROMIUM=/path/to/chromium` or use `--headful` to diagnose locally. The app needs a real render-capable browser; this isn't an API-only garment preview export.

## Evidence / output structure

```text
runs/<UTC timestamp>/
  inventory.json                 # initial rail looks + public catalog items
  manifest.json                  # status, category, name, description and image paths
  report.html                    # contact sheet, human-review friendly
  report.md                      # compact inventory and capture links
  browser-errors.json            # JS errors and HTTP >=400s
  looks/look-<key>/front.png,side.png,back.png
  catalog/garment-<group>-<index>-<name>/
    catalog-ui.png               # catalog selection / overlay for UI review
    front.png,side.png,back.png  # real 3D avatar in Sitting (Desk)
    failure-ui.png               # if applying/capturing failed
```

Screenshots and run data stay in ignored `runs/`, **not committed as large binaries to git**. GitHub Actions uploads the run as a downloadable artifact. Every entry has `ok` or `error`; an error never becomes a fabricated success. Failed captures produce a non-zero exit code, and the report remains available after partial completion.

## Repeatable comparison

The runner takes a baseline camera position, applies `window.vrPoseSystem.applyPreset('sittingDesk', 0)` **after each look loads**, verifies the preset, and rotates the existing Three.js camera about its controls target by 0/90/180 degrees. It does not simulate a pose using an image, and does not click Turn twice as a substitute for a real side view. Before each Forge job it restores the first shipped look to avoid inadvertently accumulating pieces from the previously generated outfit. `--resume` skips only entries whose three requested images exist and status is `ok`.

Review *front / side / back* for the same look before deciding a bug is confirmed. Attach the run path and artifact, garment name and category, the source Forge job if identifiable, avatar, viewport, pose, and the problematic view to an issue. See [REFERENCE_FINDINGS.md](REFERENCE_FINDINGS.md) for the initially reported pencil-skirt example.

## Recurrence

`.github/workflows/wardrobe-sitting-desk-audit.yml` supports a weekly run and manual `workflow_dispatch` with source (`looks`, `catalog`, `both`) and `max_items`. It starts the app, runs the audit sequentially and uploads screenshots/reports even when individual cases fail. Weekly **both** traverses the public Forge catalog and can generate many outfits; adjust or disable the schedule if generation quotas/costs are a concern. GitHub `schedule` events only run once the workflow is present on the repository's **default branch** (this PR first targets the requested feature branch).

If an avatar/camera/pose control is missing, the run fails visibly. This harness audits visual output and does not attempt to auto-fix Forge geometry or modify the app's production UI.