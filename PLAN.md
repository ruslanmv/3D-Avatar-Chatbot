# 3D Avatar Chatbot — Product Readiness Plan (Phases 0–2)

## Current State Summary

The project is a **production-quality 3D Avatar Chatbot** built on Three.js
0.147.0 with:

- Multi-provider LLM support (OpenAI, Claude, Watsonx, Ollama, OllaBridge)
- Procedural animation system with modes (idle, thinking, happy, dance, talk)
- VRM expression support (happy, angry, neutral, blink, 'aa' viseme)
- WebXR VR/AR with full chat panel in VR
- Mobile/tablet responsive layout with orientation handling
- Sci-fi cyberpunk HUD aesthetic

### Identified Gaps

| Area                 | Current State                                      | Gap                                                                         |
| -------------------- | -------------------------------------------------- | --------------------------------------------------------------------------- |
| **Desktop resize**   | Camera reframes on mobile only (just fixed)        | No debounced resize; extreme aspect ratios can distort                      |
| **Mobile viewport**  | Uses `100dvh` in main-container                    | Canvas can collapse on keyboard open; portrait row sizing fragile           |
| **Android VR**       | Blocked correctly in VRSupport.js                  | No fallback messaging — user sees nothing; should route to AR or fullscreen |
| **Streaming**        | Full response buffered then displayed              | No typing indicator, no progressive text, no perceived speed                |
| **Chat persistence** | In-memory `ChatSessionHistory` (500 tokens)        | Lost on refresh; no multi-session support                                   |
| **Lip sync**         | Single 'aa' viseme toggled during `talk()`         | No rhythm, no phoneme mapping, no speech-energy correlation                 |
| **Emotion**          | Manual buttons trigger procedural modes            | No AI-driven emotion detection from LLM responses                           |
| **Blinking**         | VRMLoader has `blink()` but it's never auto-called | Avatar stares without blinking                                              |
| **Idle behavior**    | Breathing sway + mouse head tracking               | No weight shifting, no micro-movements, mannequin feeling                   |

---

## Phase 0 — Stabilize Layout, Resize, Mobile, XR Routing

**Goal**: The app becomes stable and usable across desktop resize, mobile
portrait/landscape, headset VR, and Android non-headset browsers.

### 0.1 — `styles/main.css`

**What exists**: `100dvh` already used in `.main-container` (line 135-136).
Portrait media query uses `42dvh` minimum. Viewport container has
`min-height: 320px`.

**What to fix**:

1. **Avatar area minimum height protection** — Add `min-height: 280px` to
   `.avatar-section` globally (currently only has `min-height: 0`):

    ```css
    .avatar-section {
        min-height: 280px; /* was: min-height: 0 */
        display: flex;
        flex-direction: column;
    }
    ```

2. **Prevent canvas collapse on mobile keyboard** — The viewport can shrink when
   the soft keyboard opens. Add:

    ```css
    .avatar-viewport {
        min-height: 240px; /* prevent keyboard-collapse to zero */
        contain: layout size; /* isolate from external reflows */
    }
    ```

3. **Portrait row sizing improvement** — Current portrait grid uses
   `minmax(42dvh, 58dvh)` which can over-allocate on short phones. Tighten:

    ```css
    @media (orientation: portrait) and (max-width: 768px) {
        .content-grid {
            grid-template-rows: minmax(38dvh, 55dvh) 1fr;
        }
    }
    ```

4. **480px breakpoint stability** — Current `minmax(38dvh, 52dvh)` is good. No
   change needed.

**Files**: `styles/main.css` lines 335-359, 1266-1344

### 0.2 — `src/gltf-viewer/ViewerEngine.js`

**What exists**: `_getViewportSize()` (line 531), `resize()` (line 538),
`_storeFramingState()` (line 557), `_reframeAvatarPreserveAppearance()` (line
575). Desktop resize already fixed to NOT reframe (just committed).

**What to add**:

1. **Debounced resize** — Currently `resize()` fires on every pixel of a drag.
   Add a 100ms debounce:

    ```js
    // In constructor or init:
    this._debouncedResize = this._debounce(() => this.resize(), 100);
    // Replace direct resize listener with debounced version
    ```

2. **visualViewport listener** — The `visualViewport` API gives accurate size on
   mobile when keyboard opens/closes. Add alongside the regular resize listener:

    ```js
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', this._debouncedResize);
    }
    ```

3. **Clamp camera aspect ratio** — On very wide/narrow windows, the aspect ratio
   can distort the avatar. Add a clamp in `resize()`:
    ```js
    // Clamp aspect to prevent extreme distortion
    this.camera.aspect = Math.max(0.4, Math.min(w / h, 3.0));
    ```

**Files**: `src/gltf-viewer/ViewerEngine.js` lines 531-555

### 0.3 — `src/gltf-viewer/MobileSupport.js`

**What exists**: Portrait fitOffset is 2.0, landscape is 1.65, mobile FOV is
56°, desktop is 35°.

**What to adjust**:

1. **Stronger portrait fit offset** — Increase from 2.0 to 2.2 to prevent avatar
   clipping on narrow phones:

    ```js
    const fitOffset = isPortrait ? 2.2 : 1.65;
    ```

2. **Slightly wider mobile FOV** — Increase from 56° to 58° for better framing
   on small screens:

    ```js
    this.mobileFOV = 58;
    ```

3. **More stable portrait framing** — Add a guard to prevent reframing when size
   changes are tiny (< 5%):
    ```js
    // Skip reframe if size change is trivial (< 5%)
    const sizeChangePct = Math.abs(newSize - oldSize) / oldSize;
    if (sizeChangePct < 0.05) return;
    ```

**Files**: `src/gltf-viewer/MobileSupport.js` lines 22-24, framing logic

### 0.4 — `src/gltf-viewer/VRSupport.js`

**What exists**: Android phone VR is already blocked (line 80-85). Button simply
doesn't appear — no fallback guidance.

**What to add**:

1. **Informational fallback for Android phones** — Instead of silently hiding
   the VR button, show a disabled button with a tooltip directing users to AR or
   fullscreen:
    ```js
    if (isAndroidPhone) {
        console.log('[VR] Android phone detected — VR unavailable');
        this.vrButton = document.createElement('button');
        this.vrButton.className = 'xr-btn xr-btn--vr xr-btn--disabled';
        this.vrButton.innerHTML = '<span class="xr-btn__icon">🕶</span> VR N/A';
        this.vrButton.title =
            'VR requires a headset. Try AR or fullscreen mode.';
        this.vrButton.onclick = () => {
            alert(
                'Immersive VR requires a headset (Meta Quest, etc.).\n\nTry AR mode or fullscreen for the best experience on your phone.'
            );
        };
        return;
    }
    ```

**Files**: `src/gltf-viewer/VRSupport.js` lines 80-85

### Phase 0 Deliverable

- Desktop: avatar keeps constant size on resize (done), no distortion on extreme
  ratios
- Mobile: canvas never collapses, portrait layout stable, keyboard doesn't break
  viewport
- Android phone: informational VR button with AR/fullscreen guidance
- Headset VR: unchanged (already working)

---

## Phase 1 — Core Chat UX Modernization

**Goal**: Chat feels modern with streaming responses, persistent history,
session resume, and retry-on-failure.

### 1.1 — New File: `src/ConversationStore.js`

**Purpose**: Persistent conversation storage using localStorage (upgradeable to
IndexedDB later).

**API**:

```js
class ConversationStore {
    createSession()                    // → { id, createdAt, messages: [] }
    loadSession(sessionId)             // → session | null
    saveSession(session)               // persist to localStorage
    appendMessage(sessionId, message)  // { role, content, timestamp }
    clearSession(sessionId)            // delete one session
    exportSession(sessionId)           // → JSON string
    listSessions()                     // → [{ id, createdAt, messageCount, preview }]
    getActiveSessionId()               // → current session ID
    setActiveSessionId(id)             // set current
}
```

**Storage format**: `nexus_sessions` key → JSON object mapping session IDs to
session data. Each session:
`{ id, createdAt, updatedAt, messages: [{role, content, timestamp}] }`.

**Constraints**: Max 50 sessions, 200 messages per session. Auto-prune oldest on
overflow.

**Files**: New file `src/ConversationStore.js` (~150 lines)

### 1.2 — `src/LLMManager.js` — Add Streaming

**What exists**: `sendMessage()` (line 94) dispatches to `_chatOpenAI`,
`_chatClaude`, `_chatOllama`, `_chatOllaBridge`, `_chatWatsonx`. All return full
response strings.

**What to add**: A new `sendMessageStream()` method alongside (not replacing)
`sendMessage()`:

```js
async sendMessageStream(userMessage, systemPrompt, conversationHistory, handlers) {
    // handlers = { onToken(text), onComplete(fullText), onError(err) }
    // ...dispatches to provider-specific stream methods
}
```

Provider-specific streaming methods:

- `_chatOpenAIStream(msg, sys, hist, handlers)` — SSE via
  `response.body.getReader()`, parse
  `data: {"choices":[{"delta":{"content":"..."}}]}`
- `_chatClaudeStream(msg, sys, hist, handlers)` — SSE with
  `event: content_block_delta`, parse `data: {"delta":{"text":"..."}}`
- `_chatOllamaStream(msg, sys, hist, handlers)` — NDJSON via reader, parse
  `{"message":{"content":"..."}}`
- `_chatOllaBridgeStream` — Optional, depends on bridge API support

**Keep `sendMessage()` unchanged** for backward compatibility (VR chat,
structured responses).

**Files**: `src/LLMManager.js` — add ~200 lines after line 627

### 1.3 — `src/main.js` — Refactor Message Flow

**What exists** (line 2002-2058):

```
user message → callLLM() → full response → addMessageToHistory() → speakText()
```

**New flow**:

```
user message → addMessageToHistory('user') → create pending assistant bubble
→ stream response tokens into bubble → mark complete → save to ConversationStore
→ speakText() + avatar behavior
```

**Changes**:

1. **`handleUserMessage(text)`** — Restructure to:
    - Show user message immediately
    - Create pending assistant message with typing indicator
    - Call `callLLMStream()` (new) or fall back to `callLLM()` (existing)
    - Update bubble text progressively
    - On complete: save to ConversationStore, trigger speech

2. **New helper functions**:
    - `createPendingAssistantMessage()` — Creates a chat bubble with typing
      dots, returns element reference
    - `updateMessageText(element, text)` — Updates bubble text content
      (streaming)
    - `markMessageComplete(element)` — Removes typing indicator, finalizes
      bubble
    - `showRetryButton(element, originalMessage)` — On error, show retry
      affordance in the bubble

3. **`callLLMStream(userMessage)`** — New function wrapping
   `LLMManager.sendMessageStream()`:

    ```js
    async function callLLMStream(userMessage, pendingBubble) {
        return new Promise((resolve, reject) => {
            window._nexusLLM.sendMessageStream(
                userMessage,
                systemPrompt,
                history,
                {
                    onToken: (text) => updateMessageText(pendingBubble, text),
                    onComplete: (fullText) => resolve(fullText),
                    onError: (err) => reject(err),
                }
            );
        });
    }
    ```

4. **Session restore on page load** — In `initApp()` or DOMContentLoaded:
    - Check `ConversationStore.getActiveSessionId()`
    - If exists, offer to resume (banner at top of chat)
    - On accept: reload messages into chat UI and `ChatSessionHistory`

**Files**: `src/main.js` lines 2002-2058, 2070-2105, 2371-2448

### 1.4 — `index.html` — Chat UI Additions

**What to add** (non-destructive, additive only):

1. **Typing indicator template** — Hidden template element:

    ```html
    <template id="typing-indicator-template">
        <div class="typing-indicator">
            <span class="typing-dot"></span>
            <span class="typing-dot"></span>
            <span class="typing-dot"></span>
        </div>
    </template>
    ```

2. **Session restore banner container** — Above chat history:

    ```html
    <div
        id="session-restore-banner"
        class="session-restore-banner hidden"
    ></div>
    ```

3. **ARIA live region** — For accessibility:

    ```html
    <div id="chat-live-region" aria-live="polite" class="sr-only"></div>
    ```

4. **Script tag for ConversationStore.js**:
    ```html
    <script defer src="src/ConversationStore.js"></script>
    ```

**Files**: `index.html` — in the chat section area

### 1.5 — `styles/main.css` — Chat UX Styles

**What to add** (append to existing CSS):

```css
/* Typing indicator */
.typing-indicator {
    display: flex;
    gap: 4px;
    padding: 8px 12px;
}
.typing-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--primary);
    animation: typingBounce 1.4s infinite both;
}
.typing-dot:nth-child(2) {
    animation-delay: 0.2s;
}
.typing-dot:nth-child(3) {
    animation-delay: 0.4s;
}
@keyframes typingBounce {
    0%,
    80%,
    100% {
        transform: scale(0.6);
        opacity: 0.4;
    }
    40% {
        transform: scale(1);
        opacity: 1;
    }
}

/* Streaming cursor */
.message-text.streaming::after {
    content: '▊';
    animation: blink 0.7s infinite;
    color: var(--primary);
}
@keyframes blink {
    50% {
        opacity: 0;
    }
}

/* Retry button */
.retry-btn {
    margin-top: 8px;
    padding: 4px 12px;
    font-size: 0.75rem;
    font-family: var(--font-display);
    background: rgba(255, 82, 82, 0.2);
    border: 1px solid var(--status-error);
    color: var(--status-error);
    border-radius: var(--border-radius-sm);
    cursor: pointer;
}
.retry-btn:hover {
    background: rgba(255, 82, 82, 0.3);
}

/* Session restore banner */
.session-restore-banner {
    padding: 8px 12px;
    background: rgba(0, 229, 255, 0.1);
    border: 1px solid var(--glass-border);
    border-radius: var(--border-radius-sm);
    font-size: 0.8rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
}

/* Screen reader only */
.sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    border: 0;
}
```

**Files**: `styles/main.css` — append ~60 lines

### Phase 1 Deliverable

- Typing indicator appears while waiting for response
- Text streams into the chat bubble token by token
- Chat history persists across page refreshes (localStorage)
- Session restore banner on reload
- Retry button on failed responses
- Existing `sendMessage()` and VR chat flow unchanged

---

## Phase 2 — Make the Avatar Feel Alive

**Goal**: Eliminate the mannequin feeling with blinking, breathing variation,
emotional expression, basic lip sync, and coordinated behavior states.

### 2.1 — New File: `src/EmotionEngine.js`

**Purpose**: Deterministic text-based emotion detection. No ML dependency —
keyword/pattern matching.

```js
class EmotionEngine {
    detect(text)  // → { emotion: 'happy', intensity: 0.7 }
    score(text)   // → { happy: 0.7, sad: 0.1, excited: 0.3, thinking: 0.0, neutral: 0.2 }
}
```

**Initial emotions**: `neutral`, `happy`, `sad`, `excited`, `thinking`

**Detection strategy**:

- Keyword dictionaries per emotion (e.g., happy: ["great", "wonderful", "glad",
  "awesome", ...])
- Punctuation signals (!! → excited, ? → thinking, ... → thinking)
- Sentence structure (questions → thinking, exclamations → excited/happy)
- Returns highest-scoring emotion + intensity (0.0–1.0)

**Constraints**: ~100 lines, no external deps, globally exposed as
`window.EmotionEngine`

**Files**: New file `src/EmotionEngine.js`

### 2.2 — New File: `src/LipSyncEngine.js`

**Purpose**: Synthetic lip sync that creates mouth rhythm during TTS. V1 uses
timing-based viseme cycling, not audio analysis.

```js
class LipSyncEngine {
    attachAvatar(faceAdapter)    // faceAdapter = { setViseme(name, value) }
    start(utterance, text)       // Begin lip animation tied to utterance timing
    stop()                       // Close mouth, stop animation
    update(dt)                   // Called each frame from render loop
}
```

**V1 approach**:

- Estimate syllable timing from text length and speech rate
- Cycle through viseme values: `aa` (open), `ee` (smile-open), `oh` (round),
  neutral (closed)
- Use sinusoidal variation on intensity (0.0–0.8) for natural feel
- Tie rhythm to `SpeechSynthesisUtterance` boundary events when available
- Fall back to fixed-interval cycling (120ms per phoneme) when no events

**Integration with VRMLoader**: Uses existing `setExpression('aa', value)` as
the face adapter.

**Files**: New file `src/LipSyncEngine.js` (~120 lines)

### 2.3 — New File: `src/BehaviorEngine.js`

**Purpose**: Central coordinator that decides avatar state based on conversation
events. Replaces scattered `setMode()` calls with a unified state machine.

```js
class BehaviorEngine {
    attach({ animator, vrmLoader, lipSync, emotionEngine })
    onUserListening()           // User is speaking → avatar listens
    onThinking()                // Waiting for LLM response
    onSpeechStart(text, emotion) // Avatar begins speaking
    onSpeechEnd()               // Avatar finishes speaking
    setResponseState({ text, emotion }) // Full response context
    update(dt)                  // Per-frame update
}
```

**State machine**:

```
idle → listening → thinking → speaking → idle
         ↑                        ↓
         └────────────────────────┘
```

**Each state controls**:

- `ProceduralAnimator.setMode()` — body state
- `VRMLoader.setExpression()` — facial expression
- `LipSyncEngine.start()/stop()` — mouth movement
- Gaze direction (look at camera when speaking, look around when idle)
- Auto-blink timer (every 3-6s random interval)

**Files**: New file `src/BehaviorEngine.js` (~180 lines)

### 2.4 — `src/ProceduralAnimator.js` — Add Life Channels

**What exists**: Breathing sway, mouse head tracking, mode overlays (thinking,
happy, dance, talk). All 5 modes use hard-coded bone rotations.

**What to add** (additive to existing modes):

1. **Auto-blink timer** — New public method:

    ```js
    function triggerBlink() {
        /* set head bone blink flag for external use */
    }
    ```

    Note: Actual blink is handled by VRMLoader/BehaviorEngine.
    ProceduralAnimator just needs to expose a hook.

2. **Subtle breath variation** — Current breath is a perfect sine wave. Add
   slight variation:

    ```js
    const breathRate = 2.0 + Math.sin(timeSec * 0.3) * 0.3; // 1.7–2.3 Hz
    const breath = Math.sin(timeSec * breathRate) * 0.04;
    ```

3. **Weight shift / idle sway** — Add very subtle hip lateral motion:

    ```js
    if (mode === 'idle' && bones.hips) {
        const shift = Math.sin(timeSec * 0.4) * 0.02; // very slow lateral
        applyOffsetEuler(bones.hips, new THREE.Euler(0, 0, shift));
    }
    ```

4. **Listening lean** — New mode behavior: slight forward lean when user is
   speaking:

    ```js
    } else if (mode === 'listening') {
        if (bones.spine) {
            applyOffsetEuler(bones.spine, new THREE.Euler(-0.05, 0, 0)); // lean forward
        }
        if (bones.head) {
            const tilt = Math.sin(timeSec * 1.5) * 0.08;
            applyOffsetEuler(bones.head, new THREE.Euler(0.03, 0, tilt));
        }
    }
    ```

5. **New public methods**:
    ```js
    function setEmotion(emotion, intensity) {
        /* map to mode + intensity */
    }
    function setSpeechEnergy(value) {
        /* modulate talk mode amplitude */
    }
    function setListening(active) {
        /* enter/exit listening mode */
    }
    function setGazeTarget(target) {
        /* override head look target */
    }
    ```

**Files**: `src/ProceduralAnimator.js` — add ~80 lines, modify `update()`
function

### 2.5 — `src/VRMLoader.js` — Generic Face-Rig Bridge

**What exists**: `setExpression(name, value)`, `blink()`, `talk(intensity)`,
`stopTalking()`. Only supports VRM expression manager.

**What to add**:

1. **Morph target detection** — Scan loaded model for morph targets if VRM
   expressions unavailable:

    ```js
    buildFaceRigMap() {
        // Check VRM expressionManager first
        // Fall back to scanning SkinnedMesh morphTargetDictionary
        // Map common morph target names to standard viseme/expression slots
    }
    ```

2. **Expression presets** — Named emotion presets combining multiple morph
   targets:

    ```js
    setEmotionPreset(name, weight) {
        // 'happy': smile 0.7 + squint 0.3
        // 'sad': frown 0.6 + browDown 0.4
        // 'excited': smile 0.8 + browUp 0.5
        // 'thinking': browUp 0.3 + lookUp 0.2
    }
    ```

3. **Viseme mapping** — Standard set for lip sync:

    ```js
    setViseme(name, value) {
        // Map: aa, ee, ih, oh, ou → available morph targets
        // Fall back to just 'aa' if model has limited targets
    }
    ```

4. **Auto-blink integration** — Start auto-blink timer on load:
    ```js
    startAutoBlink(minInterval = 3000, maxInterval = 6000) {
        // Random interval blinks
        // Can be paused/resumed by BehaviorEngine
    }
    ```

**Files**: `src/VRMLoader.js` — add ~100 lines

### 2.6 — `src/main.js` — Hook Everything Together

**What to change** (minimal, additive):

1. **Initialize engines** — In `initApp()` or after avatar loads:

    ```js
    window.emotionEngine = new EmotionEngine();
    window.lipSyncEngine = new LipSyncEngine();
    window.behaviorEngine = new BehaviorEngine();
    window.behaviorEngine.attach({
        animator: window.NEXUS_PROCEDURAL_ANIMATOR,
        vrmLoader: window.NEXUS_VRM_LOADER,
        lipSync: window.lipSyncEngine,
        emotionEngine: window.emotionEngine,
    });
    ```

2. **In `handleUserMessage()`** — After response complete:

    ```js
    const emotion = window.emotionEngine?.detect(displayText);
    window.behaviorEngine?.setResponseState({ text: displayText, emotion });
    ```

3. **In `speakText()`** — Replace direct `setMode('talk')` with:

    ```js
    window.behaviorEngine?.onSpeechStart(text, emotion);
    // utterance.onend:
    window.behaviorEngine?.onSpeechEnd();
    ```

4. **In speech recognition start** — Add:

    ```js
    window.behaviorEngine?.onUserListening();
    ```

5. **In LLM waiting state** — Add:
    ```js
    window.behaviorEngine?.onThinking();
    ```

**Files**: `src/main.js` — modify ~30 lines across 4 functions

### Phase 2 Deliverable

- Avatar blinks every 3-6 seconds automatically
- Breathing has natural variation (not metronomic)
- Subtle weight shift during idle
- Facial expressions react to response emotion (happy, sad, excited, thinking)
- Mouth opens/closes rhythmically during speech
- Listening lean when user speaks
- Thinking mode while waiting for LLM
- All states coordinated through BehaviorEngine
- GLB models without VRM expressions still get body-only animation (graceful
  fallback)

---

## File Impact Summary

| File                               | Phase | Action  | Risk                                   |
| ---------------------------------- | ----- | ------- | -------------------------------------- |
| `styles/main.css`                  | 0, 1  | Edit    | Low — additive CSS                     |
| `src/gltf-viewer/ViewerEngine.js`  | 0     | Edit    | Low — debounce + clamp                 |
| `src/gltf-viewer/MobileSupport.js` | 0     | Edit    | Low — tweak constants                  |
| `src/gltf-viewer/VRSupport.js`     | 0     | Edit    | Low — additive fallback                |
| `src/ConversationStore.js`         | 1     | **New** | None — new file                        |
| `src/LLMManager.js`                | 1     | Edit    | Low — add method, don't touch existing |
| `src/main.js`                      | 1, 2  | Edit    | Medium — message flow refactor         |
| `index.html`                       | 1     | Edit    | Low — add templates + script tag       |
| `src/EmotionEngine.js`             | 2     | **New** | None — new file                        |
| `src/LipSyncEngine.js`             | 2     | **New** | None — new file                        |
| `src/BehaviorEngine.js`            | 2     | **New** | None — new file                        |
| `src/ProceduralAnimator.js`        | 2     | Edit    | Low — additive modes                   |
| `src/VRMLoader.js`                 | 2     | Edit    | Low — additive methods                 |

**New files**: 4 (`ConversationStore.js`, `EmotionEngine.js`,
`LipSyncEngine.js`, `BehaviorEngine.js`) **Modified files**: 8 **Deleted
files**: 0

All changes are **additive and non-destructive**. Existing APIs
(`sendMessage()`, `setMode()`, `setExpression()`) remain unchanged. New
functionality layers on top.
