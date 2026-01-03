import cv2
import mediapipe as mp
import json
import sys

def analyze_image(image_path):
    """
    Analyze image using MediaPipe to detect body joints and face landmarks
    """
    mp_pose = mp.solutions.pose
    mp_face = mp.solutions.face_mesh

    data = {"joints": {}, "mouth": {}, "body_bounds": {}}

    # Read Image
    image = cv2.imread(image_path)
    if image is None:
        print(f"Warning: Could not read image at {image_path}")
        return data

    h, w, _ = image.shape

    # 1. Pose Detection (Body)
    with mp_pose.Pose(static_image_mode=True, model_complexity=2) as pose:
        results = pose.process(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
        if results.pose_landmarks:
            for id, lm in enumerate(results.pose_landmarks.landmark):
                # Save normalized (0-1) coordinates
                data["joints"][id] = {
                    "x": lm.x,
                    "y": lm.y,
                    "z": lm.z,
                    "visibility": lm.visibility
                }

            # Calculate body bounds for rigging
            y_coords = [lm.y for lm in results.pose_landmarks.landmark]
            data["body_bounds"]["min_y"] = min(y_coords)
            data["body_bounds"]["max_y"] = max(y_coords)
            data["body_bounds"]["height"] = max(y_coords) - min(y_coords)

    # 2. Face Detection (Mouth)
    with mp_face.FaceMesh(static_image_mode=True, max_num_faces=1) as face:
        results = face.process(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
        if results.multi_face_landmarks:
            landmarks = results.multi_face_landmarks[0].landmark
            # Get specific mouth points (Top Lip: 13, Bottom Lip: 14)
            data["mouth"]["top"] = {"x": landmarks[13].x, "y": landmarks[13].y}
            data["mouth"]["bottom"] = {"x": landmarks[14].x, "y": landmarks[14].y}

            # Additional mouth landmarks for better viseme support
            data["mouth"]["left_corner"] = {"x": landmarks[61].x, "y": landmarks[61].y}
            data["mouth"]["right_corner"] = {"x": landmarks[291].x, "y": landmarks[291].y}

    return data

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python vision_brain.py <input_image> <output_json>")
        sys.exit(1)

    img_in = sys.argv[1]
    json_out = sys.argv[2]

    print(f"Analyzing image: {img_in}")
    result = analyze_image(img_in)

    with open(json_out, "w") as f:
        json.dump(result, f, indent=2)

    print(f"Analysis saved to: {json_out}")
