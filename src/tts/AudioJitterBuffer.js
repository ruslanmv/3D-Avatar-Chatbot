/**
 * AudioJitterBuffer — HV4. Network PCM frames in, an ordered, gap-aware stream out. Pure.
 *
 * SonicAgent sends one phrase as numbered 20/40 ms frames (sequence restarts at 0 per phrase).
 * Over a WebSocket they normally arrive complete and in order, but "normally" is not a
 * contract the player can stand on: a relay can duplicate after a reconnect, a bug can skip,
 * and a frame for a phrase already cancelled can still be in flight. So:
 *
 *  - **Ordered.** Frames are released by sequence number, never by arrival.
 *  - **Duplicates and late frames are dropped**, counted, never played twice.
 *  - **A gap is waited for, briefly, then filled with silence of the missing length** — not
 *    skipped, which would make the rest of the sentence early against her lip-sync, and not
 *    waited for forever, which would freeze her mid-word.
 *  - **Bounded.** More than `maxMs` buffered is refused (`overflow`): the server is outrunning
 *    playback, and the flow control upstream (HV3 acks) is what should slow it — not memory.
 *  - **Starts after `startMs`** of audio (the jitter target, ~120 ms by default, tunable in
 *    Settings) or at once when the phrase has ended, so a two-word reply is not held back.
 */
(function (global) {
    'use strict';

    function create(opts) {
        const o = opts || {};
        const startMs = o.startMs == null ? 120 : o.startMs;
        const maxMs = o.maxMs == null ? 6000 : o.maxMs;
        const gapWaitMs = o.gapWaitMs == null ? 150 : o.gapWaitMs;
        const now = o.now || (() => Date.now());

        let next = 0; // the sequence number to release next
        let held = new Map(); // sequence → { samples, rate }
        let heldMs = 0;
        let ended = false;
        let started = false;
        let gapSince = null;
        let frameMs = null; // learned from the first frame, used to size a silence fill
        let rate = null;
        const stats = { received: 0, released: 0, duplicates: 0, late: 0, gaps: 0, gapMs: 0, overflow: 0 };

        function durMs(samples, r) {
            return (samples.length / r) * 1000;
        }

        /** → 'accepted' | 'duplicate' | 'late' | 'overflow' */
        function push(frame) {
            const seq = frame.sequence >>> 0;
            const samples = frame.samples;
            const r = frame.sampleRate;
            stats.received++;
            if (seq < next) {
                stats.late++;
                return 'late';
            }
            if (held.has(seq)) {
                stats.duplicates++;
                return 'duplicate';
            }
            const ms = durMs(samples, r);
            if (heldMs + ms > maxMs) {
                stats.overflow++;
                return 'overflow';
            }
            if (rate == null) rate = r;
            if (frameMs == null) frameMs = ms;
            held.set(seq, { samples, rate: r });
            heldMs += ms;
            return 'accepted';
        }

        function end() {
            ended = true;
        }

        function bufferedMs() {
            return heldMs;
        }

        function ready() {
            if (started) return true;
            if (ended || heldMs >= startMs) {
                started = true;
                return true;
            }
            return false;
        }

        /**
         * The next piece to play, or null when nothing can be released yet:
         * { samples, sampleRate, sequence, fill: false } or a silence fill { …, fill: true }.
         */
        function pull() {
            if (!ready()) return null;
            const item = held.get(next);
            if (item) {
                held.delete(next);
                heldMs -= durMs(item.samples, item.rate);
                gapSince = null;
                stats.released++;
                return { samples: item.samples, sampleRate: item.rate, sequence: next++, fill: false };
            }
            if (!held.size) return null; // nothing after the gap either: just not here yet
            if (gapSince == null) gapSince = now();
            const lowest = Math.min(...held.keys());
            if (!ended && now() - gapSince < gapWaitMs) return null;
            // Give up on the missing frames: play silence of their length, keep the timeline.
            const missing = lowest - next;
            const fillMs = missing * (frameMs || 20);
            const r = rate || 16000;
            stats.gaps++;
            stats.gapMs += fillMs;
            const fill = new Float32Array(Math.round((fillMs / 1000) * r));
            const seq = next;
            next = lowest;
            gapSince = null;
            return { samples: fill, sampleRate: r, sequence: seq, fill: true };
        }

        /** Everything releasable right now, in order. */
        function drain() {
            const out = [];
            for (let p = pull(); p; p = pull()) out.push(p);
            return out;
        }

        function finished() {
            return ended && held.size === 0;
        }

        function clear() {
            held = new Map();
            heldMs = 0;
            gapSince = null;
            ended = true;
        }

        return {
            push,
            end,
            ready,
            pull,
            drain,
            finished,
            clear,
            bufferedMs,
            stats: () => Object.assign({ bufferedMs: Math.round(heldMs), next }, stats),
        };
    }

    const api = { create };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_JITTER_BUFFER = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
