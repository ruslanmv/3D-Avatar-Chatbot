/**
 * Reading `<ambience>` out of a reply, and never showing it (batch A10).
 *
 * The capability (A8) tells her she can change where you both are by writing a tag. This is the
 * half that makes the tag do something, and the half that makes sure nobody ever sees it:
 *
 *     Let's go somewhere quiet by the water. <ambience intent="sea" mood="relax"/>
 *              ↓ displayed and spoken                  ↓ executed, never displayed
 *     "Let's go somewhere quiet by the water."         requestByIntent({intent:'sea', …})
 *
 * `PlayDirective` established the shape and the three rules, each of which is a failure that
 * would otherwise happen; they apply here unchanged:
 *
 * **Strip before display *and* before speech.** Those are separate code paths in this app, so
 * "strip it" has to mean both or it means neither. In practice both are downstream of one
 * `displayText` seam in `main.js`, which is where A11 calls `consume`.
 *
 * **At most one per reply.** A reply emitting three would start three scene changes, and the last
 * would win after two flashes of somewhere else. An instruction is not a guarantee, so the
 * guarantee lives here.
 *
 * **Only from the model.** `consume` is called on assistant replies and nowhere else. A user who
 * types the tag gets it treated as text, because a chat message is not a capability.
 *
 * ## Why this tag carries no text, unlike `<play>`
 *
 * `<play>` needs a free-text search query, so it has a body and an `ORPHAN` pattern to stop an
 * unclosed tag swallowing the rest of the reply into a search. An ambience request needs two
 * enumerated words and nothing else, so a body here would be pure attack surface. Attributes
 * only, both values checked against a vocabulary.
 *
 * ## Matching and accepting are deliberately separate steps
 *
 * `<ambience intent="sea" url="http://elsewhere/x.webp"/>` **matches** the tag — so it is stripped
 * from the bubble and from the voice — and is then **rejected**, so it never executes. A grammar
 * that simply failed to match it would leave that line visible in the chat and read aloud. The
 * only safe shape is: recognise generously, accept strictly.
 *
 * ## The gate is re-read here, at execution time
 *
 * Ambience on, "take me to the forest", request in flight, user turns ambience off, reply arrives
 * carrying a directive. It must not run. A permission captured when the prompt was built is a
 * permission the user can no longer withdraw.
 *
 * Exposes: window.NEXUS_SCENE_AMBIENCE_DIRECTIVE
 */
(function (global) {
    'use strict';

    /**
     * Deliberately tolerant about shape, strict about content.
     *
     * Models vary the quoting, the spacing, the attribute order and whether they self-close or
     * write a separate closing tag — none of which changes the intent. Up to three attributes are
     * matched rather than two, so that a tag carrying a *fourth* unexpected one still matches and
     * is therefore still stripped from what the user sees.
     */
    const TAG = /<ambience((?:\s+[a-zA-Z_-]+\s*=\s*["'][^"'<>]{0,48}["']){0,3})\s*\/?>(?:\s*<\/ambience\s*>)?/i;

    /**
     * The same tag, but written with a body: `<ambience intent="sea">anything</ambience>`.
     *
     * No legitimate reply has one — the tag carries attributes only. But a model that writes a
     * body puts whatever it invented (a URL, in the case that found this) *between* the tags,
     * where `TAG` alone would strip the opening tag and leave the invention and a stray closing
     * tag on screen. Matched before `TAG` so the whole element goes at once, and the attribute
     * group stays in the same position so one reader handles both shapes.
     */
    const TAG_WITH_BODY =
        /<ambience((?:\s+[a-zA-Z_-]+\s*=\s*["'][^"'<>]{0,48}["']){0,3})\s*>[\s\S]{0,400}?<\/ambience\s*>/i;

    /** A closing tag with nothing to close. Never meaningful, never shown. */
    const STRAY_CLOSE = /<\/ambience\s*>/gi;

    /** A tag left unclosed by a truncated reply. Removed from display, never executed. */
    const ORPHAN = /<ambience(?:\s[^>]{0,160})?$/i;

    /**
     * The tag with its angle brackets missing, which models really do produce:
     *
     *     ambience intent="sea" mood="relax"
     *
     * Not executable — but it must never be *displayed* either, or the answer to "take me to the
     * sea" is a line of broken markup. `PlayDirective.BARE` exists for the same reason.
     */
    const BARE = /(?:^|\n)[ \t]*ambience\s+intent\s*=\s*["'][^"'\n]{0,48}["'][^\n]{0,80}/gi;

    /** Attribute name → value pairs inside the matched attribute string. */
    const ATTRIBUTE = /([a-zA-Z_-]+)\s*=\s*["']([^"']*)["']/g;

    /** The only two attributes that mean anything. Anything else rejects the directive. */
    const ALLOWED_ATTRIBUTES = Object.freeze(['intent', 'mood']);

    /** Values are words, not sentences, paths or URLs. */
    const VALUE = /^[a-z][a-z-]{0,23}$/;

    function resolver() {
        return (global && global.NEXUS_SCENE_AMBIENCE_RESOLVER) || null;
    }

    /**
     * Pull the attributes out of one matched tag.
     *
     * @returns {{intent:string, mood:string|null}|{reason:string}}
     */
    function readAttributes(raw) {
        const attributes = Object.create(null);
        ATTRIBUTE.lastIndex = 0;
        let match = ATTRIBUTE.exec(raw || '');
        while (match) {
            const name = match[1].toLowerCase();
            if (Object.prototype.hasOwnProperty.call(attributes, name)) {
                return { reason: `"${name}" given twice` };
            }
            attributes[name] = match[2];
            match = ATTRIBUTE.exec(raw || '');
        }

        for (const name of Object.keys(attributes)) {
            if (ALLOWED_ATTRIBUTES.indexOf(name) === -1) {
                // The important rejection. A model writing url=, src=, href= or style= has either
                // misunderstood the contract or is repeating something it should not; either way
                // the directive does not run, and the *whole* tag is still stripped from view.
                return { reason: `unknown attribute "${name}"` };
            }
        }

        const intent = typeof attributes.intent === 'string' ? attributes.intent.trim().toLowerCase() : '';
        if (!intent) return { reason: 'no intent' };
        if (!VALUE.test(intent)) return { reason: `intent "${attributes.intent}" is not a word` };

        let mood = null;
        if (attributes.mood !== undefined) {
            const candidate = String(attributes.mood).trim().toLowerCase();
            // A bad mood is dropped rather than rejecting the whole request: the intent is the
            // part that was asked for, and "somewhere by the sea" is still actionable without a
            // mood. An unknown *attribute* is different — that is a contract violation.
            if (VALUE.test(candidate)) mood = candidate;
        }

        return { intent, mood };
    }

    /** Remove every trace of the tag, in all three of its spellings. */
    function scrub(text) {
        let clean = String(text == null ? '' : text);
        while (TAG_WITH_BODY.test(clean)) clean = clean.replace(TAG_WITH_BODY, ' ');
        while (TAG.test(clean)) clean = clean.replace(TAG, ' ');
        return clean
            .replace(STRAY_CLOSE, ' ')
            .replace(ORPHAN, '')
            .replace(BARE, ' ')
            .replace(/[ \t]{2,}/g, ' ')
            .replace(/[ \t]+\n/g, '\n')
            .trim();
    }

    /**
     * Split a reply into what to show and what to run.
     *
     * @param {string} text an assistant reply
     * @returns {{clean:string, directive:{intent:string,mood:string|null}|null, extra:number,
     *            rejected:string|null}}
     */
    function extract(text) {
        const source = String(text == null ? '' : text);
        // The bodied form is checked first so that its attributes, not a later self-closing
        // tag's, are the ones acted on — the first tag in the reply wins either way.
        const bodied = source.match(TAG_WITH_BODY);
        const plain = source.match(TAG);
        let match = plain;
        if (bodied && (!plain || source.indexOf(bodied[0]) <= source.indexOf(plain[0]))) {
            match = bodied;
        }
        if (!match) {
            return { clean: scrub(source), directive: null, extra: 0, rejected: null };
        }

        const read = readAttributes(match[1]);
        const clean = scrub(source);

        // Everything after the first tag is stripped too, so a second directive can be neither
        // displayed nor run. One request, one scene change.
        let extra = 0;
        let rest = source.replace(match[0], ' ');
        while (TAG_WITH_BODY.test(rest) || TAG.test(rest)) {
            rest = TAG_WITH_BODY.test(rest) ? rest.replace(TAG_WITH_BODY, ' ') : rest.replace(TAG, ' ');
            extra += 1;
        }

        if (read.reason) {
            return { clean, directive: null, extra, rejected: read.reason };
        }
        return { clean, directive: { intent: read.intent, mood: read.mood }, extra, rejected: null };
    }

    /** Whether a reply carries one at all — cheap, for a caller that wants to branch first. */
    function has(text) {
        const source = String(text == null ? '' : text);
        return TAG.test(source) || TAG_WITH_BODY.test(source);
    }

    /**
     * Extract, then run it. Returns the text to display.
     *
     * The change is deliberately not awaited: her sentence should appear the moment she says it,
     * not after a texture has downloaded. A scene that fails to load leaves the sentence
     * standing, which is the right outcome — she said "let's go somewhere by the sea", not "we
     * are at the sea", precisely so that this case reads as true.
     *
     * @param {string} text
     * @param {object} [options] `{ controller, switch: switchModule }`; globals are the fallback,
     *   which is what lets this ship before A9 exists.
     */
    function consume(text, options) {
        const opts = options || {};
        const extracted = extract(text);

        if (extracted.rejected) {
            console.warn(`[SceneAmbience] directive refused: ${extracted.rejected}`);
            return extracted.clean;
        }
        if (!extracted.directive) {
            return extracted.clean;
        }

        const sw = opts.switch || (global && global.NEXUS_SCENE_AMBIENCE_SWITCH) || null;
        // Re-read now, not when the prompt was built. Between those two moments the user may have
        // turned the capability off, and a stale reply must not be able to act on a permission
        // that has since been withdrawn.
        if (!sw || typeof sw.isEnabled !== 'function' || !sw.isEnabled()) {
            console.warn('[SceneAmbience] a scene change was requested while ambience is off — refused');
            return extracted.clean;
        }

        const controller = opts.controller || (global && global.NEXUS_SCENE_AMBIENCE_CONTROLLER) || null;
        if (!controller || typeof controller.requestByIntent !== 'function') {
            console.warn('[SceneAmbience] nothing can apply a scene change right now');
            return extracted.clean;
        }

        try {
            Promise.resolve(
                controller.requestByIntent({
                    intent: extracted.directive.intent,
                    mood: extracted.directive.mood,
                    source: 'model',
                })
            ).catch(() => null);
        } catch (_) {
            // A directive that cannot run must not take the reply down with it. She said
            // something true; the scenery simply did not change.
        }

        return extracted.clean;
    }

    /**
     * Whether a word is one the resolver could act on. Not used by the parser — an unknown intent
     * is the resolver's to decline, and duplicating its vocabulary here would be a second place
     * to keep in step. Exposed for A8 and for tests.
     */
    function isKnownIntent(word) {
        const r = resolver();
        return Boolean(r && typeof r.canonicalIntent === 'function' && r.canonicalIntent(word));
    }

    const api = {
        TAG,
        TAG_WITH_BODY,
        STRAY_CLOSE,
        ORPHAN,
        BARE,
        ALLOWED_ATTRIBUTES,
        VALUE,
        extract,
        has,
        consume,
        scrub,
        isKnownIntent,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (global) {
        global.NEXUS_SCENE_AMBIENCE_DIRECTIVE = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
