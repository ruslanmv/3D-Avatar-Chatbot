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
