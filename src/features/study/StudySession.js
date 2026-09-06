/**
 * A session spent understanding something (batch S2).
 *
 * Focus used to be a pomodoro clock with an avatar next to it. The clock was behind a panel
 * you close in order to work, the streak it wrote was read by nothing, and nothing about the
 * conversation was different at the end. This is what it becomes instead: **a topic, read up
 * on, then worked through in questions**.
 *
 * ## The phases, and why the order is that way round
 *
 *   topic       what do you want to understand?
 *   researching she reads first — before saying anything about it
 *   calibrating what do you already know?
 *   learning    she asks, you answer, she responds to *your answer*
 *   checking    explain it back in your own words
 *   summary     what held, what did not, what to return to
 *
 * `researching` comes before she speaks because a model asked to teach without material will
 * teach anyway, fluently and sometimes wrongly. `calibrating` comes before `learning` because
 * asking what somebody already knows both activates it and stops her explaining it again.
 * `learning` is questions rather than exposition because being asked to recall beats being
 * told a second time — that is the testing effect, and it is the single largest difference
 * between a tutor and a wall of text with a question stapled on.
 *
 * `checking` is the Feynman step. Explaining a thing in your own words is the one exercise
 * that cannot be passed by recognition, so it is where a gap actually surfaces.
 *
 * ## Concepts carry a verdict, not a score
 *
 * Each concept ends `solid` or `shaky`. Not a percentage, not a grade. The purpose is to know
 * what to return to next time, and a number would invite exactly the scoreboard this feature
 * should not become — an app that tells you that you are 12% worse than last week is a manager,
 * not a companion.
 *
 * Exposes: window.NEXUS_STUDY_SESSION
 */
(function (global) {
    'use strict';

    const PHASES = ['idle', 'topic', 'researching', 'calibrating', 'learning', 'checking', 'summary'];

    /** The two things a concept can be at the end of a turn on it. */
    const VERDICTS = ['solid', 'shaky'];

    const EVENT = 'nexus:study';

    let state = null;
    const listeners = new Set();

    function blank() {
        return {
            phase: 'idle',
            topic: '',
            sources: [],
            used: null,
            escalation: null,
            concepts: [],
            startedAt: null,
            endedAt: null,
        };
    }

    state = blank();

    function snapshot() {
        return {
            phase: state.phase,
            topic: state.topic,
            sources: state.sources.map((s) => Object.assign({}, s)),
            used: state.used,
            escalation: state.escalation,
            concepts: state.concepts.map((c) => Object.assign({}, c)),
            startedAt: state.startedAt,
            endedAt: state.endedAt,
        };
    }

    function announce(reason) {
        const detail = { reason: String(reason || 'change'), state: snapshot() };
        for (const fn of [...listeners]) {
            try {
                fn(detail);
            } catch (_) {
                /* one bad listener does not stop the others */
            }
        }
        const d = global && global.document;
        if (d && typeof d.dispatchEvent === 'function' && typeof global.CustomEvent === 'function') {
            try {
                d.dispatchEvent(new global.CustomEvent(EVENT, { detail }));
            } catch (_) {
                /* an event nobody can hear is not worth throwing over */
            }
        }
        return detail;
    }

    function onChange(fn) {
        if (typeof fn !== 'function') {
            return () => {};
        }
        listeners.add(fn);
        return () => listeners.delete(fn);
    }

    function now() {
        return global && global.Date ? global.Date.now() : 0;
    }

    /** Somebody pressed Focus. Nothing is known yet except that a session is wanted. */
    function begin() {
        state = blank();
        state.phase = 'topic';
        state.startedAt = now();
        announce('begin');
        return snapshot();
    }

    /** They named a topic; the reading has not happened yet. */
    function setTopic(topic) {
        const t = String(topic || '').trim();
        if (!t) {
            return snapshot();
        }
        state.topic = t.slice(0, 200);
        state.phase = 'researching';
        announce('topic');
        return snapshot();
    }

    /**
     * The reading came back.
     *
     * With sources she moves to calibrating. Without them the session stops here rather than
     * pressing on — teaching a topic she could not read about is exactly the failure this
     * whole design exists to prevent, and doing it anyway while displaying a citation would
     * be worse than refusing.
     */
    function setSources(result) {
        const ok = result && result.ok && Array.isArray(result.sources) && result.sources.length;
        state.sources = ok ? result.sources.slice(0, 4) : [];
        state.used = (result && result.used) || null;
        state.escalation = (result && result.escalation) || null;
        state.phase = ok ? 'calibrating' : 'topic';
        announce(ok ? 'researched' : 'no-sources');
        return snapshot();
    }

    /** They said what they already know. Now the questions start. */
    function calibrated() {
        if (state.phase !== 'calibrating') {
            return snapshot();
        }
        state.phase = 'learning';
        announce('calibrated');
        return snapshot();
    }

    /**
     * Record how a concept went.
     *
     * Re-marking the same concept replaces the earlier verdict rather than appending: what
     * matters next session is where it *ended up*, and a list that says "shaky, shaky, solid"
     * describes the lesson working rather than a weakness.
     */
    function mark(concept, verdict) {
        const name = String(concept || '')
            .trim()
            .slice(0, 120);
        const v = VERDICTS.indexOf(String(verdict || '').toLowerCase()) >= 0 ? String(verdict).toLowerCase() : null;
        if (!name || !v) {
            return snapshot();
        }
        const at = state.concepts.findIndex((c) => c.name.toLowerCase() === name.toLowerCase());
        const entry = { name, verdict: v, at: now() };
        if (at >= 0) {
            state.concepts[at] = entry;
        } else {
            state.concepts.push(entry);
        }
        announce('mark');
        return snapshot();
    }

    /** Time for "explain it back to me". */
    function check() {
        if (state.phase !== 'learning') {
            return snapshot();
        }
        state.phase = 'checking';
        announce('check');
        return snapshot();
    }

    /** The session is over, however it ended. */
    function finish() {
        state.phase = 'summary';
        state.endedAt = now();
        announce('finish');
        return snapshot();
    }

    function end() {
        state = blank();
        announce('end');
        return snapshot();
    }

    function get() {
        return snapshot();
    }

    function isRunning() {
        return state.phase !== 'idle' && state.phase !== 'summary';
    }

    /** What to say at the end, as facts rather than a sentence — the caller writes the words. */
    function outcome() {
        const solid = state.concepts.filter((c) => c.verdict === 'solid').map((c) => c.name);
        const shaky = state.concepts.filter((c) => c.verdict === 'shaky').map((c) => c.name);
        const ms = state.startedAt ? (state.endedAt || now()) - state.startedAt : 0;
        return {
            topic: state.topic,
            solid,
            shaky,
            // What to open with next time. One thing, not a list: a session that begins with
            // six things to revisit is a session nobody begins.
            revisit: shaky[0] || null,
            minutes: Math.max(0, Math.round(ms / 60000)),
            used: state.used,
        };
    }

    function reset() {
        state = blank();
        listeners.clear();
    }

    const api = {
        PHASES,
        VERDICTS,
        EVENT,
        begin,
        setTopic,
        setSources,
        calibrated,
        mark,
        check,
        finish,
        end,
        get,
        isRunning,
        outcome,
        onChange,
        reset,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (global) {
        global.NEXUS_STUDY_SESSION = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
