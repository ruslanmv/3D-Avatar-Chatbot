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
| Model size | 15-30 MB (low/medium quality) |
| Voices | 11 built-in presets across 7 languages |
| License | MIT (Piper), Apache 2.0 (ONNX Runtime) |

#### Available Voices

| Voice ID | Name | Language | Gender | Quality |
| --- | --- | --- | --- | --- |
| `en_US-lessac-medium` | Lessac | en-US | Female | Medium |
| `en_US-libritts_r-medium` | LibriTTS-R | en-US | Female | Medium |
| `en_US-amy-low` | Amy | en-US | Female | Low (fast) |
| `en_US-ryan-medium` | Ryan | en-US | Male | Medium |
| `en_US-arctic-medium` | Arctic | en-US | Male | Medium |
| `en_GB-alba-medium` | Alba | en-GB | Female | Medium |
| `es_ES-davefx-medium` | DaveFX | es-ES | Male | Medium |
| `fr_FR-upmc-medium` | UPMC | fr-FR | Male | Medium |
| `de_DE-thorsten-medium` | Thorsten | de-DE | Male | Medium |
| `it_IT-riccardo-x_low` | Riccardo | it-IT | Male | Low (fast) |
| `pt_BR-faber-medium` | Faber | pt-BR | Male | Medium |

Full voice catalog with audio samples: [rhasspy.github.io/piper-samples](https://rhasspy.github.io/piper-samples/)

#### Quest Performance

| Model Quality | Size | Quest 3 | Quest 2 |
| --- | --- | --- | --- |
| low | ~15 MB | Real-time | Near real-time |
| medium | ~30 MB | Near real-time | Slow |
| high | ~80 MB | Acceptable | Too slow |

Recommendation: Use `low` or `medium` quality voices on Quest.

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
| `piper_voice` | localStorage | `en_US-lessac-medium` | Selected Piper voice model |
| `piper_speaker` | localStorage | `0` | Speaker index (multi-speaker models) |

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
