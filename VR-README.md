# WebXR VR Chatbot - Complete Guide

This guide covers everything you need to run the 3D Avatar Chatbot in VR mode,
including Meta Quest 3 support and GLB-to-VRM conversion.

## 🎯 What's New

### VR Features

- ✅ **WebXR Support** - Works on Meta Quest 3, Quest 2, and other VR headsets
- ✅ **Desktop Compatible** - Seamless experience on Chrome/Edge browsers
- ✅ **VRM Format** - Industry-standard avatar format with expressions and
  visemes
- ✅ **Auto-Conversion** - Convert GLB files to VRM automatically
- ✅ **Real-time Expressions** - Dynamic facial expressions in VR
- ✅ **Lip Sync Ready** - Viseme blendshapes for realistic talking animations

### Technical Stack

- **Three.js** - 3D rendering
- **@pixiv/three-vrm** - VRM avatar support
- **WebXR API** - VR headset integration
- **FastAPI** - Backend conversion service
- **Blender + MediaPipe** - AI-powered rigging

## 📂 Project Structure

```
3D-Avatar-Chatbot/
├── index-vr.html           # NEW: WebXR-enabled chatbot interface
├── src/
│   ├── VRMLoader.js        # NEW: VRM avatar loader
│   ├── WebXRChatbot.js     # NEW: WebXR chatbot controller
│   └── ProceduralAnimator.js # Updated for VRM support
├── vrm-factory/            # NEW: GLB to VRM conversion system
│   ├── Dockerfile
│   ├── server.py           # FastAPI conversion server
│   ├── vision_brain.py     # MediaPipe AI rigging
│   └── scripts/            # Blender automation scripts
└── vendor/avatars/         # Avatar files (.vrm, .glb)
```

## 🚀 Quick Start

### Option 1: Desktop Mode (Easiest)

1. **Open the VR-enabled interface:**

    ```bash
    # Start a local server
    python3 -m http.server 8080
    ```

2. **Navigate to:**

    ```
    http://localhost:8080/index-vr.html
    ```

3. **Upload a VRM avatar** using the file picker

4. **Interact:**
    - Orbit camera with mouse
    - Test expressions
    - Try talking animation

### Option 2: VR Mode (Meta Quest 3)

1. **Start local server:**

    ```bash
    python3 -m http.server 8080
    ```

2. **Find your computer's IP:**

    ```bash
    # On Mac/Linux
    ifconfig | grep inet

    # On Windows
    ipconfig
    ```

3. **On Meta Quest 3:**
    - Open Quest Browser
    - Navigate to: `http://YOUR_IP:8080/index-vr.html`
    - Click "ENTER VR" button
    - Put on headset and enjoy!

### Option 3: Convert GLB to VRM

If you have GLB files that need to be converted:

1. **Start VRM Factory backend:**

    ```bash
    cd vrm-factory
    docker build -t vrm-factory .
    docker run -p 8000:8000 vrm-factory
    ```

2. **Open the VR interface** (`index-vr.html`)

3. **Click "Upload & Convert GLB"** button

4. **Select your GLB file**

5. **Download the converted VRM** when ready

## 🎮 Controls

### Desktop Mode

- **Mouse Drag** - Rotate camera
- **Mouse Wheel** - Zoom in/out
- **Right Panel** - Expression controls, file upload

### VR Mode (Meta Quest)

- **Controllers** - Point and select UI elements
- **Look Around** - Natural head movement
- **Walk** - Use controller thumbsticks (if enabled)

## 🔧 VRM Factory Setup

The VRM Factory converts static GLB models into fully rigged VRM avatars.

### Prerequisites

1. **Docker** - Install from [docker.com](https://docker.com)

2. **VRM Blender Addon** - Download from:
   https://github.com/saturday06/VRM-Addon-for-Blender/releases

    Place the zip file at:

    ```
    vrm-factory/addons/VRM_Addon_for_Blender.zip
    ```

### Building the Factory

```bash
cd vrm-factory

# Build Docker image
docker build -t vrm-factory .

# Run the service
docker run -p 8000:8000 vrm-factory
```

The API will be available at `http://localhost:8000`

### API Documentation

Visit `http://localhost:8000/docs` for interactive API documentation (Swagger
UI)

## 📱 Deployment Options

### Local Network (Meta Quest)

1. Ensure Quest and PC are on same WiFi
2. Start server: `python3 -m http.server 8080`
3. Access via local IP on Quest Browser

### Production (HTTPS Required for WebXR)

WebXR requires HTTPS in production. Options:

#### Option A: Netlify (Free)

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Deploy
netlify deploy --prod
```

#### Option B: Vercel (Free)

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel --prod
```

#### Option C: GitHub Pages (Free)

```bash
# Push to GitHub
git push origin main

# Enable Pages in repository settings
```

**Note:** For GitHub Pages, configure custom domain with SSL or use the provided
`https://*.github.io` domain.

## 🎨 Adding Custom Avatars

### VRM Avatars (Recommended)

1. Obtain VRM file from:
    - [VRoid Studio](https://vroid.com/studio) - Create custom avatars
    - [VRoid Hub](https://hub.vroid.com/) - Download community avatars
    - [Booth](https://booth.pm/) - Purchase professional avatars

2. Upload via the web interface

### GLB/GLTF Models

1. Use the VRM Factory to convert:

    ```bash
    curl -X POST "http://localhost:8000/convert-to-vrm/" \
         -F "file=@model.glb" \
         -o response.json
    ```

2. Download converted VRM and upload to chatbot

## 🔍 Troubleshooting

### VR Button Not Appearing

**Problem:** No "ENTER VR" button visible

**Solutions:**

- Ensure you're using HTTPS (required for WebXR)
- Check browser supports WebXR (Chrome, Edge, Quest Browser)
- Verify VR headset is connected/paired

### Avatar Not Loading

**Problem:** Blank screen or error loading avatar

**Solutions:**

- Check browser console for errors (F12)
- Verify file is valid VRM/GLB format
- Try re-exporting from VRoid Studio
- Check file size (keep under 50MB)

### Expressions Not Working

**Problem:** Facial expressions don't change

**Solutions:**

- Ensure avatar has blendshapes/shape keys
- Check VRM file includes expression metadata
- Try converting GLB to VRM via factory

### Conversion Fails

**Problem:** GLB to VRM conversion errors

**Solutions:**

- Verify Docker is running
- Check Blender logs in container
- Ensure model has clean topology
- Try simplifying model geometry

## 🎯 Best Practices

### Avatar Creation

1. **Use VRoid Studio** for easiest VRM creation
2. **Keep polygon count low** (< 50k triangles) for VR
3. **Use single material** when possible
4. **Include blendshapes** for expressions
5. **Test in desktop mode** before VR

### Performance Optimization

1. **Texture size:** Keep under 2048x2048
2. **Draw calls:** Minimize materials
3. **Animations:** Bake when possible
4. **LOD:** Create low-poly versions for distance

### VR Experience

1. **Avatar scale:** Keep realistic (1.6-1.8m height)
2. **Positioning:** Place avatar 2-3m from camera
3. **Lighting:** Use soft, even lighting
4. **Background:** Keep simple to maintain frame rate

## 📚 Integration with Existing Chatbot

To integrate VRM support into the existing chatbot (`index.html`):

### 1. Add VRM Dependencies

```html
<script type="importmap">
    {
        "imports": {
            "three": "https://unpkg.com/three@0.160.0/build/three.module.js",
            "@pixiv/three-vrm": "https://unpkg.com/@pixiv/three-vrm@2.1.0/lib/three-vrm.module.js"
        }
    }
</script>
```

### 2. Load VRM Modules

```html
<script type="module" src="src/VRMLoader.js"></script>
<script type="module" src="src/WebXRChatbot.js"></script>
```

### 3. Initialize VR Chatbot

```javascript
const chatbot = new WebXRChatbot('avatar-viewport');
await chatbot.loadAvatar('/path/to/avatar.vrm');
```

### 4. Connect to Speech System

```javascript
// When speaking starts
speechSynthesis.addEventListener('start', () => {
    chatbot.startTalking(0.5);
});

// When speaking ends
speechSynthesis.addEventListener('end', () => {
    chatbot.stopTalking();
});
```

## 🔗 Useful Resources

- **VRM Specification:** https://github.com/vrm-c/vrm-specification
- **three-vrm Library:** https://github.com/pixiv/three-vrm
- **WebXR API:**
  https://developer.mozilla.org/en-US/docs/Web/API/WebXR_Device_API
- **VRoid Studio:** https://vroid.com/studio
- **Meta Quest Developer:** https://developer.oculus.com/

## 🤝 Contributing

To contribute VR features:

1. Test on multiple VR devices
2. Optimize performance for Quest hardware
3. Add controller interactions
4. Improve avatar conversion quality
5. Document new features

## 📄 License

This VR extension maintains the same Apache 2.0 license as the main project.

---

**Ready to experience your chatbot in VR!** 🥽✨

For questions or issues, please open a GitHub issue or check the main README.md
for contact information.
