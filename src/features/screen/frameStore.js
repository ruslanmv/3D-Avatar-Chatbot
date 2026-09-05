/**
 * The frame the assistant is talking about (batch RS1).
 *
 * A screenshot is not a live view. The moment it is captured it starts going out of date,
 * and the single most damaging thing this feature could do is answer "what do you see?" by
 * taking a *second* picture — because then the words on screen describe one moment and the
 * image above them another, and nothing in the conversation says so. Users read that as the
 * assistant making things up about their desktop.
 *
 * So a capture is remembered here, by handle, and every follow-up question resolves against
 * this store before it considers capturing anything. One picture, one answer, visibly the
 * same picture.
 *
 * Pure and synchronous on purpose: no fetch, no DOM, no timers. It holds handles, not bytes.
 *
 * Exposes: window.NEXUS_SCREEN_FRAMES
 */
const ScreenFrameStore = (() => {
    'use strict';

    /**
     * How long a remembered frame stays answerable, in ms.
     *
     * Ten minutes, matched deliberately to the TTL HomePilot enforces on the file itself. A
     * client that believed in a frame for longer than the server keeps it would offer "ask
     * about this" on a picture that is already deleted — the failure would be a 404 arriving
     * a full round trip after the user pressed a button that looked live.
     */
    const TTL_MS = 10 * 60 * 1000;

    /** frame_id → handle. Insertion-ordered, so the last entry is the newest. */
    const held = new Map();

    function now(clock) {
        return typeof clock === 'number' ? clock : Date.now();
    }

    /**
     * Wall-clock milliseconds this frame was taken.
     *
     * The server sends `captured_at` in *its* clock, which is not this browser's, so it is
     * unusable for "how long ago". `age_s` is a duration and survives the difference — the
     * local arrival time minus the age the server reported is the local moment it was taken.
     */
    function takenAt(frame, clock) {
        const at = now(clock);
        const age = Number(frame && frame.age_s);
        return at - (Number.isFinite(age) && age >= 0 ? age * 1000 : 0);
    }

    /** Remember a capture. Returns the stored record, with local timing filled in. */
    function remember(frame, clock) {
        if (!frame || !frame.frame_id) {
            return null;
        }
        const record = Object.assign({}, frame, { taken_at_local: takenAt(frame, clock) });
        held.delete(frame.frame_id);
        held.set(frame.frame_id, record);
        prune(clock);
        return record;
    }

    /** One frame by id, or `null` if unknown or stale. */
    function get(frameId, clock) {
        const record = held.get(String(frameId || ''));
        if (!record) {
            return null;
        }
        if (stale(record, clock)) {
            held.delete(record.frame_id);
            return null;
        }
        return record;
    }

    /** The newest frame that is still worth answering about, or `null`. */
    function latest(clock) {
        prune(clock);
        let newest = null;
        for (const record of held.values()) {
            if (!newest || record.taken_at_local > newest.taken_at_local) {
                newest = record;
            }
        }
        return newest;
    }

    function stale(record, clock) {
        return now(clock) - record.taken_at_local > TTL_MS;
    }

    /** Age in ms of a stored record. Callers turn this into "Just now" / "2 min ago". */
    function ageOf(record, clock) {
        if (!record) {
            return Infinity;
        }
        return Math.max(0, now(clock) - record.taken_at_local);
    }

    function forget(frameId) {
        return held.delete(String(frameId || ''));
    }

    function prune(clock) {
        for (const [key, record] of Array.from(held.entries())) {
            if (stale(record, clock)) {
                held.delete(key);
            }
        }
        return held.size;
    }

    function clear() {
        held.clear();
    }

    function size() {
        return held.size;
    }

    return { TTL_MS, remember, get, latest, ageOf, forget, prune, clear, size, takenAt };
})();

if (typeof window !== 'undefined') {
    window.NEXUS_SCREEN_FRAMES = ScreenFrameStore;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ScreenFrameStore;
}
