/**
 * IdleAdapter — has the user gone quiet (spec v1.1 §6.3, UC-2).
 *
 * Drives `user:idle` / `user:active`, which is what turns the base idle into fidgets, and
 * later what gives the curiosity engine a polite opening (§6.12: `user:silent>12000`).
 *
 * The threshold is a UX decision, not a technical one. Too short and she fidgets over your
 * shoulder while you think; too long and she freezes into a mannequin between messages.
 * Twenty seconds is the default because it is longer than a pause for thought and shorter
 * than a pause that feels like being ignored.
 *
 * Activity is anything the user does, not only what they type — a mouse move counts,
 * because someone reading her reply has not left.
 *
 * Exposes: window.NEXUS_BD_IDLE_ADAPTER
 */
const IdleAdapter = (() => {
    'use strict';

    const IDLE_AFTER_MS = 20000;
    const ACTIVITY_EVENTS = ['keydown', 'pointerdown', 'pointermove', 'wheel', 'touchstart'];

    function attach({ bus, blackboard, target, idleAfterMs = IDLE_AFTER_MS, now = () => Date.now() } = {}) {
        const el = target || (typeof window !== 'undefined' ? window : null);
        let lastActivity = now();
        let idle = false;
        const listeners = [];

        function markActive() {
            lastActivity = now();
            if (!idle) return null;
            idle = false;
            blackboard?.setFlag('userIdle', false);
            blackboard?.resetTimer('sinceUserInput');
            bus.emit('user:active', { ms: 0 });
            return 'user:active';
        }

        /** Called from the render loop by the director; also directly by tests. */
        function tick() {
            const elapsed = now() - lastActivity;
            if (idle || elapsed < idleAfterMs) return null;
            idle = true;
            blackboard?.setFlag('userIdle', true);
            bus.emit('user:idle', { ms: elapsed });
            return 'user:idle';
        }

        if (el && typeof el.addEventListener === 'function') {
            for (const event of ACTIVITY_EVENTS) {
                const handler = () => markActive();
                // Passive: this must never be the reason a scroll stutters.
                el.addEventListener(event, handler, { passive: true });
                listeners.push(() => el.removeEventListener(event, handler));
            }
        }

        return {
            name: 'IdleAdapter',
            tick,
            markActive,
            get isIdle() {
                return idle;
            },
            detach() {
                for (const undo of listeners.splice(0)) undo();
            },
        };
    }

    return { attach, IDLE_AFTER_MS, ACTIVITY_EVENTS };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_IDLE_ADAPTER = IdleAdapter;
if (typeof module !== 'undefined' && module.exports) module.exports = IdleAdapter;
