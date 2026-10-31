# Entering VR: the HomePilot loading card (XL3–XL7)

When the person presses ENTER VR, the headset shows the HomePilot loading card —
the app icon, the name, a turning ring — while she gets ready, and then her.
In the Quest's own browser that always worked. From Chrome on a Windows PC over
Air Link the card was never seen: Link's own loading screen, then her. This
page is the record of why, what XL7 changed, and how to check it on a real
Quest 3.

What no page can change, stated first so nobody chases it: **the screen the
headset shows before the page has a visible session is drawn by the XR runtime
(Meta Horizon Link, SteamVR), not by the page.** That covers the long wait
between ENTER VR and the session being granted (55 s in one Link log, XL6) and
the hidden period right after it. The HomePilot card can only appear once the
runtime hands the session to the page. XL7 makes sure it then does.

## Root cause (proven from a real Quest 3 + Air Link log)

The trace from the person's own Air Link session (Chrome 157, RTX 4080 laptop,
times from ENTER VR):

```
✔ granted   +33121 ms
✔ card      +33122 ms   the card is created (before setSession)
✔ session   +33135 ms   {"visibility":"visible","path":"XRWebGLLayer", …}
  event     +33194 ms   session visibility → hidden      (59 ms later)
✔ warmed    +33315 ms   warm-up done in 180 ms
✔ finished  +33315 ms   she is ready
✔ scene     +34028 ms   her first frame — the card is gone
  event     +34108 ms   session visibility → visible     (Link shows the page)
```

1. **Link hides the session ~60 ms after it starts, for about a second**, while
   it shows its own loading screen. A hidden session receives no
   `requestAnimationFrame` callbacks (WebXR spec), so nothing the page draws in
   that time reaches the headset.
2. **The card's minimum time (900 ms, `XRSplash.MIN_MS`) was counted from the
   card's creation**, by the clock: `endAt(created, ready)` =
   `max(ready, created + 900)` = +34022. The card was disposed at +34022, 86 ms
   before the headset could first have shown it (+34108). It drew one frame
   (before Link hid the session) and was seen in zero.
3. **In the Quest's own browser the session is visible from its first frame**,
   so "900 ms since creation" and "900 ms since first seen" were the same
   thing. That is the whole difference between the two environments.

A second defect showed in the same log: **her scene's first frame (+34028) was
drawn while the session was still hidden.** A hidden session gets no XR frames,
so that frame came from the PC page's own `requestAnimationFrame` loop. three
r147's `renderer.setAnimationLoop(fn)` always calls `animation.start()` — the
window loop — even during an XR session, where three had stopped that loop at
`sessionstart`. Every loop switch made inside a session (card → her, a
re-armed loop) restarted it, and from then on her whole frame ran twice per
headset frame: once on the headset's XR frame and once on the desktop page's
frame, rendering the XR views outside any XR frame. The emulator measured 2.0
renders per headset frame on the previous code; 1.00 with XL7.

Further gaps found while proving the first two (each reproduced in the
emulator):

- A WebGL context **restore** while the card was up started her loop in the
  middle of the warm-up — exactly the long first frame XL2 exists to avoid —
  because the restore handler only held off while `vrSupport.isToggling`, and
  VRSupport clears that at session start, before the warm-up.
- A context **loss** after entry left the XR session running with a dead
  context: `forceExit()` tidied the page but never ended the session, so the
  headset held its last picture.
- The XL4 watchdog treated a hidden session's zero frames as her loop failing
  and re-armed it.

## The fix (XL7)

| Where                                                  | What                                                                                                                                                                                                                    |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `XRSplash.handOverAt({ readyAt, visibleSince })`       | Pure rule: hand over at `max(ready, firstVisibleFrame + MIN_MS)`; if the session has never been visible, at `ready + MAX_UNSEEN_MS` (6 s) so a session the runtime never shows cannot hold the card forever.            |
| `ViewerEngine._runSplashLoop()`                        | The card's frame loop. Each card frame records whether the session was `visible`; the first visible one sets `_splashVisibleSince`. Calls `_maybeEndSplash()` every frame.                                              |
| `ViewerEngine._maybeEndSplash()`                       | Hands the loop to her once `handOverAt` says so, or at once if the session has ended. Notes in the report when the card was handed over unseen.                                                                          |
| `ViewerEngine._finishXREntry()`                        | Records when she is ready and arms the never-visible fallback timer (the only thing that can fire while the session is hidden, since a hidden session gets no frames). `S.endAt` is no longer used here.                |
| `ViewerEngine._setLoop(fn)`                            | three gets **one** trampoline, once; after that only the function it calls changes. three's own session start/end are the only things that start or stop its desktop loop again. Every former `setAnimationLoop` call goes through it. |
| `webglcontextrestored` handler                         | With the card up: repaint its texture (`XRSplash.refresh()`) and re-arm the card's loop, not hers. Otherwise held while `isToggling` **or** `_entering`.                                                                |
| `webglcontextlost` handler + `VRSupport`               | A loss after entry ends the real session (`session.end()`, `forceExit()` if that fails) and records `WebGL context lost in VR` as the page's own reason.                                                                 |
| `ViewerEngine._xrWatchdog()`                           | Waits (up to 30 s) while the session is hidden instead of re-arming her loop.                                                                                                                                           |
| `XREntryTrace`                                         | `frames.cardVisible`, `firstFrame.cardVisible`, the session's visibility and since when, report lines for the card's life, her first frame and who ended the session, and a diagnosis for a long-hidden session.         |

Nothing changes in the Quest's own browser except that the card's 900 ms now
starts at its first frame in the headset rather than at its creation — tens of
milliseconds later. No HTML overlay, no new per-frame work beyond one
`visibilityState` read on card frames, and nothing in three or the vendored
build is touched.

### Lifecycle, before and after

Before (Air Link):

```
ENTER VR → [Link's screen, ~33 s] → granted → card created → session (visible)
  → Link hides session (+59 ms) ……… card drawn 1 frame, seen 0
  → warm-up done (+180 ms)
  → card disposed at created + 900 ms  ← still hidden
  → setAnimationLoop(her) restarts the desktop loop → her frame drawn while hidden
  → Link shows session (+986 ms) → she appears; card never seen
  → her frame runs twice per headset frame for the rest of the session
```

After (Air Link):

```
ENTER VR → [Link's screen] → granted → card created → session (visible)
  → Link hides session ……… card frames withheld; nothing counted as seen
  → warm-up done → she is ready; card stays (fallback timer armed: 6 s)
  → Link shows session → first visible card frame → card shown ≥ 900 ms
  → hand-over: her loop through the same trampoline; one render per headset frame
```

Native Quest Browser, before and after alike:

```
ENTER VR → granted → card → session visible from the first frame
  → card seen ≥ 900 ms (and until she is ready) → her
```

## Diagnostics

Every entry is recorded; the report prints when the session ends however it
ends, and `NEXUS_XR_ENTRY.report()` prints it at any time from the console.
`NEXUS_XR_ENTRY.snapshot()` is the raw record.

| In the report                                       | What it tells you                                                                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `granted +N ms`                                     | Time the browser and XR runtime took to grant the session. Over 20 s gets its own ⚠ line (the runtime, not the page). |
| `card {gpuMoved, gpu}`                              | Whether `makeXRCompatible()` moved the context to another GPU (lost → restored).                                    |
| `session {visibility, path, granted, layersHidden}` | Visibility at start, three's rendering path (`XRWebGLLayer` / projection layer), the features actually granted.     |
| `event … loading card created / icon loaded`        | The card existed and its picture arrived (`icon FAILED` — the card still shows its name and ring).                 |
| `event … session visibility → hidden / visible`     | Every visibility change, with its time.                                                                             |
| `event … WebGL context lost / restored`             | A loss or restore while entering or while the card was up.                                                          |
| `loading card: V of N frames while visible, …`      | Frames drawn vs frames the headset could show, when it was first drawn and first seen — or `never seen in the headset`. |
| `event … loading card handed over unseen`           | The session stayed hidden through the 6 s fallback.                                                                  |
| `her scene: first frame +N ms`                      | When she first drew. After XL7 it is never before the session's first `visible`.                                    |
| `session ended +N ms` / `ended by: …`               | `this page (reason)` when the page asked (EXIT VR, a failure, `WebGL context lost in VR`); otherwise `the headset or its XR runtime`. |
| `→ …`                                               | The diagnosis: e.g. a session kept hidden by the runtime, 0 frames, a subsystem that threw.                         |

## Simulated validation (no headset)

```bash
npm run vr:entry-scenarios
```

`tools/vr/xr-entry-scenarios.mjs` loads the real page in headless Chromium with
Meta's Immersive Web Emulation Runtime (IWER 2.7.0) as an emulated Quest 3,
presses ENTER VR and checks the page's own trace. Needs Playwright with
Chromium (`npm i --no-save playwright && npx playwright install chromium`).
`--only <names>`, `--report` (print every report), `--url` (a running server),
`--iwer <file>` (a local copy, offline).

| Scenario              | Simulates                                                                                    | Checks                                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `quest-native`        | Quest Browser: visible from the start                                                        | card seen; her scene draws; card shown ≥ its minimum; one render per headset frame                          |
| `airlink`             | Chrome on Windows: hidden right after start, visible 1.5 s after the warm-up (measured ~0.8 s) | nothing counted as seen while hidden; card seen after Link shows the session, ≥ its minimum; her scene not drawn while hidden; one render per headset frame; classic `XRWebGLLayer` path |
| `gpu-move`            | `makeXRCompatible()` loses and restores the context before the card                          | move recorded and waited out; card seen; her scene draws                                                    |
| `context-lost-in-vr`  | context lost while the card is up                                                            | the page ends the session (`WebGL context lost in VR`); headset released; no card left; desktop view back   |
| `cancel-while-hidden` | the session ends while still hidden                                                          | nothing seen; report blames the headset/runtime; no stuck card; desktop view back                           |

Results on 2026-10-31 (simulated):

| Scenario              | Previous code                                                                      | XL7          |
| --------------------- | ---------------------------------------------------------------------------------- | ------------ |
| `quest-native`        | card seen (42 frames); **2.00 renders per headset frame**                          | PASS (1.00)  |
| `airlink`             | **card: 0 frames**; her first frame +12795 ms, session visible +14545 ms (drawn while hidden); **2.20 renders per frame** | PASS: 4 of 4 card frames seen, shown 1434 ms after Link showed it; 1.00 |
| `gpu-move`            | —                                                                                  | PASS         |
| `context-lost-in-vr`  | —                                                                                  | PASS         |
| `cancel-while-hidden` | —                                                                                  | PASS         |

What the simulation is not: IWER emulates the WebXR API, not Meta Horizon Link
or Chrome's XR service. The harness withholds frame callbacks while the session
is hidden because the WebXR spec says a hidden session gets none, not because
it observed Link doing so. IWER applies visibility changes on its next device
frame, its own WebGL layer does not survive a context loss (reported as an
emulator error, ignored), and swiftshader makes the warm-up take ~13 s instead
of ~0.2 s. Whether a real desktop Chrome keeps running the page's window loop
during a Link session (the double render) is shown by the real log's
`scene +34028` before `visible +34108`; whether the Quest's own browser does is
not verified on hardware.

Unit tests: `tests/xr-splash-visibility.test.js` (the hand-over rule against
both environments with the real timeline, the fallback, the card's texture
refresh, the report, the single loop) and `tests/xr-entry-trace.test.js`.

## Manual validation: Windows Chrome + Meta Quest 3 + Air Link

Set up once:

1. Meta Horizon Link (the Quest Link PC app) installed and running; Air Link
   enabled on the headset and connected (Quick Settings ▸ Quest Link ▸ Air
   Link). A cable Link run is worth doing too — same runtime, different
   transport.
2. In the Link PC app, Settings ▸ General ▸ **OpenXR Runtime**: Meta Horizon
   Link set as active. With SteamVR active instead, the entry still works
   but you are testing SteamVR's loading screen.
3. Current desktop Chrome. Open the deployment (or `npm start` →
   `http://localhost:8080`; WebXR needs `https` or `localhost`).
4. DevTools ▸ Console ▸ ⚙ ▸ **Preserve log** on. Optional filter: `VR entry`.

Each run:

1. Wait for her to load on the desktop. In the headset, be in Link's home.
2. Press **ENTER VR** in Chrome. Put the headset on.
3. Watch, in order:
   - Link's own loading screen (the runtime's — not ours, not changeable).
   - **The HomePilot card**: dark teal, the app icon, "HomePilot", a turning
     ring and a status word, placed in front of you and following your gaze
     lazily. It must stay at least about a second.
   - Then her, in the room.
4. Press **EXIT VR** (or use the panel). Copy the `[VR entry] report` from the
   console.

Pass:

- In the report: `loading card: V of N frames while visible` with **V > 0**,
  and `first seen +X ms` **at or after** the `session visibility → visible`
  event.
- `her scene: first frame` at least ~900 ms after `first seen`, and **not
  before** `session visibility → visible`.
- `session … "path":"XRWebGLLayer"` and `"layersHidden":true` on the PC.
- `ended by: this page (EXIT VR pressed)` after pressing EXIT VR.

Variations worth one run each:

| Do                                                                      | Expect                                                                                              |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Enter VR a second time in the same tab                                  | `loading card icon ready (cached)`; card seen again                                                 |
| Press the Meta button / take the headset off during Link's loading screen | `ended by: the headset or its XR runtime`; desktop view back; no card left on the desktop          |
| A PC whose Chrome renders on a different GPU from the headset's         | `card {"gpuMoved":true}` and `WebGL context restored` events; card still seen                      |
| Same page in the Quest's own browser (control)                          | card seen as before; `session visibility` stays `visible`; no change in feel                        |

Fail, and what to send back: the full report. In particular `never seen in the
headset` together with a `session visibility → visible` event earlier than the
hand-over, or `her scene: first frame` before `visible`, is a regression of
XL7. `loading card handed over unseen` means Link kept the session hidden for
more than 6 s after she was ready — the runtime's doing; the report's `→` line
says so.

## Compatibility

| Environment                                   | Behaviour after XL7                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Quest Browser (the product target)            | Unchanged in practice: visible from the start, card ≥ 900 ms from its first frame (tens of ms later than before). |
| Desktop Chrome / Edge + Air Link or cable Link | Card shown once Link shows the session; her loop no longer doubled.                                    |
| Desktop Chrome + SteamVR (Link or other headsets) | Same rule: it reads only the session's `visibilityState`, which WebXR requires of every implementation. |
| A runtime that never makes the session visible | Card handed over 6 s after she is ready, noted in the report; her loop then draws whenever the runtime shows the session. |
| Phone AR, Quest AR (passthrough)              | Not affected: the card is VR-only (`VRSupport.toggleVR`).                                               |
| Browsers without WebXR                        | Not affected: ENTER VR is not offered.                                                                  |
| Desktop page, never entering VR               | One trampoline in place of a direct loop function; same frames, same order.                            |
