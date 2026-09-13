# A12 — hardening record

Wave 6 was an audit: tests and docs only, findings raised rather than folded in.
Two rows failed. **Both have since been fixed**, in a follow-up commit, and one
of them turned out to be broader than the audit first recorded — see A12-1.

Every row below is either automated in `tests/ambience-hardening.test.js` or
marked as needing a headset, a camera or a human eye. Rows marked
**code-verified** were checked by reading the path that executes, not by running
it — jsdom has no WebGL, no XR and no camera, so that is the honest ceiling for
those.

One lesson is worth more than the findings. The row *"select an image while in
VR"* was marked **pass** on the strength of reading two event handlers, and it
was broken. It took a five-line probe against the real manager to see it.
Code-verified is genuinely weaker than tested, and this record now says which is
which for exactly that reason.

## What is actually being audited

Four things take over the renderer, and three of them **snapshot and restore**
`scene.background`:

| Mode | Does with the background |
| --- | --- |
| VR | snapshots, paints a solid colour, restores via `reapplyCurrent()` on exit |
| AR | snapshots, sets `null` for passthrough, restores the snapshot verbatim |
| Companion | leaves it alone; `resize()` is inert while PiP owns sizing |
| Clip recording | captures the WebGL canvas, so whatever is drawn is recorded |

Before A5, `scene.background` was always a `THREE.Color` rebuildable from a
constant. It is now sometimes a `Texture` with a lifetime and an owner. **Every
one of those hand-offs became load-bearing the day A5 landed**, which is what
this wave exists to check.

## Findings — both fixed

Both were raised by the audit and fixed in the follow-up commit. A12-1 turned out
to be broader than the first pass recorded; that correction is below.

### A12-1 · A scene chosen during an XR session was discarded on exit — *fixed*

**Where** `ViewerEngine`'s `vr-session-end` and `ar-session-end` handlers, and
`ViewportBackgroundManager.reapplyCurrent()`.

**The first pass got this half-right and recorded one row wrongly.** It found
that AR's exit had no equivalent of VR's `reapplyCurrent()` call, and marked the
VR row — *"select an image while in VR → applied on exit"* — as passing. That
was wrong, and it was wrong because it was checked by reading the two handlers
rather than by running the manager.

The real defect is one level down. While presenting, `setDesktopBackground()`
records the choice in `_desktopBgKey` and deliberately does **not** call the
manager. So the manager's `_id` still points at the scene from *before* the
session — and `reapplyCurrent()` faithfully restored **that**. A scene chosen in
the headset was discarded on exit **in VR as well as AR**, while Settings and
`desktop_bg` both said the new one.

Proved by probe, not by reading:

```
PROBE before XR, manager._id = ambient:ocean:day
PROBE after exit, manager._id = ambient:ocean:day
PROBE re-applied the SAME texture as before XR: true
```

**Fix.** `reapplyCurrent(id)` now takes the selection of record. When it differs
from what the manager last applied, it loads it properly; when it matches — the
common case of leaving VR having changed nothing — it keeps the existing fast
path with no refetch. Both exit handlers pass `this._desktopBgKey`, and AR gained
the call it never had.

Adding it to AR also fixes `ARSupport.forceExit()`, which dispatches
`ar-session-end` **without** restoring anything and would otherwise leave the
viewport transparent.

**On the ordering concern raised in the audit:** it dissolved on inspection.
`onSessionEnd()` writes the snapshot back and only *then* dispatches the event,
so the ViewerEngine listener always runs after the restore. The guarantee comes
from the dispatch being last, not from the registration order of two listeners —
which is exactly why this was raised rather than patched blind.

Covered by six behavioural tests in `tests/ambience-background-manager.test.js`
(new selection wins, stale texture freed, unchanged selection takes the fast path,
omitted id unchanged, a colour chosen during XR, and an id arriving with the
manager holding nothing) plus source assertions in
`tests/ambience-hardening.test.js`.

### A12-2 · Document-PiP restore did not re-fit the crop — *fixed*

**Where** `src/CompanionMode.js`, `_restore()` (strategy B, document-PiP).

The overlay strategy ended with `window.NEXUS_VIEWER?.resize?.()` **after**
clearing `__COMPANION_ACTIVE__`. Document-PiP called only its `onResize`
callback — which updates the camera aspect and post-processing and knows nothing
about the background manager — and called it *before* clearing the flag, so even
routing it through `resize()` would have been swallowed by that early return.

Usually invisible: the manager is driven only from `resize()`, which is inert for
the whole PiP session, so the crop keeps the desktop aspect and is still right on
return. The batch plan's *"restored and re-fitted"* row was passing by accident
rather than by design. It was wrong when the main window changed size while PiP
was open, and stayed wrong until some unrelated resize happened to fix it.

**Fix.** The nudge moved after the flag clear, matching the overlay strategy. A
test asserts both that it is there and that it comes after — and that the two
strategies now agree.

## The matrix

### `VIEWPORT_IMAGE_BACKGROUNDS.md` §K

| Area | Case | Result | Note |
| --- | --- | --- | --- |
| Existing colours | all five | **pass** | Route through the manager; `BG_COLORS` values unchanged. Automated. |
| Images | each scene selected | **pass** (code-verified) | Needs WebGL to see. Cover maths has 60 unit tests; the ten assets are asserted present, WebP, and all 1672×941. |
| Persistence | select image → reload | **pass** | `desktop_bg` is written once, by the settings save path. Automated. |
| Persistence | image → Black → reload | **pass** | Opaque string; colour path unchanged. |
| Switching | image ↔ colour repeatedly | **pass** | Colours go through the manager precisely so image → colour disposes. Automated. |
| Rapid switching | three fast clicks | **pass** | Generation token; losers dispose their own texture. Automated + 45 unit tests. |
| Failure | rename an asset | **pass** | Previous background kept, one warning. The Settings card marks itself `--missing`. |
| Resize | landscape ↔ portrait, narrow, rotate | **pass, with a note** | See *phone portrait* below. |
| Render mode | Anime ↔ Cinematic with an image | **pass** | A5 changed this deliberately: it used to force black. |
| Lighting | image selected | **pass** | No `environment`, PMREM or tone-mapping touch. Automated against comment-stripped source. |
| Companion | image → enter → exit | **pass** | Was correct only by accident (A12-2); both strategies now nudge a real re-fit after clearing the flag. |
| VR | image → enter → exit | **pass** | `reapplyCurrent()` on exit; the old unconditional black rebuild is gone. Automated. |
| VR | select an image *while in VR* | **pass, was a wrong record** | Recorded during, applied on exit. The first pass marked this pass without testing it; it was broken (A12-1) and is now fixed and covered behaviourally. |
| AR | image → enter → exit | **pass** | Snapshot, `null` for passthrough, restore verbatim. Automated. |
| AR | select an image *while in AR* | **pass** | Was the visible half of A12-1; AR's exit now re-applies the selection of record. |
| Clips | record with an image selected | **pass** (code-verified) | `captureStream` on the WebGL canvas; the scenery is `scene.background`, drawn by the renderer into that canvas. Needs a real recording to confirm visually. |
| Memory | switch scenes 20× | **pass** (code-verified) | Swap-then-dispose, asserted by line order; losers self-dispose. A live-texture count needs WebGL. |
| Perf | image selected, idle | **pass** | The render loop never names the manager; the manager starts no loop, no interval, no rAF. Automated. |
| A11y | keyboard through the grid | **pass** | One `name="desktop-bg"` group, so arrow keys move natively. Focus ring added in A6. Automated. |

### `AI_SCENE_AMBIENCE.md` §15

| Case | Result | Note |
| --- | --- | --- |
| OFF (default) → prompt byte-identical | **pass** | `''` when off, and when the catalogue can answer nothing. Automated against the real modules. |
| ON → suffix at all three prompt sites | **pass** | The three are `_handleStreamingResponse`, `callLLM`, `__nexusMediaSuffix` — **not** the two request handlers. |
| Tag never in bubble, transcript or TTS | **pass** | Stripped once at the `displayText` seam, which all four read. |
| A user typing the tag does nothing | **pass** | `consume` is never called on user text. Automated. |
| Toggling OFF mid-flight refuses the directive | **pass** | Switch re-read at execution time, in the directive *and* the controller. |
| Dropdown disabled while off | **pass** | Automated. |
| An AI change updates an open Settings modal | **pass** | Via the controller's DOM event; settings-sourced changes skipped. |
| `desktop_bg` written once | **pass** | One `setItem`; no ambience module writes it. Automated. |
| Turning AI ambience off does not change the background | **pass** | The wiring names neither `setDesktopBackground` nor `desktop_bg`. Automated. |
| No arbitrary URL, path or id from the model | **pass** | Attribute whitelist, then the resolved id looked up in the catalogue before it reaches the viewer. |

## Notes worth carrying forward

**Phone portrait crops hard.** At ~430×900 the cover transform shows about
**27% of image width**. That is correct `cover` behaviour fitting a 16:9 source
into a 0.48 viewport, not a bug, and it lands on the centre third these images
deliberately keep empty — so it reads as quiet sky or water. Worth knowing before
somebody reports it as one.

**The catalogue cannot satisfy every intent.** No forest, fire, rain, city or
fantasy scene. `Resolver.satisfiableIntents()` computes the companion's
vocabulary from what is actually present, so she never offers a forest and then
declines — but the gap is content, not code.

**`tests/behavior/scenes.test.js` still passes**, so the ten enter/exit cycles
invariant is intact.

## What could not be decided here

jsdom has no WebGL, no XR and no camera. These need a device:

- the scenery visibly rendering behind the avatar, undistorted
- a live WebGL texture count returning to 1 after 20 switches
- a recorded clip containing the scenery, watched back
- passthrough genuinely unobscured on a headset
- a screen reader announcing the cards

The code paths for each are verified and recorded above; what is missing is
observation, not analysis. A12-1 in particular is a reading of two event
handlers and deserves confirming on hardware before anyone fixes it blind.
