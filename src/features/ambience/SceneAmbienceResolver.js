/**
 * Turning "I want to be by the sea" into a scene that actually exists (batch A3).
 *
 * The model says what kind of place the person asked for. It does **not** say which file to
 * load, which scene id to use, or what the catalogue contains — it has never seen the
 * catalogue, and a scene name it invented would be a guess that reads as a fact. So the
 * division is:
 *
 *     model  → semantic intent        ("sea", mood "relax")
 *     this   → a scene id that exists, or null
 *
 * That is what keeps asset paths out of model reasoning, keeps the prompt from growing with the
 * library, and lets the same request resolve to a flat image on desktop and a panorama in a
 * headset later without the model knowing either happened.
 *
 * ## Why scoring and not a second model call
 *
 * Asking an LLM to pick one of five images would be slower, non-deterministic, untestable, and
 * would put the catalogue in a prompt. A weighted match over `tags` and `category` is none of
 * those things. The weights encode the priority order the feature is specified with:
 *
 *     explicit request  >  mood  >  the user's saved preference  >  time of day  >  curation
 *
 * which is why an intent tag is worth more than everything else combined. A saved preference
 * must never be able to override what somebody just asked for.
 *
 * ## Why null is a real answer
 *
 * "Take me to Mars" has no answer in a catalogue of five calm places. Returning the
 * least-bad scene would move somebody somewhere they did not ask for, which is worse than not
 * moving them — so anything scoring below one solid intent match returns `null`, and the caller
 * says something natural instead. The threshold is the feature's honesty, not a tuning knob.
 *
 * Exposes: window.NEXUS_SCENE_AMBIENCE_RESOLVER
 */
(function (global) {
    'use strict';

    /**
     * The fourteen words the model is told it may use, each with the vocabulary a catalogue
     * entry might plausibly have been tagged with.
     *
     * One table, in one file. The alternative — matching spread through the application as
     * `if (intent === 'sea' || intent === 'ocean' || …)` — is how two code paths end up
     * disagreeing about whether "shore" is a beach.
     *
     * This is a *normalisation* layer, not the language understanding. The model has already
     * done that; these aliases catch the near-misses.
     */
    const ALIASES = Object.freeze({
        sea: ['sea', 'ocean', 'beach', 'coast', 'shore', 'seaside', 'waves', 'tropical'],
        forest: ['forest', 'woodland', 'woods', 'trees', 'jungle', 'green'],
        river: ['river', 'stream', 'creek', 'waterfall', 'brook'],
        lake: ['lake', 'pond', 'loch'],
        mountain: ['mountain', 'mountains', 'alpine', 'peak', 'summit'],
        garden: ['garden', 'zen', 'courtyard', 'bonsai'],
        sky: ['sky', 'clouds', 'stars', 'starlight', 'aurora', 'space', 'open'],
        rain: ['rain', 'rainy', 'storm', 'drizzle'],
        study: ['study', 'focus', 'work', 'concentrate', 'desk', 'library', 'reading'],
        cozy: ['cozy', 'cosy', 'warm', 'fireplace', 'campfire', 'fire', 'terrace'],
        night: ['night', 'evening', 'dark', 'moonlight', 'twilight', 'dusk'],
        fantasy: ['fantasy', 'dream', 'dreamy', 'magical', 'glowing', 'surreal'],
        meditation: ['meditation', 'meditate', 'calm', 'peaceful', 'still', 'quiet', 'zen'],
        relax: ['relax', 'relaxing', 'chill', 'unwind', 'rest', 'calm'],
    });

    const INTENTS = Object.freeze(Object.keys(ALIASES));

    /** What the model may put in `mood`. Narrower than intent, and optional. */
    const MOODS = Object.freeze(['relax', 'meditation', 'focus', 'sleep', 'cozy', 'dream']);

    /**
     * Settings dropdown value → the intent group it nudges towards.
     *
     * `auto` is absent on purpose: it means "no nudge", and an entry mapping it to something
     * would quietly make the default opinionated.
     */
    const PREFERENCES = Object.freeze({
        relax: ['relax', 'meditation'],
        nature: ['forest', 'river', 'lake', 'mountain', 'garden'],
        ocean: ['sea'],
        forest: ['forest', 'river'],
        study: ['study'],
        cozy: ['cozy'],
        night: ['night'],
        fantasy: ['fantasy'],
    });

    /**
     * Weights. The order matters more than the numbers: one intent tag (+10) must outrank every
     * other signal stacked together (4 + 3 + 1 + 0.5 = 8.5), so a direct request always wins.
     */
    const W = Object.freeze({
        INTENT_TAG: 10,
        INTENT_CATEGORY: 6,
        MOOD: 4,
        PREFERENCE: 3,
        TIME_OF_DAY: 1,
        FEATURED: 0.5,
    });

    /** Below one solid intent match there is no answer worth giving. */
    const THRESHOLD = W.INTENT_TAG;

    /** Reverse index, built once: any alias → its canonical intent. */
    const CANONICAL = (() => {
        const map = Object.create(null);
        for (const intent of INTENTS) {
            for (const alias of ALIASES[intent]) map[alias] = intent;
        }
        return map;
    })();

    /**
     * Canonicalise whatever the model wrote. Returns `null` for a word we do not know, which the
     * caller treats as "no intent" rather than guessing.
     */
    function canonicalIntent(raw) {
        if (typeof raw !== 'string') return null;
        const word = raw.trim().toLowerCase();
        if (!word) return null;
        return CANONICAL[word] || null;
    }

    function normalizeMood(raw) {
        if (typeof raw !== 'string') return null;
        const word = raw.trim().toLowerCase();
        return MOODS.indexOf(word) === -1 ? null : word;
    }

    /** Night between 19:00 and 06:00 local. Injected clock, so the signal is testable. */
    function isNightAt(now) {
        const date = now instanceof Date ? now : new Date(typeof now === 'number' ? now : Date.now());
        const hour = date.getHours();
        if (!Number.isFinite(hour)) return false;
        return hour >= 19 || hour < 6;
    }

    /** Every word we will match an entry on: its tags plus its category. */
    function vocabularyOf(entry) {
        const words = Array.isArray(entry.tags) ? entry.tags.slice() : [];
        if (entry.category) words.push(entry.category);
        return words;
    }

    function countMatches(words, aliases) {
        let hits = 0;
        for (const alias of aliases) {
            if (words.indexOf(alias) !== -1) hits += 1;
        }
        return hits;
    }

    /**
     * Score one entry. Exposed because a score nobody can inspect is a score nobody can debug,
     * and because the tests assert on the breakdown rather than only the winner.
     */
    function scoreEntry(entry, context) {
        if (!entry || typeof entry !== 'object') return { total: -1, why: ['not an entry'] };

        const tags = Array.isArray(entry.tags) ? entry.tags : [];
        const words = vocabularyOf(entry);
        const why = [];
        let total = 0;

        if (context.intent) {
            const aliases = ALIASES[context.intent] || [];
            const tagHits = countMatches(tags, aliases);
            if (tagHits) {
                total += tagHits * W.INTENT_TAG;
                why.push(`intent:${context.intent} matched ${tagHits} tag(s)`);
            }
            // Category is a weaker signal than a tag: "relax" as a category says what the scene
            // is *for*, while "sea" as a tag says what is in it.
            if (entry.category && aliases.indexOf(entry.category) !== -1) {
                total += W.INTENT_CATEGORY;
                why.push(`intent:${context.intent} matched category`);
            }
        }

        if (context.mood) {
            const moodAliases = ALIASES[context.mood] || [context.mood];
            if (countMatches(words, moodAliases)) {
                total += W.MOOD;
                why.push(`mood:${context.mood}`);
            }
        }

        // A nudge, never a gate. It is added to a candidate's score, so it can reorder equals
        // but can never make a requested scene unreachable.
        if (context.preferenceIntents && context.preferenceIntents.length) {
            for (const intent of context.preferenceIntents) {
                if (countMatches(words, ALIASES[intent] || [])) {
                    total += W.PREFERENCE;
                    why.push(`preference:${intent}`);
                    break; // one nudge per entry, not one per matching group
                }
            }
        }

        const entryIsNight = tags.indexOf('night') !== -1 || entry.category === 'sleep';
        if (entryIsNight === context.night) {
            total += W.TIME_OF_DAY;
            why.push(context.night ? 'night now' : 'daytime now');
        }

        if (entry.featured) {
            total += W.FEATURED;
            why.push('featured');
        }

        return { total, why };
    }

    /**
     * Pick a scene, or decline.
     *
     * @param {object} input
     * @param {string} input.intent       required; canonical or an alias
     * @param {string} [input.mood]
     * @param {string} [input.preference] the Settings dropdown value, or 'auto'
     * @param {Array}  input.entries      catalogue image entries; passed in, so this module has
     *                                    no catalogue dependency and is testable with fixtures
     * @param {Date|number} [input.now]   injected clock
     * @returns {string|null} a scene id that exists, or null meaning "do not change anything"
     */
    function resolve(input) {
        const opts = input || {};
        const entries = Array.isArray(opts.entries) ? opts.entries : [];
        if (!entries.length) return null;

        const intent = canonicalIntent(opts.intent);
        const mood = normalizeMood(opts.mood);

        // An unknown intent with a usable mood falls back to the mood, because "somewhere to
        // sleep" is still actionable. With neither, there is nothing to act on.
        const effectiveIntent = intent || (mood && ALIASES[mood] ? mood : null);
        if (!effectiveIntent) return null;

        const preference = typeof opts.preference === 'string' ? opts.preference.trim().toLowerCase() : 'auto';
        const context = {
            intent: effectiveIntent,
            mood,
            preferenceIntents: PREFERENCES[preference] || [],
            night: isNightAt(opts.now),
        };

        let best = null;
        for (const entry of entries) {
            if (!entry || typeof entry.id !== 'string') continue;
            const { total } = scoreEntry(entry, context);
            if (total < THRESHOLD) continue;
            // Ties break on id, ascending. Any deterministic rule would do; what matters is that
            // the same request twice gives the same scene, or the feature feels haunted.
            if (!best || total > best.total || (total === best.total && entry.id < best.id)) {
                best = { id: entry.id, total };
            }
        }

        return best ? best.id : null;
    }

    /**
     * The same ranking, all of it, for a Settings "why this scene?" view or a debug session.
     * Ordered best first; entries below the threshold are included with their scores so that
     * "nothing matched" is inspectable rather than mysterious.
     */
    function rank(input) {
        const opts = input || {};
        const entries = Array.isArray(opts.entries) ? opts.entries : [];
        const intent = canonicalIntent(opts.intent);
        const mood = normalizeMood(opts.mood);
        const effectiveIntent = intent || (mood && ALIASES[mood] ? mood : null);
        const preference = typeof opts.preference === 'string' ? opts.preference.trim().toLowerCase() : 'auto';
        const context = {
            intent: effectiveIntent,
            mood,
            preferenceIntents: PREFERENCES[preference] || [],
            night: isNightAt(opts.now),
        };
        return entries
            .filter((e) => e && typeof e.id === 'string')
            .map((entry) => {
                const { total, why } = scoreEntry(entry, context);
                return { id: entry.id, score: total, eligible: total >= THRESHOLD, why };
            })
            .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    }

    /**
     * Which of the fourteen intents this catalogue can actually satisfy.
     *
     * The starter set has no forest, so `intent="forest"` resolves to `null` — which is the
     * honest answer, but it means a prompt advertising all fourteen words promises places that
     * do not exist. `TogetherCapability.canSearch()` refuses to describe a capability that
     * cannot run for exactly this reason, and A8 should narrow its vocabulary with this rather
     * than hard-coding a list that drifts from the art.
     *
     * Deliberately ignores mood, preference and the clock: it answers "is there anything here
     * for this word at all", not "what would win right now".
     */
    function satisfiableIntents(entries) {
        const list = Array.isArray(entries) ? entries : [];
        if (!list.length) return [];
        return INTENTS.filter((intent) => resolve({ intent, entries: list, preference: 'auto' }) !== null);
    }

    const api = {
        ALIASES,
        INTENTS,
        MOODS,
        PREFERENCES,
        WEIGHTS: W,
        THRESHOLD,
        canonicalIntent,
        normalizeMood,
        isNightAt,
        scoreEntry,
        resolve,
        rank,
        satisfiableIntents,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (global) {
        global.NEXUS_SCENE_AMBIENCE_RESOLVER = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
