/**
 * One function that finds something and plays it (batch T3).
 *
 * Three callers want the same thing to happen: the pattern matcher when somebody types "play
 * some lofi", the model when it emits `<play>`, and the picker when somebody taps a result.
 * Before this they each did their own version, which is how "search is not connected" came to
 * be phrased three different ways and how the keyless samples reached one path and not the
 * others.
 *
 * So: one `fulfil`. Resolve a provider, search, take the first result, publish it into the
 * chat. Every failure has one shape and one place to be fixed, and anything added here — a
 * second provider, a queue, a "not that one" — arrives in all three at once.
 *
 * ## What it will not do
 *
 * **It never plays something nobody asked for.** `fulfil` is only ever called from an explicit
 * request; there is no background path into it and no "you might like" list feeding it.
 *
 * **It never guesses at a query.** An empty or whitespace query is refused rather than turned
 * into a search for nothing, because a search for nothing returns the most popular video on the
 * internet and plays it at somebody who was mid-sentence.
 *
 * Exposes: window.NEXUS_MEDIA_INTENT
 */
(function (global) {
    'use strict';

    /** Reasons `fulfil` can decline, each of which the caller renders differently. */
    const WHY = {
        OFF: 'together-off',
        EMPTY: 'empty-query',
        NO_PROVIDER: 'no-provider',
        FAILED: 'search-failed',
        NOTHING: 'nothing-found',
        NO_CHAT: 'no-chat',
    };

    const CAPABILITY = { music: 'music.search', video: 'video.search' };

    function pick(name) {
        return global && global[name] ? global[name] : null;
    }

    function kindOf(kind) {
        return String(kind || '').toLowerCase() === 'music' ? 'music' : 'video';
    }

    /**
     * Find something for `query` and put it in the chat.
     *
     * @param {object} request
     * @param {string} request.query   what to search for
     * @param {string} [request.kind]  `music` | `video`
     * @param {string} [request.source] who asked — `pattern`, `model`, `picker`. Recorded, not
     *   acted on, so an unexpected autoplay can be traced to the path that caused it.
     * @returns {Promise<{ok: boolean, why?: string, result?: object}>}
     */
    async function fulfil(request = {}) {
        const kind = kindOf(request.kind);
        const query = String(request.query || '').trim();
        const source = String(request.source || 'unknown');

        const sw = pick('NEXUS_TOGETHER_SWITCH');
        if (sw && typeof sw.isOn === 'function' && !sw.isOn()) {
            // Off means off. A directive left over in a reply, or a pattern that fires while
            // the switch is off, must not play anything.
            return { ok: false, why: WHY.OFF };
        }
        if (!query) {
            return { ok: false, why: WHY.EMPTY };
        }

        const results = await search(query, kind);
        if (results === null) {
            return { ok: false, why: WHY.FAILED };
        }
        if (!results.length) {
            return { ok: false, why: WHY.NOTHING };
        }

        // The first result, deliberately. Somebody who said "play something relaxing" asked for
        // one thing to start; handing them four and a decision is the detour this batch removes.
        const result = results[0];
        const published = play(result, source);
        if (!published) {
            return { ok: false, why: WHY.NO_CHAT, result };
        }
        return { ok: true, result, source, kind };
    }

    /** `[]` for nothing found, `null` for a search that could not run. The two differ. */
    async function search(query, kind) {
        const registry = pick('NEXUS_DISCOVERY');
        const capability = CAPABILITY[kind];
        let provider = null;
        if (registry && typeof registry.forCapability === 'function') {
            try {
                if (typeof registry.warm === 'function') {
                    // A provider may still be finding out whether this deployment holds a key.
                    await registry.warm();
                }
                provider = registry.forCapability(capability);
            } catch (_) {
                provider = null;
            }
        }

        if (!provider || typeof provider.search !== 'function') {
            // No key anywhere. The samples are a real answer rather than a placeholder: they
            // play through this same path, so "she can play something" stays true.
            return samplesFor(capability);
        }

        try {
            const found = await provider.search(query, { max: 4, kind });
            if (Array.isArray(found) && found.length) {
                return found;
            }
            // A search that ran and came back empty used to end here, and the user was told
            // "I didn't find a playable result for that" — measured live, that was three of
            // five remaining failures. Empty-handed is never the better answer when there is
            // something real that will play: the sample is honest about being a sample (the
            // publisher's card says so in as many words), and it beats a dead end.
            return samplesFor(capability) || [];
        } catch (_) {
            // A search that could not run is a different fact from one that found nothing —
            // but the person asking does not care, and a sample is still better than nothing.
            return samplesFor(capability);
        }
    }

    /** The keyless samples for a capability, or `null` when there are none. */
    function samplesFor(capability) {
        const samples = pick('NEXUS_DISCOVERY_SAMPLES');
        if (!samples || typeof samples.forCapability !== 'function') {
            return null;
        }
        try {
            const fallback = samples.forCapability(capability) || [];
            return fallback.length ? fallback : null;
        } catch (_) {
            return null;
        }
    }

    /**
     * Put it in the chat **and start it**.
     *
     * The `play: true` was missing, and it is the whole bug behind this exchange:
     *
     *     YOU    execute relaxation music, choose the best one, I want to listen
     *     NEXUS  I'll put on some calming music for you.
     *     NEXUS  I found “10 Hours of Relaxing Music…” — tap it to play
     *
     * Every layer above this did its job. The model understood, chose search terms, emitted
     * the directive; the directive reached `fulfil`; `fulfil` searched and picked one and
     * called this. And the function named `play` published a card and stopped, because the
     * publisher only starts playback when told to and nothing told it. So the one function in
     * the app whose name is the verb was the one place the verb was not carried out.
     *
     * The session is told first, so anything reading state during the same tick — the prompt
     * among them — sees `loading` rather than a stale `selected`.
     */
    function play(result, source) {
        const publisher = pick('NEXUS_CONVERSATION_PUBLISHER');
        if (!publisher || typeof publisher.publish !== 'function') {
            return null;
        }
        // Two guards, not one. Sharing a `try` would let a broken session take the card down
        // with it, and the card is the point — knowing what is playing is bookkeeping.
        try {
            const session = pick('NEXUS_MEDIA_SESSION');
            if (session && typeof session.requestPlay === 'function') {
                session.requestPlay(result, { source });
            }
        } catch (_) {
            // Recorded or not, it still plays.
        }
        try {
            return publisher.publish(result, { source, play: true }) || null;
        } catch (_) {
            return null;
        }
    }

    const api = { WHY, CAPABILITY, fulfil, search, play, samplesFor };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (global) {
        global.NEXUS_MEDIA_INTENT = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
