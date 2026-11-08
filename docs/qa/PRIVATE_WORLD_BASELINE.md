# Private World — baseline before PW

What the branch did before any PW change, reproduced on 2026-11-07 at
`bbf38f3` (the engine documentation commit). Every later number in the PW
reports is compared with this.

## Environment

| Item | Value | Note |
| --- | --- | --- |
| Node | v22.23.4 | **The repository pins 24.x**; `npm ci` warns `EBADENGINE`. Not Node 24: a gap, recorded |
| npm | 10.9.9 | CLAUDE.md asks for npm 11 when regenerating the lockfile; nothing was regenerated |
| CPU | 4 cores, Linux 6.18 x86_64 | cloud container |
| GPU | none — Chromium uses **SwiftShader** (software) | every frame number below is software rendering, not hardware |
| Headset | none | no Quest, no Link: no hardware evidence of any kind |

## Commands and results

| Command | Result | Time |
| --- | --- | --- |
| `npm ci` | exit 0; 10 vulnerabilities reported (6 low, 1 moderate, 2 high, 1 critical) | 5 s |
| `npx jest tests/living-worlds tests/engine-docs.test.js` | 94 tests, 3 suites, all passing | 0.6 s |
| `npm run validate` | **exit 0**: lint clean, format clean, **5923 tests in 268 suites** | 36 s total (Jest 22.4 s) |
| `node scripts/behavior-parity-baseline.mjs --check` | OK — the engine is inert with the flag off | <1 s |
| `npm start` | serves on :8080 | — |

`npm run validate` prints 120 `console.warn` lines. They are the fail-soft
pattern working as designed (a refused manifest, a missing optional module),
not failures.

## Browser baseline (headless Chromium, SwiftShader)

The Living Worlds apartment (`place-apartment`), driven by the person's words
through `WorldPresence.observeUser`, on two profiles:

| Profile | Spot moves confirmed | Time per move | World loads |
| --- | --- | --- | --- |
| desktop 1440×860 | 8 / 8 | 0.9–1.4 s | 1 |
| iPhone 13 (Playwright profile) | 8 / 8 | 1.0–3.7 s | 1 |

"Time per move" is request → renderer-confirmed `spotId`, which includes the
fade through black. Software rendering; not a hardware figure.

## What the audit found before writing code

1. **The Intimate activity never checked whether the avatar is declared
   adult.** Its own comment said an avatar Forge declares adult "already
   stand[s] in front"; nothing in its path did. Fixed in PW1.
2. **Private eligibility is a device-local self-declaration**
   (`SpicyGate`: `enabled && verified`, both from this browser). Not changed:
   it is the existing product's consent model. The new Private World does not
   rely on it alone; it also requires deployment configuration and a server
   attestation, and is therefore off in every build.
3. **`nexus-world-request` is a plain `CustomEvent`.** Any page script can
   send one. It cannot open Private on its own (four other conditions), but
   it is not authentication. Documented in the security matrix (item 5).
4. **The private cabaret had no measured spots.** `tools/vr/spot-targets.json`
   said private rooms were not listed. Measured in PW2.
