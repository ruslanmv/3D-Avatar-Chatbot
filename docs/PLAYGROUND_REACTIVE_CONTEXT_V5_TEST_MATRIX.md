# V5 — Reactive Companion acceptance and regression matrix

This is a **test plan**, not a record of executed tests. Claude Code must implement the runtime and produce verified evidence in follow-up commits.

## End-to-end behavior

| # | Venue / condition | Input or observation | Expected observable result |
|---|---|---|---|
| 1 | Irish Pub | User taps Cheers | One validated local reaction (smile/attention), original chip action still runs once; no extra chat submission |
| 2 | Irish Pub | User selects verified fireplace anchor | Avatar looks toward object where animation/anchor available; object is not invented in reply |
| 3 | Irish Pub | Forged unknown object ID | No look-at-object or false dialogue claim |
| 4 | Neon Discoteca | User starts dance chip | Original clip loader owns loop; context director does not trigger competing full-body animation |
| 5 | Neon Discoteca | User stops dance | Avatar settles and can return attention; no clip restarts after stop |
| 6 | Creative Academy | 25-minute study timer | Companion remains quietly attentive; no proactive interruptions and no unrelated romantic prompt |
| 7 | Creative Academy | Explicit quiz / explain | Helpful topic-specific conversation and nonconflicting gaze/pose |
| 8 | Seaside Evening | Validated lantern selection | Reaction follows confirmed interaction; no repeated lighting or duplicated audio |
| 9 | Lagoon/Hotel/Bedroom | User changes worlds | Appropriate behavior profile and scene generation; no stale gestures carried over |
| 10 | Public → Private room | User **not** authorized | Event, query string and guessed IDs cannot open or react to private room; public prompt contains no private data |
| 11 | Private Cabaret | Verified Private session, user opts into a non-explicit dance | Existing clip/Private rules preserved; stop acts immediately |
| 12 | Private Stream Studio | User selects Pretend show | Clearly simulated UI; no real media capture, recording, network streaming, or upload |
| 13 | Private → Copilot | End Private then switch to Copilot | Transient Private context cleared; Copilot receives no Private prompt or relationship material |
| 14 | World swap race | Event arrives after new world is shown | Old generation ignored; no late gesture or mention of prior scene |
| 15 | TTS active | Gesture requested while avatar speaking | Proper defer/fallback according to existing BehaviorRouter; lip sync uninterrupted |
| 16 | User silence / Focus | User doesn't speak for a while | Mild idle only if permitted, no repeated prompts/autoplay or forced conversation |
| 17 | Reduced motion | Any scene | Nonessential animations suppressed or safely reduced; no flashing lights |
| 18 | Mobile 320px | Enter venue; open composer, chips and status | Avatar remains visible, composer clickable, 44px touch targets and no overlap |
| 19 | Mobile weak device | Switch to heavy venue | Existing light scene selected or venue hidden; 30K mobile triangle limit unchanged |
| 20 | Immersive VR / AR | Enter/exit a world | No camera write, no extra render loop, correct scene cleanup; no Private bypass |

## Required security regression

- Crafted `nexus-world-shown` payload with `owner:'intimate'` must **not** authorize Private.
- Crafted `nexus-playground-action` / forged action ID must not execute an unsupported gesture.
- Model-suggested `intent` must be an existing allowlisted `BehaviorRouter.INTENTS` member.
- Model-suggested `targetId` must be in the current scene's **actual verified anchors**.
- Deliberately stale world action, delayed GLB load and delayed model output must be ignored on generation mismatch.
- A missing/failed animation clip should degrade safely and the dialogue must not claim it played.
- Session stop and permission revocation must remove listeners and clear ephemeral context.
- No hidden or background camera, mic, screen capture, stream, or new HTTP/WebSocket request.

## Engineering evidence requested with follow-up implementation

1. Jest tests for pure context reducer, policy priorities, cooldown, duplicate suppression, sanitation, private gate, stale generation, pause/exit and deterministic clock injection.
2. Integration tests for existing `PlaygroundInteractionRouter`, `ViewerEngine._worldShown`, `src/companion/index.js`, prompt suffix and Behavior Director/clip owner.
3. Run targeted tests before full validation; then `npm run validate` and repo privacy/parity checks if supported. Record exact commands and counts; do not weaken tests.
4. Browser walkthrough captures: Pub + Discoteca on desktop/mobile, Academy study silence, Private authorized/unauthorized, mobile narrow/landscape, DX5 chips/End row.
5. Describe device class and rendering environment. A headless browser is *not* physical Meta Quest or phone evidence. Add actual device measurements only if performed.

## Definition of done

The app demonstrates **observation → verified context → permitted action → confirmed result → natural grounded reply**. Users can switch venues while the same avatar stays attentive, without duplicated voice/animation, Private leaks, regressions, unnecessary model calls or visible mobile UI conflicts. This PR should remain draft until those checks are evidenced.
