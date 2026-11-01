# QUEST_STT_PLAN.md

## Quest-local Whisper STT and Piper TTS for 3D-Avatar-Chatbot

**Status:** ST0–ST4 and ST6 implemented, ST5 with an energy endpointer instead of
Silero VAD, ST7 automated parts done — see `docs/QUEST_STT.md`. Physical Quest
validation outstanding.  
**Target:** Meta Quest 3 Browser, WebXR VR/MR, desktop Chrome and mobile
browsers  
**Primary repository:** https://github.com/ruslanmv/3D-Avatar-Chatbot  
**Target development branch:** `claude/awesome-brown-khqcdj`, if still
available; verify before creating the implementation branch  
**Batch prefix:** `ST`  
**Primary objective:** Make microphone speech recognition work directly on Meta
Quest 3 without depending on browser vendor speech services or paid STT APIs.

> Section 8, _Repository notes_, was checked against the tree on 2026-10-31 and
> corrects or sharpens a few points below. Where the two disagree, section 8
> wins.

### 1. Executive decision

Implement real **multilingual Whisper Tiny** speech recognition using
Transformers.js in a Web Worker. Reuse the existing Piper WASM text-to-speech
implementation.

The initial product mode will be push-to-talk:

1. User presses the VR controller trigger or microphone button.
2. Browser captures audio from the Quest microphone.
3. User releases the trigger or stops recording.
4. The app processes the recorded audio locally.
5. Whisper converts the recording into text.
6. The final text enters the existing chatbot conversation pipeline exactly
   once.
7. The LLM generates a response through the existing configured provider.
8. Piper generates and plays speech locally, with the existing avatar lip-sync.

**No SonicAgent deployment or Hugging Face inference server is required for
STT/TTS in this mode.**

An online LLM can still be required for chatbot replies. Local STT/TTS is not
the same as a completely offline chatbot.

### 2. Constraints and non-goals

All new changes must be additive and independently reversible.

Preserve:

- Existing desktop and mobile speech behavior.
- Existing chatbot message history and provider routing.
- Existing avatar rendering, animation and lip-sync.
- Current VR controller push-to-talk interaction.
- Existing AR/CompanionMode conversation interface.
- Existing Piper WASM provider and voice-selection behavior.
- Existing OllaBridge and optional SonicAgent integrations.

Do not:

- Add paid STT or TTS APIs.
- Replace the existing avatar engine.
- Advertise Whisper as working before real inference passes.
- Treat recording audio as successful transcription.
- Silently send audio to remote services in local-only mode.
- Run Whisper inference on the main rendering thread.
- Claim instantaneous live transcripts from batch Whisper.
- Assume all Quest Browser versions expose identical capabilities.

### 3. Verified baseline

#### Existing STT paths

| Area                       | Existing implementation                                           | Problem                                                         |
| -------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------- |
| Main microphone            | `src/main.js`, browser SpeechRecognition                          | Dependent on browser recognizer availability                    |
| VR controller and VR panel | `src/gltf-viewer/VRChatIntegration.js` and `js/speech-service.js` | Uses Web Speech or server fallback; local Whisper is unfinished |
| Hands-free and AR          | `src/CompanionMode.js`                                            | Independently creates SpeechRecognition                         |
| VR server fallback         | `js/speech-service.js` → `POST /api/stt`                          | No matching endpoint identified in reviewed code                |
| WASM worker                | `workers/whisper-worker.js`                                       | Simulated model loading, no real inference                      |
| TTS                        | `src/tts/PiperWasmTTSProvider.js`                                 | Existing implementation; requires physical Quest validation     |

The new architecture must converge all three STT entry points on one
provider-agnostic interface.

#### Important implementation caveats

- The multilingual `Xenova/whisper-tiny` model is the starting candidate.
- Confirm its pinned revision, quantized ONNX files, runtime compatibility,
  actual download size and licence (see section 8: the weights are MIT).
- English-only `.en` models are not suitable for Italian.
- Whisper inference occurs after an utterance ends for the initial PTT
  implementation.
- Browser Web Speech can remain available in an explicitly selected compatible
  mode, but must not be silently used by private on-device mode.

---

## ST0 — Quest microphone and runtime diagnostics

**Goal:** Prove microphone capture and browser audio processing work before
implementing the recognition engine.

### Work

Extend `test-microphone.html` and create `src/stt/QuestAudioDiagnostics.js`.

Implement a diagnostic panel reporting:

- Browser and platform information without relying exclusively on user-agent
  detection.
- Secure-context status.
- `navigator.mediaDevices` availability.
- `getUserMedia` availability.
- Microphone permission request result.
- Audio track state and settings.
- Input audio level.
- `AudioContext` and `AudioWorklet` availability.
- `MediaRecorder` support and actual selected MIME type.
- Successful start, stop and playback of a five-second recording.
- `WebAssembly`, Web Worker and optional WebGPU availability.
- XR session state where available.

Request microphone permission from a user action, preferably before entering
immersive mode, then verify behavior during XR.

Do not treat a successful permission prompt as proof that audio samples are
arriving.

### Acceptance

- Quest 3 records actual audible audio in its 2D Browser.
- Microphone capture can be started and stopped in immersive VR where the
  browser supports it.
- Permission denial and audio-device failures produce understandable messages.
- All media tracks and audio resources are released when recording ends.

**Merge gate:** Capture proven before Whisper integration.

---

## ST1 — Implement the actual on-device Whisper engine

**Goal:** Replace the placeholder worker with a functioning local inference
engine.

### New and changed files

```text
workers/whisper-worker.js            MODIFY
src/stt/SpeechAudio.js               NEW
src/stt/WhisperModelManager.js       NEW
src/stt/WhisperProtocol.js           NEW
src/stt/QuestWhisperConfig.js        NEW
tests/stt/speech-audio.test.js       NEW
tests/stt/whisper-protocol.test.js   NEW
tests/stt/whisper-worker.test.js     NEW
```

### Runtime selection

Start with a pinned version of `@huggingface/transformers` and a compatible
multilingual Whisper Tiny ONNX variant.

Use:

- WASM on CPU for the first supported path.
- Quantized model weights where verified.
- A dedicated module Web Worker.
- A single loaded model instance reused across utterances.
- One active inference operation initially.

Evaluate WebGPU later as an optional acceleration strategy, only after
confirming the necessary features and actual performance on Quest Browser.

### Worker implementation

Replace simulated model loading with an actual Transformers.js ASR pipeline.

A conceptual worker initialization is:

```javascript
import { pipeline, env } from '@huggingface/transformers';

// Production assets must be version-pinned and locally hosted.
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = '/models/';
env.backends.onnx.wasm.wasmPaths = '/assets/onnx/';

const recognizer = await pipeline('automatic-speech-recognition', 'whisper-tiny', { device: 'wasm' });
```

This is an architectural example, not drop-in code. The developer must match the
exact model directory structure, model filenames, quantization options and
library version. (There is no bundler here: the bare specifier above must become
a path to a pinned file — see section 8.)

The worker must implement a typed message protocol.

**Client → worker**

```text
initialize
load-model
transcribe
cancel
dispose
```

**Worker → client**

```text
model-progress
model-ready
model-error
transcription-started
transcription-complete
transcription-error
transcription-cancelled
```

Each transcription request needs a unique `requestId`.

The worker must ignore stale requests or return a cancellation result when
supported. If inference cannot be interrupted within the runtime, use bounded
work and terminate/recreate the worker when necessary.

Never return a placeholder string.

### Model management

`WhisperModelManager.js` must:

- Track `not-installed`, `downloading`, `loading`, `ready` and `error`.
- Provide real download progress.
- Deduplicate concurrent model loading.
- Reuse the model after first load.
- Detect unsupported backends.
- Limit simultaneous inference and memory use.
- Support deliberate model unloading.
- Support model-version upgrades without mismatched cache files.

### Audio preprocessing

`SpeechAudio.js` must expose testable pure functions for:

- Stereo-to-mono mixing.
- Sample-rate conversion to 16 kHz.
- Peak amplitude.
- RMS loudness.
- Recording duration.
- Silence detection.
- Clipping detection.
- Invalid sample and NaN rejection.
- Basic input normalization where appropriate.

Prefer an appropriate audio resampling algorithm. Do not assume that merely
changing the audio buffer's declared sample rate resamples its contents.

### Whisper hallucination protection

Whisper can generate text from silence or background noise.

Implement:

1. Minimum recording duration.
2. Minimum energy and/or speech-activity checks.
3. Empty-transcript detection.
4. Optional model silence indicators where available.
5. Repeated hallucination-pattern monitoring.
6. Explicit handling for very short utterances.

A known-phantom-phrase list may be used as a secondary signal, but must **not
automatically reject legitimate sentences such as “Thank you.”**

### Acceptance

- A real recorded English sentence produces recognizable text.
- A real Italian sentence produces recognizable text.
- Silence does not cause a chatbot message.
- Loading progress reflects actual network or local asset loading.
- Inference does not run on the XR rendering thread.
- No paid or proprietary STT API request is generated.

---

## ST2 — One shared speech recognition controller

**Goal:** Build a provider-agnostic STT interface that every application mode
can reuse.

### New files

```text
src/stt/LocalWhisperSTT.js
src/stt/SttRouter.js
src/stt/MicrophoneSession.js
src/stt/SttEvents.js
src/stt/SttSettings.js
tests/stt/stt-router.test.js
tests/stt/microphone-session.test.js
```

### Interface

Implement a stable interface equivalent to:

```javascript
stt.initialize(options);
stt.start(options);
stt.stop();
stt.cancel();
stt.status();
stt.dispose();
stt.on(event, callback);
```

The actual method signatures should be selected to preserve existing
`SpeechService` callbacks and integration conventions.

Supported events:

```text
mic-open
mic-closed
state
recording-started
recording-stopped
transcription-started
transcript-final
error
```

Add `transcript-interim` only for providers that genuinely support it.

### State machine

```text
idle
  |
  v
requesting-permission
  |
  v
recording
  |
  v
transcribing
  |
  v
final-transcript
  |
  v
idle
```

Additional terminal or recoverable states:

```text
model-loading
cancelled
permission-denied
device-unavailable
backend-error
```

The app must not display “Listening” while Whisper is transcribing an
already-finished recording.

### One microphone owner

`MicrophoneSession.js` owns the active audio stream.

It prevents:

- Multiple overlapping microphone recordings.
- Two recognition engines listening simultaneously.
- A late microphone permission result starting recording after PTT release.
- Device streams remaining open after cancellation.
- Duplicate final transcript submissions.

Use generation IDs or cancellation tokens for async lifecycle operations.

### Router policy

Initial supported modes:

| Mode            | Provider                                                        |
| --------------- | --------------------------------------------------------------- |
| `webspeech`     | Existing browser recognizer, explicit/default where appropriate |
| `local-whisper` | Whisper Tiny inside Quest/browser                               |
| `sonicagent`    | Optional future server provider                                 |
| `off`           | Text input only                                                 |

Do not treat the presence of `SpeechRecognition` as proof that it works on
Quest.

Provide `?localStt=1` as a developer override to force local Whisper in desktop
testing.

Do not automatically fall back from `local-whisper` to Google/OpenAI APIs, or to
potentially cloud-backed browser recognition.

### Acceptance

- Every consumer can use the same STT interface.
- Only one microphone session exists at a time.
- A final utterance produces at most one canonical chat turn.
- Existing desktop and mobile behavior is unchanged unless the user changes
  mode.

---

## ST3 — Meta Quest VR push-to-talk

**Goal:** Deliver the first usable Quest voice conversation.

### Main files

```text
js/speech-service.js
src/gltf-viewer/VRChatIntegration.js
```

### Required behavior

1. Enter VR.
2. Press the push-to-talk controller button.
3. Acquire or reuse microphone capture as appropriate.
4. Start audio recording.
5. Display “Recording…”.
6. Release the controller.
7. Stop recording.
8. Display “Transcribing…”.
9. Send the captured audio to local Whisper.
10. Display the final text.
11. Forward it through the existing `handleUserMessage` path once.
12. Display or play the avatar response.

### Critical integration changes

Replace the unconditional server upload to `/api/stt` in local mode with the new
local provider.

Keep server transcription available only when the user explicitly selects and
configures a supported backend.

Fix the PTT asynchronous race:

- Trigger pressed → permission requested.
- Trigger released before permission completes.
- Permission resolves later.
- Recording must **not** start.

Handle XR session end, headset suspension, audio track ending, microphone mute,
and controller disconnection.

Avoid confidence percentages unless the recognition model returns a meaningful
calibrated measure.

### Acceptance

A real Quest 3 user can press a controller button, say an English or Italian
phrase, release the button, see the transcript, and receive one chatbot reply.

---

## ST4 — Main 2D microphone button

**Goal:** Make the Quest's normal browser page use exactly the same local
Whisper engine.

### Files

```text
src/main.js
js/speech-service.js
src/stt/SttRouter.js
```

### Work

Replace direct browser-recognizer ownership in the main microphone flow with the
shared STT router.

Preserve:

- Existing microphone button appearance.
- Existing input-field population.
- Existing auto-send preference.
- Existing transcript feedback.
- Existing status notifications.
- Existing desktop/mobile behavior.

On Quest, when `local-whisper` is selected, the main button records through
`MicrophoneSession` and transcribes through the same engine used by VR.

### Acceptance

The same spoken phrase is recognized through the 2D mic button and VR controller
without separate Whisper implementations.

---

## ST5 — Hands-free and AR conversation

**Goal:** Enable hands-free speaking without depending on browser
SpeechRecognition.

### Files

```text
src/CompanionMode.js
src/gltf-viewer/ARConversation.js
src/behavior/adapters/VoiceAdapter.js
src/stt/LocalVAD.js
src/stt/ConversationTurnController.js
```

### Speech activity detection

Integrate a local speech activity detector such as Silero VAD, with a pinned
compatible ONNX runtime and model.

It should:

- Detect when the user starts speaking.
- Detect when the user stops speaking.
- Retain short pre-roll audio.
- Wait for configurable end-of-speech silence.
- Produce bounded utterance segments.
- Send completed segments to Whisper.
- Reject silence without invoking the chatbot.

Prefer an established browser VAD adapter. Do not duplicate its model inference
implementation unnecessarily.

### Conversation orchestration

Hands-free mode must distinguish:

```text
listening
user-speaking
transcribing
waiting-for-LLM
avatar-speaking
listening-again
```

Initially use half-duplex conversation:

- Pause or suppress microphone turn detection during avatar speech.
- Resume listening when the avatar finishes.
- Add proper barge-in only after echo and interruption tests.

Retain `CompanionMode`'s public conversation events so existing AR code remains
compatible.

Update `VoiceAdapter.js` so it observes provider-agnostic events rather than
rejecting environments without native browser SpeechRecognition.

### Acceptance

A user can speak without holding the controller, finish a sentence, and receive
one answer. The avatar's own voice must not repeatedly trigger new questions.

---

## ST6 — Quest voice settings and offline assets

**Goal:** Make the feature understandable and controllable.

### Settings

Add a “Speech recognition” section with:

- Browser recognition.
- Local Whisper Tiny — experimental.
- SonicAgent/OllaBridge — when configured.
- Off — type only.

Also expose:

- English, Italian, or automatic language detection.
- Whisper model availability.
- Real download progress.
- Download/preload model action.
- Clear model cache action.
- Microphone test.
- On-device privacy indicator.
- Current recording/transcription status.
- Useful error messages.

### Recommended default

**Initial beta:** Local Whisper is opt-in on Quest.

**After successful Quest testing:** Make it the preferred default for
known-compatible Quest Browser versions.

Do not enable the feature solely from a user-agent string without runtime
validation.

### Offline assets

Pin and host required files under your application's origin:

```text
models/whisper-tiny/
assets/onnx/
workers/
```

Include all required tokenizer, configuration, ONNX, WASM and JavaScript runtime
files.

Configure Transformers.js to use the correct local asset paths and to disallow
remote model loading in strict local mode.

Provide application-shell and asset caching where required for genuine offline
operation.

`navigator.storage.persist()` can be requested, but persistence is not
guaranteed. Handle browser cache eviction and storage quotas.

### Acceptance

After assets have been downloaded and cached, transcription and Piper synthesis
work without requesting remote STT/TTS inference.

A fully offline chatbot experience is not claimed unless the website, avatar
assets and LLM are also available offline.

---

## ST7 — Performance, correctness and Quest validation

**Goal:** Establish measured compatibility rather than assuming the headset can
run the models smoothly.

### Automated unit tests

Test:

- Audio channel conversion.
- Resampling.
- RMS and silence detection.
- Empty and corrupt recordings.
- Model-loading failure.
- Worker error reporting.
- Request IDs and cancellation.
- Microphone ownership.
- Async PTT release before permission completion.
- STT provider selection.
- No unauthorized cloud fallback.
- Exactly-once transcript submission.
- English and Italian language selection.
- State transition correctness.
- Piper provider regression.

### Real-model browser tests

Use Playwright/Chromium with a deterministic prerecorded audio fixture, where
the test environment permits.

Test genuine browser-local Whisper inference with:

- An English spoken phrase.
- An Italian spoken phrase.
- Silence.
- Background noise.

Use fake microphone input for capture-path testing where supported. A separate
real-model test should feed known PCM samples directly to the worker so decoding
failures and inference failures can be isolated.

Do not replace real-model tests with worker mocks.

### WebXR emulation

Use the repository's existing VR testing infrastructure to simulate:

- Entering XR.
- Controller PTT press/release.
- Transcript delivery.
- Interrupted recording.
- Session exit during transcription.
- No duplicate chatbot messages.

### Physical Meta Quest 3 matrix

| Scenario                            | Test                                                   |
| ----------------------------------- | ------------------------------------------------------ |
| Quest Browser 2D                    | Microphone + Whisper + Piper                           |
| Quest WebXR VR                      | PTT + transcription + avatar response                  |
| Quest MR / passthrough              | Local STT + conversation + rendering                   |
| Quest Browser after sleep           | Microphone and model recovery                          |
| Quest Browser offline after preload | Local speech inference without network                 |
| English speech                      | Real-world accuracy and response time                  |
| Italian speech                      | Real-world accuracy and response time                  |
| Long conversation                   | 30 turns, memory and resource stability                |
| Microphone denied/muted             | Correct error and recovery                             |
| Weak network                        | Local voice still functions after assets are available |

### Measurements

Collect:

- Initial model download size and duration.
- Model initialization duration.
- Peak and steady memory consumption where measurable.
- STT inference time.
- Audio duration.
- Real-time factor (inference seconds / recorded audio seconds).
- Piper first-audio latency.
- XR frame timing and dropped frames.
- CPU/device thermal behavior where observable.
- Failure and recovery counts.

Test at the actual refresh rate selected by the browser and headset.

Compare against the same 3D scene with speech inference disabled.

Do not publish a latency or frame-rate guarantee until physical Quest data
exists.

### Release gates

- No placeholder transcripts.
- No paid speech calls in local mode.
- No duplicated chatbot turns.
- No unconsented microphone upload.
- English and Italian real-model tests pass agreed accuracy criteria.
- No critical WebXR lifecycle regression.
- Acceptable headset performance established through measurement.
- Failure leaves text chat usable.

---

## ST8 — Optional optimizations and remote fallback

This phase is not required for the initial Quest-local release.

Possible improvements:

1. Whisper Base model selection if Quest benchmarks support it.
2. WebGPU acceleration where verified.
3. More efficient audio chunking or VAD endpointing.
4. Faster model startup and cache warming.
5. Better echo handling.
6. Genuine partial transcription when supported and accurate.
7. SonicAgent remote fallback through OllaBridge Cloud.
8. Backend selection based on measured performance, always respecting privacy
   settings.

Never force remote inference simply because local STT is slower.

A user-selected local-only mode must remain local-only.

---

## 4. Proposed file structure

```text
3D-Avatar-Chatbot/
├── docs/
│   └── QUEST_STT_PLAN.md
├── workers/
│   └── whisper-worker.js                 MODIFY
├── src/
│   ├── stt/
│   │   ├── SpeechAudio.js                NEW
│   │   ├── WhisperProtocol.js            NEW
│   │   ├── WhisperModelManager.js        NEW
│   │   ├── QuestWhisperConfig.js         NEW
│   │   ├── LocalWhisperSTT.js            NEW
│   │   ├── SttRouter.js                  NEW
│   │   ├── SttEvents.js                  NEW
│   │   ├── SttSettings.js                NEW
│   │   ├── MicrophoneSession.js          NEW
│   │   ├── QuestAudioDiagnostics.js      NEW
│   │   ├── LocalVAD.js                   LATER
│   │   └── ConversationTurnController.js LATER
│   ├── main.js                           MODIFY
│   ├── CompanionMode.js                  MODIFY
│   ├── gltf-viewer/
│   │   ├── VRChatIntegration.js          MODIFY
│   │   └── ARConversation.js             IF NEEDED
│   ├── behavior/adapters/
│   │   └── VoiceAdapter.js               MODIFY
│   └── tts/
│       ├── PiperWasmTTSProvider.js       TEST/HARDEN
│       └── QuestVoice.js                 TEST/HARDEN
├── js/
│   └── speech-service.js                 MODIFY
├── models/
│   └── whisper-tiny/                     PINNED ASSETS
├── assets/
│   └── onnx/                             PINNED RUNTIME
├── tests/
│   └── stt/                              NEW TESTS
├── test-stt.html                         EXTEND
└── test-microphone.html                  EXTEND
```

Check the repository's module loading and static deployment structure before
adding imports. Its existing build command does not bundle the application, so
the implementation must explicitly provide a compatible way to package the
Transformers.js worker and runtime files.

Avoid introducing a broad new frontend build system unless necessary.

---

## 5. Suggested pull-request breakdown

| PR       | Contents                                      | Depends on               |
| -------- | --------------------------------------------- | ------------------------ |
| PR-ST0   | Mic diagnostics + baseline tests              | None                     |
| PR-ST1   | Real Whisper worker + audio preprocessing     | ST0                      |
| PR-ST2   | Shared STT router + microphone ownership      | ST1                      |
| PR-ST3   | Quest VR push-to-talk integration             | ST2                      |
| PR-ST4   | Main 2D microphone integration                | ST2                      |
| PR-ST5   | Hands-free VAD + CompanionMode/AR             | ST2–ST4                  |
| PR-ST6   | Settings + model/offline asset management     | ST1–ST4                  |
| PR-ST7   | Performance tests + headset validation        | All release-critical PRs |
| PR-ST8   | Optional optimizations and SonicAgent support | Stable local release     |

Use a feature branch for each PR, with the target branch verified before
editing. Follow the repository's `CLAUDE.md` and test conventions.

Each PR must include:

- Specific files changed.
- Unit and regression tests.
- Honest manual test status.
- No fake inference success.
- Browser/Quest compatibility notes.
- Rollback behavior.
- Confirmation that existing chat and TTS remain operational.

---

## 6. Recommended implementation priority

The fastest path to a useful Quest prototype is:

**First milestone — ST0 + ST1**

Prove actual microphone capture, real Whisper model loading and transcription in
Quest Browser 2D.

**Second milestone — ST2 + ST3**

Integrate the shared STT controller with VR push-to-talk. This is the first
complete Quest voice experience.

**Third milestone — ST4 + ST6**

Enable the normal microphone button and settings, model caching and selected
language.

**Fourth milestone — Piper validation + ST7**

Confirm local speech playback, lip-sync and frame performance.

**Fifth milestone — ST5**

Add full hands-free/AR conversation with VAD and turn management.

**Optional milestone — ST8**

Improve accuracy, acceleration and SonicAgent fallback.

---

## 7. Final definition of success

A user wearing Meta Quest 3 can:

1. Open the 3D Avatar Chatbot in Quest Browser.
2. Enter VR or supported mixed reality mode.
3. Grant microphone access.
4. Press the controller's push-to-talk button.
5. Speak a sentence in English or Italian.
6. Release the button.
7. See a real transcript produced by Whisper **on the Quest itself**.
8. Receive an AI response from the configured LLM.
9. Hear the response synthesized by Piper on the Quest.
10. See the avatar speak with its existing lip-sync and animation.
11. Repeat the interaction without duplicated messages, media leaks, or
    unacceptable VR performance problems.

**Cost objective:** No per-minute STT or TTS API charges. Any separate LLM and
website hosting costs remain outside this guarantee.

**Most important release criterion:** Demonstrate the complete microphone → real
Whisper → canonical chat → Piper → avatar flow on a physical Quest 3 before
declaring Quest-local voice ready.

---

## 8. Repository notes (checked against the tree, 2026-10-31)

Facts the implementation must start from. They correct or sharpen the plan
above where it was written without the code in hand.

**Why voice input fails on Quest today — three separate faults.**

1. Quest Browser exposes `webkitSpeechRecognition`, but there is no speech
   service behind it: it starts, shows the mic, and ends with no transcript.
   Desktop and Android Chrome work because their recognizer streams audio to
   Google's service. All three recognizers in this app use it: the main mic
   (`src/main.js` `initSpeechRecognition`, ~line 4669), CompanionMode
   (`src/CompanionMode.js` ~line 1285, also AR) and the VR panel
   (`js/speech-service.js` `initializeSpeechRecognition`, ~line 88).
2. The Quest fallback, `startVRFallbackRecording` in `js/speech-service.js`,
   records with `MediaRecorder` and POSTs to `/api/stt` (~line 1036). **No
   route serves `/api/stt`** — not `nexus-proxy/server.js`, not anything under
   `api/` (the Vercel functions). Every upload is a 404.
3. `workers/whisper-worker.js` returns the literal string
   `'[WASM Whisper not yet implemented - placeholder transcript]'`. It is
   reached only through `startWASMWhisper` (provider `wasm`), never by default —
   but ST1 must make sure no path can post that string as a user message.

**Licences** (Apache-2.0 or compatible, provenance recorded where the asset
lands — CLAUDE.md). OpenAI's Whisper weights, and the `Xenova/whisper-tiny` ONNX
conversion of them, are **MIT**, not Apache-2.0; Transformers.js is Apache-2.0;
onnxruntime-web is MIT; Silero VAD is MIT. All compatible. Write a
`PROVENANCE.md` beside `models/whisper-tiny/` with the model id, its pinned
revision and the file hashes. `models/` does not exist yet.

**No build step.** A bare `import … from '@huggingface/transformers'` will not
resolve: nothing bundles. The worker must be a module worker
(`new Worker(url, { type: 'module' })`) importing a pinned file by path — either
a pinned jsDelivr URL (as Piper's `onnxruntime-web@1.18.0` already is, via the
import map in `index.html`) or a vendored copy under `vendor/` that is never
edited. Import maps do not apply inside workers, so the worker names its URL
itself.

**Module convention for `src/stt/`.** IIFE with the dual export
(`module.exports` + `window.NEXUS_*`) so Jest can `require()` it — no top-level
`import`/`export`. Loaded by `<script>` tags placed after every line the parity
harness has frozen (as the Quest voice tags are), not from `boot.js`; check with
`node scripts/behavior-parity-baseline.mjs --check`. Settings UI drawn from JS,
like `src/tts/QuestVoiceSettings.js`, for the same reason.

**Threads and memory.** The site is not `crossOriginIsolated`, so ONNX Runtime
WASM runs single-threaded (the Q7 finding behind Piper's `env.wasm.proxy`).
Whisper in its own worker keeps it off the render thread, but on the XR2 Gen 2
it still competes with rendering for CPU — ST7 must measure frame time during
inference. Piper (onnxruntime-web 1.18) and Transformers.js (which brings its
own ORT) will load two ORT WASM copies; measure memory with both loaded.

**Existing contracts to keep.**

- VR2's push-to-talk (`src/gltf-viewer/TriggerTalk.js`: hold right trigger / Y /
  B, release to send) is the ST3 front end; it already calls
  `onPushToTalkStart`/`onPushToTalkEnd`. ST3 only changes what happens after
  release.
- CompanionMode's public conversation API (AR2): `startConversation()` →
  `{ ok, reason, message }`, `stopConversation()`, `conversationStatus()` →
  `{ live, state, micReady, muted }`, and the `companion-conversation` event
  (`state`, `mic-open`, `error`). AR reads only these; ST5 must keep them.
  `micReady` means the browser really opened the mic.
- `src/behavior/adapters/VoiceAdapter.js` builds no recognizer; it chains onto
  `speechService.recognition`'s `onspeechstart`/`onspeechend` and declares
  itself `unavailable` when `isRecognitionSupported === false`. ST2 must either
  keep publishing those hooks or give it equivalent provider-agnostic events.
- `ConversationReset`: a new store holding transcripts or audio must be added to
  its `KEYS`, and a reply that outlives CLEAR is dropped by the epoch check — a
  Whisper result arriving after CLEAR must be dropped the same way.
- The Quest voice switch (`src/tts/QuestVoice.js`, `nexus_quest_voice`) is the
  model for an opt-in Quest-only switch: pure decisions, "off means unchanged",
  and `?questVoice=1` to test from a desk — `?localStt=1` should behave the
  same.

**Test files that exist.** `test-stt.html` and `test-microphone.html` are at the
repository root. The emulated-headset harness from XL7
(`tools/vr/xr-entry-scenarios.mjs`, IWER in headless Chromium) is the base for
the ST7 WebXR scenarios; Chromium's
`--use-fake-device-for-media-stream --use-file-for-fake-audio-capture=<wav>`
feeds a recorded phrase through the real capture path.

**Process.** Work lands on `claude/awesome-brown-khqcdj` unless the owner names
another branch; pull requests are opened only when the owner asks. Batch prefix
`ST` is unused so far. The gate is `npm run validate`, which must stay exit 0.
