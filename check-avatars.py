#!/usr/bin/env python3
"""
Avatar Health Checker & Test Suite
Validates all .glb and .vrm files + manifest + config consistency.

Usage:
    python3 check-avatars.py          # Full health check
    python3 check-avatars.py --test   # Test mode (for make test / CI)
"""

import json
import os
import struct
import sys

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
AVATAR_DIR = os.path.join(ROOT_DIR, 'vendor', 'avatars')
MANIFEST_PATH = os.path.join(AVATAR_DIR, 'avatars.json')
VERCEL_PATH = os.path.join(ROOT_DIR, 'vercel.json')
GLB_MAGIC = b'glTF'
MIN_VALID_SIZE = 1024  # Less than 1KB is suspicious


# ── GLB/VRM Binary Validation ──────────────────────────────────────────

def check_file(path):
    """Validate a single GLB/VRM file. Returns (ok, message)."""
    if not os.path.exists(path):
        return False, 'File not found'

    size = os.path.getsize(path)
    if size < MIN_VALID_SIZE:
        return False, f'Too small ({size} bytes)'

    with open(path, 'rb') as f:
        header = f.read(12)

    if len(header) < 12:
        return False, f'Cannot read header ({len(header)} bytes)'

    magic = header[:4]
    if magic != GLB_MAGIC:
        try:
            text = header.decode('utf-8', errors='replace').lower()
            if '<!doc' in text or '<html' in text:
                return False, 'Contains HTML (likely 404 page, not a real model)'
            return False, f'Bad magic: {header[:4]!r} (expected {GLB_MAGIC!r})'
        except Exception:
            return False, f'Bad magic: {header[:4]!r}'

    version = struct.unpack_from('<I', header, 4)[0]
    total_length = struct.unpack_from('<I', header, 8)[0]

    if version not in (1, 2):
        return False, f'Unknown glTF version: {version}'

    if total_length != size:
        return False, f'Size mismatch: header says {total_length}, file is {size} bytes'

    return True, f'OK (v{version}, {size:,} bytes)'


# ── Test Suite ──────────────────────────────────────────────────────────

class TestResults:
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.errors = []

    def ok(self, name):
        self.passed += 1
        print(f'  PASS  {name}')

    def fail(self, name, reason):
        self.failed += 1
        self.errors.append((name, reason))
        print(f'  FAIL  {name}: {reason}')

    @property
    def total(self):
        return self.passed + self.failed

    @property
    def success(self):
        return self.failed == 0


def test_avatar_files(results):
    """Test 1: All avatar files on disk are valid GLB/VRM binary."""
    print('\n[Test] Avatar file binary validation')
    files = sorted([
        f for f in os.listdir(AVATAR_DIR)
        if f.lower().endswith(('.glb', '.vrm'))
    ])

    if not files:
        results.fail('avatar-files-exist', 'No .glb or .vrm files found')
        return

    for name in files:
        path = os.path.join(AVATAR_DIR, name)
        ok, msg = check_file(path)
        if ok:
            results.ok(name)
        else:
            results.fail(name, msg)

    # Check subdirectories
    for subdir in ['glb-morph', 'vrm']:
        sub_path = os.path.join(AVATAR_DIR, subdir)
        if os.path.isdir(sub_path):
            sub_files = sorted([
                f for f in os.listdir(sub_path)
                if f.lower().endswith(('.glb', '.vrm'))
            ])
            for name in sub_files:
                path = os.path.join(sub_path, name)
                ok, msg = check_file(path)
                display = f'{subdir}/{name}'
                if ok:
                    results.ok(display)
                else:
                    results.fail(display, msg)


def test_manifest_consistency(results):
    """Test 2: avatars.json manifest references only files that exist on disk."""
    print('\n[Test] Manifest consistency (avatars.json)')

    if not os.path.exists(MANIFEST_PATH):
        results.fail('manifest-exists', 'avatars.json not found')
        return

    with open(MANIFEST_PATH) as f:
        manifest = json.load(f)

    items = manifest.get('items', [])
    if not items:
        results.fail('manifest-not-empty', 'avatars.json has no items')
        return

    results.ok(f'manifest-loaded ({len(items)} entries)')

    for item in items:
        name = item.get('name', '?')
        filename = item.get('file', '')
        path = os.path.join(AVATAR_DIR, filename)

        if not filename:
            results.fail(f'manifest:{name}', 'Missing "file" field')
        elif not os.path.exists(path):
            results.fail(f'manifest:{name}', f'{filename} not found on disk')
        else:
            ok, msg = check_file(path)
            if ok:
                results.ok(f'manifest:{name} -> {filename}')
            else:
                results.fail(f'manifest:{name} -> {filename}', msg)

    # Check for orphaned files (on disk but not in manifest)
    manifest_files = {item['file'] for item in items if 'file' in item}
    disk_files = {
        f for f in os.listdir(AVATAR_DIR)
        if f.lower().endswith(('.glb', '.vrm'))
    }
    orphans = disk_files - manifest_files
    if orphans:
        for orphan in sorted(orphans):
            results.fail(f'orphan:{orphan}', 'On disk but not in avatars.json manifest')
    else:
        results.ok('no-orphaned-files')


def test_vercel_config(results):
    """Test 3: vercel.json serves .glb, .vrm, and .gltf with correct headers."""
    print('\n[Test] Vercel config (static file serving)')

    if not os.path.exists(VERCEL_PATH):
        results.fail('vercel-exists', 'vercel.json not found')
        return

    with open(VERCEL_PATH) as f:
        config = json.load(f)

    results.ok('vercel.json loaded')

    # Check headers for model files
    headers = config.get('headers', [])
    model_header = None
    for h in headers:
        src = h.get('source', '')
        if 'glb' in src:
            model_header = h
            break

    if not model_header:
        results.fail('vercel-model-headers', 'No header rule for .glb files')
        return

    source = model_header.get('source', '')
    for ext in ['glb', 'vrm', 'gltf']:
        if ext in source:
            results.ok(f'vercel-headers-{ext}: served by "{source}"')
        else:
            results.fail(f'vercel-headers-{ext}', f'.{ext} not in header rule "{source}"')

    # Check Content-Type
    header_dict = {h['key']: h['value'] for h in model_header.get('headers', [])}
    ct = header_dict.get('Content-Type', '')
    if 'gltf' in ct or 'octet' in ct:
        results.ok(f'vercel-content-type: {ct}')
    else:
        results.fail('vercel-content-type', f'Unexpected Content-Type: {ct}')

    # Check CORS
    cors = header_dict.get('Access-Control-Allow-Origin', '')
    if cors == '*':
        results.ok('vercel-cors: Access-Control-Allow-Origin: *')
    else:
        results.fail('vercel-cors', f'Missing or wrong CORS header: "{cors}"')

    # Check rewrites include /vendor/
    rewrites = config.get('rewrites', [])
    vendor_rewrite = any('/vendor/' in r.get('source', '') for r in rewrites)
    if vendor_rewrite:
        results.ok('vercel-vendor-rewrite: /vendor/ path served')
    else:
        results.fail('vercel-vendor-rewrite', 'No rewrite rule for /vendor/')


def test_essential_files(results):
    """Test 4: Essential project files exist."""
    print('\n[Test] Essential project files')

    essential = [
        'index.html',
        'src/main.js',
        'styles/main.css',
        'src/gltf-viewer/ViewerEngine.js',
        'src/gltf-viewer/VRSupport.js',
        'src/gltf-viewer/ARSupport.js',
        'src/gltf-viewer/VRChatPanel.js',
        'src/gltf-viewer/VRChatIntegration.js',
        'src/gltf-viewer/VRControllers.js',
        'src/gltf-viewer/VRMediaPanel.js',
        'src/gltf-viewer/AvatarManager.js',
        'src/gltf-viewer/ModelViewerAR.js',
        'src/gltf-viewer/MobileSupport.js',
        'vendor/avatars/avatars.json',
        'vercel.json',
        'package.json',
    ]

    for rel_path in essential:
        full = os.path.join(ROOT_DIR, rel_path)
        if os.path.exists(full):
            results.ok(rel_path)
        else:
            results.fail(rel_path, 'File not found')


# ── Report Mode (detailed) ─────────────────────────────────────────────

def report_mode():
    """Full health check report with detailed output."""
    if not os.path.isdir(AVATAR_DIR):
        print(f'ERROR: Avatar directory not found: {AVATAR_DIR}')
        sys.exit(1)

    files = sorted([
        f for f in os.listdir(AVATAR_DIR)
        if f.lower().endswith(('.glb', '.vrm'))
    ])

    if not files:
        print('No .glb or .vrm files found.')
        sys.exit(1)

    print(f'Checking {len(files)} avatar files in {AVATAR_DIR}\n')
    print(f'{"File":<35} {"Size":>12}  {"Status"}')
    print('-' * 75)

    healthy = []
    broken = []

    for name in files:
        path = os.path.join(AVATAR_DIR, name)
        size = os.path.getsize(path)
        ok, msg = check_file(path)
        icon = 'OK' if ok else '!!'
        print(f'[{icon}] {name:<33} {size:>10,}  {"PASS" if ok else "FAIL"}  {msg}')
        if ok:
            healthy.append(name)
        else:
            broken.append((name, msg))

    for subdir in ['glb-morph', 'vrm']:
        sub_path = os.path.join(AVATAR_DIR, subdir)
        if os.path.isdir(sub_path):
            sub_files = sorted([
                f for f in os.listdir(sub_path)
                if f.lower().endswith(('.glb', '.vrm'))
            ])
            for name in sub_files:
                path = os.path.join(sub_path, name)
                size = os.path.getsize(path)
                ok, msg = check_file(path)
                display = f'{subdir}/{name}'
                icon = 'OK' if ok else '!!'
                print(f'[{icon}] {display:<33} {size:>10,}  {"PASS" if ok else "FAIL"}  {msg}')
                if ok:
                    healthy.append(display)
                else:
                    broken.append((display, msg))

    print('-' * 75)
    print(f'\nTotal: {len(healthy)} healthy, {len(broken)} broken\n')

    if broken:
        print('BROKEN FILES (need re-download):')
        for name, reason in broken:
            print(f'  - {name}: {reason}')

    return len(broken) == 0


# ── Main ────────────────────────────────────────────────────────────────

def main():
    test_mode = '--test' in sys.argv

    if test_mode:
        print('=' * 60)
        print('  3D Avatar Chatbot — Test Suite')
        print('=' * 60)

        results = TestResults()

        test_essential_files(results)
        test_avatar_files(results)
        test_manifest_consistency(results)
        test_vercel_config(results)

        print('\n' + '=' * 60)
        print(f'  Results: {results.passed} passed, {results.failed} failed ({results.total} total)')
        print('=' * 60)

        if results.errors:
            print('\nFailed tests:')
            for name, reason in results.errors:
                print(f'  - {name}: {reason}')

        sys.exit(0 if results.success else 1)
    else:
        ok = report_mode()
        sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
