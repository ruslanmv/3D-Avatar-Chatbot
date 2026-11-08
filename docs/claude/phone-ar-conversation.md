<!-- Moved verbatim from CLAUDE.md on 2026-11-08 so sessions load it only when working on this feature. Keep it accurate: if something here is wrong, fix it in the same change. -->

# Talking to her in phone AR (AR1)

AR is another surface for the same conversation, not a mode of its own.
`initAROverlay` in `src/main.js` is the bridge (TAP TO PLACE, mic, SEND,
captions, the 💬 transcript); `src/gltf-viewer/ARConversation.js` (IIFE,
`tests/ar-conversation.test.js`, loaded after `ARCoachingOverlay.js`) holds its
rules.

- **`ARSupport.placeAvatarAtReticle` answers `{ placed, reason }`** and
  dispatches `ar-avatar-placed` on success, which ends the coaching card at
  once. It used to return nothing, so a tap before any surface said "Avatar
  placed" and opened the mic with her placed nowhere. The mic opens only on a
  real placement (`afterPlaceTap`); the tap stays the gesture that authorises
  it.
- **The pipeline draws every turn once.** `handleUserMessage` renders through
  `addMessageToHistory`, which mirrors into AR — so SEND must not draw a bubble
  itself (it did, and every typed message showed twice).
- **The transcript is the conversation.** Each `ar-session-start` rebuilds it
  from `_surface().history()` (replies there are already tag-stripped), and
  mirroring is ignored while AR is closed — so leave/re-enter neither loses nor
  repeats a turn.
- **AR2: AR drives voice only through CompanionMode's public conversation API**
  — `startConversation()` (answers `{ ok, reason, message }`),
  `stopConversation()`, `conversationStatus()`
  (`{ live, state, micReady, muted }`) and the window event
  `companion-conversation` (`event`: `state`, `mic-open` or `error` with
  `reason`). `micReady` turns true only when the browser really opened the mic
  (recognition `onstart`, or the silent between-turns listener got its stream)
  and stays true across turn gaps. A blocked or busy mic is an `error` event
  _before_ the call goes idle — the companion's own toast is outside the AR DOM
  overlay and invisible in AR, so AR shows the sentence itself
  (`ARConversation.voiceView`, `tests/ar-voice.test.js` with a scripted
  recognizer). Never read `_live`, `_convState` or call `_startLive()` from
  outside CompanionMode; a test checks the AR overlay.
- Not done yet (the plan's phases 4–5): `domOverlayState` checks,
  `beforexrselect` on the controls, barge-in while she speaks.
