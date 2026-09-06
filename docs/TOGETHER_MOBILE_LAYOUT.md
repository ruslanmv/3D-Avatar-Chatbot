# The Together sheet and the chat composer

**Status:** shipped.

## What was wrong

On a phone the Together panel is a bottom sheet: `position: fixed; left: 0; right: 0; bottom: 0`.
The chat composer is pinned to the bottom of the same screen. Both were claiming the same strip.

Measured in a 412×915 viewport with Music open:

| | |
|---|---|
| sheet bottom edge | 915 |
| composer top edge | 839 |
| **overlap** | **76 px** |

Those 76 pixels are where Music keeps *Open an audio file* and *Back*. Watch loses its confirm
row the same way. And the sheet was **not scrolling** — `scrollHeight` and `clientHeight` were
both 351 — so its content fitted the space it had been given and nothing about it looked wrong.
The buttons were on screen, drawn, and dead: the composer took the tap.

## Why it is not a z-index fix

The sheet already outranked the composer (`z-index: 1001` against the composer's stacking
context). Raising it further would have put the sheet *over* the chat bar — the same collision
wearing the other hat, with the mic and the send button underneath it instead. The bottom strip
has one owner and the layout has to say who.

## The fix

**`src/features/together/ui/composerInset.js`** measures the distance from the top of the
composer to the bottom of the visual viewport and publishes it as `--nexus-composer-inset` on the
root element.

Measured, not written down, because the composer is not one height:

* collapsed it is a bar (~88 px here, including its own safe-area padding);
* expanded, the chat overlay is most of the screen;
* with the keyboard up, the **visual** viewport shrinks under it — `window.innerHeight` does not
  change on Android Chrome, so a sheet sized from that one is back underneath the composer;
* iOS moves the whole thing as browser chrome comes and goes.

A constant in a stylesheet would have been correct in exactly one of those states. It re-measures
on `resize`, `orientationchange`, `visualViewport` `resize` and `scroll`, and through a
`ResizeObserver` on the composer itself.

Measuring **from the composer's top edge to the bottom of the viewport** rather than taking the
bar's height does two things at once: it folds in the safe-area padding the composer already
carries — so nothing has to guess at `env(safe-area-inset-bottom)` or count it twice — and it
ignores the part of a bar drawn past the fold, which on iOS is the home-indicator area.

**The stylesheet** then spends that number at both ends:

```css
bottom: var(--nexus-composer-inset, calc(88px + env(safe-area-inset-bottom, 0px)));
max-height: min(62vh,  calc(100vh  - var(--nexus-composer-inset, …) - 4.5rem));
max-height: min(62dvh, calc(100dvh - var(--nexus-composer-inset, …) - 4.5rem));
overflow-y: auto; overscroll-behavior: contain;
padding-bottom: max(1rem, env(safe-area-inset-bottom, 0px));
```

Both ends, or neither: a sheet offset upward but still 62% tall grows off the *top* of the screen
instead of under the composer. `dvh` tracks mobile browser chrome and `vh` is the fallback
underneath it for phones without `dvh`. The 62% cap is the one the sheet already had — it keeps
the avatar in view — and the `calc` is the floor that guarantees clearance when the keyboard has
taken most of the screen.

The literal fallback covers the frames before the measurement lands, and a document where the
module never loads. Once it has run on a phone it always writes a number, `0px` included:
"measured, and there is no composer" and "JS has not run" are different situations, and leaving
the property blank in the first case would reserve space for a bar that is not there.

## Verified

Chromium at 412×915 and 360×640, with the launcher opened from the drawer:

| panel | sheet bottom | composer top | overlap | unreachable buttons |
|---|---|---|---|---|
| Music | 827 | 839 | 0 | 0 of 4 |
| Watch | 827 | 839 | 0 | 0 of 5 |
| Meeting | 827 | 839 | 0 | 0 of 2 |
| Coach | 827 | 839 | 0 | 0 of 2 |

"Unreachable" is `document.elementFromPoint` at each control's centre resolving to something
outside the panel — the actual question, rather than whether the rectangles happen to intersect.

Under a keyboard-sized reservation the sheet keeps clearing it and starts scrolling instead of
being clipped:

| inset | sheet top | sheet bottom | scrolls internally |
|---|---|---|---|
| 88 px | 471 | 827 | no (content fits) |
| 300 px | 259 | 615 | no |
| 430 px | 129 | 485 | no |
| 700 px | 72 | 215 | yes |

## One sheet, every activity

There is one `#nexus-bd-together-panel`. The launcher grid, each activity's setup screen and the
media search picker all render inside it, so this reaches every Together submenu rather than
Music alone. `ConsentIndicator` is the recording pill at the top and the screenshot lightbox is
its own full-screen surface; neither competes for the bottom strip.
