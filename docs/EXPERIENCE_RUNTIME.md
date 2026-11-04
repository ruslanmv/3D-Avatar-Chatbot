# Experience runtime

The director lives in `src/experiences/ExperienceDirector.js`. Boot attaches
it from `src/companion/index.js` after the Behavior Director exists.

## Registration

`ExperienceRegistry.register` requires `id`, `title`, `destination`, and the
functions `prepare`, `start`, `pause`, `resume`, `stop`, `status`, `dispose`.
A definition with `implemented: false` is stored and refused by `start`
before `prepare` runs. Cozy Evening, Mystery Adventure, Creative Studio, and
Character Studio are registered that way. Seaside Evening is the one that
runs.

## Lifecycle

```
idle → preparing → active ⇄ paused
preparing | active | paused → stopped | failed | completed
```

`start` stops a running experience first. A second `start` during `prepare`
bumps a generation so the late load cannot become active. `stop` and a
failed `prepare` both call `SceneRuntime.restore`, which removes the group
and disposes geometries and materials.

## Scene contract

`SceneManifest.validate` checks `schemaVersion` (1), slug id, `sceneType`
(`desktop-background`, `immersive-panorama`, `interactive-3d`,
`mixed-reality`), relative asset paths, quality presets, lighting, audio,
avatar placement, anchors, and bounds. An interactive scene needs at least
two bodies. Paths containing `..` or a URL scheme are rejected.

`SceneRuntime.load` keeps a generation. A loader that resolves after
`cancel` returns `{ why: 'stale' }` and does not attach meshes. A rejected
asset sets `fallback` and still builds `bodies`. Seaside's bodies are the
fallback: there is no KTX2 requirement.

The runtime does not call the renderer's animation-loop setter. `ViewerEngine.animate` calls `NEXUS_EXPERIENCE_RUNTIME.update(dt)` and `bindViewer` once, passing the module's THREE constructors and the existing scene.

## Audio

`SpatialAudioManager` makes a gain for the wave bed and ducks it to a quarter
while `setSpeaking(true)`. Mute and levels come from the session. Companion
speech stays on `NEXUS_BD_SAY` / the existing TTS path. `vr-session-end`
stops the oscillator and suspends the context. `vr-session-start` resumes it.

## Input

`InteractionRouter.trySelect` returns false on a miss. `VRControllers` then
keeps push-to-talk. A hit selects the object's `userData.experienceId`.
The same ids are buttons in the destination sheet, so the story can be
played without a ray.

## Behavior

`BehaviorRouter.request` forwards to `NEXUS_BD.handleIntent` when that
exists. Unknown intents fail. While `speaking` is set, only `listen`,
`speak`, and `smile` are forwarded, so a gesture cannot cut lip-sync.
`walk_to_anchor` does nothing unless `allowLocomotion` is set, and it
refuses a point closer to the camera than `comfort.minDistance`. Seaside
does not set `avatarPlacement.move`, so her root stays where the avatar
loader put her.

## Events

Listeners on the director, and `nexus:companion` on `window` when
`CustomEvent` exists:

`destination:changed`, `experience:preparing`, `experience:started`,
`experience:paused`, `experience:resumed`, `experience:completed`,
`experience:failed`, `experience:stopped`, `scene:changed`,
`experience:line`, `permission:revoked`.

`tts:end` on the Behavior Director bus clears the duck and asks for
`listen`. The director does not emit new names on that bus.

## Diagnostics

`director.diagnostics()` returns frame count, last frame delta, last load
duration, error strings, and how many selectable meshes are attached. It
does not report a headset frame rate. Nothing in this tree measured one.
