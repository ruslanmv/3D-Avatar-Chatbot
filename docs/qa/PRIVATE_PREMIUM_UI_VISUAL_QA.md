# Private premium UI — visual QA

**Date:** 2026-11-07 · **Branch:** `feat/living-worlds-spatial-storytelling` · **Plan:** `docs/PRIVATE_PREMIUM_UI_REDESIGN.md` (PUI-1 to PUI-3)

**Renderer:** headless Chromium with **SwiftShader** (software). Everything below is layout and visibility evidence. None of it is phone or headset evidence: "phone" is Playwright's iPhone 13 profile, "small phone" is 320×568 with the iPhone SE profile, "landscape" is iPhone 13 landscape. Physical-device QA (PUI-6) is still open.

## 1. How it was measured

`tools/qa/private-ui-shots.mjs` (committed) drives the real page:

1. It starts Together ▸ Private through the panel, exactly as the tile does, on AvatarSample A (declared adult, PW8), with the Private cabaret as the room.
2. It draws a fixed, non-explicit transcript through the real conversation surface: short (2 turns) and long (6 turns).
3. On phones, it focuses the composer (the keyboard state).
4. It shoots the same sizes in Experiences ▸ Irish pub, as the reference.

For every shot it asks the browser, rather than the eye:

- **What is drawn at five points of her face.** It projects her head bone and calls `elementFromPoint`. Anything other than the 3D canvas covers her.
- **Where the venue chips are:** inside the Private card, or floating.
- **The transcript's visible height** against its content height.
- **Whether End and the composer are on screen and on top.**
- **Whether the page scrolls sideways.**

Three builds, the same harness:

- **Before:** this branch with the two UI files at their pre-redesign versions (`cbd3244`), served from a worktree.
- **First slice:** the committed redesign, `eafa7da` and `d776a5a`.
- **Now:** after the PUI-3 fixes in this change.

Raw numbers: `docs/images/private-ui/measurements-{before,first-slice,now}.json`.

## 2. Results (long transcript)

| Size | Build | Face covered by | Chips | Transcript visible / content | End visible |
| --- | --- | --- | --- | --- | --- |
| Desktop 1440×900 | before | — | floating, by composer | 306 / 505 px | yes |
| | first slice | — | in card | **230 / 488 px**, half the column empty | yes |
| | **now** | — | in card | **473 / 473 px**: the whole conversation | yes |
| Phone 390×844 | before | **chip bar** | floating **across her face** | 105 / 607 px | yes |
| | first slice | — | in card, but **scrolled off the top of the sheet** | 139 / 595 px | yes |
| | **now** | — | in card, sharing the heading line | 87 / 507 px | yes |
| Small phone 320×568 | before | **chip bar** | floating **across her face** | 57 / 630 px | yes |
| | first slice | — | in card, **scrolled off the top** | 97 / 616 px | yes |
| | **now** | — | in card, sharing the heading line | 39 / 528 px | yes |
| Landscape 844×390 | before | — | floating | 24 / 573 px | **no** |
| | first slice | — | in card | 54 / 531 px | **no: footer clipped** |
| | **now** | — | in card, sharing the heading line | 33 / 443 px | **yes** |

Every build, every size: no sideways page scroll, composer visible, no page errors.

### Pictures

Each image holds four panels: before, first slice, now, and the Experiences reference.

- Desktop: `docs/images/private-ui/pui-desktop.jpg`
- Phone: `docs/images/private-ui/pui-phone.jpg`
- Small phone: `docs/images/private-ui/pui-small-phone.jpg`
- Landscape: `docs/images/private-ui/pui-landscape.jpg`

## 3. What the first slice got right, and what it broke

**Right:** the chip bar is the same router's bar, moved, not cloned. It never crosses her face. It hides when the Private card is gone. General venues keep their docking. The jsdom tests in `tests/private-world/premium-ui.test.js` hold all of that.

**Broke (found by this harness, fixed here):**

1. **Desktop continuity.** The card was capped at a third of the viewport (230 px). Only the last reply was visible, and the column below was empty.
2. **Phones.** The row was capped at 44dvh / 320 px, taller than the chat sheet the native overlay gives it. The sheet scrolled, and Private's heading and the chip rail were cut off its top: the actions were present and unusable.
3. **Landscape.** The same cause cut the footer off the bottom, so **End was not reachable**.
4. **Two existing tests failed:**
    - P27 "the transcript is no longer capped at 30vh"
    - the playground studio test, which expected chips without a Private card

## 4. The fix (PUI-3), presentation only

All of it is in `PrivateConversationView`'s stylesheet:

- **The row is exactly its box at every width** (`height: calc(100% - 14px)`). This extends P27's mobile rule to desktop. Heading, chip rail and footer are fixed; only the transcript scrolls.
- **The transcript is the one part that may shrink, to zero** (`min-height: 0`). End is never what gives way.
- **Suggested replies are one row of pills.** They wrap on a wide card and scroll sideways on a narrow one. They were three stacked full-width buttons, which on every phone filled the whole visible card.
- **On phones and short screens, the heading and the chip rail share one line.** This is CSS grid, with `:has()` so an empty rail costs nothing; without `:has()` support the rail simply takes the next line.
- **44 px targets for chips, replies and Closer / End on coarse pointers.**

No change to:

- consent
- the Private session
- `PrivateWorldAdapter`
- `PlaygroundInteractionRouter`'s ownership of the chips
- `MobileChatOverlay`'s snap states

The studio test now mounts the Private action slot, the only place a private room's chips may appear. It also pins that they stay hidden without the slot.

## 5. Judged against the requirements

| Requirement | State |
| --- | --- |
| Avatar visible: nothing across her face | **Met** at all four sizes (face points hit the canvas) |
| Action chips integrated cleanly, one toolbar | **Met**: the router's own bar, in the card, one line with the heading on phones |
| Fewer overlays | **Met**: no floating private chip bar; the card stays inside the conversation surface |
| Conversation continuity | **Met on desktop** (whole transcript). **Partial on phones.** See §6 |
| End always accessible | **Met** at all four sizes, including landscape, where it was lost before and in the first slice |
| No duplicated chat, animation or router | **Met**: same surface, same view, same router |
| Consent and authorization unchanged | **Met**: CSS only, plus a test fixture |

## 6. Known limits and next step

- **Phone transcript height is bounded by the native chat sheet.** Its height is decided by `MobileChatOverlay`, which this change deliberately does not touch. With heading, chips and footer kept on screen, a 390×844 phone shows about 87 px of transcript in the default sheet state (one or two lines above the reply pills). A 320×568 phone shows about 39 px, mostly the reply pills. Before, those numbers were larger only because the chips floated across her face instead. The person can expand the sheet with its own chevron.
- **PUI-3b (proposed, not built):** a compact sheet state or "reply ideas" behind one chip on short screens, through the native overlay's API. It needs its own device check.
- **Experiences comparison.** Experiences docks its chips in the composer row and has no consent footer, so its sheet is shorter and more of her shows. Private keeps a consent footer by design (Closer / End must stay visible), so it will always spend one more row.
- **Not covered:**
    - Italian strings at 320 px (the harness's transcript is mixed English and Italian; Private's own UI copy was English in these runs)
    - screen-reader order
    - contrast measurement
    - reduced-motion screenshots
    - XR (PUI-5, PUI-6)
- **Physical devices: none.** Do not call this production-ready (`docs/qa/PRIVATE_WORLD_RELEASE_READINESS.md`).

## 7. Commands

```bash
npm start
node tools/qa/private-ui-shots.mjs --out tmp/private-ui --label now
npx jest tests/private-world tests/behavior/private-conversation-view.test.js tests/playgrounds.test.js
npm run format && npm run validate        # exit 0: 6051 tests, 274 suites
node scripts/behavior-parity-baseline.mjs --check   # OK
```
