/**
 * What is selected, and what is actually playing (batch M1).
 *
 * These are two different facts and the app has only ever held one. That is the bug behind
 * this exchange, which is real:
 *
 *     NEXUS  Playing “Flying: Relaxing Sleep Music…” — https://youtube.com/watch?v=1ZYbU82GVz4
 *     YOU    play it please
 *     NEXUS  I'm a text-based AI assistant, I don't have the capability to play videos…
 *
 * She was not confused. She was told a *card had been published* and reported it as playback,
 * because `selected` and `playing` were the same field. Nothing had started: choosing a tile
 * in Together publishes a card and stops there. So the first message overclaims, and the
 * second — asked to do the thing she has just claimed to be doing — has nothing to act on.
 *
 * ## The states, and why each one exists
 *
 *   idle       nothing chosen
 *   results    a search came back; `results` holds them and "the first one" means something
 *   selected   something is chosen and ready — a card is on screen, no sound is coming out
 *   loading    playback was asked for; the player has not confirmed yet
 *   playing    the player itself reported PLAYING. Not "we asked it to"
 *   paused     the player reported PAUSED
 *   ended      the player reported ENDED
 *   blocked    playback was refused, almost always autoplay policy
 *
 * `blocked` is the one that would be tempting to leave out, and it is the one that keeps the
 * app honest. A browser can refuse to start audio that was not begun by a user gesture, and a
 * search that finishes after the gesture is exactly that case. Without this state the app
 * would say "Playing…" while the page sits silent — the same lie in a new place.
 *
 * ## Why nothing here touches the DOM
 *
 * This holds facts and announces changes. The player is owned by `YouTubeEmbed2D`, the card by
 * `ConversationPublisher`, the prompt by `CurrentMediaContext`. A state machine that also
 * reached into an iframe would be a second owner of playback, and the reason this file exists
 * is that there were already two.
 *
 * Exposes: window.NEXUS_MEDIA_SESSION
 */
(function (global) {
    'use strict';

    /** Every state the session can hold. Ordered roughly as a session moves through them. */
    const STATES = ['idle', 'results', 'selected', 'loading', 'playing', 'paused', 'ended', 'blocked', 'unconfirmed'];

    /** The states in which sound is, or should be, coming out. */
    const LIVE = ['playing'];

    const EVENT = 'nexus:media-session';

    let state = {
        status: 'idle',
        mode: null,
        current: null,
        results: [],
        selectedIndex: null,
        source: null,
    };

    function doc() {
        return global && global.document ? global.document : null;
    }

    /** A copy, so a caller cannot edit the session by holding a reference to it. */
    function snapshot() {
        return {
            status: state.status,
            mode: state.mode,
            current: state.current ? Object.assign({}, state.current) : null,
            results: state.results.map((r) => Object.assign({}, r)),
            selectedIndex: state.selectedIndex,
            source: state.source,
        };
    }

    const listeners = new Set();

    function announce(reason) {
        const detail = { reason: String(reason || 'change'), state: snapshot() };
        for (const fn of [...listeners]) {
            try {
                fn(detail);
            } catch (_) {
                /* one bad listener does not stop the others */
            }
        }
        const d = doc();
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

    /** Normalise anything result-shaped into what this file stores. */
    function normalise(result) {
        if (!result || typeof result !== 'object') {
            return null;
        }
        return {
            id: String(result.id || ''),
            provider: String(result.provider || 'media'),
            kind: String(result.kind || 'video'),
            title: String(result.title || ''),
            creator: String(result.creator || ''),
            url: String(result.url || ''),
            sample: Boolean(result.sample),
        };
    }

    /**
     * A search came back.
     *
     * Holding the list is what lets "the first one" and "number three" mean anything. It does
     * not select or play — a list of options is not a choice.
     */
    function setResults(results, { mode = null, source = null } = {}) {
        state.results = (Array.isArray(results) ? results : []).map(normalise).filter(Boolean);
        state.selectedIndex = null;
        state.mode = mode || state.mode;
        state.source = source || state.source;
        state.status = state.results.length ? 'results' : 'idle';
        announce('results');
        return snapshot();
    }

    /**
     * Something is chosen. Ready, not playing.
     *
     * This is the state the app used to call "playing", and the distinction is the whole
     * point of the file: a card on screen with a thumbnail on it is a choice, and the person
     * looking at it has heard nothing yet.
     */
    function select(result, { source = null } = {}) {
        const next = normalise(result);
        if (!next) {
            return snapshot();
        }
        state.current = next;
        state.status = 'selected';
        state.mode = next.kind === 'music' || next.kind === 'track' ? 'music' : 'watch';
        if (source) {
            state.source = source;
        }
        const at = state.results.findIndex((r) => r.id === next.id);
        state.selectedIndex = at >= 0 ? at : null;
        announce('select');
        return snapshot();
    }

    /** Choose from the held results by position. `null` when there is nothing there. */
    function selectIndex(index, options = {}) {
        // `typeof` first, because `Number(null)`, `Number('')` and `Number([])` are all `0` —
        // so a caller that meant "nothing" would otherwise get the first result. A router
        // turning "the first one" into a number is one bad parse away from playing something
        // nobody asked for, and this is the cheap place to stop it.
        if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= state.results.length) {
            return null;
        }
        return select(state.results[index], options);
    }

    /**
     * Playback has been asked for. The player has not confirmed anything yet.
     *
     * Deliberately its own state rather than an optimistic `playing`: everything between here
     * and the player's first event is time in which the browser may refuse, the network may
     * stall, or the user may have already changed their mind.
     */
    function requestPlay(result, { source = null } = {}) {
        if (result) {
            select(result, { source });
        }
        if (!state.current) {
            return snapshot();
        }
        state.status = 'loading';
        if (source) {
            state.source = source;
        }
        announce('request-play');
        return snapshot();
    }

    /** The player said so. These are the only three that may set a live state. */
    function markPlaying() {
        if (!state.current) {
            return snapshot();
        }
        state.status = 'playing';
        announce('playing');
        return snapshot();
    }

    function markPaused() {
        if (!state.current) {
            return snapshot();
        }
        state.status = 'paused';
        announce('paused');
        return snapshot();
    }

    function markEnded() {
        if (!state.current) {
            return snapshot();
        }
        state.status = 'ended';
        announce('ended');
        return snapshot();
    }

    /**
     * The player never said anything, and we do not know why.
     *
     * This is **not** `blocked`, and the difference cost a real user a real lie:
     *
     *     YOU    I like this song thank you
     *     NEXUS  ...it looks like the playback hasn't started yet. Please tap the card!
     *
     * The song was playing. What had actually happened is that the IFrame API never attached —
     * a blocked script, a slow network, an origin mismatch — so no PLAYING event arrived, and
     * the app treated silence as proof of refusal. It is not proof of anything. `blocked` is a
     * conclusion drawn from evidence (the player reported ready and then did not start);
     * this is the absence of evidence, and the only honest thing to say about it is nothing.
     */
    function markUnconfirmed() {
        if (!state.current || state.status !== 'loading') {
            return snapshot();
        }
        state.status = 'unconfirmed';
        announce('unconfirmed');
        return snapshot();
    }

    /**
     * The browser refused to start it.
     *
     * Kept distinct from an error: nothing is broken, the page simply has not earned the right
     * to make noise yet. The copy that goes with it is "tap Play", not "something went wrong".
     *
     * Only ever set from positive evidence — the player said it was ready and then did not
     * start. Silence goes to `unconfirmed` above.
     */
    function markBlocked() {
        if (!state.current) {
            return snapshot();
        }
        state.status = 'blocked';
        announce('blocked');
        return snapshot();
    }

    /** Playback stopped and nothing replaced it. The choice survives; the playback does not. */
    function stop() {
        if (!state.current) {
            return snapshot();
        }
        state.status = 'selected';
        announce('stop');
        return snapshot();
    }

    /** Nothing is chosen any more. */
    function clear() {
        state.current = null;
        state.selectedIndex = null;
        state.status = state.results.length ? 'results' : 'idle';
        announce('clear');
        return snapshot();
    }

    function get() {
        return snapshot();
    }

    function current() {
        return state.current ? Object.assign({}, state.current) : null;
    }

    function results() {
        return state.results.map((r) => Object.assign({}, r));
    }

    function status() {
        return state.status;
    }

    function isPlaying() {
        return LIVE.indexOf(state.status) >= 0;
    }

    /** For tests, and for a page that wants a clean slate. */
    function reset() {
        state = { status: 'idle', mode: null, current: null, results: [], selectedIndex: null, source: null };
        listeners.clear();
    }

    const api = {
        STATES,
        LIVE,
        EVENT,
        setResults,
        select,
        selectIndex,
        requestPlay,
        markPlaying,
        markPaused,
        markEnded,
        markBlocked,
        markUnconfirmed,
        stop,
        clear,
        get,
        current,
        results,
        status,
        isPlaying,
        onChange,
        reset,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (global) {
        global.NEXUS_MEDIA_SESSION = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
