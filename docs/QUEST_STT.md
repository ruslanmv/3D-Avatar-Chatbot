# On-device speech recognition (Whisper) — Meta Quest and everywhere

Batch **ST** (plan: `docs/QUEST_STT_PLAN.md`). Speech is turned into text **on
the device** by OpenAI's Whisper, running in a Web Worker through
Transformers.js. Nothing is uploaded; there is no speech server and no paid API.

## Why the microphone "did nothing" on Quest

Three faults, all fixed or bypassed:

1. Meta Quest Browser has `webkitSpeechRecognition`, but **no service behind
   it**: it starts, shows the mic, and ends with no text. Desktop and Android
   Chrome work because their recognizer sends the audio to Google.
2. The Quest fallback recording was posted to `/api/stt`, **which no server
   serves** (404 every time). It is now used only for the OpenAI/Google
   providers a person configures with their own key.
3. `workers/whisper-worker.js` answered every recording with a fixed
   placeholder sentence. It now runs Whisper.

## Turning it on

Settings ▸ SPEECH-TO-TEXT ▸ STT PROVIDER ▸ **On-device Whisper (private · works
on Meta Quest)** ▸ SAVE. Off by default (the plan's beta decision); in Meta
Quest Browser, a listen that hears nothing says where this switch is.
`?localStt=1` forces it on in any browser for testing (`?localStt=0` off).

Below the select: download state with a progress bar, **Download now**,
**Remove downloaded model**, and a link to the speech check page. WASM MODEL
SIZE: **Tiny** (default, ~41 MB), **Base** (~77 MB, better Italian, about 2×
slower), Small (~250 MB, desktop only). The model downloads once and the
browser's Cache API keeps it.

It applies to all three listeners at once — the 2D mic button, the VR panel's
push-to-talk (hold the right trigger / Y / B) and the companion's hands-free
call — because each of them now constructs the class `NEXUS_STT` answers.

## How it works

| Piece                                 | Role                                                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `src/stt/SttRouter.js`                | Pure: browser recognizer, on-device, or "chosen but cannot run here" (never silently the browser's)       |
| `src/stt/LocalWhisperSTT.js`          | `WhisperRecognition` — the browser `SpeechRecognition` surface over Whisper; `NEXUS_STT` facade           |
| `src/stt/MicrophoneSession.js`        | One owner of the mic; a start can be taken back before the device opens; PCM via AudioWorklet             |
| `src/stt/pcm-capture-worklet.js`      | Raw samples off the main thread in ~43 ms blocks                                                          |
| `src/stt/SpeechAudio.js`              | Pure: mono, 48→16 kHz windowed-sinc resampling, level analysis, gate, endpointer, transcript guard        |
| `src/stt/WhisperModelManager.js`      | The worker's page side: one download for all callers, states, progress, per-request ids, timeouts         |
| `src/stt/WhisperProtocol.js`          | The messages both sides share                                                                             |
| `src/stt/QuestWhisperConfig.js`       | Pinned runtime (Transformers.js 3.8.1) and models (Hugging Face commit hashes, file SHA-256s)             |
| `workers/whisper-worker.js`           | Module worker: imports the runtime, builds the pipeline, warms it up, transcribes one request at a time   |
| `src/stt/SttSettings.js`              | The Settings section                                                                                      |
| `src/stt/QuestAudioDiagnostics.js`    | Judgements for the speech check page                                                                      |

Behaviour that differs from the browser's recognizer, on purpose:

- **No interim text.** Whisper writes the sentence after it ends; surfaces show
  "Transcribing…" at `onaudioend` instead of a fake live transcript.
- **No confidence.** `confidence` is `undefined`; callers show no percentage and
  the mic button's auto-send treats it as "no score", not 0.
- **Push-to-talk keeps everything until release.** The mic button stops after a
  pause; the hands-free call cuts sentences with the endpointer and stays open.
- **Half-duplex.** While the app is speaking, auto-stop and hands-free modes
  ignore the microphone, so her voice from the headset speakers is not
  transcribed into a new question.
- **Guards.** Before the model: too short, silent or no speech → never
  inferred. After: Whisper's non-speech tokens stripped, loops refused, phantom
  phrases ("Thank you.", "Grazie per la visione") refused only when the audio
  held little speech. A recording with nothing usable ends with `no-speech`.
- **Release before the mic opened records nothing.** Fixed in
  `MicrophoneSession`, `SpeechService.stopRecognition()` (a pending start is
  voided) and VR push-to-talk (`_pttHeld`). This was a bug for the browser
  recognizer too.
- **Language.** Transformers.js does not detect the language when none is
  given — it assumes English — so the app's language setting is always passed.

## Self-hosting (offline install, no third-party CDN)

Set before the page's scripts:

```js
window.NEXUS_STT_CONFIG = {
    runtimeUrl: '/vendor/transformers/transformers.min.js',
    wasmPaths: '/vendor/transformers/',
    localModelPath: '/models/', // models/onnx-community/whisper-tiny/…
};
```

With `localModelPath` set the worker disables remote model loading. The files
are the pinned ones in `QuestWhisperConfig.js` (model JSON listed in
`MODEL_JSON`, ONNX files with their SHA-256). Licences: Whisper weights and the
ONNX conversion MIT, Transformers.js Apache-2.0, ONNX Runtime Web MIT.

## Tests

Unit (jsdom, `tests/stt/`): resampling keeps pitch and filters aliasing; gate,
endpointer, transcript guard; protocol; pinned config; router; model manager
with a fake worker (one download, stale/cancelled results dropped, timeouts
terminate the worker); microphone session (one owner, closed-before-open,
refusals); the recognizer (push-to-talk, tap-to-talk, continuous with her voice
suppressed, abort, silence, phantoms, unavailable); SpeechService run for real
with a fake recognizer; the wiring in `main.js`, `CompanionMode.js`,
`VRChatIntegration.js` and `index.html`.

Real model, no headset — `npm run stt:real-model`
(`tools/stt/stt-real-model.mjs`): synthesizes English and Italian phrases with
the app's own Piper in the browser, transcribes them with the real pinned
Whisper in headless Chromium, and drives the real app through Chromium's fake
microphone (mic button → input field; VR push-to-talk through SpeechService;
release before the mic opened). Results on 2026-10-31, **this machine's CPU,
not a Quest**:

| Model | Load (cached run) | English (2 phrases) | Italian (synthetic voice) | Inference per utterance | Silence / noise |
| ----- | ----------------- | ------------------- | ------------------------- | ----------------------- | --------------- |
| Tiny  | 5.5–7.8 s         | WER 0–7%            | WER 29–57% (reported)     | ~2.0–2.3 s              | refused         |
| Base  | 8.4–10.6 s        | WER 0–7%            | WER 14–36% (reported)     | ~3.5–5.2 s              | refused         |

App path (Tiny, fake mic): mic button 0% WER; VR push-to-talk one result,
"Transcribing…" shown, no confidence; early release leaves nothing running.

Inference time is roughly constant per utterance, because Whisper always
encodes a 30-second window. English is gated (≤ 25% WER); Italian is reported
only, until a recorded human Italian fixture exists.

## Validate on a Meta Quest 3 (required before calling it ready)

1. Open `https://<site>/stt-check.html` in Quest Browser. Section 1: every ✔ row
   ticked (HTTPS, microphone API, Web Audio, Workers, WebAssembly).
2. Section 2: **Record 5 seconds**, speak, play it back. "Audio arrives with
   speech". If it says silence: Quick Settings ▸ microphone not muted.
3. Section 3: **Download & prepare** (Tiny). Note the time.
4. Section 4: hold, say an English sentence, release. Note the text and the
   timing line (inference ms, real-time factor). Repeat in Italian (try Base).
5. In the app: Settings ▸ STT PROVIDER ▸ On-device Whisper ▸ SAVE. Tap the mic,
   speak, wait: the text appears in the input (auto-send if enabled).
6. ENTER VR. Hold the right trigger off the panel, speak, release: the panel
   shows "Recording…", then "Transcribing…", then "Heard: …" and her reply. Watch
   for frame drops while it transcribes.
7. With "Natural voice on Meta Quest" on, check the reply is spoken by Piper and
   her mouth moves.
8. Tap and release the trigger instantly: nothing is recorded.
9. Repeat 4 with Wi-Fi off after the download (on-device speech works; the LLM
   reply needs the network).

Record: model load time, inference ms per utterance, accuracy in English and
Italian, any frame drops in VR. Until those exist, no latency or frame-rate
figure for the Quest is claimed anywhere.

## Not done yet

- **ST5 VAD model.** Hands-free uses the energy endpointer in `SpeechAudio`,
  not Silero VAD. It is adequate in a quiet room; a noisy one may cut or merge
  sentences.
- **Barge-in** (talking over her) — half-duplex only.
- **WebGPU** — WASM only; WebGPU on Quest is unmeasured.
- **Hosted copies of the model** — the default downloads from Hugging Face and
  jsDelivr at pinned versions; self-hosting is supported but not shipped.
- **Physical Quest validation** — the procedure above.
