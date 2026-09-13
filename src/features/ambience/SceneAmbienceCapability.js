/**
 * Telling her she can change where you both are (batch A8).
 *
 * The transcript this exists to change:
 *
 *     YOU    I want to relax by the sea
 *     NEXUS  That sounds lovely. Picture the waves for a moment…
 *
 * She was right to answer that way. Nothing in her prompt had ever mentioned that this app can
 * put a beach behind her, so describing one was the only thing available. `TogetherCapability`
 * fixed the same shape of problem for music; this is that paragraph for scenery.
 *
 * ## Empty is the common case, and it must be byte-identical
 *
 * `systemPromptSuffix()` returns `''` unless the user has turned ambience on AND there is
 * something to offer. A chat with the feature off sends exactly the prompt it sent before this
 * file existed — not a heading with "no scenes" under it, nothing at all.
 *
 * ## It advertises what exists, not what was designed
 *
 * The resolver knows fourteen intents. The shipped starter art is ocean, lake, garden, terrace
 * and sky — no forest — so a prompt listing all fourteen would have her offer to take somebody
 * to a forest and then quietly decline. The vocabulary is therefore computed from the catalogue
 * every time, via `Resolver.satisfiableIntents()`. `TogetherCapability.canSearch()` refuses to
 * describe a capability that cannot run for exactly this reason, and an empty list here means an
 * empty suffix.
 *
 * ## Why the wording is the way it is
 *
 * *Do not ask whether they would like you to* — they already asked. Every extra turn is a chance
 * to lose the thread, and "would you like me to change the background?" after "take me to the
 * sea" reads as not listening.
 *
 * *Talking about a place is not asking to be in one* — "I went to the beach last summer" is
 * conversation. Without this the feature redecorates during reminiscence, which is the single
 * most annoying way it could fail.
 *
 * *Say it as somewhere you are going* — loading can fail and a scene can be missing. "We're at
 * the beach now" becomes a lie the UI then contradicts; "let's go somewhere by the sea" stays
 * true either way.
 *
 * *Never write a URL, a file name or a scene name* — she has not seen the catalogue. A name she
 * invents is a guess that reads as a fact, and the parser rejects the attribute anyway.
 *
 * Exposes: window.NEXUS_SCENE_AMBIENCE_CAPABILITY
 */
(function (global) {
    'use strict';

    /** The tag she writes. Matches what A10 parses; the parser is the authority on the grammar. */
    const OPEN = '<ambience';

    function switchModule() {
        return (global && global.NEXUS_SCENE_AMBIENCE_SWITCH) || null;
    }

    function resolverModule() {
        return (global && global.NEXUS_SCENE_AMBIENCE_RESOLVER) || null;
    }

    function catalogModule() {
        return (global && global.NEXUS_VIEWPORT_BACKGROUND_CATALOG) || null;
    }

    /**
     * The intents this catalogue can actually answer right now.
     *
     * Empty means there is nothing to promise — no art has loaded, or none of it matches any
     * word she could use — and the suffix is then empty too.
     */
    function availableIntents(deps) {
        const d = deps || {};
        const resolver = d.resolver || resolverModule();
        const catalog = d.catalog || catalogModule();
        if (!resolver || typeof resolver.satisfiableIntents !== 'function') return [];
        if (!catalog || typeof catalog.images !== 'function') return [];
        try {
            const intents = resolver.satisfiableIntents(catalog.images());
            return Array.isArray(intents) ? intents : [];
        } catch (_) {
            // A catalogue that throws is a catalogue that cannot offer anything.
            return [];
        }
    }

    /** The moods worth mentioning. Fixed, unlike intents: a mood needs no art of its own. */
    function availableMoods(deps) {
        const resolver = (deps && deps.resolver) || resolverModule();
        const moods = resolver && Array.isArray(resolver.MOODS) ? resolver.MOODS : [];
        return moods.slice();
    }

    /**
     * Whether anything could happen if she asked for it. Checked separately from the switch so
     * that "the user said no" and "there is nothing to show" stay distinguishable in a log.
     */
    function canChangeAmbience(deps) {
        return availableIntents(deps).length > 0;
    }

    /**
     * Build the paragraph. Exposed so a test can read it without going through the switch.
     *
     * @param {string[]} intents the words she may use — the caller has already filtered them
     * @param {string[]} moods
     * @param {string|null} currentLabel the scene showing now, so "somewhere brighter" works
     */
    function instruction(intents, moods, currentLabel) {
        const lines = [
            '',
            'WHERE YOU BOTH ARE',
            'You can change the surroundings you and the person share. When they ask to go',
            'somewhere, to be somewhere, or to change where they are — or when they ask for',
            'something that plainly needs a different setting, like somewhere quiet to study or',
            'somewhere peaceful to meditate — change it. Write, on its own line:',
            `  ${OPEN} intent="sea" mood="relax"/>`,
            '',
            `intent is one of: ${intents.join(', ')}`,
        ];
        if (moods.length) {
            lines.push(`mood is optional, one of: ${moods.join(', ')}`);
        }
        lines.push(
            '',
            'Say one short sentence first, then the tag. Do not ask whether they would like you',
            'to — they already asked. Write at most one tag per reply.',
            '',
            '  "Let\'s go somewhere quiet by the water."',
            `  ${OPEN} intent="sea" mood="relax"/>`,
            '',
            'Talking about a place is not asking to be in one. "I went to the beach last summer",',
            '"I love forests", "tell me about rivers" — these are conversation, not requests. Do',
            'not change anything. Nor for a passing feeling: "I\'m tired", "that was stressful",',
            '"I\'m sad" are not requests to move.',
            '',
            'Say it as somewhere you are going, not somewhere you have arrived — "let\'s go',
            'somewhere by the sea", not "we\'re at the beach now". The app picks from the places it',
            'actually has, and it may take a moment or find nothing suitable.',
            '',
            'Never write a URL, a file name, a scene name or an ID. You do not know what places',
            'exist; the app chooses. A name you invent is a guess that reads as a fact.'
        );
        if (currentLabel) {
            lines.push('', `Right now you are both at: ${currentLabel}`);
        }
        return lines.join('\n');
    }

    /** The label of the scene showing now, or null. Never a path, never an id. */
    function currentSceneLabel(deps) {
        const d = deps || {};
        const catalog = d.catalog || catalogModule();
        const viewer = d.viewer || (global && global.NEXUS_VIEWER) || null;
        try {
            const key = d.currentId || (viewer && viewer.getVisualState && viewer.getVisualState().background);
            if (!key || !catalog || typeof catalog.get !== 'function') return null;
            const entry = catalog.get(key);
            // Only a scene is worth naming. "Right now you are both at: Black" is noise.
            if (!entry || entry.type !== 'image') return null;
            return entry.variantLabel ? `${entry.label} — ${entry.variantLabel}` : entry.label;
        } catch (_) {
            return null;
        }
    }

    /**
     * The paragraph to append, or `''`.
     *
     * `''` in three cases, each one a case where the promise would be false: the user has not
     * turned ambience on, the switch module is missing, or the catalogue can answer nothing.
     */
    function systemPromptSuffix(deps) {
        const d = deps || {};
        const sw = d.switch || switchModule();
        if (!sw || typeof sw.isEnabled !== 'function' || !sw.isEnabled()) {
            return '';
        }
        const intents = availableIntents(d);
        if (!intents.length) {
            return '';
        }
        return `\n${instruction(intents, availableMoods(d), currentSceneLabel(d))}\n`;
    }

    const api = {
        OPEN,
        availableIntents,
        availableMoods,
        canChangeAmbience,
        currentSceneLabel,
        instruction,
        systemPromptSuffix,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (global) {
        global.NEXUS_SCENE_AMBIENCE_CAPABILITY = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
