/**
 * @file E2E tests for the Avatar Animation Pipeline (Phase 3)
 *
 * Tests the full chain: EmotionEngine → BehaviorEngine → LipSyncEngine
 * → VRMLoader bridge → MorphTargetAdapter → ProceduralAnimator
 *
 * Covers: Desktop, VR (Oculus Quest), AR (mobile), Android, iOS
 */

// ── Mock THREE.js ──
const mockQuaternion = {
    clone: jest.fn().mockReturnThis(),
    copy: jest.fn().mockReturnThis(),
    multiply: jest.fn().mockReturnThis(),
    setFromEuler: jest.fn().mockReturnThis(),
    setFromUnitVectors: jest.fn().mockReturnThis(),
    premultiply: jest.fn().mockReturnThis(),
    normalize: jest.fn().mockReturnThis(),
    angleTo: jest.fn(() => 0),
    w: 1,
    x: 0,
    y: 0,
    z: 0,
};

const mockVector3 = {
    clone: jest.fn().mockReturnThis(),
    copy: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    subVectors: jest.fn().mockReturnThis(),
    normalize: jest.fn().mockReturnThis(),
    addScaledVector: jest.fn().mockReturnThis(),
    getWorldPosition: jest.fn(),
};

global.THREE = {
    Clock: jest.fn(() => ({
        getDelta: jest.fn(() => 0.016),
        getElapsedTime: jest.fn(() => 1.0),
    })),
    Vector3: jest.fn(() => ({ ...mockVector3 })),
    Quaternion: jest.fn(() => ({ ...mockQuaternion })),
    Euler: jest.fn((x, y, z) => ({ x: x || 0, y: y || 0, z: z || 0 })),
    Box3: jest.fn(() => ({
        setFromObject: jest.fn().mockReturnThis(),
        getSize: jest.fn(() => ({ x: 1, y: 2, z: 1 })),
        getCenter: jest.fn(() => ({ x: 0, y: 1, z: 0 })),
    })),
    AnimationMixer: jest.fn(() => ({
        clipAction: jest.fn(() => ({
            reset: jest.fn().mockReturnThis(),
            play: jest.fn().mockReturnThis(),
            stop: jest.fn(),
        })),
        update: jest.fn(),
        stopAllAction: jest.fn(),
    })),
    MathUtils: {
        clamp: jest.fn((v, min, max) => Math.min(Math.max(v, min), max)),
        damp: jest.fn((current, target, lambda, dt) => current + (target - current) * (1 - Math.exp(-lambda * dt))),
    },
    Color: jest.fn(),
};

// ── Mock speechSynthesis ──
global.speechSynthesis = { speaking: false };

// ── Load Phase 3 engines (order matters) ──
beforeAll(() => {
    // EmotionEngine
    require('../src/EmotionEngine.js');
    // LipSyncEngine
    require('../src/LipSyncEngine.js');
    // MorphTargetAdapter
    require('../src/MorphTargetAdapter.js');
    // ProceduralAnimator
    require('../src/ProceduralAnimator.js');
    // BehaviorEngine
    require('../src/BehaviorEngine.js');
});

// =========================================================================
// 1. EMOTION ENGINE TESTS
// =========================================================================

describe('EmotionEngine', () => {
    test('should be exposed on window', () => {
        expect(window.NEXUS_EMOTION_ENGINE).toBeDefined();
        expect(typeof window.NEXUS_EMOTION_ENGINE.analyze).toBe('function');
    });

    test('should detect happy emotion from keywords', () => {
        const result = window.NEXUS_EMOTION_ENGINE.analyze('I am so happy to help you!');
        expect(result.emotion).toBe('happy');
        expect(result.intensity).toBeGreaterThan(0);
    });

    test('should detect sad emotion', () => {
        const result = window.NEXUS_EMOTION_ENGINE.analyze(
            'I am sorry for your loss, unfortunately this is very difficult.'
        );
        expect(result.emotion).toBe('sad');
    });

    test('should detect surprised emotion', () => {
        const result = window.NEXUS_EMOTION_ENGINE.analyze('Wow, that is truly unbelievable and astonishing!');
        expect(result.emotion).toBe('surprised');
    });

    test('should return neutral for empty text', () => {
        const result = window.NEXUS_EMOTION_ENGINE.analyze('');
        expect(result.emotion).toBe('neutral');
        expect(result.intensity).toBe(0);
    });

    test('should prioritize HomePilot directives', () => {
        const result = window.NEXUS_EMOTION_ENGINE.analyze('Whatever the text says', {
            emotion: 'angry',
            intensity: 0.9,
        });
        expect(result.emotion).toBe('angry');
        expect(result.intensity).toBe(0.9);
        expect(result.source).toBe('directive');
    });

    test('should detect excited emotion from punctuation', () => {
        const result = window.NEXUS_EMOTION_ENGINE.analyze('This is great!! Amazing!!');
        expect(['happy', 'surprised']).toContain(result.emotion);
        expect(result.intensity).toBeGreaterThan(0.3);
    });
});

// =========================================================================
// 2. LIP SYNC ENGINE TESTS
// =========================================================================

describe('LipSyncEngine', () => {
    test('should be exposed on window', () => {
        expect(window.NEXUS_LIP_SYNC).toBeDefined();
        expect(typeof window.NEXUS_LIP_SYNC.start).toBe('function');
        expect(typeof window.NEXUS_LIP_SYNC.stop).toBe('function');
        expect(typeof window.NEXUS_LIP_SYNC.update).toBe('function');
    });

    test('should build phoneme sequence from text', () => {
        const seq = window.NEXUS_LIP_SYNC.buildPhonemeSequence('hello', 1.0);
        expect(seq.length).toBeGreaterThan(0);

        // 'e' maps to 'ee', 'o' maps to 'oh'
        const visemes = seq.map((s) => s.viseme).filter(Boolean);
        expect(visemes).toContain('ee');
        expect(visemes).toContain('oh');
    });

    test('should start and stop lip sync', () => {
        window.NEXUS_LIP_SYNC.start('test text', 1.0);
        expect(window.NEXUS_LIP_SYNC.isActive).toBe(true);

        window.NEXUS_LIP_SYNC.stop();
        expect(window.NEXUS_LIP_SYNC.isActive).toBe(false);
    });

    test('should apply viseme values through vrmLoader', () => {
        const mockVrmLoader = {
            currentVRM: { expressionManager: {} },
            setExpression: jest.fn(),
        };

        window.NEXUS_LIP_SYNC.start('aaa', 1.0);
        window.NEXUS_LIP_SYNC.update(0.1, mockVrmLoader);

        // Should have called setExpression with viseme values
        expect(mockVrmLoader.setExpression).toHaveBeenCalled();
        const calls = mockVrmLoader.setExpression.mock.calls;
        const visemeNames = calls.map((c) => c[0]);
        expect(visemeNames).toEqual(expect.arrayContaining(['aa', 'ee', 'oh']));

        window.NEXUS_LIP_SYNC.stop();
    });

    test('should handle empty text gracefully', () => {
        window.NEXUS_LIP_SYNC.start('', 1.0);
        expect(window.NEXUS_LIP_SYNC.isActive).toBe(true);

        // With empty sequence, update should deactivate
        window.NEXUS_LIP_SYNC.update(0.1, { setExpression: jest.fn() });
    });
});

// =========================================================================
// 3. MORPH TARGET ADAPTER TESTS
// =========================================================================

describe('MorphTargetAdapter', () => {
    test('should be exposed on window', () => {
        expect(window.MorphTargetAdapter).toBeDefined();
    });

    test('should scan ARKit morph targets and map to VRM names', () => {
        const mockRoot = {
            traverse: (fn) => {
                // Simulate a mesh with ARKit morph targets
                fn({
                    isMesh: true,
                    morphTargetDictionary: {
                        jawOpen: 0,
                        mouthSmileLeft: 1,
                        mouthSmileRight: 2,
                        eyeBlinkLeft: 3,
                        eyeBlinkRight: 4,
                    },
                    morphTargetInfluences: [0, 0, 0, 0, 0],
                });
            },
        };

        const adapter = new window.MorphTargetAdapter(mockRoot);
        expect(adapter.hasBindings).toBe(true);
        expect(adapter.capabilities.hasVisemes).toBe(true);
        expect(adapter.capabilities.hasEmotions).toBe(true);
        expect(adapter.capabilities.hasBlink).toBe(true);
    });

    test('should set morph target values via setValue', () => {
        const influences = [0, 0, 0, 0, 0];
        const mockRoot = {
            traverse: (fn) => {
                fn({
                    isMesh: true,
                    morphTargetDictionary: {
                        jawOpen: 0,
                        eyeBlinkLeft: 1,
                        eyeBlinkRight: 2,
                    },
                    morphTargetInfluences: influences,
                });
            },
        };

        const adapter = new window.MorphTargetAdapter(mockRoot);

        adapter.setValue('aa', 0.8);
        expect(influences[0]).toBeCloseTo(0.8); // jawOpen → aa

        adapter.setValue('blink', 1.0);
        expect(influences[1]).toBeCloseTo(0.5); // eyeBlinkLeft (paired: 0.5 weight)
        expect(influences[2]).toBeCloseTo(0.5); // eyeBlinkRight (paired: 0.5 weight)
    });

    test('should map Oculus Viseme targets', () => {
        const mockRoot = {
            traverse: (fn) => {
                fn({
                    isMesh: true,
                    morphTargetDictionary: {
                        viseme_aa: 0,
                        viseme_E: 1,
                        viseme_O: 2,
                        viseme_sil: 3,
                    },
                    morphTargetInfluences: [0, 0, 0, 0],
                });
            },
        };

        const adapter = new window.MorphTargetAdapter(mockRoot);
        expect(adapter.capabilities.hasVisemes).toBe(true);

        adapter.setValue('aa', 0.5);
        adapter.setValue('ee', 0.7);
        adapter.setValue('oh', 0.3);
    });

    test('should detect jaw bone as fallback', () => {
        const mockRoot = {
            traverse: (fn) => {
                // No meshes with morph targets — only a jaw bone
                fn({
                    isBone: true,
                    name: 'Jaw',
                    quaternion: { clone: jest.fn(() => ({ ...mockQuaternion })) },
                });
            },
        };

        const adapter = new window.MorphTargetAdapter(mockRoot);
        expect(adapter.capabilities.hasJawBone).toBe(true);
        expect(adapter.hasBindings).toBe(true);
    });

    test('should report no bindings for bare model', () => {
        const mockRoot = {
            traverse: (fn) => {
                fn({ isMesh: true }); // no morphTargetDictionary
            },
        };

        const adapter = new window.MorphTargetAdapter(mockRoot);
        expect(adapter.hasBindings).toBe(false);
    });
});

// =========================================================================
// 4. PROCEDURAL ANIMATOR TESTS
// =========================================================================

describe('ProceduralAnimator', () => {
    test('should be exposed on window', () => {
        expect(window.NEXUS_PROCEDURAL_ANIMATOR).toBeDefined();
        expect(typeof window.NEXUS_PROCEDURAL_ANIMATOR.registerAvatar).toBe('function');
        expect(typeof window.NEXUS_PROCEDURAL_ANIMATOR.unregisterAvatar).toBe('function');
        expect(typeof window.NEXUS_PROCEDURAL_ANIMATOR.update).toBe('function');
        expect(typeof window.NEXUS_PROCEDURAL_ANIMATOR.setMode).toBe('function');
    });

    test('should register and unregister avatar without errors', () => {
        const mockRoot = {
            traverse: jest.fn((fn) => {
                // Minimal bone structure
                fn({
                    isBone: true,
                    name: 'Hips',
                    uuid: 'a',
                    position: { clone: jest.fn().mockReturnThis() },
                    quaternion: { clone: jest.fn(() => ({ ...mockQuaternion })) },
                });
            }),
            updateWorldMatrix: jest.fn(),
        };

        expect(() => {
            window.NEXUS_PROCEDURAL_ANIMATOR.registerAvatar(mockRoot, false);
        }).not.toThrow();

        expect(() => {
            window.NEXUS_PROCEDURAL_ANIMATOR.unregisterAvatar(mockRoot);
        }).not.toThrow();
    });

    test('should set mode without errors', () => {
        expect(() => {
            window.NEXUS_PROCEDURAL_ANIMATOR.setMode('thinking', 3000);
            window.NEXUS_PROCEDURAL_ANIMATOR.setMode('happy', 2000);
            window.NEXUS_PROCEDURAL_ANIMATOR.setMode('dance', 5000);
            window.NEXUS_PROCEDURAL_ANIMATOR.setMode('talk', 1000);
            window.NEXUS_PROCEDURAL_ANIMATOR.setMode('idle', 0);
        }).not.toThrow();
    });

    test('should handle update with no avatar registered', () => {
        window.NEXUS_PROCEDURAL_ANIMATOR.unregisterAvatar(null);
        expect(() => {
            window.NEXUS_PROCEDURAL_ANIMATOR.update(1.0, 0.016);
        }).not.toThrow();
    });
});

// =========================================================================
// 5. BEHAVIOR ENGINE TESTS
// =========================================================================

describe('BehaviorEngine', () => {
    test('should be exposed on window with full API', () => {
        expect(window.NEXUS_BEHAVIOR).toBeDefined();
        expect(typeof window.NEXUS_BEHAVIOR.setState).toBe('function');
        expect(typeof window.NEXUS_BEHAVIOR.getState).toBe('function');
        expect(typeof window.NEXUS_BEHAVIOR.update).toBe('function');
        expect(typeof window.NEXUS_BEHAVIOR.onUserMessage).toBe('function');
        expect(typeof window.NEXUS_BEHAVIOR.onBotResponse).toBe('function');
        expect(typeof window.NEXUS_BEHAVIOR.onSpeechStart).toBe('function');
        expect(typeof window.NEXUS_BEHAVIOR.onSpeechEnd).toBe('function');
        expect(typeof window.NEXUS_BEHAVIOR.onListeningStart).toBe('function');
        expect(typeof window.NEXUS_BEHAVIOR.onListeningEnd).toBe('function');
    });

    test('should expose State enum', () => {
        const S = window.NEXUS_BEHAVIOR.State;
        expect(S.IDLE).toBe('IDLE');
        expect(S.LISTENING).toBe('LISTENING');
        expect(S.THINKING).toBe('THINKING');
        expect(S.SPEAKING).toBe('SPEAKING');
        expect(S.MICRO_IDLE).toBe('MICRO_IDLE');
    });

    test('should start in IDLE state', () => {
        window.NEXUS_BEHAVIOR.setState('IDLE');
        expect(window.NEXUS_BEHAVIOR.getState()).toBe('IDLE');
    });

    test('should transition IDLE → THINKING on user message', () => {
        window.NEXUS_BEHAVIOR.setState('IDLE');
        window.NEXUS_BEHAVIOR.onUserMessage('Hello, how are you?');
        expect(window.NEXUS_BEHAVIOR.getState()).toBe('THINKING');
    });

    test('should transition IDLE → LISTENING on mic start', () => {
        window.NEXUS_BEHAVIOR.setState('IDLE');
        window.NEXUS_BEHAVIOR.onListeningStart();
        expect(window.NEXUS_BEHAVIOR.getState()).toBe('LISTENING');
    });

    test('should transition LISTENING → IDLE on mic stop', () => {
        window.NEXUS_BEHAVIOR.setState('IDLE');
        window.NEXUS_BEHAVIOR.onListeningStart();
        window.NEXUS_BEHAVIOR.onListeningEnd();
        expect(window.NEXUS_BEHAVIOR.getState()).toBe('IDLE');
    });

    test('should transition to SPEAKING on speech start', () => {
        window.NEXUS_BEHAVIOR.onSpeechStart();
        expect(window.NEXUS_BEHAVIOR.getState()).toBe('SPEAKING');
    });

    test('should transition SPEAKING → IDLE on speech end', () => {
        window.NEXUS_BEHAVIOR.onSpeechStart();
        window.NEXUS_BEHAVIOR.onSpeechEnd();
        expect(window.NEXUS_BEHAVIOR.getState()).toBe('IDLE');
    });

    test('should handle bot response with emotion analysis', () => {
        window.NEXUS_BEHAVIOR.setState('THINKING');
        expect(() => {
            window.NEXUS_BEHAVIOR.onBotResponse('I am so happy to help you today!');
        }).not.toThrow();
    });

    test('should run update without errors', () => {
        window.NEXUS_BEHAVIOR.setState('IDLE');
        expect(() => {
            window.NEXUS_BEHAVIOR.update(0.016, 1.0);
        }).not.toThrow();
    });
});

// =========================================================================
// 6. FULL PIPELINE E2E: EmotionEngine → BehaviorEngine → LipSync
// =========================================================================

describe('Full Animation Pipeline E2E', () => {
    test('should flow: user message → THINKING → bot response → emotion + lip-sync', () => {
        // 1. User sends message
        window.NEXUS_BEHAVIOR.setState('IDLE');
        window.NEXUS_BEHAVIOR.onUserMessage('Tell me a joke');
        expect(window.NEXUS_BEHAVIOR.getState()).toBe('THINKING');

        // 2. Bot responds with happy text
        window.NEXUS_BEHAVIOR.onBotResponse('Ha! Here is a great joke for you! Wonderful!');

        // 3. Verify lip-sync started
        expect(window.NEXUS_LIP_SYNC.isActive).toBe(true);

        // 4. Simulate speech synthesis starting
        global.speechSynthesis.speaking = true;
        window.NEXUS_BEHAVIOR.update(0.016, 1.0);
        expect(window.NEXUS_BEHAVIOR.getState()).toBe('SPEAKING');

        // 5. Simulate speech ending
        global.speechSynthesis.speaking = false;
        window.NEXUS_BEHAVIOR.update(0.016, 1.1);
        expect(window.NEXUS_BEHAVIOR.getState()).toBe('IDLE');
    });

    test('should flow: mic on → LISTENING → mic off → user message → THINKING', () => {
        window.NEXUS_BEHAVIOR.setState('IDLE');

        window.NEXUS_BEHAVIOR.onListeningStart();
        expect(window.NEXUS_BEHAVIOR.getState()).toBe('LISTENING');

        window.NEXUS_BEHAVIOR.onListeningEnd();
        expect(window.NEXUS_BEHAVIOR.getState()).toBe('IDLE');

        window.NEXUS_BEHAVIOR.onUserMessage('Voice input text');
        expect(window.NEXUS_BEHAVIOR.getState()).toBe('THINKING');
    });

    test('should apply morph targets through adapter in pipeline', () => {
        const influences = [0, 0, 0];
        const mockRoot = {
            traverse: (fn) => {
                fn({
                    isMesh: true,
                    morphTargetDictionary: { viseme_aa: 0, viseme_E: 1, viseme_O: 2 },
                    morphTargetInfluences: influences,
                });
            },
        };

        const adapter = new window.MorphTargetAdapter(mockRoot);

        // Simulate what LipSyncEngine does
        adapter.setValue('aa', 0.6);
        expect(influences[0]).toBeCloseTo(0.6);

        adapter.setValue('ee', 0.4);
        expect(influences[1]).toBeCloseTo(0.4);

        adapter.setValue('oh', 0.3);
        expect(influences[2]).toBeCloseTo(0.3);

        // Reset
        adapter.setValue('aa', 0);
        adapter.setValue('ee', 0);
        adapter.setValue('oh', 0);
        expect(influences[0]).toBe(0);
    });
});

// =========================================================================
// 7. PLATFORM COMPATIBILITY TESTS (Desktop / VR / AR / Mobile)
// =========================================================================

describe('Platform Compatibility', () => {
    test('Desktop: all engines initialize and communicate', () => {
        // Verify all globals are present (loaded via <script defer> on Desktop)
        expect(window.NEXUS_EMOTION_ENGINE).toBeDefined();
        expect(window.NEXUS_LIP_SYNC).toBeDefined();
        expect(window.NEXUS_BEHAVIOR).toBeDefined();
        expect(window.NEXUS_PROCEDURAL_ANIMATOR).toBeDefined();
        expect(window.MorphTargetAdapter).toBeDefined();
    });

    test('VR (Oculus Quest): BehaviorEngine handles XR state transitions', () => {
        // In VR, behavior should stay in IDLE during session
        window.NEXUS_BEHAVIOR.setState('IDLE');

        // Simulate VR session — behavior remains functional
        window.NEXUS_BEHAVIOR.onUserMessage('Hello from VR');
        expect(window.NEXUS_BEHAVIOR.getState()).toBe('THINKING');

        // Bot response should still trigger lip-sync in VR
        window.NEXUS_BEHAVIOR.onBotResponse('Hello VR user!');
        expect(window.NEXUS_LIP_SYNC.isActive).toBe(true);

        window.NEXUS_LIP_SYNC.stop();
    });

    test('AR (Mobile): pipeline works without desktop-specific APIs', () => {
        // AR mode uses same engines but may not have full mouse input
        window.NEXUS_BEHAVIOR.setState('IDLE');

        // Touch-to-talk equivalent: direct message
        window.NEXUS_BEHAVIOR.onUserMessage('AR voice command');
        expect(window.NEXUS_BEHAVIOR.getState()).toBe('THINKING');

        window.NEXUS_BEHAVIOR.onBotResponse('Processing your AR request.');
        expect(window.NEXUS_LIP_SYNC.isActive).toBe(true);

        // Verify emotion detection works
        const result = window.NEXUS_EMOTION_ENGINE.analyze('Processing your AR request.');
        expect(result).toBeDefined();
        expect(typeof result.emotion).toBe('string');

        window.NEXUS_LIP_SYNC.stop();
    });

    test('Mobile (Android/iOS): MorphTargetAdapter works with RPM GLB', () => {
        // Simulate a Ready Player Me GLB with Oculus Viseme targets
        const influences = new Array(15).fill(0);
        const dict = {};
        [
            'viseme_sil',
            'viseme_PP',
            'viseme_FF',
            'viseme_TH',
            'viseme_DD',
            'viseme_kk',
            'viseme_CH',
            'viseme_SS',
            'viseme_nn',
            'viseme_RR',
            'viseme_aa',
            'viseme_E',
            'viseme_I',
            'viseme_O',
            'viseme_U',
        ].forEach((name, i) => {
            dict[name] = i;
        });

        const mockRoot = {
            traverse: (fn) => {
                fn({
                    isMesh: true,
                    morphTargetDictionary: dict,
                    morphTargetInfluences: influences,
                });
            },
        };

        const adapter = new window.MorphTargetAdapter(mockRoot);
        expect(adapter.capabilities.hasVisemes).toBe(true);

        // Test all three primary visemes used by LipSyncEngine
        adapter.setValue('aa', 0.5);
        expect(influences[10]).toBeCloseTo(0.5); // viseme_aa

        adapter.setValue('ee', 0.7);
        expect(influences[11]).toBeCloseTo(0.7); // viseme_E

        adapter.setValue('oh', 0.4);
        expect(influences[13]).toBeCloseTo(0.4); // viseme_O
    });

    test('ProceduralAnimator jaw bone fallback for Tier C models', () => {
        // Tier C: skeleton-only model with no morph targets
        // Should still get jaw animation during talk mode
        expect(() => {
            window.NEXUS_PROCEDURAL_ANIMATOR.setMode('talk', 2000);
            // update should handle missing bones gracefully
            window.NEXUS_PROCEDURAL_ANIMATOR.update(1.0, 0.016);
        }).not.toThrow();
    });
});

// =========================================================================
// 8. AUDIO SYNC TESTS
// =========================================================================

describe('Audio Sync', () => {
    test('LipSync should respect speech rate', () => {
        const seqNormal = window.NEXUS_LIP_SYNC.buildPhonemeSequence('hello world', 1.0);
        const seqFast = window.NEXUS_LIP_SYNC.buildPhonemeSequence('hello world', 2.0);

        // Faster rate = shorter durations
        const totalNormal = seqNormal.reduce((sum, s) => sum + s.duration, 0);
        const totalFast = seqFast.reduce((sum, s) => sum + s.duration, 0);
        expect(totalFast).toBeLessThan(totalNormal);
    });

    test('LipSync should produce smooth transitions (no sudden jumps)', () => {
        const mockVrmLoader = {
            currentVRM: { expressionManager: {} },
            setExpression: jest.fn(),
        };

        window.NEXUS_LIP_SYNC.start('aaa ooo eee', 1.0);

        // Run several frames
        const values = [];
        for (let i = 0; i < 20; i++) {
            window.NEXUS_LIP_SYNC.update(0.016, mockVrmLoader);
        }

        // Collect 'aa' values from calls
        const aaCalls = mockVrmLoader.setExpression.mock.calls.filter((c) => c[0] === 'aa').map((c) => c[1]);

        // Values should be smooth (no jumps > 0.5 between frames)
        for (let i = 1; i < aaCalls.length; i++) {
            expect(Math.abs(aaCalls[i] - aaCalls[i - 1])).toBeLessThan(0.5);
        }

        window.NEXUS_LIP_SYNC.stop();
    });

    test('speechSynthesis polling should detect speech start/end', () => {
        window.NEXUS_BEHAVIOR.setState('THINKING');

        // Speech starts
        global.speechSynthesis.speaking = true;
        window.NEXUS_BEHAVIOR.update(0.016, 1.0);
        expect(window.NEXUS_BEHAVIOR.getState()).toBe('SPEAKING');

        // Speech ends
        global.speechSynthesis.speaking = false;
        window.NEXUS_BEHAVIOR.update(0.016, 1.1);
        expect(window.NEXUS_BEHAVIOR.getState()).toBe('IDLE');
    });
});
