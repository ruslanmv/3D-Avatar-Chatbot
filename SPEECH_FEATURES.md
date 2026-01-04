# Speech-to-Text Features

## Overview

The 3D Avatar Chatbot now includes enhanced speech-to-text (STT) capabilities for both **desktop** and **VR** platforms. This implementation uses the **Web Speech API** with advanced features like interim results, microphone permission handling, and VR controller push-to-talk.

---

## Features

### Desktop Features

1. **Real-time Interim Results**
   - See transcription as you speak (shown in italics)
   - Final results appear in normal text
   - Provides immediate feedback

2. **Microphone Permission Handling**
   - Automatic permission request using `getUserMedia()`
   - Clear error messages for denied permissions
   - Permission state tracking

3. **Improved Error Handling**
   - Detailed error messages with context
   - Graceful degradation when unsupported
   - Network error detection and reporting

4. **Visual Feedback**
   - Recording indicator when listening
   - Input field styling changes
   - Placeholder text updates

### VR Features

1. **Push-to-Talk via Controller**
   - **Y button** (left controller) - Primary PTT button
   - **Grip/Squeeze** (left controller) - Alternative PTT button
   - Hold to speak, release to stop
   - Works hands-free in VR

2. **Microphone Permission in VR**
   - Automatic permission request on first use
   - User-friendly prompts in VR chat panel
   - Permission state persistence

3. **VR-Specific UI Feedback**
   - Status indicators (listening, thinking, speaking)
   - In-world chat messages for errors
   - Controller haptic feedback (future enhancement)

4. **Button-based Voice Input**
   - Tap microphone button in VR UI
   - Push-to-talk via controller buttons
   - Visual feedback in VR panel

---

## How It Works

### Web Speech API

The implementation uses the browser's built-in **Web Speech API** for speech recognition:

- **Supported Browsers:** Chrome, Edge, Safari, Meta Quest Browser
- **Requirements:** HTTPS or localhost
- **Limitations:** May require internet connection in some browsers

### Architecture

```
┌─────────────────────────────────────────────────────┐
│                  SpeechService                      │
│  (Core speech-to-text and text-to-speech engine)   │
└─────────────────────────────────────────────────────┘
                        │
        ┌───────────────┴───────────────┐
        │                               │
┌───────▼────────┐             ┌────────▼──────────┐
│   Desktop UI   │             │    VR System      │
│   (main.js)    │             │ (VRChatIntegration│
│                │             │  + VRControllers) │
└────────────────┘             └───────────────────┘
```

### Key Components

1. **`SpeechService` (js/speech-service.js)**
   - Manages Web Speech API
   - Handles recognition and synthesis
   - Provides permission management
   - Supports configurable options

2. **Desktop Integration (js/main.js)**
   - `handleVoiceInput()` - Main voice input handler
   - Interim results display
   - Auto-send on high confidence

3. **VR Integration (src/gltf-viewer/)**
   - `VRChatIntegration.js` - Speech integration for VR
   - `VRControllers.js` - Push-to-talk button handling
   - `VRChatPanel.js` - Visual feedback

---

## Usage

### Desktop Usage

1. **Click the microphone button** in the chat interface
2. **Speak clearly** into your microphone
3. **Watch interim results** appear in real-time (italic text)
4. **Final transcription** appears when you stop speaking
5. Message is **auto-sent** if confidence > 70%

### VR Usage

#### Method 1: UI Button
1. Point at the **microphone button** in VR chat panel
2. **Pull trigger** to activate
3. Speak your message
4. Pull trigger again to stop

#### Method 2: Push-to-Talk (Recommended)
1. **Hold Y button** (or grip) on left controller
2. **Speak your message**
3. **Release button** to stop and send
4. Works without pointing at UI

---

## Configuration

### Recognition Options

```javascript
// Set recognition options (in console or code)
SpeechService.setRecognitionOptions({
    continuous: false,      // Stop after first result
    interimResults: true,   // Enable interim results
    lang: 'en-US',         // Language code
    maxAlternatives: 1     // Number of alternatives
});
```

### Supported Languages

```javascript
// Change language
SpeechService.setRecognitionOptions({ lang: 'es-ES' }); // Spanish
SpeechService.setRecognitionOptions({ lang: 'fr-FR' }); // French
SpeechService.setRecognitionOptions({ lang: 'de-DE' }); // German
SpeechService.setRecognitionOptions({ lang: 'ja-JP' }); // Japanese
```

### VR Controller Buttons

**Left Controller:**
- **Y button** (index 5) - Push-to-talk
- **Grip** (index 1) - Alternative PTT
- **X button** (index 4) - Menu toggle

**Right Controller:**
- **Trigger** - Select/interact
- **Thumbstick** - Turn and fly

---

## Browser Support

| Browser | Desktop | VR (WebXR) | Notes |
|---------|---------|------------|-------|
| Chrome | ✅ Full | ✅ Full | Best support |
| Edge | ✅ Full | ✅ Full | Chromium-based |
| Safari | ⚠️ Partial | ❌ No VR | Limited features |
| Firefox | ❌ Limited | ❌ No VR | Poor Web Speech support |
| Meta Quest Browser | ✅ Full | ✅ Full | Excellent VR support |

---

## Error Handling

### Common Errors

1. **"Microphone permission denied"**
   - **Solution:** Allow microphone access in browser settings
   - **VR:** May need to restart browser after allowing

2. **"Speech recognition not supported"**
   - **Solution:** Use Chrome, Edge, or Quest Browser
   - **Fallback:** Type messages manually

3. **"Network error"**
   - **Solution:** Check internet connection
   - **Note:** Web Speech API uses server-based recognition in most browsers

4. **"No speech detected"**
   - **Solution:** Speak louder or check microphone
   - **VR:** Ensure headset microphone is active

---

## Advanced Features

### Microphone Permission Check

```javascript
// Check if permission is granted
if (SpeechService.hasMicrophonePermission()) {
    console.log('Microphone ready');
} else {
    // Request permission
    await SpeechService.requestMicrophonePermission();
}
```

### Custom Callbacks

```javascript
// Desktop
await SpeechService.startRecognition({
    onStart: () => console.log('Listening...'),
    onInterim: (text) => console.log('Interim:', text),
    onResult: (text, confidence) => console.log('Final:', text),
    onError: (error, context) => console.error(error, context),
    onEnd: () => console.log('Stopped')
});
```

### VR Push-to-Talk Integration

```javascript
// Setup in VRChatIntegration
this.vrControllers.setPushToTalkCallbacks(
    async () => {
        // Start speech recognition
        await this.speechService.startRecognition({...});
    },
    () => {
        // Stop speech recognition
        this.speechService.stopRecognition();
    }
);
```

---

## Troubleshooting

### Desktop Issues

**Problem:** Interim results not showing
- **Check:** Ensure `interimResults: true` in options
- **Browser:** Some browsers don't support interim results

**Problem:** Auto-send not working
- **Check:** Confidence threshold (default: 0.7)
- **Adjust:** Lower threshold for easier auto-send

### VR Issues

**Problem:** Push-to-talk not working
- **Check:** Controllers are connected
- **Try:** Different button (Y or grip)
- **Console:** Look for "🎤 Push-to-talk" messages

**Problem:** Microphone permission prompt not appearing
- **Solution:** Restart browser and try again
- **VR:** Exit and re-enter VR session

---

## Performance Tips

1. **Use HTTPS or localhost** - Required for Web Speech API
2. **Stable internet connection** - Recognition may use cloud services
3. **Clear pronunciation** - Improves accuracy
4. **Quiet environment** - Reduces background noise
5. **VR: Use PTT** - More reliable than always-on listening

---

## Future Enhancements

- [ ] Offline speech recognition (Whisper/Vosk fallback)
- [ ] Custom wake words
- [ ] Multi-language auto-detection
- [ ] Voice commands (e.g., "clear chat", "change avatar")
- [ ] Haptic feedback for VR PTT
- [ ] Voice activity detection (VAD)
- [ ] Noise cancellation

---

## API Reference

### SpeechService Methods

| Method | Description | Parameters | Returns |
|--------|-------------|------------|---------|
| `requestMicrophonePermission()` | Request mic access | None | `Promise<boolean>` |
| `hasMicrophonePermission()` | Check permission | None | `boolean` |
| `setRecognitionOptions(opts)` | Set options | `{continuous, interimResults, lang}` | `void` |
| `startRecognition(callbacks)` | Start STT | `{onStart, onInterim, onResult, onError, onEnd}` | `Promise<boolean>` |
| `stopRecognition()` | Stop STT | None | `void` |
| `isRecognitionAvailable()` | Check support | None | `boolean` |

### VRControllers Methods

| Method | Description | Parameters | Returns |
|--------|-------------|------------|---------|
| `setPushToTalkCallbacks(onStart, onEnd)` | Set PTT callbacks | `onStart: Function, onEnd: Function` | `void` |

---

## Credits

Implementation based on:
- [MDN Web Speech API Documentation](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API)
- [WebXR Device API Specification](https://www.w3.org/TR/webxr/)
- Three.js VR Examples

---

## License

Same as parent project (3D-Avatar-Chatbot)

---

**Last Updated:** 2026-01-04
**Version:** 0.5.0
