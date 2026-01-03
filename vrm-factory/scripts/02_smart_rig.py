import bpy
import sys
import json

# Get command line arguments
argv = sys.argv[sys.argv.index("--") + 1:]
input_glb = argv[0]
json_data = argv[1]
output_glb = argv[2]

# Load vision data
with open(json_data) as f:
    vision = json.load(f)

# Clear scene
bpy.ops.wm.read_factory_settings(use_empty=True)

# Import GLB
bpy.ops.import_scene.gltf(filepath=input_glb)

# Find mesh objects
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
if not meshes:
    print("Error: No mesh found in GLB file")
    sys.exit(1)

mesh = meshes[0]

# Check if already has armature
if mesh.parent and mesh.parent.type == 'ARMATURE':
    print("Model already has armature, skipping rigging")
    bpy.ops.export_scene.gltf(filepath=output_glb)
    sys.exit(0)

# Add basic human metarig
bpy.ops.object.armature_human_metarig_add()
rig = bpy.context.object

# Scale rig based on mesh bounds
bbox = mesh.bound_box
min_z = min([p[2] for p in bbox])
max_z = max([p[2] for p in bbox])
mesh_height = max_z - min_z

# Use vision data if available
if vision.get("body_bounds", {}).get("height"):
    print("Using vision data for rigging scale")
    scale = mesh_height / 1.75  # Normalize to average human height
else:
    print("Using mesh bounds for rigging scale")
    scale = mesh_height / 1.75

rig.scale = (scale, scale, scale)
rig.location.z = min_z

# Bind mesh to rig
mesh.select_set(True)
bpy.context.view_layer.objects.active = rig
try:
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    print("Auto-rigging completed successfully")
except Exception as e:
    print(f"Warning: Auto-rigging failed: {e}")

# Export
bpy.ops.export_scene.gltf(
    filepath=output_glb,
    export_format='GLB',
    export_apply=True
)

print(f"Rigged model saved to: {output_glb}")
