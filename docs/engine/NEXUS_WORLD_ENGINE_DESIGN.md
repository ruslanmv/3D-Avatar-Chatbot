# NEXUS World Engine — design and contracts

**Version:** 1.0, 2026-11-07. This is a design document.

**Status of each contract** is marked:

- **EXISTS**: a loader accepts this shape today, at the file named.
- **PARTIAL**: part of it exists.
- **PROPOSED**: no loader accepts it yet. Do not ship data in a proposed
  shape and claim it works.

## 1. Principles (non-negotiable)

1. **Observe → Verify → Decide → Execute → Confirm → Converse.** The model
   proposes. Only trusted runtime modules execute, and only the renderer or
   the owner confirms.
2. **Data cannot grant permission.** A manifest never carries code, URLs to
   execute, `depictsAdult`, consent, or private access. Trust comes from the
   *source* of a manifest (system vs user-content, `SceneCatalog` A17), never
   from its fields.
3. **One owner per subsystem** (`NEXUS_AI_ARCHITECTURE.md` §13). No second
   render loop, mixer, camera controller, TTS or lip-sync.
4. **Measured, not typed.** Positions come from tools that measured the
   real asset, carry its hash, and fail closed.
5. **Snapshot and restore; fail soft;** a stale async result is dropped by
   generation.
6. **One companion, one conversation.** Experiences change context, not
   identity.

## 2. Target architecture: what serves each layer today

```
NEXUS WORLD ENGINE
├── World Registry ......... worlds.json + VRWorlds.validateCatalogue/resolveFor/placesFor (EXISTS)
│                            SceneCatalog trust tiers (EXISTS, ambience)
├── Spatial Engine ......... WorldSpots + spots/*.json + measure-spots.mjs (EXISTS, LW2)
│                            runtime.goToSpot (EXISTS, LW3); rooms/nav graph (PROPOSED)
├── AI Companion Runtime ... CompanionSession, ContextIntent, PromptContext, MemoryScopes,
│                            PrivacyGate, PlaygroundReactiveContext, WorldPresence (EXISTS)
├── Avatar Runtime ......... Behavior Director (NEXUS_BD), BehaviorRouter CHANNELS, ProceduralAnimator,
│                            vrmLoader.setEmotion, TTSProvider, LipSync, VRPoseSystem (EXISTS)
├── Storytelling Engine .... ExperienceDirector + SceneRuntime (Seaside), Scene Tale, scene-journey,
│                            StoryPlan (EXISTS, separate); unified StoryDefinition (PROPOSED)
├── Experience Profiles .... Life / Copilot / Experiences, playground templates, Private gates (EXISTS)
└── Developer Tooling ...... subset-scene, measure-spots, render-place-previews, xr-entry-scenarios,
                             vr:panel-shot, parity baseline, Jest (EXISTS); world scaffolder (PROPOSED)
```

## 3. Contracts

The shapes are given as TypeScript-style interfaces so that JSDoc can mirror
them. **The repository is plain JavaScript: do not add a TypeScript build.**

### 3.1 `WorldDefinition` — PARTIAL

Today a world is one entry in `assets/vr-worlds/worlds.json`; it **EXISTS**
there. The proposal splits the logical world from its physical variants.

```ts
interface WorldDefinition {        // proposed envelope over today's worlds.json entry
  schemaVersion: 1;
  id: string;                      // [a-z0-9-], the logical place ("apartment")
  title: { en: string; it: string };
  rating: 'general' | 'romantic' | 'private';   // EXISTS as `rating`
  category?: string;               // EXISTS
  preview?: string;                // EXISTS, under assets/vr-worlds/
  variants: SceneVariant[];        // today: separate entries linked by lightFor
  environment: EnvironmentProfile; // today: sky/fog/light/panorama on the entry
  rooms?: RoomDefinition[];        // PROPOSED
  transitions?: WorldTransition[]; // PROPOSED (today: WorldPresence.DESTINATIONS)
  permissions?: WorldPermissions;  // PROPOSED: only *narrows*, never grants
}
```

**Migration path:** keep `worlds.json` as the source of truth. A future
`WorldRegistry` builds `WorldDefinition`s from it. Do not maintain two
catalogues.

### 3.2 `SceneVariant` — EXISTS (as a worlds.json entry)

```ts
interface SceneVariant {
  id: string;                      // worlds.json id ("apartment", "bedroom-light")
  lightFor?: string;               // EXISTS
  tiers: ('mobile'|'desktop'|'vr')[]; // EXISTS
  triangles: number;               // EXISTS, measured
  scene?: { src: string; at: [number,number,number]; turn: number; scale?: number; merge?: boolean }; // EXISTS
  props?: { src: string; at: [number,number,number]; turn?: number; height?: number; width?: number; flat?: boolean }[]; // EXISTS
  spotsFile?: string;              // derived: WorldSpots.fileFor(scene.src)
}
```

### 3.3 `WorldSpot` — EXISTS (`assets/vr-worlds/spots/*.json`, schemaVersion 1)

```ts
interface WorldSpotFile {
  schemaVersion: 1; scene: string; sha256: string; coordinateSpace: 'scene';
  floorY: number; title: { en: string; it: string };
  tool: { name: 'tools/vr/measure-spots.mjs'; version: number; params: object };
  spots: WorldSpot[];
}
interface WorldSpot {
  id: string; label: { en: string; it: string }; room: string; near: string[];
  sees: { en: string; it: string };
  can: ('stand-near'|'look-at')[];          // WorldSpots.CAN: the only capabilities that exist
  rating: 'general'|'romantic';
  verified: boolean;                         // false → never offered
  position?: [number,number,number]; facingDeg?: number;
  framing?: 'fullBody'|'mid'|'bust';
  measured?: { fromThingM: number; viewOpenM: number; thingOffBehindDeg: number; framing: string; candidates: number };
  why?: string;                              // when verified:false
}
```

The reader and trust boundary is `src/gltf-viewer/WorldSpots.js`.

### 3.4 `RoomDefinition` — PROPOSED

Today `room` is only a label on a spot.

```ts
interface RoomDefinition {
  id: string; label: { en: string; it: string };
  spots: string[];                       // spot ids in this room
  doors?: { to: string; at: [number,number,number] }[]; // measured door points, for LW6 walking
  rating?: 'general'|'romantic';         // narrows only
}
```

A nav graph should be measured the same way as spots (a tool, a hash, fail
closed) **before** any walking.

### 3.5 `WorldTransition` — PARTIAL

`WorldPresence.DESTINATIONS` and `destinationsFor` EXIST; a data file does not.

```ts
interface WorldTransition {
  id: string;                 // "forest"
  worlds: string[];           // preference order, resolved per tier (oak-glade → under-the-trees)
  words: { en: string[]; it: string[] };
  requiresConfirmation: true; // always, except a deliberate UI choice
  rating: 'general'|'romantic'; // never private: Private rooms keep their own door
}
```

### 3.6 `WorldObject` and `ObjectAffordance` — PARTIAL

Anchors exist in `PlaygroundTemplateCatalog`: `{ id, label, at, space }`, gaze
only, picked by `PlaygroundObjectPicker`.

```ts
interface WorldObject { id: string; label: {en:string;it:string}; node?: string; at: [number,number,number]; space: 'scene'|'place'; }
interface ObjectAffordance {
  object: string;
  action: 'look-at'|'point-at'|'sit-on'|'lie-on'|'pick-up'|'toggle';
  requires: { clip?: string; actuator?: string; seatHeight?: number }; // must name something that EXISTS
  status: 'available'|'unavailable';      // unavailable → she may suggest, never narrate as done
}
```

| Affordance | Status | Note |
| --- | --- | --- |
| `look-at` | **available** | gaze |
| `point-at` | **unavailable** | the `point` clip is mis-tagged |
| `sit-on`, `lie-on` | **unavailable** | clips exist, but nothing aligns them to a seat |
| `pick-up` | **unavailable** | nothing attaches an object to her hand |
| `toggle` (lights) | **unavailable** | only whole-room moods exist |

### 3.7 `CompanionBehavior` and `BehaviorTrigger` — PARTIAL

`BehaviorRouter.INTENTS`/`CHANNELS` and the reactive context's per-venue `PROFILES` EXIST.

```ts
interface CompanionBehavior {
  id: string;                                 // must be in BehaviorRouter.INTENTS
  channel: 'face'|'gaze'|'registry';          // CHANNELS
  registryIntent?: string;                    // must be declared in kb/animations.manifest.jsonl
  priority: number; ownsBody: boolean; interruptible: boolean;
  cooldownMs: number;
}
interface BehaviorTrigger {
  on: 'world-shown'|'chip'|'object-picked'|'spot-arrived'|'interaction-completed'|'user-intent';
  when?: { world?: string; spot?: string; mood?: string; destination?: 'life'|'experiences'|'copilot' };
  do: string;                                 // a CompanionBehavior id
}
```

### 3.8 `StoryDefinition`, `StoryBeat`, `StoryChoice` — PROPOSED

The existing pieces are `ExperienceDirector` with Seaside, Scene Tale, and
`scene-journey` with `guidedScript`.

```ts
interface StoryDefinition { id: string; world: string; spots?: string[]; rating: 'general'|'romantic';
  goal: { en: string; it: string }; beats: StoryBeat[]; endings: string[]; }
interface StoryBeat { id: string; at?: string /* spot id */; line: { en: string; it: string };
  requires?: { spot?: string; event?: string }; choices?: StoryChoice[]; }
interface StoryChoice { id: string; label: {en:string;it:string}; next: string;
  effect?: { mood?: 'relax'|'story'|'focus'; goSpot?: string; proposeWorld?: string }; }
```

An `effect` is executed only through the existing owners: `presence.setMood`,
`presence.go`, or a travel proposal. Never directly.

### 3.9 `SharedMoment` — EXISTS (in memory)

`WorldPresence.state()` returns:

```
{ world, spot, moving, mood, pending, travelling, note, offer }
```

That feeds `promptSuffix`. Separately, PG3's moments live in
`PlaygroundReactiveContext`.

### 3.10 `EnvironmentProfile` — EXISTS (fields on the entry)

```
sky | panorama + yaw, fog, light{…}, ground
```

Moods live in `PlaygroundMoodPresets`.

### 3.11 `WorldPermissions` — PROPOSED (narrowing only)

```ts
interface WorldPermissions { allowTravelFrom?: string[]; hideInCopilot?: boolean; minRating?: never }
```

There is deliberately **no** field that can open a private world or grant
consent.

### 3.12 `WorldLifecycle` — EXISTS (events)

```
session:entered/ended → _applyVRWorld → runtime.show (generation) →
nexus-world-shown → presence/reactive verify → goToSpot (spotGen) →
nexus-world-spot → leave/hide (restore snapshot)
```

## 4. Validation rules for any future manifest loader

| Rule | Why |
| --- | --- |
| Reject unknown fields that could carry behaviour (`script`, `onEnter`, `url`, `code`) | data must not execute |
| Ids `[a-z0-9-]{1,30}`; paths pass `ViewportBackgroundCatalog.isSafeRelativePath` | no traversal |
| Spot and object positions only from a tool output with a matching SHA-256 | measured, not typed |
| Behaviours only from `BehaviorRouter.INTENTS`; registry intents only if declared in the manifest | avoids the PG3 smile-as-wave bug |
| Affordances `available` only if the clip and actuator exist and a test exercises them | no fake actions |
| Rating can narrow, never widen; private stays behind the Private gates | consent boundary |

## 5. Do not build yet

These are deliberately out of scope until there is a measured need (see
`NEXUS_UNIVERSE_ROADMAP.md`):

- multiplayer and network authority
- a second renderer or animation engine
- an agent framework
- a TypeScript build
