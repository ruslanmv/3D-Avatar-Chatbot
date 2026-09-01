/**
 * EventBus — the Behavior Director's nervous system (spec v1.1 §4A).
 *
 * A typed publish/subscribe with no dependencies. "Typed" here means the event names are a
 * documented, checked set (§6.3): emitting a name nobody declared is a typo that would
 * otherwise sit silent for weeks, so it warns loudly in debug and is dropped.
 *
 * Deliberately small. Everything above Tier 0 talks through this, so it has to be dull:
 * no async, no ordering guarantees beyond registration order, no re-entrancy tricks. A
 * listener that throws is logged and skipped rather than taking the rest of the frame with
 * it — one bad adapter must not stop the avatar moving.
 *
 * Exposes: window.NEXUS_BD_EVENT_BUS
 */
const BehaviorEventBus = (() => {
    'use strict';

    /** The event vocabulary of §6.3, plus the two the addendum adds in §14.2. */
    const EVENTS = [
        'llm:token',
        'intent',
        'tts:start',
        'tts:end',
        'user:idle',
        'user:active',
        'user:speaking',
        'user:silent',
        'gaze:user-look-avatar',
        'gaze:user-look-away',
        'media:playing',
        'media:paused',
        'media:cut',
        'media:beat',
        'scene:enter',
        'scene:exit',
        // B14. One typed event carrying the anchor's name, rather than a family of
        // `anchor:<name>` events: the vocabulary stays closed, so a typo is still caught,
        // and §6.11's manifests can still spell an opening `anchor:waves`.
        'scene:anchor',
        'vision:insight',
        'session:up',
        'session:down',
        'mode:changed',
        'anim:started',
        'anim:ended',
        // B20. A panel appearing and going are events the assistant, the coach and the
        // share flow all react to; a single typed pair beats three private callbacks.
        'panel:shown',
        'panel:closed',
        // B22. One typed event carrying the phase, the way `scene:anchor` carries a name:
        // `focus:start`/`focus:break`/`focus:end` would be three entries and a fourth the
        // day somebody adds a long break.
        'focus:phase',
        // B23. One typed event carrying the kind and the tier, the way `scene:anchor`
        // carries a name: five `game:*` entries would be six the day somebody adds a revive.
        'game:moment',
    ];

    class EventBus {
        constructor({ debug = false } = {}) {
            this._listeners = new Map();
            this._debug = debug;
            this._emitted = 0;
        }

        /**
         * Subscribe. Returns an unsubscribe function — adapters are torn down when the
         * engine is disabled at runtime, and a bus that cannot forget them leaks.
         */
        on(event, handler) {
            if (typeof handler !== 'function') return () => {};
            if (!this._listeners.has(event)) this._listeners.set(event, []);
            this._listeners.get(event).push(handler);
            return () => this.off(event, handler);
        }

        off(event, handler) {
            const list = this._listeners.get(event);
            if (!list) return;
            const i = list.indexOf(handler);
            if (i >= 0) list.splice(i, 1);
        }

        once(event, handler) {
            const stop = this.on(event, (payload) => {
                stop();
                handler(payload);
            });
            return stop;
        }

        emit(event, payload = {}) {
            if (!EVENTS.includes(event)) {
                if (this._debug) console.warn(`[BD] unknown event "${event}" — dropped`);
                return 0;
            }
            this._emitted++;

            const list = this._listeners.get(event);
            if (!list || !list.length) return 0;

            // Copy: a handler may unsubscribe itself, and splicing mid-iteration skips one.
            let delivered = 0;
            for (const handler of list.slice()) {
                try {
                    handler(payload);
                    delivered++;
                } catch (error) {
                    console.warn(`[BD] listener for "${event}" threw`, error);
                }
            }
            return delivered;
        }

        /** Drop every subscription. Used by teardown, and by tests between cases. */
        clear() {
            this._listeners.clear();
        }

        stats() {
            const counts = {};
            for (const [event, list] of this._listeners) counts[event] = list.length;
            return { emitted: this._emitted, listeners: counts };
        }

        static get EVENTS() {
            return EVENTS.slice();
        }
    }

    return EventBus;
})();

if (typeof window !== 'undefined') window.NEXUS_BD_EVENT_BUS = BehaviorEventBus;
if (typeof module !== 'undefined' && module.exports) module.exports = BehaviorEventBus;
