# Living Worlds — spatial presence and grounded storytelling (LW1–LW6)

**Related:** [Premium entertainment-first roadmap](LIVING_WORLDS_PREMIUM_ROADMAP.md) · [Claude Code implementation handoff](CLAUDE_LIVING_WORLDS_HANDOFF.md)

> **Status:** Implementation started on the standalone development branch. **Only LW1's conservative place-preservation guard, prompt guidance, and regression tests have been added so far.** This document specifies remaining work; it does not claim POI navigation, a new apartment scene, real object manipulation, or headset QA already exists.
>
> Baseline audited: `master` at `1cbf92904e1d44f36ef355b186f5f2f03d11f139` (2026-11-07). Source of the regression: user transcript and code analysis of `ContextIntent`, `ActivityDirective`, `VRWorlds`, and `Places`.

## Product contract: a place is not a mode

One persistent avatar, one conversation, and **one verified physical world**. Maintain three independent dimensions:

- **Place presence:** logical world id, physical renderer world id (including light variants), room/spot id, scene generation, confirmed avatar placement, user location/viewpoint.
- **Conversation context:** Life / Copilot / Experiences, topic, tone, current task. These can change without navigating.
- **Activities:** relaxing, storytelling, focusing, working, dancing, etc. Activities can take place *inside* the selected world; they do not own permission to replace the world.

A user-chosen place remains until the user ends/leaves it, approves a travel request, or an existing higher-authority safety/privacy lifecycle requires cleanup. **Private world exit is not overridden** by persistence.

### Reproduced failure

User selected `Experiences · Bedroom`, then said `sì mi piace`. The model emitted `<activity name="relax"/>`; `ActivityDirective.run` entered Life/relax, and `VRWorlds.chooseWorld` could select `meadow-village` for the relax activity. The selected bedroom vanished despite no user request to travel. The model also described taking a blanket and operating a lamp without confirmed executable actions.

**LW1 mitigation already committed on this branch:** `ActivityDirective` refuses competing model activity starts while `place-*` is active, `noticeTopic` preserves explicit place sessions regardless of their source, the prompt stops offering conflicting activity tags, and the place prompt disallows unverified physical-action claims. These guards are intentionally conservative: they prevent false/undesired action, **not** an implementation of in-place relax/focus/story. Claude must supply real in-place activities in LW4 while preserving the same spatial invariant.

## Existing capabilities to reuse

- `src/features/together/activities/places.js`: entry via approved place list; `CompanionSession` tracks the chosen activity; the viewport responds.
- `src/gltf-viewer/VRWorlds.js` and `assets/vr-worlds/worlds.json`: trusted world catalogue, `resolveFor`, device tiers, light variants, fade and restore, scene generation protection.
- `src/experiences/ExperienceDirector.js`, `SceneRuntime.js`: lifecycle and renderer-side confirmation/rollback.
- `src/experiences/playgrounds/PlaygroundReactiveContext.js`, `PlaygroundTemplateCatalog.js`, `PlaygroundObjectPicker.js`: verified context and glance anchors. **Gaze anchors are not automatically walkable spots.**
- `src/companion/PromptContext.js`, `ActivityDirective.js`, `ContextIntent.js`, `index.js`: model abilities and state transitions.
- `src/AvatarLocomotionSystem.js`, `src/xr/MotionIntegration.js`: current animation owners. Do not duplicate render loops, mixers, camera controllers, TTS or lip-sync.
- `src/features/together/activities/playground.js` and `docs/PLAYGROUND_SCENE_TALE.md`: existing story playback; choices need meaningful effects on verified state.
- `src/gltf-viewer/VRSupport.js` and `VRControllers.js`: XR comfort and controller affordances.
- `assets/vr-worlds/scenes/pixel-flat.glb`: a **connected one-bedroom apartment**, with kitchen, bathroom, living area, bedroom and workspace, reported as 28,760 triangles and already used as a mobile fallback. **Inspect its actual mesh/coordinate layout before using any spot.**
- `assets/vr-worlds/scenes/bedroom-flat.glb`: different desktop/VR scene, with different layout, roughly 39,772 triangles. Never reuse pixel-flat coordinates against this GLB without explicit verified transformation.
- `assets/vr-worlds/kits/kenney-furniture-kit/`: CC0 furniture including kitchen and bathroom pieces, useful as repairs/fill-ins rather than the default replacement for an existing cohesive scene. See `assets/vr-worlds/PROVENANCE.md`.

## Navigation model: two levels, one confirmation policy

### Level 1 — local spot changes within a world

Author a small set of **measured** semantic spots in each supported physical world variant: bed, sofa, window, desk, kitchen counter, bathroom sink, etc. Choose only meaningful, reachable points (2–4 in a small room; up to 5–10 in larger worlds). Store actual coordinates in meters, coordinate space, facing, localized English/Italian labels, associated verified mesh or node, capability allowlist, clearance and accessibility.

**First implementation: fade/blink and re-place the existing avatar framing inside the *already loaded* scene. Do not reload the world for every spot. Do not implement naïve straight-line walking through furniture.** The existing locomotion system is not proof of wall/door navigation. The engine must own re-placement, collision/clearance and camera/comfort rules. Confirm the new spot in trusted renderer state before it appears in the prompt or spoken reply.

**Future implementation:** measured connection/door graph + baked navigation mesh + avatar-only walking for desktop/mobile, after physical geometry tests. In VR, prefer user-controlled teleport/blink and stable headset position; never glide the world or force the user viewpoint because an LLM proposed a walk.

### Level 2 — travel between worlds

A request to visit a separate forest, nightclub, beach or office is a different operation:

1. Parse a suggested destination from the **assistant reply** or an **actual user utterance**; neither an LLM tag nor a CustomEvent provides authorization.
2. Check the known catalogue, the tier/light fallback, location rating, permissions, active owner and travel rules. Private rooms remain behind the existing Private consent/age gates.
3. For world-to-world travel, propose the change clearly and wait for the **user's next affirmative input** (one pending proposal, expiring on timeout, End, Clear, another navigation request or world generation change). A model saying "yes" is not consent.
4. Prepare / preload the destination if allowed; keep the current world on load failure.
5. Perform the existing fade/load, await renderer confirmation (`activeId` and generation), then commit logical place state. A late async result is ignored after cancellation.
6. Only now allow "Eccoci", "We're in the forest", etc. No duplicate greeting, and conversation ID persists.

In a direct explicit UI selection, the UI action itself is the user's confirmation; do not demand a second dialog for the same deliberate choice. Keep a clear cancel path for pending travel proposals.

### Proposed data contract (not yet shipped)

Add validated, versioned spot data to physical world variants. For example:

    {
      "schemaVersion": 1,
      "logicalWorldId": "bedroom",
      "visibleWorldId": "bedroom-light",
      "spots": [
        {
          "id": "kitchen-counter",
          "label": {"en": "Kitchen counter", "it": "Piano cucina"},
          "coordinateSpace": "scene",
          "position": null,
          "facingRadians": null,
          "node": null,
          "capabilities": ["stand-near"],
          "verified": false
        }
      ]
    }

**These nulls are deliberate:** the model file exists, but valid coordinates and reachability have not been measured. Unknown/unverified spots MUST NOT be offered as reachable. Spot coordinates differ between `bedroom` and `bedroom-light`. Keep one logical destination and distinct physical anchors. The authoring step must measure/raycast the floor, avatar clearance (~1m), line of sight/framing, geometry collisions, actual supported actions, and accessibility.

Suggested location: `assets/vr-worlds/spots/<visible-world-id>.json`; validate references against the existing catalogue and transformed scene hierarchy. Do not make spot files independently authorize private scenes.

### Suggested command shape (never executable by itself)

    <go spot="kitchen-counter"/>
    <go place="oak-glade"/>

Parse **assistant replies only**, at the same final display-text seam used for `<activity>` / `<gesture>`. Strict ID allowlist; at most one action tag per reply; strip before chat, transcript, VR panel and TTS. No free-form JavaScript, URLs or file paths. A tag is a proposal, not permission. Do not invent new authorization from prompt text.

**Tooling preference:** consider a structured intent envelope instead of new XML tags if the existing model providers and stream masking support it consistently. Keep a plain-text fallback, tests for malformed/duplicate tags, and source-of-intent provenance.

## Grounded storytelling: Observe → Verify → Act → Confirm → Respond

Keep a short-lived, destination-scoped **SharedMoment** from *confirmed* world and action events:

    {
      logicalWorldId, visibleWorldId, roomId, confirmedAvatarSpot,
      lastCompletedInteraction, pendingTravelProposal, sceneGeneration,
      activeActivity, conversationalGoal, quiet, privateScope
    }

- Model prompt receives only sanitized verified labels and capabilities, no untrusted world mutation or raw user tracking.
- Never claim the avatar took a blanket, sat on a bed, changed a lamp or walked into a room without a real asset/actuator and success confirmation.
- In-place "relax", "focus", "story" should change posture/voice/goal, not world. A story branch must change a later beat, interaction or persistent (consented) story outcome; avoid cosmetic labels.
- One to three sentences in ordinary chat, respecting Italian/English, no scripted second greeting on each move, no automatic farewell, comfortable silence.
- The user's selected location stays visible if they move between Life, Copilot and Experiences. Conversely, Private -> public/Copilot must run original cleanup and clear Private context.
- Clearing a conversation clears SharedMoment, pending proposals and transient spot context. Leaving/reloading ends current place under existing lifecycle. Do not persist private raw dialogue.

## UX rules

- Consumer view: 3D companion + world + existing conversation. Optional compact location breadcrumb, icon-only exit and hideable overlays; no second chat pane and no debug HUD by default.
- Desktop/mobile: do not automatically drag the camera across the floor; choose an existing safe framing or offer a deliberate viewpoint move.
- VR/MR: never force headset displacement, maintain real-scale comfort and safe spatial proximity; respect seated mode, reduced motion, user boundaries and existing AR/passthrough.
- Romance/fan-service: optional and tasteful, opt-in only, user controls pace; never transfer Private permissions or memory across scenes. Workplace: concise, useful, grounded in completed work; do not inherit romantic/private context.
- Graceful failure: keep prior verified location, explain briefly only when needed, no invented scenery or actions.

## Staged implementation

**LW1 — currently committed:** preserve explicit place against assistant-initiated activity tags and topic changes; clarify model prompt; tests. Review and improve guard before considering done.

**LW2 — inspect and author:** inspect pixel-flat GLB scene graph and surface geometry; record validated measured spots for mobile `bedroom-light`. Inspect desktop `bedroom-flat` independently. Add validator, coordinate transform, clearance/comfort tests. No invented spot coordinates.

**LW3 — local re-place:** one trusted renderer-owned local teleport/fade, cached scene, avatar placement confirmation, safe camera policy; keyboard/touch/VR point selection. Test repeated travel and cancellation; no locomotion through walls.

**LW4 — in-place activity and story:** let relax/focus/story run inside current place without invoking scene selection; schema-validated action proposal on actual user turns; one transcript-aware short SharedMoment at the existing prompt seam; verified object affordances.

**LW5 — external destinations:** user-approved cross-world travel, private authorization, existing world fallback, async generation/rollback and consistent story context; first implement forest and discoteca from the existing catalogue.

**LW6 — optional walking and polish:** measure/bake navmesh, connect door graph, avatar-only walking on flat devices when collision-safe; content upgrades, better grounded pose clips, asset provenance, performance and real-device QA.

## Test/release gates

- Reproduce transcript: Bedroom + "si mi piace" + model relax tag **stays Bedroom**, does not load meadow.
- A conversational topic change alone never teleports the user or ends a selected place.
- A user-approved forest transition changes world **once after renderer confirmation**; denial or timeout leaves current world.
- Kitchen/bathroom not offered if the selected mesh doesn't contain verified geometry and spots.
- Physical destination failure keeps previous confirmed location; stale promise cannot commit.
- User-typed tags never execute; assistant tags cannot authorize travel or bypass Private.
- Device variant uses **variant-specific coordinates**; "bedroom-light" must not reuse desktop "bedroom" spots.
- No false blanket/lamp/bed claims; missing pose action does not produce "I sat".
- Clear/End/session exit cancels pending travel and cleans listeners; PrivacyGate unchanged.
- Desktop/mobile and Quest checks, plus reduced-motion/seated and private-to-Copilot regression.
- Run targeted Jest, full `npm run validate`, browser interactions, and physical-phone/headset checks when hardware is available. Report actual measurements, never inferred FPS. Do not open a pull request automatically. Keep working on this branch until the user asks otherwise.
