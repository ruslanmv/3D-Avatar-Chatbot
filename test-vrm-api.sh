#!/bin/bash

# VRM Factory API Test Script
# Tests the VRM Factory API to ensure it's working correctly

set -e  # Exit on error

BLUE='\033[0;34m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

API_URL="${VRM_FACTORY_URL:-http://localhost:8000}"
TEST_DIR="$(dirname "$0")/test-data"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}   VRM Factory API Test Suite${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Function to print status
print_status() {
    if [ $1 -eq 0 ]; then
        echo -e "${GREEN}✓${NC} $2"
    else
        echo -e "${RED}✗${NC} $2"
        exit 1
    fi
}

# Test 1: Check if API is running
echo -e "${YELLOW}Test 1:${NC} Checking if API is accessible..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/" || echo "000")

if [ "$HTTP_CODE" = "200" ]; then
    print_status 0 "API is running at $API_URL"
else
    echo -e "${RED}✗${NC} API is not accessible (HTTP $HTTP_CODE)"
    echo -e "${YELLOW}Hint:${NC} Make sure VRM Factory is running:"
    echo "  cd vrm-factory"
    echo "  docker-compose up -d"
    exit 1
fi

# Test 2: Check API response
echo -e "${YELLOW}Test 2:${NC} Checking API root endpoint..."
RESPONSE=$(curl -s "$API_URL/")
if echo "$RESPONSE" | grep -q "VRM Factory API"; then
    print_status 0 "API root endpoint returns valid response"
else
    print_status 1 "API root endpoint response invalid"
fi

# Test 3: Check if OpenAPI docs are accessible
echo -e "${YELLOW}Test 3:${NC} Checking API documentation..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/docs" || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
    print_status 0 "API documentation is accessible at $API_URL/docs"
else
    print_status 1 "API documentation not accessible"
fi

# Test 4: Create a simple test GLB file if not exists
echo -e "${YELLOW}Test 4:${NC} Preparing test data..."
mkdir -p "$TEST_DIR"

# Create a minimal test file (this would normally be a real GLB file)
TEST_FILE="$TEST_DIR/test.glb"
if [ ! -f "$TEST_FILE" ]; then
    echo "Test GLB data" > "$TEST_FILE"
    print_status 0 "Test file created at $TEST_FILE"
else
    print_status 0 "Test file already exists at $TEST_FILE"
fi

# Test 5: Test file upload endpoint (this will likely fail with our dummy file, but tests the endpoint)
echo -e "${YELLOW}Test 5:${NC} Testing conversion endpoint..."
echo -e "${YELLOW}Note:${NC} This test uses a dummy file and may fail during processing."
echo -e "${YELLOW}Note:${NC} For real testing, use an actual GLB file."

UPLOAD_RESPONSE=$(curl -s -X POST "$API_URL/convert-to-vrm/" \
    -F "file=@$TEST_FILE" \
    -w "\nHTTP_CODE:%{http_code}")

HTTP_CODE=$(echo "$UPLOAD_RESPONSE" | grep "HTTP_CODE" | cut -d':' -f2)

if [ "$HTTP_CODE" = "200" ]; then
    print_status 0 "Conversion endpoint is accessible"
    echo -e "${GREEN}Response:${NC}"
    echo "$UPLOAD_RESPONSE" | grep -v "HTTP_CODE" | python3 -m json.tool 2>/dev/null || echo "$UPLOAD_RESPONSE"
else
    echo -e "${YELLOW}⚠${NC}  Conversion endpoint responded with HTTP $HTTP_CODE"
    echo -e "${YELLOW}Note:${NC} This is expected with dummy test data"
fi

# Test 6: Check Docker container status (if using Docker)
echo -e "${YELLOW}Test 6:${NC} Checking Docker container status..."
if command -v docker &> /dev/null; then
    CONTAINER_STATUS=$(docker ps --filter "name=vrm-factory" --format "{{.Status}}" 2>/dev/null || echo "")
    if [ -n "$CONTAINER_STATUS" ]; then
        print_status 0 "Docker container is running: $CONTAINER_STATUS"
    else
        echo -e "${YELLOW}⚠${NC}  No running VRM Factory container found"
        echo -e "${YELLOW}Hint:${NC} Start with: cd vrm-factory && docker-compose up -d"
    fi
else
    echo -e "${YELLOW}⚠${NC}  Docker not installed, skipping container check"
fi

# Summary
echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}✓ API Test Suite Completed${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "${YELLOW}Summary:${NC}"
echo "  • API URL: $API_URL"
echo "  • API Docs: $API_URL/docs"
echo "  • Status: Running"
echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo "  1. Visit $API_URL/docs to see full API documentation"
echo "  2. Upload a real GLB file for conversion testing"
echo "  3. Check the frontend at index-vr.html"
echo ""
