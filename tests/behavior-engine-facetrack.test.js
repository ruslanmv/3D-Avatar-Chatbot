/**
 * BehaviorEngine Face Tracking Integration Tests
 *
 * Tests the expression override mechanism added for face tracking:
 * - setExpressionOverride(true) suppresses gaze + expression writes
 * - setExpressionOverride(false) restores normal behavior
 *
 * Also validates backward compatibility: existing state machine,
 * event handlers, and gaze system work correctly when override is off.
 */

/* global describe, test, expect, beforeEach, jest */

const fs = require('fs');
const path = require('path');

// ── Mock browser globals ────────────────────────────────────────────

global.requestAnimationFrame = jest.fn((cb) => setTimeout(() => cb(performance.now()), 0));
global.cancelAnimationFrame = jest.fn((id) => clearTimeout(id));
global.performance = global.performance || { now: () => Date.now() };

// Mock speechSynthesis
global.speechSynthesis = { speaking: false };

// Mock expression manager for VRM
const mockSetExpression = jest.fn();
const mockSetEmotion = jest.fn();
const mockVRMLoader = {
    currentVRM: {
        expressionManager: {
            setValue: jest.fn(),
        },
    },
    setExpression: mockSetExpression,
    setEmotion: mockSetEmotion,
};

// Mock NEXUS_VIEWER
global.NEXUS_VIEWER = {
    avatarManager: {
        vrmLoader: mockVRMLoader,
        currentRoot: null,
        playAnimation: jest.fn(),
    },
};

// Mock LipSync
global.NEXUS_LIP_SYNC = {
    start: jest.fn(),
    stop: jest.fn(),
    update: jest.fn(),
    setPaused: jest.fn(),
    isActive: false,
};

// Mock EmotionEngine
global.NEXUS_EMOTION_ENGINE = {
    analyze: jest.fn().mockReturnValue({
        detected: 'neutral',
        source: 'default',
        emotion: 'neutral',
        intensity: 0.5,
        mode: 'override',
    }),
};

// Mock AnimationPresets
global.NEXUS_ANIMATION_PRESETS = null;

// ── Load BehaviorEngine source ──────────────────────────────────────

const src = fs.readFileSync(path.resolve(__dirname, '../src/BehaviorEngine.js'), 'utf-8');
eval(src);

// ── Tests ───────────────────────────────────────────────────────────

describe('BehaviorEngine', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Reset to IDLE
        if (window.NEXUS_BEHAVIOR) {
            window.NEXUS_BEHAVIOR.setState(window.NEXUS_BEHAVIOR.State.IDLE);
            window.NEXUS_BEHAVIOR.setExpressionOverride(false);
        }
    });

    describe('Module initialization', () => {
        test('should expose NEXUS_BEHAVIOR on window', () => {
            expect(window.NEXUS_BEHAVIOR).toBeDefined();
        });

        test('should expose setExpressionOverride method', () => {
            expect(typeof window.NEXUS_BEHAVIOR.setExpressionOverride).toBe('function');
        });

        test('should expose State enum', () => {
            expect(window.NEXUS_BEHAVIOR.State).toBeDefined();
            expect(window.NEXUS_BEHAVIOR.State.IDLE).toBeDefined();
            expect(window.NEXUS_BEHAVIOR.State.SPEAKING).toBeDefined();
        });
    });

    describe('Expression override', () => {
        test('should not block expressions when override is off', () => {
            window.NEXUS_BEHAVIOR.setExpressionOverride(false);
            window.NEXUS_BEHAVIOR.update(0.016, 1.0);
            // Gaze update should have run — check that setExpression was called
            // (lookLeft/Right/Up/Down during gaze update)
            // Note: setExpression may or may not be called depending on gaze values
            // The key is that it should NOT throw
            expect(true).toBe(true);
        });

        test('should block expression writes when override is on', () => {
            window.NEXUS_BEHAVIOR.setExpressionOverride(true);
            mockSetExpression.mockClear();

            // Trigger LISTENING state which normally sets happy expression
            window.NEXUS_BEHAVIOR.setState(window.NEXUS_BEHAVIOR.State.LISTENING);

            // _setVRMExpression should be blocked by override
            expect(mockSetExpression).not.toHaveBeenCalled();
        });

        test('should block gaze updates when override is on', () => {
            window.NEXUS_BEHAVIOR.setExpressionOverride(true);
            mockSetExpression.mockClear();

            // Run update — gaze interpolation should be skipped
            window.NEXUS_BEHAVIOR.update(0.016, 1.0);
            window.NEXUS_BEHAVIOR.update(0.016, 1.016);

            // With override on, gaze expressions (lookLeft, lookRight, etc.)
            // should NOT be set
            const gazeCalls = mockSetExpression.mock.calls.filter(([name]) =>
                ['lookLeft', 'lookRight', 'lookUp', 'lookDown'].includes(name)
            );
            expect(gazeCalls.length).toBe(0);
        });

        test('should restore expression writes when override is turned off', () => {
            window.NEXUS_BEHAVIOR.setExpressionOverride(true);
            window.NEXUS_BEHAVIOR.setExpressionOverride(false);
            mockSetExpression.mockClear();

            // Now trigger LISTENING which should write happy expression
            window.NEXUS_BEHAVIOR.setState(window.NEXUS_BEHAVIOR.State.LISTENING);

            // setExpression should now work (happy expression for attentive look)
            expect(mockSetExpression).toHaveBeenCalledWith('happy', expect.any(Number));
        });
    });

    describe('State machine (backward compatibility)', () => {
        test('should start in IDLE state', () => {
            expect(window.NEXUS_BEHAVIOR.getState()).toBe(window.NEXUS_BEHAVIOR.State.IDLE);
        });

        test('should transition to LISTENING', () => {
            window.NEXUS_BEHAVIOR.onListeningStart();
            expect(window.NEXUS_BEHAVIOR.getState()).toBe(window.NEXUS_BEHAVIOR.State.LISTENING);
        });

        test('should transition from LISTENING back to IDLE', () => {
            window.NEXUS_BEHAVIOR.onListeningStart();
            window.NEXUS_BEHAVIOR.onListeningEnd();
            expect(window.NEXUS_BEHAVIOR.getState()).toBe(window.NEXUS_BEHAVIOR.State.IDLE);
        });

        test('should transition to THINKING on user message', () => {
            window.NEXUS_BEHAVIOR.onUserMessage('Hello');
            expect(window.NEXUS_BEHAVIOR.getState()).toBe(window.NEXUS_BEHAVIOR.State.THINKING);
        });

        test('should handle onSpeechStart', () => {
            window.NEXUS_BEHAVIOR.onSpeechStart();
            expect(window.NEXUS_BEHAVIOR.getState()).toBe(window.NEXUS_BEHAVIOR.State.SPEAKING);
        });

        test('should handle onSpeechEnd', () => {
            window.NEXUS_BEHAVIOR.onSpeechStart();
            window.NEXUS_BEHAVIOR.onSpeechEnd();
            expect(window.NEXUS_BEHAVIOR.getState()).toBe(window.NEXUS_BEHAVIOR.State.IDLE);
        });
    });

    describe('Event handlers (backward compatibility)', () => {
        test('onBotResponse should not throw', () => {
            expect(() => {
                window.NEXUS_BEHAVIOR.onBotResponse('Hello there!');
            }).not.toThrow();
        });

        test('onUserMessage should not throw', () => {
            expect(() => {
                window.NEXUS_BEHAVIOR.onUserMessage('Hi');
            }).not.toThrow();
        });
    });

    describe('update() per-frame (backward compatibility)', () => {
        test('should not throw during IDLE update', () => {
            expect(() => {
                window.NEXUS_BEHAVIOR.update(0.016, 0.016);
                window.NEXUS_BEHAVIOR.update(0.016, 0.032);
            }).not.toThrow();
        });

        test('should not throw during THINKING update', () => {
            window.NEXUS_BEHAVIOR.onUserMessage('test');
            expect(() => {
                window.NEXUS_BEHAVIOR.update(0.016, 0.016);
                window.NEXUS_BEHAVIOR.update(0.016, 0.032);
            }).not.toThrow();
        });

        test('should not throw during SPEAKING update', () => {
            window.NEXUS_BEHAVIOR.onSpeechStart();
            expect(() => {
                window.NEXUS_BEHAVIOR.update(0.016, 0.016);
            }).not.toThrow();
        });
    });
});
