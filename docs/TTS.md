# TTS Provider System

## Overview

The app supports pluggable text-to-speech engines via the **TTSProvider** system. The built-in Web Speech API remains the default. Alternative engines can be selected in Settings without any code changes to the existing speech pipeline.

## Engines

### Web Speech API (default)

The browser's built-in `window.speechSynthesis`. Zero configuration, works immediately.

| Platform | Voices | Quality |
| --- | --- | --- |
| Chrome (desktop) | 20+ including "Google US English" (female) | Medium-High |
| Edge (desktop) | 30+ including "Microsoft Zira" (female) | Medium-High |
| Safari | macOS system voices | Medium |
| Firefox | OS voices (no STT support) | Medium |
| Quest Browser | 1-2 Android TTS voices | Low |

**Limitation on Quest:** Only 1-2 generic voices are available. The `speechSynthesis` API can be unreliable in VR mode (silent failures, missing `onend` events).

### Piper WASM (offline, no API key)

Client-side neural TTS running entirely in the browser via WebAssembly. No server, no API key, no usage limits.

| Feature | Detail |
| --- | --- |
| Engine | [piper-tts-web](https://github.com/Poket-Jony/piper-tts-web) |
| Runtime | ONNX Runtime Web (WASM + SIMD) |
| Models | Downloaded from HuggingFace CDN on first use, cached by browser |
| Model size | ~60 MB (medium), ~80 MB (high) |
| Voices | 35 verified presets across 8 languages |
| License | MIT (Piper), Apache 2.0 (ONNX Runtime) |

#### Available Voices

The full catalog lives in `src/tts/PiperWasmTTSProvider.js`. The default pick per
language and gender — what the app actually selects when you switch the master
language — is:

| Language | Female | Male |
| --- | --- | --- |
| en-US | `en_US-hfc_female-medium` | `en_US-hfc_male-medium` |
| en-GB | `en_GB-alba-medium` | `en_GB-alan-medium` |
| es-ES | ⚠ none exist → `es_ES-davefx-medium` | `es_ES-davefx-medium` |
| it-IT | `it_IT-paola-medium` | ⚠ none exist → Paola |
| fr-FR | `fr_FR-siwis-medium` | `fr_FR-tom-medium` |
| de-DE | ⚠ none exist → `de_DE-thorsten-high` | `de_DE-thorsten-high` |
| pt-BR | ⚠ none exist → `pt_BR-faber-medium` | `pt_BR-faber-medium` |
| zh-CN | `zh_CN-huayan-medium` | ⚠ none exist → Huayan |
| ja-JP | ✖ no Piper models — use the built-in engine | ✖ |
| ko-KR | ✖ no Piper models — use the built-in engine | ✖ |

**For a female Spanish, German or Portuguese voice, use the built-in engine** —
the device voices (Google español, Mónica, Helena…) are female. Piper's official
catalog simply has none that this runtime can play, which is not a bug we can fix
in the catalog (see below).

#### Only 256-symbol models work — 16 catalog voices never could

`piper-tts-web` generates phoneme IDs with its own bundled (modern)
`piper_phonemize` WASM, passing only `espeak.voice` from the model config; the
model's own `phoneme_id_map` is never consulted. Models published for **piper
0.2.0** have a 130-symbol embedding table, so they receive out-of-range IDs, ONNX
throws (`OrtRun`), and `speak()` falls back to its English safety voice.

The effect is nasty because it is silent: the voice appears in the dropdown, gets
selected, downloads ~60 MB — and then speaks **English**. Sixteen such voices were
in the catalog, including both Spanish "fast" voices and the only Spanish female
candidate (`es_ES-mls_10246-low`). They have been removed. `num_symbols === 256`
is now asserted by `tests/piper-catalog-audit.mjs`, so none can return unnoticed.

Full voice catalog with audio samples: [rhasspy.github.io/piper-samples](https://rhasspy.github.io/piper-samples/)

#### Multi-speaker models — why some voices ignore the gender setting

`piper-tts-web` hardcodes `const speakerId = 0`, so for a **multi-speaker** model
it always synthesizes speaker 0 and the other speakers are unreachable. A gender
label on such a model therefore describes speaker 0 only. Seven catalog models are
multi-speaker, and two used to be labelled wrongly because of it:

| Model | Speakers | Speaker 0 is | Catalog says |
| --- | --- | --- | --- |
| `es_ES-sharvard-medium` | 2 (`{"M":0,"F":1}`) | the **male** speaker | male — was "female", the cause of "Spanish sounds male" |
| `fr_FR-upmc-medium` | 2 (`{"jessica":0,"pierre":1}`) | **Jessica**, female | female — was "male" |
| `en_US-arctic-medium` | 18 | `awb` (male) | male |
| `de_DE-thorsten_emotional-medium` | 8 (emotions) | `amused` (Thorsten) | male |
| `en_US-libritts_r-medium` | 904 | corpus ID `3922` | unknown |
| `de_DE-mls-medium` | 236 | corpus ID `2422` | unknown |
| `en_GB-aru-medium` | 12 | corpus ID `03` | unknown |

Models whose speaker 0 is an anonymous corpus ID are tagged `unknown` rather than
guessed, so "Prefer Female/Male" never promises what it can't deliver. Selection
prefers **single-speaker** models for that reason.

#### Verifying the voice matrix

Two complementary checks, because only one of them can be automated:

```bash
node tests/piper-catalog-audit.mjs      # catalog facts, no ears needed
```

verifies every catalog voice ID against the piper-tts-web runtime PATH_MAP (a
typo'd ID would 404 at playback), each model's own `.onnx.json` for
`num_speakers` and language code, and the `speaker_id_map` from
`rhasspy/piper-voices` to confirm who speaker 0 actually is. It also asserts that
the library still hardcodes `speakerId = 0`, so the reasoning above can't rot
silently. Exit code 1 on any defect; `--offline` skips the network checks.

`tests/tts-language-matrix.html` covers the rest: a 10 languages × (built-in,
Piper) × (female, male) grid where each cell speaks a **localized** sentence, so a
wrong-language voice is instantly audible. It shows the voice the app itself would
pick, using the same selection logic. Whether a voice truly *sounds* female is the
one thing no script can settle — run it on desktop and on the phone, since
built-in voices are supplied by the OS and differ per device.

#### Quest Performance

| Model Quality | Size | Quest 3 | Quest 2 |
| --- | --- | --- | --- |
| medium | ~60 MB | Near real-time | Slow |
| high | ~80 MB | Acceptable | Too slow |

Recommendation: use `medium` quality voices on Quest. (The `low`/`x_low` tier is
gone — every model in it was a piper 0.2.0 build that this runtime cannot play.)

## How to Switch Engines

1. Open **Settings**
2. Under the **Speech** section, find **TTS ENGINE**
3. Select **Piper (offline, no API key)**
4. The **PIPER VOICE** dropdown appears — pick a voice
5. Click **Save**

The Web Speech API voice controls (VOICE, VOICE PREFERENCE) are hidden when Piper is active, and restored when switching back.

## Architecture

```
Settings UI
  └── TTS ENGINE dropdown
         │
         ▼
  TTSProvider.js (factory)
  ├── "web-speech-api" → existing speakText() path (SpeechSynthesisUtterance)
  └── "piper-wasm"     → PiperWasmTTSProvider.js
                              │
                              ├── Lazy-loads piper-tts-web ESM from CDN
                              ├── Downloads ONNX model from HuggingFace (cached)
                              ├── Synthesizes PCM audio via WASM WebWorker
                              └── Plays via AudioContext + AudioBufferSourceNode
```

### Files

| File | Purpose |
| --- | --- |
| `src/TTSProvider.js` | Provider registry, engine switcher, `speak()`/`stop()`/`getVoices()` |
| `src/tts/PiperWasmTTSProvider.js` | Piper WASM integration, voice list, AudioContext playback |

### Integration Point

In `src/main.js`, the `speakText(text)` function checks the provider before the existing path:

```javascript
// Pluggable TTS engine path (additive)
if (window.TTSProvider && window.TTSProvider.isActive()) {
    window.TTSProvider.speak(text, { rate, pitch, onEnd, onError });
    return;
}

// Existing Web Speech API path (unchanged)
const utterance = new SpeechSynthesisUtterance(text);
// ...
```

The existing Web Speech API code is completely untouched.

## Adding a New Provider

To add another TTS engine (e.g., Azure, Google Cloud):

1. Create `src/tts/YourProvider.js`
2. Implement the provider interface:

```javascript
const YourProvider = {
    displayName: 'Your Provider Name',

    async init() {
        // Load SDK, authenticate, etc.
    },

    async speak(text, { rate, pitch, onEnd, onError }) {
        // Synthesize and play audio
        // Call onEnd() when done, onError(err) on failure
    },

    stop() {
        // Stop current playback
    },

    isAvailable() {
        // Return true if this provider can run in the current browser
        return true;
    },

    getVoices() {
        // Return array of { id, name, lang, gender }
        return [];
    },
};

// Register
window.TTSProvider.registerProvider('your-provider', YourProvider);
```

3. Add a `<script defer>` tag in `index.html` (after `TTSProvider.js`)
4. Add an `<option>` to the `#tts-engine` select

## Settings Storage

| Key | Storage | Default | Description |
| --- | --- | --- | --- |
| `tts_engine` | localStorage | `web-speech-api` | Active TTS engine ID |
| `piper_voice` | localStorage | `en_US-hfc_female-medium` | Selected Piper voice model |
| `speech_voice_pref` | localStorage | `female` | Gender preference: `any` \| `female` \| `male` |
| `app_lang` | localStorage | browser language | Master language; re-picks the Piper voice on change |

There is no speaker-index setting: `piper-tts-web` hardcodes `speakerId = 0`, so
multi-speaker models can only ever produce their first speaker (see above).

`main.js` publishes its live settings object as `window.SpeechSettings`. It is a
top-level `const` in a **classic script**, so it lives in the global *lexical*
environment and is not otherwise a property of `window` — every other script that
read `window.SpeechSettings` silently got `undefined`. Read that object (not just
localStorage) when you need the values `speakText()` and `pickBestVoice()` will
actually use.

### Gender preference is a preference, never a dead end

If the requested gender has no voice for the language, selection takes the other
gender rather than going silent or leaving the wrong language playing. Speaking
the right **language** always outranks the gender wish. The order is: requested
gender (single-speaker first for Piper) → requested gender (multi-speaker) →
other gender → anything for that language. This is why "Prefer Female" +
Português plays Faber, and "Prefer Male" + 中文 plays Huayan.

## Future Cloud Providers (Planned)

These require API keys but offer higher quality and lip-sync features:

| Provider | Free Tier | Key Feature | Reference |
| --- | --- | --- | --- |
| Azure TTS | 500K chars/mo | Viseme events for 3D avatar lip-sync (55 blend shapes @ 60fps) | [Azure Speech SDK](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/get-started-text-to-speech) |
| Google Cloud TTS | 1M chars/mo (WaveNet) | Highest free quota, natural voices | [Cloud TTS Docs](https://docs.cloud.google.com/text-to-speech/docs/basics) |
| Amazon Polly | 5M chars/mo (12 months) | Speech marks for lip-sync | [Polly JS SDK](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/polly-examples.html) |

### Related Projects

| Project | Description |
| --- | --- |
| [piper-tts-web](https://github.com/Poket-Jony/piper-tts-web) | Piper WASM engine (ONNX + WebGPU + WebWorker) |
| [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) | Alternative WASM TTS (VITS, Piper, Kokoro models) |
| [TalkingHead](https://github.com/met4citizen/TalkingHead) | 3D avatar lip-sync with Azure visemes + Three.js |
| [piper-tts-web-demo](https://github.com/clowerweb/piper-tts-web-demo) | 904-voice Piper browser demo |
