# How to create a NEXUS world

**Version:** 1.0, 2026-11-07. This is a practical checklist. Each step names
the file to edit, the command to run, and how to tell it worked.

**Background:**

- `NEXUS_SPATIAL_COORDINATES.md`: coordinates
- `NEXUS_WORLD_ASSET_PIPELINE.md`: assets
- `NEXUS_AI_ARCHITECTURE.md`: who owns what

**Rule zero: never narrate what the runtime did not do.** If an asset, a clip or
an actuator is missing, the place still ships honestly. The spot is unverified,
the affordance is `unavailable`, and she suggests rather than claims.

## 0. Before you start

```bash
git status                     # clean tree, on your branch
npm ci                         # pinned ESLint 8 etc.
npm run validate               # must be exit 0 before you touch anything
npm start                      # the app on :8080, for previews and walkthroughs
```

## 1. Concept

Write one paragraph covering:

- who the place is for
- its rating: `general` or `romantic`. `private` belongs only to the Private
  experience; never add a private world by this route.
- what the two of you can do there today
- what you would like her to do there later

Keep the second list honest: it becomes `unavailable` affordances.

## 2. Find assets in the repository first

**Check these first:**

- `assets/vr-worlds/PROVENANCE.md`
- `assets/vr-worlds/scenes/`
- `assets/vr-worlds/kits/`
- `assets/vr-worlds/sources/`

**Only then** source a new CC0 or Apache-2.0-compatible glTF/GLB, and record it
in `PROVENANCE.md` in the same commit.

## 3. Prepare and optimise

- **Inspect:** dump the node names (pipeline §3).
- **Cut by recipe:** remove strangers, clutter in walkways and anything over
  budget. Add a recipe to `tools/vr/playground-subsets.json` and run
  `node tools/vr/subset-scene.mjs <recipe>`.
- **Budget:** a phone variant is at most 30,000 triangles. **Never raise
  the cap.**

## 4. Register the environment

Add an entry to `assets/vr-worlds/worlds.json`. Start from
`docs/engine/templates/world.manifest.example.json` (today's real shape).

Required for a place:

- `id`, `title`, `note`, `place: true`
- `rating`, `tiers`, `triangles` (measured)
- `light` and `sky` (or `panorama`)
- `scene` or `props`
- `preview`, `category`

## 5. The logical id and its physical variants

- **The logical id** is `worlds.json` `id`, e.g. `apartment`.
- **A heavy desktop scene** needs a light phone entry with `lightFor: "<id>"`
  and its own scene file.
- **Each scene file is a different model, with its own spots**
  (`NEXUS_SPATIAL_COORDINATES.md` §4).

## 6. Measure the environment, then add verified spots

Add the scene to `tools/vr/spot-targets.json`. Give each spot:

- `id` (`[a-z0-9-]`)
- `label {en, it}`, written to complete "you are ___", e.g. "by the sofa"
  or "in the kitchen"
- `room`
- `near`: regexes over top-level node names
- `sees {en, it}`: only things really there; check positions if unsure
- `can`: only `stand-near` and `look-at` exist
- `rating`

Then run:

```bash
node tools/vr/measure-spots.mjs scenes/<file>.glb
```

A ✗ means the spot is not offered; leave it so. Then compute the arrival
placement from a verified spot (pipeline §9) and put it in the entry's
`scene.at`/`turn`.

**Success:** `npx jest tests/living-worlds` passes. The spots test checks the
SHA-256, the margins and the spacing, and that targets and measured file agree.

## 7. Local movement

There is nothing extra to wire. `WorldPresence` loads spots for whichever scene
file is shown, and `WorldSpots.intentOf` matches the person's words.

If your spot ids are new words, add them to `WorldSpots.WORDS`, in both
English and Italian, with a test in `tests/living-worlds/world-spots.test.js`.

## 8. Interactive objects

**Today (implemented):** gaze anchors and chips through the playground
template. Edit `src/experiences/playgrounds/PlaygroundTemplateCatalog.js`:

- `anchors` `{ id, label, at, space }`. **Measure `at`**, e.g. by raycasting
  or from the scene's node positions, as PG3 did.
- `actions` of kind `say`, `clip`, `mood`, `timer` or `pretend-live`.

`validate()` and `tests/playgrounds.test.js` hold them.

**Not yet:** sit-on, lie-on, pick-up and toggle. See
`HOW_TO_ADD_COMPANION_BEHAVIORS.md` for what must exist first.

## 9. Behaviours

Map venue events to intents in `PROFILES` in
`src/experiences/playgrounds/PlaygroundReactiveContext.js`:

- `actions`: chip → intent
- `owns`: clips that own the body
- `afterOwn`
- `quiet`
- `note`: tone

Intents must be in `BehaviorRouter.INTENTS`. See
`HOW_TO_ADD_COMPANION_BEHAVIORS.md`.

## 10. Contextual dialogue

You do not write dialogue scripts. She speaks from verified context:

- `WorldPresence.promptSuffix`: place, spot, `sees`, moves, moods,
  limits
- `PlaygroundReactiveContext.promptSuffix`: venue `note`, things you can
  both see, confirmed reactions

Make `sees` and the venue `note` true and short; that is your dialogue
design.

## 11. Optional stories

See `HOW_TO_CREATE_DYNAMIC_STORIES.md`.

## 12. Ambient light and audio

- **Light:** `light`, `fog`, `sky`/`panorama` on the entry, and moods in
  `PlaygroundMoodPresets`.
- **Audio:** the runtime's `playAmbient` exists, but ship an audio file only
  with provenance.

## 13. Safe cross-world transitions

Add a destination to `WorldPresence.DESTINATIONS` in
`src/companion/WorldPresence.js`:

```js
{ id: 'garden', worlds: ['your-world', 'your-world-light'], words: ['garden', 'giardino'] }
```

- The worlds are listed in preference order and resolved per tier.
- **Never a private world.**
- Travel always asks first, and only the person's yes commits.
- Add a test to `tests/living-worlds/world-presence.test.js`.

## 14. Preview

```bash
node tools/vr/render-place-previews.mjs <id>
```

Update the count in `tests/place-previews.test.js` deliberately.

## 15. Test on desktop, phone and VR

```bash
npx jest tests/living-worlds tests/vr-worlds.test.js tests/vr-places.test.js tests/place-previews.test.js tests/playgrounds.test.js
npm run validate
node scripts/behavior-parity-baseline.mjs --check
```

Then do a real-app walkthrough (pipeline §13): screenshot every spot on desktop
and on a phone profile.

**VR:**

- `npm run vr:entry-scenarios` simulates startup only.
- Real comfort and frame rates need a headset (`docs/VR_STARTUP.md`).
- Write "untested on hardware" when that is the truth.

## 16. Permissions, accessibility and performance

- Rating only narrows. No private access through data.
- Copilot hears no romantic spots.
- The End control is the X (DX5).
- Reduced motion is honoured by moods and the reactive context.
- Touch targets on phones are 44 px.
- Triangles are declared and within budget.

## 17. Check that narration matches the runtime

**With a real model** (any paired provider), walk the place:

- ask to move
- ask for something she cannot do
- say yes to her suggestion
- ask for another place, then say yes

**For every turn**, compare the reply against:

- `NEXUS_VIEWER.vrWorlds.activeId`
- `vrWorlds.spotId`
- `__NEXUS_COMPANION_LIVE.presence.state()`

Any sentence that claims something these do not show is a bug: fix the data
(`sees`), not the prompt.

## When something does not exist

| Missing | Do |
| --- | --- |
| Model for a room | the spot is not offered; travel to a place that has it; or source a CC0 model (pipeline §1) |
| Clip for a behaviour | route to face or gaze, or leave the intent unrouted (`CHANNELS: {}`); never alias to a different-looking clip |
| Seat or bed alignment | `can` stays `stand-near`; she may suggest sitting, never claim it |
| Object in her hand | there is no holding system; she points the person to where it is, if `sees` says it is there |
