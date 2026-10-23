# Try-On: mobile-first redesign

Together stays the launcher, with its ten activities unchanged. The redesign starts after
Try-On is chosen, and is delivered one phase at a time, each checked in a real browser.

## Status

| Phase | Scope | State |
|---|---|---|
| 1 | Together preservation | Done: Jest pins the chooser table and Try-On's tile; the tour checks the ten tiles on screen |
| 2 | Try-On desktop | Done: she keeps her size across looks, commentary follows the outfit, More no longer stacks over the stage, Zoom is a real close view, the rail names the looks |
| 3 | Try-On mobile | Done: folded Looks rail, Turn / Zoom / Save / Next thumb bar, real tags, NEXUS caption and "Ask NEXUS…", caption opens the conversation, More fits above the sheet |
| 4 | Looks (desktop and mobile) | Not started |
| 5 | Customize | Not started |
| 6 | Scene picker | Not started |
| 7 | Pose Studio | Not started |
| 8 | Conversation and polish | Not started |

## What changed, and why

- **She kept shrinking.** Wearing a look swaps the avatar file, and `AvatarManager` frames
  every loaded file with its own fallback framing, further out than the startup framing: she
  dropped to about 60 % of her height on the stage. `WardrobeController` now holds the camera
  across the swap, a failed load and the restore.
- **The commentary never moved.** With no model configured it said "Choose a look…" through
  the whole haul. Each landing now shows her reaction (the model's line, or the canned one), or
  the look's real name and recipe. Nothing is written into the chat.
- **On a phone, Turn / Save / Next were invisible.** The conversation sheet is a later stacking
  context than the stage. The sheet now publishes its height (`--nexus-try-on-sheet`) and the
  stage sits on its top edge.

## The tour

    npm start
    node tools/try-on-tour.mjs OUT_DIR --url http://localhost:8080/

Runs Together → Try-On → three looks → Turn → Zoom → More → Conversation at 1920×1080,
1366×768, 1024×768, 412×915, 390×844 and 360×640 (phones with mobile emulation), saves
screenshots, and fails when a Together tile is missing, the camera moves on a look, the
summary and the advanced panel overlap, or a phone hides Turn, Save or Next. Needs Playwright
(not a dependency of this repo).

Last run (this branch): all six sizes pass.

## Known, not yet addressed

- Tablet portrait (768×1024) keeps the existing stacked layout, where the stage is about
  200 px tall; the summary is compact there but still covers part of her.
- The built-in pack has two looks per avatar; Forge-made looks appear when the Space has them.
- Not verified here: model replies and voice (no provider or microphone in the test browser),
  real devices and their keyboards, VR.
