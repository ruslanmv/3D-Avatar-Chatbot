# NEXUS World Engine — documentation report

**Branch:** `feat/living-worlds-spatial-storytelling`. **Date:** 2026-11-07. No
pull request; not merged.

## 1. Audit of the branch HEAD (LW1–LW5)

Each milestone was verified in code, tests, generated assets and the real app,
not taken from commit messages.

| Milestone | Code | Tests | Real app | Real model |
| --- | --- | --- | --- | --- |
| LW1 place guard | `ActivityDirective` `isPlaceActive`; `index.js` `noticeTopic` | `tests/companion/living-worlds-presence.test.js` (12) | — | "si mi piace" no longer swaps the bedroom |
| LW2 measured spots | `tools/vr/measure-spots.mjs` (v4), `spot-targets.json`, `spots/*.json`, `WorldSpots.js`, `pixel-flat-home.glb` (recipe `home`) | `tests/living-worlds/world-spots.test.js` | 8 apartment spots screenshotted | — |
| LW3 confirmed moves | `VRWorlds` `goToSpot`/`spotId`; `WorldPresence.go`; `CameraPresets` `mid`; `ViewerEngine` `nexus-world-framing` | `tests/living-worlds/world-presence.test.js` | 8 moves, 1 world load | kitchen, sofa, bed |
| LW4 shared moment, in-place moods | `WorldPresence.promptSuffix`/`setMood`; `PromptContext` `presence`/`GO_OFFER`; `ActivityDirective` `inPlace` | same | — | relax mood set by the person's words |
| LW5 travel with consent | `WorldPresence.observeUser`/`commitTrip`/`destinationsFor` | same | — | discoteca after "sì" (desktop, and the light version on the phone profile) |

**A correction to the mission brief:** it mentions "two verified desktop-bedroom
spots". The measured truth at HEAD is **one** (`dressing-table`). The stricter
v4 measuring found that the earlier "sofa" spot was inside a wall.

## 2. Files

**Created under `docs/engine/`:**

- `AI_CODER_START_HERE.md`
- `NEXUS_AI_ARCHITECTURE.md`
- `NEXUS_SPATIAL_COORDINATES.md`
- `NEXUS_WORLD_ASSET_PIPELINE.md`
- `NEXUS_WORLD_ENGINE_DESIGN.md`
- `HOW_TO_CREATE_A_NEXUS_WORLD.md`
- `HOW_TO_ADD_COMPANION_BEHAVIORS.md`
- `HOW_TO_CREATE_DYNAMIC_STORIES.md`
- `NEXUS_UNIVERSE_ROADMAP.md`
- `PROMPT_CREATE_NEW_WORLD.md`
- `ENGINE_DOCUMENTATION_REPORT.md`
- `tutorials/A_PREMIUM_APARTMENT.md`, `tutorials/B_NIGHTCLUB.md` and
  `tutorials/C_FOREST_ADVENTURE.md`
- `templates/`: 9 JSON templates plus `test.fixture.example.js`. Each one
  states whether its shape EXISTS, is PARTIAL or PROPOSED, or is GENERATED.

**Created elsewhere:**

- `tests/engine-docs.test.js`, which holds the docs to the code (§4)

**Modified:**

- `CLAUDE.md`: a pointer to `docs/engine/AI_CODER_START_HERE.md`

## 3. Existing modules reused, and the contracts proposed

**Reused, with no new runtime:** all of these are mapped in
`NEXUS_WORLD_ENGINE_DESIGN.md` §2.

- **World and space:** `worlds.json`/`VRWorlds`, `WorldSpots`,
  `WorldPresence`
- **Venues:** `PlaygroundTemplateCatalog`, `PlaygroundObjectPicker`,
  `PlaygroundReactiveContext`
- **Behaviour:** `BehaviorRouter` and the Behavior Director
- **Conversation:** `CompanionSession`, `PromptContext`, `MemoryScopes`,
  `PrivacyGate`, `ConversationReset`
- **Stories:** `ExperienceDirector` with Seaside, and Scene Tale's
  `validateStoryPlan`
- **Camera:** `CameraPresets`

**Contracts, by status:**

| Status | Contracts |
| --- | --- |
| **Exist** | `SceneVariant`, `WorldSpot`, `SharedMoment`, `EnvironmentProfile`, `WorldLifecycle` |
| **Partial** | `WorldDefinition`, `WorldTransition`, `WorldObject`/`ObjectAffordance`, `CompanionBehavior`/`BehaviorTrigger` |
| **Proposed** | `RoomDefinition`, `StoryDefinition`/`StoryBeat`/`StoryChoice`, `WorldPermissions` |

## 4. Tests and commands run

| Command | Result |
| --- | --- |
| `npx jest tests/engine-docs.test.js` | all passing (see §6). Checks that 14 docs exist, that every backticked repository path exists, that 39 cited functions and constants are defined, that the spot tables match the measured files, and that the templates pass `validateCatalogue` and `WorldSpots.normalize` |
| `npx jest tests/living-worlds tests/companion` | passing |
| `npm run validate` | exit 0 (counts in §6) |
| `node scripts/behavior-parity-baseline.mjs --check` | OK |
| `node tools/vr/measure-spots.mjs` (v4) | apartment 8/8 verified; desktop bedroom 1/4 |
| real-app walkthroughs, Playwright and SwiftShader | listed in `docs/LIVING_WORLDS_IMPLEMENTATION_REPORT.md` |

No headset or physical phone was used. **VR comfort and frame rates are
unmeasured.**

## 5. Missing capabilities and risks

**Missing:**

- **Body actions:** no sit or lie aligned to a seat, no hand-held objects, no
  per-lamp control, and `gesture_toward_object` has no clip.
- **Measuring:** no walking along a measured graph. Prop worlds (the phone
  forest, the hotel suite) cannot be measured yet.
- **Coverage:** spots exist for two scene files only, and there is no spot
  menu UI.
- **Loaders:** no loader yet for behaviour or story manifests (proposed).
- **Language:** the model sometimes answers Italian in English.

**Risks:**

- **Measuring time:** about 4–15 minutes per scene in this container.
- **Generated data drifts** when someone edits a model without re-measuring.
  The SHA test catches this.
- **Undeclared registry intents** reintroduce wrong clips. The docs say
  so; a validator for that is proposed.

## 6. Final numbers

| Check | Result |
| --- | --- |
| `npx jest tests/engine-docs.test.js` | 23 tests, all passing |
| `npm run validate` | exit 0 — **5923 tests in 268 suites**, lint and format clean |
| `node scripts/behavior-parity-baseline.mjs --check` | OK |

## 7. Recommended next steps

1. Spots for the club, pub, academy and glade (data only).
2. A prop-world mode for the measuring tool (`coordinateSpace: "place"`).
3. One accessible spot-menu control (a tap is authorization).
4. Seat-aligned `sit` at measured seats. Only then expose `sit-on`.
5. A validator that every `CHANNELS` registry target is a declared manifest
   intent.
6. Hardware runs: a phone, Quest native and Quest Link, using
   `docs/VR_STARTUP.md`.
