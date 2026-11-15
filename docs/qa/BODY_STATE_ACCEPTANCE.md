# Private body-state acceptance: what passed, what is blocked

2026-11-15. Chatbot `claude/funny-shannon-mh185b` on `ultimate` @ `78dd156`; Forge
`claude/funny-shannon-mh185b` on `ultimate` @ `06ea379` (BI1 import, BI2 read grants, KL1
jeans). Forge ran locally on 127.0.0.1:8092 with its real library; no deployment was changed.

## What was run

`tools/qa/private-body-state-acceptance.mjs`, real Chromium (SwiftShader), the real renderer,
NEXUS Private at level 4 reached with ConsentFlow's own Closer control. Every change is the
person's words read by `PrivateActionBridge`; the controller and renderer are only read.

The character is **AvatarSample A** (library, pinned SHA-256 `b86b0b8a66d4…`, VRM 0.x, the VRoid
terms allow modification and sexual expression, operator-declared adult 2026-11-07). The body
state is a **lingerie** state (a black satin chemise) that Forge built on her, imported through
`POST /v1/admin/library/avatar-sample-a/body-states` as an operator-supplied private asset,
readable by the app only through a read grant for `avatar-sample-a`.

| Step | Desktop EN | Desktop IT | Phone 390 EN | Phone 390 IT |
|---|---|---|---|---|
| 1. Level 4, wardrobe available, her own outfit | pass | pass | pass | pass |
| 2. "Undress for me": the private import is chosen, downloaded with the grant, SHA-256 checked; renderer root = the verified blob; bridge says `lingerie` | pass | pass | pass | pass |
| Same character: 54 humanoid bones on the same node names, 15 expressions, face meshes identical; camera unchanged | pass | pass | pass | pass |
| 3. "Take everything off": no bare state → `no-bare-look`, nothing changes | pass | pass | pass | pass |
| 4. "Get dressed again": renderer root is her own file, bridge says `original`, camera unchanged | pass | pass | pass | pass |
| 5. Download fails (503): refused, nothing swapped | pass | pass | pass | pass |
| 6. Bytes tampered in transit: refused before the loader, nothing swapped | pass | pass | pass | pass |
| 7. Session ended while the download was held: the wear was pending, then never reached the renderer; her own file is on stage | pass | pass | pass | pass |
| No admin header ever sent to Forge; the private file fetched with the grant | pass | pass | pass | pass |
| No horizontal overflow | pass | pass | pass | pass |

Screenshots were looked at (original, imported state, restored, cancelled) and kept in private
storage, not in this repository. Step 7 was not run in a browser without BI3; that a cancelled
wear used to finish its download and load over the restore is read from the code (the
controller had no ticket) and pinned by the Jest tests below.

Run it:

```bash
node tools/qa/private-body-state-acceptance.mjs --forge http://127.0.0.1:8092 \
    --grant-file <file> --look-id <import-…> --size phone --lang it-IT --out <private dir>
```

## Changes in this repository

- **BI2. The read grant.** `WardrobeConfig.grant` (the site's `forge.grant`, else
  `wardrobe_forge_grant` on this device, set in Settings ▸ Wardrobe Forge ▸ Private looks access).
  `WardrobeClient` sends it as `X-Wardrobe-Grant` on its own requests and, through
  `downloadHeaders(url)`, on a look download only when the URL is on the same origin.
- **BI3. Cancellation, rollback, stale requests.** `WardrobeController` gives every wear and
  restore a ticket. `cancel()` aborts the verified download (`AbortSignal`), a cancelled wear never
  loads and never becomes `activeLook`, a wear whose model already landed is rolled back to what
  she wore, `restore()` cancels a pending wear, and a load the manager discarded is not recorded as
  worn. `TryOnSession` treats `wear_cancelled` as "kept what she had", not a failure, and has
  `cancelPending()`; `InSceneWardrobe` cancels the slow wear on its timeout and on close instead of
  letting it land and then replacing it.
- `fetchVerified` failures carry `reason: look_download_failed` and the status.

Jest: `tests/wardrobe/wardrobe-cancel-grant-bi3.test.js` (11). Gate: `npm run validate` exit 0.

## Blocked, not passed

| Step | Status | Why, and what completes it |
|---|---|---|
| A **bare** body state of a real library character, imported and shown in the app | **BLOCKED** | Two things a person must supply, and this session did not: (1) a clearly-adult design review of the character's exact file and of the bare file, recorded in `assets/body_surface/adult-design-reviews.json` (still empty); (2) the bare VRM itself. I did not generate nude geometry of a library character, did not render or inspect a nude render of one, and did not record a review. The import route refuses a bare file without both reviews (tested). Once both exist, the same driver runs unchanged with that look id. |
| Visual adult-design suitability of any library character | **BLOCKED (a person's judgement)** | The VRoid characters are stylised; an operator declaration and the VRM terms are on record, a design review is not. Not supplied here. |
| AvatarSample O's incomplete chest | **unchanged** | Still `body-incomplete-for-bare` authored-only; BR1 reconstruction stays opt-in, unregistered, and was not run on her here. |
| Deployment | **not done** | Nothing was deployed. Before any: set `WARDROBE_GRANT_SECRET` on the Forge, mint a grant per app deployment, and decide on the `PIPELINE_VERSION` question in Forge `docs/qa/BODY_STATE_IMPORT.md`. |
