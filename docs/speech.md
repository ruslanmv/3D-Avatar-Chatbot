# Speech I/O

## Overview

The app provides real-time speech-to-text (STT) and text-to-speech (TTS) using the Web Speech API. Voice input works on desktop and in VR.

## Speech-to-Text

### Desktop

1. Click the microphone button in the chat input area
2. Grant microphone permission when prompted
3. Speak — interim results appear in real-time
4. Click stop or pause to finalize the transcription
5. The message is placed in the input field (or auto-sent if enabled)

### VR (Push-to-Talk)

1. Hold **Y button** (left controller) to start recording
2. Speak while holding the button
3. Release to send the transcribed message to the AI

### Microphone Selection

Open Settings → Speech tab to choose a specific microphone device. The app enumerates all available audio inputs.

### Language Support

The Web Speech API supports 50+ languages. Set the recognition language in Settings:

```
en-US, es-ES, fr-FR, de-DE, ja-JP, zh-CN, ko-KR, pt-BR, it-IT, ...
```

## Text-to-Speech

Configure TTS in Settings:

| Setting | Range | Default |
| ------- | ----- | ------- |
| Voice | System voices | Browser default |
| Rate | 0.1x – 10x | 1.0x |
| Pitch | 0 – 2 | 1.0 |
| Volume | 0 – 1 | 1.0 |
| Auto-speak | On / Off | On |

When auto-speak is enabled, the avatar automatically speaks every AI response.

### Auto (best match) voice selection

`speechSynthesis.getVoices()` returns voices in no useful order and of wildly
varying quality, so taking the first language match lands on eSpeak as readily
as on a good voice. `src/VoicePriority.js` scores instead:

| Factor | Weight |
|---|---|
| locale exact (`en-US` === `en-US`) | +1000 |
| locale base (`en-GB` for `en-US`) | +500 |
| matches the requested gender | +100 |
| vendor: Google | +50 |
| vendor: Microsoft | +40 |
| vendor: Apple / premium | +30 / +25 |
| "compact", eSpeak, novelty voices | −60 |

The weights encode a deliberate order: **language beats everything**, the
**requested gender beats vendor**, and vendor only breaks ties among otherwise
equal voices. For English + female that yields:

1. `Google US English`
2. `Microsoft Zira - English (United States)`
3. any other `en-US` voice
4. Piper TTS — a separate engine chosen by `TTSProvider`, used when Web Speech
   offers no usable voice at all

Two things worth knowing:

- **`Google US English` is female but says so nowhere in its name**, so a
  keyword guess returns "unknown" and the gender preference silently fails to
  apply — to exactly the voice most people want. A `KNOWN_GENDER` table covers
  it and the other well-known voices.
- **It never returns null when any voice exists.** Speaking in a slightly wrong
  accent beats not speaking.

Used by both `pickBestVoice()` (main.js) and `SpeechService.getPreferredVoice()`
so the two cannot drift. `explain(voices, target, n)` returns the ranked
shortlist with each voice's vendor, gender and score — useful when a user
reports the "wrong" voice.

```js
window.NEXUS_VOICE_PRIORITY.pickBest(voices, { lang: 'en-US', gender: 'female' });
window.NEXUS_VOICE_PRIORITY.explain(voices, { lang: 'en-US', gender: 'female' }, 5);
```

### Markdown normalisation

Models emit Markdown whether or not anyone asked for it. Read aloud verbatim
that becomes "asterisk asterisk important asterisk asterisk", `#` spoken as
"hash", and URLs spelled out character by character.

`src/SpeechTextNormalizer.js` rewrites the text on its way to the voice, in
`speakText()` — the single funnel every engine and the lip-sync segmentation
pass through. It is **non-destructive**: a pure function returning a new
string. The transcript keeps exactly what the model wrote; only the audio path
sees the rewrite.

What it does, following what modern assistant voices converged on:

| Markdown | Spoken as |
|---|---|
| `**bold**`, `*italic*`, `~~strike~~` | the text, markers dropped — prosody carries emphasis |
| ` ```js … ``` ` | "js code block" — code is named, not recited |
| `` `stop()` `` | `stop()` — the word matters, the backticks do not |
| `[the docs](https://…)` | "the docs" — never the URL |
| bare `https://…` | "link" |
| `![alt](x.png)` | the alt text, or "image" |
| `## Heading` | the text, ending a sentence so the engine pauses |
| `- item` | the text, ending a sentence |
| `1. item` | kept numbered — numbers help a listener follow steps |
| tables | cells joined by commas, separator row dropped |
| emoji | dropped, or engines announce "party popper" |

Details worth knowing:

- **`snake_case` survives.** A naive underscore-italic rule turns `pair_token`
  into "pairtoken". Underscore emphasis is matched only at word boundaries.
- **An unterminated fence** (a truncated stream) is closed at end-of-string, so
  a cut-off reply cannot leak backticks into the audio.
- **Escaped characters** (`\*`) survive the sweep that removes stray markers.
- **A reply that normalises to nothing** — only emoji, only punctuation —
  produces silence rather than an empty utterance.
- **A nested list is not an indented code block.** Models emit nested lists
  constantly and indented code almost never (they use fences), so the
  indented-code rule requires a blank line before the block, two or more
  lines, and that no line starts with a list marker. Swallowing a list loses
  the content outright; reading a stray indented snippet aloud merely sounds
  odd.
- **Nested items fold into their parent as a series.** "Gestures:" followed by
  indented Wave / Greeting / Bow is spoken as "Gestures: Wave, Greeting, Bow."
  rather than as four one-word sentences. A colon-introduced run of inline
  markers (`Gestures: + Wave + Bow`) folds the same way, while `2 + 2` and
  `C++` are left alone.
- Placeholders are localised for EN/ES/IT and follow the app language.

```js
window.NEXUS_SPEECH_TEXT.forSpeech(text, { lang: 'es' });
window.NEXUS_SPEECH_TEXT.hasSpeakableContent(text);
```

Options: `lang`, `speakCodeBlocks` (read code instead of naming it),
`stripEmoji`, `maxLength` (truncate at a sentence boundary).

## Browser Support

| Browser | STT | TTS | Notes |
| ------- | --- | --- | ----- |
| Chrome | Yes | Yes | Full support (recommended) |
| Edge | Yes | Yes | Full support |
| Safari | Yes | Yes | Works on macOS and iOS |
| Firefox | No | Yes | No speech recognition API |
| Quest Browser | Yes | Yes | Full support in VR |

## API Reference

### SpeechService

```javascript
// Start recognition
speechService.startRecognition();

// Stop recognition
speechService.stopRecognition();

// Speak text
speechService.speak('Hello world');

// Stop speaking
speechService.stopSpeaking();

// Check microphone permission
const granted = await speechService.checkMicPermission();
```

### VR Push-to-Talk

Push-to-talk is handled by `VRControllers.js`. When Y is pressed, it triggers `SpeechService.startRecognition()`. On release, the transcript is sent via `VRChatIntegration`.

If the Web Speech API is unavailable in the VR browser, a fallback records raw audio and can send it to a server-side STT endpoint (`POST /api/stt`).
