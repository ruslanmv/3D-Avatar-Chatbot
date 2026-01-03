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

# VRM standard blendshape names (Visemes + Expressions)
vrm_shapes = [
    "Basis",
    # Visemes (for lip sync)
    "aa", "ih", "ou", "ee", "oh",
    # Expressions
    "neutral", "joy", "angry", "sorrow", "fun",
    "blink", "blink_l", "blink_r"
]

# Ensure we have shape keys
if not mesh.data.shape_keys:
    mesh.shape_key_add(name="Basis")
    print("Created Basis shape key")

# Add missing shape keys
for shape_name in vrm_shapes:
    if shape_name not in mesh.data.shape_keys.key_blocks:
        mesh.shape_key_add(name=shape_name)
        print(f"Created shape key: {shape_name}")

        # For demonstration, we're creating placeholder shapes
        # In production, these would be sculpted or AI-generated
        if shape_name == "aa":
            # Slightly open mouth for 'aa' sound
            # This is a simplified version - real implementation would manipulate vertices
            pass

print(f"Total shape keys: {len(mesh.data.shape_keys.key_blocks)}")

# Export
bpy.ops.export_scene.gltf(
    filepath=output_glb,
    export_format='GLB',
    export_apply=False  # Keep shape keys
)

print(f"Face setup completed, saved to: {output_glb}")
