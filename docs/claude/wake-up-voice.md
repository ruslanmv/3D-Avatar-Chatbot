# Wake Up voice activation (WU)

One microphone owner. The tap on `#listen-btn`, a three-second hold on that
same button, Companion hands-free, Companion wake standby, VR push-to-talk and
TTS all ask `NEXUS_VOICE_ACTIVATION` before they open a recognizer. The
recognizer is still `NEXUS_STT.recognitionClass()` — browser Web Speech,
on-device Whisper, or SonicAgent. This module does not recognise speech.

States: `OFF → STANDBY → LISTENING → TRANSCRIBING → SENDING → RESPONDING`,
plus `PAUSED` and `ERROR`. A generation id is bumped on cancel. A callback from
an older generation cannot call `start()` again.

## The button

A short tap records one request (`micTap` → `captureOnce`). Finished speech is
sent once through `handleUserMessage`. After the spoken reply the microphone
stays closed. Wake word is not required.

Holding the button for 3000 ms, while a hands-free session is not open, starts
that session (`holdForHandsFree`). It listens again after each reply until a
tap or another hold. The same button shows a stop mark for the session. Wake
word stays the Settings checkbox. The hold does not record and does not flip
that checkbox. Release before 3000 ms is the tap.
`pointercancel`, a drag past 16 px, `pagehide` and a disabled control cancel
and swallow the click. The outline uses `currentColor`. Idle green and
listening orange are unchanged. `wake-standby` is the visible “microphone is
hot” mark while the name is being watched.

Endpoint defaults, not device-measured: a pause under 800 ms stays open.
A sentence that ends with punctuation closes after about 1200 ms of quiet.
A clause with no ending waits about 1800 ms, so a thinking pause is not
treated as the end of the request. There is no semantic turn model in this
browser build. In a tapped conversation, 7 s of silence ends that sentence
and listens again; it does not end the conversation. The whole session
ends after 2 minutes without the person speaking (90 seconds is the other
choice, or Never). A restart of a silent recognizer does not reset that
clock. Speech does. The turn cap is 30 seconds unless Settings chooses 60
seconds or 2 minutes, and hitting it says so. Interim text is not sent.
Confidence is not a gate.

The microphone does not reopen because a clock guessed that she had
finished. It reopens when the reply has settled and playback has ended,
failed, been cancelled, or never started, and then only after the echo
guard. A rejected send releases the microphone instead of staying busy.

The microphone is the only stop. While hands-free is open it shows a square in
the same place, and a tap ends the session and playback. Wake word is a
different switch and is not cleared by that tap. Orange on the button is the
person speaking. Cyan is Nexus thinking or speaking. Green is idle, or the
slow halo while hands-free is waiting. `prefers-reduced-motion` drops the
loops and keeps a steady outline.

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

`window.NEXUS_WAKE_DETECTOR` may be injected only when `local: true` and
`audioLeavesDevice: false`, and it implements `start` / `stop`. `local: true`
alone is refused: that flag does not prove the audio stays here. A transcript
that is not the selected phrase is ignored. Without that detector, and only
when on-device Whisper is the selected engine, a ring buffer of the microphone
is transcribed locally and the name is matched in that text. The buffer is
sized from the capture's real sample rate and is the pre-roll, so “Nexus, open
my calendar” is not split across two captures. A command that never goes quiet
still ends at the selected turn limit. Loudness does not count as the name,
and browser or SonicAgent
audio is not sent away to hunt for it. If neither a local detector nor
on-device Whisper is available, wake word stays unavailable and the tap
conversation still works.

After a wake command is answered, the page waits for the name again. It does
not keep a conversation open.

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
- a calibrated 800 / 1200 / 1800 / 7000 / 30000 ms on real rooms — those are the
  initial defaults (`DEFAULTS` in `src/stt/VoiceActivation.js`). Whisper's own
  endpointer is already about 900 ms of silence and about 28 s maximum; the
  controller also stops a silent command at 7 s.

When this browser cannot spot the name on the device, the tap and **Speak and
send** still start the hands-free conversation.
