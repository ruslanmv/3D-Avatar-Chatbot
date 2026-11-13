# Wardrobe visual audit

Brought onto `feat/living-worlds-spatial-storytelling` (`7171d77`). The scripts
and the 7 November and 8 November tables are the ones from PR #137, commit
`5d78262`. Product code is unchanged.

On this tree `VRPoseSystem` has no `clothStatus()`, and `PoseClothCorrector`
does not set `phase`. `capture.py` records that phase in the page: `release` is
idle, `correct` is pending, and the worker answer is applied, skipped, or
failed. `cloth.last` is still `{name, before, after}`. `after` has
`maxPenetrationMm` and `maxEdgeStretch`. It does not have `maxSpanDropMm`, so a
new capture will not flag the 8 mm span gate until the worker reports that field
again. The historical CSVs are not rewritten.

Repeatable evidence for Try-On looks and the live Forge catalog. The runner can:

1. Fetch the public catalog and mark every garment `not-captured`
   (`--inventory-only`). This does not generate clothing.
2. Open the app, apply each selected look or garment, pose her, and save four
   camera orbits per pose.
3. Wait until the cloth correction is applied, skipped, or failed. A fixed sleep
   is only the short settle after that.
4. Write `issues.json`, `report.html`, `report.md`, `summary.json` and
   `READINESS.md`. Failures are `infrastructure`, `generation`, `pose` or
   `capture`.
5. Compare a previous run with `--baseline` and `--diff-threshold`. A pixel
   delta is a review item (`confirmed: false`), not an automatic defect.
6. Resume a partial run with `--resume`.

Camera orbits rotate the existing Three.js camera around its target
(`camera-orbit`). They do not yaw the avatar. `walking` is recorded
`unsupported` on every entry: locomotion follows the viewer and is not a Pose
Studio preset.

## Poses and views

Default poses: `standing` (`standingRelaxed`), `sittingDesk`, `sittingWide`,
`sittingCrossed`.

Default views: `front` (0°), `right` (90°), `back` (180°), `left` (270°). The
older names `side` and `opposite-side` still work. `side` is the same orbit as
`right`.

## Sitting Desk, the original capture

PR #135 photographed Sitting Desk from the front, the side, and the back. That
run is this runner with the pose and the cameras limited:

```bash
python audits/wardrobe_sitting_desk/capture.py \
  --source both --avatar fem_vroid.vrm \
  --poses sittingDesk \
  --views front,side,back
```

It still waits for the cloth correction, writes the gate, and can be printed
with `print_matrix.py`. It does not replace the four-pose audit.

## Run

```bash
python -m pip install -r audits/wardrobe_sitting_desk/requirements.txt
python -m unittest discover -s audits/wardrobe_sitting_desk -p 'test_*.py' -v

# Live catalog, no browser, no Forge jobs
python audits/wardrobe_sitting_desk/capture.py --inventory-only \
  --out audits/wardrobe_sitting_desk/runs/inventory

# One shipped look, no Forge generation. The app must already be running.
python -m playwright install chromium
python audits/wardrobe_sitting_desk/capture.py --source looks --max-items 1

# Full catalog. One real Forge job per garment. Keep --max-items set until a quota is agreed.
python audits/wardrobe_sitting_desk/capture.py --source both --avatar fem_vroid.vrm --max-items 0
```

Screenshots stay in gitignored `runs/`. A few comparison frames live in
`reports/evidence/` so the bug records have a stable path. GitHub Actions
uploads a full run. Pull requests run the offline tests only. The weekly
schedule captures shipped looks and does not generate. A catalog dispatch must
set `allow_generation` or the job refuses to start.

`--only` is a substring, and an exact name wins when one exists. Several looks
can share a name, so a retest passes `--look-key` with the rail's
`data-look-key`.

## What this does not claim

The span lift closes the two-thigh fixture. It did not close the live pencil
hem. `WARDROBE-CLIP-001` and `WARDROBE-DEFORM-002` stay release blockers. The
assessment is [reports/READINESS.md](reports/READINESS.md). The catalog
enumeration from 2026-11-07 is
[reports/live-catalog-2026-11-07](reports/live-catalog-2026-11-07).

A later Try-On pass applied 61 of the 62 public garments in standing, Sitting
(Desk), Sitting (Wide) and Sitting (Crossed), four cameras each. The picture
table, contact sheets, and the rerun steps for a later coder are in
[AGENT_MATRIX.md](AGENT_MATRIX.md) and
[reports/catalog-matrix-2026-11-07](reports/catalog-matrix-2026-11-07). Every
skirt and dress still drops through the lap. Plain and high-waist leggings still
stretch about 39× in Sitting (Crossed). Seamless Scrunch Leggings did not finish
its cloth correction and was left uncaptured. The frame PNGs are not in git.

```bash
python audits/wardrobe_sitting_desk/print_matrix.py \
  --run /tmp/wardrobe-catalog-matrix \
  --out audits/wardrobe_sitting_desk/reports/catalog-matrix-2026-11-07

# Look at each picture, write the error, then block the release on any miss.
python audits/wardrobe_sitting_desk/review_pictures.py check \
  --csv audits/wardrobe_sitting_desk/reports/catalog-matrix-2026-11-07/catalog-matrix.csv
```
