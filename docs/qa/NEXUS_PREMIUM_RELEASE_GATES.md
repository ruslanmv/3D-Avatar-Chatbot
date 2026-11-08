# NEXUS premium release gates

What must be true before the premium adult experience ships to paying users, and what is true today.
Technical gates are this repository's; commercial gates have owners outside it and are **not** closed by
code. Status: **PASS** (evidence linked), **OPEN** (work remains), **N/A here** (not decidable in this
repository).

## 1. Technical

| # | Gate | Status | Evidence |
| --- | --- | --- | --- |
| T1 | `npm run validate` exits 0 | PASS at the AX7–AX8 commit | gate log in the commit's session |
| T2 | Parity harness unchanged except recorded line moves | PASS | `node scripts/behavior-parity-baseline.mjs --check` |
| T3 | Every style has its own story pool; every line passes `Beats.line` | PASS | `tests/private-world/presentation.test.js` |
| T4 | Presentation bounded, applied through existing owners, reset on stop, overridden by care | PASS | `presentation.test.js`; browser measurement in the model evaluation |
| T5 | Face holds the resting expression between turns | PASS (fixed in AX7) | `tests/behavior-engine-facetrack.test.js`; lab measurement |
| T6 | Gaze follows the style | OPEN — declared, not applied | `NEXUS_EXPERIENCE_PROFILE_CONTRACT.md` |
| T7 | Deterministic scorer ≥ 90 mean on the release route, EN and IT | OPEN — free-fast · it scored 81; no route is pinned yet | `NEXUS_CHARACTER_MODEL_EVALUATION.md` |
| T8 | One model per session (pinned route, or served model stable across turns) | OPEN | evaluation: the free routes switch backends between turns |
| T9 | Human rubric: no 0 in A, no fail in D, two reviewers, both languages | OPEN — no human scores recorded | `NEXUS_PREMIUM_EXPERIENCE_SCORECARD.md` |
| T10 | Device check on a real phone and a Quest | OPEN | none for AX7 |
| T11 | Private UI layout at four sizes | PASS | `docs/qa/PRIVATE_PREMIUM_UI_VISUAL_QA.md` |

## 2. Authorization and privacy

| # | Gate | Status |
| --- | --- | --- |
| S1 | Adult attestation enforced by the server, not only the client (`blackboard.adultVerified` is written from the server's message; the server must also refuse) | OPEN — see `docs/qa/PRIVATE_WORLD_RELEASE_READINESS.md` |
| S2 | Age assurance method chosen and reviewed for each market | N/A here |
| S3 | Avatar adult declaration from the operator for every avatar offered | PASS for the public catalog and Forge library (PW8) |
| S4 | Deployment tier set by the site, never storage; nothing above `sensual` without attestation | PASS — `tests/private-world/adult-experience.test.js` |
| S5 | Private turns never persisted; Clear forgets | PASS |
| S6 | Lab reports carry no token and no personal data | PASS — the harness reads the token from env/file and redacts long strings |

## 3. Commercial (owners outside engineering)

| # | Gate | Owner | Status |
| --- | --- | --- | --- |
| C1 | Each provider's acceptable-use terms checked for the tier the deployment names, for the model actually served (routes are aliases — check the backends, not the alias) | Legal / partnerships | N/A here |
| C2 | Legal review per market (adult content, consumer protection, payments) | Legal | N/A here |
| C3 | AI transparency: the person is told she is an AI where required; a sincere question is always answered truthfully (enforced in the prompt, AX6) | Product + Legal | Prompt PASS; disclosure copy N/A here |
| C4 | Crisis wording and help numbers reviewed by someone trained in crisis support, verified per market | Trust & Safety | OPEN (`docs/backlog/CARE_MODE_PLAN.md` step 9) |
| C5 | Payment and subscription terms | Business | N/A here |

Restricted capabilities (`mature`, `explicit` tiers) stay off in every build until S1, S2, C1 and C2 are
closed for the deployment that turns them on. Nothing in this repository turns them on.
