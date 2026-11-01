# SonicAgent voice through OllaBridge Cloud (HV1–HV8)

Optional, low-latency speech for the Avatar:

- **Speech-to-text:** SonicAgent's faster-whisper.
- **Her voice:** SonicAgent's Piper, streamed while it is being made.
- **The route:** both run on the SonicAgent Hugging Face Space, reached through
  the OllaBridge Cloud this app already pairs with for chat. It works with your
  PC switched off.

It is **off by default** and **additive**:

- Browser Web Speech, on-device Whisper/Moonshine and Piper WASM are unchanged.
- No existing setting changes shape. The remote engines are new values in STT
  PROVIDER and TTS ENGINE, and their own settings live under a new key,
  `nexus_sonic_voice`.

## Turning it on

1. **Pair OllaBridge Cloud** under Settings ▸ LLM, as for chat. Remote voice
   reuses that pairing token; SonicAgent's own key never reaches the browser.
2. **Enable remote voice** under Settings ▸ ADVANCED VOICE — SONICAGENT
   STREAMING.
3. **Consent.** Read the sentence _"Your microphone audio will be sent to
   OllaBridge Cloud and SonicAgent for transcription."_ and tick **I agree**.
   Turning the feature on does not tick it, and turning the feature off
   withdraws it.
4. **Choose the engines.** Pick **SonicAgent — Cloud streaming** under STT
   PROVIDER and/or **SonicAgent Piper — Cloud streaming** under TTS ENGINE. Each
   is independent: you can listen remotely and speak with Piper WASM, or the
   other way round.
5. **Optional: speak while streaming.** Turn on **Speak while the reply is still
   being written** to start her voice at the first sentence (HV5).

The **Check readiness**, **Test STT** and **Test TTS** buttons do real round
trips and show the measured times. For per-run numbers, open
`stt-check.html#remote`.

## What leaves the device, and when

| Choice                                         | Sent to OllaBridge → SonicAgent                         |
| ---------------------------------------------- | ------------------------------------------------------- |
| Remote voice off (default)                     | nothing                                                 |
| On, STT PROVIDER not SonicAgent                | nothing from the microphone                             |
| On, no consent                                 | nothing — the recognizer refuses before the mic opens   |
| On + consent + STT PROVIDER SonicAgent         | microphone audio while you are talking, as PCM16 frames |
| TTS ENGINE SonicAgent                          | the text of her replies                                 |

Nothing is ever switched silently:

- **No silent fallback.** A remote choice that cannot run fails with a sentence.
  Audio never goes to the browser's recognizer instead (Google on Chrome), and
  a local-only choice never uploads. `SpeechService.startSTT` has an explicit
  `sonicagent-stream` case for exactly this reason: an unknown provider used to
  fall through to Web Speech.
- **A failure never changes a saved setting.** A remote TTS engine that cannot
  start falls back for the session only, the way TTSProvider handles every
  engine.
- **Automatic fallback is opt-in.** With **If the remote voice fails before
  speaking, use Piper on this device** on (default off), that fallback is only
  ever Piper WASM on this device.

## How it is built

```text
MicrophoneSession ─▶ StreamingSttSession framer (48 kHz → 16 kHz, PCM16, 20 ms, v1 header)
                 ─▶ shared voice link (WSS /v1/voice/stream/{id}?ticket=… on OllaBridge Cloud)
                 ─▶ SonicAgent /v1/audio/stream (speech-only: never its LLM)
transcript.final (commit_seq) ─▶ RemoteSonicAgentRecognition ─▶ the existing chat handler
LLM stream ─▶ PhraseSpeechScheduler ─▶ tts.speak per phrase (queued server-side)
PCM16 frames ─▶ AudioJitterBuffer per phrase ─▶ StreamingAudioPlayer (AudioWorklet) ─▶ speaker
                                                     └─ level ─▶ LipSyncEngine.drive()
```

### The modules

| Module                          | Where it loads                | What it owns                                                                                     |
| ------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/stt/SonicAgentVoiceConfig.js`   | end of `index.html`           | the switch, consent, voice choice, OllaBridge client (`/v1/voice/*`)                              |
| `src/stt/StreamingSttSession.js`     | end of `index.html`           | frame codec, streaming resampler, framer, the shared link                                         |
| `src/stt/RemoteSttEvents.js`         | end of `index.html`           | server event → recognizer state; error code → browser error name and a sentence                   |
| `src/stt/RemoteSonicAgentSTT.js`     | end of `index.html`           | the recognizer, shaped like `webkitSpeechRecognition`                                            |
| `src/stt/SonicAgentVoiceSettings.js` | end of `index.html`           | the Settings section                                                                              |
| `src/tts/AudioJitterBuffer.js`, `StreamingAudioPlayer.js`, `PhraseSpeechScheduler.js`, `VoiceTurnController.js`, `RemoteSonicAgentTTS.js` | end of `index.html`, `defer` | streamed playback, phrases, turns, the TTSProvider engine |

### The rules

- **One recognizer for three surfaces.** `NEXUS_STT.recognitionClass()` answers
  the remote class when STT PROVIDER is SonicAgent, so the mic button, the VR
  panel and push-to-talk, and CompanionMode keep their own endpointing and UI.
  It sets `isLocalWhisper` because the surfaces read that flag as "app-owned
  recognizer". It opens the mic itself, so no second permission stream competes
  on a Quest.
- **Exactly once.** SonicAgent is asked for client endpointing (HV3), so each
  commit produces exactly one `transcript.final` tagged with `commit_seq`. A
  final for a commit this run did not send, or that arrives after `abort()`, is
  dropped. Against a SonicAgent from before HV3, the recognizer counts
  `speech.stopped` against finals and waits for the line to go quiet.
- **Only the newest turn speaks.** Every reply is a turn of
  `VoiceTurnController`. A newer reply, `TTSProvider.stop()` or a CLEAR cancels
  four things: pending phrases, SonicAgent's queue (`turn.cancel` with target
  `tts`), buffered frames and playing audio.
- **Honest timing:**
  - `onStart` fires at the first audible sample, `onEnd` after the last one;
  - her mouth follows the audio level while streamed speech plays;
  - "Transcribing…" is shown at `onaudioend`;
  - there are no invented partial transcripts.
- **What is spoken while streaming must survive the seams.** At the end of the
  reply, `finish(final)` checks the spoken phrases are still, in order, in the
  text the app kept. If they are, the rest of the final text is spoken. If not
  (a lookup replaced the answer), the streamed voice is cancelled and the reply
  goes through `speakText()` as usual. Directive tags and fenced blocks are
  never sent to the synthesizer.
- **Flow control.** The player acknowledges every phrase it still holds audio
  for (`playback.ack`). SonicAgent keeps at most `SONIC_MAX_OUTBOUND_QUEUE_MS`
  of unplayed audio in flight across the session.
- **Needs SonicAgent HV3 for speech.** A server that echoes no `options` would
  cut every reply at 2 s (its v1 queue counter). Remote TTS refuses with
  `requires_hv3` rather than half-speak. Remote STT works against both.

## Measured

Cross-repo end-to-end run with no network fakes between the parts: the Avatar's
own modules in Node 22 → OllaBridge Cloud's real voice router → a real
SonicAgent HV3 server. Only the speech models were stand-ins. On this machine:

| Step                                                   | Result                                    |
| ------------------------------------------------------ | ----------------------------------------- |
| Open the link (session + socket)                       | 25–44 ms                                  |
| 1 s of 48 kHz microphone audio → frames → final        | one final, `commit_seq` matched, 6–10 ms after the commit |
| `tts.speak` → first audio frame                        | 9–13 ms                                   |
| Two queued 3 s phrases (old server cut at 2 s)         | 3000 ms + 3000 ms, in order, 40 ms frames |
| Pacing with a 2 s lead                                 | 6 s of speech delivered over 4.03 s       |
| `tts.speak` right after `turn.cancel`                  | accepted                                  |
| Streaming resampler, 10 s of 48 kHz in 128-sample blocks | 47 ms of CPU                            |

These are protocol and CPU numbers from a desk, not Quest or Hugging Face
latencies. Real Quest 3 timings come from `stt-check.html#remote` on the
headset, and none are claimed here.

The run found two server bugs, fixed in SonicAgent HV3. The playback budget was
per phrase, so 6 s of speech arrived in 2.2 s. And a client acknowledging only
the phrase being received deadlocked the queue.

## Rollback

Untick **Enable remote voice**, or set STT PROVIDER and TTS ENGINE back. To
remove everything, delete `nexus_sonic_voice`. Nothing else references these
modules.
