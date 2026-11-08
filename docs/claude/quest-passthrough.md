<!-- Moved verbatim from CLAUDE.md on 2026-11-08 so sessions load it only when working on this feature. Keep it accurate: if something here is wrong, fix it in the same change. -->

# Quest passthrough (XP1)

`vr-session-start` fires for **AR sessions too** — VRSupport's `sessionstart`
listener has no mode check, and it is registered before ARSupport's. On a Meta
Quest, an AR session therefore must not be painted, gridded or offset by that
handler: `src/gltf-viewer/XRBackground.js` (pure, imported by `ViewerEngine` for
its side effect, tested in `tests/xr-background.test.js`) answers "paint
nothing, no grid, no eye-level boost" for Quest AR and the old answer for
everything else. **Quest VR stays black and phone AR keeps its background and
viewpoint — both at the person's request; do not widen this without asking.**
`ar-session-start` re-nulls the background on a Quest, and
`ARSupport.forceExit()` resets `_arSessionSetupDone`, without which the next AR
session skipped its setup. Docs: `docs/AR.md` ▸ _Quest: ENTER AR lands in
passthrough_.

**XP2: the VR floor grid is never drawn in AR, on any device** — on a phone it
cut through the room at waist height (it sits at y = 0 of the AR space, which is
where the phone started, not the floor). Surfaces in phone AR are shown the
industry way instead: `ARSupport`'s floor guide, a 2 m grid on the surface the
hit test found, only while she is being placed (before TAP TO PLACE), then gone.
`Settings ▸ Companion ▸ Show floor grid in AR` (`overlay_arfloorgrid`, off by
default, wired in `CompanionMode`'s settings map beside `overlay_arfollow`)
keeps it under her. The rule is `XRBackground.arFloorGuide`, pure and tested; it
never shows on a Quest, where nothing calls `placeAvatarAtReticle`.
