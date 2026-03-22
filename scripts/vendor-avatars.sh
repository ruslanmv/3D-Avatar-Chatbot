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

# ── VRM Tier 1: CC0 VRoid samples ──
download_with_fallback "${AVATAR_DIR}/AvatarSample_A.vrm" \
  "https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/stable/AvatarSample_A.vrm"

download_with_fallback "${AVATAR_DIR}/AvatarSample_B.vrm" \
  "https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/stable/AvatarSample_B.vrm"

download_with_fallback "${AVATAR_DIR}/AvatarSample_C.vrm" \
  "https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/stable/AvatarSample_C.vrm"

download_with_fallback "${AVATAR_DIR}/fem_vroid.vrm" \
  "https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/fem_vroid.vrm"

download_with_fallback "${AVATAR_DIR}/masc_vroid.vrm" \
  "https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/masc_vroid.vrm"

download_with_fallback "${AVATAR_DIR}/Sendagaya_Shibu.vrm" \
  "https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/beta/Sendagaya_Shibu.vrm"

download_with_fallback "${AVATAR_DIR}/Sendagaya_Shino.vrm" \
  "https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/beta/Sendagaya_Shino.vrm"

download_with_fallback "${AVATAR_DIR}/Victoria_Rubin.vrm" \
  "https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/beta/Victoria_Rubin.vrm"

download_with_fallback "${AVATAR_DIR}/Vita.vrm" \
  "https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/beta/Vita.vrm"

download_with_fallback "${AVATAR_DIR}/Vivi.vrm" \
  "https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/beta/Vivi.vrm"

download_with_fallback "${AVATAR_DIR}/Darkness_Shibu.vrm" \
  "https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/beta/Darkness_Shibu.vrm"

download_with_fallback "${AVATAR_DIR}/HairSample_Female.vrm" \
  "https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/beta/HairSample_Female.vrm"

download_with_fallback "${AVATAR_DIR}/HairSample_Male.vrm" \
  "https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/beta/HairSample_Male.vrm"

download_with_fallback "${AVATAR_DIR}/Sakurada_Fumiriya.vrm" \
  "https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/beta/Sakurada_Fumiriya.vrm"

# ── Legacy GLB models removed ──
# TalkingHead GLB models (brunette, avaturn, avatarsdk, mpfb) were removed from
# the built-in catalog. See addons/glb/ for archived copies.
# GLB body-only models (woman, girl, student) also removed.

# ------------------------------------------------------------
# Generate vendor/avatars/avatars.json from downloaded GLBs and VRMs
# (only includes valid model files)
# ------------------------------------------------------------
echo "==> Writing: ${AVATARS_JSON#${ROOT_DIR}/}"

{
  echo "{"
  echo "  \"basePath\": \"/vendor/avatars\","
  echo "  \"items\": ["

  first=1
  shopt -s nullglob
  for f in "${AVATAR_DIR}"/*.vrm; do
    file="$(basename "$f")"
    name="$(pretty_name "$file")"
    ext="${file##*.}"

    # Determine format
    format="glb"
    features="[]"
    if [ "$ext" = "vrm" ]; then
      format="vrm"
      features='["lipsync", "emotions", "gaze", "blink"]'
    fi

    if [ "$first" -eq 1 ]; then
      first=0
    else
      echo "    ,"
    fi

    printf "    { \"name\": \"%s\", \"file\": \"%s\", \"format\": \"%s\", \"features\": %s }" "$name" "$file" "$format" "$features"
    echo ""
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
