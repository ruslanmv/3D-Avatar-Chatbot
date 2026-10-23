# Try-On Haul: reference-v2 implementation

**Target:** approved reference v2 — avatar first, uncluttered wardrobe, conversational fashion host.

## Stage

- Retain the original `.content-layout`, `.avatar-preview-wrap`, `#avatar-viewport`, canvas and WebGL viewer dimensions. No reparenting, new renderer, automatic reframe or CSS zoom.
- Add a small **AI · LIVE TRY-ON** status pill in the existing preview.
- Add a short current-look label, real current outfit name and concise prompt-derived description at the bottom-left, away from the clothes rail.
- Provide stage controls wired to TryOnView: **Show Back** via `turn()`, **Zoom** via real viewer controls when available, **Save look** via `favorite()`, and prominent **Next look** via `_step(1)`.
- Preserve the distinction between Save and Keep; Keep is an advanced action that finalizes the haul.
- A compact vertical **Looks (N)** rail on the preview's right edge shows actual outfit thumbnails with current-selection highlighting. `＋ More` opens the original advanced TryOnView in place. Never show the advanced panel by default.

## Conversation

- Maintain the existing header and composer, with a subtle subtitle, Live/Conversation switch and real Clear action.
- Watch/Live shows the latest real NEXUS turn, not duplicate outfit thumbnails or synthetic AI messages.
- Quick prompts stay near the composer; style questions include the current outfit context so answers are less generic.
- Conversation shows only recent messages, Full History exposes the original transcript. No avatar portraits in chat.

## Customization (design direction; catalog not implemented by this PR)

The user also requested a premium custom-style editor: treat this as an **opt-in refinement under More**. Keep the avatar visible; open an accessible side drawer or bottom sheet rather than a blocking default modal. In the proposed design, users select a garment category (Top, Bottoms, Shoes, Accessories), choose existing real garment options, and optionally refine with a natural-language instruction (e.g. *keep the jeans, change the top to red*). Show **Current / Proposed** distinction and explicit Apply/Cancel. The actual app currently uses TryOnView/TryOnIntent/TryOnGenerator for requests; do not invent product inventories, material claims, or previews that the existing Forge and wardrobe integrations cannot provide. An image concept is a design target, not a production feature claim.

## Invariants

- Do not change camera framing or camera zoom automatically when selecting outfits or switching chat modes.
- Do not change the viewport or grid sizing at desktop or mobile breakpoints.
- Existing media, Together lifecycle, keyboard/voice input, privacy gating, rapid-tap winner, compare, undo, wardrobe pack actions, Keep, and End must remain functional.
- Do not duplicate a renderer, composer, session state, or model calls.
- Expose advanced controls only by user request and return focus to the visible rail when closed.

## Validation required before merge

Run with Node 24:

    npm ci
    npx jest tests/wardrobe/try-on-stage-experience.test.js tests/wardrobe/try-on-live-layout.test.js --runInBand
    npm run validate
    npm run wardrobe:check

Compare the rendered application with the v2 desktop screenshot at 1920×1080 and 1366×768; review at 1024×768, 390×844 and 360×640. Verify the original canvas dimensions and camera position remain unchanged on entering Try-On and moving through looks (until Zoom is explicitly clicked). Verify the full wardrobe overlay is absent by default and every control works. Test keyboard and voice interactions as well.

**Status:** draft implementation; image catalog customization and complete visual screenshot verification are not yet part of this code change.