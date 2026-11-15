# Bare-body eligibility matrix: eight library characters + the reference body

2026-11-15. Forge `feat/bare-base-body` @ `4a77eed` (in Forge `ultimate`). Evidence is read from
the repository and from Forge's own audit tools (`tools/audit/bare_visibility.py`); no nude
render of a library character was made. This corrects the earlier readiness report, which
merged four separate questions into one statement about adult status.

## The four concerns are separate

| # | Concern | Where it lives | Who decides |
|---|---|---|---|
| 1 | Declared adult status | `assets/library/policy.json` (`depictsAdult`) | the operator |
| 2 | Visual adult-design review | `assets/body_surface/adult-design-reviews.json`, keyed by the file's SHA-256 | a person reviewing the exact file |
| 3 | Author permissions | the VRM's own licence metadata | the model's author |
| 4 | Technical body completeness | Forge's geometry checks and renders | measurement |

An adult declaration (1) does not settle (2) or (3), and (2) does not override (3).

## Per character

| Character | 1 Declared adult | 3 Author licence (sexual expression) | 2 Design review | 4 Bare path (AF5 code) | Bare look in dataset |
|---|---|---|---|---|---|
| AvatarSample A | yes, operator 2026-11-07 | VRM 0.x `Allow`, everyone, commercial allowed | **empty** | builds: tops, bottoms, shoes removed; skin restored; 214 accessors byte-identical | none |
| AvatarSample B | yes, 2026-11-07 | `Allow`, everyone | **empty** | builds: same removals; 218 accessors identical | none |
| AvatarSample C | yes, 2026-11-07 | `Allow`, everyone | **empty** | builds: same removals; 255 identical | none |
| VRoid Female | yes, 2026-10-23 | `Allow`, everyone | **empty** | builds: clothing is painted, nothing to remove; skin restored; 133 identical | none |
| VRoid Male | yes, 2026-11-07 | `Allow`, everyone | **empty** | builds: as VRoid Female | none |
| AvatarSample O | yes, 2026-11-13 | VRM 1.0 `allowExcessivelySexualUsage: true` | **empty** | **refused**: `body-incomplete-for-bare` | none |
| Model Girl | yes, 2026-11-13 | VRM 1.0 `true`, modification and redistribution allowed | **empty** | builds: removes tops, bottoms, one-piece, shoes; **skin not restored** (see below) | none |
| Rinna | yes, 2026-11-13 | `Allow` (VRoid Hub terms: sexual expression allow) | **empty** | builds: clothing painted; skin restored; 126 identical | none |
| `ref-f-median` (generated) | yes, `assets/calibration/policy.json` | operator's terms: `true` (AF5) | n/a: synthetic body, no design to review | builds | none (test fixture) |

Common to every row that builds: 0 VRM expression binds lost, 0 morph-count changes, no
material alpha-mode change, no censor geometry (there is none in Forge or the app).
Anatomical detail: none of the eight has authored genital or nipple detail in the source
(`docs/qa/ANATOMY_SOURCE_INVENTORY.md`), so removal reveals a smooth body; that is the source
asset's limit, not a removal defect. No library character has a bare look in the dataset (all
eight prebuilt wardrobes checked).

### Correction to the earlier report

- A and B were reported as refused (`body-incomplete-for-bare`). That was the ankle false
  positive AF5 fixed in `body_integrity.py` (a closed ankle read 56–62 %). With the fix both
  build. They are **no longer technically blocked**.
- The statement that none of the characters was established as adult conflated concerns 1 and
  2. All eight are declared adult by the operator (1); what is empty is the separate
  design-review registry (2).
- Concern 3 passes for all eight: each file's own terms permit sexual expression.

## Confirmed technical blockers (concern 4)

- **AvatarSample O: incomplete body.** The upper-torso check fails in two bands:
  `upper: [1.0, 1.0, 0.0, 0.69, 1.0, 1.0]` (bands bottom to top; 0.0 is no skin at all, 0.69
  is a partial ring). The legs and pelvis are complete (0.94–1.0). The mid-chest is missing
  from the authored mesh: the body was deleted under the clothes, which is why Forge refuses.
  Whether it can be corrected: only by **adding geometry that the authored body does not
  contain**. Forge has a body-completion step (BC1), but `body-bare-v1` is authored-only by
  design (no BC1, no proxy), so reconstruction would be a separate, opt-in feature that
  creates new surface rather than removing clothes, and its result would be a generated
  chest, not O's authored one. It needs your approval as new scope; it is not a bug to patch.
- **Model Girl: skin not restored.** Removal succeeds (4 slots), but Forge reports
  `skinRestored: false`: her body's skin texture was not repainted where clothing was
  painted. Likely visible as leftover painted-on clothing texture; needs a render to confirm
  and a look at `wardrobe/vrm/skin_restore.py` for this file. **Unresolved defect candidate.**
- **Everyone: no bare look exists.** A bare look must be prebuilt by the operator
  (`tools/prebuild.py --only body-bare-v1 --slugs <slug>`, with
  `WARDROBE_ADULT_BODY_SURFACE=true` and an admin session). Until then the app answers
  `no-bare-look`.
- **The adult-body-surface switch is off by default** (`wardrobe_adult_body_surface: False`)
  and is not set on the deployed Space.

## What is missing: implementation, approval, or a defect

| Item | Kind |
|---|---|
| Visual adult-design review of each character's exact file (hashes below) | **Missing approval** (a person's decision; I have not recorded one) |
| `WARDROBE_ADULT_BODY_SURFACE=true` on the Forge that prebuilds | **Missing configuration** (operator) |
| A prebuilt bare look per character | **Missing step**, blocked behind the review |
| Mid-chest of AvatarSample O | **Missing authored geometry** (needs a new, opt-in scope) |
| Model Girl `skinRestored: false` | **Possible rendering defect**, unconfirmed |
| Bare identity through Forge's API, registration, confirmation against the renderer | **Implemented** (Forge BL1, chatbot BL2), tested |
| Detailed anatomy | **Missing in every source asset**; not something removal can supply |

## Files to review (concern 2): SHA-256 as the registry keys them

| Character | File | SHA-256 (first 12) |
|---|---|---|
| AvatarSample A | `assets/library/AvatarSample_A.vrm` | `b86b0b8a66d4` |
| AvatarSample B | `AvatarSample_B.vrm` | `4a271bd3b5a3` |
| AvatarSample C | `AvatarSample_C.vrm` | `395d5b04696e` |
| VRoid Female | `fem_vroid.vrm` | `983631034570` |
| VRoid Male | `masc_vroid.vrm` | `ac5e30b9f875` |
| AvatarSample O | `vroid/vroid-avatar-sample-o.vrm` | `e5c0395b59b6` |
| Model Girl | `vroid/vroid-model-girl.vrm` | `1a298a534c54` |
| Rinna | `vroid/vroid-rinna.vrm` | `d88320f4b005` |

A review entry needs `outcome: "clearly-adult"`, reviewer, date and evidence for the exact
file. It is the reviewer's judgement of how the character is drawn; an age declaration does
not substitute for it, and this report does not supply one.

## Stage verdicts

| Stage | Verdict |
|---|---|
| Bare identity, registration, no cache bypass, honest app states (Forge BL1, chatbot UN19/BL2) | **PASS** (tests) |
| Synthetic adult reference body `ref-f-median`: removal, 5-angle render, redress | **PASS** (private screenshots, AF5) |
| Library characters: operator adult declaration | **PASS** (all eight) |
| Library characters: author licence | **PASS** (all eight) |
| Library characters: visual design review | **NOT DONE** (registry empty) |
| Library characters: body completeness | A, B, C, VRoid F/M, Rinna **PASS**; Model Girl **PASS with an open skin-restore question**; O **FAIL** (mid-chest missing) |
| Library characters: a bare look exists | **FAIL** (none) |
| Library characters: renderer validation of a bare look | **NOT RUN** (no bare look; pending review) |
| In-app dressed → bare → redressed with a library character | **NOT RUN**, same reason |

## Commands

```bash
# Body completeness and removal per library character (reads only):
cd 3D-Wardrobe-Forge && python tools/audit/bare_visibility.py        # → work/af4-bare-audit.json

# Reference body (synthetic, declared adult): the QA driver builds ref-f-median with
# wardrobe.anatomy.vrm.build_reference_vrm, dresses it through the orchestrator, runs the real
# body-bare-v1 job, and renders five angles plus redress through Forge's own viewer
# (tools/anatomy/render_reference.py: render()). The driver and its screenshots are kept in
# private storage, not in either repository.

# After a design review is recorded and the switch is on, one bare look per character:
WARDROBE_ADULT_BODY_SURFACE=true python tools/prebuild.py --forge <url> \
    --admin-token-file <file> --only body-bare-v1 --slugs <slug>

# Forge tests: bare body, gate order, cache bypass, bare identity and registration:
python -m pytest tests/integration/test_bare_body.py tests/unit/test_bare_prebuild.py \
    tests/unit/test_body_surface.py tests/unit/test_prebuilt_plan_key.py \
    tests/unit/test_cache_key_stability.py
```
