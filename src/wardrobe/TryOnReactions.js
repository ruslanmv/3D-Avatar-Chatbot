/**
 * LT1. A word from her when a look is ready — short, now and then, and gone again.
 *
 * Without this, live Try-On is a person operating an avatar-management panel. With one line
 * after a reveal — "The black top changes the whole look." — and two or three things to tap
 * ("Show me the back", "Try another colour", "Keep this"), it is a haul done *with* her.
 * The register is the point, so the rules are about restraint:
 *
 * - **Not after every click.** A look made for her always gets a line (she just watched it
 *   being made). A look from the shelf gets one when it changes the mood — casual to dressy
 *   — or every third wear otherwise. Compare, Undo and Show Mode never do: they are the
 *   person looking, not her changing.
 * - **One line, not a paragraph**, and never a question she cannot act on: every line comes
 *   with the actions it suggests, and those are ids the view already knows.
 * - **Ephemeral.** A reaction lives in Try-On for a few seconds. It is not a chat message, it
 *   never reaches the transcript or the prompt, and so `ConversationReset` has nothing of
 *   Try-On's to forget.
 *
 * Pure: `react()` takes what happened and a random source and returns {line, actions} or
 * null, so the frequency rules are tests rather than hopes.
 *
 * Exposes: window.NEXUS_TRY_ON_REACTIONS
 */
(function (global) {
    'use strict';

    var SHOW_FOR_MS = 6000;
    var EVERY = 3; // a shelf look gets a line every third wear, mood changes aside

    var ACTIONS = Object.freeze({
        turn: { id: 'turn', label: 'Show me the back' },
        color: { id: 'color', label: 'Try another colour' },
        keep: { id: 'keep', label: 'Keep this' },
        save: { id: 'favorite', label: '♡ Save' },
        compare: { id: 'compare', label: 'Compare' },
    });

    var DRESSY = /\b(evening|party|formal|cocktail|gown|dressy|satin|midi|bodycon)\b/;
    var CASUAL = /\b(casual|denim|jeans|tee|day|shorts|cardigan|hoodie)\b/;

    /** 'dressy' | 'casual' | null, from a look's tags, recipe and name. */
    function mood(look) {
        if (!look) return null;
        var text = []
            .concat(look.tags || [])
            .concat([look.prompt || (look.provenance && look.provenance.prompt) || '', look.name || ''])
            .join(' ')
            .toLowerCase();
        if (DRESSY.test(text)) return 'dressy';
        if (CASUAL.test(text)) return 'casual';
        return null;
    }

    function pick(lines, random) {
        return lines[Math.min(lines.length - 1, Math.floor((random || Math.random)() * lines.length))];
    }

    /**
     * OD2. Whether a look is one of the private ones — lingerie, swimwear, sheer, stockings, or
     * any look with a tattoo. Forge's rating, the dictionary's `private`, or the view's own flag.
     */
    function isPrivate(look) {
        return Boolean(
            look && (look.private === true || look.rating === 'private' || (look.bodyArt && look.bodyArt.length))
        );
    }

    /**
     * OD2. Her lines for a private look. The hosted haul (W17) keeps private looks out of the
     * chat on purpose, so this one ephemeral line was the *only* thing she said to lingerie —
     * and it was the line she says to a cardigan. Private mode's loop is the person choosing,
     * her answering at once, and something to see next (docs/PRIVATE_LIVE_SCENE.md §14), so a
     * private look always gets a line, "Show me the back" leads the actions, and the register
     * is that doc's: warm and teasing, never explicit, and nothing she would not say aloud.
     */
    var PRIVATE_LINES = Object.freeze({
        made: ['Okay… this one’s just for you.', 'A little daring. Do you like it?', 'Well? Say something.'],
        shelf: ['This one again? I knew it.', 'Just between us, right?', 'You have good taste.'],
        tattoo: ['Do you like where I put it?', 'Ink suits me, right?', 'Our little secret.'],
    });

    var SLOT_WORDS = {
        top: 'top',
        bottom: 'bottoms',
        dress: 'dress',
        outer: 'layer',
        legwear: 'stockings',
        set: 'set',
    };

    /**
     * What she says, if anything.
     *
     * event: {look, previous, cause ('wear' | 'play' | 'undo' | 'compare' | 'compare-end'),
     *         generated (made for her just now), change ({slot} for a "change X"), wears (count)}
     */
    function react(event, random) {
        event = event || {};
        var look = event.look;
        if (!look || look.original) return null;
        if (event.cause && event.cause !== 'wear') return null;

        if (isPrivate(look)) {
            var tattoo = Boolean(event.generated && look.bodyArt && look.bodyArt.length);
            var lines = tattoo ? PRIVATE_LINES.tattoo : event.generated ? PRIVATE_LINES.made : PRIVATE_LINES.shelf;
            return { line: pick(lines, random), actions: [ACTIONS.turn, ACTIONS.save, ACTIONS.keep] };
        }

        if (event.generated) {
            var slot = event.change && event.change.slot;
            if (slot && SLOT_WORDS[slot]) {
                var word = SLOT_WORDS[slot];
                return {
                    line: pick(
                        [
                            'The new ' + word + ' changes the whole look.',
                            'Same everything else, new ' + word + '. Better?',
                            'Oh, I like this ' + word + '.',
                        ],
                        random
                    ),
                    actions: [ACTIONS.compare, ACTIONS.color, ACTIONS.keep],
                };
            }
            return {
                line: pick(['Made just for me — what do you think?', 'Fresh off the rail!', 'Ooh, new.'], random),
                actions: [ACTIONS.turn, ACTIONS.save, ACTIONS.keep],
            };
        }

        var now = mood(look);
        var before = mood(event.previous);
        if (now && before && now !== before) {
            return {
                line:
                    now === 'casual'
                        ? pick(['This one feels much more casual.', 'Much more relaxed.'], random)
                        : pick(['Now this is dressed up.', 'Ooh, going somewhere?'], random),
                actions: [ACTIONS.turn, ACTIONS.save],
            };
        }
        if ((event.wears || 0) % EVERY !== 0) return null;
        return {
            line: pick(['Want to see the back?', 'I like this one.', 'This suits me, right?'], random),
            actions: [ACTIONS.turn, ACTIONS.save, ACTIONS.keep],
        };
    }

    var api = {
        react: react,
        mood: mood,
        isPrivate: isPrivate,
        ACTIONS: ACTIONS,
        PRIVATE_LINES: PRIVATE_LINES,
        SHOW_FOR_MS: SHOW_FOR_MS,
        EVERY: EVERY,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_TRY_ON_REACTIONS = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
