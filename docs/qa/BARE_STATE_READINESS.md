# Bare wardrobe state: what is verified, what is blocked

2026-11-15. Chatbot `ultimate` @ `55c4a7d`; Forge `ultimate` @ `e284cfe` (contains
`feat/bare-base-body` @ `4a77eed`). Nothing is merged to `master` / `main`, no PR is open,
and the Forge Space still runs Forge `49788ec` (before the bare-body merge).

> **Superseded** for the per-character status by `BARE_PRODUCTION_READINESS.md`. **Corrected
> by `BARE_ELIGIBILITY_MATRIX.md`:** all eight characters are declared adult by the
> operator and their own licences allow sexual expression; AvatarSample A and B build since the
> AF5 fix; the open items are the design review (empty), AvatarSample O's missing mid-chest, a
> Model Girl skin-restore question, and the absence of any prebuilt bare look.

## Verdict

| Area | Status |
|---|---|
| Dressed / lingerie / bare as separate states in the app (UN19) | **Done, tested** |
| "Everything off" never becomes lingerie; honest refusal when no bare look | **Done, verified in the real app** |
| Forge `body-bare-v1` on an eligible adult body (`ref-f-median`) | **Verified visually** (5 angles, pose, redress) |
| A bare request can never be served from a stale cache | **Proven by test** |
| Bare state rendered **inside the app** | **Not verified: blocked** (no eligible character with a bare look) |
| Detailed genital anatomy | **Not available**: no source asset contains it |
| Merge readiness, chatbot `ultimate` → `master` | **Ready for review** (gate green, 6688 tests) |
| Merge readiness, Forge `ultimate` → `main` | **Ready for review** (merged-tree suites green: 151 + 229) |
| The bare feature as a product capability | **NOT READY** (see blockers) |

## What the app does now (chatbot `55c4a7d`, real Grok via OllaBridge, deployed Space)

Replayed from the reported session, six frames kept privately (not in this repository):

| Step | Request | Wardrobe action | On the avatar |
|---|---|---|---|
| 1 | "Andiamo a albergo" | — | hotel suite, original outfit |
| 2 | "Togliete vestiti" at Caldo | `undress` blocked / `pace` | unchanged; "Non ancora, è troppo presto." |
| 3 | "Togliete vestiti" at the top level | `undress` completed, state `lingerie` | black guêpière, stockings, shoes: **lingerie, not bare** |
| 4 | "Togliti tutto, ti voglio nuda" | `undress` failed / `no-bare-look` | **unchanged**; "Mm, non è andata. Per ora resto così." |
| 5 | "Rivestiti" | `redress` completed | original outfit |
| 6 | End | — | original outfit, session closed |

The earlier contact sheet `repro-fixed.jpg` (chatbot `1914dc6`) shows step 3 only: it is a
lingerie change, and calling it "undressed" was wrong.

## Per character

"Removal" and "complete body" are from Forge's AF4 audit (`docs/qa/BARE_VISIBILITY_AUDIT.md`
in Forge); anatomy from `docs/qa/ANATOMY_SOURCE_INVENTORY.md`.

| Character | Garment removal | Authored body complete | Genital / nipple anatomy in the source | Bare look in the dataset | In-app bare |
|---|---|---|---|---|---|
| AvatarSample A | builds since AF5 (was refused) | yes | none | no | honest refusal |
| AvatarSample B | builds since AF5 (was refused) | yes | none | no | honest refusal |
| AvatarSample O | refused | no: mid-chest missing | none | no | honest refusal |
| AvatarSample C | builds | yes | none | no | honest refusal |
| VRoid Female / Male | builds (clothing is painted; skin restored) | yes | none | no | honest refusal |
| Model Girl | builds | yes | none | no | honest refusal |
| Rinna | builds | yes | none | no | honest refusal |
| `ref-f-median` (Forge reference body) | builds; tops and bottoms removed | yes | none (by design) | not a library character | not an app character |

No character has authored genital anatomy, so removal cannot reveal any: a bare body of any
of them is a smooth body. That is failure type 3 in the brief (the source lacks it), not a
visibility or censoring defect. Nothing in the pipeline censors, blurs, covers or strips
authored anatomy: a material labelled anatomical is kept byte-identical and reported
(`keptAnatomicalMaterials`), with a test.

## Blockers

1. **No eligible character has a bare look.** A bare job needs an operator session in Forge,
   so a bare look reaches the app only as a prebuilt private look. None has been prebuilt.
   For the current stylised library characters this was not done: none is established as
   clearly adult in design (Forge's `adult-design-reviews.json` is empty), and bare versions
   of them were not produced.
2. **The reference body is not a companion.** `ref-f-median` passes the whole bare path, but
   it is not in Forge's avatar library, and the app's Private wardrobe opens only for a
   library avatar Forge declares adult. Verifying the bare state in the app needs a
   clearly adult character in that library with a prebuilt bare look.
3. **Detailed anatomy needs a different source asset**: a clearly adult model, licensed for
   adult use, with the anatomy already authored. `body-bare-v1` stays authored-only; new
   anatomy authoring was not done and is a separate decision.
4. **Deployment.** The Space does not yet run the merged Forge; the live Vercel app runs
   `master`, without UN7–UN19 (its "Le tolgo tutte" with nothing changing is that old code).

## Tests run after the disk recovery

Chatbot: `npm run validate` exit 0, 6688 tests (includes UN19).

Forge merged tree (`ultimate`): reuse and plan keys, cache-key stability against
`tests/fixtures/prebuilt_key_baseline.json`, publishing, outfit dictionary, the bare-bypass
proof: 151 passed. Bare prebuild, body surface, bare body, prebuilt API, catalogue API:
113 passed. The full merged-tree list (prebuilt, bare prebuild, body surface, intimate
policy, haul library, anatomy reference, bare body, body-surface jobs, prebuilt API, catalogue
API, studio API) was then run to completion: 229 passed, exit 0.

The first combined run failed because the disk was full (0 MB), not on an assertion; it was
not counted as a pass. Recovery freed 15.1 GB of local look folders whose every file path
existed in the dataset (checksums were not compared); 38 unpublished looks were kept.

## Conflict resolutions in the Forge merge (`45749fe`)

- `orchestrator.py`: lookup by words key then plan key (RU1) kept; `_prebuilt_keys` returns
  nothing for `baseBody: bare`, so a bare request is neither answered from nor written to
  the cache. `prebuilt.lookup` has this one caller.
- `prebuilt.py`: merged wardrobe-list read (RU2) kept; bare prebuilds stay keep-existing.
- `tools/prebuild.py`: dictionary outfits and `body-bare-v1` each keep their own request body.

`PIPELINE_VERSION`, `cache_key` and the stored keys are unchanged.
