# Prompt — create a new NEXUS world

Copy everything in the block below into a coding agent working in this
repository. Fill in the six fields at the top. Nothing else needs changing.

```text
Create a new NEXUS place in https://github.com/ruslanmv/3D-Avatar-Chatbot on the branch I name.
Do not open a pull request or merge.

WORLD NAME:            <e.g. "Rooftop garden">
DESCRIPTION:           <one paragraph: mood, who it is for, rating general|romantic>
PLATFORMS:             <desktop / phone / VR — which must work>
INTERACTIONS:          <what the two of us can do there; mark wishes vs must-haves>
STORY STYLE:           <none | short moods | an authored branching story>
AVAILABLE ASSETS:      <repo paths you know of, or "search the repo first">

Before writing anything:
1. Read CLAUDE.md, docs/engine/AI_CODER_START_HERE.md, docs/engine/HOW_TO_CREATE_A_NEXUS_WORLD.md,
   docs/engine/NEXUS_SPATIAL_COORDINATES.md and docs/engine/NEXUS_WORLD_ASSET_PIPELINE.md.
2. Run `npm ci` and `npm run validate`; it must exit 0 before you change anything.
3. Search assets/vr-worlds/ (scenes, kits, sources, PROVENANCE.md) for usable CC0 models
   before sourcing anything new. Any new asset must be CC0 or Apache-2.0-compatible and
   recorded in PROVENANCE.md in the same commit.

Build it with the existing engine, in this order, committing at each step:
- cut the scene by recipe (tools/vr/playground-subsets.json + node tools/vr/subset-scene.mjs),
  phone variant ≤ 30,000 triangles (never raise the cap);
- register it in assets/vr-worlds/worlds.json with measured triangles;
- author spots in tools/vr/spot-targets.json and run node tools/vr/measure-spots.mjs <scene>
  for EVERY scene file (each variant separately); accept spots it rejects;
- compute scene.at/turn from a verified spot with WorldSpots.placementFor — never type it;
- render the preview (npm start; node tools/vr/render-place-previews.mjs <id>);
- add gaze anchors/chips/profile only where the clip or actuator exists
  (HOW_TO_ADD_COMPANION_BEHAVIORS.md);
- add a WorldPresence.DESTINATIONS entry if people should be able to ask to go there
  (never private), with tests;
- write `sees` and labels (English + Italian) that are TRUE of the measured scene.

Rules you may not break:
- The model proposes; trusted code executes; the renderer confirms. No tag is permission.
- Never claim sitting, lying, holding objects, switching lights or walking unless that actuator
  exists and a test shows it. Mark such wishes "unavailable".
- No private content outside the Private gates; no romance in Copilot; data never grants access.
- No new renderer, animation engine, agent framework or build step.

Finish with: targeted Jest + npm run validate + parity check, a real-app walkthrough
(screenshot every spot on desktop and a phone profile), a real-model conversation if a
provider is configured, and a short report of exactly what works, what is unavailable, and
what was not tested on hardware.
```
