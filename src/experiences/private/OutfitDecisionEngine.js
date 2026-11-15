/**
 * PX4. Which outfit, for "something elegant" — chosen from what she actually has.
 *
 * Try-On answers a styling request by making a new look: the request goes to Forge, a job runs,
 * and a minute later there is a dress. That is right for a haul, where making looks is the
 * activity, and wrong in the middle of a conversation, where "put on something elegant" should
 * take about as long as it takes to say. Most of the time she already owns something that fits.
 *
 * So this is a pure chooser with one preference order:
 *
 *   1. a saved look named by the request — or, failing that, a dictionary set of that name
 *   2. a saved look that matches the style or colour asked  (no generation)
 *   3. for "you choose": a saved look she is not wearing, least recently worn first
 *   4. a dictionary set that matches — flagged `generate`, because it has to be made
 *
 * It never picks what she has on, never invents a name, and returns null when nothing fits —
 * the caller says so rather than dressing her in something unrelated.
 *
 * Scores are word matches against the look's own name and tags. No model is asked: a choice
 * made in a millisecond from data on the page cannot hallucinate a look that does not exist.
 *
 * Exposes: window.NEXUS_OUTFIT_DECISION_ENGINE
 */
(function (global) {
    'use strict';

    /** Words that make a look fit a style, in the vocabulary looks and dictionary sets use. */
    const STYLE_WORDS = Object.freeze({
        elegant: ['elegant', 'evening', 'gown', 'satin', 'silk', 'cocktail', 'heels', 'classy', 'black dress'],
        formal: ['formal', 'suit', 'blazer', 'office', 'pencil', 'blouse', 'trousers', 'shirt'],
        casual: ['casual', 'jeans', 'tee', 't-shirt', 'crop', 'hoodie', 'trousers', 'denim', 'everyday', 'shorts'],
        comfy: [
            'comfy',
            'cozy',
            'cosy',
            'hoodie',
            'sweat',
            'lounge',
            'oversized',
            'tee',
            'pyjama',
            'pajama',
            'knit',
            'jumper',
        ],
        // PX14. Words that only name underwear: "slip" matched a slip *dress*, and a request for
        // underwear was answered with an offer to make a satin dress.
        lingerie: ['lingerie', 'underwear', 'bra', 'panties', 'intimo', 'bodysuit', 'lace set', 'lace lingerie'],
        sexy: ['sexy', 'lingerie', 'lace', 'mini', 'bikini', 'stockings', 'sheer', 'bodycon', 'slip'],
        sporty: ['sport', 'sporty', 'gym', 'leggings', 'track', 'yoga', 'athletic', 'running'],
        cute: ['cute', 'sundress', 'skirt', 'pleated', 'bow', 'pastel', 'floral'],
        summer: ['summer', 'sundress', 'bikini', 'shorts', 'swim', 'beach', 'linen'],
        night: ['night', 'nightdress', 'pyjama', 'pajama', 'slip', 'sleep', 'robe'],
        party: ['party', 'sequin', 'mini', 'cocktail', 'evening', 'glitter', 'club'],
    });

    function keyOf(look) {
        return look ? String(look.lookId || look.id || look.vrmUrl || look.vrm_url || look.name || '') : '';
    }

    function textOf(item) {
        return [item && (item.name || item.title), item && item.id, item && item.outfitId, item && item.prompt]
            .concat((item && item.tags) || [])
            .concat(item && item.request ? [item.request.prompt] : [])
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
    }

    /** A word (or two-word phrase) as itself: "dress" is not in "sundress". */
    function has(text, phrase) {
        return ` ${text.replace(/[^\p{L}\p{N}]+/gu, ' ')} `.includes(` ${phrase} `);
    }

    function score(item, request) {
        const text = textOf(item);
        if (!text) return 0;
        let total = 0;
        if (request.style) for (const w of STYLE_WORDS[request.style] || []) if (has(text, w)) total += 2;
        if (request.style && has(text, request.style)) total += 2;
        if (request.colour && has(text, request.colour)) total += 3;
        // PX15. The garment they named, by its English name: the strongest single signal.
        if (request.garment && has(text, request.garment)) total += 4;
        return total;
    }

    /** A saved look by (part of) its name; exact beats partial. */
    function byName(name, looks) {
        const wanted = String(name || '')
            .trim()
            .toLowerCase();
        if (!wanted) return null;
        const exact = looks.find((l) => String(l.name || '').toLowerCase() === wanted);
        if (exact) return exact;
        return (
            looks.find((l) =>
                String(l.name || '')
                    .toLowerCase()
                    .includes(wanted)
            ) || null
        );
    }

    function best(items, request, skip) {
        let top = null;
        let topScore = 0;
        for (const item of items) {
            if (skip(item)) continue;
            const s = score(item, request);
            if (s > topScore) {
                top = item;
                topScore = s;
            }
        }
        return top ? { item: top, score: topScore } : null;
    }

    /**
     * @param {object} input
     * @param {object} input.request   `{ look, outfit, style, colour, choose, different }`
     * @param {object[]} input.looks   her saved looks (already filtered for who may see what)
     * @param {object[]} [input.entries]  dictionary sets (same filtering), each `{id, title, tags, request}`
     * @param {object}  [input.current]   the look she has on, or null for her own outfit
     * @param {boolean} [input.canCreate] a new look could be made right now
     * @param {string[]} [input.recent]   keys of looks worn this session, oldest first
     * @returns {{kind: 'look'|'outfit', look?: object, entry?: object, generate: boolean, reason: string}|null}
     */
    function choose(input) {
        const i = input || {};
        const request = i.request || {};
        const looks = Array.isArray(i.looks) ? i.looks.filter(keyOf) : [];
        const entries = Array.isArray(i.entries) ? i.entries : [];
        const wornKey = keyOf(i.current);
        const worn = (look) => Boolean(wornKey) && keyOf(look) === wornKey;
        const recent = Array.isArray(i.recent) ? i.recent : [];

        if (request.look) {
            const named = byName(request.look, looks);
            if (named) return { kind: 'look', look: named, generate: false, reason: 'named' };
            // Not on her shelf: a dictionary set of that name, which has to be made.
            const wanted = String(request.look).trim().toLowerCase();
            const entry = entries.find((e) => {
                const title = String(e.title || '').toLowerCase();
                return title === wanted || title.includes(wanted) || wanted.includes(title);
            });
            if (!entry) return null;
            const made = looks.find((l) => l.outfitId === entry.id);
            if (made) return { kind: 'look', look: made, generate: false, reason: 'named' };
            return i.canCreate ? { kind: 'outfit', entry, generate: true, reason: 'named' } : null;
        }
        if (request.outfit) {
            const made = looks.find((l) => l.outfitId === request.outfit);
            if (made) return { kind: 'look', look: made, generate: false, reason: 'named' };
            const entry = entries.find((e) => e.id === request.outfit);
            if (!entry) return null;
            return i.canCreate ? { kind: 'outfit', entry, generate: true, reason: 'named' } : null;
        }

        if (request.style || request.colour || request.garment) {
            // PX15. An underwear request is answered with underwear or not at all: a colour alone
            // ("negro") must never pick an ordinary look for it.
            const kind =
                request.style === 'lingerie'
                    ? (item) => score(item, { style: 'lingerie', garment: request.garment }) > 0
                    : null;
            const skip = (item) => worn(item) || (kind ? !kind(item) : false);
            const look = best(looks, request, skip);
            if (look) return { kind: 'look', look: look.item, generate: false, reason: 'matches' };
            if (i.canCreate) {
                const entry = best(
                    entries,
                    request,
                    (e) => looks.some((l) => l.outfitId === e.id && worn(l)) || (kind ? !kind(e) : false)
                );
                if (entry) return { kind: 'outfit', entry: entry.item, generate: true, reason: 'matches' };
            }
            return null;
        }

        if (request.choose || request.different) {
            const fresh = looks.filter((l) => !worn(l));
            if (!fresh.length) return null;
            // Least recently worn first: a look not worn this session, else the one worn longest ago.
            const unworn = fresh.find((l) => !recent.includes(keyOf(l)));
            if (unworn) return { kind: 'look', look: unworn, generate: false, reason: 'her-choice' };
            const oldest = fresh.slice().sort((a, b) => recent.indexOf(keyOf(a)) - recent.indexOf(keyOf(b)))[0];
            return { kind: 'look', look: oldest, generate: false, reason: 'her-choice' };
        }
        return null;
    }

    /**
     * UN1. The next layer down, from the looks she already has. Pure.
     *
     * A look is a whole avatar file (PX decision 7: no layered-garment system), so "taking
     * something off" is changing into the look that is what she would have on without it. The
     * try-on haul's own ranking (`TryOnHaulActivity.allureOf`, LT9) already knows the layers:
     * a complete outfit, then lingerie, where sets and garters rank above single pieces. So:
     *
     *   dressed (any band but lingerie)  → her lingerie set, the richest one first
     *   in lingerie                       → a lingerie look that ranks below the one she has on
     *   `step: 'all'`                     → the lowest-ranked lingerie look at once
     *
     * The colour she has on is kept when a look in that colour exists, so the black dress comes
     * off over black lingerie and not over champagne. Nothing is invented: with no look below
     * the one she wears, the answer is `null` and the caller says she is down to her last layer.
     *
     * @param {object} o
     * @param {object[]} o.looks     her looks, as the closet lists them
     * @param {object|null} o.current  the look she has on (null for her own outfit)
     * @param {'next'|'all'} [o.step]
     * @param {function} o.allureOf  `(look) => {band, score}` (TryOnHaulActivity.allureOf)
     * @returns {object|null} the look to put on
     */
    const UNDRESS_COLOURS = [
        'black',
        'white',
        'red',
        'crimson',
        'burgundy',
        'wine',
        'champagne',
        'ivory',
        'nude',
        'pink',
        'blue',
        'beige',
    ];
    function colourOf(look) {
        const words = [look && look.name, look && look.prompt, look && look.description]
            .filter((v) => typeof v === 'string')
            .join(' ')
            .toLowerCase();
        return UNDRESS_COLOURS.find((c) => new RegExp(`\\b${c}\\b`).test(words)) || null;
    }
    /**
     * UN7. A look that is her bare body: Forge's `bare` base-body mode (everything taken off, her
     * skin restored, refused wherever her model has no body under the clothes). Below every
     * lingerie rank: the last step there is.
     */
    function isBare(look) {
        if (!look) return false;
        if (look.bare === true) return true;
        return /^body-bare\b/i.test(String(look.templateId || look.template || ''));
    }

    /**
     * UN7. Does this look leave nothing of hers on? Forge replaces only the region a garment
     * covers: "String Briefs" alone kept her own cardigan on in the real run, a bra alone keeps her
     * shorts. Only a complete look — a set with a top and a bottom, a garter set, a one-piece, or
     * her bare body — is a step towards undressed.
     */
    const UPPER = /\bbra\b|bralette|top\b|bustier|corset|gu[eê]pi[eè]re|cami|balconette/i;
    const LOWER = /brief|thong|string|panty|panties|knicker|short|tanga|perizoma/i;
    const ONE_PIECE =
        /bodysuit|bodystocking|catsuit|teddy|babydoll|chemise|garter set|lingerie set|lingerie-set|garter-set/i;
    function isComplete(look) {
        if (!look) return false;
        if (isBare(look)) return true;
        const text = `${look.templateId || ''} ${look.name || ''}`;
        if (ONE_PIECE.test(text)) return true;
        return /\+/.test(look.name || '') && UPPER.test(text) && LOWER.test(text);
    }

    /**
     * UN7. How much of her a complete lingerie look covers, 0 (bare) to 4, from its template and
     * name. Allure is not coverage: in the real run "I wanna see you naked" after a bralette and
     * briefs chose the lowest-allure piece — a bodysuit, more covered than what she had on.
     */
    function coverageOf(look) {
        if (!look) return 5;
        if (isBare(look)) return 0;
        const text = `${look.templateId || ''} ${look.name || ''}`;
        if (/bodysuit|bodystocking|catsuit|teddy|babydoll|chemise/i.test(text)) return 4;
        if (/garter|suspender|waspie|gu[eê]pi[eè]re|corset|stocking|bustier/i.test(text)) return 3;
        if (/thong|g-?string|string|tie-side|perizoma|tanga/i.test(text)) return 1;
        if (/brazilian|cheeky/i.test(text)) return 1.5;
        return 2;
    }

    function undressStep(o) {
        const opts = o || {};
        const rank = typeof opts.allureOf === 'function' ? opts.allureOf : null;
        if (!rank) return null;
        const looks = Array.isArray(opts.looks) ? opts.looks : [];
        const current = opts.current || null;
        if (current && isBare(current)) return null; // nothing left to take off
        const currentKey = current ? keyOf(current) : null;
        const bare = looks.find((l) => l && keyOf(l) !== currentKey && isBare(l)) || null;
        // Asked to see her naked, or for everything at once: her bare body when her wardrobe has it.
        if (bare && (opts.naked || opts.step === 'all')) return bare;
        const here = current ? rank(current) : null;
        // A single piece leaves her own clothes on: she is still dressed, as far as undressing goes.
        const inLingerie = Boolean(here && here.band === 'lingerie' && isComplete(current));
        const covered = inLingerie ? coverageOf(current) : 5;
        let pool = looks.filter(
            (l) => l && keyOf(l) !== currentKey && !isBare(l) && rank(l).band === 'lingerie' && isComplete(l)
        );
        // Never more fabric than she has on; one layer at a time also goes down the allure rank.
        if (inLingerie) pool = pool.filter((l) => coverageOf(l) <= covered);
        if (inLingerie && opts.step !== 'all')
            pool = pool.filter((l) => coverageOf(l) < covered || rank(l).score < here.score);
        if (inLingerie && opts.step === 'all') pool = pool.filter((l) => coverageOf(l) < covered);
        // Down to her last layer: the next step is her bare body, when there is one.
        if (!pool.length) return bare;
        const colour = current ? colourOf(current) : null;
        const sameColour = colour ? pool.filter((l) => colourOf(l) === colour) : [];
        const from = sameColour.length ? sameColour : pool;
        if (opts.step === 'all') {
            // All of it: the least fabric there is, the lowest allure rank among those.
            const least = Math.min(...from.map(coverageOf));
            const thin = from.filter((l) => coverageOf(l) === least);
            const low = Math.min(...thin.map((l) => rank(l).score));
            return thin.find((l) => rank(l).score === low) || null;
        }
        // Dressed: the richest lingerie first (a set before a single piece). In lingerie: the next
        // step down — less fabric first, then the next rank down.
        if (!inLingerie) {
            const top = Math.max(...from.map((l) => rank(l).score));
            return from.find((l) => rank(l).score === top) || null;
        }
        const less = from.filter((l) => coverageOf(l) < covered);
        const next = less.length ? less : from;
        const best = Math.max(...next.map(coverageOf));
        const tier = next.filter((l) => coverageOf(l) === best);
        const top = Math.max(...tier.map((l) => rank(l).score));
        return tier.find((l) => rank(l).score === top) || null;
    }

    const api = { STYLE_WORDS, choose, score, keyOf, byName, undressStep, colourOf, isBare, coverageOf, isComplete };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_OUTFIT_DECISION_ENGINE = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
