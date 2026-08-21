#!/usr/bin/env python3
"""
retarget_mixamo_to_vrma.py — batch-convert Mixamo FBX (or BVH) clips into
skeleton-agnostic .vrma files for `addons/vrma-locomotion/`.

Runs headless inside Blender with the VRM add-on installed:

    blender --background --python scripts/retarget_mixamo_to_vrma.py -- \
        --template assets/template.vrm \
        --input   ./mixamo_downloads \
        --out     ./addons/vrma-locomotion

Requirements
------------
- Blender 3.6+ (4.x recommended)
- "VRM Add-on for Blender" >= 2.20  (https://vrm-addon-for-blender.info)
  The add-on provides VRM import and the "VRM Animation (.vrma)" exporter.
- A template .vrm (any of your avatars). The exported .vrma targets VRM
  humanoid bone names, so ONE template produces clips that play on ALL
  your VRM models at runtime.
- Mixamo clips downloaded as FBX **"Without Skin"**, 30 fps.

Suggested Mixamo searches → output names expected by MotionClipMap:
    Standing Greeting (subtle nod)  → nod.fbx
    Shaking Head No                 → headshake.fbx
    Pointing                        → point.fbx
    Hand Raising / Reaching Out     → offer_hand.fbx
    Handshake (single character)    → handshake.fbx
    High Five (single character)    → high_five.fbx
    Sitting (start)                 → sit_down.fbx
    Stand Up                        → stand_up.fbx

The output .vrma file name = input file name (nod.fbx → nod.vrma).
"""

import argparse
import math
import sys
from pathlib import Path

try:
    import bpy  # noqa: F401  (only available inside Blender)
except ImportError:  # pragma: no cover
    sys.exit("Run inside Blender:  blender --background --python " + __file__ + " -- --help")


# Mixamo rig → VRM humanoid bone names (core body set used by .vrma).
MIXAMO_TO_VRM = {
    "Hips": "hips",
    "Spine": "spine",
    "Spine1": "chest",
    "Spine2": "upperChest",
    "Neck": "neck",
    "Head": "head",
    "LeftShoulder": "leftShoulder",
    "LeftArm": "leftUpperArm",
    "LeftForeArm": "leftLowerArm",
    "LeftHand": "leftHand",
    "RightShoulder": "rightShoulder",
    "RightArm": "rightUpperArm",
    "RightForeArm": "rightLowerArm",
    "RightHand": "rightHand",
    "LeftUpLeg": "leftUpperLeg",
    "LeftLeg": "leftLowerLeg",
    "LeftFoot": "leftFoot",
    "LeftToeBase": "leftToes",
    "RightUpLeg": "rightUpperLeg",
    "RightLeg": "rightLowerLeg",
    "RightFoot": "rightFoot",
    "RightToeBase": "rightToes",
}


def _args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    p = argparse.ArgumentParser(description="Mixamo FBX/BVH → .vrma batch retarget")
    p.add_argument("--template", required=True, help="Path to a template .vrm avatar")
    p.add_argument("--input", required=True, help="Folder with .fbx / .bvh clips")
    p.add_argument("--out", required=True, help="Output folder for .vrma files")
    p.add_argument("--fps", type=int, default=30)
    return p.parse_args(argv)


def _reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def _find_armature():
    for obj in bpy.context.scene.objects:
        if obj.type == "ARMATURE":
            return obj
    return None


def _import_template(path: Path):
    result = bpy.ops.import_scene.vrm(filepath=str(path))
    if "FINISHED" not in result:
        raise RuntimeError(f"VRM import failed for {path} — is the VRM add-on installed & enabled?")
    arm = _find_armature()
    if not arm:
        raise RuntimeError("No armature found in template VRM")
    return arm


def _import_clip(path: Path):
    before = set(bpy.context.scene.objects)
    if path.suffix.lower() == ".fbx":
        bpy.ops.import_scene.fbx(filepath=str(path), ignore_leaf_bones=True, automatic_bone_orientation=True)
    else:
        bpy.ops.import_anim.bvh(filepath=str(path), rotate_mode="NATIVE", update_scene_fps=False)
    new = [o for o in bpy.context.scene.objects if o not in before and o.type == "ARMATURE"]
    if not new:
        raise RuntimeError(f"No armature imported from {path}")
    return new[0]


def _vrm_bone_map(vrm_armature):
    """VRM humanoid name → Blender pose-bone name, from the add-on's extension data."""
    ext = getattr(vrm_armature.data, "vrm_addon_extension", None)
    mapping = {}
    if ext:
        for container in ("vrm1", "vrm0"):
            node = getattr(ext, container, None)
            humanoid = getattr(node, "humanoid", None) if node else None
            bones = getattr(humanoid, "human_bones", None) if humanoid else None
            if not bones:
                continue
            for vrm_name in set(MIXAMO_TO_VRM.values()):
                hb = getattr(bones, vrm_name, None)
                bone_name = getattr(getattr(hb, "node", None), "bone_name", "") if hb else ""
                if bone_name:
                    mapping[vrm_name] = bone_name
            if mapping:
                break
    # Fallback: assume the armature already uses VRM humanoid bone names.
    for vrm_name in set(MIXAMO_TO_VRM.values()):
        mapping.setdefault(vrm_name, vrm_name)
    return mapping


def _strip_prefix(name: str) -> str:
    return name.split(":")[-1]  # mixamorig:Hips → Hips


def _retarget(vrm_arm, src_arm, fps: int):
    """Constrain VRM bones to the Mixamo source, then bake to an action."""
    scene = bpy.context.scene
    scene.render.fps = fps
    action = src_arm.animation_data.action if src_arm.animation_data else None
    if not action:
        raise RuntimeError("Source clip has no animation data")
    start, end = (int(action.frame_range[0]), int(action.frame_range[1]))
    scene.frame_start, scene.frame_end = start, end

    bone_map = _vrm_bone_map(vrm_arm)
    src_bones = {_strip_prefix(b.name): b.name for b in src_arm.pose.bones}

    constrained = []
    for mixamo_name, vrm_name in MIXAMO_TO_VRM.items():
        src_name = src_bones.get(mixamo_name)
        dst_name = bone_map.get(vrm_name)
        if not src_name or not dst_name or dst_name not in vrm_arm.pose.bones:
            continue
        pb = vrm_arm.pose.bones[dst_name]
        con = pb.constraints.new("COPY_ROTATION")
        con.target = src_arm
        con.subtarget = src_name
        con.mix_mode = "REPLACE"
        con.target_space = "LOCAL_OWNER_ORIENT"
        con.owner_space = "LOCAL"
        constrained.append(pb)

    # Root motion: hips location follows the source hips (scaled to metres).
    hips_dst = bone_map.get("hips")
    hips_src = src_bones.get("Hips")
    if hips_dst and hips_src and hips_dst in vrm_arm.pose.bones:
        pb = vrm_arm.pose.bones[hips_dst]
        con = pb.constraints.new("COPY_LOCATION")
        con.target = src_arm
        con.subtarget = hips_src
        constrained.append(pb)

    bpy.ops.object.select_all(action="DESELECT")
    vrm_arm.select_set(True)
    bpy.context.view_layer.objects.active = vrm_arm
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.select_all(action="SELECT")
    bpy.ops.nla.bake(
        frame_start=start,
        frame_end=end,
        only_selected=True,
        visual_keying=True,
        clear_constraints=True,
        use_current_action=False,
        bake_types={"POSE"},
    )
    bpy.ops.object.mode_set(mode="OBJECT")
    return start, end


def _export_vrma(vrm_arm, out_path: Path):
    bpy.ops.object.select_all(action="DESELECT")
    vrm_arm.select_set(True)
    bpy.context.view_layer.objects.active = vrm_arm
    for op_name in ("export_scene.vrma", "vrm.export_vrma"):
        ns, _, fn = op_name.partition(".")
        op = getattr(getattr(bpy.ops, ns, None), fn, None)
        if op is None:
            continue
        try:
            if "FINISHED" in op(filepath=str(out_path)):
                return True
        except Exception as exc:  # noqa: BLE001
            print(f"  exporter {op_name} failed: {exc}")
    raise RuntimeError("No .vrma exporter found — install VRM Add-on for Blender >= 2.20")


def main():
    args = _args()
    template = Path(args.template).resolve()
    src_dir = Path(args.input).resolve()
    out_dir = Path(args.out).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    clips = sorted([p for p in src_dir.iterdir() if p.suffix.lower() in (".fbx", ".bvh")])
    if not clips:
        sys.exit(f"No .fbx/.bvh files in {src_dir}")

    ok, failed = [], []
    for clip in clips:
        print(f"\n=== {clip.name} ===")
        try:
            _reset_scene()
            vrm_arm = _import_template(template)
            src_arm = _import_clip(clip)
            start, end = _retarget(vrm_arm, src_arm, args.fps)
            out_path = out_dir / (clip.stem + ".vrma")
            _export_vrma(vrm_arm, out_path)
            dur = (end - start) / max(1, args.fps)
            print(f"  → {out_path.name}  ({dur:.2f}s)")
            ok.append(clip.stem)
        except Exception as exc:  # noqa: BLE001
            print(f"  FAILED: {exc}")
            failed.append(clip.stem)

    print(f"\nDone. {len(ok)} converted, {len(failed)} failed.")
    if failed:
        print("Failed:", ", ".join(failed))
    if ok:
        print("Copy the .vrma files into addons/vrma-locomotion/ and reload the app —")
        print("MotionClipMap picks them up automatically (no code changes needed).")
    print(f"\nQA tip: preview any clip in-app via console:")
    print("  NEXUS_CLIP_LOADER.playClip('addons/vrma-locomotion/nod.vrma', {loop:false})")
    print(f"Sanity: {math.floor(len(ok) / max(1, len(clips)) * 100)}% of the pack converted.")


if __name__ == "__main__":
    main()
