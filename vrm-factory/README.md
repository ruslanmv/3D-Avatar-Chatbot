# VRM Factory - Automated Avatar Conversion System

This system automatically converts static GLB/GLTF files into fully rigged, VRM-format avatars ready for use with the WebXR Chatbot.

## 🎯 Features

- **Automated Rigging**: Uses MediaPipe AI for intelligent skeleton placement
- **Face Setup**: Adds VRM-standard blendshapes for expressions and lip-sync
- **VRM Export**: Outputs avatars compatible with VRChat, Virtual Cast, and custom WebXR apps
- **Docker-Based**: Runs in isolated container with all dependencies
- **REST API**: Easy integration with web applications

## 📁 Structure

```
vrm-factory/
├── Dockerfile              # Container definition
├── requirements.txt        # Python dependencies
├── server.py              # FastAPI server
├── vision_brain.py        # MediaPipe analysis
├── scripts/               # Blender automation
│   ├── install_deps.py
│   ├── 01_render_snap.py
│   ├── 02_smart_rig.py
│   ├── 03_face_setup.py
│   └── 04_export_vrm.py
├── addons/                # VRM Blender addon (download required)
└── temp/                  # Temporary files
```

## 🚀 Quick Start

### Prerequisites

- Docker installed on your system
- VRM Addon for Blender (download separately)

### Setup

1. **Download VRM Addon**

   Download the VRM Addon for Blender from:
   https://github.com/saturday06/VRM-Addon-for-Blender/releases

   Place the zip file in `addons/VRM_Addon_for_Blender.zip`

2. **Build Docker Image**

   ```bash
   cd vrm-factory
   docker build -t vrm-factory .
   ```

3. **Run Container**

   ```bash
   docker run -p 8000:8000 vrm-factory
   ```

   The API will be available at `http://localhost:8000`

## 📡 API Usage

### Convert GLB to VRM

**Endpoint:** `POST /convert-to-vrm/`

**Example using curl:**

```bash
curl -X POST "http://localhost:8000/convert-to-vrm/" \
     -F "file=@your_model.glb" \
     -o response.json
```

**Example using JavaScript:**

```javascript
const formData = new FormData();
formData.append('file', fileInput.files[0]);

const response = await fetch('http://localhost:8000/convert-to-vrm/', {
    method: 'POST',
    body: formData
});

const result = await response.json();
console.log(result);
// {
//   "status": "success",
//   "vrm_filename": "avatar.vrm",
//   "download_url": "/download-vrm/avatar.vrm"
// }
```

### Download Converted VRM

**Endpoint:** `GET /download-vrm/{filename}`

```bash
curl -O "http://localhost:8000/download-vrm/avatar.vrm"
```

### Cleanup Temporary Files

**Endpoint:** `DELETE /cleanup/{filename}`

```bash
curl -X DELETE "http://localhost:8000/cleanup/avatar.vrm"
```

## 🔄 Conversion Pipeline

The conversion process follows these steps:

1. **Snapshot Rendering** (`01_render_snap.py`)
   - Imports GLB file into Blender
   - Renders front-view snapshot
   - Saves as PNG for AI analysis

2. **Vision Analysis** (`vision_brain.py`)
   - Uses MediaPipe to detect body joints
   - Identifies facial landmarks
   - Calculates body proportions
   - Exports analysis as JSON

3. **Smart Rigging** (`02_smart_rig.py`)
   - Creates humanoid armature
   - Scales rig based on vision data
   - Auto-weights to mesh
   - Exports rigged model

4. **Face Setup** (`03_face_setup.py`)
   - Adds VRM-standard blendshapes
   - Creates visemes for lip-sync (aa, ih, ou, ee, oh)
   - Adds expression shapes (neutral, joy, angry, sorrow)
   - Adds blink shapes

5. **VRM Export** (`04_export_vrm.py`)
   - Converts to VRM format
   - Validates VRM metadata
   - Optimizes for WebXR

## 🛠️ Customization

### Modify Rigging Behavior

Edit `scripts/02_smart_rig.py` to adjust:
- Bone placement
- Armature scale
- Weight painting settings

### Add Custom Blendshapes

Edit `scripts/03_face_setup.py` to:
- Add more expression shapes
- Customize viseme shapes
- Implement custom facial animations

### Adjust Vision Analysis

Edit `vision_brain.py` to:
- Change MediaPipe model complexity
- Add more landmark detection
- Customize joint mapping

## 🔍 Troubleshooting

### VRM Addon Not Found

**Error:** `Warning: VRM addon not found`

**Solution:** Download the VRM addon and place it in `addons/` folder

### Rigging Fails

**Error:** `Auto-rigging failed`

**Solution:**
- Ensure model has clean topology
- Check that model is in standard T-pose or A-pose
- Verify model scale is reasonable

### Export Fails

**Error:** `VRM export failed`

**Solution:**
- Check Blender console for errors
- Verify armature is properly configured
- Ensure all required blendshapes exist

## 📊 Performance

- **Average conversion time:** 30-60 seconds per model
- **Supported formats:** GLB, GLTF
- **Output format:** VRM 0.0 / VRM 1.0
- **Max file size:** Limited by available RAM (recommend < 50MB)

## 🔒 Security Notes

- Runs in isolated Docker container
- No network access during processing
- Temporary files cleaned up automatically
- Input validation on file uploads

## 📝 License

This VRM Factory system is part of the 3D Avatar Chatbot project and uses:
- Blender (GPL)
- MediaPipe (Apache 2.0)
- VRM Addon for Blender (MIT)

## 🤝 Contributing

To improve the VRM Factory:

1. Test with various avatar models
2. Optimize Blender scripts
3. Improve vision analysis accuracy
4. Add more customization options

## 📚 Resources

- [VRM Specification](https://github.com/vrm-c/vrm-specification)
- [Blender Python API](https://docs.blender.org/api/current/)
- [MediaPipe](https://google.github.io/mediapipe/)
- [three-vrm Documentation](https://github.com/pixiv/three-vrm)
