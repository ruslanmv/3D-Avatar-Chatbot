# Avatar Pose System

Complete reference for the avatar pose preset system. Covers all available poses,
the API for programmatic control (useful for AI-driven pose selection), and
how VR and Desktop stay synchronized.

## Architecture

The pose system has two layers:

| Layer | File | Purpose |
|-------|------|---------|
| **VRPoseSystem** | `src/gltf-viewer/VRPoseSystem.js` | Full-body IK-grade poses with spring-damped blending. Primary system. |
| **PoseNormalizer** | `src/PoseNormalizer.js` | Legacy T-pose correction (arms only). Desktop fallback. |

VRPoseSystem is the authoritative source. It runs on both desktop and VR.
Changes made in either context sync via the `vr-pose-changed` event.

## Available Pose Presets (22 total)

### Chat / Everyday Poses

These are the primary poses for conversation and interaction.

| Preset Key | Label | Description | Best For |
|------------|-------|-------------|----------|
| `standingRelaxed` | Standing (Relaxed) | Arms at sides, slight S-curve weight shift, subtle head tilt. **Default pose.** | General chat, idle, spawn |
| `standingFriendly` | Standing (Friendly) | Asymmetric arm hang, warmer body language, engaged head angle. | Companion interaction, warm conversation |
| `standingHandsClasped` | Standing (Hands Clasped) | Hands clasped in front, professional upright posture. | Secretary, presenter, formal context |
| `sitting` | Sitting | Standard chair sit, legs at 90deg, spine leaned back slightly. | Chair, bench, any seated surface |
| `sittingCrossed` | Sitting (Crossed) | Left leg crossed over right, casual sitting. | Casual conversation while seated |
| `sittingDesk` | Sitting (Desk) | Forward lean, arms on desk surface, looking down at work. | Working at desk, typing, writing |
| `sittingLegsUp` | Sitting (Lounging) | Reclined, legs up, arms resting on sides. | Couch, sofa, casual lounging |
| `kneelingUp` | Kneeling (Up) | Knees on ground, torso upright, hands on thighs, looking up. | Attentive kneeling, eye-level with seated user |

### Rest / Lounge Poses

Relaxed poses for non-standing scenarios.

| Preset Key | Label | Description | Best For |
|------------|-------|-------------|----------|
| `lyingBackRelaxed` | Lying (Relaxed) | Supine, one leg bent, one arm behind head, natural asymmetry. | Relaxed lying, intimate conversation |
| `lyingBack` | Lying (Back) | Supine, symmetrical, arms out to sides. | Formal lying pose |
| `lyingSide` | Lying (Side) | Side-lying, legs staggered, arms positioned naturally. | Side rest |
| `lyingFront` | Lying (Front) | Face down (prone), arms forward, head turned. | Face-down rest |
| `allFours` | All Fours | Hands and knees, torso horizontal, head facing forward. | Ground pose |
| `kneeling` | Kneeling | Seiza-style, sitting on heels, shins folded back. | Formal kneeling |

### Adult Poses (18+)

For mature VR companion applications.

| Preset Key | Label | Description |
|------------|-------|-------------|
| `lyingBackOpen` | Lying (Open) | Supine, legs bent and spread, arms up near head. |
| `lyingFrontArched` | Lying (Arched) | Prone with back arched upward, hands near head. |
| `kneelingPresent` | Kneeling (Present) | Knees apart, hands behind back, looking up. |
| `allFoursArched` | All Fours (Arched) | Wider stance, deeper spine arch than standard all-fours. |
| `standingBendForward` | Standing (Bent Over) | Torso bent forward at waist, arms hanging. |
| `lyingSideSeductive` | Lying (Side Pose) | Side-lying propped on elbow, top knee bent, looking at viewer. |

### Technical

| Preset Key | Label | Description |
|------------|-------|-------------|
| `standing` | Standing (Rest / T-Pose) | VRM rest pose (T-pose). Arms at 90deg. For debug/reset only. |

## Cycle Order

When cycling poses with the VR panel POSE button, presets follow this order:

```
Chat → standingRelaxed → standingFriendly → standingHandsClasped
     → sitting → sittingCrossed → sittingDesk → sittingLegsUp → kneelingUp

Rest → lyingBackRelaxed → lyingBack → lyingSide → lyingFront
     → allFours → kneeling

Adult → lyingBackOpen → lyingFrontArched → kneelingPresent
      → allFoursArched → standingBendForward → lyingSideSeductive

Tech → standing (T-Pose)
```

## API Reference (for AI / LLM Integration)

The AI can control avatar poses programmatically via `window.vrPoseSystem`.
This is the recommended interface for LLM-driven pose selection.

### Apply a Pose

```javascript
// Apply a pose with smooth blending (0.6s transition)
window.vrPoseSystem.applyPreset('sittingDesk', 0.6);

// Quick snap (0.2s)
window.vrPoseSystem.applyPreset('standingRelaxed', 0.2);

// Slow dramatic transition (1.5s)
window.vrPoseSystem.applyPreset('lyingBackRelaxed', 1.5);
```

### Query Current Pose

```javascript
// Get current preset name
const current = window.vrPoseSystem.getCurrentPreset();
// → 'standingRelaxed'
```

### List All Available Poses

```javascript
// Get all preset names (string array)
const names = VRPoseSystem.getPresetNames();
// → ['standingRelaxed', 'standingFriendly', ..., 'standing']

// Get names with labels (for UI)
const list = window.vrPoseSystem.getPresetList();
// → [{ name: 'standingRelaxed', label: 'Standing (Relaxed)' }, ...]

// Get label for a specific preset
const label = VRPoseSystem.getPresetLabel('sittingDesk');
// → 'Sitting (Desk)'
```

### Cycle to Next Pose

```javascript
const next = window.vrPoseSystem.cyclePreset();
// → 'standingFriendly' (returns new preset name)
```

### Reset to Default

```javascript
window.vrPoseSystem.resetToRest();
// Blends back to T-pose (0.4s)
```

### Listen for Pose Changes

```javascript
// Fires whenever a pose preset is applied (from VR or desktop)
window.addEventListener('vr-pose-changed', (e) => {
    console.log('Pose changed to:', e.detail.preset);
    // e.detail.preset → 'sittingDesk'
});
```

## AI Pose Selection Guide

When an AI (LLM) needs to choose a pose for the avatar, use these guidelines:

### Context-Based Selection

| User Context | Recommended Pose | Reasoning |
|--------------|-----------------|-----------|
| General conversation | `standingRelaxed` | Natural, non-distracting default |
| Warm/friendly chat | `standingFriendly` | More engaged body language |
| Professional/formal | `standingHandsClasped` | Secretary/assistant stance |
| User says "sit down" | `sitting` | Standard chair sit |
| Working at desk | `sittingDesk` | Arms on desk, forward lean |
| Casual/relaxed mood | `sittingLegsUp` | Lounging posture |
| User is seated (VR) | `sittingCrossed` | Casual seated to match user |
| Attentive/submissive | `kneelingUp` | Looking up at user |
| Resting/intimate | `lyingBackRelaxed` | Relaxed supine |

### Implementation Example (LLM Function Call)

```javascript
// In your LLM response handler, parse pose intent:
function handleAIPoseIntent(intent) {
    const vps = window.vrPoseSystem;
    if (!vps || !vps.enabled) return;

    const poseMap = {
        'greeting':     'standingFriendly',
        'working':      'sittingDesk',
        'relaxing':     'sittingLegsUp',
        'listening':    'standingRelaxed',
        'presenting':   'standingHandsClasped',
        'resting':      'lyingBackRelaxed',
        'attentive':    'kneelingUp',
    };

    const pose = poseMap[intent] || 'standingRelaxed';
    vps.applyPreset(pose, 0.6);
}
```

### Tool Definition for LLM

If exposing pose control as an LLM tool/function:

```json
{
    "name": "set_avatar_pose",
    "description": "Change the 3D avatar's body pose. Use this when the conversation context suggests a different posture would be more natural.",
    "parameters": {
        "type": "object",
        "properties": {
            "pose": {
                "type": "string",
                "enum": [
                    "standingRelaxed", "standingFriendly", "standingHandsClasped",
                    "sitting", "sittingCrossed", "sittingDesk", "sittingLegsUp",
                    "kneelingUp", "lyingBackRelaxed", "lyingBack", "lyingSide",
                    "lyingFront", "allFours", "kneeling",
                    "lyingBackOpen", "lyingFrontArched", "kneelingPresent",
                    "allFoursArched", "standingBendForward", "lyingSideSeductive",
                    "standing"
                ],
                "description": "The pose preset to apply"
            },
            "transition_speed": {
                "type": "number",
                "description": "Blend duration in seconds (0.2 = fast snap, 0.6 = smooth, 1.5 = slow dramatic)",
                "default": 0.6
            }
        },
        "required": ["pose"]
    }
}
```

## Desktop / VR Sync

Both interfaces share the same VRPoseSystem instance via `window.vrPoseSystem`:

```
Desktop Dropdown (index.html #vr-pose-preset)
    │
    ├── change event → vrPoseSystem.applyPreset()
    │                       │
    │                       ├── Blends bones via spring damper
    │                       └── Dispatches 'vr-pose-changed' event
    │                                          │
    │                                          └── VR Panel listens → updates label
    │
VR Panel POSE Button (VRChatPanel.js)
    │
    └── tap → vrPoseSystem.cyclePreset()
                    │
                    ├── Blends bones
                    └── Dispatches 'vr-pose-changed' event
                                       │
                                       └── Desktop dropdown listens → updates selection
```

Priority: VR changes always win. Desktop is a convenience mirror.

## PLACE Button (Furniture Placement)

The PLACE button in the VR panel is a one-tap combo for placing the avatar on
real furniture in passthrough mode:

| Tap | Action |
|-----|--------|
| **Activate** | Enables passthrough + applies `sitting` pose + enables puppet mode |
| **Deactivate** | Restores VR background + applies `standingRelaxed` + disables puppet |

Workflow:
1. Tap PLACE in VR settings panel
2. See your real room through passthrough
3. Avatar sits automatically
4. Grab the hips handle to drag avatar onto your real chair
5. Two-hand grip on hips to rotate
6. Tap PLACE again to exit

## Bone Reference

Each pose defines rotations for a subset of these humanoid bones:

```
                    head
                     │
                    neck
                     │
                 upperChest
                     │
                   chest
                  /     \
        leftShoulder   rightShoulder
              │               │
        leftUpperArm    rightUpperArm
              │               │
        leftLowerArm    rightLowerArm
              │               │
          leftHand        rightHand
                     │
                   spine
                     │
                    hips
                   /    \
        leftUpperLeg    rightUpperLeg
              │               │
        leftLowerLeg    rightLowerLeg
              │               │
          leftFoot        rightFoot
```

Rotations are specified as quaternions derived from Euler degrees (X=pitch, Y=yaw, Z=roll)
relative to the VRM rest pose (T-pose).
