# CLAUDE CODE HANDOFF — Living Worlds, premium entertainment and grounded storytelling

> Standalone development branch: `feat/living-worlds-spatial-storytelling` (base: `master`). **Do not open or reopen a pull request unless the user explicitly requests one.**
>
> Read `CLAUDE.md`, `docs/LIVING_WORLDS.md`, and `docs/LIVING_WORLDS_PREMIUM_ROADMAP.md` completely before modifying code.

## Paste this task into Claude Code

You are continuing work on an **existing standalone GitHub development branch** in https://github.com/ruslanmv/3D-Avatar-Chatbot . Work on branch `feat/living-worlds-spatial-storytelling` only. Do not open or reopen a pull request, do not merge, and do not push directly to `master` unless the user explicitly asks. Begin by auditing the branch and running existing targeted Jest tests. This branch contains implemented **LW1 preservation guards and tests**, plus a detailed staged specification; it does **not** yet contain real room navigation, new player integrations, or final VR validation.

**Product priority: FIRST premium entertainment and companionship, including opt-in romantic/fan-service and—under existing verified adult-only Private gates—erotic experiences; SECOND learning and productivity.** The mission is a coherent, embodied, responsive character in persistent spatial worlds, not a background carousel or a scripted monologue. Maintain short natural English/Italian replies, emotional nuance without manipulation or pretending to be human, smooth VRM animation, lip sync, user agency, accessibility and private-state isolation.

### Must deliver first: one believable connected apartment

1. Reproduce the provided regression: user chooses `Experiences · Bedroom`, then says `si mi piace`; LLM emits `<activity name="relax"/>`, which historically swapped the bedroom to `meadow-village`. Check the current LW1 code in `src/companion/{ActivityDirective,index,PromptContext}.js` and the new test in `tests/companion/living-worlds-presence.test.js`. Fix weaknesses; **no model activity tag or incidental change of topic may replace a user-selected world.**
2. Audit the existing `assets/vr-worlds/scenes/pixel-flat.glb` (connected apartment, 28,760 triangles, currently used as mobile bedroom fallback). Measure actual floor geometry and named/visible bedroom, kitchen, bathroom, living-room and desk locations. Inspect `bedroom-flat.glb` separately for desktop/VR; it has different geometry and coordinates. Never invent a spot position. Prefer existing cohesive scene and existing CC0 asset kits over downloading new models. Record provenance for any genuinely missing asset.
3. Create a small, versioned **verified spots** data contract per physical scene variant (not just a generic world ID). Include id, English/Italian name, coordinate space, position, facing, ground/contact/collision confirmation and actual supported actions. Reject unknown or unmeasured spots; don't offer unavailable kitchen/bathroom in a scene that lacks them.
4. Implement a trusted **WorldPresence / SpotNavigation** adapter. **In the first release use fade/blink and re-place inside the already-loaded world; do not attempt straight-line walking through furniture.** Reuse renderer ownership, camera framing, scene-generation cancellation, comfort and rollback. In VR do not move headset/camera unexpectedly or glide the environment through the user. A successful navigation is confirmed by the renderer, not by an LLM phrase.
5. Implement a **TravelCoordinator** for separate forest, nightclub, beach, office worlds: propose -> validate catalogue, permissions and device tier -> ask user -> wait for their next actual affirmative turn -> prepare/load -> confirm active renderer world -> commit state -> only then speak as though arrived. A deliberate UI selection is itself confirmation. No model answer, hidden tag or forged CustomEvent may authorize travel. Pending proposals expire/cancel on End/Clear/scene-generation change. Private-world travel retains original Private gates and cleanup.
6. Add a **SharedMoment** context to existing `PlaygroundReactiveContext` / `PromptContext`: confirmed location, spot, available real interactions, current conversation goal, last successful action, active activity, recent story choice. Keep it ephemeral and scoped; sanitized in prompt only on conversational turns, not per-frame LLM calls. Prevent claims about blankets, lamps, sitting, doors or walking unless assets and actual runtime actions exist and succeeded.
7. Let in-place relax, focus and story adjust companion tone/activity **without replacing the world**. Extend StoryPlan and interactive venues only after core travel works: choices matter, context drives gaze/body/voice, natural silence is allowed, no repeated arrival messages.

### Premium phase after apartment works

8. Build an entertainment-first **premium experience quality pass**: romantic evening, playful nightclub, peaceful forest and optional user-directed fan-service. Deliver at least 3 meaningfully distinct interactions and 2 choices with observable consequences, with natural concise dialogue and synchronized avatar actions. Preserve existing animation ownership, no competing full-body clips, no duplicate render loop and no forced gestures.
9. Adult/erotic features must remain **strictly opt-in Private experiences** behind existing eligibility/age, consent and permission controls. No unsolicited escalation, non-consensual behavior, persistent adult content in general UI, leakage to Copilot, surprise media auto-play or disclosure of sensitive interaction records. Keep visible stop/exit and prompt cleanup.
10. **Future feasibility research only** for adult VR/media demos involving `xnxx.com` and `vrporn.com`. Do not assume public APIs or permission to embed/scrape, do not bypass DRM/paywalls/copyright restrictions, and never expose private chat/capture data. Check site terms, licenses, embed restrictions, legal age controls and supported WebXR playback before coding provider adapters. The core implementation must not depend on these sites.
11. **Secondary phase:** workplace, study, Wikipedia context and authorized coding/GitHub/GitPilot-style integrations. Use official supported interfaces and proper permissions, verify any tool result before claiming work is complete, cite educational content where needed. Workplace context remains professional and isolated from Private/romantic content. Treat GitPilot as a prospective integration, not an assumed existing API.

### Existing files / systems to inspect and reuse

`src/features/together/activities/{places,playground}.js`, `src/companion/{ActivityDirective,ContextIntent,CompanionSession,PromptContext,BehaviorRouter,index}.js`, `src/experiences/{ExperienceDirector,SceneRuntime}.js`, `src/experiences/playgrounds/{PlaygroundTemplateCatalog,PlaygroundObjectPicker,PlaygroundReactiveContext}.js`, `src/gltf-viewer/{ViewerEngine,VRWorlds,VRSupport,VRControllers}.js`, `src/AvatarLocomotionSystem.js`, `src/xr/MotionIntegration.js`, `assets/vr-worlds/{worlds.json,PROVENANCE.md,scenes/,kits/}`, `src/features/together/Private*` and existing privacy tests.

Respect the repository's classic-script/ESM boot pattern, one existing render loop, original TTS/lip-sync, no duplicate scene authority, no raw action JSON in speech, and original device-tier budgets. Do not edit generated/bundled vendor output to hide regressions.

### Evidence and definition of done

- LW1 tests confirm the bedroom persists after `si mi piace` and unwanted assistant `relax` tag; explicit End still works and clears actual activity.
- At least one real apartment scene supports 3+ **measured, reachable** location changes with zero world reload and verified arrival; physical mobile/desktop variants have correct coordinates.
- Forest/discoteca transition requires authorized user action and only commits after renderer confirmation. Cancellation, denial, timeout and failed load preserve the previous location.
- 3 verified scene interactions, 2 consequential story branches and one believable dialogue sequence demonstrated; unsupported poses/objects are never narrated as completed.
- Privacy, age/consent and Private -> Copilot regressions hold; user-typed directives never execute; same one conversation and one avatar throughout.
- No forced VR camera movement, no accessibility or icon-only Exit regression, reduced-motion support, manual Quest and phone verification (or explicitly documented untested devices).
- Run targeted Jest suites, full `npm run validate`, browser walkthrough/screenshot tests and review asset license/provenance. Record exact results and follow-up limitations in `docs/LIVING_WORLDS_IMPLEMENTATION_REPORT.md`.
- Keep all changes on this branch until actual code, evidence, security/consent and hardware tests meet acceptance criteria; do not open a pull request without the user's explicit request. **Do not claim future adult media integrations, room navigation or worksite connectors already exist.**

### Working style

Proceed incrementally with small reviewable commits: LW1 audit -> LW2 measured spots -> LW3 confirmed local navigation -> LW4 in-place stories -> LW5 approved cross-world travel -> premium entertainment polish -> optional Private adult and external platform feasibility -> productivity. Test after each milestone. If a particular external asset, real headset or API access is unavailable, complete everything else safely, document the limitation, and continue. Never manufacture evidence or silently weaken tests.
