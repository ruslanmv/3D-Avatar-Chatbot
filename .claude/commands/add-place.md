---
description:
    Add a downloaded 3D scene as a place (phone, desktop and Quest), with
    measured spots
argument-hint:
    '<sketchfab model uid or path to a .glb> <lowercase-dashed-stem> [what the
    place is]'
---

Add a place from: $ARGUMENTS

Follow `docs/claude/adding-a-place.md`; the rules behind it are in
`docs/claude/vr-worlds-and-playgrounds.md` and `docs/claude/living-worlds.md`.
Work in `ultimate` only.

1. **Licence first.** CC0 or CC BY only (never NC, ND, SA, or a model taken from
   an existing game or anime). Sketchfab needs a token for `api.sketchfab.com`
   in the environment's network secrets.
2. **Prepare:**
   `node tools/vr/prepare-scene.mjs --sketchfab <uid> --name <stem>` (or
   `--file <x.glb>`). It optimises, splits by material, cuts the phone/Quest
   version, prints triangles, draw calls and texture memory, and refuses a scene
   that would run badly on a phone or a Quest. A refusal is the answer: do not
   force it.
3. **Spots:** add `scenes/<stem>.glb` (and `-light`) to
   `tools/vr/spot-targets.json`: `near` regexes on the material node names the
   prepare step printed (blackboard, desk, window…), `"anywhere": true` where
   there is nothing to name, `"floorUnderRoof": true` for a room with a ceiling,
   labels and `sees` in English and Italian. Then
   `node tools/vr/measure-spots.mjs scenes/<stem>.glb` for each file. Only
   verified spots are offered; at least two per place.
4. **Catalogue:** add the world (and its `-light` with `lightFor`) to
   `assets/vr-worlds/worlds.json` as text, `scene.at`/`turn` from the first
   verified spot (`WorldSpots.placementFor` convention), measured `triangles`,
   and the CC BY credit in the `note`. A school, or any place that must never be
   part of a Private evening, is `generalOnly: true`.
5. **Look:** `npm start`, then `node tools/vr/render-place-previews.mjs <id>`
   and `node tools/qa/lab-call.mjs lab_screenshot '{"world":"<id>"}'`. Open the
   pictures: her feet on the floor, nothing through her, the camera inside the
   room and seeing her.
6. **Record and gate:** a row in `assets/vr-worlds/PROVENANCE.md`,
   `node tools/qa/world-audit.mjs`, `node tools/qa/hub.mjs`, `npm run validate`
   (exit 0), commit `VW<n>: …` with the regenerated data.
