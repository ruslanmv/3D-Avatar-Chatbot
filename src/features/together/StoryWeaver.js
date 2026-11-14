/**
 * UN3. Una Notte — a different evening every time someone enters Private.
 *
 * Private used to open the same way each time: the same room, the same opening register, the
 * model improvising from the persona alone. Ten evenings read as one evening ten times. This
 * module deals each session an *outline* — where she is, what brought her there tonight, her
 * mood, a place it might lead to, the outfit theme and the shape of the night — and the model
 * writes every line live from it, in the person's language, through the existing Private
 * persona. Nothing here is dialogue, and nothing here does anything: it is a pure choice.
 *
 * ## What it guarantees
 *
 * - **Only places that exist.** The opening and the destination come from the places this
 *   device can actually show (the caller passes `VRWorlds.placesFor` output). A place that is
 *   not in that list is never named, so she can never invite somebody somewhere the renderer
 *   cannot take them.
 * - **The room she is in wins.** When the session already shows a world (the person chose it
 *   on Private's setup screen), that is the opening; the outline adapts to it rather than
 *   moving anybody.
 * - **Different, not just shuffled.** Each outline has a fingerprint (venue, hook, mood,
 *   destination, outfit theme, arc). Recent fingerprints are remembered — at most `HISTORY_MAX`
 *   — and the outline chosen is the one *least like* them, so a new evening differs in what
 *   moves it (the hook and the arc), not only in which room it starts in. When every
 *   combination has been seen, the least similar is used; it never retries forever.
 * - **Metadata, never content.** A fingerprint is six catalogue ids. No line of the evening,
 *   nothing the person said and nothing explicit is stored. `forget()` erases them;
 *   `ConversationReset` lists the key as kept (between-evenings memory, like the study history)
 *   and the Private setup offers the forgetting. Storage that refuses (private browsing) simply
 *   means every evening is chosen without memory.
 *
 * Exposes: window.NEXUS_STORY_WEAVER
 */
(function (global) {
    'use strict';

    const KEY = 'nexus_private_story_history';
    const HISTORY_MAX = 10;
    const CANDIDATES = 48;

    /** Why she is where she is tonight. A motivation, not a script: the model writes the words. */
    const HOOKS = Object.freeze({
        'last-song': 'the last song of the night is about to play and she wanted to share it with them',
        celebration: 'she is celebrating something small and personal and wants company for it',
        'favorite-view': 'there is a view or a corner here she loves and wants to show them',
        'playful-challenge': 'she has a playful little challenge or bet in mind for the evening',
        'meaningful-talk': 'she has been wanting a real, unhurried conversation with them',
        invitation: 'she came hoping they would explore somewhere new with her tonight',
        'atmosphere-shift': 'the evening has just turned — the light, the music, the crowd — and she feels it',
    });

    /** How she carries herself tonight, on top of the persona and the pace. */
    const MOODS = Object.freeze({
        playful: 'playful and teasing',
        shy: 'a little shy at first, warming up slowly',
        confident: 'confident and direct',
        tender: 'tender and attentive',
        nostalgic: 'nostalgic, in a mood for memories',
        adventurous: 'adventurous, up for something unexpected',
    });

    /** The shape of the night. Again a direction, never a sequence she must follow. */
    const ARCS = Object.freeze({
        'unexpected-invitation': 'an invitation neither of them planned',
        'slow-burn': 'a slow evening where nothing is rushed',
        reunion: 'it feels like meeting again after a long time',
        'secret-place': 'she knows a place nobody else does',
        'dance-first': 'it begins with music and moving together',
        'quiet-escape': 'both of them wanting to escape the noise',
    });

    /** The outfit's spirit, matched against her saved looks by the wardrobe, never forced. */
    const OUTFIT_THEMES = Object.freeze({
        'evening-black': 'an elegant black evening look',
        'red-night': 'something red for a night out',
        'soft-champagne': 'soft champagne and ivory tones',
        'club-mini': 'a short going-out look',
        'satin-slip': 'satin, simple and close-fitting',
    });

    /** Where an evening can begin, by the catalogue's own words for a place. */
    function isOpening(place) {
        const c = String((place && place.category) || '').toLowerCase();
        return c === 'nightlife' || c === 'private' || /cabaret|discoteca|club|rooftop|street/.test(place.id);
    }

    /** Where it can lead: a quieter room. */
    function isDestination(place) {
        const c = String((place && place.category) || '').toLowerCase();
        return place && (place.rating === 'romantic' || (place.rating === 'private' && c === 'private'));
    }

    function fingerprintOf(o) {
        return {
            openingVenue: o.openingVenue,
            narrativeHook: o.narrativeHook,
            characterMood: o.characterMood,
            destination: o.destination,
            outfitTheme: o.outfitTheme,
            storyArc: o.storyArc,
        };
    }

    const FIELDS = ['openingVenue', 'narrativeHook', 'characterMood', 'destination', 'outfitTheme', 'storyArc'];
    /** The fields that change what an evening is *about* count twice. */
    const WEIGHT = { narrativeHook: 2, storyArc: 2, characterMood: 1, openingVenue: 1, destination: 1, outfitTheme: 1 };

    /** How alike two fingerprints are, 0 (nothing shared) to 8 (identical). Pure. */
    function similarity(a, b) {
        if (!a || !b) return 0;
        return FIELDS.reduce((n, f) => n + (a[f] === b[f] ? WEIGHT[f] : 0), 0);
    }

    function pick(list, rng) {
        return list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
    }

    /**
     * Deal one outline. Pure: the places, the history and the random source are all given.
     *
     * @param {object} o
     * @param {object[]} o.places   `VRWorlds.placesFor` entries this device can show ({id, world, title, rating, category})
     * @param {string|null} [o.current]  the place shown right now (its catalogue id), which wins as the opening
     * @param {object[]} [o.history]     recent fingerprints, newest last
     * @param {function} [o.rng]         () => [0, 1)
     * @returns {object} `{id, openingVenue, openingTitle, narrativeHook, characterMood, destination,
     *                    destinationTitle, outfitTheme, storyArc, fingerprint}`
     */
    function weave(o) {
        const opts = o || {};
        const rng = typeof opts.rng === 'function' ? opts.rng : Math.random;
        const places = (Array.isArray(opts.places) ? opts.places : []).filter((p) => p && p.id);
        const history = (Array.isArray(opts.history) ? opts.history : []).slice(-HISTORY_MAX);
        const here = opts.current ? places.find((p) => p.id === opts.current || p.world === opts.current) : null;
        const openings = here ? [here] : places.filter(isOpening);
        const hooks = Object.keys(HOOKS);
        const moods = Object.keys(MOODS);
        const arcs = Object.keys(ARCS);
        const themes = Object.keys(OUTFIT_THEMES);

        let best = null;
        let bestScore = Infinity;
        for (let i = 0; i < CANDIDATES; i += 1) {
            const opening = openings.length ? pick(openings, rng) : null;
            const ways = places.filter((p) => isDestination(p) && (!opening || p.id !== opening.id));
            const destination = ways.length ? pick(ways, rng) : null;
            const outline = {
                openingVenue: opening ? opening.id : 'here',
                narrativeHook: pick(hooks, rng),
                characterMood: pick(moods, rng),
                destination: destination ? destination.id : null,
                outfitTheme: pick(themes, rng),
                storyArc: pick(arcs, rng),
            };
            // The closest it comes to any recent evening — the one evening it most resembles.
            const score = history.reduce((m, h) => Math.max(m, similarity(outline, h)), 0);
            if (score < bestScore) {
                best = { outline, opening, destination };
                bestScore = score;
                if (score === 0) break;
            }
        }
        const { outline, opening, destination } = best;
        return {
            id: `story-${Date.now().toString(36)}-${Math.floor(rng() * 1e6).toString(36)}`,
            ...outline,
            openingTitle: opening ? String(opening.title || opening.id) : null,
            destinationTitle: destination ? String(destination.title || destination.id) : null,
            destinationWorld: destination ? destination.world || destination.id : null,
            fingerprint: fingerprintOf(outline),
            similarity: bestScore,
        };
    }

    // ------------------------------------------------------------------ the memory between evenings
    function storage(g) {
        try {
            return (g || global).localStorage || null;
        } catch (_) {
            return null;
        }
    }

    const VALID = {
        narrativeHook: HOOKS,
        characterMood: MOODS,
        storyArc: ARCS,
        outfitTheme: OUTFIT_THEMES,
    };
    const PLACE = /^[a-z0-9-]{1,40}$/;

    /** A stored fingerprint is data: only known ids survive the read. */
    function clean(entry) {
        if (!entry || typeof entry !== 'object') return null;
        const out = {};
        for (const f of FIELDS) {
            const v = entry[f];
            if (VALID[f]) {
                if (!Object.prototype.hasOwnProperty.call(VALID[f], v)) return null;
            } else if (v !== null && !PLACE.test(String(v))) return null;
            out[f] = v === undefined ? null : v;
        }
        return out;
    }

    function history(g) {
        const store = storage(g);
        if (!store) return [];
        try {
            const raw = JSON.parse(store.getItem(KEY) || '[]');
            return (Array.isArray(raw) ? raw : []).map(clean).filter(Boolean).slice(-HISTORY_MAX);
        } catch (_) {
            return [];
        }
    }

    function remember(fingerprint, g) {
        const entry = clean(fingerprint);
        if (!entry) return false;
        const store = storage(g);
        if (!store) return false;
        try {
            const next = history(g).concat(entry).slice(-HISTORY_MAX);
            store.setItem(KEY, JSON.stringify(next));
            return true;
        } catch (_) {
            return false;
        }
    }

    /** "Forget my stories". */
    function forget(g) {
        const store = storage(g);
        if (!store) return false;
        try {
            store.removeItem(KEY);
            return true;
        } catch (_) {
            return false;
        }
    }

    const api = {
        KEY,
        HISTORY_MAX,
        HOOKS,
        MOODS,
        ARCS,
        OUTFIT_THEMES,
        weave,
        similarity,
        isOpening,
        isDestination,
        history,
        remember,
        forget,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_STORY_WEAVER = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
