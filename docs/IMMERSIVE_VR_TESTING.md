# VR and manual checks

Automated coverage is `tests/companion/platform.test.js` plus the existing
VR entry, trigger-talk, and conversation-reset suites. Those run in jsdom or
by reading source. They do not render on a headset.

Nothing below was executed on a Quest, a Link session, or a phone AR
session for this change. Do not treat a green Jest run as a 72 Hz result.

## Desktop, in a browser

1. Load the app with the Behavior Director left on (the default).
2. Confirm Life, Copilot, and Experiences sit on the avatar card and the
   two-person Together button is still there.
3. Send a chat line on Life. Switch to Copilot and back. The line is still
   in the thread. The avatar did not reload.
4. Add a task, mark it done, reload. The task is still there.
5. Save a memory from Life. Clear the chat. The memory is still there. The
   thread is gone.
6. Open Experiences → Seaside Evening. A terrace of solid shapes appears
   around the avatar, not a flat background swap. The camera does not jump.
7. Choose "Watch the tide", then pick up the shell (button or click). The
   line changes. Light the lantern. The line changes again.
8. Press Exit. The terrace geometry is gone. Chat still works. Enter VR if
   the browser offers it; the session still starts.
9. Open Screen help. The existing setup sentence appears before any camera
   prompt. Cancel. You are not asked twice.
10. Set `localStorage.nexus_companion_nav` to `false` and reload. The bar is
    gone. Together still opens.

## Headset (Quest browser or Link) — not yet run

1. Enter VR from the existing button. The loading card and the single frame
   loop behave as in `docs/VR_STARTUP.md`. Record `NEXUS_XR_ENTRY.report()`.
2. Start Seaside before entering, and again after entering. Both should show
   the terrace without a second copy of the avatar.
3. Point at the shell and the lantern. The trigger selects them and does not
   also start talking. Point at empty space. The right trigger still talks.
4. Confirm sticks still move and snap-turn, and that no camera animation
   plays on its own.
5. Sit. The exit stone and the shell are reachable without standing.
6. Exit the experience. The terrace disappears. Exit VR. Enter VR again.
   Chat and the avatar still render.
7. If the device exposes passthrough, start Seaside in that session. The sky
   sphere should be absent. A failed passthrough attempt must still leave
   desktop chat usable after the session ends.
8. Watch frame time in the runtime's own tools. `diagnostics().lastDtMs` is
   a single frame on the page, not a headset trace. Write the number down
   from the device. Do not copy a target into a report as if it were measured.

## Context loss

The ViewerEngine handler still owns `webglcontextlost` / `restored` and the
loop. This change does not add a listener that calls `preventDefault` or
restarts the loop. After a forced context loss (browser task manager or a
GPU reset), confirm VR entry still follows `docs/VR_STARTUP.md`.

## Out of scope until a device says otherwise

Hand tracking, teleport as the default locomotion, collision that blocks the
headset, and any frame-rate number.
