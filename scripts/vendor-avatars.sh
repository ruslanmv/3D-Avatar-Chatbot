#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# vendor-avatars.sh
#
# Robust downloader for GLB avatar models.
# - WSL / NTFS safe
# - Validates GLB files
# - Uses fallbacks when primary files fail
# - Generates vendor/avatars/avatars.json for downloaded files
# ============================================================

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AVATAR_DIR="${ROOT_DIR}/vendor/avatars"
AVATARS_JSON="${AVATAR_DIR}/avatars.json"

echo "==> Installing 3D Avatar vendor files"
echo "==> Target: ${AVATAR_DIR}"
mkdir -p "${AVATAR_DIR}"

# ------------------------------------------------------------
# Helper: validate GLB
# ------------------------------------------------------------
is_valid_glb() {
  local f="$1"

  [ -f "$f" ] || return 1
  # Must be at least 1 KB (filters tiny error bodies)
  [ "$(wc -c < "$f")" -ge 1024 ] || return 1
  # Must start with "glTF"
  head -c 4 "$f" | grep -q "glTF"
}

# ------------------------------------------------------------
# Helper: download with fallback
# ------------------------------------------------------------
download_with_fallback() {
  local out="$1"
  shift
  local urls=("$@")

  for url in "${urls[@]}"; do
    [ -z "$url" ] && continue

    echo "==> Downloading: ${out#${ROOT_DIR}/}"
    echo "    -> $url"

    rm -f "$out"

    if curl -fL \
      --retry 5 \
      --retry-delay 1 \
      --retry-connrefused \
      --output "$out" \
      "$url"; then

      if is_valid_glb "$out"; then
        echo "    ✔ Success"
        return 0
      else
        echo "    ⚠ Invalid GLB, trying next source"
        rm -f "$out"
      fi
    else
      echo "    ⚠ Download failed, trying next source"
    fi
  done

  echo "❌ ERROR: All sources failed for ${out##*/}" >&2
  return 1
}

# ------------------------------------------------------------
# Helper: pretty display name
# ------------------------------------------------------------
pretty_name() {
  local base="$1"
  base="${base%.glb}"
  # Add spaces before capitals: RobotExpressive -> Robot Expressive
  base="$(sed -E 's/([a-z])([A-Z])/\1 \2/g' <<<"$base")"
  # Replace _ and - with spaces
  base="${base//_/ }"
  base="${base//-/ }"
  echo "$base"
}

# ------------------------------------------------------------
# Model sources (PRIMARY → FALLBACK)
# ------------------------------------------------------------

download_with_fallback "${AVATAR_DIR}/RobotExpressive.glb" \
  "https://raw.githubusercontent.com/mrdoob/three.js/r147/examples/models/gltf/RobotExpressive/RobotExpressive.glb" \
  "https://raw.githubusercontent.com/mrdoob/three.js/r146/examples/models/gltf/RobotExpressive/RobotExpressive.glb"

download_with_fallback "${AVATAR_DIR}/Soldier.glb" \
  "https://raw.githubusercontent.com/mrdoob/three.js/r147/examples/models/gltf/Soldier.glb" \
  "https://raw.githubusercontent.com/mrdoob/three.js/r146/examples/models/gltf/Soldier.glb"



# ------------------------------------------------------------
# Generate vendor/avatars/avatars.json from downloaded GLBs
# (only includes valid GLB files)
# ------------------------------------------------------------
echo "==> Writing: ${AVATARS_JSON#${ROOT_DIR}/}"

{
  echo "{"
  echo "  \"basePath\": \"/vendor/avatars\","
  echo "  \"items\": ["

  first=1
  shopt -s nullglob
  for f in "${AVATAR_DIR}"/*.glb; do
    if is_valid_glb "$f"; then
      file="$(basename "$f")"
      name="$(pretty_name "$file")"

      if [ "$first" -eq 1 ]; then
        first=0
      else
        echo "    ,"
      fi

      printf "    { \"name\": \"%s\", \"file\": \"%s\" }" "$name" "$file"
      echo ""
    fi
  done
  shopt -u nullglob

  echo "  ]"
  echo "}"
} > "$AVATARS_JSON"

# ------------------------------------------------------------
# Done
# ------------------------------------------------------------
echo ""
echo "✅ Avatar models installed:"
ls -lh "${AVATAR_DIR}"
echo ""
echo "✅ avatars.json created:"
cat "$AVATARS_JSON"
echo ""
