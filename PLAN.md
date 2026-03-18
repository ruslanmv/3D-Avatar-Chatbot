# Mobile Overlay Chat — Implementation Plan

## Goal

Transform the mobile experience from "cramped split-screen" to "fullscreen
avatar with floating chat overlay" — the industry-standard pattern used by
Character.ai, Replika, and Soul Machines.

**Before (current):**

```
┌──────────────────────┐
│  Avatar (150px tiny)  │  ← Postage stamp
├──────────────────────┤
│  Chat (remaining)     │  ← Okay but cramped
└──────────────────────┘
```

**After (overlay pattern):**

```
┌──────────────────────┐
│                      │
│   AVATAR (100%)      │  ← Full-screen 3D secretary
│                      │
│  ┌────────────────┐  │
│  │ Chat messages  │  │  ← Semi-transparent overlay
│  │ (drag to resize│  │
│  ├────────────────┤  │
│  │ [🎤] Type.. [▶]│  │  ← Always visible
│  └────────────────┘  │
└──────────────────────┘
```

## Scope: 2 files modified, 1 new file

### File 1: `styles/main.css` — CSS Changes (~90 lines)

**What changes:** Replace the mobile portrait media query block (lines
3573-3589) and override the phone layout (lines 1665-1815) with an overlay
layout that activates only on phones (≤767px portrait).

**Exact CSS rules to add/replace:**

1. **Override `.content-layout` on mobile portrait** — Switch from
   `display: grid` to `display: block; position: relative` so avatar fills the
   container and chat overlays it.

2. **`.avatar-panel` goes fullscreen** —
   `position: absolute; inset: 0; z-index: 1; max-height: none;` — removes the
   150px/260px cap.

3. **`.chat-panel` becomes overlay** —
   `position: absolute; bottom: 0; left: 0; right: 0; z-index: 2;` with:
    - Semi-transparent gradient background (`rgba(10,14,26,0.85)`)
    - `backdrop-filter: blur(12px)` for glass effect
    - Default height: `50vh` (half screen)
    - Three states via CSS classes:
        - `.chat-overlay--collapsed` → height: `64px` (just input bar)
        - default → height: `50vh` (balanced view)
        - `.chat-overlay--expanded` → height: `85vh` (nearly full for reading)

4. **Drag handle** — A small pill-shaped drag indicator at the top of the chat
   overlay (8px × 40px, centered, `rgba(255,255,255,0.3)`) using `::before`
   pseudo-element on `.chat-panel`.

5. **Chat card transparency** — `.chat-card` background becomes `transparent` on
   mobile so the gradient shows through.

6. **Virtual keyboard override** — Update existing keyboard rule (lines
   3488-3499): instead of hiding avatar entirely, just collapse the chat overlay
   to show more avatar.

7. **AR button positioning** — Ensure AR launch button floats above the chat
   overlay (`z-index: 3`), not hidden behind it.

8. **Safe area handling** — Keep existing `env(safe-area-inset-bottom)` padding
   for the input bar.

**What we DON'T touch:**

- Desktop layout (unchanged)
- Tablet layout (unchanged)
- Landscape layout (unchanged)
- Headset/VR layout (unchanged)

### File 2: `index.html` — Minimal HTML Addition (~8 lines)

**What changes:** Add a chat overlay toggle button inside the existing
`.chat-panel` section.

**Location:** Inside `.chat-card`, before `.chat-card-header` (around line 398).

**Addition:**

```html
<!-- Mobile: drag handle + collapse/expand toggle -->
<div class="chat-overlay-handle mobile-only" id="chat-overlay-handle">
    <button
        class="chat-overlay-toggle"
        id="chat-overlay-toggle"
        type="button"
        aria-label="Collapse chat"
    >
        <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
        >
            <polyline points="6 9 12 15 18 9" />
        </svg>
    </button>
</div>
```

This is a small chevron button centered at the top of the chat overlay. Tapping
it cycles: expanded → default → collapsed → default.

### File 3: `src/MobileChatOverlay.js` — New JS Module (~80 lines)

**Purpose:** Handles the touch-drag and tap-toggle behavior for the chat overlay
on mobile. Only activates when `html.is-mobile` is present.

**Key behaviors:**

1. **Tap toggle** — Clicking the chevron cycles through three states:
    - Default (50vh) → Collapsed (64px, just input) → Default → Expanded (85vh)
      → Default

2. **Touch drag** — User can drag the handle up/down to resize:
    - Track `touchstart` / `touchmove` / `touchend` on the handle
    - Set `chat-panel` height dynamically during drag
    - On release, snap to nearest state (collapsed/default/expanded)

3. **Keyboard awareness** — Listen to `visualViewport.resize` event:
    - When keyboard opens (viewport shrinks), auto-collapse to show input only
    - When keyboard closes, restore previous state

4. **AR mode integration** — When AR session starts, collapse chat to minimal;
   when AR ends, restore.

5. **Chevron rotation** — CSS transform rotates the chevron SVG based on state
   (down = can collapse, up = can expand).

**Script loading:** Add `<script defer src="src/MobileChatOverlay.js"></script>`
after `MobileDrawerWiring.js` in index.html (line 1889).

**Integration pattern:** Same IIFE pattern as `MobileDrawerWiring.js`. No
external dependencies. Checks
`document.documentElement.classList.contains('is-mobile')` before activating.

## Detailed CSS Specification

### States & Transitions

| State         | Chat Height | Avatar Visible | Use Case                   |
| ------------- | ----------- | -------------- | -------------------------- |
| **collapsed** | 64px        | ~95%           | Viewing avatar, minimal UI |
| **default**   | 50vh        | ~50%           | Balanced chat + avatar     |
| **expanded**  | 85vh        | ~15%           | Reading long responses     |

### Transition: `height 0.3s cubic-bezier(0.4, 0, 0.2, 1)`

### Z-index Stack (mobile only)

```
1: .avatar-panel (3D canvas)
2: .chat-panel (overlay)
3: .xr-btn--ar (AR button, floats above)
4: .topbar (always on top)
5: .mobile-drawer (slides over everything)
```

## What This Preserves

- **Desktop:** Zero changes. Grid layout untouched.
- **Tablet:** Zero changes. Side-by-side or stacked grid.
- **Landscape mobile:** Zero changes. 40/60 split stays.
- **Headset/VR:** Zero changes.
- **All existing JS modules:** No modifications to any existing file except
  adding the handle HTML and the script tag.
- **AR compatibility:** The overlay pattern maps directly — avatar is already
  fullscreen, chat is already a floating panel.

## Testing Checklist

- [ ] iPhone SE (375×667) — smallest common phone
- [ ] iPhone 14 Pro (393×852) — standard iPhone
- [ ] Samsung Galaxy S23 (360×780) — standard Android
- [ ] Pixel 7 (412×915) — tall Android
- [ ] iPad Mini (portrait, 768px) — should NOT trigger overlay (tablet layout)
- [ ] Virtual keyboard open/close on both iOS and Android
- [ ] Chat scroll works inside overlay
- [ ] Drag handle snaps correctly
- [ ] AR button accessible above overlay
- [ ] Orientation change (portrait → landscape) disables overlay
