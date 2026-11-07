# Private Mode — Premium UI redesign and verification plan

**Date:** 2026-11-07  
**Branch:** `feat/living-worlds-spatial-storytelling`  
**Scope:** Presentation and interaction placement only. No new consent, adult content, world authorization, renderer, provider or story engine.  
**Evidence:** Two user-supplied screenshots (1170×1992 Private portrait and 1416×500 multi-panel Experiences reference); source inspection of `src/features/together/ui/PrivateConversationView.js`, `src/experiences/playgrounds/PlaygroundInteractionRouter.js`, `src/features/together/ui/SceneTaleMobileMode.js`, and `docs/qa/NEXUS_PREMIUM_WORLD_INDUSTRIALIZATION_REPORT.md`. Original user screenshots are **not committed** to the repository.

## 1. Executive decision

**Keep one app, one conversation and one interaction router. Private should be the same premium, scene-first product as Experiences with a warmer accent and stricter context isolation—not a second application drawn over the avatar.**

The Private screenshot shows the avatar's head competing with a large floating venue-chip bar, while a high-contrast magenta transcript panel occupies the space above an already large composer. The Experiences screenshot shows the better model: scene owns the left/upper view, contextual actions are compact, and conversation is a distinct, calm surface.

**Do not remove consent controls or hide End to make the screen appear cleaner.** The experience's actual session state, decisions and safety owners must remain unchanged.

## 2. Findings and root causes

| Issue | What the screenshot shows | Verified source cause | Priority |
| --- | --- | --- | --- |
| PUI-01 Avatar occlusion | `A dance / Take a bow / A song` bar crosses the avatar's head and upper body on portrait | `PlaygroundInteractionRouter.place()` docks a private template's chips to `<body>` when Private has no companion End pill; the dock uses chat-card top rather than a Private-specific action surface | P0 |
| PUI-02 Heavy card | Thick purple/pink panel dominates the lower third; mood feels like a pop-up | `PrivateConversationView` shell uses opaque gradient, prominent border/shadow and on mobile sets row height to the entire chat-history box | P0 |
| PUI-03 Competing action hierarchies | Three floating venue actions, two large suggested replies, Closer, End, plus composer | Chips are owned by Playground; suggestions and consent footer are owned by Private; visual placement is not coordinated | P0 |
| PUI-04 Dense mobile typography | Large padding, stacked long choices and footer compete for limited portrait height | Existing choice list is column-only, body and control blocks each have their own padding | P1 |
| PUI-05 Missing compact/expanded affordance | Private has one persistent transcript-card size | Conversation overlay is owned by the native mobile overlay controller. A separate Private resize state is **not implemented** | P1 |
| PUI-06 Release proof missing | Screenshot is headless/browser-style evidence, not physical device evidence | Existing QA doc explicitly marks real phone and Quest testing incomplete | P0 for production |

### Important architectural facts

- `PrivateConversationView` mounts inside `#chat-history`, owns **presentation** and session-local transcript. Do not write Private turns into `nexus_chat_messages`.
- The Private experience session owns consent, timing and pace. Do not put a second consent state machine in the view.
- `PlaygroundInteractionRouter` already owns and reports the chips' effects. **Move this actual toolbar; do not clone its buttons or duplicate their handlers.**
- `SceneTaleMobileMode` states the native `MobileChatOverlay` snap/tap/drag controller remains authoritative. Preserve it.
- Private World is intentionally **off by default**. The branch QA report requires server-side authorization, age assurance, compliance review, real-device QA, model quality, dependency remediation and pinned-runtime validation before release. UI styling does not close those blockers.

## 3. Target visual system — Private Experience, not Private modal

### Design language

- **Scene-first:** avatar, body language and physical world remain visible. Nothing unrelated floats across the face or blocks gaze.
- **Shared components:** inherit Experience chip behavior and motion; Private adjusts color, copy, and available actions based on verified Private session state.
- **Warm restrained palette:** base near-black charcoal, secondary text slate, small warm rose/pearl accents. No saturated full-card gradient, neon banner or continuous pulsing.
- **Typography:** clear contrast and hierarchy; `PRIVATE` is a small status kicker, not a giant badge. Current pace (Warm etc.) is a small understated status token.
- **One action location:** verified venue chips appear in a horizontal scrollable rail **inside the Private conversation shell immediately beneath its heading**. Suggested speech replies remain under the relevant avatar message, never mixed with venue actions.
- **Consent always accessible:** the actual Closer/Ease/End controls retain their existing guards; End remains clear, keyboard reachable and not visually hidden.
- **A real conversation:** keep the session-local rolling transcript, newest response, suggestions and composer. Do not create a second chat panel, artificial avatar portrait or repetitive introduction.
- **No layout-driven behaviors:** cosmetic UI cannot imply new world actions or change AI behavior permissions.

### Proposed mobile wireframe

```text
┌────────────────────────────────┐
│ HomePilot Avatar        Ready  │
├────────────────────────────────┤
│                                │
│       3D companion + scene     │
│     [clear view of face]       │
│                                │
│        Native VR controls      │
│                                │
├────────────────────────────────┤
│ 🔒 PRIVATE      [Warm]   Room  │
│ [Dance] [Bow] [Song] …         │  ← ONE scrollable rail
│ NEXUS  A short response…       │
│ [Reply choice] [Reply choice]  │  ← only when offered
│ pace · ·     [Closer] [End]    │
├────────────────────────────────┤
│ [🎙]  Talk privately…    Send  │
└────────────────────────────────┘
```

The conversation surface may be expanded by the native overlay; when the keyboard opens, the transcript scrolls without obscuring the composer or End. **The screenshot is a target arrangement, not measured physical pixels.**

### Desktop layout

Preserve the existing split-screen model seen in Experiences. The avatar/world viewport remains the visual anchor. Place Private transcript, options and consent in the existing conversation column; the shared venue actions live in that same column rather than across the avatar. No duplicate panel over the renderer.

### VR / immersive layout

The HTML chips are not visible through an immersive WebXR headset as DOM. Keep the existing VR panel and voice/controller paths; **do not assume that moving HTML nodes creates a VR HUD**. A later XR-specific UI pass must review distance, size, snap/teleport controls, end access and user comfort on real hardware.

## 4. Implemented first slice (PUI-01 / PUI-02)

### Files changed

- `src/features/together/ui/PrivateConversationView.js`
  - Added a `.nexus-private-action-slot` between the header and transcript.
  - Emits `nexus-private-view-layout` on mount and teardown; this is a **presentation-only** event with no consent or action payload.
  - Added scoped premium UI styles: understated shell, cleaner header, warmer low-opacity accent, compact transcript, lighter suggestions and controls.
  - Mobile sizing is bounded by dynamic viewport height rather than filling 100% of the chat-history region; scroll remains inside the transcript.
- `src/experiences/playgrounds/PlaygroundInteractionRouter.js`
  - When a verified active template has `rating === 'private'`, the **same actual bar** is moved to the Private action slot.
  - The bar is hidden if no Private conversation slot exists; it is never left floating across the avatar.
  - Re-positions when `nexus-private-view-layout` fires, and unregisters the event on detach.
  - General and romantic Experiences retain the existing companion-pill/composer/mobile docking behavior.
- `tests/private-world/premium-ui.test.js`
  - New jsdom checks for hidden private chips before mount, shared toolbar in the Private card, hide-on-teardown, preservation of current pace/End, and general-world docking after transition.

**Test status (update, 2026-11-07):** These changes were then run.

- **Jest:** the first slice broke two existing tests (P27's 30vh rule, and the playground studio chips). Both are fixed.
- **Browser:** the screenshot harness (`tools/qa/private-ui-shots.mjs`) found three layout failures and PUI-3 fixed them:
    - the desktop transcript was capped and half the column was empty
    - on phones, the heading and chips were cut off the sheet's top
    - in landscape, End was cut off the bottom
- **Format and gate:** `npm run format` and `npm run validate` exit 0, and the parity check is OK.
- **Physical devices:** not tested.

See `docs/qa/PRIVATE_PREMIUM_UI_VISUAL_QA.md`.

### What this does *not* do

It does not alter `PrivateWorldAdapter`, consent levels, backend attestation, session timing, content, avatar rendering, music, native mobile snap states or XR UI. It does not guarantee a specific number of pixels remain visible across all devices; that needs screenshot testing.

## 5. Execution plan for Claude Code

| Phase | Work | Exit gate |
| --- | --- | --- |
| **PUI-1 — verify current changes** | Rebase only if explicitly safe; run Prettier, targeted Jest, full `npm run validate` and parity check. Fix anything the new tests exposed | Zero existing regressions; no Private controls lost |
| **PUI-2 — visual harness** | With existing Playwright/headless Chromium, capture the current Private screen and the same sizes as Experiences: desktop 1440×900, mobile 390×844 and 320×568, phone landscape, with and without keyboard, short/long text | Side-by-side before/after screenshots, non-explicit fixtures; chips never cover face |
| **PUI-3 — responsive layout polish** | Measure native `MobileChatOverlay` states. If height still consumes too much world, introduce compact/expanded **content** presentation using the native overlay API, not a second mobile panel. Keep accessibility of choices and End | Native tap/drag/collapse unchanged, no inaccessible choice or clipped End |
| **PUI-4 — visual system shared with Experiences** | Extract small design tokens for glass, border, spacing, typography, action pills; keep rating-specific accents but one architecture. Avoid big CSS rewrite until verified | Experience mode screenshots unchanged except deliberate shared improvements |
| **PUI-5 — accessibility and QA** | Keyboard tab order, screen-reader transcript status, 44 px touch targets on coarse pointers, contrast review, reduced-motion, focus visible, no page-wide horizontal scroll. Test localization (English/Italian) and long strings | Automated tests + manual accessibility checklist |
| **PUI-6 — XR and hardware** | Physically verify Quest and phone. Check floating hand/controller panels and 72 Hz frame pacing, user-controlled camera movement, safe End access | Real device evidence recorded, no extrapolation from SwiftShader |
| **PUI-7 — production readiness** | Update release gate only after backend eligibility, age assurance, legal/compliance review and other QA blockers are complete | Sign-off by respective owners; **no automatic enablement** |

## 6. Acceptance criteria and regression scenarios

1. Private opens with a verified venue; actions show in a single horizontally scrollable compact rail **inside** the Private surface.
2. At 390×844 and 320×568, actions no longer overlay the avatar face. No duplicate chip toolbar exists.
3. Private view unmount hides the Private chip bar immediately even if a world event arrives late.
4. Experiences (pub, discoteca) keeps its original chip docking and behavior.
5. The same validated action IDs still trigger their real owners; display relocation does not create new capabilities.
6. The current pace and End are accessible at all times, including on the narrowest tested phone.
7. Long avatar replies scroll within the transcript; current suggested responses remain accessible without clipping.
8. No Private turns enter ordinary chat-history persistence and no private state reaches public/Copilot.
9. No new auto-expansion of the chat panel when it was deliberately collapsed by the user.
10. Tab, Enter, Escape, pointer and touch behavior remain correct; no accidental scene navigation from a layout event.
11. English and Italian copy does not overlap at either phone width.
12. With reduced-motion enabled, there are no forced decorative transitions.
13. Desktop split layout remains compatible with normal chat; mobile experience is still controlled by `MobileChatOverlay`.
14. Accessibility audit meets WCAG 2.2 AA as far as applicable, with documented exceptions and verification of 4.5:1 text contrast and 24×24 CSS pixel minimum for AA target size; **44×44 preferred touch targets for primary mobile controls**.
15. Verify physical phone and headset before declaring VR/mobile production-ready.

## 7. Known tradeoffs and risks

- Moving a live toolbar into the chat card can add one extra row to the conversation on small phones; the old position blocked the avatar. The next visual QA pass must balance that tradeoff.
- The existing native mobile chat sheet can still obscure the lower avatar when expanded; this patch limits the Private card but deliberately does **not** alter `MobileChatOverlay` snap-state logic. That is PUI-3.
- A DOM-mounted Private card is a presentation signal, **not a new gate**. The actual Private template remains restricted by world owner/rating and the original Private session authorization.
- The existing color and touch targets must be measured in browser at each breakpoint; scoped styles do not prove contrast or visual quality.
- This report does not change the historical Private World implementation report; its D5 finding remains the baseline, with follow-up evidence to be added after actual regression runs.
- Server-side age assurance and asset authorization remain independent production blockers.

## 8. Next concrete actions

1. Run `npm run format` and `npx jest tests/private-world/premium-ui.test.js tests/playgrounds.test.js` in a checked-out repository with Node 24 and dependencies.
2. Run `npm run validate` and `node scripts/behavior-parity-baseline.mjs --check`.
3. Capture screenshots using the repository's existing Playwright harness; compare avatar face visibility, chip position, transcript height, composer collision and focus order.
4. Repair any issues found; do not weaken guards, loosen Private access or rewrite the native mobile chat state machine.
5. Save before/after images and exact outcomes in `docs/qa/PRIVATE_PREMIUM_UI_VISUAL_QA.md`.
6. Keep changes **on this branch only**, without creating or reopening a PR.
