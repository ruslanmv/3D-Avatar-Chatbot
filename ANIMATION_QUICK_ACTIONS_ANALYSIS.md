# Animation Quick Actions Analysis

## Overview

The 3D Avatar Chatbot features an interactive animation system controlled through **Quick Action** buttons. These buttons allow users to trigger different emotional states and behaviors on the 3D avatar in real-time.

---

## Quick Actions Available

The chatbot provides **4 primary quick action buttons** located in the control panel:

| Icon | Label | Data Attribute | Color Theme | Purpose |
|------|-------|----------------|-------------|---------|
| 🧘 | **IDLE** | `data-emotion="idle"` | Blue | Default resting state, calm pose |
| 😊 | **HAPPY** | `data-emotion="happy"` | Green | Joyful expression and gestures |
| 🤔 | **THINKING** | `data-emotion="thinking"` | Purple | Contemplative pose |
| 🕺 | **DANCE** | `data-emotion="dance"` | Orange | Dynamic dancing animation |

---

## Implementation Details

### 1. HTML Structure

Location: `index.html` (lines 352-369)

```html
<div class="quick-actions">
    <button class="emotion-btn" data-emotion="idle" data-color="blue" type="button">
        <span class="emotion-icon">🧘</span>
        <span class="emotion-label">IDLE</span>
    </button>
    <button class="emotion-btn" data-emotion="happy" data-color="green" type="button">
        <span class="emotion-icon">😊</span>
        <span class="emotion-label">HAPPY</span>
    </button>
    <button class="emotion-btn" data-emotion="thinking" data-color="purple" type="button">
        <span class="emotion-icon">🤔</span>
        <span class="emotion-label">THINKING</span>
    </button>
    <button class="emotion-btn" data-emotion="dance" data-color="orange" type="button">
        <span class="emotion-icon">🕺</span>
        <span class="emotion-label">DANCE</span>
    </button>
</div>
```

**Key Features:**
- Each button has a unique `data-emotion` attribute for identification
- `data-color` attribute defines the visual theme
- Accessible button type with semantic structure
- Combined emoji icon + text label for clarity

### 2. CSS Styling

Location: `index.html` (lines 137-146)

```css
.quick-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
}
.quick-actions .emotion-btn {
    padding: 10px 12px;
}
```

**Layout:**
- 2-column grid layout for balanced presentation
- Responsive sizing with `minmax(0, 1fr)`
- 10px gap between buttons for visual separation

### 3. JavaScript Event Handling

Location: `src/main.js` (lines 817-830)

```javascript
document.querySelectorAll('.emotion-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
        const emotion = (btn.dataset.emotion || '').toLowerCase();
        const mapped = Object.keys(animations).find((k) => k.includes(emotion)) || findIdleAnimation();

        if (mapped) playAnimation(mapped, false);

        const emotionActive = $('emotion-active');
        if (emotionActive) emotionActive.textContent = emotion.toUpperCase();

        setEmotionPressed(btn);
        setStatus('idle', `FEELING ${emotion.toUpperCase()}`);
        setTimeout(() => setStatus('idle', 'READY'), 1500);
    });
});
```

**Event Flow:**
1. Extract emotion name from `data-emotion` attribute
2. Map emotion to available GLTF animation clip
3. Play animation (non-looping)
4. Update UI status indicator
5. Set ARIA pressed state for accessibility
6. Display temporary status message (1.5 seconds)

---

## Animation System Architecture

### Animation Loading

The system uses **Three.js AnimationMixer** to manage GLTF/GLB animations:

```javascript
// From src/main.js (lines 521-526)
if (Array.isArray(gltf.animations) && gltf.animations.length > 0) {
    mixer = new THREE.AnimationMixer(currentAvatar);
    gltf.animations.forEach((clip) => {
        const key = (clip.name || 'clip').toLowerCase();
        animations[key] = clip;
    });
}
```

**Animation Registry:**
- All animations from GLTF file are loaded into `animations` object
- Clips are indexed by lowercase name
- Allows fuzzy matching between emotion names and animation clips

### Animation Playback Function

Location: `src/main.js` (lines 584-626)

```javascript
function playAnimation(name, loop) {
    // ViewerEngine mode (high-quality rendering)
    if (window.__USE_GLTF_VIEWER_ENGINE__ &&
        window.NEXUS_VIEWER &&
        typeof window.NEXUS_VIEWER.playAnimationByName === 'function') {
        window.NEXUS_VIEWER.playAnimationByName(name);
        return;
    }

    // Legacy mode
    const key = (name || '').toLowerCase();
    if (!mixer || !animations[key]) {
        // Fallback to idle animation
        const fallback = findIdleAnimation();
        if (!fallback || !mixer || !animations[fallback]) return;
        name = fallback;
    }

    // Fade out current animation
    if (currentAnimationAction) currentAnimationAction.fadeOut(0.2);

    // Play new animation
    const clip = animations[name];
    const action = mixer.clipAction(clip);
    action.reset();
    action.fadeIn(0.2);
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce);
    action.clampWhenFinished = true;
    action.play();

    currentAnimationAction = action;

    // Auto-return to idle after non-looping animations
    if (!loop) {
        setTimeout(() => {
            const idleKey = findIdleAnimation();
            if (idleKey) playAnimation(idleKey, true);
        }, Math.max(0, (clip.duration - 0.2) * 1000));
    }
}
```

**Playback Features:**
- **Smooth transitions**: 0.2s fade-in/fade-out between animations
- **Dual rendering modes**: ViewerEngine (high-quality) or Legacy mode
- **Auto-return to idle**: Non-looping animations automatically return to idle state
- **Fallback handling**: Missing animations gracefully fallback to idle
- **Loop control**: Animations can be set to loop or play once

### ViewerEngine Integration

Location: `src/gltf-viewer/ViewerEngine.js` (lines 157-171)

```javascript
playAnimationByName(name) {
    if (!this.mixer || !this.clips?.length) return false;
    const wanted = (name || '').toLowerCase();

    // Exact match first
    let clip = this.clips.find((c) => (c.name || '').toLowerCase() === wanted);

    // Fuzzy match if exact fails
    if (!clip) clip = this.clips.find((c) => (c.name || '').toLowerCase().includes(wanted));

    if (!clip) return false;

    this.mixer.stopAllAction();
    const action = this.mixer.clipAction(clip);
    action.reset();
    action.play();
    return true;
}
```

**Matching Strategy:**
1. Try exact name match (case-insensitive)
2. Fall back to fuzzy matching (contains substring)
3. Return `false` if no match found

---

## Animation Integration with Chat System

### Speech-Triggered Animations

The system automatically triggers animations during AI conversation:

```javascript
// When avatar speaks (src/main.js:1132-1136)
function speakText(text) {
    setStatus('speaking', 'SPEAKING...');
    try {
        window.NEXUS_VIEWER?.playAnimationByName?.('Talk');
    } catch (_) {}
    // ... speech synthesis code
}

// When speech ends (src/main.js:1159-1163)
utterance.onend = () => {
    setStatus('idle', 'READY');
    try {
        window.NEXUS_VIEWER?.playAnimationByName?.('Idle');
    } catch (_) {}
};
```

**Auto-Animation Flow:**
1. **Listening**: Triggers Idle animation
2. **Speaking**: Triggers Talk animation
3. **Speech End**: Returns to Idle animation

---

## Avatar Models and Animation Support

### Available Avatar Presets

Location: `vendor/avatars/avatars.json`

```json
{
  "basePath": "/vendor/avatars",
  "items": [
    { "name": "Woman", "file": "woman.glb" },
    { "name": "Robot Expressive", "file": "RobotExpressive.glb" },
    { "name": "Avatar", "file": "girl.glb" },
    { "name": "Student", "file": "student.glb" },
    { "name": "Soldier", "file": "Soldier.glb" },
    { "name": "Anime", "file": "anime.glb" }
  ]
}
```

**Animation Requirements:**
- All avatars must be in **GLTF/GLB format**
- Animations must be embedded in the GLTF file
- Animation clip names should match or include emotion keywords:
  - `idle`, `happy`, `thinking`, `dance`, `talk`
- Recommended: Use lowercase naming for better matching

---

## Technical Specifications

### Animation System Components

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Renderer** | Three.js WebGL | 3D graphics rendering |
| **Loader** | GLTFLoader | Load 3D models and animations |
| **Mixer** | AnimationMixer | Control animation playback |
| **Controls** | OrbitControls | Camera manipulation |
| **Engine** | ViewerEngine (optional) | High-quality PBR rendering |

### Performance Characteristics

- **Animation Blending**: 200ms crossfade between animations
- **Frame Rate**: 60 FPS target
- **Memory Management**: Proper disposal of old animations when switching avatars
- **Fallback Handling**: Graceful degradation if animations missing

### Browser Compatibility

- **WebGL Required**: Modern browsers with WebGL support
- **Tested On**:
  - Chrome/Edge (recommended)
  - Firefox
  - Safari
  - Mobile browsers (with reduced quality)

---

## User Interaction Flow

```
┌─────────────────────────────────────────────┐
│  User clicks Quick Action button           │
└────────────────┬────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────┐
│  Extract emotion from data-emotion attr     │
└────────────────┬────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────┐
│  Find matching animation in GLTF clips      │
│  (fuzzy matching: "happy" → "Happy_Anim")   │
└────────────────┬────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────┐
│  Fade out current animation (200ms)         │
└────────────────┬────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────┐
│  Play new animation (fade in 200ms)         │
└────────────────┬────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────┐
│  Update UI status: "FEELING HAPPY"          │
└────────────────┬────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────┐
│  After animation: auto-return to IDLE       │
└─────────────────────────────────────────────┘
```

---

## Customization Guide

### Adding New Quick Actions

To add a new emotion button (e.g., "Sad"):

1. **Add HTML Button** (`index.html`):
```html
<button class="emotion-btn" data-emotion="sad" data-color="gray" type="button">
    <span class="emotion-icon">😢</span>
    <span class="emotion-label">SAD</span>
</button>
```

2. **Ensure Animation Exists**:
   - GLTF file must contain animation clip named "sad" or containing "sad"
   - Example: `Sad_Pose`, `sad_animation`, `sadness`

3. **No JavaScript Changes Needed**:
   - Event listeners auto-attach to all `.emotion-btn` elements

### Custom Avatar with Animations

To use a custom avatar with proper animation support:

1. **Create GLTF/GLB** with embedded animations in Blender:
   - Export with animations enabled
   - Name animation tracks clearly (e.g., "Idle", "Happy", "Dance")

2. **Upload via UI**:
   - Use the "AVATAR → UPLOAD" section
   - Select `.glb` file (recommended over `.gltf`)

3. **Test Animations**:
   - Click quick action buttons
   - Verify smooth transitions
   - Check console for missing animation warnings

---

## Accessibility Features

### ARIA Support

```javascript
// Set pressed state for screen readers
function setEmotionPressed(btn) {
    document.querySelectorAll('.emotion-btn').forEach((b) =>
        b.setAttribute('aria-pressed', 'false')
    );
    if (btn) btn.setAttribute('aria-pressed', 'true');
}
```

- Buttons use `aria-pressed` to indicate active state
- Screen readers announce "button pressed" status
- Keyboard navigation supported (standard button behavior)

### Visual Feedback

- Status badge updates: "FEELING HAPPY"
- Temporary notification (1.5 seconds)
- Smooth animation transitions provide visual confirmation

---

## Known Limitations

1. **Animation Dependency**:
   - Quick actions only work if GLTF contains matching animations
   - Missing animations fall back to idle (may appear unresponsive)

2. **Naming Convention**:
   - Animation matching is case-insensitive and fuzzy
   - Ambiguous names may trigger wrong animations

3. **Single Active Animation**:
   - Only one animation can play at a time
   - Clicking rapidly may cause animation interruptions

4. **No Animation Preview**:
   - Users can't preview animations before selecting avatar
   - Recommend testing after avatar upload

---

## Future Enhancement Possibilities

1. **Animation Queuing**: Allow multiple animations to queue
2. **Custom Animation Duration**: User-configurable animation speeds
3. **Animation Preview**: Show available animations for current avatar
4. **Blend Shapes**: Add facial expression blending
5. **Physics Integration**: Add cloth/hair physics simulation
6. **IK (Inverse Kinematics)**: Enable dynamic pose adjustments
7. **Motion Capture Import**: Support BVH/FBX animation formats

---

## Debugging Tips

### Common Issues

**Problem**: Clicking quick action does nothing

**Solutions**:
1. Open browser console (F12)
2. Check for "Animation not found" warnings
3. Verify GLTF contains animations: `console.log(animations)`
4. Test with "Robot Expressive" preset (known to have animations)

**Problem**: Animation is choppy

**Solutions**:
1. Enable ViewerEngine mode: `window.__USE_GLTF_VIEWER_ENGINE__ = true`
2. Reduce model complexity (lower poly count)
3. Check GPU performance in DevTools

**Problem**: Wrong animation plays

**Solutions**:
1. Check animation clip names in GLTF
2. Ensure names are unique and descriptive
3. Use exact matching instead of fuzzy matching

---

## Code References

### Key Files

| File | Lines | Description |
|------|-------|-------------|
| `index.html` | 352-369 | Quick action button HTML |
| `index.html` | 137-146 | Quick action CSS styling |
| `src/main.js` | 817-830 | Event handler setup |
| `src/main.js` | 584-626 | Animation playback logic |
| `src/main.js` | 521-526 | Animation loading from GLTF |
| `src/gltf-viewer/ViewerEngine.js` | 157-171 | High-quality renderer animation |

---

## Conclusion

The Quick Actions animation system provides an intuitive, accessible way for users to interact with the 3D avatar. The implementation leverages Three.js animation capabilities with robust fallback handling, smooth transitions, and dual rendering modes for optimal performance across devices.

The system is designed to be extensible, allowing easy addition of new emotions and custom avatars while maintaining backward compatibility with existing features.

---

**Last Updated**: January 2, 2026
**Analyzed by**: Claude Code AI Assistant
**Project**: 3D Avatar Chatbot v2.0.0
