import subprocess
import os
import shutil
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pathlib import Path

app = FastAPI(title="VRM Factory API", version="1.0.0")

# Enable CORS for Web Client
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

TEMP_DIR = Path("temp")
TEMP_DIR.mkdir(exist_ok=True)

def run_blender(script, *args):
    """Helper to run Blender Headless"""
    cmd = ["blender", "-b", "-P", f"scripts/{script}", "--"] + list(args)
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise Exception(f"Blender script failed: {result.stderr}")
    return result

@app.get("/")
async def root():
    return {"status": "VRM Factory API is running", "version": "1.0.0"}

@app.post("/convert-to-vrm/")
async def convert_to_vrm(file: UploadFile = File(...)):
    """
    Convert GLB/GLTF file to VRM format with automatic rigging and face setup
    """
    try:
        # Generate unique filename
        base_name = Path(file.filename).stem
        input_path = TEMP_DIR / f"{base_name}.glb"

        # Save uploaded file
        with open(input_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        print(f"[VRM Factory] Processing: {base_name}")

        # Step 1: Take Snapshot
        print("--- Step 1: Taking Snapshot ---")
        img_path = TEMP_DIR / f"{base_name}.png"
        run_blender("01_render_snap.py", str(input_path), str(img_path))

        # Step 2: Vision Analysis (Deep Learning)
        print("--- Step 2: Vision Analysis (Deep Learning) ---")
        json_path = TEMP_DIR / f"{base_name}.json"
        subprocess.run(["python", "vision_brain.py", str(img_path), str(json_path)], check=True)

        # Step 3: Smart Rigging
        print("--- Step 3: Smart Rigging ---")
        rigged_path = TEMP_DIR / f"{base_name}_rigged.glb"
        run_blender("02_smart_rig.py", str(input_path), str(json_path), str(rigged_path))

        # Step 4: Face Setup
        print("--- Step 4: Face Setup ---")
        face_path = TEMP_DIR / f"{base_name}_face.glb"
        run_blender("03_face_setup.py", str(rigged_path), str(json_path), str(face_path))

        # Step 5: VRM Export
        print("--- Step 5: VRM Export ---")
        final_vrm = TEMP_DIR / f"{base_name}.vrm"
        run_blender("04_export_vrm.py", str(face_path), str(final_vrm))

        if not final_vrm.exists():
            raise Exception("VRM export failed - file not created")

        return {
            "status": "success",
            "message": "Conversion completed successfully",
            "vrm_filename": final_vrm.name,
            "download_url": f"/download-vrm/{final_vrm.name}"
        }

    except Exception as e:
        return {
            "status": "error",
            "message": str(e)
        }

@app.get("/download-vrm/{filename}")
async def download_vrm(filename: str):
    """Download the generated VRM file"""
    file_path = TEMP_DIR / filename
    if not file_path.exists():
        return {"status": "error", "message": "File not found"}

    return FileResponse(
        path=file_path,
        media_type="application/octet-stream",
        filename=filename
    )

@app.delete("/cleanup/{filename}")
async def cleanup_file(filename: str):
    """Clean up temporary files"""
    try:
        base_name = Path(filename).stem
        patterns = [
            f"{base_name}.*",
            f"{base_name}_rigged.*",
            f"{base_name}_face.*"
        ]

        for pattern in patterns:
            for file_path in TEMP_DIR.glob(pattern):
                file_path.unlink()

        return {"status": "success", "message": "Cleanup completed"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
