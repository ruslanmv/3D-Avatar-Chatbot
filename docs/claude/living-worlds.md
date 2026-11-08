<!-- Moved verbatim from CLAUDE.md on 2026-11-08 so sessions load it only when working on this feature. Keep it accurate: if something here is wrong, fix it in the same change. -->

# Living Worlds: one place, moved within, left only by yes (LW1–LW5)

A chosen place stays until the person leaves it. She moves _within_ it, and a
different place waits for the person's yes. `docs/LIVING_WORLDS.md` is the
design; `docs/LIVING_WORLDS_IMPLEMENTATION_REPORT.md` holds the evidence.

- **Spots are measured, never typed (LW2).**
  `node tools/vr/measure-spots.mjs [scene]` raycasts the real GLB for each spot
  in `tools/vr/spot-targets.json` and writes
  `assets/vr-worlds/spots/<scene>.json`. Checks: floor, body clearance on a
  double-sided copy, same room, 2.2 m of open view for VR, the screen camera
  seeing all of her from 4.7 m on the materials as drawn (else the `mid` or
  `bust` framing), and 1.2 m spacing. A failing spot is written
  `verified: false` and never offered. Spots are keyed by **scene file**, not
  world id, and record its SHA-256, which a test re-hashes. Change a model and
  you must re-measure. The apartment (`pixel-flat-home.glb`, the `home` recipe)
  has 8 spots; the desktop bedroom has only its dressing table.
- **`src/gltf-viewer/WorldSpots.js` is the only reader** (pure, the trust
  boundary): verified spots only, `placementFor` in the engine's own `at`/`turn`
  convention (`turn = -facing`, `at = -R·p`), and `intentOf`, which needs a verb
  of going _and_ a spot word.
- **A move is the runtime's `goToSpot` (LW3):** fade, re-place the loaded
  `vr-world-scene:` object, `whileDark` hook, fade back, `spotId`. Never a
  reload or a glide; a world change mid-move makes it `stale`. Framing for a
  small room is `CameraPresets` `mid` or `bust`, applied by `ViewerEngine` on
  `nexus-world-framing` while the view is black, on screens only.
- **`src/companion/WorldPresence.js` (boot list after the reactive context;
  `live.presence`)** owns where you are. It believes a world only if
  `runtime.activeId` agrees.
    - The person's words move her (`observeUser`, called from `noticeTopic`).
    - Her `<go spot/>` runs only on a turn where they asked to move; otherwise
      it is an offer their next "sì" takes.
    - `<go place/>` or a request for another place opens one proposal. Only the
      person's next-turn yes commits it, through `session.enter(place-<world>)`;
      it expires after 2 turns or 3 min.
    - "Arrived" only on the renderer's `nexus-world-shown`; a 45 s timeout goes
      back.
    - Tags are stripped in `consume` and masked while streaming (reactive
      `maskStreaming` now covers `<go`).
    - The prompt gets `presence`, sanitised, and `goOffer`, accepted only in
      `PromptContext.GO_OFFER`'s exact shape.
    - Copilot hears no romantic spots and no trips; private worlds get nothing;
      Clear and the session ending reset it.
    - `tests/living-worlds/`.
- **In a place, relax / focus / story are moods here (LW4):** ActivityDirective
  calls `inPlace` (presence `setMood`) instead of entering a session. Seaside
  and End stay refused from her reply. The person's own words set moods too.
