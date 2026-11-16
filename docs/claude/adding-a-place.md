# Adding a place (a 3D scenario): the short path

For an AI coder. Every step is a command that exists; nothing is typed by eye. Worked examples:
the cinema (VW5), hotel lobby and bathroom (VW6), restaurant and bar (VW7), sports club (VW8),
fantasy places (VW9) in `docs/VR_WORLDS.md`. Rules behind the steps:
`docs/claude/vr-worlds-and-playgrounds.md`.

## The budget

| Device  | Triangles                | How                                              |
| ------- | ------------------------ | ------------------------------------------------ |
| Phone   | at most 30 000 (enforced) | a light version cut by recipe, `tiers: ["mobile", "vr"]` |
| VR      | the light version, or the full one under about 40 000 | `lightFor` points at the full place |
| Desktop | the full scene           | `tiers: ["desktop"]`                             |

A scene already under 30 000 is one world with all three tiers and no light version.

## Steps

1. **Get the file.** GLB only, a licence that allows redistribution (CC0 is the norm here).
   Download into its own directory, then copy it in: a file you ship whole goes to
   `assets/vr-worlds/scenes/`, a file you only cut from goes to `assets/vr-worlds/sources/`.

    ```bash
    curl -sSL -o /tmp/dl/scene.glb <download url>
    ```

2. **Look before you cut.** Top-level nodes, triangles each, running total:

    ```bash
    node tools/vr/subset-scene.mjs --list assets/vr-worlds/sources/<file>.glb
    ```

3. **Write the recipe** in `tools/vr/playground-subsets.json` (`src`, `out`, `keep` index
   ranges, `budget`) and cut. Re-running rebuilds the same file.

    ```bash
    node tools/vr/subset-scene.mjs <recipe-name>
    ```

4. **Find where she stands.** Never type coordinates.
    - The scene has a floor mesh and she should move within it: add spot targets to
      `tools/vr/spot-targets.json`, then `node tools/vr/measure-spots.mjs scenes/<file>.glb`
      (slow; writes `assets/vr-worlds/spots/<file>.json`).
    - Otherwise compute one spot from the scene's own boxes:

        ```bash
        node tools/vr/clear-spot.mjs scenes/<file>.glb --behind "<node name regex>"
        ```

      It prints `"at": [...], "turn": ...` for worlds.json. Useful flags: `--margin -0.3`
      (stay inside a building, camera included), `--view 5` (a room with walls: keep the
      camera's line clear), `--keepout " x0,z0,x1,z1"` (a pool), `--min 0.6` (a cramped room).
    - Use the full scene's spot for its light version too, so both stand her in the same place.
    - If the scene's floor top is not at y = 0, put minus that height in `at[1]`.

5. **Add the world** to `assets/vr-worlds/worlds.json` **as text** (copy the `cinema` and
   `cinema-light` entries; never `JSON.parse` and re-write the file). Set `id`, `title`,
   `note`, `rating`, `tiers`, measured `triangles`, `sky`, `fog`, `light`, `scene.src/at/turn`,
   and on the full place `preview` and `category`; on the light one `lightFor`. A scene with no
   floor needs `ground: { color, radius }`; a scene with no walls can take wall props
   (`kits/3dassets-hotel-resort/partition-wall-module.glb`, see the restaurant).

6. **Picture and proof** (the app on :8080, `npm start`):

    ```bash
    node tools/vr/render-place-previews.mjs <id>
    node tools/qa/lab-call.mjs lab_screenshot '{"world":"<id>"}'
    ```

   **Open `tmp/shots/<id>-desktop.jpg` and `-mobile.jpg` and look.** Every place added so far
   had a defect only the picture showed: a sofa across her legs, a wall between camera and
   bar, the camera outside the building, the camera inside a wall.

7. **Record and regenerate.** A row in `assets/vr-worlds/PROVENANCE.md` (file, source URL,
   licence, triangles), a short section in `docs/VR_WORLDS.md`, then:

    ```bash
    node tools/qa/world-audit.mjs
    node tools/qa/hub.mjs
    npm run validate
    ```

   The audit must say `0 fail`; the gate must exit 0. Commit as `VW<n>: <what>` with the
   regenerated `quality-lab/` data and `docs/engine/` in the same commit.

## What the gate will catch, and what it will not

Caught: a missing preview, a phone world over 30 000 triangles, stale lab data, unformatted
JSON or Markdown. Not caught: how it looks, whether the camera sees her, headset comfort and
frame rate. Say plainly in the docs what was not checked (no place here has been tried in a
headset).

## Ratings

`general` and `romantic` places are offered in Visit a place; `private` only inside Private.
Private sessions can travel to any `general` place, so a place's rating is not what keeps it
out of an intimate story: decide that before adding one.
