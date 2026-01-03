import bpy
import os

# Install VRM addon if zip file exists
addon_path = "/app/addons/VRM_Addon_for_Blender.zip"

if os.path.exists(addon_path):
    try:
        bpy.ops.preferences.addon_install(filepath=addon_path)
        bpy.ops.preferences.addon_enable(module="VRM_Addon_for_Blender")
        bpy.ops.wm.save_userpref()
        print("VRM Addon installed successfully")
    except Exception as e:
        print(f"Warning: Could not install VRM addon: {e}")
else:
    print(f"Warning: VRM addon not found at {addon_path}")
    print("Please download the VRM addon and place it in the addons/ folder")
