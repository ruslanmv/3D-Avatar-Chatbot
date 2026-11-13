# Wardrobe release readiness

Recommendation: **not release-ready**.

This assessment is from 2026-11-07. It covers a live catalog query, pose-cloth unit tests, and live Try-On captures of two shipped looks. It does not cover the 62-garment screenshot matrix. No Forge generation job was submitted.

## What was executed

- `GET https://ruslanmv-3d-wardrobe-forge.hf.space/v1/catalog/garments` returned 62 public garments, 105 templates, 59 ready previews. Category counts match the historical snapshot. Every garment is `not-captured`. Machine output: `live-catalog-2026-11-07/`.
- `npx jest tests/wardrobe/pose-cloth-correction.test.js` — 17 passed, including the SD1 lap fixture, the refusal to push a panel below its cut, and the standing-cut case that must report 0 mm.
- `npx jest tests/puppet-skeleton.test.js` — 18 passed.
- `python3 -m unittest discover -s audits/wardrobe_sitting_desk` — 12 passed.
- Playwright, software WebGL, viewport 1440×900, camera orbit (not avatar yaw). The app was `http://127.0.0.1:8080/`.

### Live captures

| Run | Look | Poses | Result |
| --- | --- | --- | --- |
| `/tmp/wardrobe-smoke` | Crop top & jeans (`builtin:homepilot-default:avatar-sample-a:crop-top-jeans`) | standing, sittingDesk, sittingWide, sittingCrossed | exit 0, cloth `applied`. Sitting (Desk) jeans: penetration 37.5 mm → 0, stretch 7.62× → 2.77×. The front frame still shows the hips open. |
| `/tmp/wardrobe-pencil-off` | Black Pencil Mini Skirt (`look_f9fae4dd7cf04838`) | sittingDesk, cloth off | exit 0. Skirt span drop 124.1 mm, penetration 8.5 mm. |
| `/tmp/wardrobe-pencil-on` | same look | sittingDesk, rest-directed lift | exit 0. Skirt span drop 130.5 mm, penetration 0, stretch 1.85×. Briefs still 2 mm inside. The hem is not closed. |
| `/tmp/wardrobe-pencil-up` | White Blouse + Grey Pencil Skirt + Grey Tailored Blazer (`look_de28027dc60c497c`) | standing, sittingDesk | Accidental first match for `--only Pencil`. Standing skirt reported 133.9 mm under a world-up rule that treated a hanging hem as a drop. That rule was removed. |
| `/tmp/wardrobe-pencil-guard` | Black Pencil Mini Skirt (`look_698e7f5cac96421d`) | standing, sittingDesk, cut-relative lift | exit 0. This key is not `look_f9fae4dd7cf04838`, which was no longer on the rail. Sitting (Desk) skirt 59.9 mm → 24.4 mm, penetration 10.1 mm → 0. 24.4 mm still fails the 8 mm gate. Waistband 22 mm. Blazer penetration 2.1 mm. Standing gate passed. |

Frames kept in git: `reports/evidence/`. Full screenshot directories were not committed.

Walking is `unsupported` on every entry. Locomotion is a follow state machine, not a Pose Studio preset.

## What was not executed

- The 62-garment × 4-pose × 4-orbit matrix. A catalog pass submits one Forge job per garment and was not started.
- Sitting (Wide) and Sitting (Crossed) for either pencil look.
- Desktop and mobile stage-control hit tests (`--mobile-ui`).
- A second capture of `look_f9fae4dd7cf04838` after the cut-relative lift. That key was gone from the rail, so the original bandeau look has no after frame for the current algorithm.
- `npm run validate` (the full lint and test gate). Node on this machine is 22; the repo asks for 24. The targeted suites above passed.

## Defects

| Id | Severity | Status | Owner | Notes |
| --- | --- | --- | --- | --- |
| WARDROBE-CLIP-001 | P1 | mechanism-corrected | 3D-Avatar-Chatbot `PoseClothCorrection.js` | Lap panel. Fixture drop goes to 0. Live bandeau pencil went 124.1 mm → 130.5 mm under the rest-directed lift and the front stays parted. The later look's skirt is still 24.4 mm. Not fixed. |
| WARDROBE-DEFORM-002 | P1 | open | shared: pose cloth and Forge jeans skinning | Seated straight jeans open at the hips after penetration reads 0. No seam-closure is implemented. |
| WARDROBE-UI-0523 | P3 | open | 3D-Wardrobe-Forge | High-Waist Leggings preview pending. |
| WARDROBE-UI-CC4A | P3 | open | 3D-Wardrobe-Forge | Seamless Scrunch Leggings preview pending. |
| WARDROBE-UI-F181 | P3 | open | 3D-Wardrobe-Forge | Leggings preview pending. |

The guard run also recorded, for `look_698e7f5cac96421d` only: skirt span drop 24.4 mm, waistband span drop 22 mm, blazer penetration 2.1 mm. Those are the same CLIP-001 class plus a residual penetration on that blazer. They are not a new garment family and they were not retested.

No P0 was established. The three missing previews are not release blockers.

## Counts

- Garments discovered: 62
- Shipped looks observed on the later rail: 6 (2 builtin, 4 Forge-saved). The first session's rail had 3.
- Supported still poses in the audit: standing, sittingDesk, sittingWide, sittingCrossed
- Walking: unsupported, recorded on every garment
- Catalog pose slots: 310 expected, 0 captured
- Look captures: one builtin look at 4 poses; two pencil looks at Sitting (Desk); one of those also standing
- Release blockers: `WARDROBE-CLIP-001`, `WARDROBE-DEFORM-002`

## Blockers

Both P1s stay open. The span lift is limited to a vertex that has fallen below its own cut, so it no longer pushes a hem toward a rest pose that sits below the knee, and it no longer flags a standing hem. That does not put the seated pencil panel back across the lap, and it does not close the jeans.

A catalog-wide run submits real Forge jobs. Keep `--max-items` set, and in GitHub Actions set `allow_generation` before `source` is `catalog` or `both`. Recapture a specific outfit with `--look-key`.
