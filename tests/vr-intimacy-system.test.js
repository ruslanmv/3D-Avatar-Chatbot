/**
 * VR Intimacy System — Unit Tests
 *
 * Tests the complete VR Intimacy System:
 * - Profile resolution with hysteresis
 * - Proximity-based profile transitions
 * - Seated detection (velocity-based)
 * - Wall detection caching
 * - Hand contact flow
 * - Expression bridge
 * - System enable/disable lifecycle
 *
 * Compatible with GitHub CI (jest --ci)
 */

/* global describe, test, expect, beforeEach, jest */

const fs = require('fs');
const path = require('path');

// ── Load source files as text and evaluate (same pattern as other tests) ──

const profilesSrc = fs.readFileSync(path.join(__dirname, '../src/gltf-viewer/VRIntimacyProfiles.js'), 'utf-8');

// Strip ES module syntax for CJS evaluation in Jest
function stripESM(src) {
    return src
        .replace(/import\s+.*?from\s+['"].*?['"];?\n?/g, '')
        .replace(/export\s+const\s+/g, 'const ')
        .replace(/export\s+function\s+/g, 'function ')
        .replace(/export\s+class\s+/g, 'class ')
        .replace(/export\s+\{[^}]*\};?\n?/g, '');
}

// Evaluate profiles module
const profilesCode = stripESM(profilesSrc);
const profilesModule = {};
const profilesFn = new Function(
    'module',
    'exports',
    profilesCode + '\nmodule.exports = { VR_INTIMACY_PROFILES, resolveVRIntimacyProfile };'
);
profilesFn(profilesModule, {});
const { VR_INTIMACY_PROFILES, resolveVRIntimacyProfile } = profilesModule.exports;

// ── Minimal THREE.js mock for VRProximityTracker ──

const mockVector3 = (x = 0, y = 0, z = 0) => ({
    x,
    y,
    z,
    clone() {
        return mockVector3(this.x, this.y, this.z);
    },
    sub(other) {
        this.x -= other.x;
        this.y -= other.y;
        this.z -= other.z;
        return this;
    },
    setY(val) {
        this.y = val;
        return this;
    },
    normalize() {
        const len = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
        if (len > 0) {
            this.x /= len;
            this.y /= len;
            this.z /= len;
        }
        return this;
    },
    multiplyScalar(s) {
        this.x *= s;
        this.y *= s;
        this.z *= s;
        return this;
    },
    applyQuaternion() {
        return this;
    },
    lengthSq() {
        return this.x * this.x + this.y * this.y + this.z * this.z;
    },
    distanceTo(other) {
        const dx = this.x - other.x;
        const dy = this.y - other.y;
        const dz = this.z - other.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    },
    set(x, y, z) {
        this.x = x;
        this.y = y;
        this.z = z;
        return this;
    },
    setScalar(s) {
        this.x = s;
        this.y = s;
        this.z = s;
        return this;
    },
    getWorldPosition(target) {
        target.x = this.x;
        target.y = this.y;
        target.z = this.z;
        return target;
    },
});

// =========================================================================
// TEST SUITE: VRIntimacyProfiles
// =========================================================================

describe('VRIntimacyProfiles', () => {
    describe('profile definitions', () => {
        test('all 7 profiles exist with required fields', () => {
            const requiredKeys = [
                'idle',
                'awarePresence',
                'closeConversation',
                'comfortEmbrace',
                'closeSeated',
                'supportedStanding',
                'handContact',
            ];

            for (const key of requiredKeys) {
                const profile = VR_INTIMACY_PROFILES[key];
                expect(profile).toBeDefined();
                expect(profile.key).toBe(key);
                expect(typeof profile.desiredDistance).toBe('number');
                expect(typeof profile.minDistance).toBe('number');
                expect(typeof profile.maxDistance).toBe('number');
                expect(typeof profile.rootFollow).toBe('number');
                expect(typeof profile.allowHandContact).toBe('boolean');
                expect(typeof profile.allowRootFacing).toBe('boolean');
                expect(typeof profile.posePreset).toBe('string');
                expect(typeof profile.basePose).toBe('string');
                expect(typeof profile.talkStyle).toBe('string');
            }
        });

        test('distance bands form a coherent continuum', () => {
            // Profiles should be ordered by desiredDistance (ascending closeness)
            const ordered = [
                VR_INTIMACY_PROFILES.comfortEmbrace,
                VR_INTIMACY_PROFILES.closeSeated,
                VR_INTIMACY_PROFILES.handContact,
                VR_INTIMACY_PROFILES.closeConversation,
                VR_INTIMACY_PROFILES.supportedStanding,
                VR_INTIMACY_PROFILES.awarePresence,
                VR_INTIMACY_PROFILES.idle,
            ];

            for (let i = 0; i < ordered.length - 1; i++) {
                expect(ordered[i].desiredDistance).toBeLessThanOrEqual(ordered[i + 1].desiredDistance);
            }
        });

        test('minDistance < desiredDistance < maxDistance for every profile', () => {
            for (const profile of Object.values(VR_INTIMACY_PROFILES)) {
                expect(profile.minDistance).toBeLessThan(profile.desiredDistance);
                expect(profile.desiredDistance).toBeLessThan(profile.maxDistance);
            }
        });

        test('expression overrides are present on close-proximity profiles', () => {
            expect(VR_INTIMACY_PROFILES.idle.expressionOverride).toBeNull();
            expect(VR_INTIMACY_PROFILES.comfortEmbrace.expressionOverride).toBeDefined();
            expect(VR_INTIMACY_PROFILES.comfortEmbrace.expressionOverride.happy).toBeGreaterThan(0);
            expect(VR_INTIMACY_PROFILES.closeConversation.expressionOverride.happy).toBeGreaterThan(0);
            expect(VR_INTIMACY_PROFILES.handContact.expressionOverride.happy).toBeGreaterThan(0);
        });

        test('rootFollow increases with closeness', () => {
            expect(VR_INTIMACY_PROFILES.idle.rootFollow).toBe(0);
            expect(VR_INTIMACY_PROFILES.awarePresence.rootFollow).toBeGreaterThan(0);
            expect(VR_INTIMACY_PROFILES.closeConversation.rootFollow).toBeGreaterThan(
                VR_INTIMACY_PROFILES.awarePresence.rootFollow
            );
            expect(VR_INTIMACY_PROFILES.comfortEmbrace.rootFollow).toBeGreaterThan(
                VR_INTIMACY_PROFILES.closeConversation.rootFollow
            );
        });

        test('hand contact is only allowed in close profiles', () => {
            expect(VR_INTIMACY_PROFILES.idle.allowHandContact).toBe(false);
            expect(VR_INTIMACY_PROFILES.awarePresence.allowHandContact).toBe(false);
            expect(VR_INTIMACY_PROFILES.closeConversation.allowHandContact).toBe(true);
            expect(VR_INTIMACY_PROFILES.comfortEmbrace.allowHandContact).toBe(true);
            expect(VR_INTIMACY_PROFILES.handContact.allowHandContact).toBe(true);
        });
    });

    describe('resolveVRIntimacyProfile — distance-based', () => {
        test('returns idle for null snapshot', () => {
            expect(resolveVRIntimacyProfile(null).key).toBe('idle');
        });

        test('returns idle for distance > 1.45m', () => {
            const result = resolveVRIntimacyProfile({ distance: 2.0, isSeated: false, wallBehind: false });
            expect(result.key).toBe('idle');
        });

        test('returns awarePresence for distance 1.1–1.45m', () => {
            const result = resolveVRIntimacyProfile({ distance: 1.3, isSeated: false, wallBehind: false });
            expect(result.key).toBe('awarePresence');
        });

        test('returns closeConversation for distance 0.72–1.1m', () => {
            const result = resolveVRIntimacyProfile({ distance: 0.9, isSeated: false, wallBehind: false });
            expect(result.key).toBe('closeConversation');
        });

        test('returns comfortEmbrace for distance < 0.72m', () => {
            const result = resolveVRIntimacyProfile({ distance: 0.5, isSeated: false, wallBehind: false });
            expect(result.key).toBe('comfortEmbrace');
        });

        test('returns closeSeated when seated and close', () => {
            const result = resolveVRIntimacyProfile({ distance: 1.0, isSeated: true, wallBehind: false });
            expect(result.key).toBe('closeSeated');
        });

        test('returns supportedStanding when wall behind and close', () => {
            const result = resolveVRIntimacyProfile({ distance: 1.0, isSeated: false, wallBehind: true });
            expect(result.key).toBe('supportedStanding');
        });

        test('seated takes priority over wall', () => {
            const result = resolveVRIntimacyProfile({ distance: 1.0, isSeated: true, wallBehind: true });
            expect(result.key).toBe('closeSeated');
        });

        test('context overrides do not apply at large distances', () => {
            const result = resolveVRIntimacyProfile({ distance: 2.0, isSeated: true, wallBehind: true });
            expect(result.key).toBe('idle');
        });
    });

    describe('resolveVRIntimacyProfile — hysteresis', () => {
        test('stays in closeConversation within its min/max band', () => {
            // closeConversation: min=0.74, max=1.05
            // At 1.02m, hard threshold would give awarePresence (> 1.1 check fails, < 1.45 passes)
            // But hysteresis should keep us in closeConversation since 1.02 < maxDistance(1.05)
            const result = resolveVRIntimacyProfile(
                { distance: 1.02, isSeated: false, wallBehind: false },
                'closeConversation'
            );
            expect(result.key).toBe('closeConversation');
        });

        test('exits closeConversation when outside its max distance', () => {
            // At 1.2m, clearly outside closeConversation maxDistance (1.05)
            const result = resolveVRIntimacyProfile(
                { distance: 1.2, isSeated: false, wallBehind: false },
                'closeConversation'
            );
            expect(result.key).toBe('awarePresence');
        });

        test('stays in comfortEmbrace within its band', () => {
            // comfortEmbrace: min=0.62, max=0.92
            // At 0.85m, hard threshold would give closeConversation
            // But hysteresis keeps comfortEmbrace
            const result = resolveVRIntimacyProfile(
                { distance: 0.85, isSeated: false, wallBehind: false },
                'comfortEmbrace'
            );
            expect(result.key).toBe('comfortEmbrace');
        });

        test('exits comfortEmbrace when clearly outside', () => {
            const result = resolveVRIntimacyProfile(
                { distance: 1.0, isSeated: false, wallBehind: false },
                'comfortEmbrace'
            );
            expect(result.key).toBe('closeConversation');
        });

        test('hysteresis does not apply to idle profile', () => {
            // idle has no hysteresis — should switch to awarePresence at 1.3m
            const result = resolveVRIntimacyProfile({ distance: 1.3, isSeated: false, wallBehind: false }, 'idle');
            expect(result.key).toBe('awarePresence');
        });

        test('hysteresis does not apply to handContact profile', () => {
            // handContact has no hysteresis — distance resolver takes over
            const result = resolveVRIntimacyProfile(
                { distance: 0.95, isSeated: false, wallBehind: false },
                'handContact'
            );
            expect(result.key).toBe('closeConversation');
        });

        test('context overrides bypass hysteresis', () => {
            // Even if currently in closeConversation, seated context takes priority
            const result = resolveVRIntimacyProfile(
                { distance: 1.0, isSeated: true, wallBehind: false },
                'closeConversation'
            );
            expect(result.key).toBe('closeSeated');
        });

        test('stays in awarePresence within its band', () => {
            // awarePresence: min=0.95, max=1.35
            // At 1.3m, within band
            const result = resolveVRIntimacyProfile(
                { distance: 1.3, isSeated: false, wallBehind: false },
                'awarePresence'
            );
            expect(result.key).toBe('awarePresence');
        });

        test('no current profile key falls back to hard thresholds', () => {
            const result = resolveVRIntimacyProfile({ distance: 0.9, isSeated: false, wallBehind: false }, null);
            expect(result.key).toBe('closeConversation');
        });
    });
});

// =========================================================================
// TEST SUITE: VRProximityTracker (seated detection + wall cache)
// =========================================================================

describe('VRProximityTracker — seated detection', () => {
    // Load and evaluate VRProximityTracker source
    const proxSrc = fs.readFileSync(path.join(__dirname, '../src/gltf-viewer/VRProximityTracker.js'), 'utf-8');
    const proxCode = stripESM(proxSrc);

    // Build a minimal THREE mock for the tracker
    const THREE = {
        Vector3: function (x, y, z) {
            return mockVector3(x || 0, y || 0, z || 0);
        },
        Quaternion: function () {
            return {
                clone() {
                    return new THREE.Quaternion();
                },
            };
        },
        Raycaster: function () {
            return {
                set() {},
                far: 0,
                intersectObjects() {
                    return [];
                },
            };
        },
    };

    let VRProximityTracker;

    beforeEach(() => {
        // Re-evaluate to get a fresh class
        const mod = {};
        const fn = new Function('module', 'exports', 'THREE', proxCode + '\nmodule.exports = { VRProximityTracker };');
        fn(mod, {}, THREE);
        VRProximityTracker = mod.exports.VRProximityTracker;
    });

    test('initial state uses height fallback (< 1.35m = seated)', () => {
        const mockCamera = mockVector3(0, 1.2, 0); // low = seated
        const mockAvatarRoot = mockVector3(0, 0, 1);
        mockAvatarRoot.getWorldQuaternion = () => new THREE.Quaternion();
        mockAvatarRoot.children = [];

        const scene = { traverse: jest.fn() };
        const tracker = new VRProximityTracker({ scene, camera: mockCamera });
        tracker.setAvatar(mockAvatarRoot);

        const snapshot = tracker.update(0.016);
        expect(snapshot.isSeated).toBe(true);
    });

    test('initial state: standing (head > 1.35m)', () => {
        const mockCamera = mockVector3(0, 1.6, 0);
        const mockAvatarRoot = mockVector3(0, 0, 1);
        mockAvatarRoot.getWorldQuaternion = () => new THREE.Quaternion();
        mockAvatarRoot.children = [];

        const scene = { traverse: jest.fn() };
        const tracker = new VRProximityTracker({ scene, camera: mockCamera });
        tracker.setAvatar(mockAvatarRoot);

        const snapshot = tracker.update(0.016);
        expect(snapshot.isSeated).toBe(false);
    });

    test('detects sit-down via velocity (head drops fast)', () => {
        const mockCamera = mockVector3(0, 1.6, 0);
        const mockAvatarRoot = mockVector3(0, 0, 1);
        mockAvatarRoot.getWorldQuaternion = () => new THREE.Quaternion();
        mockAvatarRoot.children = [];

        const scene = { traverse: jest.fn() };
        const tracker = new VRProximityTracker({ scene, camera: mockCamera });
        tracker.setAvatar(mockAvatarRoot);

        // Frame 1: standing at 1.6m
        tracker.update(0.016);
        expect(tracker._isSeated).toBe(false);

        // Simulate sit-down: head drops to 1.2m over ~0.5s
        // We simulate several frames of downward motion
        for (let i = 0; i < 10; i++) {
            mockCamera.y -= 0.04; // drops 4cm per frame
            tracker.update(0.05); // 50ms per frame
        }

        // Head is now at ~1.2m and was moving down fast
        expect(tracker._isSeated).toBe(true);
    });

    test('detects stand-up via velocity (head rises fast)', () => {
        const mockCamera = mockVector3(0, 1.1, 0); // start seated
        const mockAvatarRoot = mockVector3(0, 0, 1);
        mockAvatarRoot.getWorldQuaternion = () => new THREE.Quaternion();
        mockAvatarRoot.children = [];

        const scene = { traverse: jest.fn() };
        const tracker = new VRProximityTracker({ scene, camera: mockCamera });
        tracker.setAvatar(mockAvatarRoot);

        // Frame 1: seated
        tracker.update(0.016);
        expect(tracker._isSeated).toBe(true);

        // Simulate stand-up: head rises to 1.6m
        for (let i = 0; i < 10; i++) {
            mockCamera.y += 0.05;
            tracker.update(0.05);
        }

        expect(tracker._isSeated).toBe(false);
    });
});

describe('VRProximityTracker — wall detection cache', () => {
    const proxSrc = fs.readFileSync(path.join(__dirname, '../src/gltf-viewer/VRProximityTracker.js'), 'utf-8');
    const proxCode = stripESM(proxSrc);

    const THREE = {
        Vector3: function (x, y, z) {
            return mockVector3(x || 0, y || 0, z || 0);
        },
        Quaternion: function () {
            return {
                clone() {
                    return new THREE.Quaternion();
                },
            };
        },
        Raycaster: function () {
            return {
                set() {},
                far: 0,
                intersectObjects() {
                    return [];
                },
            };
        },
    };

    let VRProximityTracker;

    beforeEach(() => {
        const mod = {};
        const fn = new Function('module', 'exports', 'THREE', proxCode + '\nmodule.exports = { VRProximityTracker };');
        fn(mod, {}, THREE);
        VRProximityTracker = mod.exports.VRProximityTracker;
    });

    test('scene.traverse is called only once within cache period', () => {
        const traverseSpy = jest.fn();
        const scene = { traverse: traverseSpy };
        const mockCamera = mockVector3(0, 1.6, 0);
        const mockAvatarRoot = mockVector3(0, 0, 1);
        mockAvatarRoot.getWorldQuaternion = () => new THREE.Quaternion();
        mockAvatarRoot.children = [];

        const tracker = new VRProximityTracker({ scene, camera: mockCamera });
        tracker.setAvatar(mockAvatarRoot);

        // First update: traverse should be called
        tracker.update(0.016);
        const firstCallCount = traverseSpy.mock.calls.length;
        expect(firstCallCount).toBe(1);

        // Second update within cache period: traverse should NOT be called again
        tracker.update(0.016);
        expect(traverseSpy.mock.calls.length).toBe(firstCallCount);

        // Third update still within 2s cache: no extra traverse
        tracker.update(0.5);
        expect(traverseSpy.mock.calls.length).toBe(firstCallCount);
    });

    test('scene.traverse is called again after cache expires', () => {
        const traverseSpy = jest.fn();
        const scene = { traverse: traverseSpy };
        const mockCamera = mockVector3(0, 1.6, 0);
        const mockAvatarRoot = mockVector3(0, 0, 1);
        mockAvatarRoot.getWorldQuaternion = () => new THREE.Quaternion();
        mockAvatarRoot.children = [];

        const tracker = new VRProximityTracker({ scene, camera: mockCamera });
        tracker.setAvatar(mockAvatarRoot);

        tracker.update(0.016);
        expect(traverseSpy.mock.calls.length).toBe(1);

        // Simulate 2.1 seconds passing (exceed _blockerCacheMaxAge of 2.0s)
        tracker.update(2.1);
        expect(traverseSpy.mock.calls.length).toBe(2);
    });

    test('invalidateBlockerCache forces fresh traverse', () => {
        const traverseSpy = jest.fn();
        const scene = { traverse: traverseSpy };
        const mockCamera = mockVector3(0, 1.6, 0);
        const mockAvatarRoot = mockVector3(0, 0, 1);
        mockAvatarRoot.getWorldQuaternion = () => new THREE.Quaternion();
        mockAvatarRoot.children = [];

        const tracker = new VRProximityTracker({ scene, camera: mockCamera });
        tracker.setAvatar(mockAvatarRoot);

        tracker.update(0.016);
        expect(traverseSpy.mock.calls.length).toBe(1);

        tracker.invalidateBlockerCache();
        tracker.update(0.016);
        expect(traverseSpy.mock.calls.length).toBe(2);
    });
});

// =========================================================================
// TEST SUITE: VRContactAnchors
// =========================================================================

describe('VRContactAnchors', () => {
    test('AvatarManager stores isVRM flag on root userData', () => {
        const avatarSrc = fs.readFileSync(path.join(__dirname, '../src/gltf-viewer/AvatarManager.js'), 'utf-8');
        expect(avatarSrc).toContain('root.userData.isVRM = isVRM');
    });

    test('all 7 anchor definitions exist', () => {
        // Read the source to verify the anchor defs constant
        const anchorsSrc = fs.readFileSync(path.join(__dirname, '../src/gltf-viewer/VRContactAnchors.js'), 'utf-8');

        expect(anchorsSrc).toContain("key: 'head'");
        expect(anchorsSrc).toContain("key: 'chest'");
        expect(anchorsSrc).toContain("key: 'hips'");
        expect(anchorsSrc).toContain("key: 'leftShoulder'");
        expect(anchorsSrc).toContain("key: 'rightShoulder'");
        expect(anchorsSrc).toContain("key: 'leftHand'");
        expect(anchorsSrc).toContain("key: 'rightHand'");
    });
});

// =========================================================================
// TEST SUITE: VRIntimacySystem integration
// =========================================================================

describe('VRIntimacySystem — integration', () => {
    const systemSrc = fs.readFileSync(path.join(__dirname, '../src/gltf-viewer/VRIntimacySystem.js'), 'utf-8');

    test('VRM facing fix: adds Math.PI for VRM avatars', () => {
        expect(systemSrc).toContain('isVRM ? worldYaw + Math.PI : worldYaw');
        expect(systemSrc).toContain('this.avatarRoot.userData?.isVRM');
    });

    test('expression override is applied in _updateBehaviorBridge', () => {
        // Verify the source contains the expression override logic
        expect(systemSrc).toContain('expressionOverride');
        expect(systemSrc).toContain('em.setValue(expr, intensity)');
    });

    test('hysteresis is passed to resolveVRIntimacyProfile', () => {
        expect(systemSrc).toContain('resolveVRIntimacyProfile(snapshot, this.currentProfile?.key)');
    });

    test('dt is passed to proximity.update()', () => {
        expect(systemSrc).toContain('this.proximity.update(dt)');
    });

    test('continuous haptic gradient is implemented', () => {
        expect(systemSrc).toContain('gradientStrength');
        expect(systemSrc).toContain('nearest.distance');
    });

    test('system yields to puppet interaction modes', () => {
        expect(systemSrc).toContain("puppetMode === 'rootTranslate'");
        expect(systemSrc).toContain("puppetMode === 'rootDualTransform'");
        expect(systemSrc).toContain("puppetMode === 'limbDualTransform'");
    });

    test('system yields to locomotion system', () => {
        expect(systemSrc).toContain('NEXUS_LOCOMOTION?.isWalking');
    });

    test('profile cooldown prevents rapid switching', () => {
        expect(systemSrc).toContain('_profileCooldown');
        expect(systemSrc).toContain('0.4');
    });

    test('setEnabled(false) resets to idle and ends contacts', () => {
        expect(systemSrc).toContain('endAllContacts()');
        expect(systemSrc).toContain("currentState = 'idle'");
    });
});

// =========================================================================
// TEST SUITE: Profile transition scenarios
// =========================================================================

describe('Profile transition scenarios', () => {
    test('full approach sequence: idle → aware → close → embrace', () => {
        const distances = [2.0, 1.3, 0.9, 0.5];
        const expected = ['idle', 'awarePresence', 'closeConversation', 'comfortEmbrace'];
        const snapshot = { isSeated: false, wallBehind: false };

        let currentKey = null;
        for (let i = 0; i < distances.length; i++) {
            snapshot.distance = distances[i];
            const result = resolveVRIntimacyProfile(snapshot, currentKey);
            expect(result.key).toBe(expected[i]);
            currentKey = result.key;
        }
    });

    test('full retreat sequence: embrace → close → aware → idle', () => {
        const distances = [0.5, 1.0, 1.4, 2.0];
        const expected = ['comfortEmbrace', 'closeConversation', 'awarePresence', 'idle'];
        const snapshot = { isSeated: false, wallBehind: false };

        // Start at comfortEmbrace
        let currentKey = 'comfortEmbrace';
        for (let i = 0; i < distances.length; i++) {
            snapshot.distance = distances[i];
            const result = resolveVRIntimacyProfile(snapshot, currentKey);
            expect(result.key).toBe(expected[i]);
            currentKey = result.key;
        }
    });

    test('boundary bobbing with hysteresis stays stable', () => {
        const snapshot = { isSeated: false, wallBehind: false };

        // Enter closeConversation at 0.9m
        snapshot.distance = 0.9;
        let result = resolveVRIntimacyProfile(snapshot, 'idle');
        expect(result.key).toBe('closeConversation');

        // Bob between 0.8m and 1.0m — should stay in closeConversation
        // (within min=0.74, max=1.05 band)
        for (const d of [1.0, 0.8, 1.0, 0.9, 1.04, 0.76]) {
            snapshot.distance = d;
            result = resolveVRIntimacyProfile(snapshot, 'closeConversation');
            expect(result.key).toBe('closeConversation');
        }
    });

    test('seated user at 1.0m always gets closeSeated regardless of current profile', () => {
        const snapshot = { distance: 1.0, isSeated: true, wallBehind: false };

        for (const currentKey of ['idle', 'awarePresence', 'closeConversation', 'comfortEmbrace']) {
            const result = resolveVRIntimacyProfile(snapshot, currentKey);
            expect(result.key).toBe('closeSeated');
        }
    });
});
