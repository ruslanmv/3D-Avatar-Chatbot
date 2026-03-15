# UI Upgrade Plan — Responsive Layout Overhaul

## Feasibility Analysis

### Verdict: FEASIBLE but HIGH-RISK if done as a wholesale replacement

The proposed upgrade addresses real problems — the current layout **does** break
on mobile (chat hidden, VR dominates, input inaccessible). However, a copy-paste
replacement would **immediately break the entire application** because of deep
coupling between JS and HTML.

### Why a direct paste will break everything

| Issue                      | Current Code                                         | Proposed Upgrade                      | Impact                        |
| -------------------------- | ---------------------------------------------------- | ------------------------------------- | ----------------------------- |
| 3D viewport ID             | `avatar-viewport`                                    | `avatarViewport`                      | Canvas won't mount            |
| Chat input ID              | `speech-text`                                        | `chatInput`                           | Send broken                   |
| Send button ID             | `speak-btn`                                          | `sendBtn`                             | Send broken                   |
| Voice button ID            | `listen-btn`                                         | `voiceBtn`                            | Voice broken                  |
| Chat container ID          | `chat-history`                                       | `chatMessages`                        | Messages invisible            |
| Message CSS class          | `.chat-message .user` / `.avatar`                    | `.message .user` / `.assistant`       | Styling broken                |
| Settings modal             | Full modal with 40+ config fields                    | **Not included at all**               | All settings lost             |
| Avatar selector            | `avatar-select` dropdown + upload                    | Not included                          | Can't switch avatars          |
| Emotion buttons            | `.emotion-btn[data-emotion]`                         | Not included                          | Quick actions lost            |
| AI provider config         | 6 providers, API keys, models                        | Not included                          | LLM connection lost           |
| TTS/STT settings           | Language, voice, rate, pitch, provider               | Not included                          | Speech config lost            |
| Collapsible panels         | `[data-collapsible]` system                          | Not included                          | Panel UX lost                 |
| XR launch bar              | Created by ViewerEngine, placed in `.avatar-section` | Not included                          | VR/AR buttons disappear       |
| engine-bridge.js fallbacks | Tries 6 different container selectors                | Only one ID                           | Bridge may fail               |
| Status system              | `status-badge`, `status-indicator`, `status-text`    | `avatarStateText`, `connectionStatus` | Status display broken         |
| CSS variables              | 30+ `--` vars (Orbitron/Rajdhani fonts)              | Completely different var names        | Design system conflict        |
| main.js                    | 2549 lines with 57+ element bindings                 | 100-line minimal stub                 | 95% of app logic disconnected |

### What the proposed upgrade gets RIGHT

1. **Two-column desktop layout** (avatar left, chat right) — better than current
   (avatar left, controls right)
2. **Chat-first mobile** — avatar compact on top, chat fills remaining space
3. **Sticky input bar** with `env(safe-area-inset-bottom)` — keyboard-safe
4. **Desktop side panel** for branding + quick actions — cleaner hierarchy
5. **100dvh** usage — proper mobile viewport handling
6. **Top bar** with inline controls — saves vertical space
7. **Simpler message bubbles** — cleaner chat UX

### What the proposed upgrade LOSES

1. **Settings modal** (AI provider, API keys, TTS/STT, background, system
   prompt)
2. **Avatar management** (preset selector, file upload)
3. **Emotion/animation controls** (idle, happy, thinking, dance)
4. **XR launch bar integration** (VR + AR buttons from ViewerEngine)
5. **Loading overlay** (progress bar, status text)
6. **HUD overlay** (corner brackets, status badge)
7. **Collapsible panels** (space-efficient mobile UX)
8. **All 2549 lines of main.js logic** (replaced with 100-line stub)
9. **Cyberpunk design language** (Orbitron font, glow effects, glass panels)
10. **OllaBridge pairing** flow
11. **Microphone selection** and STT provider switching

---

## Recommended Strategy: Incremental Migration (4 Phases)

Instead of replacing everything, we adapt the **existing** HTML/CSS/JS to
achieve the same layout goals without breaking any functionality.

### Phase 1 — Layout Grid Restructure (index.html + main.css)

**Goal**: Desktop two-column (avatar+chat), mobile stacked (compact avatar +
chat)

**Changes**:

1. **index.html**: Restructure `.content-grid` to put chat beside avatar (not in
   a sidebar)
    - Move chat input + history from `.control-panel` into a new `.chat-panel`
      section
    - Keep `.control-panel` as a collapsible drawer (desktop: side panel,
      mobile: hamburger menu)
    - Keep all existing element IDs — zero JS breakage

2. **main.css**: New grid rules
    - Desktop: `grid-template-columns: minmax(300px, 38%) minmax(0, 1fr)`
      (avatar | chat)
    - Mobile <=768px: single column, avatar `170px` fixed, chat fills rest
    - Add `overflow: hidden` on `.chat-panel` with internal scroll on messages
    - Move settings/avatar/emotions into a slide-out drawer

3. **Preserve**: All element IDs, all JS bindings, settings modal, XR launch bar

### Phase 2 — Top Bar + Mobile Input Fix (index.html + main.css)

**Goal**: Compact header, always-visible input, keyboard-safe layout

**Changes**:

1. **index.html**: Convert `.header` to a compact top bar
    - Move key action buttons (Settings, Voice, VR) into the top bar
    - Add hamburger menu button for mobile (opens drawer with avatar selector,
      emotions, etc.)
    - Add `enterkeyhint="send"` to chat input

2. **main.css**: Sticky input + safe area
    - Chat input footer: `position: sticky; bottom: 0` with
      `padding-bottom: env(safe-area-inset-bottom)`
    - Top bar: `position: sticky; top: 0; z-index: 30`
    - Body: `overflow: hidden` (prevent rubber-band on iOS)

3. **main.js**: Wire hamburger menu toggle (simple classList toggle)

### Phase 3 — Chat UX Polish (main.css + main.js)

**Goal**: Better message bubbles, typing indicator, quick actions

**Changes**:

1. **main.css**: Upgrade message bubble styles
    - User messages: right-aligned, accent gradient
    - Assistant messages: left-aligned, dark glass
    - Max-width: `min(78%, 620px)`
    - Typing indicator with animated dots

2. **main.js**: Add typing indicator show/hide around LLM calls

3. **index.html**: Add quick action chips below input (Hello, Help, Demo)
    - Wire to existing `handleChat()` function

### Phase 4 — Desktop Side Panel (index.html + main.css)

**Goal**: Clean desktop experience with utility sidebar

**Changes**:

1. **index.html**: Add optional `<aside class="side-panel desktop-only">` with:
    - Brand card (HomePilot Avatar)
    - Connection status
    - Quick actions grid
    - Desktop VR/Settings shortcuts

2. **main.css**: Three-column desktop grid
   `320px minmax(300px, 38%) minmax(0, 1fr)`

3. **Preserve**: Mobile stays two-section (compact avatar + chat)

---

## File Change Map

| File              | Phase 1          | Phase 2          | Phase 3            | Phase 4           |
| ----------------- | ---------------- | ---------------- | ------------------ | ----------------- |
| `index.html`      | Restructure grid | Add top bar      | Add typing + chips | Add side panel    |
| `styles/main.css` | New grid rules   | Sticky input     | Message polish     | Side panel CSS    |
| `src/main.js`     | —                | Hamburger toggle | Typing indicator   | Side panel wiring |

**Zero changes** to ViewerEngine.js, VRSupport.js, ARSupport.js,
MobileSupport.js, ModelViewerAR.js — all gltf-viewer modules remain untouched.

---

## Risk Mitigation

- **Every phase is independently deployable** — no phase depends on the next
- **All element IDs preserved** — zero JS breakage at any point
- **Settings modal untouched** — full AI provider config stays working
- **XR launch bar untouched** — VR/AR buttons auto-place via ViewerEngine
- **Git branch per phase** — easy rollback if something breaks
- **Mobile testing checkpoint** after each phase

---

## Estimated Scope

| Phase     | Files Changed | Lines Added/Modified | Complexity |
| --------- | ------------- | -------------------- | ---------- |
| Phase 1   | 2             | ~200                 | Medium     |
| Phase 2   | 3             | ~150                 | Medium     |
| Phase 3   | 3             | ~100                 | Low        |
| Phase 4   | 3             | ~150                 | Low        |
| **Total** | **3 files**   | **~600 lines**       | **Medium** |

This achieves the same end result as the proposed upgrade but without breaking
anything.
