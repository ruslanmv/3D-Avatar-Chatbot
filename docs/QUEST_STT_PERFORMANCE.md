# Speech-to-text performance on Meta Quest (ST10–ST16)

On-device Whisper felt slow on a physical Quest 3, and nothing said why. Every
listener now measures where the time goes between **"I stopped talking"** and
**"the text is on screen"**, shows it, and exports a report you can paste into
Claude Code — without a cable or DevTools.

Measure first, diagnose second, optimize third. Nothing below is a Quest
measurement unless it says so; the numbers in "What this machine measured" are a
desktop CPU in a headless browser.

## What is measured

One trace per utterance, on every surface: the Settings microphone test
(`settings-mic-test`), `stt-check.html` (`stt-check`, `benchmark`), the main mic
button (`mic-button`), VR push-to-talk (`vr-ptt`), the VR panel's mic button
(`vr-panel`) and the companion (`companion`, `companion-ptt`).

| Metric                          | From → to                                                        | Notes                                                               |
| ------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Stop → transcript** (primary) | recording stopped → text displayed                               | Never includes the time spent speaking                              |
| Mic acquisition                 | mic requested → capture started                                  | First utterance of a run only                                       |
| First audio frame               | capture started → first samples                                  |                                                                     |
| Endpoint wait                   | the silence the endpointer waited for                            | Mic button / companion; reported apart, not in stop → transcript   |
| Audio analysis, preprocessing   | page side: gate, normalize                                       |                                                                     |
| Resampling                      | inside the worker                                                | Worker duration                                                     |
| Waiting for the model           | request → model ready                                            | Non-zero only when the model was not loaded yet ("cold")           |
| Model download / init / warm-up | inside the worker, at load                                       | Only for the run that loaded it                                     |
| Queue in the worker             | message received → work started                                  | Worker duration                                                     |
| Whisper inference               | the pipeline call                                                | Worker duration; encoder/decoder split is not exposed (not_measured) |
| Messaging                       | round trip − worker total                                        | Message delivery both ways                                          |
| Transcript processing / display | inference done → validated → on screen                           |                                                                     |
| Real-time factor                | inference ÷ audio length                                         |                                                                     |
| Tokens produced                 | the tokenizer's count of the transcript                          |                                                                     |
| Frames during transcription     | frame intervals while transcribing                               | XR session's frames in VR, the page's otherwise                     |
| Submit → AI reply → her voice   | chat message → reply → status indicator "speaking"               | Observed in the DOM, kept apart from STT                            |

Rules the code keeps: **one clock per number** (worker durations are measured in
the worker and sent back as numbers; no timestamp crosses between the two time
origins), **missing is `not_measured`, never 0**, **overlapping spans are never
summed** into the total, and **a threshold is a label, never an action** — no
classification cancels a running transcription.

## Thresholds

| Name                    | Default  | Meaning                                              |
| ----------------------- | -------- | ---------------------------------------------------- |
| `sttWarningMs`          | 3000 ms  | Stop → transcript above this is **Slow**             |
| `sttCriticalMs`         | 8000 ms  | Above this is **Very slow**                          |
| `firstAudioWarningMs`   | 2000 ms  | Reserved for the full-response metric                |
| `conversationWarningMs` | 12000 ms | Stop → her first audible word                        |

**Fast** ≤ 3 s, **Slow** ≤ 8 s, **Very slow** > 8 s, **Failed** on an error or a
real timeout, **Not measured** when the run never reached a transcript. These
are usability targets, not a promise of what a Quest can do. Change the warning
in Settings ▸ SPEECH-TO-TEXT ▸ MICROPHONE TEST ▸ _Performance details_ ▸ _Warn
when slower than_ (2/3/5/8 s), or in code with
`NEXUS_STT_PERF.setThresholds({ sttWarningMs: 5000 })` (stored in
`nexus_stt_perf_thresholds`). The 8 s recording limit of the test
(`MAX_TEST_MS`) is unrelated and unchanged.

## Where to see it

- **Settings ▸ SPEECH-TO-TEXT ▸ MICROPHONE TEST.** While transcribing: "⏳
  Transcribing… 2.1 s", then "⚠️ Transcription is taking longer than expected…"
  past the warning. After: one line ("2.5 s after you stopped · Fast"),
  _Performance details_ (measured stages, model, backend, warm/cold, likely
  bottleneck and suggestions, threshold), a report preview, **Copy diagnostic
  report**, and **Advanced speech test ↗**. Below it: **Last real use** — the
  app's own most recent run (mic button, VR, companion).
- **In the app.** Past the warning, the mic button's status reads "STILL
  TRANSCRIBING…" and the VR panel "Transcribing… taking longer than expected".
  The transcription keeps running.
- **`stt-check.html` ▸ 5 · Performance analysis.** Device overview, the last
  run's timeline, verdict, a history with min/median/p95 (p95 only from five
  warm runs), a **3-test benchmark** of your last recording (no new recording,
  no microphone; a first model load is reported separately; the decoding budget
  can be set to 128/64/32), and **Copy / Download JSON / Share**.

## The report (`schema_version` 1)

`src/stt/SttDiagnosticReport.js`. Sections `app`, `environment`, `stt`,
`conversation`, `diagnosis`, optional `history` and `benchmark`. It never holds
audio, transcript text (only `transcript_chars`, unless a caller explicitly opts
in), chat content, keys, tokens, auth headers, URL queries or credentials, IP
addresses or microphone device ids; every free-text string is scrubbed. The user
agent is included — the preview says so before you copy. Nothing is uploaded.

What the browser cannot tell is `not_exposed`: Horizon OS version, exact headset
model, CPU clock, temperature. You can type headset model, Horizon OS, Quest
Browser version and test environment on `stt-check.html`; the report keeps them
under `environment.manual` with `source: "user-entered"`.

## What this machine measured (2026-11-01 — desktop CPU, headless Chromium, NOT a Quest)

`npm run stt:real-model` (all phases pass). Whisper Tiny, warm:

| Run                                   | Stop → text | Inference | Notes                                  |
| ------------------------------------- | ----------- | --------- | -------------------------------------- |
| Settings test, 3 s fake mic           | 2.5–3.0 s   | 2.0–2.6 s | bottleneck: inference (dominant)       |
| Mic button (endpointed)               | 2.4–2.8 s   | —         | + 900 ms endpoint wait, reported apart |
| Benchmark, same recording ×3          | 2.0–2.6 s   | 1.9–2.7 s | 9 tokens each                          |

Decoding budget, language hint and model size, same phrases (inference per
utterance, three runs each):

| Model | Phrase (audio)        | max_new_tokens | Language | Inference      | Tokens |
| ----- | --------------------- | -------------- | -------- | -------------- | ------ |
| Tiny  | English (1.9 s)       | 128 / 64 / 32  | en       | 1.87–2.07 s    | 9      |
| Tiny  | English (1.9 s)       | 128            | (none)   | 1.95–2.03 s    | 9      |
| Tiny  | English (2.7 s)       | 128 / 32       | en       | 2.00–2.15 s    | 15     |
| Tiny  | Italian (3.2 s)       | 128 / 64       | it       | 2.00–2.46 s    | 16     |
| Base  | English / Italian     | 128            | en / it  | 3.59–4.52 s    | 9–16   |
| Tiny load | download 2.5 s, init 0.8 s, warm-up 2.1 s | | |                |        |
| Base load | download 3.3 s, init 1.1 s, warm-up 3.9 s | | |                |        |

What that says, on this machine: inference is **about the same for 1.9 s and
3.2 s of audio and for 9 or 16 tokens** — so the decoding budget is not the
lever (the default stays 128, which only stops runaway decodes), and an explicit
language changes accuracy, not speed. The time is a near-constant per
utterance, consistent with Whisper encoding a fixed 30-second window whatever
the input length. Base costs about twice as much.

**One optimization made from evidence:** the worker's resampler computed sin/cos
for every filter tap of every output sample — **418 ms** of a 2.5 s stop → text
for 4.1 s of 44.1 kHz audio. It now caches the kernel per fractional phase: the
same filter (within 6e-8 at 48 kHz, 4e-5 at 44.1 kHz; a test compares it to the
old one), 26 ms instead of 195 ms at 48 kHz. Stop → text in the benchmark went
from ~350 ms above inference to ~50 ms above it.

## Recommendations, ranked (expected benefit × risk) — to be confirmed on a Quest

1. **Collect the Quest numbers first** (procedure below). If inference dominates
   there too, the rest of this list is about inference.
2. **A model that does not pad to 30 s** for short utterances (e.g. Moonshine,
   variable-length, supported by Transformers.js; MIT). Largest expected gain for
   2–5 s commands; English-first, so Italian needs checking. Medium risk: a new
   model, accuracy to re-measure.
3. **Cross-origin isolation (COOP/COEP) for WASM threads.** ONNX Runtime runs
   single-threaded today (`wasm_threads: 1`, `cross_origin_isolated: false`).
   Threads could cut encoder time on a multi-core headset. High risk: every
   third-party script, model CDN, iframe and the WebXR path must be audited
   first.
4. **WebGPU backend** where Quest Browser offers it (`webgpu_available` in the
   report). Unknown gain on the XR2 Gen 2; must be measured, never assumed, and
   it competes with rendering.
5. **Stay on Tiny for speed**; Base is ~2× slower and only better for Italian.
6. Not recommended: lowering `max_new_tokens` (no measured gain for normal
   utterances; risks cutting long ones).

## Collecting the first report on a Meta Quest 3

No cable needed. Use the same phrase each time, e.g. _"What is the weather like
in Rome today?"_

**Test 1 — Settings.** Open the app ▸ ☰ ▸ Settings ▸ SPEECH-TO-TEXT. STT PROVIDER
▸ On-device Whisper; WASM MODEL SIZE ▸ Tiny; **⬇ Download model** and wait for
"✓ On this device". MICROPHONE TEST ▸ **Test microphone**, say the phrase,
**Stop**. Do it three times. Note the line ("… after you stopped · …"), open
_Performance details_: Whisper inference, Model already loaded, verdict.
**Copy diagnostic report** and paste it where you can send it.

**Test 2 — Advanced.** Open `https://<your-site>/stt-check.html` in Quest
Browser. Section 3: Download & prepare. Section 4: hold, say the phrase,
release — three times. Section 5: fill in Headset / Horizon OS (Settings ▸
System ▸ Software update shows it) / Quest Browser version; **Run 3-test
benchmark**; **Download JSON** (or Copy).

**Test 3 — Main mic button.** Close Settings, tap the mic, say the phrase,
wait. Reopen Settings: **Last real use (mic-button)** shows that run.

**Test 4 — Immersive VR.** ENTER VR, hold the right trigger, say the phrase,
release. Exit VR; Settings ▸ Last real use shows `vr-ptt`, and the report's
`xr_mode` is `immersive-vr` with frame statistics from the XR session. Compare
with Test 1 to see whether rendering slows inference.

**Test 5 — Cold and warm.** In `stt-check.html`, section 3 ▸ Clear downloaded
model, reload, then: Download & prepare (cold load), then three section-4 runs.
The history marks `warm`; the device overview shows the load split.

**Test 6 — Accuracy.** Repeat with an Italian phrase (STT LANGUAGE ▸ Italiano)
on Tiny and on Base. Note whether the words were right — do not trade accuracy
for speed blindly.

Send the reports (JSON) back. Optional: Quest developer mode + `adb` and
`chrome://inspect` on a PC give DevTools for the headset's browser
(`NEXUS_STT_PERF.history()` in the console), but the in-headset reports are
enough.

## Files

`src/stt/SttPerformance.js` (traces, metrics, classification, diagnosis,
history, frame sampling), `src/stt/SttDiagnosticReport.js` (the report),
`src/stt/QuestAudioDiagnostics.js` (environment), `src/stt/LocalWhisperSTT.js`
(`runTranscription`, per-utterance traces, the slow notice),
`src/stt/WhisperModelManager.js` (page timings), `workers/whisper-worker.js`
(worker timings), `src/stt/SttSettings.js` (the Settings block),
`stt-check.html` (section 5), `tools/stt/stt-real-model.mjs` (`perf` phase).
Tests: `tests/stt/stt-performance.test.js`,
`tests/stt/stt-diagnostic-report.test.js`, additions in
`whisper-model.test.js`, `stt-settings-mic-test.test.js`,
`speech-audio.test.js`.
