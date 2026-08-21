# vrma-locomotion — optional interaction clip pack

This folder holds the **generated** `.vrma` clips that upgrade the Living-NPC
feature from "works" to "great". The app runs fine without them — every command
has a fallback to shipped assets (`vendor/animations/`, `addons/vrma-actions/`)
or to procedural motion (head nods, IK arm reach). Drop the files below in here
and the avatar automatically uses them (`src/xr/MotionClipMap.js` probes this
folder first, no code changes).

## Expected files

| File              | Used for                       | Loop       |
| ----------------- | ------------------------------ | ---------- |
| `nod.vrma`        | nod / "yes"                    | no         |
| `headshake.vrma`  | "no"                           | no         |
| `point.vrma`      | pointing at things             | no         |
| `offer_hand.vrma` | handshake offer pose           | yes (hold) |
| `handshake.vrma`  | handshake motion after contact | no         |
| `high_five.vrma`  | high five                      | yes (hold) |
| `sit_down.vrma`   | stand → sit transition         | no         |
| `stand_up.vrma`   | sit → stand transition         | no         |

## How to generate them (one command)

1. Download the clips from [Mixamo](https://www.mixamo.com) as **FBX Binary,
   Without Skin, 30 fps** and name them as above (suggested source animations
   are listed in the script header).
2. Install [VRM Add-on for Blender](https://vrm-addon-for-blender.info) ≥ 2.20.
3. Run:

```bash
blender --background --python scripts/retarget_mixamo_to_vrma.py -- \
    --template path/to/any-of-your-avatars.vrm \
    --input    path/to/mixamo_downloads \
    --out      addons/vrma-locomotion
```

`.vrma` targets VRM humanoid bone names, so clips generated from one template
play on **all** your VRM models.

Preview any clip in the browser console:

```js
NEXUS_CLIP_LOADER.playClip('addons/vrma-locomotion/handshake.vrma', {
    loop: false,
});
```
