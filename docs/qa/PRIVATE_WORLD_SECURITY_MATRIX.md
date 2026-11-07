# Private World — security and reliability matrix

The mission's 20 cases, each with its evidence and an honest status:

- **Held**: a test fails if it breaks.
- **Held (client)**: held in this page, but a client-side check is not
  authorization; see the first section.
- **Partial**: a named part is not covered.

Test files are under `tests/private-world/`. "Browser" means the headless
Chromium walkthrough on SwiftShader (desktop 1440×860 and the iPhone 13
profile), never hardware.

## What client checks cannot do

Everything in this page runs in the browser. A person with the developer
console can:

- set `NEXUS_BD.blackboard.adultVerified = true`
- define `NEXUS_PRIVATE_WORLD_CONFIG`
- dispatch any event
- call the venue router directly

The gate makes the honest path correct and fail closed. It does **not** stop a
determined user from unlocking their own page. A commercial adult service must
therefore enforce eligibility **on the server**:

- the model gateway refuses a private prompt to a session without a valid,
  unexpired attestation
- private assets (the cabaret GLBs, private presets) are served only to such a
  session

That server side does not exist in this repository. It is release blocker 1.

**Age assurance is deployment-specific.** The deployment must decide, with
legal advice for each market, how adulthood is established. Options include
an accredited age-verification provider, or age estimation with a fallback to
verification. The deployment must also decide how long an attestation lasts,
how it is revoked, and what is logged. This repository's `adult_ack` message
only carries a boolean from the HomePilot server. Use OWASP ASVS 5.0 as the
application-security checklist, especially:

- V6 (authentication)
- V7 (session management)
- V8 (authorization)
- V16 (logging)

for that server side.

## The matrix

| # | Case | Status | Evidence |
| --- | --- | --- | --- |
| 1 | An unauthorized user cannot enter the Private world | **Held (client)** | `private-world.test.js` "1–3, 15" (each of five answers false → closed, no prompt, no action); `attach.test.js` (off without deployment config; avatar not declared adult); `avatar-adult.test.js`; browser: the default avatar AvatarSample A was refused with "Private is off for AvatarSample A: it has not been declared adult." |
| 2 | An invalid or expired eligibility state fails closed | **Held (client)** | `'true'`, `1`, `undefined` and a throw are all "no" (`private-world.test.js`, `security-matrix.test.js` 5); attestation removed mid-session closes and revokes at the next step (`private-world.test.js`, `attach.test.js`). Expiry itself is the server's: nothing here has an expiry time |
| 3 | Consent withdrawal stops Private behaviours immediately | **Held** | `adult:exit` and `private:session-stop` revoke on the event; light restored, dance stopped, presence reset (`private-world.test.js`, S8). Browser, through the panel: `adult.exit('hard')` → Intimate stopped, world removed (`activeId` null), one revocation, no room in any prompt. Real model: after the exit, "Mettiamo la luce dorata" changed nothing |
| 4 | A model-generated directive cannot authorize a restricted action | **Held** | `<act/>` is only an offer; her own "sì" accepts nothing; an unknown id is stripped (`private-world.test.js` "4, 16", S4, S10) |
| 5 | A fake browser event cannot impersonate trusted user consent | **Partial** | A forged `nexus-world-request` cannot open Private (`security-matrix.test.js` 5): `privateOpenNow` also needs Intimate, the consent flow and private mode, and the adapter never dispatches a world request. **Not covered:** a forged `nexus-playground-action` `started` makes the room believe a dance started. That is narration of a lie, not access, but it is not prevented; see "What client checks cannot do" |
| 6 | A world manifest cannot elevate its own security rating | **Held** | `private-world.test.js` "6": a general world is refused, not made private; any extra field (`rating`, `adultVerified`, `script`, `url`) refuses the whole config. The template test in `tests/engine-docs.test.js` does the same for the published template. World ratings are the catalogue's, validated by `VRWorlds.validateCatalogue`; `tests/vr-places.test.js` holds that a private world is refused everywhere except the `intimate` request |
| 7 | A failed scene load preserves the prior valid state | **Partial** | A failed move keeps the previous spot and says so (`private-world.test.js` "7", S7). Loading the world itself is the renderer's existing rule (VW: everything loads before the swap); it is not re-tested here |
| 8 | A stale async action cannot execute in a different world | **Held** | `security-matrix.test.js` 8: a dance confirmed after the world changed is dropped as `stale`; a move landing after a revoke-and-reopen is not narrated. `WorldPresence` already drops a move across a world change (LW3) |
| 9 | An unknown or unmeasured spot cannot be reached | **Held** | `private-world.test.js` "9" (unknown id and every `verified:false` spot → `unknown-spot`); S6 ("andiamo in camera da letto" moves nothing). Browser, phone: the curtain, unverified on the light variant, was not reached |
| 10 | An unsupported animation is never described as completed | **Held** | `private-world.test.js` "10" (refused dance → "did not happen"); sit, lie down, hold and touch are not interactions and the prompt says they are not possible; a pending step is "Happening now … do not say it is done" (`attach.test.js`) |
| 11 | Private state does not appear in Copilot or the general Playground | **Held** | `promptSuffix('copilot')`, `actOffer` and `goOffer` are empty; the public presence refuses the private world; the companion prompt for life/experiences/copilot has no private field (`private-world.test.js` "11", S9). Browser: `NEXUS_COMPANION.systemPromptSuffix()` had no room during the session |
| 12 | Repeated enter/exit cycles do not leak resources or leave animation state | **Partial** | `private-world.test.js` "12" (five dance-and-revoke cycles leave no state); one consent exit is one revocation. **Not measured:** GPU memory and listener counts across repeated real enter/exit in the page |
| 13 | A conversation reset removes temporary Private context | **Held** | `ConversationReset.onReset` revokes the room (`attach()`); `private-world.test.js` "13"; a move landing after a reset is not narrated (`WorldPresence`, `security-matrix.test.js` 8). Private's own card keeps its turns only in memory (P10) |
| 14 | Microphone, camera and tracking permissions remain optional and revocable | **Held** | The adapter asks for none and stores nothing (`security-matrix.test.js` 14). Private's voice input is the existing app's, unchanged |
| 15 | Desktop, mobile and VR keep consistent authorization | **Partial** | The gate is a pure function of the same five answers on every device. Browser: desktop and iPhone 13 profile gave the same refusals, the same opening and the same revocation. **Not tested in VR:** no headset, and the XR emulation harness was not run against Private |
| 16 | Prompt injection cannot alter trusted world state | **Held** | A typed `<act/>` and "ignore your rules" do nothing; a forged `<act id="unlock-adult"/>` and `<go place=…>` are stripped (`private-world.test.js` "4, 16", S10) |
| 17 | No transcript, token or tracking data in ordinary logs | **Held** for these modules | The adapter's only `console.warn` prints config problems; no log line carries a message or reply (`security-matrix.test.js` 17). The harnesses read the OllaBridge token from a mode-600 file outside the repository and never print it. **Not audited:** the rest of the app's logging |
| 18 | Reduced motion and user-controlled exit remain functional | **Held** | Light changes are a cut under reduced motion (the runtime's `setMood` rule; `instant` passes through, `security-matrix.test.js` 18); End closes and revokes. Moves fade through black, never glide (LW3) |
| 19 | A renderer or provider failure does not trap the user | **Partial** | A renderer failure keeps the previous spot (7); the room has no lock of its own, so End always works; revocation follows the session ending. **Not exercised:** a model-provider failure in the middle of a Private World session |
| 20 | The world never changes because the AI changed tone | **Held** | The room's presence has no destinations; `<go place=…>` from her is stripped; her offer can name only a spot in this room (`security-matrix.test.js` 20, S10) |

## Defects this matrix found and fixed

| Found by | Defect | Fix |
| --- | --- | --- |
| audit | Intimate never checked the avatar's declaration | PW1, `AvatarAdultDeclaration` |
| browser | presence read a companion session Intimate never starts: no "where you are" | PW3, `roomSession` |
| browser | one consent exit revoked twice | PW4, idempotent `revoke` |
| real model | the room never heard Private's turns; she claimed a warm glow nobody made | PW5, `observeSurface` |
| matrix 8 | an answer after revoke-and-reopen, or in the other variant, was narrated | PW5, `epoch` + world check |
| matrix 8 | a move landing after Clear was narrated (the public apartment too) | PW5, `talkGen` in `WorldPresence` |
| real model | half a tag (`[[emote:`) left in a cut-off reply | PW6, `StageDirections` tail + `sanitizeReply` |
| real model | asked for an absent spot, her `<go/>` moved them elsewhere without a yes | PW6, named-but-absent → offer |
