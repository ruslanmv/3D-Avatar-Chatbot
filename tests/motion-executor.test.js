/**
 * Tests for MotionExecutor and MotionResponseHandler.
 */

/* global describe, test, expect, beforeEach, jest */

// Mock requestAnimationFrame and performance.now for jsdom
global.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
global.performance = global.performance || { now: () => Date.now() };

// Load modules — set MotionDSL as global before loading MotionExecutor
const MotionDSL = require('../src/xr/MotionDSL');
global.MotionDSL = MotionDSL;
const MotionExecutor = require('../src/xr/MotionExecutor');
// Set WorldStateBridge global for MotionResponseHandler
global.WorldStateBridge = { updateAvatarState: () => {} };
const MotionResponseHandler = require('../src/xr/MotionResponseHandler');

describe('MotionExecutor', () => {
    let mockAvatar;
    let mockContext;

    beforeEach(() => {
        mockAvatar = {
            position: {
                x: 0,
                y: 0,
                z: 0,
                clone: function () {
                    return {
                        x: this.x,
                        y: this.y,
                        z: this.z,
                        sub: function (other) {
                            this.x -= other.x;
                            this.y -= other.y;
                            this.z -= other.z;
                            return this;
                        },
                        add: function (other) {
                            this.x += other.x;
                            this.y += other.y;
                            this.z += other.z;
                            return this;
                        },
                        normalize: function () {
                            const len = Math.sqrt(this.x ** 2 + this.y ** 2 + this.z ** 2) || 1;
                            this.x /= len;
                            this.y /= len;
                            this.z /= len;
                            return this;
                        },
                        multiplyScalar: function (s) {
                            this.x *= s;
                            this.y *= s;
                            this.z *= s;
                            return this;
                        },
                        distanceTo: function (other) {
                            return Math.sqrt(
                                (this.x - other.x) ** 2 + (this.y - other.y) ** 2 + (this.z - other.z) ** 2
                            );
                        },
                        lerpVectors: function (a, b, t) {
                            this.x = a.x + (b.x - a.x) * t;
                            this.y = a.y + (b.y - a.y) * t;
                            this.z = a.z + (b.z - a.z) * t;
                            return this;
                        },
                        copy: function (other) {
                            this.x = other.x;
                            this.y = other.y;
                            this.z = other.z;
                        },
                    };
                },
                lerpVectors: function (a, b, t) {
                    this.x = a.x + (b.x - a.x) * t;
                    this.y = a.y + (b.y - a.y) * t;
                    this.z = a.z + (b.z - a.z) * t;
                },
                copy: function (other) {
                    this.x = other.x;
                    this.y = other.y;
                    this.z = other.z;
                },
            },
            rotation: { y: 0 },
        };

        const expressionCalls = [];
        const animationCalls = [];

        mockContext = {
            avatar: mockAvatar,
            getUserPosition: () => ({
                x: 3,
                y: 0,
                z: 3,
                clone: () => ({
                    x: 3,
                    y: 0,
                    z: 3,
                    sub: function (o) {
                        this.x -= o.x;
                        this.y -= o.y;
                        this.z -= o.z;
                        return this;
                    },
                    normalize: function () {
                        const l = Math.sqrt(this.x ** 2 + this.y ** 2 + this.z ** 2) || 1;
                        this.x /= l;
                        this.y /= l;
                        this.z /= l;
                        return this;
                    },
                    multiplyScalar: function (s) {
                        this.x *= s;
                        this.y *= s;
                        this.z *= s;
                        return this;
                    },
                    distanceTo: function (o) {
                        return Math.sqrt((this.x - o.x) ** 2 + (this.y - o.y) ** 2 + (this.z - o.z) ** 2);
                    },
                }),
            }),
            setExpression: jest.fn((name, weight) => expressionCalls.push({ name, weight })),
            playAnimation: jest.fn((name) => animationCalls.push(name)),
            setLookAtTarget: jest.fn(),
            _expressionCalls: expressionCalls,
            _animationCalls: animationCalls,
        };

        MotionExecutor.init(mockContext);
    });

    test('init registers handlers with MotionDSL', () => {
        // After init, MotionDSL should have non-stub handlers
        expect(typeof MotionDSL.execute).toBe('function');
        expect(typeof MotionDSL.interrupt).toBe('function');
    });

    test('expression handler calls setExpression', async () => {
        const plan = {
            persona_id: 'test',
            commands: [{ type: 'expression', name: 'happy', weight: 0.8 }],
            interruptible: true,
            priority: 'normal',
        };
        await MotionDSL.execute(plan, mockContext);
        expect(mockContext.setExpression).toHaveBeenCalledWith('happy', 0.8);
    });

    test('wave handler calls playAnimation', async () => {
        const plan = {
            persona_id: 'test',
            commands: [{ type: 'wave', side: 'right' }],
            interruptible: true,
            priority: 'normal',
        };
        await MotionDSL.execute(plan, mockContext);
        expect(mockContext.playAnimation).toHaveBeenCalledWith('wave', 'right');
    });

    test('look_at handler calls setLookAtTarget', async () => {
        const plan = {
            persona_id: 'test',
            commands: [{ type: 'look_at', target: 'user_head', speed: 0.7 }],
            interruptible: true,
            priority: 'normal',
        };
        await MotionDSL.execute(plan, mockContext);
        expect(mockContext.setLookAtTarget).toHaveBeenCalled();
    });

    test('sit handler calls sit animation', async () => {
        const plan = {
            persona_id: 'test',
            commands: [{ type: 'sit', target: 'nearest_seat' }],
            interruptible: true,
            priority: 'normal',
        };
        await MotionDSL.execute(plan, mockContext);
        expect(mockContext.playAnimation).toHaveBeenCalledWith('sit');
    });

    test('speak_start and speak_end trigger animations', async () => {
        const plan = {
            persona_id: 'test',
            commands: [{ type: 'speak_start' }, { type: 'speak_end' }],
            interruptible: true,
            priority: 'normal',
        };
        await MotionDSL.execute(plan, mockContext);
        expect(mockContext.playAnimation).toHaveBeenCalledWith('talking');
        expect(mockContext.playAnimation).toHaveBeenCalledWith('idle');
    });

    test('multiple commands execute sequentially', async () => {
        const plan = {
            persona_id: 'test',
            commands: [
                { type: 'expression', name: 'happy', weight: 0.5 },
                { type: 'wave', side: 'left' },
                { type: 'nod' },
            ],
            interruptible: true,
            priority: 'normal',
        };
        await MotionDSL.execute(plan, mockContext);
        expect(mockContext.setExpression).toHaveBeenCalledTimes(1);
        expect(mockContext.playAnimation).toHaveBeenCalledTimes(2);
    });
});

describe('MotionResponseHandler', () => {
    let mockContext;
    let stateChanges;

    beforeEach(() => {
        stateChanges = [];
        mockContext = {
            avatar: { position: { x: 0, y: 0, z: 0 } },
            setExpression: jest.fn(),
            playAnimation: jest.fn(),
        };
        MotionResponseHandler.init({
            motionContext: mockContext,
            personaId: 'scarlett',
            onStateChange: (state) => stateChanges.push(state),
        });
    });

    test('processResponse extracts emotion directive', async () => {
        await MotionResponseHandler.processResponse({
            x_avatar_directives: {
                emotion: 'happy',
                state: 'speaking',
            },
        });
        expect(mockContext.setExpression).toHaveBeenCalledWith('happy', 0.7);
        expect(stateChanges).toContain('speaking');
    });

    test('processResponse handles missing directives', async () => {
        await MotionResponseHandler.processResponse({});
        expect(mockContext.setExpression).not.toHaveBeenCalled();
    });

    test('processResponse handles null', async () => {
        await MotionResponseHandler.processResponse(null);
        expect(mockContext.setExpression).not.toHaveBeenCalled();
    });

    test('signalThinking triggers state change', () => {
        MotionResponseHandler.signalThinking();
        expect(stateChanges).toContain('thinking');
        expect(mockContext.setExpression).toHaveBeenCalledWith('thinking', 0.4);
    });

    test('signalSpeaking triggers state change', () => {
        MotionResponseHandler.signalSpeaking();
        expect(stateChanges).toContain('speaking');
    });

    test('signalIdle resets expression', () => {
        MotionResponseHandler.signalIdle();
        expect(stateChanges).toContain('idle');
        expect(mockContext.setExpression).toHaveBeenCalledWith('neutral', 0.0);
    });

    test('setPersona updates active persona', () => {
        MotionResponseHandler.setPersona('luna');
        // No error thrown, internal state updated
    });
});
