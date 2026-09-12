# A12 — hardening record

Wave 6 is an audit. Tests and docs only: anything found wrong in source is a
finding raised here, not folded in silently. Two rows failed.

Every row below is either automated in `tests/ambience-hardening.test.js` (33
assertions) or marked as needing a headset, a camera or a human eye. Rows marked
**code-verified** were checked by reading the path that executes, not by running
it — jsdom has no WebGL, no XR and no camera, so that is the honest ceiling for
those.

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

## Findings

### A12-1 · Leaving AR discards a scene chosen during AR — *open*

**Where** `src/gltf-viewer/ViewerEngine.js`, the `ar-session-end` handler.

**What happens.** While any XR session is presenting, `setDesktopBackground()`
records the selection in `_desktopBgKey` and deliberately does not paint it — a
flat rectangle must never reach a headset, and in AR it would hide the camera
feed. VR's exit handler finishes the job with
`this.backgroundManager.reapplyCurrent()`. **AR's exit handler has no equivalent
call.** `ARSupport._restore()` writes back `this._savedBackground`, which is the
texture from *before* AR.

So after: desktop → select Ocean → enter AR → ask her for the sea (or tap a card)
→ exit AR, the viewport shows **Ocean** while `_desktopBgKey`, `desktop_bg` and
the Settings radio all say the new scene.

**Why it matters more than it looks.** This is precisely the disagreement
`SceneAmbienceController` refuses to cache state in order to prevent — Settings
showing one place while the viewport shows another — reintroduced through a path
the controller cannot see.

**Severity: low, and narrow.** It needs a scene change *during* an AR session.
Any later selection corrects it, and nothing leaks: the XR guard means the
manager is never called while presenting, so no texture is disposed underneath
the snapshot ARSupport is holding.

**Suggested fix**, one line, mirroring VR:

```js
window.addEventListener('ar-session-end', () => {
    // …existing restore…
    this.backgroundManager?.reapplyCurrent();
});
```

It must run **after** `ARSupport._restore()` has written `_savedBackground` back,
or the restore overwrites the re-apply. Ordering between the two `ar-session-end`
listeners is registration order, so this needs checking rather than assuming —
which is why it is a finding and not a patch in this wave.

Pinned by `FINDING A12-1` in `tests/ambience-hardening.test.js`, asserting the
current, wrong behaviour. Fixing it flips that test, which is where the
conversation belongs. A test asserting what we wish were true would fail on a
clean checkout and teach the next person to ignore it.

### A12-2 · Document-PiP restore does not re-fit the crop — *open, benign in the common case*

**Where** `src/CompanionMode.js`, `_restore()` (strategy B, document-PiP).

**What happens.** The overlay strategy ends with
`window.NEXUS_VIEWER?.resize?.()` **after** clearing `__COMPANION_ACTIVE__`, so
`backgroundManager.onResize(w, h)` runs and the cover crop is recomputed.
Document-PiP's `_restore()` calls only `this.onResize(w, h)` — a callback that
updates the camera aspect and post-processing and **knows nothing about the
background manager** — and calls it *before* clearing the flag, so even routing
it through `resize()` would be swallowed by the early return.

**Why it is usually invisible.** The manager is driven only from `resize()`, and
`resize()` is inert for the whole PiP session. The crop therefore keeps the
desktop aspect it was computed with and is still correct on return — the batch
plan's "image restored and re-fitted" row passes by accident rather than by
design.

It is wrong when **the main window changes size while PiP is open**. The crop
then reflects the old desktop and stays wrong until some later resize event.

**Severity: low.** Cosmetic, self-correcting on the next resize, and it requires
resizing the main window during PiP.

**Suggested fix:** move the nudge after the flag clear, matching strategy C.

Pinned by `FINDING A12-2`, again asserting current behaviour — including the
sharper half, that the `onResize` call precedes the flag clear.

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
| Companion | image → enter → exit | **pass / finding A12-2** | Correct in the common case, for the wrong reason. |
| VR | image → enter → exit | **pass** | `reapplyCurrent()` on exit; the old unconditional black rebuild is gone. Automated. |
| VR | select an image *while in VR* | **pass** | Recorded, not applied; applied on exit. Automated. |
| AR | image → enter → exit | **pass** | Snapshot, `null` for passthrough, restore verbatim. Automated. |
| AR | select an image *while in AR* | **FAIL — A12-1** | Recorded, never applied. |
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
