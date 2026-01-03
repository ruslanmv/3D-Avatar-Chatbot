# VR Controller Guide - Meta Quest Controls

Complete guide to using VR controllers with the 3D Avatar Chatbot.

## 🎮 **Controller Layout**

### **Meta Quest 2/3 Controllers**

```
           [Y]     Left Controller           Right Controller    [B]
            |                                                      |
       [X]--●--[Menu]                                     [Oculus]--●--[A]
            |                                                      |
        [Thumbstick]                                        [Thumbstick]
            |                                                      |
        [Trigger]                                              [Trigger]
            |                                                      |
         [Grip]                                                 [Grip]
```

## 🕹️ **Controls**

### **Movement (Left Controller)**

| Input           | Action              | Speed           |
| --------------- | ------------------- | --------------- |
| **Left Stick**  | Move Forward/Back   | Adjustable      |
|                 | Strafe Left/Right   | Default: 0.05   |
| **Left Trigger**| Select/Click        | -               |
| **Left Grip**   | Special Action      | -               |

**How to move:**
```
Push Stick Forward  → Move forward in view direction
Push Stick Back     → Move backward
Push Stick Left     → Strafe left
Push Stick Right    → Strafe right
```

### **Camera (Right Controller)**

| Input            | Action           | Speed           |
| ---------------- | ---------------- | --------------- |
| **Right Stick**  | Turn Left/Right  | Adjustable      |
|                  |                  | Default: 0.02   |
| **Right Trigger**| Select/Click     | -               |
| **Right Grip**   | Special Action   | -               |

**How to turn:**
```
Push Stick Left   → Turn left
Push Stick Right  → Turn right
```

### **Interaction (Both Controllers)**

| Input            | Action                        |
| ---------------- | ----------------------------- |
| **Point at UI**  | Cyan ray appears              |
| **Trigger**      | Click button/select object    |
| **Ray turns green**| Hovering over clickable item|

## 🎯 **Features**

### ✅ **Locomotion**

**Smooth Movement:**
- Walk around the virtual space
- Move relative to where you're looking
- Adjustable speed (default: medium)
- Deadzone to prevent drift (15%)

**Rotation:**
- Smooth turning with right thumbstick
- Turn your viewpoint left/right
- No snap turning (smooth only)

### ✅ **Ray Interaction**

**Visual Feedback:**
- **Cyan ray** = Default (no hit)
- **Green ray** = Hovering over clickable object
- **Ray length** = Distance to object

**Clickable Elements:**
- UI buttons
- Avatar (for expressions/animations)
- Menu items
- Custom objects

### ✅ **Controller Visualization**

- **Cyan spheres** = Controller positions
- **Cyan rays** = Pointing direction
- **Smooth tracking** = 6DOF movement

## 🔧 **Settings**

### **Adjust Movement Speed**

Currently requires code edit (will add UI later):

```javascript
// In src/gltf-viewer/VRControllers.js
this.moveSpeed = 0.05;  // Default: 0.05 (medium)
// Try: 0.03 (slow), 0.10 (fast)
```

### **Adjust Turn Speed**

```javascript
this.turnSpeed = 0.02;  // Default: 0.02 (medium)
// Try: 0.01 (slow), 0.04 (fast)
```

### **Adjust Deadzone**

```javascript
this.deadzone = 0.15;  // Default: 15%
// Lower = more sensitive
// Higher = less drift
```

## 🎮 **Button Mapping**

### **Quest-Specific**

| Button   | Hand  | Index | Function (Current) |
| -------- | ----- | ----- | ------------------ |
| Trigger  | Both  | 0     | Select/Click       |
| Grip     | Both  | 1     | Reserved           |
| X        | Left  | 4     | Reserved           |
| Y        | Left  | 5     | Reserved           |
| A        | Right | 4     | Reserved           |
| B        | Right | 5     | Reserved           |
| Menu     | Left  | -     | System menu        |
| Oculus   | Right | -     | System home        |

**Reserved buttons** can be customized for:
- Quick expressions
- Teleport
- Menu toggle
- Chat controls

## 📋 **Usage Examples**

### **Example 1: Walk to Avatar**

```
1. Enter VR mode
2. Point left controller at floor ahead
3. Push left thumbstick forward
4. Walk toward avatar
5. Stop by releasing thumbstick
```

### **Example 2: Click Expression Button**

```
1. Point right controller at "Happy" button
2. Ray turns green
3. Pull trigger
4. Avatar shows happy expression
```

### **Example 3: Turn Around**

```
1. Push right thumbstick left/right
2. View rotates smoothly
3. Release to stop turning
```

### **Example 4: Explore Scene**

```
1. Left stick = Move forward/back/strafe
2. Right stick = Turn left/right
3. Head tracking = Look around
4. Combine for smooth navigation
```

## 🐛 **Troubleshooting**

### **Movement Not Working**

**Check:**
- ✅ Are you in VR mode? (Click ENTER VR)
- ✅ Is left controller connected?
- ✅ Is thumbstick past deadzone? (push further)
- ✅ Check browser console for errors

### **Can't Click Buttons**

**Check:**
- ✅ Is ray visible? (cyan/green line)
- ✅ Ray pointing at button?
- ✅ Trigger fully pressed?
- ✅ Button is clickable? (ray should turn green)

### **Controllers Not Visible**

**Check:**
- ✅ VR session started successfully?
- ✅ Controllers turned on?
- ✅ Controllers paired with Quest?
- ✅ Look down to see cyan spheres

### **Drift / Unwanted Movement**

**Fix:**
- Increase deadzone value
- Check controller calibration in Quest settings
- Replace controller batteries if low

### **Movement Too Fast/Slow**

**Fix:**
- Adjust `moveSpeed` value
- Try different speeds: 0.03 (slow), 0.05 (medium), 0.10 (fast)

## 🎨 **Customization**

### **Add Custom Button Actions**

```javascript
// In ViewerEngine or main.js
window.addEventListener('vr-session-start', () => {
    const vrControllers = window.NEXUS_VIEWER.vrControllers;

    // Override grip button (left hand)
    vrControllers.onGripPressed = (hand) => {
        if (hand === 'left') {
            // Your custom action
            console.log('Left grip pressed!');
            window.NEXUS_PROCEDURAL_ANIMATOR?.playMode?.('happy', 2000);
        }
    };

    // Override A/X button
    vrControllers.onButtonAPressed = (hand) => {
        if (hand === 'right') {
            // Teleport to avatar
            vrControllers.teleportTo(new THREE.Vector3(0, 0, 0));
        }
    };
});
```

### **Add Interactive Objects**

```javascript
// Make avatar clickable
const viewer = window.NEXUS_VIEWER;
const avatar = viewer.currentRoot;

if (avatar && viewer.vrControllers) {
    viewer.vrControllers.addInteractable(avatar, (hit) => {
        console.log('Avatar clicked at:', hit.point);
        // Trigger animation
        window.NEXUS_PROCEDURAL_ANIMATOR?.playMode?.('thinking', 3000);
    });
}
```

### **Change Controller Colors**

```javascript
// In VRControllers.js
const material = new THREE.MeshStandardMaterial({
    color: 0xff00ff,  // Change to magenta
    emissive: 0xff00ff,
    emissiveIntensity: 0.5,
});
```

## 📊 **Technical Details**

### **Input Polling**

Controllers are polled every frame (~72-90 FPS on Quest):

```javascript
pollGamepadInput() {
    for (const inputSource of session.inputSources) {
        const gamepad = inputSource.gamepad;
        const axes = gamepad.axes;      // Thumbstick positions
        const buttons = gamepad.buttons; // Button states

        // Process input...
    }
}
```

### **Coordinate System**

```
Y-axis (up)
  |
  |__ X-axis (right)
 /
Z-axis (forward out of screen)
```

**Movement:**
- Forward = -Z direction relative to camera
- Strafe = ±X direction relative to camera
- Up/Down = ±Y (currently disabled for ground movement)

### **Raycasting**

```javascript
// Ray origin = controller position
// Ray direction = controller forward (-Z)
raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
```

### **Player Rig**

```
PlayerRig (Group)
    └── Camera
        ├── Left Controller
        └── Right Controller
```

Moving the rig moves the player + camera together.

## 🎓 **Advanced Usage**

### **Implement Teleportation**

```javascript
// Detect thumbstick release for teleport
let teleportTarget = null;

function updateTeleport() {
    const axes = getRightThumbstick();

    if (axes[1] > 0.5) {
        // Show teleport target
        teleportTarget = calculateTeleportPosition();
        showTeleportMarker(teleportTarget);
    } else if (teleportTarget) {
        // Teleport on release
        vrControllers.teleportTo(teleportTarget);
        teleportTarget = null;
    }
}
```

### **Implement Hand Gestures**

```javascript
// Detect pinch gesture (trigger + grip)
function detectPinch(inputSource) {
    const trigger = inputSource.gamepad.buttons[0].pressed;
    const grip = inputSource.gamepad.buttons[1].pressed;

    if (trigger && grip) {
        // Pinch detected
        return true;
    }
    return false;
}
```

## 📚 **Resources**

- [WebXR Gamepads API](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API)
- [Meta Quest Developer Docs](https://developer.oculus.com/)
- [Three.js VR Examples](https://threejs.org/examples/?q=webxr)

## ✅ **Summary**

**Basic Controls:**
```
Left Stick  = Move (forward/back/strafe)
Right Stick = Turn (left/right)
Trigger     = Click/Select
Ray         = Point and interact
```

**To Use:**
1. Enter VR mode
2. Controllers appear automatically
3. Use thumbsticks to move
4. Point rays to interact
5. Pull triggers to click

**It just works!** 🎮✨

---

For issues or questions, see [META-QUEST-SETUP.md](META-QUEST-SETUP.md) for troubleshooting.
