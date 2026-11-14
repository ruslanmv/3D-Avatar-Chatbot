# Wake Up voice activation (WU)

One microphone owner. The tap on `#listen-btn`, a three-second hold on that
same button, Companion hands-free, Companion wake standby, VR push-to-talk and
TTS all ask `NEXUS_VOICE_ACTIVATION` before they open a recognizer. The
recognizer is still `NEXUS_STT.recognitionClass()` — browser Web Speech,
on-device Whisper, or SonicAgent. This module does not recognise speech.

States: `OFF → STANDBY → LISTENING → TRANSCRIBING → SENDING → RESPONDING`,
plus `PAUSED` and `ERROR`. A generation id is bumped on cancel. A callback from
an older generation cannot call `start()` again.

## Hold

`pointerdown` starts a 3000 ms timer. Release earlier leaves the click alone,
and that click is the existing tap (`toggleVoiceInput`). At 3000 ms the button
gets `hold-armed` (an outline in `currentColor`, not a new bar color). Release
then opens one utterance. `pointercancel`, a drag past 16 px, `pagehide` and a
disabled control cancel and swallow the click that would otherwise toggle the
tap. Keyboard Space/Enter uses the same timer. Settings → Wake Up → **Speak
and send** is the switch/keyboard path that does not require a hold.

Endpoint defaults, not device-measured: 900 ms of silence, 7 s with no speech
at all, 30 s maximum. Only a non-empty final transcript is submitted, once,
through `handleUserMessage`. Interim text may sit in the field. Confidence is
not a gate — Whisper and SonicAgent often have none. The tap path still uses
`SpeechSettings.autoSend` and its 80% rule. The new auto-send checkbox
defaults on and applies to hold, Speak and send, and wake only.

## Wake word

Off until Settings → Wake Up is checked. The checkbox text is the disclosure.
`overlay_wakeword` / `overlay_wakephrase` are copied at most once
(`nexus_wake_migrated`): a custom phrase is copied, the overlay switch is not.
Companion standby still runs only while Companion is open. When Companion is
open it is the only wake listener; the page monitor is stopped first.

### Porcupine

Picovoice Porcupine (WASM, Web Worker) was the on-device spotter considered
and **not** shipped:

- The library license is not Apache-2.0 compatible, and this repo cannot
  vendor it.
- Built-in keywords do not include "Hey Nexus". A custom keyword needs their
  console and an access key.
- Multilingual custom keywords are a paid console feature.
- Always-on CPU and battery cost was not measured on Quest.

`window.NEXUS_WAKE_DETECTOR` may be injected later if `local: true` and it
implements `start` / `stop`. Anything that is not marked local is refused.
Without that detector, and only after the opt-in, a local energy meter runs
(audio is not played out) and **one** short pass of the already chosen
recognizer checks the phrase. That pass is not left open. Browser Web Speech
may send the clip to the browser vendor; on-device Whisper does not. There is
no mode that streams the room to a model just to spot the phrase.

Her own TTS cannot wake her: `noteSpeaking` / `noteSpoken` from `setStatus` and
`speakText`, plus an echo guard of about 800 ms.

## What was not verified on a device

Jest covers the state machine with fake recognizers shaped like Web Speech
and like Whisper. This change did **not** measure endpoint timing on a
headset, a phone, or a laptop microphone, and it does not claim:

- listening while the browser is closed
- listening while the phone is locked
- listening while the tab is hidden (the monitor stops; tracks are stopped)
- iOS Safari `continuous` recognition (the browser path retries once with
  `continuous: false` if `start()` throws)
- Quest Browser's built-in recognizer hearing anything (it still does not;
  on-device Whisper remains the recognizer when that provider is selected)
- a calibrated 900 / 7000 / 30000 ms on real rooms — those are the initial
  defaults (`DEFAULTS` in `src/stt/VoiceActivation.js`). Whisper's own
  endpointer is already 900 ms of silence and about 28 s maximum; the
  controller also stops a silent session at 7 s.

Manual fallback when there is no microphone, no Web Audio meter, and no local
detector: the existing tap, and **Speak and send**.
