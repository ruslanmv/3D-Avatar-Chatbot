# VR Chatbot Controls - Complete Guide

Production-ready VR chatbot with voice interaction, two-hand controls, and
standard VR navigation.

**✨ Features: Voice recording, speech-to-text, text-to-speech, full 6DOF
movement, and chatbot interaction**

---

## 🎮 **Two-Hand Controller System**

### **LEFT CONTROLLER** (Movement + Voice Input)

| Input           | Action                   | Details                           |
| --------------- | ------------------------ | --------------------------------- |
| **Thumbstick**  | Move forward/back/strafe | Standard FPS-style movement       |
| **Grip (Hold)** | 🎤 **Record Voice**      | Hold to record, release to stop   |
| **A/X Button**  | 🎙️ Toggle Voice-to-Text  | Enable/disable speech recognition |
| **Trigger**     | Point and click          | Select avatar/UI elements         |

### **RIGHT CONTROLLER** (Camera + Voice Output)

| Input            | Action                      | Details                          |
| ---------------- | --------------------------- | -------------------------------- |
| **Thumbstick X** | Turn left/right             | Smooth or snap turning           |
| **Thumbstick Y** | Move up/down (vertical fly) | Sketchfab-style 6DOF             |
| **Grip (Press)** | 📤 **Send Voice Message**   | Send recorded message to chatbot |
| **B/Y Button**   | 🔊 Toggle Text-to-Voice     | Enable/disable avatar speech     |
| **Trigger**      | Point and click             | Select avatar/UI elements        |

---

## 🗣️ **Voice Interaction Workflow**

### **Step 1: Record Your Message**

```
1. Hold LEFT GRIP button
2. Speak your message to the chatbot
3. Controller turns RED while recording
4. Release grip when done
```

**Visual Feedback:**

- 🔴 **Red controller** = Recording active
- 🎤 Console shows: "Voice recording started"
- ⏱️ Minimum 300ms recording required

### **Step 2: Send Message to Chatbot**

```
1. Press RIGHT GRIP button
2. Recorded message sent to chatbot
3. Controller flashes GREEN
4. Chatbot processes and responds
```

**Visual Feedback:**

- 🟢 **Green flash** = Message sent successfully
- 📤 Console shows: "Sending voice message to chatbot..."
- ✅ Transcript appears in chat

### **Step 3: Receive Response**

```
1. Chatbot generates response text
2. If Text-to-Voice ON: avatar speaks response
3. Response appears in chat UI
4. Avatar may show expressions/animations
```

---

## 🎙️ **Voice Control Modes**

### **Voice-to-Text (Left A/X Button)**

**Toggles speech recognition for your voice input**

```javascript
Status: ON (default)
Toggle: Press LEFT A/X button
Indicator: Console shows "Voice-to-Text: ON/OFF"
```

**When ON:**

- Your voice is transcribed to text in real-time
- Transcript sent to chatbot when you press right grip
- Uses Web Speech API (browser-dependent)

**When OFF:**

- Voice recording still works
- No automatic transcription
- Useful for privacy or when recognition is inaccurate

### **Text-to-Voice (Right B/Y Button)**

**Toggles avatar speech output**

```javascript
Status: ON (default)
Toggle: Press RIGHT B/Y button
Indicator: Console shows "Text-to-Voice: ON/OFF"
```

**When ON:**

- Chatbot responses are spoken by avatar
- Uses Web Speech Synthesis API
- Avatar lip-sync may activate (if implemented)

**When OFF:**

- Responses shown as text only
- No audio output
- Useful in quiet environments or for focus

---

## 🚶 **Movement & Navigation**

### **Standard VR Locomotion**

**Left Thumbstick (Forward/Back/Strafe):**

```
Push UP    → Move forward (view direction)
Push DOWN  → Move backward
Push LEFT  → Strafe left
Push RIGHT → Strafe right
```

- ✅ **Delta-time movement** = Smooth 60-90 FPS
- ✅ **Head-relative** = Moves where you're looking
- ✅ **Ground-plane movement** = No unwanted vertical drift
- ⚙️ Default speed: **1.8 meters/second**

**Right Thumbstick (Turn + Vertical):**

```
Push LEFT/RIGHT → Turn/rotate view
Push UP/DOWN    → Move vertically (fly up/down)
```

- ✅ **Smooth turning** (default) or **snap turn** (option)
- ✅ **Vertical movement** = Sketchfab-style 6DOF
- ✅ **Y-axis clamping** = Prevents flying too high/low
- ⚙️ Turn speed: **2.2 rad/sec**, Vertical speed: **1.2 m/s**

---

## 🎯 **Interaction System**

### **Ray Pointing**

Both controllers emit **cyan rays** for interaction:

| Ray Color | Meaning                               |
| --------- | ------------------------------------- |
| **Cyan**  | Default state (no target)             |
| **Green** | Hovering over clickable object/avatar |

**Ray Features:**

- Adjusts length based on distance to target
- Max length: 5 meters
- Raycasts updated every frame (90 FPS)
- Debounced clicks (180ms) prevent spam

### **Clicking Objects**

```
1. Point ray at avatar or UI element
2. Ray turns green when hovering
3. Pull TRIGGER to click
4. Object's onClick callback fires
```

**Clickable Objects:**

- Avatar body (trigger animations)
- UI panels (buttons, sliders)
- Chat bubbles
- Custom interactables (can be added via API)

---

## 🛠️ **Advanced Configuration**

### **Customize Movement Speed**

```javascript
// In src/gltf-viewer/ViewerEngine.js
this.vrControllers = new VRControllers(this.renderer, this.scene, this.camera, {
    moveSpeed: 2.5, // meters/sec (default: 1.8)
    verticalSpeed: 1.5, // meters/sec (default: 1.2)
    turnSpeed: 3.0, // radians/sec (default: 2.2)
    deadzone: 0.2, // stick deadzone (default: 0.15)
});
```

### **Enable Snap Turning**

```javascript
// Snap turn instead of smooth turning
this.vrControllers = new VRControllers(this.renderer, this.scene, this.camera, {
    snapTurn: true,
    snapTurnAngleDeg: 45, // degrees per snap (default: 45)
    snapTurnThreshold: 0.7, // stick threshold (default: 0.7)
});
```

### **Disable Vertical Movement**

```javascript
// Ground-only movement (no flying)
this.vrControllers = new VRControllers(this.renderer, this.scene, this.camera, {
    enableVertical: false, // disable up/down movement
});
```

### **Adjust Y-Axis Limits**

```javascript
// Clamp vertical position
this.vrControllers = new VRControllers(this.renderer, this.scene, this.camera, {
    clampY: true,
    minY: 0.5, // minimum height (default: 0)
    maxY: 10, // maximum height (default: 5)
});
```

---

## 📋 **Complete Button Reference**

### **Meta Quest 2/3 Mapping**

| Button            | Hand  | Index | Chatbot Function               |
| ----------------- | ----- | ----- | ------------------------------ |
| **Trigger**       | Both  | 0     | Point and click (select)       |
| **Grip**          | Left  | 1     | Hold to record voice           |
| **Grip**          | Right | 1     | Send voice message to chatbot  |
| **X**             | Left  | 4     | Toggle voice-to-text           |
| **A**             | Right | 4     | (Available for custom actions) |
| **Y**             | Left  | 5     | (Available for custom actions) |
| **B**             | Right | 5     | Toggle text-to-voice           |
| **Left Stick**    | Left  | -     | Move forward/back/strafe       |
| **Right Stick X** | Right | -     | Turn left/right                |
| **Right Stick Y** | Right | -     | Move up/down (fly)             |

---

## 🎬 **Usage Examples**

### **Example 1: Ask Chatbot a Question**

```
1. Hold LEFT GRIP → record voice
2. Say: "What's the weather like today?"
3. Release LEFT GRIP → stop recording
4. Press RIGHT GRIP → send message
5. Chatbot responds with weather info
6. Avatar speaks response (if text-to-voice ON)
```

### **Example 2: Walk Up to Avatar**

```
1. Push LEFT STICK FORWARD → walk toward avatar
2. Push RIGHT STICK LEFT/RIGHT → adjust view angle
3. Release sticks when at desired distance
4. Point ray at avatar
5. Pull trigger → trigger happy expression
```

### **Example 3: Fly Above Scene**

```
1. Push RIGHT STICK UP → ascend vertically
2. Use LEFT STICK → move around while elevated
3. Push RIGHT STICK DOWN → descend back to ground
4. Great for viewing scene from different angles
```

### **Example 4: Toggle Voice Modes**

```
1. Press LEFT A/X → disable voice-to-text
   (for privacy or manual text input)
2. Press RIGHT B/Y → disable text-to-voice
   (for quiet reading of responses)
3. Press again to re-enable each mode
```

---

## 🔬 **Technical Details**

### **Voice Recognition**

**API Used:** Web Speech API (`SpeechRecognition`)

**Features:**

- Continuous recognition while grip held
- Interim results updated in real-time
- Language: English (US) - configurable
- Browser support: Chrome, Edge, Safari (iOS 14.5+)

**Error Handling:**

- Graceful fallback if API unavailable
- Console warnings for recognition errors
- Network errors handled (requires internet)

### **Speech Synthesis**

**API Used:** Web Speech Synthesis API

**Features:**

- Text-to-speech for chatbot responses
- Can be toggled on/off
- Automatically cancels when disabled
- Works offline (uses OS voices)

### **Delta-Time Locomotion**

**Why Delta-Time:**

- FPS-independent movement
- Consistent speed on all devices (Quest, PC VR, etc.)
- Smooth even with frame rate dips

**Implementation:**

```javascript
const dt = clock.getDelta(); // seconds since last frame
vrControllers.update(dt); // movement scaled by dt
```

**Safety:**

- Clamps dt to max 0.05s (prevents huge jumps)
- Defaults to 1/90 if dt invalid
- Prevents NaN/infinity crashes

### **Button Edge Detection**

**Problem:** Gamepad buttons are polled every frame (90 FPS)

**Solution:** Edge detection tracks previous state

```javascript
const justPressed = (i) => buttons[i].pressed && !prevButtons[i];
```

**Result:**

- Button actions fire **once** per press
- No repeated log spam
- Clean event-like behavior

---

## 🐛 **Troubleshooting**

### **Voice Recording Not Working**

**Check:**

- ✅ Browser supports SpeechRecognition (Chrome/Edge recommended)
- ✅ Microphone permissions granted
- ✅ HTTPS connection (required for mic access)
- ✅ Controller connected and tracked
- ✅ Hold LEFT GRIP at least 300ms

**Debug:**

```javascript
// Check browser support
console.log(
    'SpeechRecognition:',
    !!(window.SpeechRecognition || window.webkitSpeechRecognition)
);
```

### **Message Not Sending**

**Check:**

- ✅ Recorded audio first (hold left grip)
- ✅ Duration > 300ms
- ✅ Not still recording when pressing right grip
- ✅ Console shows "has audio" message

**Fix:**

```
1. Release left grip completely
2. Wait for cyan controller color
3. Then press right grip
```

### **Movement Too Fast/Slow**

**Fix:** Adjust speeds in constructor

```javascript
// Slower movement (exploration)
moveSpeed: 1.2,
verticalSpeed: 0.8,

// Faster movement (quick travel)
moveSpeed: 3.0,
verticalSpeed: 2.0,
```

### **Controllers Not Visible**

**Check:**

- ✅ VR session started successfully
- ✅ Controllers turned on and paired
- ✅ Look down to see cyan spheres
- ✅ Console shows "Controllers setup complete"

### **Chatbot Not Responding**

**Check:**

- ✅ `window.NEXUS_CHAT_MANAGER` exists
- ✅ Chat manager initialized
- ✅ API keys configured
- ✅ Network connection active

**Debug:**

```javascript
// Check chat manager
console.log('Chat Manager:', window.NEXUS_CHAT_MANAGER);

// Listen for events
window.addEventListener('vr-voice-send', (e) => {
    console.log('Voice event:', e.detail);
});
```

---

## 🌐 **Browser Compatibility**

| Browser            | VR Support  | Voice Recognition | Speech Synthesis |
| ------------------ | ----------- | ----------------- | ---------------- |
| **Chrome Desktop** | ✅ Via Link | ✅ Yes            | ✅ Yes           |
| **Edge Desktop**   | ✅ Via Link | ✅ Yes            | ✅ Yes           |
| **Meta Quest**     | ✅ Native   | ✅ Yes            | ✅ Yes           |
| **Safari iOS**     | ⚠️ Limited  | ✅ Yes (14.5+)    | ✅ Yes           |
| **Firefox**        | ✅ Via Link | ❌ No             | ✅ Yes           |

**Recommendation:** Use Meta Quest Browser or Chrome/Edge for best experience

---

## 🎓 **Integration with Your App**

### **Listen to Voice Events**

```javascript
// Voice recording started
window.addEventListener('vr-voice-record-start', (event) => {
    console.log('Recording started on', event.detail.hand);
    // Update UI, show recording indicator, etc.
});

// Voice recording ended
window.addEventListener('vr-voice-record-end', (event) => {
    const { duration, hasAudio } = event.detail;
    console.log(`Recorded ${duration}ms, hasAudio: ${hasAudio}`);
});

// Voice message sent
window.addEventListener('vr-voice-send', (event) => {
    console.log('Sending voice message...');
    // Process and send to chatbot API
});

// Voice-to-text toggled
window.addEventListener('vr-voice-to-text-toggle', (event) => {
    console.log('Voice-to-text:', event.detail.enabled);
});

// Text-to-voice toggled
window.addEventListener('vr-text-to-voice-toggle', (event) => {
    console.log('Text-to-voice:', event.detail.enabled);
});
```

### **Get Voice State**

```javascript
const viewer = window.NEXUS_VIEWER;
const voiceState = viewer.vrControllers.getVoiceState();

console.log('Is recording:', voiceState.isRecording);
console.log('Voice-to-text:', voiceState.voiceToTextEnabled);
console.log('Text-to-voice:', voiceState.textToVoiceEnabled);
console.log('Has audio:', voiceState.hasRecordedAudio);
```

### **Connect to Chat Manager**

```javascript
// Make chat manager globally accessible
window.NEXUS_CHAT_MANAGER = {
    sendMessage: (text) => {
        console.log('[Chat] User said:', text);

        // Your chatbot API integration here
        fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text }),
        })
            .then((res) => res.json())
            .then((data) => {
                console.log('[Chat] Bot replied:', data.response);

                // Speak response if text-to-voice enabled
                const voiceState =
                    window.NEXUS_VIEWER.vrControllers.getVoiceState();
                if (voiceState.textToVoiceEnabled && window.speechSynthesis) {
                    const utterance = new SpeechSynthesisUtterance(
                        data.response
                    );
                    window.speechSynthesis.speak(utterance);
                }
            });
    },
};
```

---

## ✅ **Summary**

**🎮 Two-Hand System:**

```
LEFT:  Move + Record Voice + Toggle Voice-to-Text
RIGHT: Turn/Vertical + Send Message + Toggle Text-to-Voice
```

**🗣️ Voice Workflow:**

```
Hold Left Grip → Record → Release → Press Right Grip → Send
```

**🚶 Movement:**

```
Left Stick:  Forward/Back/Strafe
Right Stick: Turn + Vertical Fly
Full 6DOF:   Go anywhere in 3D space
```

**🎯 Interaction:**

```
Point Ray → Green Highlight → Pull Trigger → Click
```

**✨ Production Features:**

- Delta-time locomotion (FPS-independent)
- Per-hand selection state (no trigger conflicts)
- Button edge detection (no spam)
- Proper WebXR session checks (no crashes)
- Complete dispose/cleanup (memory safe)
- Full chatbot voice integration

---

**Ready to chat in VR!** 🎮🗣️✨

For setup and troubleshooting, see [META-QUEST-SETUP.md](META-QUEST-SETUP.md)
and [VR-CONTROLS.md](VR-CONTROLS.md).
