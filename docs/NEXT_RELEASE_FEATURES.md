# Next Release Feature Roadmap

This document outlines planned features for future releases, organized by complexity and priority.

## 📋 NEXT RELEASE (Medium Complexity)

### 1. Avatar Wrapper Centering
**Priority:** High
**Complexity:** Medium
**Description:** Refactor `frameObjectToCamera()` to use pivot groups instead of directly mutating avatar position. This provides more stable centering for models with complex rigs and animations.

### 2. Procedural Idle Breathing
**Priority:** High
**Complexity:** Medium
**Description:** Add subtle procedural animation (breathing, head sway) when GLB has no animations. Makes every avatar feel alive even without animation clips.

### 3. Chat-Driven Animation
**Priority:** High
**Complexity:** Medium
**Description:** Automatically trigger animations based on message content:
- Questions → "thinking" animation
- Greetings → "wave" animation
- Excitement → "happy" animation
- While speaking → "talk" animation loop

### 4. Camera Controls Panel
**Priority:** Medium
**Complexity:** Medium
**Description:** Add UI panel with:
- Auto Frame button
- Reset View button
- Zoom to Head preset
- Zoom to Full Body preset
- FOV slider
- Toggle orbit pan

### 5. Voice Selector
**Priority:** Medium
**Complexity:** Medium
**Description:** Allow users to select TTS voice with:
- Voice selection dropdown
- Speed/pitch controls
- Mute toggle
- Preview button

### 6. Avatar Library Enhancements
**Priority:** Medium
**Complexity:** Medium
**Description:** Improve avatar selection UX:
- Search/filter avatars
- Preview thumbnails
- Favorite avatars (localStorage)
- Recently used list
- Last used avatar persistence

### 7. Conversation Export/Copy
**Priority:** Low
**Complexity:** Medium
**Description:** Add chat management features:
- Copy individual messages
- Export full conversation (JSON/TXT)
- Search within conversation
- System messages in timeline

---

## 🚀 FUTURE RELEASE (High Complexity)

### 8. ZIP Upload for GLTF Bundles
**Priority:** Medium
**Complexity:** High
**Description:** Support uploading .gltf files with external resources (textures, .bin) via ZIP file or folder upload.

### 9. DRACO/KTX2 Support
**Priority:** Low
**Complexity:** High
**Description:** Add support for compressed GLB files using DRACO geometry compression and KTX2 texture compression.

### 10. Enhanced Emotion System
**Priority:** Low
**Complexity:** High
**Description:** Upgrade emotion system beyond animation clips:
- Procedural poses when no animation exists
- Dynamic lighting per emotion
- Facial expression hints
- Movement style variations

### 11. Server Proxy for API Keys
**Priority:** High (Security)
**Complexity:** Very High
**Description:** Add backend proxy to protect API keys. Requires server development and deployment infrastructure.

### 12. Asset Performance Tooling
**Priority:** Low
**Complexity:** High
**Description:** Display performance metrics for loaded models:
- Polycount estimation
- Texture memory usage
- Model size warnings
- Optimization suggestions

---

## ✅ COMPLETED (Current Release)

### Smart Scroll in Chat
**Status:** ✅ Implemented
**Description:** Only auto-scrolls chat if user is already near bottom, prevents interrupting reading.

### Persist Chat History
**Status:** ✅ Implemented
**Description:** Saves and restores chat history from localStorage across sessions.

### Timestamps on Messages
**Status:** ✅ Implemented
**Description:** All chat messages show timestamp (HH:MM format).

### Stop TTS When Mic Starts
**Status:** ✅ Implemented
**Description:** Automatically cancels ongoing speech synthesis when user starts voice input.

### Better Progress Indication
**Status:** ✅ Existing
**Description:** GLTFLoader progress callback already connected to loading UI.

---

## Implementation Notes

### Quick Wins (Can be added incrementally)
- Procedural idle breathing
- Chat-driven animation
- Voice selector
- Avatar favorites

### Requires Architecture Changes
- Avatar wrapper centering (affects framing system)
- ZIP upload (requires new file handling)
- Server proxy (requires backend)

### Dependencies
- DRACO support requires `three/examples/jsm/libs/draco/`
- KTX2 support requires `three/examples/jsm/libs/basis/`
- ZIP upload requires JSZip library

---

**Last Updated:** 2025-12-16
**Current Version:** 2.0.0
