# External Tools for VRM & 3D Avatar Workflows

A curated collection of tools for converting, creating, and managing VRM
avatars. These complement the 3D Avatar Chatbot and can help bring models from
sources like [Sketchfab](https://sketchfab.com/) into VRM format for full
feature support.

---

## GLB to VRM Conversion

### UniVRM (Unity Plugin) — Standard Converter

- **URL**: https://github.com/vrm-c/UniVRM
- **Platform**: Unity Editor (Windows, macOS, Linux)
- **Description**: The official VRM SDK for Unity. Import GLB/FBX, set up
  humanoid bone mapping, define expressions and spring bones, and export as
  .vrm.
- **Best for**: Full control over VRM setup, batch conversion pipelines
- **Steps**:
    1. Import GLB into Unity
    2. Configure Humanoid Avatar in the model's Rig settings
    3. Add VRM components (ExpressionProxy, SpringBone, LookAt)
    4. Export via VRM > Export

### VRM Add-on for Blender

- **URL**: https://github.com/saturday06/VRM-Addon-for-Blender
- **Platform**: Blender 3.6+ (all OS)
- **Description**: Open-source Blender add-on that can import and export VRM
  files. Works with any model Blender can open (GLB, FBX, OBJ, etc.).
- **Best for**: Artists who prefer Blender, manual rigging and expression setup
- **Steps**:
    1. Install the add-on in Blender Preferences
    2. Import your GLB file
    3. Configure the VRM humanoid mapping
    4. Set up expressions via shape keys
    5. Export as .vrm

### @pixiv/three-vrm (JavaScript/Node.js)

- **URL**: https://github.com/pixiv/three-vrm
- **Platform**: Node.js / Browser
- **Description**: The same library this chatbot uses to load VRM files. Can be
  used programmatically to build a custom conversion pipeline.
- **Best for**: Automated batch conversion, CI/CD pipelines
- **Notes**: Primarily a runtime loader; creating VRM files requires using the
  VRM spec directly or combining with a GLTF writer

---

## 3D Model Sources

### Sketchfab

- **URL**: https://sketchfab.com/
- **Description**: Largest marketplace for 3D models. Many free CC-licensed
  models available.
- **Formats**: GLB, GLTF, FBX, USDZ, OBJ
- **Workflow**: Download GLB → Convert to VRM using tools above → Add to chatbot

### VRoid Hub

- **URL**: https://hub.vroid.com/
- **Description**: Community hub for VRM avatars. Models are already in VRM
  format and can be used directly in the chatbot.
- **Formats**: VRM (native)
- **License**: Varies per model — check individual model terms

### VRoid Studio

- **URL**: https://vroid.com/en/studio
- **Description**: Free avatar creation tool by Pixiv. Create VRM avatars from
  scratch with a user-friendly editor. Exports directly to VRM format.
- **Platform**: Windows, macOS, Steam
- **Best for**: Creating custom avatars without 3D modeling skills

### Ready Player Me

- **URL**: https://readyplayer.me/
- **Description**: Web-based avatar creator. Exports GLB format (needs VRM
  conversion).
- **Formats**: GLB
- **Workflow**: Create avatar → Download GLB → Convert to VRM

---

## VRM Specification & Documentation

| Resource                | URL                                                     |
| ----------------------- | ------------------------------------------------------- |
| VRM Specification       | https://vrm.dev/en/                                     |
| VRM 1.0 Spec (GitHub)   | https://github.com/vrm-c/vrm-specification              |
| three-vrm Documentation | https://pixiv.github.io/three-vrm/                      |
| VRM Expression List     | https://vrm.dev/en/univrm/blendshape/univrm_blendshape/ |

---

## Future: Custom GLB-to-VRM Converter

We plan to build a dedicated converter page integrated into this project that
will:

1. **Upload GLB** — Drag-and-drop a .glb file from Sketchfab or other sources
2. **Auto-detect bones** — Use the existing `PoseRigMap.js` heuristics to map
   bones
3. **Map morph targets** — Use `MorphTargetAdapter.js` name mappings to identify
   expressions
4. **Configure spring bones** — Visual editor for hair/cloth physics chains
5. **Preview** — Real-time preview with the chatbot's rendering engine
6. **Export VRM** — Package as a valid .vrm file ready for use

### Technical Foundation Already in Place

- `src/MorphTargetAdapter.js` — Maps ARKit/Oculus/Blender morph names to VRM
  standard
- `src/PoseRigMap.js` — Maps generic bone names to VRM humanoid standard
- `src/PoseNormalizer.js` — Tiered rig detection (VRM API → name heuristics →
  world-space)
- `src/NaturalPosePlugin.js` — T-pose correction for VRM humanoid bones
