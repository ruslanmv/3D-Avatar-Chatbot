/**
 * What she remembers between sessions (batch S3).
 *
 * The old Focus wrote a `streak` row on every completed block and **nothing ever read it**.
 * The spec called that "the first place the user sees her memory", and the user never saw it.
 * A counter nobody reads is not memory, it is bookkeeping.
 *
 * So this stores the thing worth reading back: the topic, when, and what was still shaky at
 * the end. Which turns the opening line of the next session from
 *
 *     "What do you want to understand today?"
 *
 * into
 *
 *     "Last time — quantum entanglement. Measurement was the shaky part. Pick that up, or
 *      something new?"
 *
 * That is the whole reason to build studying into an app you already have a relationship with
 * rather than opening a chat window. A plain conversation cannot do it, and it is the only
 * feature here a general chatbot structurally cannot copy.
 *
 * ## Local, and small
 *
 * `localStorage`, capped, per browser. Not synced anywhere: this is a record of what somebody
 * has been trying to learn, which is a more personal thing than a playlist, and it has no
 * business leaving the device on its own. Capped because an unbounded history in
 * `localStorage` is a slow leak that shows up months later as a quota error somewhere else.
 *
 * Exposes: window.NEXUS_STUDY_MEMORY
 */
(function (global) {
    'use strict';

    const KEY = 'nexus_study_history';

    /** How many sessions to keep. Enough to notice a pattern, few enough to stay small. */
    const MAX = 20;

    /** In-memory fallback for a browser with storage switched off. */
    let memory = null;

    function read() {
        try {
            const raw = global && global.localStorage ? global.localStorage.getItem(KEY) : null;
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    return parsed;
                }
            }
        } catch (_) {
            /* corrupt or unavailable: the in-memory copy, or nothing */
        }
        return Array.isArray(memory) ? memory : [];
    }

    function write(list) {
        memory = list;
        try {
            if (global && global.localStorage) {
                global.localStorage.setItem(KEY, JSON.stringify(list));
            }
        } catch (_) {
            // Private mode, or a full quota. The session still works; it just will not be
            // remembered, which is a smaller loss than failing the session over it.
        }
        return list;
    }

    /** Record a finished session. Takes `StudySession.outcome()`. */
    function record(outcome) {
        if (!outcome || !outcome.topic) {
            return read();
        }
        const entry = {
            topic: String(outcome.topic).slice(0, 200),
            at: global && global.Date ? global.Date.now() : 0,
            solid: (outcome.solid || []).slice(0, 12).map((s) => String(s).slice(0, 120)),
            shaky: (outcome.shaky || []).slice(0, 12).map((s) => String(s).slice(0, 120)),
            minutes: Number(outcome.minutes) || 0,
        };
        // Newest first, and one entry per topic: the second session on a topic supersedes the
        // first rather than sitting beside it, or "revisit" ends up pointing at what was shaky
        // three sessions ago and has been solid since.
        const rest = read().filter((e) => e.topic.toLowerCase() !== entry.topic.toLowerCase());
        return write([entry].concat(rest).slice(0, MAX));
    }

    /** Everything, newest first. */
    function all() {
        return read().slice();
    }

    /** The most recent session, or `null`. */
    function last() {
        return read()[0] || null;
    }

    /**
     * What to open with, or `null` on a first visit.
     *
     * One suggestion, never a list. A session that begins by presenting six unfinished topics
     * is a session nobody begins.
     */
    function opener() {
        const entry = last();
        if (!entry) {
            return null;
        }
        return {
            topic: entry.topic,
            revisit: entry.shaky[0] || null,
            at: entry.at,
        };
    }

    /** What was left shaky on this topic before, so she can start there. */
    function shakyFor(topic) {
        const t = String(topic || '')
            .trim()
            .toLowerCase();
        if (!t) {
            return [];
        }
        const entry = read().find((e) => e.topic.toLowerCase() === t);
        return entry ? entry.shaky.slice() : [];
    }

    function clear() {
        memory = [];
        try {
            if (global && global.localStorage) {
                global.localStorage.removeItem(KEY);
            }
        } catch (_) {
            /* nothing to do */
        }
        return [];
    }

    const api = { KEY, MAX, record, all, last, opener, shakyFor, clear };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (global) {
        global.NEXUS_STUDY_MEMORY = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
