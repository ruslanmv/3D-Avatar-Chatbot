# Lighting for VRM in VR, and the Private setup screens: audit and plan

Written 2026-11-21 (NL1, NL2, UI1). It records what the industry recommends, what this
app does today, what was decided, and the future work in enough detail to do it again
without re-researching. Read with `docs/claude/qa-tools.md` (the tools named here).

## 1. What the industry recommends

**VRM avatars (MToon toon shading).** MToon mixes a *lit* colour and a *shade* colour from
the light: it is not physically based. Two consequences:

- The look depends on the light's **intensity and colour balance** (ambient against
  directional), more than on any single material setting: a stronger key pushes skin
  along the toon ramp into the lit colour, a weak one into the shade colour.
- **Tone mapping changes the toon look the most.** The VRM / VRoid Hub workflow renders
  MToon with **no tone mapping** (`THREE.NoToneMapping`): ACES Filmic compresses highlights
  and shifts hues, which washes out pale skin and pastel hair.

Sources: UniVRM MToon reference (dwango.github.io/en/vrm/univrm/shaders/mtoon), the MToon
parameter reference (wiki.virtualcast.jp, Shading Toony / Shading Shift), the Redshift toon
material notes (help.maxon.net) on tone mapping and the ramp.

**Meta Quest 3 (WebXR, standalone mobile GPU).**

- Most WebXR slowdowns on Quest are **GPU bound**. Keep **real-time shadows off**; use
  baked or blob or contact shadows instead (Meta, "PC rendering techniques to avoid when
  developing for mobile VR"; developers.meta.com/horizon/documentation/web/webxr-perf-bp).
- **Bake lighting** into lightmaps for static rooms where possible. Keep few dynamic
  lights, and **fewer than ~100 draw calls**. Use KTX2 textures and merged static
  geometry (`BufferGeometryUtils.mergeGeometries`).
- **Comfort.** No abrupt brightness changes, and nothing too bright or too dark
  (developers.meta.com/horizon/design/lighting-and-effects). Avoid flicker and
  high-contrast stripes (developers.meta.com/vr/resources/bp-rendering). Hold 72 fps at
  least (90 preferred).
- **Accessibility.** VRC.Quest.Accessibility.5 asks apps to let people adjust
  **brightness/contrast** in-app (required in some store categories, recommended
  elsewhere).

## 2. What we do today (audit)

| Practice                         | Today                                                                                                  | Status       |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------ |
| Real-time shadows off on Quest   | `renderer.shadowMap.enabled = false` by default (`ViewerEngine.js`)                                    | ✅           |
| Smooth light changes             | moods blend over `MOOD_SECONDS` 0.9 s (`VRWorlds.js`); a cut only under reduced motion                 | ✅           |
| Normal-light switch blends       | NL2 flips mid-evening blend; on arrival it applies under the world's own fade                          | ✅ (fixed)   |
| Her face never in the dark       | every mood keeps hemi ≥ 0.4 and fill ≥ 0.35 (test `moods › the presets…`)                              | ✅           |
| Few dynamic lights               | 1 hemisphere + 4 directional (key, fill, rim, bottom fill), all live                                   | ⚠️ could be 2 in XR |
| No tone mapping for MToon        | **ACES Filmic by default**; `setToneMapping(false)` exists but is off                                  | ⚠️ see 4.1   |
| Baked lighting for rooms         | stylized rooms are lit live (Kenney props, flat colours)                                               | ⚠️ see 4.3   |
| In-app brightness                | only the room light choice (NL2); no brightness slider                                                 | ⚠️ see 4.2   |

**Does a light change need her skins reprocessed?** No. Forge paints skin packs into
the base-colour textures (and a normal map). The light is applied at render time by
MToon, so any light, mood or tone-mapping change works on every look already in the
dataset. Nothing in Forge is rebuilt for lighting. This is why NL1/NL2 stay: they are
one setting, off by default (rooms keep their own light, as before), and cost no
rebuild.

## 3. What was done (2026-11-21)

- **NL1:** the `normal-room` mood (`PlaygroundMoodPresets.js`) repaints the lamps and also
  the sky, fog and floor (`VRWorlds.setMood(light, { room })`, `roomFor`). It is the
  Window Room's fourth 💡 Light choice.
- **NL2:** `src/experiences/private/PrivateRoomLight.js` is the person's choice, remembered.
  Settings ▸ Private Mode ▸ "Normal room light in Private", or the ⋯ chip 💡 (nine
  languages). It applies to every private room shown. Off gives the room its own light
  back. The model never changes it.
- **Live checks:** `tools/qa/private-positions-live.mjs --normal-light` (the saved choice)
  or `--mood <id>`.

## 4. Future work, each step reproducible

### 4.1 No tone mapping for MToon in Private (look closer to VRoid)

1. Frames before: `node tools/qa/private-positions-live.mjs --level5 --world window-room
   --normal-light --behind --keys all-fours,face-down --out <scratch>/tm-aces`.
2. In the page, `window.NEXUS_VIEWER.setToneMapping(false)` before the frames (add a
   `--no-tone-mapping` flag to the script, like `--normal-light`), and run again into
   `<scratch>/tm-none`.
3. Compare in Forge: `.venv/bin/python tools/qa/compare_frames.py --run ACES=<scratch>/tm-aces
   --run None=<scratch>/tm-none --frames all-fours-behind,face-down-behind`.
4. Pale skins and pastel hair should keep their colour. If whites clip, lower each mood's
   `keyIntensity` by about 15% instead of keeping ACES.
5. If better, make it the Private default: a setting beside NL2, applied on
   `nexus-world-shown` (rating private) and restored on exit (snapshot, never undo).
   No Forge change: skins are not reprocessed.

### 4.2 In-app brightness (Meta VRC.Quest.Accessibility.5)

1. Add a slider beside NL2 for `renderer.toneMappingExposure`, 0.7–1.3, default 1. Store
   it in `nexus_private_brightness`.
2. Apply it in `VRWorlds.writeWorldLight` as a multiplier on `w.exposure`, so moods keep
   their balance.
3. Test it the way `tests/private-room-light.test.js` tests NL2.

### 4.3 Fewer lights in a headset (performance)

1. Measure first: `renderer.info.render.calls` and the frame time in the Quest browser
   (`tools/vr/` scripts; Chrome DevTools over USB).
2. While `renderer.xr.isPresenting`, zero the rim and bottom fill. The hemisphere, key
   and fill carry MToon. Keep the face floors (hemi ≥ 0.4, fill ≥ 0.35).
3. Bake only if a measured room drops under 72 fps: lightmaps for Kenney-prop rooms via
   `tools/vr/prepare-scene.mjs`, never for her.

### 4.4 A normal-light variant per room (if wanted)

Rooms with a painted sky are covered by `normal-room` today. A room whose GLB carries its
own red materials (not only the sky) needs a `lightVariants.normal` in
`assets/vr-worlds/worlds.json` with material colour overrides. Add it to `roomFor` and
check it with `--normal-light`.

## 5. The Private setup screens (UI1): review notes

Capture: `node tools/qa/private-setup-shot.mjs --lang it-IT --out <scratch>/setup-ui`. It
writes desktop and iPhone frames of step 1 ("Che atmosfera desideri?") and step 2
("Scegli l'atmosfera"), panel-only and full page.

Found on 2026-11-21, to make it look premium:

1. **Mixed languages.** Under Italian, the place names and "Current place" are English
   ("Current place", "Hotel suite", "Apartment", "Bedroom", "Lagoon beach"), and so are
   "TOGETHER" and "Type your message…". Route the place titles and the current-place
   card through `PrivateLocale` (`place.<id>.title`), all nine packs.
2. **On desktop the panel covers her.** The setup sheet sits over the avatar viewport's
   lower half. Either dock it beside her (the conversation column is empty during setup)
   or dim her and lift the sheet into a centred modal with her as a blurred background.
3. **Step 2 scrolls before the choices are seen.** Six room cards in two columns run
   below the fold on both desktop and phone. Use one horizontal row of larger cards with
   scroll-snap, the selected one with a pink ring. Put the begin button sticky at the
   bottom.
4. **Hierarchy.** The kicker "🔐 PRIVATO", the step dots, the title and the section labels
   are all small and centred. Make the title one size up, align the section labels with
   the cards, and give the dots more contrast.
5. **Room previews** are taken with her standing in clothes against the room's own light.
   With NL2 on, preview the room in normal light, or show both as a small toggle on the
   card.

Each change is front-end only (`src/features/together/ui/TogetherPanel.js`, its style
block `_privateStyles`). Check it with the capture script above, desktop and iPhone,
before and after.
