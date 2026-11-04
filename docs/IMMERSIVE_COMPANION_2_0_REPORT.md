# Immersive Companion 2.0 — implementation report

Life, Copilot, and Experiences are destinations on the existing avatar and
the existing chat. Seaside Evening is a real group of meshes with choices.
The rest of the experience list is marked unavailable. Headset performance
was not measured.

## Files created

- `src/companion/CompanionSession.js`
- `src/companion/MemoryScopes.js`
- `src/companion/PrivacyGate.js`
- `src/companion/BehaviorRouter.js`
- `src/companion/PromptContext.js`
- `src/companion/DestinationCatalog.js`
- `src/companion/TaskBoard.js`
- `src/companion/ActivityBridge.js`
- `src/companion/DestinationBar.js`
- `src/companion/index.js`
- `src/experiences/SceneManifest.js`
- `src/experiences/SceneRuntime.js`
- `src/experiences/SpatialAudioManager.js`
- `src/experiences/InteractionRouter.js`
- `src/experiences/ExperienceRegistry.js`
- `src/experiences/ExperienceSession.js`
- `src/experiences/ExperienceMemory.js`
- `src/experiences/ExperienceDirector.js`
- `src/experiences/formats.js`
- `src/experiences/seaside/layout.js`
- `src/experiences/seaside/story.js`
- `src/experiences/seaside/SeasideEvening.js`
- `tests/companion/platform.test.js`
- `docs/IMMERSIVE_COMPANION_2_0_PLAN.md`
- `docs/EXPERIENCE_RUNTIME.md`
- `docs/IMMERSIVE_VR_UX.md`
- `docs/LIFE_COPILOT_EXPERIENCES_MIGRATION.md`
- `docs/IMMERSIVE_VR_TESTING.md`

## Files modified

- `src/behavior/boot.js` — load order and attach
- `src/gltf-viewer/ViewerEngine.js` — one update call inside `animate`
- `src/gltf-viewer/VRControllers.js` — ray select before push-to-talk
- `src/main.js` — prompt suffix and the legacy-loop tick
- `src/features/chat/ConversationReset.js` — keep the new stores
- `README.md` — point at the bar without retiring Together
- `tests/xr-entry-trace.test.js` — the new frame call must sit inside `try`

## Operational

- Destination bar: Life (default), Copilot, Experiences. Switching does not
  change `conversationId` and does not clear `chatHistory`.
- Life: talk, relax (existing sit), music setup, memories, watch setup,
  preferences.
- Copilot: local tasks, projects, planning steps, existing focus setup,
  study loop, chat research, existing screen-help setup. No calendar, mail,
  or file integration.
- Experiences: Seaside Evening (geometry, two interactive objects, branching
  lines, pause, resume, exit, restore). Scene Tale opens Playground.
  Character studio clicks Pose Studio when the button exists.
- Consent: the bridge does not request capture. Adult and private data stay
  off in Copilot.
- Failed or stale scene loads do not leave a group in the scene.
- Audio bed ducks while speech is flagged and stops on VR session end.

## Incomplete

- Cozy Evening, Mystery Adventure, Creative Studio, and a dedicated
  Character Studio scene are contracts only.
- Teleport was not added. Existing stick locomotion remains.
- No collision volume blocks the headset. Bounds are for content placement.
- Hand tracking was not added.
- Mixed reality only omits the sky and ocean when the WebXR blend mode is
  passthrough. It was not run on a device.
- Seaside art is procedural. No KTX2 or licensed environment was added.
- The Together chooser is still the path for Coach, Meeting, and the
  original tiles.
- The bar loads only when the Behavior Director loads.

## Tests

`npx jest --no-coverage --forceExit`

Result: 252 suites, 5604 tests, all passed. That includes the 23 tests in
`tests/companion/platform.test.js`. Node on the runner was 22, while
`package.json` asks for 24; the suite still exited 0.

Not run: a physical headset, Link, or phone AR session. No frame-rate number
in this report is a measurement.

## Still needed

- A Quest pass from `docs/IMMERSIVE_VR_TESTING.md`.
- Environment art, if the procedural terrace should be replaced. The loader
  already falls back when a path 404s.
- A product decision before removing any Together tile.

## Known defects

- The destination sheet and the Together panel can both be open. They do not
  share one focus trap.
- Seaside's wave bed is an oscillator, not a recorded shore.
- `diagnostics().triangles` counts selectable meshes, not GPU triangles.
- Romance preferences save as "off" when the spicy switch is off, and the
  sheet says why. The control is still visible.

## Next

1. Run the headset checklist and keep the entry trace.
2. Build one more experience on the same director (Cozy Evening is the
   smallest), or retire a Together tile only after its tests point at the
   new action.
3. If stick locomotion through the floor is a problem on device, add a
   comfort option that disables locomotion while the experience is active,
   without changing the default mapping for the rest of VR.
