# Private World — release readiness

**Verdict: NOT production-ready. Do not enable it on any deployment.**

The engine work is done and tested, and the feature stays off in every build
until the blockers below are closed by the people who own them. It is off
because no build sets `NEXUS_PRIVATE_WORLD_CONFIG`, and no session in this
repository receives a real server attestation. Nothing about it is
user-reachable today.

## What is ready (evidence in the other QA docs)

- The gate fails closed on all five conditions. It is re-checked at every step
  and revokes on consent exit, Clear, End, session end and detach.
- The avatar must be one Forge declares adult (PW1). This also hardens the
  existing Intimate experience, which previously did not check.
- Six interactions run through their real owners and are narrated only after
  confirmation. Stale answers are dropped. A pending step is described as
  pending.
- Five measured spots on desktop and three on the phone variant; nothing is
  typed.
- No private field reaches Copilot, Life, Experiences or the public presence.
- The config is data that cannot grant anything.
- Unit tests: 6013 in 273 suites, `npm run validate` exit 0 (the private-world suites hold 75).
  Deterministic scenarios: 10/10. Browser walkthroughs: desktop and iPhone 13
  profile. Real-model walkthroughs: desktop and iPhone 13 profile.

## Blockers

| # | Blocker | Owner | Why it blocks |
| --- | --- | --- | --- |
| 1 | **Server-side enforcement.** The model gateway must refuse private prompts, and the asset server must refuse private assets, for any session without a valid, unexpired attestation | backend / platform | Every check in this repository is client-side; a person can unlock their own page from the console (`PRIVATE_WORLD_SECURITY_MATRIX.md`) |
| 2 | **Age assurance.** Choose and integrate an age-assurance method per market, and define attestation lifetime, revocation, appeal and logging | legal + product + backend | Existing Private eligibility is a device-local self-declaration; the mission states that is insufficient for a commercial service |
| 3 | **Compliance review** of the adult experience per market: terms, content policy, record keeping, operator declarations of `depictsAdult` | legal / trust & safety | Not an engineering decision |
| 4 | **Hardware testing** on a Quest 3 (native browser and Air Link) and a real phone: frame pacing at 72 Hz (13.9 ms budget), comfort, the curtain spot's absence on the light variant, End reachable in VR | QA with devices | Every frame number here is SwiftShader software rendering (`PRIVATE_WORLD_VR_PERFORMANCE.md`) |
| 5 | **Human experience evaluation** with the rubric (`PRIVATE_WORLD_EXPERIENCE_EVALUATION.md`), by people, on hardware | product / UX research | The rubric's human rows are unscored |
| 6 | **Model quality in Private.** On the free model, one reply leaked its reasoning ("The user said 'sì'… The assistant responded…"), and replies are often cut by the token budget | model / provider choice | Visible to the person; not something the client can fix |
| 7 | **Dependency audit.** `npm ci` reports 10 vulnerabilities (1 critical, 2 high) | maintainers | Must be triaged before shipping anything new |
| 8 | **Node 24.** These runs used Node 22.23.4; the repository pins 24.x | CI / maintainers | Release evidence should be on the pinned runtime |
| 9 | **Phone layout.** In the private room on a phone profile the venue chips dock across her face and the Private card covers most of her (evaluation D5) | UX / front end | Fails "overlays readable without covering the avatar"; must be checked on a real phone |

## Not blockers, but known

- A forged `nexus-playground-action` can make the room believe a dance
  started (matrix 5). It is narration only, not access, and is covered by
  blocker 1.
- Matrix 12 (memory across cycles) has one measured run of three cycles on
  SwiftShader; see the performance doc. It is not measured on hardware.
- Only one experience config is loaded (`private-sanctuary.json`); one config
  per world is a PROPOSED change.

## Rollback

The feature is off by default; removing the deployment config turns it off. To
remove it from the code:

- revert PW3–PW6
- keep PW1: it fixes the existing Intimate path

PW2 (spots) is inert data.
