# Premium Living Worlds — entertainment-first product roadmap

> **Planning artifact; not implemented.** This document extends [LIVING_WORLDS.md](LIVING_WORLDS.md). Do not confuse future platform experiments with integrations currently shipped. Do not turn on adult features, media playback, data sharing or capture by default.

## Positioning and priority

**Primary: premium entertainment and companionship.** NEXUS should feel like one responsive character sharing believable spaces, with user-directed romantic/fan-service interactions where enabled. **Secondary: productivity and learning** using the same spatial substrate and a context-isolated professional persona.

A premium outcome is not measured by the number of scenes or length of dialogue. Measure meaningful agency, continuity of the location, honest action execution, variation, restrained animation, voice quality, comfort, privacy and low-friction navigation.

Product tiers of experience:

| Layer | Goal | Scope |
| --- | --- | --- |
| Foundation: Living Worlds | One genuinely connected, believable apartment with verified room/spot transitions; no surprise background changes | **Implement first, required** |
| Entertainment: companion moments | Romantic dinner, quiet evening, playful conversation, dance, forest and beach, scene-aware mood, branching stories with consequences | **Next priority** |
| Optional Private adult experience | Adult-only, user-initiated erotic/romantic themes and fan-service presentation under **existing** Private/Intimate age and consent gates; immediate stop, noncoercive behavior, no auto-escalation | **After stable foundation; gated** |
| Entertainment media experiments | Explore feasibility of licensed, authorized media presentation with providers including `xnxx.com` and `vrporn.com`, if technically and legally permitted | **Research/spike only; no automatic embedding** |
| Productivity and learning | Wikipedia-based study/teaching, coding companion, GitHub/GitPilot-style workflows and office venues | **Second priority, after entertainment core** |

## Premium shared apartment is the proof of quality

Prefer the already-shipped, connected `assets/vr-worlds/scenes/pixel-flat.glb` over building an entirely new apartment with furniture kit pieces. The existing file is ~28,760 triangles and has the best verified starting point for living, sleeping, kitchen, bathroom and desk spaces. Inspect it in 3D before authoring coordinates. The desktop `bedroom-flat.glb` is a **different model** and must be independently measured. Reuse Kenney CC0 furniture for necessary small repairs, not as an excuse to create mismatched scenes.

**First acceptance scenario:** user and companion enter the apartment; move between sofa, kitchen, bathroom, bed/window and desk through *validated* spot changes without reloading or replacing the world; one conversation persists; the assistant never claims to retrieve a blanket, touch a lamp, sit or lie down unless the asset, supported pose/actuator and success confirmation exist. In initial VR mode use fade-and-re-place rather than forced smooth locomotion.

**Other entertainment scenes:** for a forest, club or beach, offer a purposeful cross-world change requiring the user's assent except where they deliberately selected the place through UI. The companion keeps conversation continuity but a new world loads only after authorization and renderer confirmation.

## Character, romance and fan-service quality

The same identity is used throughout. Affect, gaze, gestures, posture, speech pacing, attention and story initiative adapt to *verified* scene and user input.

- **Natural interaction:** concise, warm, context-specific conversation, natural pauses, local idle behavior, no scripted compliments or obligatory questions, do not claim to be human.
- **Meaningful interactivity:** at least 2 real scene interactions per flagship venue; optional story branches have consequences. Do not fake hand-object interactions.
- **Relationship preferences:** honor only user-directed, approved settings; no autonomous escalation, pressure, jealousy/dependency tactics or invented emotion certainty.
- **Romantic / fan-service mode:** tasteful affectionate behavior in permitted general/romantic contexts. Adult/erotic experiences are **separate opt-in Private capabilities**; preserve verified eligibility, consent controls, permission revocation, age gating, privacy boundaries and an always-accessible exit. Do not pass Private details into public conversation, Copilot, analytics or reusable prompt caches.
- **Workplace:** default professional behavior and presentation; no romantic/fan-service carry-over to work/learning. A user may change tone explicitly without altering the underlying location or violating privacy isolation.
- **Avoid loud animations:** an expression or glance may serve better than a gesture, and silence is often best. Keep existing lip-sync / motion ownership and reduced-motion support.
- **User control:** always allow interrupt, stop, hide status/UI and restore controls; never make session ending difficult.

## Future partner/platform experiments: feasibility gates

These are **future validation targets, not currently integrated partners**:

### Adult entertainment media: `xnxx.com`, `vrporn.com`

Before attempting a demo: determine whether each site permits third-party embedded players, legal age verification, content rights/licensing, cross-origin integration, secure referrers, and VR playback. There is **no assumed public API, licensed content feed or embedding permission**. Do not scrape, mirror, download copyrighted videos, bypass authentication/DRM/geoblocks/paywalls, auto-play unsolicited sexual content, or transmit private companion chat to those services. Require explicit mature-user opt-in and platform compliance; run a vendor feasibility review. If integration is not permitted, provide a respectful external-link experience instead of pretending playback works.

Design a provider-neutral `ExternalMediaExperienceAdapter` with explicit supported capabilities (open, authorized embed, playback status, spatial audio, captions, start/pause/stop; each marked supported/unsupported), verified events, consent, secure origin handling and scene/companion synchronization only after confirmed playback status. Keep provider code out of the core navigation engine.

### Learning and coding: Wikipedia, GitHub, GitPilot-style pages

Prefer official supported APIs, documented content reuse and attribution, safe link handling and explicit user approval for account data or write actions. Wikipedia can provide an encyclopedia-backed context; GitHub or coding-provider connectors may expose project context only when connected and authorized. **GitPilot is a future target name, not evidence that a specific API exists.** Do not imply that pages were read, code changed or commits pushed without tool-confirmed results. Keep provider abstraction independent of entertainment and of Private state.

## Interface and cinematic polish

- Main 3D companion and world are the hero: no duplicate destination navigation, no avatar portrait in chat, no large colored session banners.
- Compact optional location breadcrumb; existing icon-only end control; hideable immersion overlay; tap/keyboard/VR restore path, safe touch targets.
- No visible debug HUD for customers. A developer-only spot inspector shows confirmed world, physical scene variant, proposed/confirmed spot, action log, generation and cancellation reasons.
- Clean transitions, spatial audio ducking during voice, consistency of lighting/avatar grounding, conversation language continuity (Italian and English), graceful no-network fallback.
- Do not change background as a visual flourish. **Always retain a world until a real travel event succeeds or existing lifecycle requires its removal.**

## Implementation sequence

1. **LW1 — in current branch:** Regression guard against model-generated activity tags replacing a selected place; prose grounding; tests. Audit and tighten.
2. **LW2 — source-of-truth apartment:** Measure and verify pixel-flat / bedroom-flat actual room spots separately, with geometry and comfort tests. Do not invent coordinates or capabilities.
3. **LW3 — physically confirmed navigation:** cached-world re-placement/fade, semantic spot selection, prompt from confirmed spot, safe cancel/rollback.
4. **LW4 — compelling entertainment interactions:** in-place relax, romance-safe dialogue style, story choice consequences, observed-object reaction, grounded animation, local speech/gesture sync. User enters a meaningful space; the companion shares it rather than narrating fantasy actions.
5. **LW5 — destination travel:** authorized forest, beach, nightclub and work venue transitions; reasoned conversation continuity and private/public boundary.
6. **LW6 — premium adult opt-in and cinematic polish:** only after consent/security/performance gates, with user-controlled pacing and private state. Separately research provider feasibility—do not hold the core experience hostage to third-party integrations.
7. **LW7 — productivity/learning expansion:** Wikipedia learning context, coding / GitHub / prospective GitPilot workflows, verified tool outcomes, professional tone and privacy isolation.
8. **LW8 — optional advanced walking:** measured navigation graph/navmesh for safe avatar walking on desktop/mobile, keeping VR comfort; hardware verification.

## Definition of done for premium demo

- 1 complete connected apartment, real verified locations and at least 3 working inter-room transitions using no surprise background swap.
- 3 meaningful context-aware interactions and at least 2 story choices with real downstream effects; no invented object manipulation.
- Demonstrable conversation context across apartment, nightclub and forest; English and Italian examples; one personality.
- A user can choose quiet, stop motion and exit with one accessible action; sensitive content never starts from model initiative.
- Device-specific coordinates/scene variants; no camera teleport in XR; real desktop/mobile and Quest testing evidence.
- Separate clean prompts and memory scopes for romance/Private versus Copilot/learning.
- Third-party entertainment/coding integrations are explicitly marked *research only* until legal/technical approvals and working adapters are verified.
- Record measured tests, screenshots, device limits, accessibility and asset/license provenance. Keep changes on the development branch; do not create a pull request unless the user explicitly requests one.
