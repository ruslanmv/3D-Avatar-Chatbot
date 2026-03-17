# Spicy Mode — Design Plan

## Overview

Additive, non-destructive toggle that gates adult/18+ content behind a
localStorage flag + age-verification modal. When **OFF** (default), the app
behaves exactly as today — no adult poses, animations, or behaviors are visible.
When **ON**, mature MMORPG-style features unlock progressively.

---

## Architecture (3 layers)

```
┌─────────────────────────────────────────────────┐
│  1. GATE   — Age verification modal + toggle    │
│  2. STORE  — localStorage flag + strength slider │
│  3. FILTER — Every system reads the flag & hides │
│              adult content when OFF              │
└─────────────────────────────────────────────────┘
```

### Layer 1 — Gate (SpicyGate.js, new file)

- **Age Verification Modal**: First time the user enables spicy mode, a modal
  appears requiring:
    - Checkbox: "I am 18+ and consent to viewing adult content"
    - Confirm button (disabled until checkbox is checked)
    - Cancel button (returns to safe mode)
- Once verified, stores `nexus_spicy_verified: true` in localStorage so the
  modal doesn't re-appear every session.
- **Toggle in Settings Modal**: A new section "Content Mode" added to the
  existing settings modal (`#settings-modal`) with:
    - ON/OFF toggle switch (default OFF)
    - Spicy Strength slider (0–100%, default 30%) — controls how far adult
      content goes
    - Visual indicator: green "SFW" badge when off, red/purple "18+" badge when
      on

### Layer 2 — Store (SpicyModeStore in SpicyGate.js)

Single source of truth, exposed as `window.NEXUS_SPICY`:

```js
window.NEXUS_SPICY = {
  enabled: false,         // master toggle
  verified: false,        // age gate passed
  strength: 0.3,          // 0..1 intensity dial
  isEnabled()  → bool,    // enabled && verified
  getStrength() → number,
  setEnabled(bool),       // persists to localStorage
  setStrength(number),    // persists to localStorage
  onChange(callback),      // subscribe to changes
};
```

**localStorage keys:**

- `nexus_spicy_enabled` — `"true"` / `"false"`
- `nexus_spicy_verified` — `"true"` / `"false"`
- `nexus_spicy_strength` — `"0.3"` (float string)

### Layer 3 — Filter (all existing systems check the flag)

Every system that exposes content checks `NEXUS_SPICY.isEnabled()`:

| System                   | What gets gated                                                                        | How                                                          |
| ------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **VRPoseSystem**         | 7 adult poses (lyingBackOpen, lyingFrontArched, kneelingPresent, allFoursArched, etc.) | `getPresetOrder()` filters out adult poses when OFF          |
| **PoseStudioPanel**      | NAV_PRESETS adult entries                                                              | `refresh()` skips adult-category poses when OFF              |
| **AnimationManager**     | Adult emotions/clips                                                                   | `getAvailableAnimations()` filters by flag                   |
| **ProceduralAnimator**   | Adult modes + talk styles                                                              | New adult modes only activate when ON                        |
| **PersonaContextBridge** | Adult persona behaviors                                                                | `requiresAdultGate()` already exists — wire it to the toggle |
| **LLM System Prompt**    | Adult conversation style                                                               | Append spicy context to system prompt when ON                |

---

## Adult Pose Classification

Tag each pose in VRPoseSystem with `{ adult: true }`:

**Already existing (currently always visible — will be gated):**

- `lyingBackOpen` — Legs spread supine
- `lyingFrontArched` — Prone with arched back
- `kneelingPresent` — Kneeling, knees apart
- `allFoursArched` — All fours, deep arch

**New poses to add (spicy-only):**

- `standingSeductive` — Weight on one hip, hand on hip, chin down eyes up
- `wallLean` — Back against wall, one knee up, arms relaxed
- `lapSitting` — Seated as if on someone's lap, legs to one side
- `embraceStanding` — Arms forward as if holding someone, slight lean
- `kneelSubmissive` — Kneeling, head down, hands on thighs
- `lyingSprawl` — Supine, one arm above head, relaxed sprawl

**New adult ProceduralAnimator modes:**

- `flirt` — Subtle hair touch, hip sway, lip bite (VRM morph)
- `tease` — Playful shoulder shrug, wink cycle, weight shift
- `intimate` — Slow breathing, gentle sway, soft gaze hold

**New adult talk styles:**

- `whisperIntimate` — Minimal gestures, close lean, slow pace
- `playfulTease` — Animated eyebrow, head tilt, finger wag

---

## Spicy Strength Tiers (progressive unlock)

| Strength  | Label        | What unlocks                                                                                                      |
| --------- | ------------ | ----------------------------------------------------------------------------------------------------------------- |
| 0.0–0.33  | **Mild**     | Companion poses (already visible), flirty talk style, suggestive persona tone                                     |
| 0.34–0.66 | **Moderate** | Seductive poses (wallLean, standingSeductive, lapSitting), tease mode, romantic animations                        |
| 0.67–1.0  | **Bold**     | All adult poses (kneelingPresent, allFoursArched, lyingBackOpen, etc.), intimate mode, explicit persona behaviors |

---

## MMORPG-Inspired Features (Spicy Mode Only)

Drawing from adult MMORPGs (e.g., Second Life, 3DXChat, Virt-A-Mate):

### 1. Interaction Emotes System

When spicy mode is ON, the emotion panel gains extra emote buttons:

- **Mild**: Wink, Blow Kiss, Shy Smile, Hair Flip
- **Moderate**: Come Hither, Slow Dance, Caress (self), Stretch
- **Bold**: Lap Dance, Strip Tease, Moan, Arch Back

Each emote = a combination of VRM expression + ProceduralAnimator mode +
optional sound.

### 2. Outfit Slots (metadata-only, future-ready)

AnimationManager gets an `OUTFIT_REGISTRY` for future VRM model swapping:

- `casual`, `formal`, `sleepwear`, `swimwear`
- Spicy-only: `lingerie`, `bodysuit`, `leather`, `sheer`, `cosplay_adult`
- Stored as metadata tags — actual model swapping is a future feature

### 3. Scene Moods

AI-driven ambient context that changes avatar behavior:

- **SFW**: `professional`, `friendly`, `educational`
- **Spicy Mild**: `romantic`, `flirty`, `playful`
- **Spicy Moderate**: `sensual`, `seductive`, `passionate`
- **Spicy Bold**: `intimate`, `explicit`, `dominant`, `submissive`

Each mood maps to: basePose + talkStyle + emotion + VRM expression preset

### 4. Roleplay Scenario Presets

Pre-configured character behavior sets the AI can select:

- **Mild**: Date Night, Movie Companion, Dance Partner
- **Moderate**: Massage Therapist, Personal Trainer, Fashion Model
- **Bold**: Bedroom Scene, Bath Scene, Fantasy Encounter

### 5. Touch Interaction Zones (future VR feature)

Metadata definition for interactive body zones:

- **SFW**: Head pat, Handshake, High five, Shoulder touch
- **Spicy**: Caress cheek, Hold hands, Hug, Kiss
- **Bold**: Full body interaction zones

---

## Files to Create / Modify

### New Files

| File               | Purpose                                       |
| ------------------ | --------------------------------------------- |
| `src/SpicyGate.js` | Store + Age verification modal + Toggle logic |

### Modified Files

| File                              | Changes                                                                                                  |
| --------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `index.html`                      | Add spicy toggle section to settings modal, add age verification modal HTML, add SpicyGate.js script tag |
| `src/gltf-viewer/VRPoseSystem.js` | Add `adult: true` tag to adult poses, add 6 new adult poses, filter `getPresetOrder()`                   |
| `src/PoseStudioPanel.js`          | Add `adult` category, filter NAV_PRESETS by spicy flag, add spicy emote buttons                          |
| `src/AnimationManager.js`         | Add adult emotions/modes to registries, gate them behind spicy check, add MOOD_PRESETS                   |
| `src/ProceduralAnimator.js`       | Add `flirt`, `tease`, `intimate` modes + `whisperIntimate`, `playfulTease` talk styles                   |
| `src/PersonaContextBridge.js`     | Wire `requiresAdultGate()` to SpicyGate, append spicy context to system prompt                           |
| `src/main.js`                     | Initialize SpicyGate, wire settings save/load                                                            |
| `styles/main.css`                 | Styles for spicy toggle, age modal, strength slider, 18+ badge                                           |

---

## Safety Guardrails

1. **Default OFF** — App ships with spicy mode disabled
2. **Age gate required** — Cannot enable without explicit 18+ consent checkbox
3. **No auto-enable** — Even if localStorage is manually set, `verified` must
   also be true
4. **Tier 1 absolute blocks** — Even in bold mode, block: minors,
   non-consensual, illegal content
5. **Visual indicator** — When spicy mode is on, a small 🔥 badge appears in the
   UI header so it's always clear
6. **Session-aware** — Persona's `requiresAdultGate()` prevents loading adult
   personas without the toggle
7. **Clean separation** — All adult content is tagged/categorized, never mixed
   into SFW arrays
8. **Reversible** — Toggling OFF immediately hides all adult content, no page
   reload needed

---

## Implementation Order

1. **SpicyGate.js** — Store + age verification modal + toggle (standalone, no
   dependencies)
2. **index.html + CSS** — Settings UI toggle + age modal markup + styles
3. **VRPoseSystem.js** — Tag existing adult poses + add 6 new ones + filter
4. **PoseStudioPanel.js** — Filter NAV_PRESETS + add spicy emotes section
5. **ProceduralAnimator.js** — Add flirt/tease/intimate modes + whisper/playful
   talk styles
6. **AnimationManager.js** — Add adult registries + mood presets + gating
7. **PersonaContextBridge.js + main.js** — Wire everything together
8. **Prettier + commit + push**
