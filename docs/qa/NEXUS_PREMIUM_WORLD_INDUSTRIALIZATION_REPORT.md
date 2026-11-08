# NEXUS Premium Private World: industrialization report

Branch `feat/living-worlds-spatial-storytelling`. Base: `bbf38f3` (engine
documentation). No pull request was opened, nothing was merged, and history
was not rewritten.

**Verdict: the engine is built and tested. The feature is off in every build
and NOT production-ready.** The blockers belong to backend, legal, device QA
and model choice, not to this client code
(`PRIVATE_WORLD_RELEASE_READINESS.md`).

## 1. What was built

| Phase | Result |
| --- | --- |
| A, baseline | Reproduced: `npm run validate` exit 0, 5923 tests in 268 suites; parity OK; apartment walkthrough 8/8 on desktop and the phone profile (`PRIVATE_WORLD_BASELINE.md`) |
| B, audit | Intimate never checked the avatar's adult declaration (fixed, PW1). Private eligibility is a device-local self-declaration (kept; the new room requires more). `nexus-world-request` is forgeable (documented). The cabaret had no spots (measured, PW2) |
| C, flagship | **Private Sanctuary** in the existing licensed private cabaret: 5 measured spots on desktop, 3 on the phone variant, all from the real GLBs |
| D/E, adapter | `PrivateWorldAdapter`: a five-answer gate that fails closed and re-checks at every step; revocation on every exit; six interactions run through their real owners and narrated only after confirmation; only Private's own prompt hears the room |
| F, contracts | Experience config with validator and consuming runtime; gate answers; deployment switch; avatar declaration; offer tags; events. PARTIAL and PROPOSED shapes are marked (`docs/engine/PREMIUM_INTERACTION_CONTRACTS.md`) |
| G, QA | Unit, deterministic, browser and real-model evidence kept separate; 20-item security matrix; SwiftShader performance labelled as such; rubric |
| H, docs | Four engine docs, a template validated by a test, six QA docs, AI_CODER_START_HERE and CLAUDE.md |

## 2. Commits

| Commit | Subject |
| --- | --- |
| `98fa1be` | PW1: Intimate refuses an avatar Forge has not declared adult |
| `266898f` | PW2: measured spots for the private cabaret (both variants) |
| `47b3b83` | PW3: Private World, a gated premium room inside Private, off in every build |
| `ca253da` | PW4: one consent exit is one revocation; ten deterministic scenarios |
| `aa167c9` | PW5: the room hears Private's own turns; stale answers are dropped |
| `2107db2` | PW6: what the real-model walkthroughs showed in the Private card |
| (this commit) | PW7: Private World documentation, QA evidence and report |

One honest note on history. `2107db2` included the `tests/engine-docs.test.js`
change that names the new engine docs, and the docs arrive one commit later.
At `2107db2` alone, that one doc test fails; at the next commit everything
passes. History was not rewritten to hide it.

## 3. Commands and counts

```bash
npm ci
npx jest tests/private-world tests/living-worlds tests/engine-docs.test.js
npm run validate
node scripts/behavior-parity-baseline.mjs --check
```

| | Baseline (`bbf38f3`) | Now |
| --- | --- | --- |
| `npm run validate` | exit 0, 5923 tests, 268 suites | **exit 0, 6013 tests, 273 suites** |
| `tests/private-world/` | did not exist | 75 tests in 5 suites: unit, scenarios (10), security matrix, attach, avatar declaration |
| Parity check | OK | OK: the engine is inert with the flag off |

Environment: Node v22.23.4 (the repository pins 24.x), npm 10.9.9, 4 cores,
no GPU (SwiftShader), no headset.

## 4. Performance (SwiftShader: counts only)

| | Desktop `private-cabaret` | Phone profile `private-cabaret-light` |
| --- | --- | --- |
| Draw calls, her + room | 28 | 26 |
| Triangles per frame, her + room | 108,270 | 65,450 |
| Scene triangles | 68,044 | 25,160 |
| Intimate start → gate open | 3.0 s | 3.2 s |
| Three enter/exit cycles | no growth (36 geometries, 148 textures) | no growth (34 / 148) |

Frame times on SwiftShader are about 350 ms and mean nothing for a GPU. The
Quest 72 Hz (13.9 ms) budget is **untested**
(`PRIVATE_WORLD_VR_PERFORMANCE.md`).

## 5. Screenshots

All are non-explicit, in `docs/images/private-world/`, SwiftShader:

- `pw-desk-arrive.jpg`: arrival in the cabaret, desktop
- `pw-ai-desk-dance.jpg`: a real model's turn; she dances by the curtain, and
  the "Stop dancing" chip is lit
- `pw-ai-desk-where.jpg`: "Dove siamo adesso?"; she names the curtain and the
  spots around it
- `pw-ai-phone-what-can-we-do.jpg`: the phone profile; also the evidence for
  defect D5
- `pw-ai-phone-dance.jpg`: the phone profile, dancing

## 6. Defects

Found and fixed on this branch:

| # | Found by | Defect | Fixed in |
| --- | --- | --- | --- |
| 1 | audit | Intimate started with any avatar, including ones Forge has not declared adult | PW1 |
| 2 | measurement | the stage deck, footlights and curtain gave no spot (v4 aim) | PW2 (tool v5) |
| 3 | browser | the room's presence read a companion session Private never starts: no "where you are" | PW3 |
| 4 | browser | the room's tone was clipped mid-word at 80 characters | PW3 |
| 5 | browser | the room was told lights cannot be switched while it offered light changes | PW3 |
| 6 | browser | one consent exit revoked twice | PW4 |
| 7 | real model | the room never heard Private's turns; she claimed a light change nobody made | PW5 |
| 8 | matrix 8 | an answer after revoke-and-reopen, or in the other variant, was narrated | PW5 |
| 9 | matrix 8 | a move landing after Clear was narrated (the public apartment too) | PW5 |
| 10 | real model | `[[emote:` from a cut-off reply shown in the card (`sanitizeReply` restored it) | PW6 |
| 11 | real model | asked for an absent spot, her `<go/>` moved them elsewhere without a yes | PW6 |

Open:

- **D3:** the free model once answered with its own reasoning (model quality).
- **D5:** on a phone, the venue chips and the Private card cover her.
- **O1:** after the exit, the public media capability played a video she
  called "a golden-light ambience".
- **Matrix 5:** a forged `nexus-playground-action` can fake a dance
  confirmation.

## 7. Blockers to production

1. Server-side enforcement of eligibility for every private prompt and asset.
2. Age assurance per market, with attestation lifetime and revocation.
3. Compliance review.
4. Hardware testing on Quest 3 (native and Air Link) and a real phone.
5. Human evaluation with the rubric.
6. Model quality in Private.
7. Dependency audit (`npm ci`: 1 critical, 2 high).
8. Node 24.
9. Phone layout (D5).

Each has an owner in `PRIVATE_WORLD_RELEASE_READINESS.md`.

## 8. Final gate

At the PW7 commit:

- `npm run validate`: exit 0. Lint clean, format clean, 6013 tests in 273
  suites.
- `node scripts/behavior-parity-baseline.mjs --check`: OK.
