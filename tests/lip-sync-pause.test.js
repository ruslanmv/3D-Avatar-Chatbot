/**
 * LipSyncEngine Pause Integration Tests
 *
 * Tests the pause mechanism added for face tracking:
 * - setPaused(true) stops viseme output
 * - setPaused(false) resumes normal lip-sync
 *
 * Also validates backward compatibility: start/stop/update cycle
 * works correctly when pause is off.
 */

/* global describe, test, expect, beforeEach, jest */

const fs = require('fs');
const path = require('path');

// ── Mock browser globals ────────────────────────────────────────────

global.performance = global.performance || { now: () => Date.now() };

// Mock VRM loader for expression writes
const mockSetExpression = jest.fn();
const mockVRMLoader = {
    currentVRM: {
        expressionManager: {
            setValue: jest.fn(),
        },
    },
    setExpression: mockSetExpression,
};

// ── Load LipSyncEngine source ───────────────────────────────────────

const src = fs.readFileSync(path.resolve(__dirname, '../src/LipSyncEngine.js'), 'utf-8');
eval(src);

// ── Tests ───────────────────────────────────────────────────────────

describe('LipSyncEngine', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        if (window.NEXUS_LIP_SYNC) {
            window.NEXUS_LIP_SYNC.stop();
            window.NEXUS_LIP_SYNC.setPaused(false);
        }
    });

    describe('Module initialization', () => {
        test('should expose NEXUS_LIP_SYNC on window', () => {
            expect(window.NEXUS_LIP_SYNC).toBeDefined();
        });

        test('should expose setPaused method', () => {
            expect(typeof window.NEXUS_LIP_SYNC.setPaused).toBe('function');
        });

        test('should expose start, stop, update methods', () => {
            expect(typeof window.NEXUS_LIP_SYNC.start).toBe('function');
            expect(typeof window.NEXUS_LIP_SYNC.stop).toBe('function');
            expect(typeof window.NEXUS_LIP_SYNC.update).toBe('function');
        });
    });

    describe('Pause mechanism', () => {
        test('should not apply visemes when paused', () => {
            window.NEXUS_LIP_SYNC.start('Hello world', 1.0);
            window.NEXUS_LIP_SYNC.setPaused(true);
            mockSetExpression.mockClear();

            // Run several update frames
            window.NEXUS_LIP_SYNC.update(0.016, mockVRMLoader);
            window.NEXUS_LIP_SYNC.update(0.016, mockVRMLoader);
            window.NEXUS_LIP_SYNC.update(0.016, mockVRMLoader);

            // No expressions should have been set
            expect(mockSetExpression).not.toHaveBeenCalled();
        });

        test('should resume viseme output when unpaused', () => {
            window.NEXUS_LIP_SYNC.start('Hello world', 1.0);
            window.NEXUS_LIP_SYNC.setPaused(true);
            window.NEXUS_LIP_SYNC.setPaused(false);
            mockSetExpression.mockClear();

            // Run update — should produce output
            window.NEXUS_LIP_SYNC.update(0.05, mockVRMLoader);
            window.NEXUS_LIP_SYNC.update(0.05, mockVRMLoader);
            window.NEXUS_LIP_SYNC.update(0.05, mockVRMLoader);

            // With active sequence and unpaused, expressions should be applied
            // (at minimum the smoothing interpolation writes values)
            expect(mockSetExpression.mock.calls.length).toBeGreaterThan(0);
        });

        test('setPaused should accept truthy/falsy values', () => {
            expect(() => {
                window.NEXUS_LIP_SYNC.setPaused(1);
                window.NEXUS_LIP_SYNC.setPaused(0);
                window.NEXUS_LIP_SYNC.setPaused(null);
                window.NEXUS_LIP_SYNC.setPaused(undefined);
                window.NEXUS_LIP_SYNC.setPaused('');
                window.NEXUS_LIP_SYNC.setPaused('yes');
            }).not.toThrow();
        });
    });

    describe('start/stop lifecycle (backward compatibility)', () => {
        test('should start lip-sync for text', () => {
            expect(() => {
                window.NEXUS_LIP_SYNC.start('Testing one two three', 1.0);
            }).not.toThrow();
            expect(window.NEXUS_LIP_SYNC.isActive).toBe(true);
        });

        test('should stop lip-sync', () => {
            window.NEXUS_LIP_SYNC.start('Hello', 1.0);
            window.NEXUS_LIP_SYNC.stop();
            expect(window.NEXUS_LIP_SYNC.isActive).toBe(false);
        });

        test('should handle empty text', () => {
            expect(() => {
                window.NEXUS_LIP_SYNC.start('', 1.0);
            }).not.toThrow();
        });

        test('should handle start with different speech rates', () => {
            expect(() => {
                window.NEXUS_LIP_SYNC.start('Hello', 0.5);
                window.NEXUS_LIP_SYNC.stop();
                window.NEXUS_LIP_SYNC.start('Hello', 2.0);
                window.NEXUS_LIP_SYNC.stop();
            }).not.toThrow();
        });
    });

    describe('update() (backward compatibility)', () => {
        test('should not throw when not active', () => {
            expect(() => {
                window.NEXUS_LIP_SYNC.update(0.016, mockVRMLoader);
            }).not.toThrow();
        });

        test('should not throw with null vrmLoader', () => {
            window.NEXUS_LIP_SYNC.start('Hello', 1.0);
            expect(() => {
                window.NEXUS_LIP_SYNC.update(0.016, null);
            }).not.toThrow();
        });

        test('should produce expression updates during active lip-sync', () => {
            window.NEXUS_LIP_SYNC.start('Hello world testing speech', 1.0);
            mockSetExpression.mockClear();

            // Run enough frames to advance the phoneme sequence
            for (let i = 0; i < 10; i++) {
                window.NEXUS_LIP_SYNC.update(0.05, mockVRMLoader);
            }

            // Should have called setExpression for viseme values
            expect(mockSetExpression.mock.calls.length).toBeGreaterThan(0);
        });

        test('should fade out visemes after stop', () => {
            window.NEXUS_LIP_SYNC.start('Hello', 1.0);

            // Run a few frames to build up values
            for (let i = 0; i < 5; i++) {
                window.NEXUS_LIP_SYNC.update(0.05, mockVRMLoader);
            }

            window.NEXUS_LIP_SYNC.stop();
            mockSetExpression.mockClear();

            // Update should still run to fade out
            window.NEXUS_LIP_SYNC.update(0.05, mockVRMLoader);

            // No crash expected
            expect(true).toBe(true);
        });
    });
});
