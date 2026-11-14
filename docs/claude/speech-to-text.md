<!-- Moved verbatim from CLAUDE.md on 2026-11-08 so sessions load it only when working on this feature. Keep it accurate: if something here is wrong, fix it in the same change. -->

# On-device speech-to-text (ST)

Meta Quest Browser has `webkitSpeechRecognition` with no service behind it, so
every listener heard nothing there. **STT PROVIDER ▸ On-device Whisper** (the
old "WASM Whisper" option, `stt_config.provider === 'wasm'`; `?localStt=1`
forces it) runs Whisper in `workers/whisper-worker.js` through Transformers.js.
Off by default. `docs/QUEST_STT.md` has the design, results and the Quest
procedure.

- **One switch, three listeners.** `NEXUS_STT.recognitionClass()` answers the
  class to construct: `WhisperRecognition` (the browser recognizer's surface
  over Whisper) or the browser's own. `main.js`'s mic button
  (`micRecognizerClass`), `SpeechService._recognitionClass` (VR panel and
  push-to-talk) and `CompanionMode._SR()` all ask it, so their endpointing and
  UI are unchanged. Construct recognizers only through these.
- **On-device chosen but impossible is an error, never the browser's
  recognizer** (`SttRouter` `unavailable`), and `startSTT` never falls through
  from `wasm` to a cloud provider.
- **The STT choice applies on change, not on SAVE (ST8).** A Quest user who
  chose On-device Whisper and closed Settings with ✕ stayed on the browser's
  recognizer and heard nothing. `SttSettings` writes provider, model size,
  language and microphone at once, and draws the section's MICROPHONE TEST (real
  input meter; "No sound" vs "no words recognized" vs "recognized"). ST9: its
  Web Speech test runs the recognizer exactly as the mic button does and opens a
  meter capture only on desktop (`browserMeterSafe`) — on a phone a second
  capture took the audio and the recognizer heard nothing.
- **No interim text, no confidence.** Surfaces show "Transcribing…" at
  `onaudioend` (SpeechService passes `onTranscribing`); `confidence` is
  `undefined` → `null` to callers, which show no percentage and treat it as "no
  score" for auto-send.
- **A release before the microphone opened records nothing** — in
  `MicrophoneSession` (lease closed before open stops the stream on arrival),
  `SpeechService.stopRecognition()` (`_startSeq` voids a pending start) and VR
  push-to-talk (`_pttHeld`).
- **Pinned**: Transformers.js 3.8.1 and each model's Hugging Face commit and
  file SHA-256 in `QuestWhisperConfig.js`; a site can self-host via
  `NEXUS_STT_CONFIG`. Transformers.js assumes English when no language is given,
  so the app's language is always passed.
- **Every utterance is timed (ST10–ST16, `docs/QUEST_STT_PERFORMANCE.md`).**
  `SttPerformance` traces one utterance per surface (`perfSurface` on the
  recognizer: `mic-button`, `vr-ptt`, `vr-panel`, `companion`, …); the primary
  number is recording stopped → text displayed, never the time spent speaking.
  Worker numbers are durations measured in the worker (two clocks, two time
  origins — never subtract across them); a stage that did not happen is `null` /
  `not_measured`, never 0; a threshold (`sttWarningMs` 3000) is a label and
  never cancels. `SttDiagnosticReport` builds the schema-1 report: no audio, no
  transcript text, scrubbed strings. Frames are sampled only inside a trace.
  `runTranscription` in `LocalWhisperSTT` is the one instrumented gate → worker
  → judge path — keep new transcription callers on it.
- **Auto runs Moonshine for English (ST17).** The first Quest 3 report: Whisper
  Tiny 8.3 s inference for 4.1 s of speech (RTF 2.0, one WASM thread, three
  cores) — the fixed 30 s encoder pass. `QuestWhisperConfig.pickModel`: `auto`
  (default for a new install) → `moonshine-tiny` for English, Whisper Tiny
  otherwise; Moonshine is never used for a language it does not list. The worker
  gives Moonshine no language/task and a budget of `ceil(seconds × 8) + 4`
  tokens — the runtime's own `6 × floor(seconds)` cut sentences short. The
  manager re-reads the model for each transcription's language. stt-check's talk
  button is a tap toggle (ST18): a held Quest trigger selected text and lost the
  hold.
- **Test with the real model**: `npm run stt:real-model` (Piper makes the speech
  in the browser, Whisper transcribes it, then the real app is driven through
  Chromium's fake microphone). English is gated; Italian is reported (29–57% WER
  on Tiny, 14–36% on Base with Piper's synthetic voice). That is this machine's
  CPU — Quest timings come from `stt-check.html` on the headset.
- **Wake Up (WU)** holds the same mic button and still constructs recognizers
  only through `recognitionClass()`. It does not add an engine. See
  `docs/claude/wake-up-voice.md`.
