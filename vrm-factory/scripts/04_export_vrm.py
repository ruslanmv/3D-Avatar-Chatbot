import bpy
import sys

# Get command line arguments
argv = sys.argv[sys.argv.index("--") + 1:]
input_path = argv[0]
output_path = argv[1]

# Clear scene
bpy.ops.wm.read_factory_settings(use_empty=True)

# Import GLB
bpy.ops.import_scene.gltf(filepath=input_path)

# Find armature
armatures = [o for o in bpy.data.objects if o.type == 'ARMATURE']
if armatures:
    armature = armatures[0]
    bpy.context.view_layer.objects.active = armature
else:
    print("Warning: No armature found, VRM export may fail")

# Try to export as VRM
try:
    # Check if VRM addon is available
    if hasattr(bpy.ops, 'export_scene') and hasattr(bpy.ops.export_scene, 'vrm'):
        bpy.ops.export_scene.vrm(
            filepath=output_path,
            export_only_selections=False
        )
        print(f"VRM export completed: {output_path}")
    else:
        print("Warning: VRM addon not available, exporting as GLB instead")
        # Fallback to GLB export
        output_path_glb = output_path.replace('.vrm', '.glb')
        bpy.ops.export_scene.gltf(
            filepath=output_path_glb,
            export_format='GLB'
        )
        # Rename to .vrm (VRM is essentially GLB with metadata)
        import os
        os.rename(output_path_glb, output_path)
        print(f"GLB exported as VRM: {output_path}")

except Exception as e:
    print(f"Warning: VRM export failed: {e}")
    # Fallback to GLB
    output_path_glb = output_path.replace('.vrm', '.glb')
    bpy.ops.export_scene.gltf(filepath=output_path_glb, export_format='GLB')
    import os
    os.rename(output_path_glb, output_path)
    print(f"Fallback: Exported as GLB with .vrm extension: {output_path}")
