# Making the wardrobe audit stable

A plan, written 2026-11-13 after reproducing the documented commands on
`feat/living-worlds-spatial-storytelling` (`3d884ed`). Nothing below is
implemented yet. Each problem is one that was observed, not guessed; the
evidence is named next to it.

The goal: the same commands, run by any person or agent on any day, either
produce comparable pictures and honest verdicts or refuse to run and say why.

## What went wrong in practice

| #   | Problem                                                                                                                                                                                                      | Evidence                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **A missing metric passes the gate.** `quality.assess_metrics` only flags a value that is a number above its limit. The worker on this branch never reports `maxSpanDropMm`, so the 8 mm span gate is off.   | A-line 2026-11-13: every seated pose `gate ok`, 0 mm penetration, while the front frames show the skirt as a flat floating hoop with the briefs in the opening. 11-08 had the same poses failing. |
| 2   | **The numbers are measured against the wrong rest.** The corrector's `rest` is `matrixWorld × bind`, not the skinned pose, so stretch is not the solver's strain.                                            | Diagnosis note 8 in the cloth-contract prompt; standing stretch moved 9.29× → 1.17× with no visual change.                                                                                        |
| 3   | **No number can see a hoop.** Penetration and stretch both go to zero when the hem is lifted away from the body. A picture is the only detector today, and 984 of 992 pictures in 11-08 were never reviewed. | `review_pictures.py check` on 11-08: 984 pending, 6 fail, 2 pass.                                                                                                                                 |
| 4   | **The inputs drift.** The default Forge is the public Space, which redeploys, has quotas and regenerates every garment per run. Runs on different days compare different meshes.                             | `DEFAULT_FORGE` in `capture.py`; the public Space does not serve WCL1 at all.                                                                                                                     |
| 5   | **A run does not record what it measured.** The manifest has no app commit, Forge commit, avatar hash, browser version or cloth mode, so 11-07 vs 11-08 vs today cannot be attributed to a change.           | `manifest.json` entry keys: id, source, name, folder, category, status, poses, description, lookKey, browserErrors.                                                                               |
| 6   | **The documented commands overwrite history.** The suggested `print_matrix.py --out reports/catalog-matrix-2026-11-08` rewrites a dated report.                                                              | The command handed over for this audit.                                                                                                                                                           |
| 7   | **The environment breaks before the first picture.** `requirements.txt` allows any Playwright 1.x; a newer one looks for a browser build that is not installed.                                              | First run here: `chromium_headless_shell-1254` missing; the container ships build 1243 (Playwright 1.63.0).                                                                                       |
| 8   | **A hang is handled by hand.** Seamless Scrunch Leggings never finishes its cloth correction, so every run passes `--skip` on the command line and the reason lives only in prose.                           | README; every recorded command.                                                                                                                                                                   |
| 9   | **Frames live in `/tmp`.** A cloud container is reclaimed; the PNGs behind every CSV row disappear with it.                                                                                                  | `--out /tmp/wardrobe-catalog-matrix` in every command.                                                                                                                                            |

## The plan, in four phases

Each phase is shippable alone and has an acceptance test. Do them in order: an
honest gate is worth more than a reproducible dishonest one.

### Phase 1 — an honest gate (problems 1, 2, 6)

1. `quality.py`: a `REQUIRED_METRICS` list (`maxPenetrationMm`,
   `maxEdgeStretch`, `maxSpanDropMm`) per cloth profile. A required metric that
   is absent or not a number is a finding, code `metric-missing`, severity P1.
   The gate is `ok` only when every required metric is present and inside its
   limit. Limits stay 1 mm, 6×, 8 mm.
2. The worker reports `restBasis: "skinned" | "bind"` with its metrics. The
   audit records it and treats `bind` as `metric-unreliable` (a finding, not a
   crash). Restore `maxSpanDropMm` in the worker's `after` block.
3. `print_matrix.py` refuses to write into an existing directory that already
   holds a `catalog-matrix.csv` unless `--overwrite` is passed, and never
   overwrites a directory whose name is a date other than today. The README
   examples write to `reports/catalog-matrix-<date>-<app-sha>`.
4. Tests: a metric block without `maxSpanDropMm` fails the gate; a dated
   directory is not overwritten.

Accept when: re-running the A-line today reports `metric-missing` (or the real
span drop) for the three seated poses instead of `gate ok`.

### Phase 2 — reproducible inputs and identity (problems 4, 5, 7, 9)

1. **Run identity.** `capture.py` writes `run.json` first: app commit and dirty
   flag, branch, Forge URL and Forge `/v1/health` version or commit, catalog
   fingerprint (sorted template ids + geometry fingerprints), avatar file hash,
   page URL including `?cloth=`, viewport, device scale, browser and Playwright
   versions. `print_matrix.py` copies it into `summary.json`, and
   `--baseline-csv` refuses to compare runs whose catalog fingerprint or avatar
   hash differ (`--allow-drift` to override, and the report says so).
2. **Pinned Forge.** The default becomes a local Forge (`--forge-url` required
   for catalog runs; the public Space only with `--forge-url public`). Document
   the exact Forge commit to run.
3. **Asset cache.** Generated GLBs are stored by
   `(template id, parameters, forge commit)` under `runs/cache/`. A rerun
   replays from the cache, so two runs of one commit photograph byte-identical
   garments and do not spend Forge quota.
4. **Preflight.** `capture.py --preflight` checks, without generating: app
   `/health`, Forge reachable and its catalog count, avatar present, the browser
   launches with the installed Playwright, free disk. Pin `playwright` in
   `requirements.txt` to the version that matches the shipped browser, or pass
   its `executablePath`.
5. **Durable frames.** Runs go to `audits/wardrobe_sitting_desk/runs/<run-id>`
   (gitignored) and the finished run is archived (CI artifact, or the user's
   storage); the CSV records the archive name so a row can always be opened.

Accept when: two runs from the same commits produce identical `run.json`
fingerprints, and pixel diffs between them are under the existing
`--diff-threshold` for every frame.

### Phase 3 — shape checks the numbers miss (problems 3, 8)

1. **Measured shape, computed in the page after the cloth settles**, per skirt
   or dress:
    - _hem clearance_: median height of the hem rim above the top surface of the
      thighs it crosses. A hem resting on the lap is near 0; a hoop is tens of
      millimetres above it.
    - _flare ratio_: hem ring radius seated vs standing. A ring that opens
      outward when she sits is a hoop.
    - _opening coverage_: in the front frame, the fraction of the underwear's
      projected area that is visible. Recorded, not judged: briefs visible in a
      wide seat can be correct. These become gate metrics with limits set from
      the reviewed 11-08 passes (Skater Mini Dress crossed) and fails (A-line
      wide), and they are required for skirts and dresses only.
2. **Determinism inside the page**: idle motion, blinking, breathing and look-at
   are frozen for the capture; the camera framing is computed from the avatar
   bounds, not the window; each pose is captured twice on a sample and a
   difference above the threshold is a `capture-unstable` finding.
3. **Hangs become data.** Per-garment wall-clock budget. A cloth phase that
   never settles is recorded `cloth-timeout` with its last metrics and the run
   continues. A `known-issues.json` (garment, reason, issue id) replaces
   `--skip` on the command line; a skipped garment appears in the CSV with its
   reason.

Accept when: today's A-line seated frames fail on hem clearance or flare with no
human in the loop, and the Skater Mini Dress crossed frame still passes.

### Phase 4 — a review people actually finish (problem 3, continued)

1. **One sheet per garment**: 4 poses × 4 cameras, cropped to the avatar, gate
   label on each cell (the per-garment sheets produced with this plan are the
   prototype). Review is recorded per garment-pose (248 decisions for the
   catalog), not per frame (992).
2. **Only the uncertain pictures are asked for.** A gate miss is `fail`
   automatically with its finding as the comment. A frame whose perceptual hash
   matches an already reviewed frame of the same garment and pose carries that
   review forward. What remains is the gate-clean, changed pictures.
3. Each review records who or what reviewed it (person, or agent and model) and
   the run id.
4. **CI**: pull requests keep the offline tests (now including Phase 1's). A
   nightly smoke captures three garments (A-line dress, Pencil skirt, Pleated
   mini) from the asset cache against a pinned local Forge and fails on any gate
   or shape miss. The full catalog stays a manual dispatch.

Accept when: a full catalog run leaves fewer than 50 picture decisions for a
reviewer, and `review_pictures.py check` reaches `production: pass` or names
every blocker.

## What this plan does not do

It does not fix the cloth. The seated skirts and dresses fail today, and an
audit that becomes stable will keep saying so until the cloth contract fixes
(vertex order, skinned rests, thigh capsules, hem collision) land. The plan's
job is to make sure that, when they land, the pictures prove it and a regression
cannot pass quietly.
