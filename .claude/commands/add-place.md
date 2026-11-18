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
   `tools/vr/spot-targets.json` (copy the `anime-school-corridor` entries as the
   template): `near` regexes on the material node names the prepare step printed
   (blackboard, desk, window…), `"anywhere": true` where there is nothing to
   name, `"floorUnderRoof": true` for a room with a ceiling, labels and `sees`
   in English and Italian. Every **new spot id** also needs words in
   `src/gltf-viewer/WorldSpots.js` `WORDS` (English and Italian), or nobody can
   walk her there. Then measure, **one file at a time** (parallel runs on this
   4-core container time out; about 5 to 15 minutes each, run in the
   background): `node tools/vr/measure-spots.mjs scenes/<stem>.glb`, then the
   `-light` file. Only verified spots are offered; at least two per place. Then
   `npx prettier --write assets/vr-worlds/spots/<stem>*.json` (the gate checks
   them).
4. **Catalogue:** copy the `anime-corridor` and `anime-corridor-light` entries
   in `assets/vr-worlds/worlds.json` as text (never re-serialise the file),
   change id, title, note (with the CC BY credit), `triangles`, `scene.src`,
   `preview`, `category`. A school, or any place that must never be part of a
   Private evening, is `generalOnly: true` on **both** entries. Then set the
   start from a verified spot, never typed:
   `node tools/vr/at-from-spot.mjs scenes/<stem>.glb [spot-id] --write`.
5. **Look:** `npm start`, then compare preview angles without editing anything:
   `node tools/vr/render-place-previews.mjs <id> --yaw 0 --out /tmp/pv0` (and
   `22`, `-22`). Put the angle that frames her in `PLACE_CAMERA` in that script
   (with a comment saying why), render `<id>` for real, then
   `node tools/qa/lab-call.mjs lab_screenshot '{"world":"<id>"}'` and open
   `tmp/shots/<id>-desktop.jpg` and `-mobile.jpg`: her feet on the floor,
   nothing through her, the camera inside the room. If another verified spot
   frames better: `at-from-spot.mjs ... <spot-id> --write`. **If no spot and no
   angle looks right, leave the place out** (VW12 left out the school entrance,
   a flat grey box, and the hallway, open on one side): remove its worlds.json
   entries, spot targets, words, scene, spot and preview files, and say why in
   `PROVENANCE.md`.
6. **Record and gate:** a row in `assets/vr-worlds/PROVENANCE.md`, a line in the
   place table of `docs/VR_WORLDS.md`, then `node tools/qa/world-audit.mjs` (0
   fail), `node tools/qa/hub.mjs`, `npm run validate` (exit 0). A test that pins
   an exact list of places (for example the general-only destinations) is fixed
   to assert the property, not the new list. Commit `VW<n>: …` with the
   regenerated lab data, then a pull request to `ultimate`; never to `master`.
