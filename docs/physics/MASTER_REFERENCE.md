# Master is the visual reference for cloth

Recorded 2026-11-08. This branch starts again from `master` (`14e5126`) and
keeps only what held up against master's pictures. It changes nothing the app
does. Its job is to make the next cloth change start from a baseline that is
known to be good, and to compare with it before anything else.

## What happened

A stack of cloth branches (PRs #135–#142 here, #26–#29 in Forge) added a
quality gate, a legacy-corrector rework, an opt-in XPBD solver and an asset
contract. Each PR passed its tests, and several moved the gate numbers the
right way. Captured beside master with the same tool, avatar (`fem_vroid`),
four poses and four cameras, none of it looked better than master on the three
pilot garments, and some of it looked worse.

| Garment | Default page on the stack vs master                                     | Opt-in `?cloth=xpbd` vs master        |
| ------- | ----------------------------------------------------------------------- | ------------------------------------- |
| A-line  | standing same; **seated worse**: skirt leaves the lap, hangs behind the knees | **worse** standing and seated     |
| Pencil  | standing same; **seated worse**, the same way                           | **worse**                             |
| Pleated | about the same                                                          | about the same (it falls back)        |

Sheets (rows: master, stack default page, stack with `?cloth=xpbd`; front and
right per pose): `captures/2026-11-08/master-vs-branch-{aline,pencil,pleated}.webp`.

The seated default-page regression comes from the stack's changes to the legacy
corrector (`PoseClothCorrection.js`, +587 lines: `b345da3`, `07ed700`,
`a901d04`, `017aec6`). It was not visible in that stack's own numbers, because
master does not report them.

## What this branch keeps, and why

| Kept                                                    | Why it is safe and useful                                                                                                  |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `audits/wardrobe_sitting_desk/capture.py`, `quality.py` and their tests | Drove master unchanged and produced every picture above. Tooling only; nothing in the page loads it.       |
| `audits/wardrobe_sitting_desk/compare_with_master.py` (new, tested) | Builds the master-vs-candidate sheet that caught the regression. The first output a cloth change should produce. |
| `docs/physics/ADDON_ADOPTION_MATRIX.md`                 | Measured, installed-package evidence for meshoptimizer, Rapier, three-mesh-bvh, Jolt and Ammo. Still true from master.    |
| This file and the three sheets                          | The reference and the rule.                                                                                                |

## What it deliberately leaves out

| Left out                                                        | Reason                                                                                                                                                             |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Legacy-corrector changes from #136, #137, #140                  | Seated A-line and pencil regress against master                                                                                                                    |
| The XPBD runtime (#138, #140) and its fixes M1/M2 (#142)        | Every pilot pose looks worse than master. M1 (keep the file vertex order for WCL1 meshes) and M2 (pose-space rests, fitted thigh capsules) are correct fixes, but they only matter once a solver consumes WCL1, and nothing on master does |
| Forge cloth asset (#27, #28) with SB1/PA1 (#29)                  | Metadata only; master's viewer never reads it. It stays in Forge #29 until a viewer change is ready to use it                                                     |

Nothing is lost: those branches and PRs stay open, as drafts, with their
evidence.

## Mistakes not to repeat

1. **Numbers without master are not evidence of improvement.** A change can
   lower penetration and still look worse. Capture master first.
2. **A gate pass is not a picture pass.** The standing A-line on XPBD read
   1.28x stretch with a flap sticking out of her hip.
3. **Fix the data before the solver.** three-vrm renumbered cloth vertices
   (9.29x stretch), Forge called a 1 mm shell offset a missing seam, and a dress
   was pinned by its neckline. No solver, ours or Rapier, survives those.
4. **Do not stack fixes on an unverified base.** Each PR in the stack was
   judged against the one below it, never against master.
5. **Do not move the default page with an experiment.** Opt-in flags are cheap.
   The default page is what people see.

## Prove three garments before the full catalog

`audits/wardrobe_sitting_desk/prove_three_garments.py` is the procedure as one
command. It captures the three pilots with the agreed shape (`--source
catalog`, `fem_vroid.vrm`, four poses, four cameras), checks that each catalog
name still resolves to its template, writes `<prefix>-summary.json` and `.md`,
and, given master's captures, a master-versus-candidate sheet per garment.

| Key       | `--only`       | Template                |
| --------- | -------------- | ----------------------- |
| `aline`   | `A-line dress` | `dress-a-line-v1`       |
| `pencil`  | `Pencil skirt` | `skirt-pencil-v1`       |
| `pleated` | `Pleated mini` | `skirt-pleated-mini-v1` |

```bash
# master, once (master viewer on :8081, Forge main on :8091)
python audits/wardrobe_sitting_desk/prove_three_garments.py \
  --url http://127.0.0.1:8081/ --forge-url http://127.0.0.1:8091 \
  --out-prefix /tmp/cloth-master
```

```bash
# the candidate (this checkout on :8080, a local Forge built from your branch on :8090)
python audits/wardrobe_sitting_desk/prove_three_garments.py \
  --url "http://127.0.0.1:8080/?cloth=xpbd" --forge-url http://127.0.0.1:8090 \
  --out-prefix /tmp/cloth-contract --reference-prefix /tmp/cloth-master
```

It exits 1 if any garment failed to capture or resolved to another template.
It never decides that a garment is fixed: read the sheets.

On this branch `?cloth=xpbd` changes nothing — there is no solver here — so the
candidate run reproduces master. That is intended: it proves the procedure and
gives the baseline that the first solver commit must beat.

Run on 2026-11-08 with this branch on :8080, the Forge branch
`claude/clothing-physics-upgrade-9cq16j` on :8090, and master's captures as
reference: all three garments captured, all three resolved to their templates,
exit 0, and every pose matches master in both views
(`captures/2026-11-08/baseline-{aline,pencil,pleated}.webp`,
`baseline-summary.md`). The gate column reads "not measured": this app reports
no cloth metrics without a solver, and the summary refuses to call that a pass.

## The same procedure, by hand

```bash
# 1. master, once per Forge + avatar combination
python audits/wardrobe_sitting_desk/capture.py --url http://127.0.0.1:8081/ \
  --forge-url http://127.0.0.1:8091 --avatar fem_vroid.vrm --source catalog \
  --only "A-line dress" --poses standing,sittingDesk,sittingWide,sittingCrossed \
  --views front,right,back,left --out /tmp/cloth-master-aline
```

```bash
# 2. the change, same flags, its own --url / --forge-url / --out
python audits/wardrobe_sitting_desk/capture.py --url http://127.0.0.1:8080/ \
  --forge-url http://127.0.0.1:8090 --avatar fem_vroid.vrm --source catalog \
  --only "A-line dress" --poses standing,sittingDesk,sittingWide,sittingCrossed \
  --views front,right,back,left --out /tmp/cloth-change-aline
```

```bash
# 3. side by side
python audits/wardrobe_sitting_desk/compare_with_master.py \
  --reference /tmp/cloth-master-aline --candidate /tmp/cloth-change-aline \
  --label "my change" --out /tmp/aline-master-vs-change.png
```

Repeat for `Pencil skirt` and `Pleated mini`. A pose where the change looks
worse than master is a regression and blocks the PR, whatever the gate says.
Run master with `git worktree add <dir> origin/master` and its own
`node nexus-proxy/server.js` on another port; run Forge `main` the same way
(`python -m uvicorn apps.api.main:app` from its worktree, so the installed
package is not picked up instead).

## Where the next work starts

From this branch, in order, each compared with master before review:

1. The asset contract with no runtime consumer yet (Forge #27–#29), merged only
   because it changes no geometry hash.
2. One opt-in solver change at a time, A-line first, with M1 and M2 from #142
   as its first commits, judged by the sheet above.
3. The seated lap problem on the default page, starting again from master's
   corrector rather than from the stack's.
