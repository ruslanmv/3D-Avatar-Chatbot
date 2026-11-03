# Immersive Companion 2.0 — plan from the current tree

This plan was written after reading the code it names. It is not a greenfield
design. The implementation that followed it is described in
[IMMERSIVE_COMPANION_2_0_REPORT.md](IMMERSIVE_COMPANION_2_0_REPORT.md).

## Current architecture (verified)

The app is a static site. `npm start` serves it. There is no bundle step.
Three.js r147 is vendored. `ViewerEngine` is the shipped renderer
(`__USE_GLTF_VIEWER_ENGINE__`). It owns one animation loop via `_setLoop`:
three r147 is handed a single trampoline, and experience code must not call
`renderer.setAnimationLoop` again (see `docs/VR_STARTUP.md`, XL7).

The Behavior Director boots from `src/main.js` unless
`localStorage.nexus_bd_enabled === 'false'`. `config/behavior.config.json`
still says `behaviorEngine.enabled: false` and is not the runtime switch.
`src/behavior/boot.js` loads classic scripts in order. Those scripts are
IIFEs that assign a global and `module.exports`.

Together activities register on `TogetherPanel` through
`src/features/together/activities/contract.js`. That contract exists because
`start`/`stop` signatures used to disagree, and because two owners of
`ConsentMachine` prompted twice for the same camera. New code must call
`choose()` or `startActivity()` and must not call `consent.request` itself.

Conversation text lives in `window.chatHistory` and `nexus_chat_messages`.
`NEXUS_CONVERSATION_RESET` is the only forget path. `ModeManager` snapshots
the fields it changes and writes the snapshot back. Scene journeys do the
same for background and environment. The Behavior Director event bus has a
closed name list; unknown names are dropped.

`VRControllers` already maps Quest triggers to ray clicks and, off the
panel, the right trigger to push-to-talk. Stick locomotion is walk and snap
turn, not teleport. Changing that mapping would invalidate
`tests/trigger-talk.test.js` and `docs/vr-controls.md`.

Scenic backgrounds are images (`ViewportBackgroundManager`,
`assets/ambient/`). Scene-journey manifests describe anchors and a fallback
colour. The 8K KTX2 and OGG beds named in older docs are not in the tree.
There is one avatar instance, loaded by `AvatarManager`.

## Verified problems worth solving

- Journey, Coach, and Play are separate tiles over one companion, which reads
  as three products.
- Activity start signatures are normalized now. The product split is not.
- A flat backdrop cannot be a walkable place. The renderer can hold extra
  geometry; nothing was using it as an experience with choices.
- Memory that should survive a chat clear (study history) is already listed
  in `ConversationReset.KEPT`. Relationship notes and tasks had no such store,
  so the safe default was to add one rather than reuse the transcript.
- The event bus cannot grow new names without editing `EventBus.js`. A
  parallel `nexus:companion` event avoids dropping messages and avoids
  pretending `scene:enter` (a journey event) means "Seaside started".

## Proposed architecture (what was built)

One session (`CompanionSession`) holds a conversation id, the destination,
voice levels, comfort, and explicit memory grants. It does not hold the
transcript.

Five memory scopes (`MemoryScopes`) with a gate (`PrivacyGate`):

| Scope | Who may read it |
| --- | --- |
| general | every destination |
| life | Life, plus a named grant |
| copilot | Copilot |
| experiences | Life and Experiences |
| private | Life, and only while `NEXUS_SPICY.isEnabled()` |

Copilot never receives private or adult capability, even when the age switch
is on.

`ExperienceDirector` runs one experience through prepare → start → pause →
resume → stop/complete/fail. Stop and failure both restore the scene group.
Staged formats register with `implemented: false` and cannot start.

Seaside Evening is procedural geometry in the existing scene: floor, rails,
chair, table, shell, lantern, ocean bands, and a sky sphere. Passthrough
drops the sky and the ocean bands. The camera is not written.

## Reuse

- Chat, TTS, STT, VRM loading, lip-sync, Pose Studio, wardrobe, ambience,
  VR session start/stop, controller mapping, consent machine, Together
  activities.
- Behavior clips go through `NEXUS_BD.handleIntent` when a clip exists.
  Otherwise the request is a fallback and the spoken line still happens.
- Watch, music, focus, screen help, and Scene Tale open the existing setup
  screen so a permission is explained once.

## Migration

Internal names (`NEXUS_TOGETHER_*`, activity ids, storage keys) stay.
`journey`, `coach`, `game`, `play`, and `together` as a stored destination
map onto Life, Copilot, or Experiences. The Together button stays until each
tile has a tested replacement. Hide the new bar with
`nexus_companion_nav=false`.

## New files

`src/companion/*`, `src/experiences/*`, `tests/companion/platform.test.js`,
and the docs listed in the report.

## Modifications

`src/behavior/boot.js` loads and attaches the facade.
`ViewerEngine.animate` calls `NEXUS_EXPERIENCE_RUNTIME.update`.
`VRControllers` asks `trySelect` before push-to-talk.
`main.js` appends an empty-by-default prompt suffix and ticks the runtime on
the legacy loop.
`ConversationReset.KEPT` includes the two new keys.

## Risks

- Headset frame rate is not measured here. Low geometry is the mitigation,
  not a benchmark.
- Stick locomotion can walk the user through the terrace. Bounds are data for
  placement, not a physics lock on the headset. Clamping the user would be a
  comfort bug.
- Behavior Director off means the new bar is not loaded, same as Together.
- A prompt suffix after the user touches a destination changes the system
  prompt. Before that, it is empty.

## Testing

Unit tests cover the session, scopes, lifecycle, Seaside choices, scene
restore, stale loads, audio ducking, and the bar. They do not cover a real
Quest. The manual list is `docs/IMMERSIVE_VR_TESTING.md`.

## Phases

0–6 and the Seaside slice of 7 are in this change, with staged contracts for
the other experience formats. MR is a branch in the manifest (skip sky when
the blend mode is passthrough), not a claim of device support. Performance
work is the low preset and unlit materials. The Together chooser is not
deleted.
