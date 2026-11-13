<!-- Moved verbatim from CLAUDE.md on 2026-11-08 so sessions load it only when working on this feature. Keep it accurate: if something here is wrong, fix it in the same change. -->

# Speech engines and the Meta Quest voice switch

`src/TTSProvider.js` keeps two engines apart: the **stored** one (`tts_engine`,
written only by `setEngine()` — a person's choice in Settings) and the
**active** one (what speaks). `boot()` makes the stored engine active at
`DOMContentLoaded` (Q2; before that, a saved Piper choice was ignored after
every reload). Desktop replies go through `speakText()` in `main.js`; the VR
panel goes through `js/speech-service.js` — two speech paths, not one.

- **"Natural voice on Meta Quest" is off by default, and off means unchanged
  (Q1–Q6).** `src/tts/QuestVoice.js` holds the switch (`nexus_quest_voice`) and
  every decision, pure and tested; every function answers "what you had" unless
  the page is in a Quest browser _and_ the switch is on. On, Piper speaks every
  reply — the VR panel too, via `TTSProvider.routesVR()` — except languages
  Piper has no voice for, falls back to the system voice when Piper can't load,
  and preloads the model at idle. The person asked for this to be opt-in; do not
  make it the default without asking.
- **The switch's engine is an in-memory override, never written to
  `tts_engine`.** While it is in force, TTS ENGINE is locked and Save/TEST VOICE
  skip `setEngine()`; an unlocked dropdown would save the override as the
  person's own choice, and turning the switch off could no longer restore it.
- The three script tags (`QuestVoice` before `TTSProvider`, `QuestVoiceSettings`
  after Piper) sit after every line the parity harness has frozen. The toggle is
  drawn from JS, not written into `index.html`, for the same reason.
- `?questVoice=1` makes any browser count as a Quest, so this is testable from a
  desk. Docs: `docs/TTS.md` ▸ _Natural voice on Meta Quest_.
- **Piper must never synthesize on the main thread (Q7).** This site is not
  crossOriginIsolated, so ONNX Runtime ignored Piper's thread count and ran the
  model on the main thread: 1.0–2.7 s frozen per reply, which in VR stops the
  frame loop — no rendering, no controller tracking, puppet handles that will
  not drag. `_offMainThread()` sets `env.wasm.proxy` on the import-map instance
  of `onnxruntime-web` before any session exists; `_degradeProxy()` retries on
  the main thread only when the worker itself failed.
