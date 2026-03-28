/**
 * @file Animation Library Tests
 *
 * Validates every animation file referenced in the manifest:
 *   1. Manifest integrity — all paths resolve to real files
 *   2. BVH parsing — every .bvh starts with HIERARCHY, has valid structure
 *   3. VRMA validation — every .vrma is valid glTF binary
 *   4. BVH bone coverage — checks retargetable bones per clip
 *   5. Emotion mapping — all emotion entries point to existing files
 */

const fs = require('fs');
const path = require('path');

const ANIM_DIR = path.resolve(__dirname, '..', 'vendor', 'animations');
const MANIFEST_PATH = path.join(ANIM_DIR, 'manifest.json');

// ── Load manifest ──
let manifest;
try {
    manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
} catch (e) {
    manifest = null;
}

// Known VRM humanoid bone names (for retarget coverage check)
const VRM_BONES = new Set([
    'hips',
    'spine',
    'chest',
    'upperchest',
    'neck',
    'head',
    'leftshoulder',
    'rightshoulder',
    'leftupperarm',
    'rightupperarm',
    'leftlowerarm',
    'rightlowerarm',
    'lefthand',
    'righthand',
    'leftupperleg',
    'rightupperleg',
    'leftlowerleg',
    'rightlowerleg',
    'leftfoot',
    'rightfoot',
    'lefttoes',
    'righttoes',
]);

// BVH bone name → VRM mapping (same as ClipAnimationLoader)
const BVH_TO_VRM = {
    hips: 'hips',
    hip: 'hips',
    pelvis: 'hips',
    spine: 'spine',
    spine1: 'chest',
    spine2: 'upperchest',
    chest: 'chest',
    neck: 'neck',
    head: 'head',
    leftshoulder: 'leftshoulder',
    rightshoulder: 'rightshoulder',
    leftupperarm: 'leftupperarm',
    leftarm: 'leftupperarm',
    rightupperarm: 'rightupperarm',
    rightarm: 'rightupperarm',
    leftforearm: 'leftlowerarm',
    leftlowerarm: 'leftlowerarm',
    rightforearm: 'rightlowerarm',
    rightlowerarm: 'rightlowerarm',
    lefthand: 'lefthand',
    righthand: 'righthand',
    leftupleg: 'leftupperleg',
    leftupperleg: 'leftupperleg',
    leftthigh: 'leftupperleg',
    rightupleg: 'rightupperleg',
    rightupperleg: 'rightupperleg',
    rightthigh: 'rightupperleg',
    leftleg: 'leftlowerleg',
    leftlowerleg: 'leftlowerleg',
    rightleg: 'rightlowerleg',
    rightlowerleg: 'rightlowerleg',
    leftfoot: 'leftfoot',
    rightfoot: 'rightfoot',
    lefttoebase: 'lefttoes',
    righttoebase: 'righttoes',
};

/**
 * Minimal BVH parser — extracts bone names and validates structure.
 * Returns { bones: string[], channels: number, frames: number, error: string|null }
 */
function parseBVH(text) {
    const lines = text
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
    if (lines[0] !== 'HIERARCHY') {
        return { bones: [], channels: 0, frames: 0, error: 'Missing HIERARCHY header' };
    }

    const bones = [];
    let channels = 0;
    let frames = 0;
    let inMotion = false;
    let braceDepth = 0;

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];

        if (line === 'MOTION') {
            inMotion = true;
            continue;
        }

        if (!inMotion) {
            // Parse skeleton hierarchy
            if (line.startsWith('ROOT ') || line.startsWith('JOINT ')) {
                const name = line.split(/\s+/)[1];
                if (name) bones.push(name);
            }

            if (line === '{') braceDepth++;
            if (line === '}') braceDepth--;

            if (line.startsWith('CHANNELS')) {
                const parts = line.split(/\s+/);
                const count = parseInt(parts[1], 10);
                if (!isNaN(count)) channels += count;
            }

            // Validate OFFSET
            if (line.startsWith('OFFSET')) {
                const parts = line.split(/\s+/).slice(1);
                if (parts.length !== 3) {
                    return { bones, channels, frames, error: `Invalid OFFSET at line ${i + 1}: "${line}"` };
                }
                for (const v of parts) {
                    if (isNaN(parseFloat(v))) {
                        return { bones, channels, frames, error: `Non-numeric OFFSET value at line ${i + 1}: "${v}"` };
                    }
                }
            }
        } else {
            // Parse motion section
            if (line.startsWith('Frames:')) {
                frames = parseInt(line.split(':')[1].trim(), 10);
            }
        }
    }

    if (braceDepth !== 0) {
        return { bones, channels, frames, error: `Unbalanced braces (depth=${braceDepth})` };
    }

    if (bones.length === 0) {
        return { bones, channels, frames, error: 'No bones found in hierarchy' };
    }

    if (frames === 0) {
        return { bones, channels, frames, error: 'No MOTION frames found' };
    }

    return { bones, channels, frames, error: null };
}

/**
 * Check VRM bone coverage for a BVH file's bone list.
 * Returns { mapped: string[], unmapped: string[], coverage: number }
 */
function checkBoneCoverage(bvhBones) {
    const mapped = [];
    const unmapped = [];

    for (const bone of bvhBones) {
        const normalized = bone.toLowerCase().replace(/[^a-z]/g, '');
        if (BVH_TO_VRM[normalized]) {
            mapped.push(bone);
        } else {
            unmapped.push(bone);
        }
    }

    const coverage = bvhBones.length > 0 ? mapped.length / bvhBones.length : 0;
    return { mapped, unmapped, coverage };
}

// =========================================================================
// TESTS
// =========================================================================

describe('Animation Manifest', () => {
    test('manifest.json exists and is valid JSON', () => {
        expect(manifest).not.toBeNull();
        expect(manifest.categories).toBeDefined();
        expect(typeof manifest.categories).toBe('object');
    });

    test('manifest has expected categories', () => {
        const cats = Object.keys(manifest.categories);
        expect(cats.length).toBeGreaterThanOrEqual(8);
        expect(cats).toContain('dance');
        expect(cats).toContain('emotion');
        expect(cats).toContain('idle');
        expect(cats).toContain('sitting');
        expect(cats).toContain('laying');
        expect(cats).toContain('kneeling');
        expect(cats).toContain('action');
        expect(cats).toContain('exercise');
        expect(cats).toContain('vrma');
    });

    test('every category has label, icon, and files array', () => {
        for (const [key, cat] of Object.entries(manifest.categories)) {
            expect(cat.label).toBeTruthy();
            expect(cat.icon).toBeTruthy();
            expect(Array.isArray(cat.files)).toBe(true);
            expect(cat.files.length).toBeGreaterThan(0);
        }
    });

    test('emotionMapping exists and has entries', () => {
        expect(manifest.emotionMapping).toBeDefined();
        expect(Object.keys(manifest.emotionMapping).length).toBeGreaterThan(0);
    });
});

// ── File existence ──

describe('Animation Files Exist', () => {
    const allFiles = [];
    if (manifest && manifest.categories) {
        for (const [catKey, cat] of Object.entries(manifest.categories)) {
            for (const file of cat.files) {
                allFiles.push({ category: catKey, file });
            }
        }
    }

    test.each(allFiles)('$category/$file exists on disk', ({ file }) => {
        const fullPath = path.join(ANIM_DIR, file);
        expect(fs.existsSync(fullPath)).toBe(true);
    });
});

// ── Emotion mapping file existence ──

describe('Emotion Mapping Files Exist', () => {
    const emotionFiles = [];
    if (manifest && manifest.emotionMapping) {
        for (const [emotion, files] of Object.entries(manifest.emotionMapping)) {
            for (const file of files) {
                emotionFiles.push({ emotion, file });
            }
        }
    }

    test.each(emotionFiles)('emotionMapping.$emotion → $file exists', ({ file }) => {
        const fullPath = path.join(ANIM_DIR, file);
        expect(fs.existsSync(fullPath)).toBe(true);
    });
});

// ── BVH file parsing ──

describe('BVH Files Parse Correctly', () => {
    const bvhFiles = [];
    if (manifest && manifest.categories) {
        for (const [catKey, cat] of Object.entries(manifest.categories)) {
            for (const file of cat.files) {
                if (file.endsWith('.bvh')) {
                    bvhFiles.push({ category: catKey, file });
                }
            }
        }
    }

    test.each(bvhFiles)('$file parses without errors', ({ file }) => {
        const fullPath = path.join(ANIM_DIR, file);
        const text = fs.readFileSync(fullPath, 'utf-8');

        // Should not be HTML
        expect(text.trimStart().startsWith('<')).toBe(false);

        // Should start with HIERARCHY
        expect(text.trimStart().startsWith('HIERARCHY')).toBe(true);

        const result = parseBVH(text);
        expect(result.error).toBeNull();
        expect(result.bones.length).toBeGreaterThan(0);
        expect(result.frames).toBeGreaterThan(0);
        expect(result.channels).toBeGreaterThan(0);
    });

    test.each(bvhFiles)('$file has retargetable bones (>30%% coverage)', ({ file }) => {
        const fullPath = path.join(ANIM_DIR, file);
        const text = fs.readFileSync(fullPath, 'utf-8');
        const { bones } = parseBVH(text);
        const { coverage, mapped } = checkBoneCoverage(bones);

        // At least 30% of bones should map to VRM humanoid skeleton
        expect(coverage).toBeGreaterThanOrEqual(0.3);
        // At minimum: hips should be present
        const mappedLower = mapped.map((b) => b.toLowerCase().replace(/[^a-z]/g, ''));
        const hasHips = mappedLower.some((b) => BVH_TO_VRM[b] === 'hips');
        expect(hasHips).toBe(true);
    });
});

// ── VRMA file validation ──

describe('VRMA Files Are Valid glTF', () => {
    const vrmaFiles = [];
    if (manifest && manifest.categories) {
        for (const [catKey, cat] of Object.entries(manifest.categories)) {
            for (const file of cat.files) {
                if (file.endsWith('.vrma')) {
                    vrmaFiles.push({ category: catKey, file });
                }
            }
        }
    }

    test.each(vrmaFiles)('$file is valid glTF (binary or JSON)', ({ file }) => {
        const fullPath = path.join(ANIM_DIR, file);
        const buffer = fs.readFileSync(fullPath);
        expect(buffer.length).toBeGreaterThan(12);

        const magic = buffer.toString('ascii', 0, 4);
        if (magic === 'glTF') {
            // glTF binary: validate header
            const version = buffer.readUInt32LE(4);
            expect(version).toBe(2);
            const totalLength = buffer.readUInt32LE(8);
            expect(totalLength).toBe(buffer.length);
        } else {
            // glTF JSON: validate parseable JSON with correct structure
            const text = buffer.toString('utf-8');
            const gltf = JSON.parse(text);
            expect(gltf.asset).toBeDefined();
        }
    });

    test.each(vrmaFiles)('$file contains animation data', ({ file }) => {
        const fullPath = path.join(ANIM_DIR, file);
        const buffer = fs.readFileSync(fullPath);

        let gltf;
        const magic = buffer.toString('ascii', 0, 4);
        if (magic === 'glTF') {
            // glTF binary: read JSON chunk (first chunk after 12-byte header)
            const chunkLength = buffer.readUInt32LE(12);
            const chunkType = buffer.readUInt32LE(16);
            expect(chunkType).toBe(0x4e4f534a); // JSON chunk type
            const jsonStr = buffer.toString('utf-8', 20, 20 + chunkLength);
            gltf = JSON.parse(jsonStr);
        } else {
            // glTF JSON: parse directly
            gltf = JSON.parse(buffer.toString('utf-8'));
        }

        // Should have animations array
        expect(gltf.animations).toBeDefined();
        expect(Array.isArray(gltf.animations)).toBe(true);
        expect(gltf.animations.length).toBeGreaterThan(0);

        // Should have VRMC_vrm_animation extension
        expect(gltf.extensions).toBeDefined();
        expect(gltf.extensions.VRMC_vrm_animation).toBeDefined();

        // Should have humanoid bone mapping
        const vrmAnim = gltf.extensions.VRMC_vrm_animation;
        expect(vrmAnim.humanoid).toBeDefined();
        expect(vrmAnim.humanoid.humanBones).toBeDefined();
        expect(Object.keys(vrmAnim.humanoid.humanBones).length).toBeGreaterThan(0);
    });
});

// ── BVH bone name analysis (summary) ──

describe('BVH Bone Coverage Summary', () => {
    test('all BVH files collectively cover core humanoid bones', () => {
        const allMappedBones = new Set();

        if (manifest && manifest.categories) {
            for (const cat of Object.values(manifest.categories)) {
                for (const file of cat.files) {
                    if (!file.endsWith('.bvh')) continue;
                    const fullPath = path.join(ANIM_DIR, file);
                    if (!fs.existsSync(fullPath)) continue;
                    const text = fs.readFileSync(fullPath, 'utf-8');
                    const { bones } = parseBVH(text);
                    for (const bone of bones) {
                        const normalized = bone.toLowerCase().replace(/[^a-z]/g, '');
                        const vrm = BVH_TO_VRM[normalized];
                        if (vrm) allMappedBones.add(vrm);
                    }
                }
            }
        }

        // Core bones that should be covered across all clips
        const coreBones = [
            'hips',
            'spine',
            'head',
            'leftupperarm',
            'rightupperarm',
            'leftlowerarm',
            'rightlowerarm',
            'leftupperleg',
            'rightupperleg',
        ];
        for (const bone of coreBones) {
            expect(allMappedBones.has(bone)).toBe(true);
        }
    });
});

// ── No duplicate files ──

describe('No Duplicate Animation Files', () => {
    test('no file appears in multiple categories', () => {
        const seen = new Map(); // file → category
        const duplicates = [];

        if (manifest && manifest.categories) {
            for (const [catKey, cat] of Object.entries(manifest.categories)) {
                for (const file of cat.files) {
                    if (seen.has(file)) {
                        duplicates.push(`${file} in both ${seen.get(file)} and ${catKey}`);
                    }
                    seen.set(file, catKey);
                }
            }
        }

        expect(duplicates).toEqual([]);
    });
});
