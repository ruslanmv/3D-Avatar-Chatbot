# VR Integration - Unified Desktop & VR Mode

The main chatbot (`index.html`) now supports VR mode automatically! No need for
separate `.vr` files.

## 🎯 **What's New**

### ✅ **Unified Experience**

- **One Interface** - Works in both desktop and VR
- **Automatic Detection** - VR button appears only when supported
- **All Formats** - GLB, GLTF, and VRM files work in VR
- **Seamless Switching** - Switch between desktop and VR anytime

### ✅ **Features**

- 🖥️ **Desktop Mode** - Mouse/keyboard controls
- 🥽 **VR Mode** - Full 6DOF immersive experience
- 🎮 **Auto-Switch** - Controls adapt automatically
- 📱 **Cross-Platform** - Desktop, Mobile, Meta Quest

## 🚀 **Quick Start**

### **Desktop Mode (Default)**

```bash
# Start server
python3 -m http.server 8080

# Open in browser
http://localhost:8080/index.html
```

**You get:**

- ✅ Full chatbot functionality
- ✅ 3D avatar viewer
- ✅ All animations and expressions
- ✅ Mouse/keyboard controls

### **VR Mode (Meta Quest)**

**Same URL, VR automatically enabled!**

1. **On your computer:**

    ```bash
    # Find your IP
    ifconfig | grep inet  # Mac/Linux
    ipconfig              # Windows

    # Example: 192.168.1.100
    ```

2. **On Meta Quest:**

    ```
    Open Quest Browser
    Go to: http://YOUR_IP:8080/index.html
    ```

3. **Look for VR button** at bottom:

    ```
    [ENTER VR]  ← Cyan/blue button
    ```

4. **Click button** → Instant VR mode!

## 🎮 **How It Works**

### **Automatic VR Detection**

The system automatically:

1. ✅ Detects if WebXR is available
2. ✅ Shows VR button if supported
3. ✅ Enables VR rendering when activated
4. ✅ Switches back to desktop on exit

### **What Happens in VR**

**Desktop → VR:**

- Camera controls disable
- VR head tracking activates
- Scene renders to both eyes
- Controllers become active

**VR → Desktop:**

- Head tracking stops
- Mouse controls re-enable
- Single-eye rendering
- Back to normal

## 📋 **Supported Files**

All 3D formats work in VR mode:

| Format | Desktop | VR  | Notes                   |
| ------ | ------- | --- | ----------------------- |
| GLB    | ✅      | ✅  | Fully supported         |
| GLTF   | ✅      | ✅  | Fully supported         |
| VRM    | ✅      | ✅  | With expressions        |
| FBX    | ❌      | ❌  | Not supported (use GLB) |
| OBJ    | ❌      | ❌  | Not supported (use GLB) |

## 🔧 **VR Button Customization**

The VR button automatically appears when WebXR is available.

### **Button States**

```
✅ "ENTER VR"  → WebXR available, click to start
🔄 "EXIT VR"   → Currently in VR, click to exit
❌ "VR NOT AVAILABLE" → WebXR not supported
```

### **Button Location**

```
┌─────────────────────────────────────┐
│                                     │
│         3D Avatar Viewer            │
│                                     │
│                                     │
│                                     │
│                                     │
│         [ENTER VR] ← Bottom center │
└─────────────────────────────────────┘
```

### **Styling**

The button uses your app's theme:

- Cyan gradient background
- Orbitron font
- Smooth hover effects
- Responsive sizing

## 🐛 **Troubleshooting**

### **No VR Button Visible**

**Possible causes:**

1. **Browser doesn't support WebXR**
    - ✅ Use Chrome, Edge, or Quest Browser
    - ❌ Firefox VR support limited
    - ❌ Safari doesn't support WebXR

2. **Not using HTTPS (production)**
    - ✅ Local network: Use IP address (`http://192.168.1.X`)
    - ✅ Production: Deploy with HTTPS (Vercel, Netlify)
    - ❌ Production HTTP won't work

3. **JavaScript errors**
    - Check browser console (F12)
    - Look for VRSupport errors
    - Verify Three.js loaded

### **VR Button Grayed Out**

**Cause:** Quest browser hasn't detected headset

**Fix:**

- Put headset on (proximity sensor)
- Restart Quest Browser
- Check Quest is awake

### **Black Screen in VR**

**Possible issues:**

1. **Camera position**
    - Avatar might be behind you
    - Try moving head/looking around
    - Click avatar selector to reload

2. **Lighting too dark**
    - Our viewer uses IBL (image-based lighting)
    - Should work automatically
    - If dark, check model materials

3. **Rendering error**
    - Check Quest Browser console
    - Try simpler avatar first
    - Reload page

### **Controls Not Working**

**In VR mode:**

- ✅ Head tracking should work automatically
- ✅ Controllers can point at UI
- ❌ Mouse won't work (expected)
- ❌ Keyboard shortcuts disabled (expected)

**In desktop mode:**

- ✅ Mouse drag to rotate
- ✅ Scroll to zoom
- ✅ All UI buttons work
- ❌ Head tracking won't work (expected)

## 🎯 **Best Practices**

### **For Desktop Users**

- Upload any GLB/GLTF avatar
- Use all chat features normally
- Ignore VR button (unless testing)

### **For VR Users**

1. **Test desktop first**
    - Verify avatar loads
    - Test animations
    - Check chat works

2. **Then try VR**
    - Click VR button
    - Grant permissions
    - Look around

3. **Performance tips**
    - Use smaller avatars (< 50k polygons)
    - Limit texture sizes (1024x1024 max)
    - Close other Quest apps

### **For Developers**

1. **Test both modes**
    - Desktop functionality
    - VR compatibility
    - Switching between modes

2. **Handle VR events**

    ```javascript
    // Listen for VR session changes
    window.addEventListener('vr-session-start', () => {
        console.log('VR started');
        // Your VR-specific code
    });

    window.addEventListener('vr-session-end', () => {
        console.log('VR ended');
        // Cleanup VR-specific code
    });
    ```

3. **Access VR status**
    ```javascript
    // Check if currently in VR
    const isVR = window.NEXUS_VIEWER?.renderer.xr.isPresenting;
    ```

## 📊 **Performance**

### **Desktop Mode**

- 60 FPS target
- High quality rendering
- All post-processing effects
- Shadows (optional)

### **VR Mode**

- 72 FPS target (Quest 2)
- 90 FPS target (Quest 3)
- Automatic quality adjustment
- Shadows disabled for performance

### **Optimization**

The system automatically:

- Adjusts pixel ratio for VR
- Disables desktop controls in VR
- Manages render loop efficiently
- Cleans up on mode switch

## 🔍 **Technical Details**

### **Architecture**

```
index.html
    ↓
engine-bridge.js
    ↓
ViewerEngine.js ← Adds VRSupport.js
    ↓
Three.js + WebXR API
```

### **Files Modified**

```
✅ src/gltf-viewer/ViewerEngine.js  - Added VR support
✅ src/gltf-viewer/VRSupport.js     - NEW: VR button & session management
```

### **WebXR Features Used**

- `immersive-vr` session mode
- `local-floor` reference space
- Hand tracking (optional)
- Controller input (optional)

## 🆚 **Comparison**

### **Before (Separate Files)**

```
index.html      → Desktop only
index-vr.html   → VR only
```

**Problems:**

- ❌ Duplicate code
- ❌ Separate maintenance
- ❌ User confusion
- ❌ Feature drift

### **After (Unified)**

```
index.html → Desktop + VR
```

**Benefits:**

- ✅ Single codebase
- ✅ Automatic detection
- ✅ Seamless switching
- ✅ Easier maintenance

## 🎉 **What's Next**

Future enhancements:

1. **Hand Tracking** - Use hands instead of controllers
2. **Spatial Audio** - 3D positioned sound
3. **Multiplayer** - See other users in VR
4. **Voice Chat** - Talk in VR space
5. **Gestures** - Control avatar with hand gestures

## 📚 **Resources**

- [WebXR Device API](https://developer.mozilla.org/en-US/docs/Web/API/WebXR_Device_API)
- [Three.js WebXR](https://threejs.org/docs/#manual/en/introduction/How-to-use-WebXR)
- [Meta Quest Developer](https://developer.oculus.com/)
- [VR-README.md](VR-README.md) - Detailed VR features guide
- [META-QUEST-SETUP.md](META-QUEST-SETUP.md) - Quest troubleshooting

## ✅ **Summary**

**One URL, Two Modes:**

```
http://localhost:8080/index.html

Desktop Browser → Desktop Mode (mouse/keyboard)
Quest Browser   → Desktop Mode + VR Button
Click VR Button → VR Mode (immersive)
```

**It just works!** 🎉

---

For issues or questions, see [META-QUEST-SETUP.md](META-QUEST-SETUP.md) for
detailed troubleshooting.
