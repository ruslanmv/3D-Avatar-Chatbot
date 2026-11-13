<!-- Moved verbatim from CLAUDE.md on 2026-11-08 so sessions load it only when working on this feature. Keep it accurate: if something here is wrong, fix it in the same change. -->

# Entering VR from a PC (XL1)

Quest Link and SteamVR put the headset on a GPU the page may not be rendering
on. `xrCompatible: true` in `ViewerEngine`'s renderer options is **ignored** by
three r147 (its context attributes are a fixed list), so ENTER VR's
`makeXRCompatible()` can _move_ the context: Chrome loses it, restores it on the
headset's GPU, and rejects that first call with `InvalidStateError`.
`VRSupport.toggleVR` requests the session first (the click's activation is spent
at once), then `_makeXRCompatible()` waits a move out and retries; a rejection
with no context loss behind it is thrown, and a session the page cannot draw
into is ended. The old "continuing anyway" entered VR with a dead context whose
loss handler then ran `forceExit()` mid-session. Do not create the context
`xrCompatible` up front instead: in desktop Chrome that starts the installed VR
runtime on page load for every visitor. Tested in
`tests/vr-entry-gpu-move.test.js`.

**XL2: no frame may build the GPU's work in one task.** After that move every
shader and texture is rebuilt, and three r147 does it inside the first frame,
one program waited on after another — on Windows (ANGLE/Direct3D) long enough
for Chrome's "page not responding". `VRSupport` now calls
`ViewerEngine._prepareForXR()` between `_makeXRCompatible()` and `setSession()`:
it holds the loop and runs `src/gltf-viewer/XRWarmUp.js` — `renderer.compile()`
with `debug.checkShaderErrors` off (so programs compile in parallel off-thread),
`COMPLETION_STATUS_KHR` polling, textures two per task. Rules: the loop is not
restarted on a context restore while `vrSupport.isToggling`, nor at the end of
the warm-up (a desktop frame there recompiled post-processing: 1.2 s) —
`vrSupport.onEntryFinished` restarts it after `setSession()` and on every
failure. No custom `XRWebGLLayer`: three's own layer already has alpha, and the
extra one allocated a second full-resolution framebuffer. A new object that only
appears in VR should exist in the scene (hidden) before the warm-up, as the
floor grid now does via `_vrGround()`. Tested in `tests/xr-warmup.test.js`.

**XL3: the headset shows the HomePilot loading card while she gets ready.** The
order in `VRSupport.toggleVR` is request → `_makeXRCompatible` → `beginSplash` →
`setSession` → `prepareForSession` (the XL2 warm-up) → `onEntryFinished`.
`src/gltf-viewer/XRSplash.js` (THREE injected, pure placement maths tested in
`tests/xr-splash.test.js`) draws its own tiny scene — app colour #071821,
`assets/app-icon-512.png` with the name, a turning ring — lazily following the
gaze (yaw only, never head-locked) for at least `MIN_MS` _after the headset
first shows it_ (XL7); the warm-up runs behind it, then the loop is hers and the
card is disposed. Its icon is fetched on the first ENTER VR, never on page load.
three r147 already sets fixed foveation to maximum in `setSession` — do not add
a second call.

**XL4: every step of entering VR is recorded, and a frame cannot freeze the
headset.** A Quest Link log showed the warm-up finish and then nothing until the
person quit — and "no frames asked for", "stuck on the card", "her loop never
started" and "her loop died" all look identical from inside the headset.
`src/gltf-viewer/XREntryTrace.js` (pure, `tests/xr-entry-trace.test.js`) records
request → granted → gpu → card → session → warmup → warmed → finished → scene
with times, counts `card` and `scene` frames, and prints a report **when the
session ends, however it ends** (`NEXUS_XR_ENTRY.report()` any time). The
running step is shown on the loading card and, as one word, on the desktop VR
button. Rules:

- **Every subsystem call in `animate()` is in its own `try`.** three's XR loop
  schedules the next frame only after the callback returns, so one exception
  stopped the headset for good — measured: 0 frames in 4 s after one throw,
  still presenting. A throwing subsystem is now reported once with its stack and
  skipped; she still draws. Add new per-frame calls inside a `try`; a test
  checks the list.
- **`VRSupport.onSessionStart()` clears `isToggling` before the warm-up runs** —
  use `_entering` for "entry still in progress".
- A watchdog 2.5 s after entry re-arms her loop once if she has drawn nothing —
  but waits while the session is hidden (XL7): that is the runtime's screen, not
  her loop failing.
- The "Multiple instances of Three.js" warning is expected (a global r147 for
  classic scripts, a module r147 for the engine and three-vrm; her scene and VRM
  materials are all module objects). Its silencer was an inline
  `<script defer>`, which `defer` does not affect; it is now
  `src/three-instance-marker.js`.
- **XL5: `'layers'` is requested only in a headset's own browser**
  (`VRSupport.wantsLayers`; `?xrLayers=1|0` forces it). Nothing here draws a
  layer, but asking for one moves three r147 off the classic `XRWebGLLayer` onto
  its projection-layer path. Desktop Chrome on Windows now offers layers too (an
  older comment said it did not), and there the path blits a 4× multisampled
  buffer into the layer every frame — untested anywhere, and a Chrome 157 / Link
  session granted it stayed on the loading screen. The trace also prints a
  status line 3, 8 and 20 s into a session (`pulse()`), so a log copied from
  inside a stuck headset says whether frames are being drawn.
- `[Violation] … unload is not allowed` from `jquery.js` is a browser
  extension's injected jQuery; this repository ships no jQuery.
- **XL6: what the first full Link report showed.** Request → granted took **55
  s** (Chrome's sandboxed XR service and the Meta Horizon Link runtime — a
  report on Meta's tracker matches it; nothing of the page runs then), the
  session went hidden and ended 1.6 s later with **0 frames**, and the warm-up
  took 34 s because a hidden page's timers fire once a second. So: three r147
  picks its path from `session.renderState.layers === undefined`, which Chrome
  on Windows defines without the `'layers'` feature — XL5 alone did not keep a
  PC off the projection-layer path; `VRSupport.hideLayersFromThree` shadows it
  for three's one read, and the report says whether that held (`layersHidden`).
  The session step records the path three took (`XRWebGLLayer` / projection
  layer) and the granted features, not just what was asked. The warm-up yields
  through a `MessageChannel` while the page is hidden. A session that ended is
  judged whole — 0 frames is a finding, never "no problem detected" — and the
  page names its own ends (`pageEnding`), so the report can say whether the
  headset or the page closed it.
- **XL7: over Air Link the card was disposed before it could be seen.** Link
  hides the session ~60 ms after it starts, for about a second; the card's 900
  ms was counted from its creation, so it was gone 86 ms before the session
  turned visible (1 frame drawn, 0 seen). The Quest's own browser is visible
  from the first frame, which is why only the PC lost it. Now the hand-over is
  `XRSplash.handOverAt`: ready **and** `MIN_MS` since the first card frame drawn
  while `visibilityState === 'visible'`, or `MAX_UNSEEN_MS` (6 s) after ready if
  the session is never shown — a timer, since a hidden session gets no frames.
  **Never call `renderer.setAnimationLoop` directly — use `_setLoop(fn)`.**
  three r147's `setAnimationLoop` always starts its _window_ rAF loop, even
  mid-session, so every switch inside a session made her frame run twice (once
  per XR frame, once per desktop frame — the real log shows her drawn while the
  session was hidden); `_setLoop` hands three one trampoline once and only swaps
  the function it calls. A context restore with the card up re-arms the card
  (and repaints it), not her loop; a context loss after entry ends the real
  session. The report gives `loading card: V of N frames while visible`, when it
  was first seen, her first frame, and `ended by:` the page (with its reason) or
  the headset/runtime. `npm run vr:entry-scenarios`
  (`tools/vr/xr-entry-scenarios.mjs`, IWER in headless Chromium) runs five
  startups — Quest native, Air Link hidden-then-visible, a GPU move, a context
  loss mid-card, a session ended while hidden. That is simulation; the procedure
  on a real Quest 3 + Air Link is in `docs/VR_STARTUP.md`. Link's own loading
  screen is the runtime's, and no page can draw into it.
- **Over Link there is no AR, by design of the platform.** Desktop Chrome offers
  no `immersive-ar` session, so passthrough exists only in the Quest's own
  browser. The VR panel's AR buttons read "AR N/A" there, and pressing one now
  says why once in the panel (`VRChatPanel._explainNoAR`, VR1) instead of only
  logging it. A Link session with the classic layer was confirmed working end to
  end: 36 327 frames, puppet IK on her skeleton, Web Speech recognition.
- **VR1: the VR chat panel has no quick chips.** "Summarize", "Explain" and
  "Continue" were removed at the person's request;
  `tests/vr-panel-chips.test.js` keeps them out.
- **VR2: hold the right trigger to talk, let go to send.** The trigger is also
  the panel's click, so `src/gltf-viewer/TriggerTalk.js` (pure,
  `tests/trigger-talk.test.js`) decides: a hit on a panel button you can _see_
  is a click; anywhere else the right controller's trigger is push-to-talk. Only
  a real right controller in VR (`environmentBlendMode` `'opaque'`) — never a
  phone AR tap (`targetRayMode: 'screen'`), a Quest AR session or a
  hand-tracking pinch. Trigger, Y and B share one recording (`createHolders`),
  each edge buzzes the controller, and disconnecting or leaving VR mid-hold ends
  it. Hidden panel hit-boxes used to catch clicks (hiding with X keeps them
  registered); `firstVisibleHit` ignores them now.
- **See the VR panel without a headset: `npm run vr:panel-shot`**
  (`tools/vr/screenshot-vr-panel.mjs`). It loads the real page in headless
  Chromium, fills the real panel and saves its canvas for each layer (chat,
  Controls, More) to `tmp/vr-panel/`; `--transcript`, `--status`, `--messages`,
  `--ar on|off` set the state. `docs/VR_PANEL_SCREENSHOTS.md` has the how-to. It
  found the "You" / "AI" labels overlapping each message's first line (fixed: 38
  px under the label, not 28).
