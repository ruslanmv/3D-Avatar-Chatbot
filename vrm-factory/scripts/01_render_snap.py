import bpy
import sys
import math

# Get command line arguments
argv = sys.argv[sys.argv.index("--") + 1:]
input_glb = argv[0]
output_img = argv[1]

# Clear scene
bpy.ops.wm.read_factory_settings(use_empty=True)

# Import GLB
bpy.ops.import_scene.gltf(filepath=input_glb)

# Setup Camera
cam_data = bpy.data.cameras.new('Camera')
cam = bpy.data.objects.new('Camera', cam_data)
bpy.context.scene.collection.objects.link(cam)
bpy.context.scene.camera = cam

# Position camera for front view
cam.location = (0, -2.5, 1.0)
cam.rotation_euler = (math.radians(90), 0, 0)

# Add lighting
light_data = bpy.data.lights.new(name="Light", type='SUN')
light = bpy.data.objects.new(name="Light", object_data=light_data)
bpy.context.scene.collection.objects.link(light)
light.location = (5, -5, 5)
light.data.energy = 2.0

# Render settings
bpy.context.scene.render.engine = 'CYCLES'
bpy.context.scene.cycles.samples = 32
bpy.context.scene.render.resolution_x = 512
bpy.context.scene.render.resolution_y = 512
bpy.context.scene.render.filepath = output_img

# Render
bpy.ops.render.render(write_still=True)

print(f"Snapshot saved to: {output_img}")
