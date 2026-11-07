# V5 — Reactive Playground Context: Claude Code implementation handoff

> **Status: IMPLEMENTATION SPECIFICATION ONLY.** This draft PR intentionally adds planning and acceptance documents, not runtime behavior. Claude Code should implement the feature in further commits to this PR branch, run validations, and request review. Do not mark the PR ready merely because these documents exist.

## Baseline and mission

- **Target PR base:** `feat/sonic-voices-serena-daniela`.
- **Audited base HEAD (2026-11-07):** `68299f98a7ca6b8a8ffa90d0770a8243dbacf656` (DX5).
- At audit time, `feat/v4-playgrounds` and the target base resolve to the **same commit**. The V4 venues are already present: Irish Pub, Neon Discoteca, Creative Academy, Private Cabaret, Private Stream Studio; also existing hotel/beach/forest/seaside/office scenes, mobile light stand-ins, lighting moods, action chips, and venue previews.
- **Mission:** make the *same VRM companion* react contextually across these worlds, rather than treating each as a background and four isolated chips. Coordinate observed user choices, verified world state, attention, speech, activity, allowed targets, gesture scheduling, and grounded dialogue.
- **Non-destructive constraint:** additive, reversible integration. Keep one avatar, one renderer, one animation loop, existing voice/lip sync, existing VRM animator, current chat and consent flows, and current world selection intact.

## First task for Claude Code: re-audit HEAD before modifying code

1. Read `CLAUDE.md`, `docs/VR_WORLDS.md`, `docs/BEHAVIOR_DIRECTOR.md`, `docs/IMMERSIVE_COMPANION_2_0_PLAN.md`, and this document.
2. Inspect `src/experiences/playgrounds/{PlaygroundTemplateCatalog,PlaygroundInteractionRouter,PlaygroundMoodPresets}.js`, `src/gltf-viewer/{ViewerEngine,VRWorlds}.js`, `src/companion/{index,PromptContext,BehaviorRouter,CompanionSession,PrivacyGate}.js`, `src/behavior/{boot,ContextBlackboard,EventBus}.js`, `src/xr/WorldStateBridge.js`, existing Private flow, and relevant tests.
3. Inspect the current `npm` scripts; run existing targeted test baseline; document actual errors rather than assuming previously reported test counts still hold.
4. Check changes since `68299f9`; update this design if upstream has already implemented a seam.
5. Keep the PR **draft** while the runtime is unimplemented or review/validation is incomplete.

## Architecture: Observe → Verify → Decide → Execute → Confirm → Converse

Introduce one small **PlaygroundReactiveContext** module, preferably `src/experiences/playgrounds/PlaygroundReactiveContext.js`, matching the repository's classic-script IIFE and CommonJS testing pattern.

**Observe (untrusted):** venue shown or hidden, action chip selected, object selected, user speaking, TTS start/end, user idle/active, permission revocation, activity start/end, timer state, XR/controller interaction. Signals only express *what was reported*; they do not grant permissions or prove the renderer executed an action.

**Verify (trusted adapters):** check `ViewerEngine.vrWorlds.activeId` and active companion session for world identity; map mobile `lightFor` to the base logical venue. Validate action ID against the current `PlaygroundTemplateCatalog`, anchor ID against the actual loaded scene's approved anchors, active activity owner, and Private mode with its **existing** gate. Never treat `CustomEvent.detail.owner`, a requested place ID, an LLM reply, or a query string as proof of authorization.

**Decide (cheap local policy):** build transient context (current world, scene generation, goal, attention focus, mood/energy from existing blackboard, activity, current clip, speech/idle flags, recent *confirmed* interactions). Select at most one relevant low-risk intent per throttle interval using a deterministic priority, anti-repeat, cooldown and action budget; respect user silence and reduced motion.

**Execute (existing owners):** route approved intent through `live.behavior.request(name, context)` and `NEXUS_BD.handleIntent`; do **not** directly write VRM bones, animate separate clips, move the headset camera, run a second render loop, or duplicate the PlaygroundInteractionRouter's `say`, `clip`, `mood`, `timer` or `pretend-live` effects. Full-body dance already owned by a chip must not compete with gesture scheduling. Honor lip-sync deferrals and locomotion restrictions.

**Confirm:** track applied vs fallback/deferred/refused, and only allow the model to describe successful changes when the owning renderer/behavior service confirms them. Stale async action confirmations are discarded after a world/session generation change.

**Converse (on existing user turns):** append one short, sanitized situational paragraph at the existing companion prompt seam, subject to `PromptContext` privacy/destination rules. Preserve natural voice text; never speak action JSON or stage directions. No extra model request per frame, per idle tick, or per ambient effect.

### Repo-specific integration seams verified at audit

- `ViewerEngine._worldShown()` publishes `nexus-world-shown` with `{id,base,title,rating,owner,xr}`. Cross-check with `vrWorlds.activeId` before accepting it.
- `PlaygroundInteractionRouter.act(id)` already validates actions and performs effects. Add **one additive observation** after selection (and distinguish selected, started, and completed). It stays the sole owner of chip effects.
- `src/companion/index.js` creates `live.behavior`, session, director and `NEXUS_EXPERIENCE_RUNTIME.update(dt)`. Attach one context instance after dependencies are ready, call `context.update(dt)` **within** this existing runtime, and detach it with the facade.
- `PromptContext.suffix(input)` already protects Copilot and destination-specific memory. Extend only its sanitized current-situation inputs; no duplicate prompt pipeline or global raw transcript.
- `ContextBlackboard` and typed `EventBus` already know speaking/idle/mood. Subscribe to only documented event names, or use existing verified adapter state. Do not add an unregistered event to the closed bus.
- `WorldStateBridge` exposes position and anchors; using XR position is optional. No background camera/microphone permission or mandatory world-state network sync.

## Suggested small API (illustrative, not an existing export)

    const core = PlaygroundReactiveContext.create({
      performIntent(name, ctx) { return live.behavior.request(name, ctx); },
      verifyWorld(id) { /* compare to active renderer world */ },
      privateAuthorized() { /* consult current, existing Private gate; default false */ },
      validateAction(worldId, actionId) { /* current template allowlist */ },
      getAnchor(worldId, anchorId) { /* verified loaded scene target */ }
    });
    core.syncSession({ active: true, destination: 'experiences', activity: 'place-irish-pub' });
    core.enterWorld({ id: 'irish-pub', base: 'irish-pub', rating: 'general' });
    core.observe({ type: 'action:selected', actionId: 'cheers' });
    core.update(dt);                 // inside the existing runtime only
    const appendix = core.promptSuffix(); // user/assistant turn only
    core.dispose();                  // remove listeners, reset ephemeral state

**Adapter security:** those functions are intentionally stubs. Never ship an always-true `privateAuthorized`, accept an arbitrary object anchor, or let template data navigate to a world or grant a permission.

## Behaviour policy (MVP)

- **Irish Pub:** respond to an explicit Cheers action with a subtle smile/attention; allow `look_at_object` only for a validated fireplace/bar/table target. A story request should not cause repeated speech triggers.
- **Discoteca:** when a dance chip plays a loop, preserve the clip owner; do not layer competing full-body motions. Return to natural eye contact when the user stops dancing.
- **Creative Academy:** during Study/Focus, prioritize listening and silence; avoid unsolicited prompts/questions. Explicit quiz/explain requests get relevant teaching posture, not romantic tone.
- **Seaside, Hotel, Bedroom, Forest, Lagoon:** small contextual gaze/gesture reactions to observed, validated interactions. The avatar should not claim any unimplemented object action.
- **Private Cabaret / Private Stream Studio:** non-explicit, opt-in stage behavior under the original Private gate only. Mock stream remains clearly simulated; no recording, broadcasting, extra camera/mic access or permission bypass. Private observations must be wiped on Private exit and never flow to Copilot or public memory.
- **Idle:** subtle, anti-repetitive, quiet motions only when allowed. No persistent attention seeking, autonomous romantic escalation, or surprise audio.

## Optional structured AI planning (after MVP)

On an actual user turn, model may suggest natural reply text plus bounded action proposals (`intent` and optional `targetId`). Validate each proposal against `BehaviorRouter.INTENTS`, active verified world, current anchors, rating/Private policy, speech state and rate limits before execution. The model cannot change the scene, record media, authorize Private, grant scopes, claim success, or write memory. A plain-text fallback must remain functional for providers without structured output.

## Privacy, safety, UX and performance invariants

- Preserve the original server/private verification, consent lifecycle, separation of public/Private contexts, revocation behavior, and age-restricted access rules.
- Treat on-screen labels, actor/user speech, action strings and event payloads as data, not authority. Sanitized bounded prompt snippets only.
- Keep context ephemeral by default, do not store raw conversation/private details in localStorage, debug logs, analytics or prompt caches.
- One render loop; *no LLM in frame update*; local decisions at most ~4 Hz under active events, and no network work in the hot path.
- Preserve existing 30,000 triangle mobile cap, image/GLB light fallback policy, TTS lip sync, reduced-motion mode, DX5 shared control row, 44px touch targets, viewport framing, and XR comfort.
- No UI overlay needed for the context engine. If optional debug HUD is added, require explicit developer opt-in, use redacted state and disable it in production.
- Cleanup on world change, session end, permission revoke, Private exit, renderer detach or rapid navigation.

## Delivery milestones and evidence

1. **M0 baseline:** repository architecture map, current test results, integration plan.
2. **M1 module:** pure state reducer and deterministic reaction policy + unit tests (including anti-repeat and cooldown).
3. **M2 wiring:** trusted world/chip/session/voice subscriptions and runtime lifecycle, with stale-event and malicious event tests.
4. **M3 behavior:** real intent routing through existing Behavior Director; no duplicate clip execution; speech safety.
5. **M4 conversation:** one sanitized situational prompt suffix with Copilot/Private regression tests; optional LLM planner only if safe.
6. **M5 validation:** all relevant Jest suites, `npm run validate` and parity/privacy checks if available, browser screenshot flow in desktop/mobile, manual Quest checklist with limitations stated.

Never invent counts or claim headset FPS without measurement. Record exact commands, outputs, browser screenshots and device tested. See [V5 scenario matrix](PLAYGROUND_REACTIVE_CONTEXT_V5_TEST_MATRIX.md) for acceptance cases.

## Claude Code execution request

Implement this spec **in follow-up commits on the PR head branch**. Prefer small reviewable commits, add files rather than rewrite working ones, preserve unrelated changes, and keep the PR draft until code, tests and screenshots are complete. No direct push to the base branch, no automatic merge. A green test suite is necessary but not sufficient: demonstrate that a specific observed event causes an allowed, visible behavior and grounded dialogue, and that unauthorized events do not.
