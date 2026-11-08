<!-- Moved verbatim from CLAUDE.md on 2026-11-08 so sessions load it only when working on this feature. Keep it accurate: if something here is wrong, fix it in the same change. -->

# SonicAgent voice through OllaBridge Cloud (HV)

Optional remote speech: SonicAgent's faster-whisper and streamed Piper, through
the OllaBridge Cloud this app pairs with for chat. **Off by default; additive.**
`docs/SONICAGENT_VOICE.md` has the design and the measurements.

- **Three gates, all checked when audio would leave:** `nexus_sonic_voice`
  `enabled`, then `consent`, ticked separately under Settings ▸ ADVANCED VOICE
  (turning the feature off withdraws consent), then a paired OllaBridge. The
  engines are new values, `sonicagent-stream`, in STT PROVIDER and TTS ENGINE.
  No existing key changes shape.
- **Never a silent fallback.** `SpeechService.startSTT` has an explicit
  `sonicagent-stream` case: an unknown provider falls through to Web Speech
  (Google on Chrome). A remote failure never writes `stt_config` or
  `tts_engine`.
- **One recognizer class for the three surfaces**, via
  `NEXUS_STT.recognitionClass()` (engine `remote` in SttRouter). It sets
  `isLocalWhisper` (the surfaces read it as "app-owned recognizer") and
  `isRemoteSonic`.
- **Exactly one final per commit** (`commit_seq`, SonicAgent HV3 client
  endpointing). **Only the newest turn speaks** (`VoiceTurnController`).
  `onStart`/`onEnd` follow real playback, and lip-sync is driven by the player's
  level (`NEXUS_LIP_SYNC.drive`).
- **HV5 streamed speech** is `__nexusStreamedSpeech()` in `main.js`, used only
  with the remote engine active and "speak while streaming" on.
  `finish(displayText)` speaks the rest only if what was already spoken is still
  in the final text; otherwise `speakText()` as before.
- **Streamed TTS needs SonicAgent HV3** (a v1 server cut replies at 2 s); it
  refuses with `requires_hv3`. The player acknowledges every phrase it still
  holds; SonicAgent budgets unplayed audio across the session.
- **Choosing SonicAgent is the switch (HV-FIX).** `TTSProvider.setEngine()`
  calls a provider's `onSelected()` (remote: `enabled = true`, never consent);
  so does a stored SonicAgent TTS/STT choice unless ADVANCED VOICE was switched
  off (`userDisabled`). **An init failure is session-only**: `tts_engine` keeps
  the choice, `lastFailureDetail()` says why, Settings shows "Selected /
  Currently speaking / Reason". Never write the fallback to storage.
- **Voices: `VoiceSelectionPolicy` decides Auto**, from SonicAgent's catalogue
  (`GET /v1/voice/voices`, all 49 entries, in Settings ▸ SPEECH under TTS ENGINE
  via `VoiceStyleSettings`; the VOICE list shows only VOICE LANGUAGE's voices —
  HV-FIX 7, `forLanguage`). A locale with no preset of its own (es-AR) takes a
  voice of that exact locale before a neighbour's preset (HV-FIX 10: Daniela,
  and Serena beside Paola — 52 voices). Preset per locale and style first; never
  another language, never a local Piper id, never `piper_voice`. The voice goes
  as `voice_id` on every `tts.speak`. Rate and pitch do not apply to SonicAgent
  and are disabled for it.
- **The microphone permission is ticked under STT PROVIDER too (HV-FIX 8)** —
  `#sonic-stt-consent`, the same `consent` as ADVANCED VOICE ▸ I agree, shown
  only while STT PROVIDER is SonicAgent and OllaBridge is paired. Only the
  person's tick grants it; choosing SonicAgent never does.
- **In VR, SonicAgent speaks the VR panel too (HV-FIX 9)**: `routesVR()` is true
  for an active `sonicagent-stream` engine with the Quest switch off, and
  `QuestVoice.effectiveEngine` never moves a stored SonicAgent to Piper. A
  remote failure in VR is not silently replaced (same rule as desktop). Quick
  start with pictures: `docs/SONICAGENT_QUICKSTART.md`.
- **A sleeping SonicAgent is woken and waited for, not reported (SW1).** The
  free Space sleeps after 48 h unused, and OllaBridge then answers every
  `/v1/voice/*` call with 503. `SonicAgentVoiceConfig.createGateway`'s `call`
  now retries only "not up yet" answers (502/503/504,
  `backend_warming|starting|unavailable|timeout`) with backoff (Retry-After
  clamped to 2–15 s) for up to `WAKE_BUDGET_MS` (75 s). It sends one opaque
  `no-cors` GET to the Space's own `/health/live` at most every 2 min
  (`NEXUS_SONIC_VOICE_CONFIG.wakeUrl`, `''` turns it off; never the token), and
  emits `sonic-voice-waking`/`sonic-voice-awake`, which Settings shows as
  "Waking the speech service…". A 401, a missing route or a 400 still fails at
  once. On the server side, SonicAgent's `space-keepalive.yml` wakes the Space
  on a schedule and restarts it when it is down (`hf/README.md` ▸ Sleep, wake
  and restart). `tests/stt/sonic-wake.test.js`.
- **The Settings mic test with SonicAgent runs `RemoteSonicAgentRecognition`**
  (one capture; the meter reads its `onlevel`), never the browser recognizer.
