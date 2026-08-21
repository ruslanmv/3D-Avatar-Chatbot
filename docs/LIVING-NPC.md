# Living NPC — voice-commanded avatar gameplay

Makes the avatar behave like a real person in desktop, AR and VR: it walks,
follows you, sits, offers its hand and physically shakes yours, reacts with
expressions, and stays "alive" during normal conversation — with **any** LLM
provider (Claude, OpenAI, Ollama, Watsonx), not only HomePilot.

## Try it (voice or text)

| Say | The avatar |
|---|---|
| "follow me" / "sígueme" / "seguimi" | walks behind you, keeps ~1.5 m, real walk cycle |
| "stop" / "wait here" | stops instantly (all plans are interruptible) |
| "come here" | approaches to 0.9 m and faces you |
| "go away" | steps back ~2 m with a subtle sad expression |
| "sit down" / "stand up" | sits (walks to a seat anchor if one is set) / stands |
| "shake my hand" | approaches, offers its hand, **reaches for your real controller**, haptic pulse on contact, shakes, smiles, nods |
| "high five" | same contact pipeline, high target |
| "dance" / "bow" / "wave" / "backflip" | plays the matching clip |
| anything else | the LLM answers *and* emits an ambient plan (eye contact + matching expression), so it always acts alive |

Commands are matched in EN/ES/IT/FR/DE/PT by a zero-latency fast path
(`src/xr/IntentFastPath.js`); everything else flows through the LLM motion
contract. Both paths emit the same MotionPlan JSON executed by the existing
`MotionDSL`, so actions never double-fire (fast-path suppresses the LLM's
duplicate plan for the same utterance).

## Architecture (runtime)

```
 STT / text ─► IntentFastPath ──hit──────────────┐
                   │ miss                        │
                   ▼                             ▼
        LLM + motion contract ──► MotionBlockParser ──► MotionDSL
        (+ live world snapshot)        │                   │
                                chat UI / TTS       MotionExecutor + enhanced
                                (block stripped)    handlers in MotionIntegration
                                                        │
                              AvatarLocomotionSystem ◄──┤──► HandContactIK
                              (walk state machine)      └──► MotionClipMap
                                                             └► NEXUS_CLIP_LOADER
```

New modules live in `src/xr/`: `MotionBlockParser`, `IntentFastPath`,
`MotionContract`, `MotionClipMap`, `HandContactIK`, `MotionIntegration`
(facade: `window.NEXUS_MOTION`). Integration touches only 4 existing files
with one-liner hooks (`index.html`, `src/main.js`,
`src/gltf-viewer/ViewerEngine.js`, `src/LocomotionConfig.js`).

## The LLM contract

Every request gets a suffix appended to the system prompt: available
commands, the gesture clips that actually exist, and a live world snapshot
(`user_distance_m`, `user_in_vr`, `avatar_sitting`, anchors…). The model ends
its reply with one fenced block:

```
Sure, let's go!

```motion
{"commands":[{"type":"look_at","target":"user_head"},
             {"type":"follow","target":"user","distance_m":1.5}],
 "interruptible":true,"priority":"normal"}
```
```

The block is hidden during streaming, stripped before display/TTS, validated
(unknown types dropped, values clamped, max 8 commands), then executed.

## Settings & API

```js
NEXUS_MOTION.config.enabled = false;          // kill switch (persisted via
localStorage.setItem('nexus-motion-enabled', 'false'); // this key)
NEXUS_MOTION.config.debug = true;             // console tracing
NEXUS_MOTION.setAnchor('seat', {x:1.2, y:0, z:0.8}); // where "sit down" goes
NEXUS_MOTION.execute({commands:[{type:'wave'}]});    // drive it yourself
NEXUS_MOTION.getWorldSnapshot();              // what the LLM sees
```

## Better clips (optional, recommended)

Out of the box the system uses the shipped `vendor/animations` BVH library
and `addons/vrma-actions` VRMA clips, with procedural fallbacks for nod,
point and hand-offering. For best quality, generate the 8-clip pack in
`addons/vrma-locomotion/` — see the README there (one Blender command).

## Troubleshooting

- **Avatar answers but doesn't move** — check `NEXUS_MOTION.state.booted`
  and that `NEXUS_MOTION.config.enabled` is true; open the console for
  `[Motion] booted — living NPC online`.
- **No walking, avatar glides** — the walk state machine failed to preload
  clips; verify `vendor/animations/action/action_walk.bvh` is served.
- **Handshake doesn't connect in VR** — hand tracking/controllers must be
  active; the avatar reaches toward a natural forward point on desktop.
- **Model never emits motion blocks** — some small local models ignore
  contracts; the multilingual fast path still covers the core commands.
