#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# vendor-three-global.sh
#
# Downloads Three.js GLOBAL (non-module) files required by
# index.html (script tags, NOT ES modules).
#
# Version pinned to 0.147.0 because it is the LAST release
# that includes the legacy /examples/js/ directory.
#
# WSL + NTFS SAFE (no temp files, no atomic renames).
# ============================================================

THREE_VER="0.147.0"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR_DIR="${ROOT_DIR}/vendor/three-${THREE_VER}"

echo "==> Installing Three.js vendor (GLOBAL) v${THREE_VER}"
echo "==> Target: ${VENDOR_DIR}"

# ------------------------------------------------------------
# Create required directories
# ------------------------------------------------------------
mkdir -p "${VENDOR_DIR}/build"
mkdir -p "${VENDOR_DIR}/examples/js/controls"
mkdir -p "${VENDOR_DIR}/examples/js/loaders"

# ------------------------------------------------------------
# Official, VERIFIED URLs (unpkg serves these correctly)
# ------------------------------------------------------------
THREE_MIN_URL="https://unpkg.com/three@${THREE_VER}/build/three.min.js"
ORBIT_URL="https://unpkg.com/three@${THREE_VER}/examples/js/controls/OrbitControls.js"
GLTF_URL="https://unpkg.com/three@${THREE_VER}/examples/js/loaders/GLTFLoader.js"

# ------------------------------------------------------------
# Download helper (WSL-safe)
# ------------------------------------------------------------
download() {
    local url="$1"
    local out="$2"

    echo "==> Downloading: ${out#${ROOT_DIR}/}"

    # Remove existing file to avoid NTFS lock issues
    rm -f "$out"

    curl -fL \
      --retry 5 \
      --retry-delay 1 \
      --retry-connrefused \
      --output "$out" \
      "$url"

    # Sanity check: ensure file is not HTML
    if head -n 1 "$out" | grep -qiE '<!doctype html|<html'; then
        echo "❌ ERROR: Downloaded HTML instead of JS from: $url" >&2
        rm -f "$out"
        exit 1
    fi
}

# ------------------------------------------------------------
# Execute downloads
# ------------------------------------------------------------
download "$THREE_MIN_URL" "${VENDOR_DIR}/build/three.min.js"
download "$ORBIT_URL"     "${VENDOR_DIR}/examples/js/controls/OrbitControls.js"
download "$GLTF_URL"      "${VENDOR_DIR}/examples/js/loaders/GLTFLoader.js"

# ------------------------------------------------------------
# Done
# ------------------------------------------------------------
echo ""
echo "✅ Done. Files installed:"
echo " - vendor/three-${THREE_VER}/build/three.min.js"
echo " - vendor/three-${THREE_VER}/examples/js/controls/OrbitControls.js"
echo " - vendor/three-${THREE_VER}/examples/js/loaders/GLTFLoader.js"
echo ""
echo "Use these in index.html (ORDER MATTERS):"
cat <<EOF
<script src="vendor/three-${THREE_VER}/build/three.min.js"></script>
<script src="vendor/three-${THREE_VER}/examples/js/controls/OrbitControls.js"></script>
<script src="vendor/three-${THREE_VER}/examples/js/loaders/GLTFLoader.js"></script>
<script src="src/main.js"></script>
EOF
