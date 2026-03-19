/**
 * MotionDSL — client-side interpreter for motion command plans.
 *
 * Receives MotionPlan JSON from HomePilot and translates each command
 * into Three.js / VRM operations (locomotion, IK, expressions, etc.).
 *
 * Additive module: does not modify any existing code.
 *
 * @module MotionDSL
 */

const MotionDSL = (() => {
    'use strict';

    /**
     * @typedef {Object} MotionCommand
     * @property {string} type
     * @property {string} [target]
     * @property {number} [distance_m]
     * @property {number} [speed]
     * @property {string} [name]
     * @property {number} [weight]
     * @property {string} [side]
     * @property {number[]} [position]
     * @property {number} [duration_s]
     */

    /**
     * @typedef {Object} MotionPlan
     * @property {string} persona_id
     * @property {MotionCommand[]} commands
     * @property {boolean} interruptible
     * @property {string} priority
     */

    /** @type {MotionPlan|null} Currently executing plan */
    let _currentPlan = null;

    /** @type {number} Current command index */
    let _cmdIndex = 0;

    /** @type {boolean} Whether execution is paused */
    let _paused = false;

    /** @type {Object<string, Function>} Command handlers */
    const _handlers = {};

    /**
     * Register a handler for a command type.
     * @param {string} type - e.g. "approach", "look_at"
     * @param {Function} handler - async (command, context) => void
     */
    function registerHandler(type, handler) {
        _handlers[type] = handler;
    }

    /**
     * Execute a motion plan sequentially.
     * @param {MotionPlan} plan
     * @param {Object} context - runtime context (avatar, scene, user position, etc.)
     * @returns {Promise<void>}
     */
    async function execute(plan, context) {
        if (_currentPlan && !_currentPlan.interruptible && _cmdIndex < (_currentPlan.commands || []).length) {
            console.warn('[MotionDSL] Current plan is not interruptible, ignoring new plan');
            return;
        }

        _currentPlan = plan;
        _cmdIndex = 0;
        _paused = false;

        const commands = plan.commands || [];

        for (_cmdIndex = 0; _cmdIndex < commands.length; _cmdIndex++) {
            if (_paused) break;

            const cmd = commands[_cmdIndex];
            const handler = _handlers[cmd.type];

            if (handler) {
                try {
                    await handler(cmd, context);
                } catch (err) {
                    console.error(`[MotionDSL] Error executing ${cmd.type}:`, err);
                }
            } else {
                console.warn(`[MotionDSL] No handler for command type: ${cmd.type}`);
            }
        }

        if (_cmdIndex >= commands.length) {
            _currentPlan = null;
        }
    }

    /**
     * Interrupt the current plan.
     */
    function interrupt() {
        if (_currentPlan && _currentPlan.interruptible) {
            _paused = true;
            _currentPlan = null;
        }
    }

    /**
     * Check if a plan is currently executing.
     * @returns {boolean}
     */
    function isExecuting() {
        return _currentPlan !== null && !_paused;
    }

    /**
     * Get the current plan (for debugging).
     * @returns {MotionPlan|null}
     */
    function currentPlan() {
        return _currentPlan;
    }

    // ── Default handlers (stubs — real implementations wire into Three.js) ──

    registerHandler('approach', async (cmd, ctx) => {
        console.log(`[MotionDSL] approach → target=${cmd.target}, distance=${cmd.distance_m}m`);
        // Real implementation: calculate target position, lerp avatar position
    });

    registerHandler('retreat', async (cmd, ctx) => {
        console.log(`[MotionDSL] retreat → distance=${cmd.distance_m}m`);
    });

    registerHandler('follow', async (cmd, ctx) => {
        console.log(`[MotionDSL] follow → target=${cmd.target}, distance=${cmd.distance_m}m`);
    });

    registerHandler('stop_follow', async (cmd, ctx) => {
        console.log('[MotionDSL] stop_follow');
    });

    registerHandler('stop', async (cmd, ctx) => {
        console.log('[MotionDSL] stop');
    });

    registerHandler('look_at', async (cmd, ctx) => {
        console.log(`[MotionDSL] look_at → target=${cmd.target}, speed=${cmd.speed}`);
    });

    registerHandler('expression', async (cmd, ctx) => {
        console.log(`[MotionDSL] expression → name=${cmd.name}, weight=${cmd.weight}`);
    });

    registerHandler('gesture', async (cmd, ctx) => {
        console.log(`[MotionDSL] gesture → name=${cmd.name}, side=${cmd.side}`);
    });

    registerHandler('sit', async (cmd, ctx) => {
        console.log(`[MotionDSL] sit → target=${cmd.target}`);
    });

    registerHandler('stand', async (cmd, ctx) => {
        console.log('[MotionDSL] stand');
    });

    registerHandler('wave', async (cmd, ctx) => {
        console.log(`[MotionDSL] wave → side=${cmd.side}`);
    });

    registerHandler('nod', async (cmd, ctx) => {
        console.log('[MotionDSL] nod');
    });

    registerHandler('point', async (cmd, ctx) => {
        console.log(`[MotionDSL] point → target=${cmd.target}, side=${cmd.side}`);
    });

    registerHandler('offer_hand', async (cmd, ctx) => {
        console.log(`[MotionDSL] offer_hand → side=${cmd.side}`);
    });

    registerHandler('idle', async (cmd, ctx) => {
        console.log(`[MotionDSL] idle → style=${cmd.name}`);
    });

    registerHandler('speak_start', async (cmd, ctx) => {
        console.log('[MotionDSL] speak_start');
    });

    registerHandler('speak_end', async (cmd, ctx) => {
        console.log('[MotionDSL] speak_end');
    });

    return {
        registerHandler,
        execute,
        interrupt,
        isExecuting,
        currentPlan,
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = MotionDSL;
}
