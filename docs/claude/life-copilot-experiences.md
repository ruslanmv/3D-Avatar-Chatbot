<!-- Moved verbatim from CLAUDE.md on 2026-11-08 so sessions load it only when working on this feature. Keep it accurate: if something here is wrong, fix it in the same change. -->

# Life, Copilot and Experiences (IC1–IC3)

One companion and one conversation; the three are what is going on, not modes
she is switched into. `src/companion/` (IIFE, loaded by `boot.js`) holds them.

- **Together is the only way in (IC2).** IC1's strip of three buttons over the
  avatar is no longer added to the page (`DestinationBar` keeps its sheet and
  Exit, which Together opens via `show()`). The three tiles are inside Together
  ▸ Playground (TG2), in their colours: Life #38A9FF, Copilot #26D89A,
  Experiences #F2C94C.
- **The conversation moves the context.** At prompt time `index.js`'s
  `noticeTopic` runs `ContextIntent.classify` (pure, local, English and Italian,
  no model call) on the latest user message; only a clear, unambiguous signal
  calls `session.enter(…, { source: 'conversation' })`. A Together activity with
  a beginning and end (`ActivityMarks.EXPLICIT`: focus block, Seaside, Scene
  Tale, Life Evening, Copilot Hour) is not replaced by a remark.
- **One quiet line per change, never stored.** `ActivityMarks` draws "Life ·
  Relaxing together" between messages when the context changes, and an End pill
  above the composer only for an explicit activity. Nothing it draws is in
  `chatHistory`, so none of it reaches the prompt or TTS. No portrait in the
  chat.
- **`PromptContext` speaks as one companion**: `SAME`, one "Now: …" sentence,
  the activity line, and `STYLE` (one to three sentences, no question every
  turn, never name a mode). `session.end()` makes the suffix `''` again. Copilot
  never receives Life relationship text or memories.
- **One door per thing (TG1–TG2).** The first screen is six tiles: Playground,
  Watch, Music / Try-On, Meeting, Help me. **Playground holds the three places**
  — its screen is only the coloured Life, Copilot and Experiences tiles
  (`PLACES` in `playground.js`); each story lives under its place (Life ▸ An
  evening together, Copilot ▸ Copilot Hour, Experiences ▸ Scene Tale) and
  nowhere else. Life, Copilot, Experiences and Focus are `hidden: true`
  adapters: registered and started as before, no tile of their own (Focus is
  started by Relax together and Work on something). If a place is not loaded,
  Playground offers its story directly rather than an empty screen. **Back goes
  one step up** (`panel.trail`, `back()`): story → place → Playground → first
  screen; a first-screen tile passes `{ fresh: true }` so Playground opens on
  its places, not on a story abandoned earlier (`resetSetup()`).
- **Every Together choice does what its name says, in one step (IC3).** Life:
  Talk, Relax together, An evening together, Move together. Copilot: Work on
  something (a 25-minute focus block), My tasks, Learn something, Copilot Hour.
  Experiences: Seaside evening, Scene Tale and the scenes. An option that is
  really another activity carries `startActivity` + `startInput` and the panel
  starts it directly (no second menu); `startInput.as` is the name a failure
  screen uses, so Move together under Life never says "Copilot needs
  permission", and `context` is the session activity when the option id is more
  specific (`move-squat` → `move`).
- **One place to end an experience on desktop, and nothing floats (DX1).** The
  conversation panel's status bar (`ActivityMarks` pill: a full-width row at the
  top of `.chat-input-shell`, in normal flow, title left, "End experience" or
  "End" right with the activity in its `aria-label`) is where it ends. The old
  red Exit chip was absolutely positioned over the avatar footer's 🎯 Reset
  Camera; it is now "End experience" inside the DestinationBar sheet's
  experience row. The sheet's Close only dismisses the sheet. Footer buttons get
  `aria-label` from their `title` at runtime (index.html's lines are pinned by
  the parity harness). `tests/companion/desktop-controls.test.js`.
- **On a phone it is a mini-player (DX2).** In portrait
  (`body.nexus-mobile.nexus-portrait`) the status bar moves to `<body>` and
  docks 8 px above the chat sheet (`dockOffset`, re-measured on resize, rotation
  and a ResizeObserver on `.chat-card`): inside the sheet it pushed the input
  off screen, and the composer's `backdrop-filter` made it the containing block
  of a fixed child, so it was clipped. The Seaside sheet is placed above
  whichever is higher (`DestinationBar.sheetFit`, height capped at 55% of the
  space above so her face stays clear), shows only the experience's controls
  while one runs, and keeps Close pinned at its bottom. Touch screens get 44 px
  targets (`pointer: coarse`), the composer's controls are 44 px. **No backticks
  in a CSS comment inside a template literal** — one closed the string once. The
  old "keyboard is open" rule (`max-height: 450px`) hid her on every phone held
  sideways; it now needs `html.nexus-keyboard-open`, which `MobileChatOverlay`
  sets while a text field has focus, and phone landscape lets her viewport
  shrink so the button row fits.
- **The End control is only an X (DX3, DX5).** At the person's request the
  status bar was reduced to one small round X (`[data-role="end"]`):
  `aria-label` "End experience" for an experience, "End <activity>" otherwise; a
  tooltip naming the place ("End Irish pub"); the name kept in a visually hidden
  `role="status"` line for screen readers; 44 px on touch. No name, dot,
  minimise or remembered view — those were tried (DX3–DX4) and removed. A
  venue's chips sit in the same row, to the left of the X (`.has-actions`; the
  router inserts them), so the row is one line on desktop and phones; a private
  room has no End row, and its chips dock on their own. End asks first only if
  the running activity answers `unsavedProgress()` (none does yet). **Clean
  view** is `src/companion/ImmersiveMode.js` (boot list, after ActivityMarks):
  an eye in the viewport's corner hides the X row, chips, HUD corners, READY
  badge and (by default, Settings ▸ CLEAN VIEW, `nexus_clean_view_chat`) the
  chat; one eye in the bottom corner or Escape restores. CSS only, naming no
  session — a test greps it — so she and the experience keep going. Not kept
  across a reload; entering VR or AR leaves it.
  `tests/companion/status-views.test.js`.
- **She says one line when it starts or ends (IC3).** `ActivityVoice`: one
  bounded `callLLM` per Together start, newest start wins, epoch-checked,
  nothing while the person is mid-turn or with no model configured, posted like
  any reply. Tasks and Learn are skipped (their loops already ask), a start she
  made herself is `silent`, and Move together waits until the panel runs the
  coach — a fast model otherwise greeted an exercise the camera then refused.
- **She can start it from the chat (IC3):**
  `<activity name="relax|focus|seaside|story|end" minutes="…"/>`,
  `ActivityDirective`, the sixth capability instance — suffixed only while
  Together is on, consumed at both `displayText` seams. A Together activity is
  ended silently on reload; nothing claims to be running after it stopped.
- **Private music and clothing stay inside the session (SAE).** A `<play>` tag
  during Private is not given to the ordinary publisher. After the person asks,
  `PrivateActionBridge` runs `PrivateMediaController`, which searches and draws
  on the session's own soundtrack strip, and reports playback only once the
  player confirms it. `YouTubeAsk` does not intercept while Private is running,
  so the sentence still reaches the session. Outfit changes go through
  `InSceneWardrobe` rather than opening Try-On Haul. Ending the session cancels
  anything still in flight. The consent level is not a side effect of either.
- **Music in sessions is meant to be heard (MV1).** The person found it too low:
  scene loops play at `SceneJourney.AMBIENT_VOLUME` 0.7 (was 0.35), Private's
  soundtrack at 40 / softened 26 (was 15 / 10), and a story's narration ducks
  other audio to 0.4 (was 0.16). Scene Tale's YouTube soundtrack is not given a
  level — it is the thing they chose to hear. Tests assert ranges, not values.
  **Correction (VW1):** the scene loops (`src/features/together/scenes/assets/`)
  that `AMBIENT_VOLUME` sets are not in the repository — the manifests name
  files that were never added — so that change has nothing to play yet.
