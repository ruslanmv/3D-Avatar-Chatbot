# NEXUS Private — Language Fidelity, Music Consent and Conversational UX Review

**Branch:** `feat/living-worlds-spatial-storytelling`  
**Audit:** 2026-11-09; user-supplied Italian transcript and source review on this branch.  
**Status:** P0 music default fix committed; **locale catalog, output safety and real-model validation remain required**. No PR created.

## 1. Executive judgment

The provided transcript is **not premium-quality Private companionship**. It exposes at least six independent problems:

| ID | Observable symptom | Likely origin / verified source | Severity |
| --- | --- | --- | --- |
| LANG-01 | UI/voice Italian but Private author-written replies in English ("I want this unhurried…", "You do not have to answer…") | Verified: `PrivateBeats.js` has English-only `POOLS`, `LEVEL_LINES`, `plannerSystemPrompt`; `PrivateLocale.js` translates controls/choices, **not story content**. `TogetherCapability.js` retains English `PRIVATE_PRESETS`, acknowledgement text and scene suffix. | **P0** |
| LANG-02 | Mixed labels and suggested replies across languages, possible change mid-session | Verified: several `TogetherPanel.js` setup labels are literals in English; `PrivateLocale.t` falls back to English. `AppLanguage` supplies a general LLM directive but does **not translate authored prose**. Prepared plans are not invalidated on language changes. | **P0** |
| AUDIO-01 | Automatic upbeat lofi track in a private romantic scene, multiple identical playback cards | Verified root cause for auto music: `Intimate.soundtrackChoice='choose'`, `IntimateExperienceSession` defaults to choose, setup Begin fallback choose, and `_startSoundtrack()` searches/plays. The **multiple cards' exact trigger remains unproven**; investigate `MediaIntent`, `PlayDirective`, `ConversationPublisher`, `SoundtrackStrip`, `MediaSession`, and replayed events. | **P0** |
| OUTPUT-01 | Raw ```motion``` JSON and `THOUGHT:` text appear in conversation | Verified model/render boundaries exist: `src/xr/MotionBlockParser.js`, `MotionIntegration.js`, `src/main.js` streaming mask, `src/LLMManager.js` `stripReasoningWrappers` and `visibleMessageText`. **The path that produced this specific transcript has not been traced.** `visibleMessageText` can fall back to `reasoning_content` when `content` is empty; audit this as an information-leak risk. | **P0** |
| WORLD-01 | Claims "we are at the lake" and describes a bedroom/forest without evidence of scene confirmation | The chat transcript does not prove the renderer loaded these places. Need correlated event trace: user request → authorized travel → renderer confirmation → speech. Do **not** infer that world travel occurred just from dialogue. | **P0** |
| STORY-01 | Repeated greetings, repeated "Ciao! Come stai?", unsolicited farewell, generic menu questions, faux sensory details | Dialogue planning/novelty and location prompts; verify generation source and no forced scheduled beats in Private. Need transcript-level quality tests, no more generic "how can I help?" style loop. | P1 |
| AUDIO-02 | A focus/energy lofi playlist clashes with the Private mood | Generic media recommendations are not Private-specific. Must never pick a song without explicit user request; opt-in selection should use preferences and actual music metadata. | P1 |

The first two are **language architecture failures**, not a need to switch models. The third is a **product-consent bug**, not merely a browser autoplay issue. Output leaks are separate security/UX problems requiring a shared validated response seam.

## 2. Already committed — silent by default (first P0 fix)

- `src/features/together/activities/playground.js`: new session `soundtrackChoice='none'`, unknown setting falls back to none; quick-start from previously stored session defaults to none (old auto choice is not fresh permission).
- `src/features/together/TogetherCapability.js`: absent soundtrack choice means none.
- `src/features/together/ui/TogetherPanel.js`: Begin handoff defaults to none.
- `tests/behavior/private-prepare.test.js`: updated baseline expectations for no search on initial mood choice, explicit `Auto` searching, initial `Off` selection, and silent "again" entry.

**Not yet verified in a local browser/test runner in this session.** Re-run all tests. Follow up with separate checks for tracks already playing before Private begins, mid-session explicit requests, player/replay idempotency and stale async music requests. Changing only the initial default cannot guarantee total absence of unexpected audio if a prior player was active.

## 3. Design principle — one locale identity, many authored resources

The master language is `AppLanguage.code` (not a second Private dropdown). It should govern STT, TTS, UI, authored story beats, suggested choices, mood description, provider requests, fallbacks, errors, scene dialogue and voice announcements. Use **BCP 47** identifiers consistently.

Current settings/locales: `en-US`, `en-GB`, `es-ES`, `it-IT`, `fr-FR`, `de-DE`, `pt-BR`, `ja-JP`, `ko-KR`, `zh-CN`. Confirm actual list and aliases from `AppLanguage.js` at implementation time. Support RTL language additions through direction metadata rather than assuming all writing runs left-to-right.

Create a **versioned authored prompt catalog** rather than more English literals inside control flow:

```text
src/features/together/prompts/
  schema.json
  en-US.json
  en-GB.json (regional override/alias)
  it-IT.json
  es-ES.json
  fr-FR.json
  de-DE.json
  pt-BR.json
  ja-JP.json
  ko-KR.json
  zh-CN.json
  index.js / generated runtime catalog (compatible with classic scripts)
```

**Proposed catalog schema, not yet accepted by any runtime:**

```json
{
  "schemaVersion": 1,
  "locale": "it-IT",
  "namespace": "private",
  "strings": {
    "setup.music.off": "Senza musica",
    "setup.music.playOnRequest": "Scegli musica",
    "story.affectionate.openings": ["Sono felice di essere qui con te. Che cosa ti va di fare?"],
    "story.romantic.openings": ["Che bella atmosfera. Preferisci restare qui o esplorare insieme?"],
    "story.sensual.openings": ["Possiamo prenderci il nostro tempo. Scegli tu il ritmo."],
    "story.moodPrompt": "Preferisci un momento tranquillo o più giocoso?",
    "story.middle.playful": "Questa serata sta prendendo una bella piega.",
    "story.middle.tender": "Mi piace questo momento tranquillo insieme.",
    "story.texture.prompt": "Preferisci parlare o restare un po' in silenzio?",
    "story.level.2": "Va bene, ci avviciniamo con calma.",
    "story.level.3": "Seguiamo il ritmo che hai scelto.",
    "story.level.4": "Restiamo al ritmo che desideri.",
    "errors.modelUnavailable": "Non riesco a rispondere in questo momento."
  }
}
```

This example is an initial **localization seed**, not a finished literary translation. Mature lines must remain subject to the existing consent/content-capability gates; a locale pack never grants adult permissions.

### Separate technical instructions from user-facing text

Not all internal English prompt directives are intended for humans. Translation is not a substitute for system-message priority, capability allowlists, or model output validation. Implement localized **authored story/system-prompt variants** where requested while preserving identical security invariants across locales. Keep identifiers, schema keys and tool names stable. Test that translated instructions do not weaken consent or tool restrictions.

Recommended interface:

```js
const locale = NEXUS_LOCALE.current(); // app settings, read at request time
const prompt = PromptCatalog.render('private.story.opening', {
  locale, style: session.style, place: verifiedScene.label
});
```

- Validate catalog schema and **all required keys in every supported locale in CI**, including placeholders, length bounds, banned markup and Unicode normalization.
- No automatic English fallback for *visible* Private dialogue or TTS. If a content key is missing, use a **verified same-language** neutral fallback or suppress the optional scripted beat with a diagnostic event. For functional safety/exit controls, provide an accessible, explicitly documented emergency fallback.
- English fallback may remain in internal technical logs; do not transmit Private transcript data to third-party translation services.
- Have fluent reviewers approve literary/romantic tone, gender/grammar, politeness, and locale appropriateness. A machine-generated translation is draft, not production-ready.
- Support runtime locale changes: invalidate pending written plans, stop old-language TTS cleanly, load the new locale, and regenerate only future optional beats; do **not** translate or replay previous private dialogue without consent.
- UI copy must use catalog keys: `TogetherPanel`, `PrivateConversationView`, `PrivateChoices`, `PrivatePreflight`, `SoundtrackStrip`, `PrivateBeats`, `PrivatePace`, `PrivateIdleClock`, `PrivatePresentation`, `TogetherCapability`. Avoid literals like "Last time", "Get ready", "Back", "Edit setup", "No music", "Auto music", and "this place feels like a good place for it" in behavior code.
- Log the current locale ID and catalog version **without the Private dialogue text**.

## 4. Music — explicit action, silence first

**Desired state machine:**

```text
Private entry -> SILENT (default)
  -> User chooses "Scegli musica" or explicitly asks "Metti musica" -> REQUESTED
  -> Search/selection with user provenance -> PREPARED
  -> Player accepts a real play request -> STARTING
  -> Player reports playing -> PLAYING
  -> Pause / stop / exit / consent withdrawal -> STOPPED
```

Do not confuse a model suggestion, inferred romantic mood, prior auto preference, or general music instruction with a user request. User-approved "Keep current track" is separate from "Play new track". Entering Private with already-running external music requires a deliberate, documented policy (pause/restore vs explicit keep), not implicit playback.

- Remove unsolicited music from default Private prompts and authored suggestions. Do not repeatedly offer playlists.
- Keep independent **soundtrack** and **narration** channels; mute/duck sound during TTS when an actual track is playing.
- Deduplicate playback card creation by stable `requestId`, `sessionId`, track ID and player state. Only create a "Playing" assertion after the player confirms playing; a queued request is not evidence of playback.
- Cancel stale result searches on End, session change or a new request; do not let a late response start a track.
- Avoid redundant YouTube cards in main public chat during Private. Media UI belongs to one permitted surface; no cross-context transcript persistence.
- Use explicit user selection even if the browser technically permits autoplay. See MDN https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay.

## 5. Trustworthy response pipeline

**Raw provider response MUST NEVER be the content passed to chat, transcript storage or TTS.** Use a shared output envelope:

```text
provider response (possibly streaming)
  -> structured channel separation (final vs reasoning, tool/animation metadata)
  -> robust motion/gesture/tool parser (known schema, validation)
  -> safe user-visible text and audio projection
  -> authorization and renderer-confirmed action execution (separate authority)
  -> transcript for this context only
```

- Do not expose `THOUGHT:`, `reasoning_content`, `<think>`, `<|channel|>analysis`, JSON or ```motion``` blocks to users. Do not republish private internal analysis to logging or TTS.
- The current `LLMManager.visibleMessageText` can fall back to reasoning content when no `content` exists. Change the behavior to return a recoverable empty-final error and retry/fallback rather than exposing internal reasoning. The user-supplied inline `THOUGHT:` is also not captured by the existing `<think>`-only wrapper; write targeted tests before choosing a safe parser.
- Keep existing `MotionBlockParser` and `MotionIntegration` action ownership; test **streaming and non-streaming** with incomplete fences at chunk boundaries and malformed JSON. Avoid broad regexes that remove legitimate user quotations.
- A model's text "we're at the lake" cannot establish location. Confirm `WorldPresence` and renderer generation; only then permit a factual arrival line.
- For unsupported descriptions (candles, scent, objects), prompt the model with verified scene facts; do not invent physical objects/sounds. Figurative speech is okay when not presented as a verified action or object.
- Avoid duplicating assistant greeting/closing speech from general chat + Private authored beats. One response owner per event, no duplicate "Ciao" from competing handlers.

OWASP recommends validating outputs and treating model-produced action instructions as untrusted: https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html.

## 6. Premium Italian UX target (illustrative, non-explicit)

**User enters a verified suite with Italian settings:**

> NEXUS: "Benvenuto. Possiamo prenderci tutto il tempo che vuoi."  
> User: "Come ti chiami?"  
> NEXUS: "Sono NEXUS. Mi fa piacere passare un po' di tempo insieme."  
> User: "Vorrei andare vicino alla finestra."  
> NEXUS: "Andiamo."  
> [Verified spot change is confirmed; scene stays loaded.]  
> NEXUS: "Da qui si vede meglio il panorama."  
> User: "Metti un po' di musica."  
> NEXUS: "Certo. Preferisci qualcosa di tranquillo o vuoi scegliere tu?"  
> [Music choice/request is confirmed; playback card appears only when needed.]

No unsolicited track, no English story beats, no raw directives, no invented scene travel, no repetitive interview questions.

## 7. Required implementation phases

| Stage | Scope | Acceptance evidence |
| --- | --- | --- |
| **P0A — music default (committed)** | Silence on setup, runtime and quick-replay; new regression expectations | Run unit tests and browser to verify no search/play on entry |
| **P0B — output/trust boundary** | Separate visible text from reasoning and fenced motion blocks, streaming & nonstreaming; verify TTS consistency | 0 leaked reasoning/motion across a deterministic test matrix |
| **P0C — locale catalogs** | Versioned authoring catalogs for **every AppLanguage locale**, starting with properly reviewed Italian and English; migrate all Private authored narration and setup | Required-key coverage 100%, no unlocalized visible/TTS strings, on all supported locales |
| **P0D — media authorization/dedupe** | User-originated request envelope, playback confirmation, exactly one player/card, no late audio | 0 new tracks on entry; 1 requested track => at most 1 active player/card |
| **P1A — live language switch** | Invalidate prepared story and audio; rebuild future prompts and UI, keep consent/world | Italian→Spanish→Italian during session: no mixed-language future lines |
| **P1B — world/story truth** | Verified travel and objects; short lived SharedMoment | 0 unconfirmed arrival or object claims |
| **P1C — style/character quality** | Natural turns, idle silence, distinctive romantic/sensual register within authorized ceilings | Human review and real-model scored transcripts |
| **Release** | Real provider/device tests, QA, privacy, age assurance and policy compatibility | Explicit signoff, not inferred from unit tests |

## 8. Minimum test matrix

**Languages:** en-US, en-GB, es-ES, it-IT, fr-FR, de-DE, pt-BR, ja-JP, ko-KR, zh-CN.  
**Surfaces:** Private wizard, fallback story, generated story, live response, choices, errors, media cards, TTS, STT, headset panels where supported.  
**Providers:** deterministic fixture, at least two actual supported providers if configured.  
**Modes:** general chat, Experiences, Private, Private→Copilot→Private, Clear/End.  
**Devices:** desktop Chromium, Android-sized mobile, small 320px viewport, Quest physical headset if available.

Acceptance checks:
1. Selected Italian: all *authored* narrative, setup, options, fallback errors, speech and later turns are in Italian. Repeat for every locale.
2. Switch language mid-session, while a story plan is prepared and audio is speaking; no old-language scripted line leaks after change.
3. With no media request, private prewarm issues **zero** music search calls; start issues **zero** media play calls, and there is no active new player.
4. Quick repeat of an old session with historical auto setting remains silent.
5. Explicit "Auto" selection in setup and explicit in-session request each work once, with clear audio ownership.
6. Media duplicates: no repeated "Playing" card, no auto playlists, no unexpected titles.
7. Literal `THOUGHT:`, `<think>`, reasoning-only provider responses, half-streamed ```motion``` fences, invalid plans: no raw internal text in chat or TTS.
8. User declines travel: current world persists; confirms travel: speak arrival only after renderer confirmation.
9. Private context is not stored or leaked to ordinary history; prompt catalog changes do not grant permissions.
10. Existing age/consent/stop gates and voice/camera device preferences unchanged.

**Commands:** inspect actual `package.json` and existing test structure; run focused Jest suites, `npm run validate`, behavior-parity check, headless browser screenshot run and available device tests. Do not invent output numbers.

## 9. Industrial quality gates and references

- W3C I18N localization and language metadata: https://www.w3.org/TR/international-specs/
- MDN web-audio autoplay and user-gesture policies: https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay
- OWASP untrusted LLM outputs and tool authorization: https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html
- WCAG language of parts, readable controls, and mobile touch targets: https://www.w3.org/TR/WCAG22/

**Do not enable or loosen Private/adult access or content capability by editing locale catalogs.** No erotic/autoplay capability should be inferred from language or style selection.

## 10. Claude Code continuation requirement

Treat LANG-01, LANG-02, AUDIO-01, OUTPUT-01 and WORLD-01 as separate tickets, not one prompt-tuning issue. Begin with reproducing the existing Italian transcript as deterministic fixtures, audit and commit the smallest real fixes, then build the complete locale catalog and verify 10 locale packs. Keep changes on `feat/living-worlds-spatial-storytelling`. **No PR or merge.**

For this report's initial music fix, the source was updated via GitHub connector but no Jest or browser test runner was available in the current tool session. All other items remain **recommendations and acceptance requirements until implemented and tested**.
