#!/bin/bash

# VR Functionality Test Script
# Tests VR support, session management, and controller functionality

set -e

BLUE='\033[0;34m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}   VR Functionality Test Suite${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Function to print status
print_status() {
    if [ $1 -eq 0 ]; then
        echo -e "${GREEN}✓${NC} $2"
    else
        echo -e "${RED}✗${NC} $2"
    fi
}

# Test 1: Check if server is running
echo -e "${YELLOW}Test 1:${NC} Checking if local server is running..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:8080/" 2>/dev/null || echo "000")

if [ "$HTTP_CODE" = "200" ]; then
    print_status 0 "Local server is running on port 8080"
else
    echo -e "${RED}✗${NC} Server not running (HTTP $HTTP_CODE)"
    echo -e "${YELLOW}Starting server...${NC}"
    echo -e "${YELLOW}Run in another terminal:${NC} python3 -m http.server 8080"
    exit 1
fi

# Test 2: Check if index.html exists
echo -e "${YELLOW}Test 2:${NC} Checking if index.html is accessible..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:8080/index.html" || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
    print_status 0 "index.html is accessible"
else
    print_status 1 "index.html not found"
fi

# Test 3: Check if VR modules are present
echo -e "${YELLOW}Test 3:${NC} Checking VR modules..."

check_file() {
    if [ -f "$1" ]; then
        print_status 0 "$1 exists"
        return 0
    else
        print_status 1 "$1 missing"
        return 1
    fi
}

check_file "src/gltf-viewer/VRSupport.js"
check_file "src/gltf-viewer/VRControllers.js"
check_file "src/gltf-viewer/ViewerEngine.js"

# Test 4: Check if Three.js is accessible
echo -e "${YELLOW}Test 4:${NC} Checking Three.js library..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:8080/vendor/three-0.147.0/build/three.module.js" || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
    print_status 0 "Three.js library is accessible"
else
    print_status 1 "Three.js library not found"
fi

# Test 5: Check if vr-test.html exists
echo -e "${YELLOW}Test 5:${NC} Checking VR test page..."
if [ -f "vr-test.html" ]; then
    print_status 0 "vr-test.html exists"
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:8080/vr-test.html" || echo "000")
    if [ "$HTTP_CODE" = "200" ]; then
        print_status 0 "vr-test.html is accessible"
    fi
else
    print_status 1 "vr-test.html not found"
fi

# Test 6: Create a simple VR detection test
echo -e "${YELLOW}Test 6:${NC} Creating VR detection test page..."

cat > test-vr-detect.html << 'EOF'
<!DOCTYPE html>
<html>
<head>
    <title>VR Detection Test</title>
    <style>
        body { font-family: monospace; padding: 20px; background: #000; color: #0f0; }
        .test { margin: 10px 0; padding: 10px; background: #111; }
        .pass { color: #0f0; }
        .fail { color: #f00; }
    </style>
</head>
<body>
    <h1>VR Detection Test</h1>
    <div id="results"></div>

    <script>
        const results = document.getElementById('results');

        function addResult(test, pass, message) {
            const div = document.createElement('div');
            div.className = 'test ' + (pass ? 'pass' : 'fail');
            div.innerHTML = `<strong>${pass ? '✓' : '✗'} ${test}:</strong> ${message}`;
            results.appendChild(div);
        }

        // Test 1: WebXR API
        if (navigator.xr) {
            addResult('WebXR API', true, 'navigator.xr is available');

            // Test 2: VR Session Support
            navigator.xr.isSessionSupported('immersive-vr').then(supported => {
                addResult('VR Support', supported, supported ? 'immersive-vr is supported' : 'immersive-vr not supported');
            }).catch(err => {
                addResult('VR Support', false, 'Error checking support: ' + err.message);
            });
        } else {
            addResult('WebXR API', false, 'navigator.xr is not available (use HTTPS or localhost)');
        }

        // Test 3: WebGL
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (gl) {
            addResult('WebGL', true, 'WebGL context created successfully');
            addResult('WebGL Vendor', true, gl.getParameter(gl.VENDOR));
            addResult('WebGL Renderer', true, gl.getParameter(gl.RENDERER));
        } else {
            addResult('WebGL', false, 'Failed to create WebGL context');
        }

        // Test 4: HTTPS
        const isSecure = window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        addResult('Secure Context', isSecure, window.location.protocol + '//' + window.location.hostname);

        // Test 5: Browser
        const ua = navigator.userAgent;
        const isQuest = ua.includes('Quest');
        const isChrome = ua.includes('Chrome');
        addResult('Browser', true, isQuest ? 'Meta Quest Browser' : (isChrome ? 'Chrome' : 'Other'));

        // Test 6: Screen
        addResult('Screen Size', true, `${window.innerWidth}x${window.innerHeight}`);
        addResult('Device Pixel Ratio', true, window.devicePixelRatio);
    </script>
</body>
</html>
EOF

print_status 0 "Created test-vr-detect.html"

# Test 7: Check for JavaScript errors in main page
echo -e "${YELLOW}Test 7:${NC} Checking for syntax errors in VR modules..."

# Use Node.js to check syntax if available
if command -v node &> /dev/null; then
    for file in "src/gltf-viewer/VRSupport.js" "src/gltf-viewer/VRControllers.js"; do
        if node -c "$file" 2>/dev/null; then
            print_status 0 "$file has valid syntax"
        else
            print_status 1 "$file has syntax errors"
        fi
    done
else
    echo -e "${YELLOW}⚠${NC}  Node.js not installed, skipping syntax check"
fi

# Summary
echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}✓ VR Test Suite Completed${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo "  1. Open ${GREEN}http://localhost:8080/test-vr-detect.html${NC}"
echo "     This will show detailed VR support info"
echo ""
echo "  2. Open ${GREEN}http://localhost:8080/vr-test.html${NC}"
echo "     This will test basic VR scene rendering"
echo ""
echo "  3. Open ${GREEN}http://localhost:8080/index.html${NC}"
echo "     This is the full chatbot with VR"
echo ""
echo -e "${YELLOW}For Meta Quest:${NC}"
echo "  1. Find your IP: ${GREEN}ifconfig | grep inet${NC}"
echo "  2. On Quest Browser: http://YOUR_IP:8080/test-vr-detect.html"
echo "  3. Check all tests pass"
echo "  4. Then try: http://YOUR_IP:8080/index.html"
echo ""
