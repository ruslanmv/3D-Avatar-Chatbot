# Avatar-first Try-On Haul — UI upgrade

**Watch first. Talk anytime. History on demand.**

This feature branch introduces a working first slice of the responsive HomePilot Avatar Try-On Haul redesign. The existing Three.js/VRM and conversation systems remain authoritative; no second avatar or chatbot is created.

## Three presentation modes

| Mode | Desktop | Mobile |
|---|---|---|
| Watch (default) | Avatar takes 62% of content width; small preview of newest NEXUS reply | Avatar stays full-screen behind compact conversation dock |
| Conversation | Recent four chat turns without extra outfit cards | Expandable sheet with the same existing input and voice tools |
| History | Original scrollable transcript and Clear action | Larger conversation sheet, without duplicate storage |

The Watch preview ignores pre-existing chat messages when a new Try-On session starts. Switching modes never causes a model call, removes a message, reloads the avatar or clears a draft. The existing Try-On panel controls, gestures, wardrobe intents, and session history remain in place.

## Files and ownership

- src/wardrobe/TryOnLiveLayout.js — scoped CSS, Watch/Conversation/History presentation and clean teardown
- src/wardrobe/TryOnHaulActivity.js — mounts presentation when Try-On begins; unmounts it at end
- index.html — registers the new script before the Try-On activity
- tests/wardrobe/try-on-live-layout.test.js — focused presentation tests

## Do not regress

- WardrobeController is the only owner of VRM swap/restore.
- TryOnSession preserves rapid taps, saved looks, Undo, Compare, Show Mode, Keep, End, and restore-at-end.
- Save is NOT Keep: favorites do not end a haul.
- TryOnConversation retains voice timing, user turn priority, clear/reset cancellation, directive safety and private look persistence rules.
- The existing chat composer is never recreated or intercepted; quick suggestions click the real Send control.
- Respect the existing measured mobile composer inset and safe-area behavior.

## Remaining implementation milestones

This first slice is **not** the full visual redesign. Subsequent changes should refine the remote control and in-stage labels; add a separate searchable History view with actual message bookmarks (only if the backend supports them); connect optional Style Story content to real session context; and finish full visual parity, mobile keyboard, voice, keyboard access and accessibility testing.

Do not claim that history search, saved-message filters, avatar zoom, or narrative cards work until implemented. Do not hardcode physical fabric comfort or unverified sizing as facts.

## Validation

Use Node 24 and run:

    npm ci
    npx jest tests/wardrobe/try-on-live-layout.test.js --runInBand
    npm run validate
    npm run wardrobe:check

Manual viewports: 1920×1080, 1366×768, 1024×768, 412×915, 390×844, and 360×640. Review the original canvas and garment tool in Watch/Conversation/History, confirm private content stays protected, and test keyboard/voice behavior.

**This PR should remain draft until tested and reviewed.**