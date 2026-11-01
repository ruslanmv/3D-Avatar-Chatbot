/**
 * VoiceTurnController — HV5. Only the newest turn speaks. Pure.
 *
 * With streamed speech several things belong to one reply at once: phrases still being cut
 * from the LLM stream, phrases queued at SonicAgent, frames in the jitter buffer, audio already
 * playing. When the person interrupts — taps the mic, sends a new message, presses stop, clears
 * the conversation, leaves VR — every one of them must stop, and none of them may start again
 * later because a late network event reached it.
 *
 * So each reply gets a turn id, every piece registers its own `cancel` against that id, and
 * `begin()` of the next turn cancels the previous one. Code that acts later (an arriving frame,
 * a `tts.audio.done`) asks `isCurrent(id)` first; a stale turn's events change nothing.
 */
(function (global) {
    'use strict';

    function create() {
        let seq = 0;
        let current = null; // { id, cancels: [], ended }

        function cancel(id) {
            if (!current || (id != null && current.id !== id)) return false;
            const turn = current;
            current = null;
            for (const fn of turn.cancels.splice(0)) {
                try {
                    fn();
                } catch (_) {}
            }
            return true;
        }

        return {
            /** A new turn; the previous one, if still running, is cancelled first. */
            begin() {
                cancel();
                current = { id: `v${++seq}-${Date.now().toString(36)}`, cancels: [] };
                return current.id;
            },
            current: () => (current ? current.id : null),
            isCurrent: (id) => !!current && current.id === id,
            /** Register what to undo when `id` is cancelled. Runs at once if `id` is already stale. */
            onCancel(id, fn) {
                if (!current || current.id !== id) {
                    try {
                        fn();
                    } catch (_) {}
                    return;
                }
                current.cancels.push(fn);
            },
            cancel,
            /** The turn finished on its own: forget it without running its cancels. */
            end(id) {
                if (current && current.id === id) current = null;
            },
        };
    }

    const api = { create };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_VOICE_TURNS = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
