# Private Language and Audio — Implementation & QA Handoff

**Branch:** `feat/living-worlds-spatial-storytelling`  
**Review date:** 2026-11-09  
**Release status:** Development-only. **Not production approved.**  
**Pull requests:** None created or opened.

## 1. Why this work exists

The supplied Italian transcript showed native-language chat mixed with English scripted Private lines and setup copy, unsolicited upbeat music, raw `THOUGHT:` and ```motion``` output, a repeated YouTube card, and unverified lake/beach travel claims. These are different failures, not one prompt-tuning problem.

## 2. Changes present in the development branch

| Area | Source files | Implemented behavior |
| --- | --- | --- |
| **Music silent by default** | `src/features/together/activities/playground.js`, `TogetherCapability.js`, `ui/TogetherPanel.js` | New Private sessions default to `none`, no background music search or play on entry. Missing/unknown options fail silent. Replaying an old setup does not treat the old `choose` preference as fresh permission. Music remains available after an explicit selection. |
| **Authored story catalog** | `src/features/together/PrivatePromptCatalog.js`, `PrivateBeats.js`, `src/behavior/boot.js` | English original pools moved out of behavior logic; localized fallback stories, step acknowledgements, mood/texture, and planner requests for `en-US`, `en-GB`, `es-ES`, `it-IT`, `fr-FR`, `de-DE`, `pt-BR`, `ja-JP`, `ko-KR`, and `zh-CN`. Browser boot loads catalog before PrivateBeats. |
| **Private setup UI localization** | `PrivateLocale.js`, `ui/TogetherPanel.js` | Locale catalog now contains setup titles, navigation buttons, pace/mode names and descriptions, scene/music controls; UI resolves via `_privateWord` and CommonJS fallback for tests. Only keys with verified translations avoid silent English substitution. |
| **Live language switch** | `src/AppLanguage.js`, `TogetherCapability.js`, `activities/playground.js` | Master `AppLanguage.apply` emits `nexus:language-changed`; active Private sessions replace **future** authored beats in the new locale without restarting, losing consent, or switching the world. Prepared-plan cache keys include locale; late model plans in the previous locale are ignored. The previously appended English location sentence was removed. |
| **Provider reasoning isolation** | `src/LLMManager.js` | Reasoning-only responses no longer become visible or spoken `message.content`; existing `EmptyCompletionError` handles a missing final answer. |
| **Internal markup leak** | `src/features/chat/ReplyClean.js`, `src/main.js`, `src/behavior/boot.js` | The branch also contains AX16 shared `THOUGHT:` / ```motion``` cleaning, including the ActivityVoice posting seam. This was developed separately on the same branch and was inspected/reused rather than duplicated. |
| **Regression tests** | `tests/behavior/private-prepare.test.js`, `private-prompt-catalog.test.js`, `tests/llm-empty-completion.test.js`, `tests/reply-clean.test.js` | Tests assert opt-in soundtrack, localized setup and fallback plans, provider prompting, live locale switching, reasoning-only completion errors and removal of representative leaked model markup. |

The translated story pools are authored starter content, **not certified native-speaker editorial copy**. Do not claim local-language literary quality or every possible screen is production localized without the review below.

## 3. Validation completed in this work session

**Source fetch + JavaScript parse check:** 13 files parsed successfully using V8 `new Function` without running the application.  
**Pure-module smoke test:** 40 combinations (10 locales × 4 styles), all had a selected-locale plan with required fields. Selected wizard strings were nonempty in every locale.  
**Shared response cleaner smoke test:** `stripThought` returned `Certo, andiamo al lago.` from the supplied mixed English/Italian example, and `forDisplay` removed a fenced motion payload from `Ciao`.

**Not run:** Jest, format, `npm run validate`, browser walkthrough, real provider, real STT/TTS playback, real VR/phone hardware, CI. A syntax/smoke result is not a passing integration suite.

## 4. Exact next validation commands

Run on a checked-out working tree with project-approved Node version and dependencies:

```sh
npm ci
npx jest tests/behavior/private-prompt-catalog.test.js tests/behavior/private-prepare.test.js tests/llm-empty-completion.test.js tests/reply-clean.test.js --runInBand
npm run validate
node scripts/behavior-parity-baseline.mjs --check
```

Follow with the existing browser harness on desktop, narrow mobile and VR-mode emulation. Confirm the physical VR experience on a headset when available. Save actual outcomes and errors; fix regressions, do not weaken tests.

## 5. Important open issues (must not be called done)

1. **Mixed model language:** Localization of scripted Private beats is now deterministic, but a provider may ignore its requested output language or return English text inside generated JSON. Build real-provider Italian/Spanish/Japanese/English transcript tests with reviewer scoring and explicit locale quality gates.
2. **Not every internal prompt is localized:** `TogetherCapability.privateSystemPromptSuffix`, `PrivateExperienceProfile` and some general world/system prompts still contain English technical instructions. They are not the authored spoken fallback but should be moved to versioned localized resources where safe, without weakening consent or provider policy. Also localize metadata labels supplied by scene/world catalogs; a raw scene title may still be English.
3. **Private audio deduplication:** The old transcript has several identical `Playing` YouTube cards. Silent entry prevents the initial automatic track; it does **not prove** duplicate card publication is resolved. Trace `MediaIntent`, `MediaSession`, `PlayDirective`, `ConversationPublisher` and `SoundtrackStrip`, and assert a stable request ID with at-most-one card/player.
4. **Streaming speech leakage:** The streaming callback currently passes raw tokens to the streaming speech subsystem before the final display seam. Verify the phrase scheduler masks model reasoning, partial motion fences and directives at *every chunk boundary* before audio; add tests, and ensure sensitive metadata never reaches TTS.
5. **Unverified world claims:** The user's example says `siamo al lago` without proving renderer confirmation. Require event-correlated arrival and object narration, never infer travel from the assistant's words.
6. **Broader Private UX:** Style/persona quality, repeated greetings, generated text variety, quiet moments and choice timing require real-model testing; the catalog alone cannot fix a weak provider.
7. **Private release:** Existing adult age-eligibility, server authorization, jurisdictional compliance, privacy checks, and physical device QA remain release gates. This branch is not production-enabled by these changes.

## 6. Acceptance criteria for next iteration

- For each of the ten locales, all authored and generated visible Private lines, buttons and TTS agree with `AppLanguage.code`. A language switch during a session changes future replies without translating or replaying Private history.
- Silent Private entry makes **zero new media search/play** requests. Returning from a remembered prior session is also silent. An explicit opt-in selection initiates at most one playback and one card; End cancels late media requests.
- No `THOUGHT:`, `reasoning_content`, raw ```motion```, unclosed action tags, or JSON instruction fragments reach screen, Private transcript, persistence, streaming speech, or voice.
- The model cannot claim an unseen scene or completed action; verified runtime state must support such statements.
- Private privacy isolation, Stop/End access, behavior authorization and user-controlled level ladder remain unchanged.
- All targeted Jest and full `npm run validate` tests pass; real mobile/VR and provider tests provide independent evidence.

## 7. Follow-on code ownership

- App language: `src/AppLanguage.js` (the sole master selector).
- UI translations: `src/features/together/PrivateLocale.js`.
- Authored Private narration and planner rules: `src/features/together/PrivatePromptCatalog.js` and `PrivateBeats.js`.
- Private session authority and future beat refreshing: `TogetherCapability.js`.
- Music option/prefetch and reuse: `activities/playground.js` and `ui/TogetherPanel.js`.
- Provider final-content boundary: `src/LLMManager.js`.
- Display/motion sanitization: `src/features/chat/ReplyClean.js` and the existing main/ActivityVoice integration; do not create another competing output pipeline.

**Keep all follow-on work on `feat/living-worlds-spatial-storytelling`. Do not create a PR or merge history.**
