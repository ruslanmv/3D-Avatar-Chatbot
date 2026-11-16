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
        // BL2. Forge says so in the wardrobe manifest (wardrobeState); never inferred from a name.
        if (look.wardrobeState === 'bare') return true;
        return /^body-bare\b/i.test(String(look.templateId || look.template || ''));
    }

    /**
     * UN14. What a look covers comes from Forge's garment templates (WardrobeCoverage): a look on
     * her shelf carries it as `look.coverage` (InSceneWardrobe annotates the shelf when it loads;
     * null means it could not be verified), and any other look is described on demand.
     * `undefined` here means the coverage data itself is not loaded.
     */
    function coverageModel() {
        if (global && global.NEXUS_WARDROBE_COVERAGE) return global.NEXUS_WARDROBE_COVERAGE;
        if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
            try {
                return require('./WardrobeCoverage.js');
            } catch (_) {
                return null;
            }
        }
        return null;
    }

    function coverageFacts(look) {
        if (!look) return null;
        if (look.coverage !== undefined) return look.coverage;
        const model = coverageModel();
        return model && model.ready() ? model.describe(look) : undefined;
    }

    /**
     * UN7/UN14. Does this look leave nothing of hers on? Forge replaces only the regions a garment
     * covers: "String Briefs" alone kept her own cardigan on, a bra alone keeps her shorts, and
     * a garter set — waist, hips and upper legs, no chest — kept the cardigan too (UN11). Complete
     * means it covers her upper and lower body (chest and hips), or it is her bare body. A look
     * the coverage cannot verify is not complete: it is never offered as a step of undressing.
     */
    function isComplete(look) {
        if (!look) return false;
        if (isBare(look)) return true;
        const facts = coverageFacts(look);
        if (facts) return facts.complete;
        if (facts === null) return false;
        return guessComplete(look);
    }

    /**
     * UN7/UN14. How much of her a look covers: 0 (bare) up, from the regions its templates cover
     * (a bra and briefs 2, a bodysuit 2.5, a babydoll 3); 5 when it cannot be verified. Allure is
     * not coverage: "I wanna see you naked" after a bralette and briefs once chose a bodysuit.
     */
    function coverageOf(look) {
        if (!look) return 5;
        if (isBare(look)) return 0;
        const facts = coverageFacts(look);
        if (facts) return facts.amount;
        if (facts === null) return 5;
        return guessCoverage(look);
    }

    // The pre-UN14 name guesses, used only while the coverage data could not be loaded at all
    // (offline, a failed fetch) — never alongside it, so the two scales never meet.
    let warned = false;
    function guessed() {
        if (warned) return;
        warned = true;
        console.warn('[Wardrobe] no garment coverage data: completeness is guessed from look names');
    }
    const UPPER = /\bbra\b|bralette|top\b|bustier|corset|gu[eê]pi[eè]re|cami|balconette/i;
    const LOWER = /brief|thong|string|panty|panties|knicker|short|tanga|perizoma/i;
    const ONE_PIECE =
        /bodysuit|bodystocking|catsuit|teddy|babydoll|chemise|lingerie set|lingerie-set|waspie|gu[eê]pi[eè]re/i;
    function guessComplete(look) {
        guessed();
        const text = `${look.templateId || ''} ${look.name || ''}`;
        if (ONE_PIECE.test(text)) return true;
        return /\+/.test(look.name || '') && UPPER.test(text) && LOWER.test(text);
    }
    function guessCoverage(look) {
        guessed();
        const text = `${look.templateId || ''} ${look.name || ''}`;
        if (/bodysuit|bodystocking|catsuit|teddy|babydoll|chemise/i.test(text)) return 4;
        if (/garter|suspender|waspie|gu[eê]pi[eè]re|corset|stocking|bustier/i.test(text)) return 3;
        if (/thong|g-?string|string|tie-side|perizoma|tanga/i.test(text)) return 1;
        if (/brazilian|cheeky/i.test(text)) return 1.5;
        return 2;
    }

    /**
     * UN19. BARE and LINGERIE are two different states, and one never stands in for the other.
     *
     * Before, "naked" / "take everything off" with no bare look in her wardrobe fell through to
     * her least-covering lingerie: the transition was original → lingerie → original while the
     * request was for original → bare → original. Changing into underwear is not complete
     * removal. So a request for everything (`naked`, or step `all`) is answered only by her bare
     * look; without one nothing changes and the reason is `no-bare-look`. One step at a time
     * (`next`) is lingerie, down to her last layer, and then bare if she has it.
     *
     * @returns {{look: object|null, state: 'bare'|'lingerie'|null, why: string|null}}
     */
    function undressPlan(o) {
        const opts = o || {};
        const looks = Array.isArray(opts.looks) ? opts.looks : [];
        const current = opts.current || null;
        if (current && isBare(current)) return { look: null, state: null, why: 'already-bare' };
        const currentKey = current ? keyOf(current) : null;
        const bare = looks.find((l) => l && keyOf(l) !== currentKey && isBare(l)) || null;
        if (opts.naked || opts.step === 'all')
            return bare ? { look: bare, state: 'bare', why: null } : { look: null, state: null, why: 'no-bare-look' };
        const look = undressStep({ ...opts, step: 'next', naked: false });
        if (!look) return { look: null, state: null, why: 'last-layer' };
        return { look, state: isBare(look) ? 'bare' : 'lingerie', why: null };
    }

    /** What she has on, as a wardrobe state: her own outfit, a look, lingerie, or bare. */
    function outfitState(current, allureOf) {
        if (!current) return 'original';
        if (isBare(current)) return 'bare';
        try {
            const rank = typeof allureOf === 'function' ? allureOf(current) : null;
            if (rank && rank.band === 'lingerie') return 'lingerie';
        } catch (_) {
            /* an unranked look is just a look */
        }
        return 'look';
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

    /**
     * RU5. Which dictionary outfit each look on her shelf already is, by the prompt Forge made it
     * from. `choose` reuses a look for an outfit only through `look.outfitId`, which was set only
     * on a look made in this session — so after a reload, "crop top & jeans" already in her
     * wardrobe (prebuilt, or made yesterday) was offered as something to *make*, with the wait
     * and the approval that implies, though Forge then answered it at once. Tags in place;
     * a look that already says which outfit it is keeps that. Returns how many were tagged.
     */
    function tagOutfits(looks, entries) {
        const norm = (text) =>
            String(text || '')
                .trim()
                .toLowerCase()
                .replace(/\s+/g, ' ');
        const byPrompt = new Map();
        for (const entry of Array.isArray(entries) ? entries : []) {
            const prompt = norm(entry && ((entry.request && entry.request.prompt) || entry.prompt));
            if (!prompt) continue;
            // Two entries with one prompt (a preset tells them apart) cannot be told apart by it.
            byPrompt.set(prompt, byPrompt.has(prompt) ? null : entry.id);
        }
        let tagged = 0;
        for (const look of Array.isArray(looks) ? looks : []) {
            if (!look || look.outfitId) continue;
            const id = byPrompt.get(norm(look.prompt));
            if (id) {
                look.outfitId = id;
                tagged += 1;
            }
        }
        return tagged;
    }

    /**
     * UN17. Tonight's outfit theme (StoryWeaver's `outfitTheme`) → one of her saved looks that
     * fits it and the place she is in, or null. Only verified looks: what a look is comes from
     * Forge's templates (`look.coverage` / WardrobeCoverage — its categories and template ids),
     * its colour from Forge's own name; nothing is invented and nothing is generated. Eveningwear
     * only — a theme never proposes lingerie. A hotel keeps what she has on (null); the
     * apartment suggests only something comfortable, if she has it.
     */
    const THEMES = {
        'evening-black': { colours: ['black'], categories: ['dress', 'jumpsuit'] },
        'red-night': { colours: ['red', 'crimson', 'wine', 'burgundy'], categories: ['dress', 'jumpsuit', 'skirt'] },
        'soft-champagne': {
            colours: ['champagne', 'ivory', 'cream', 'nude', 'beige', 'blush'],
            categories: ['dress', 'jumpsuit', 'skirt'],
        },
        'club-mini': { categories: ['dress'], regions: { has: ['upperLegs'], not: ['lowerLegs'] } },
        'satin-slip': { categories: ['dress'], templates: /slip/ },
    };
    const COMFORT = { categories: ['nightwear'] };
    const EVENINGWEAR = new Set(['dress', 'jumpsuit', 'skirt', 'top', 'trousers', 'jacket', 'nightwear']);

    function themeLook(theme, looks, options) {
        const o = options || {};
        const venue = String(o.venue || '').toLowerCase();
        if (/hotel|suite/.test(venue)) return null;
        const want = /apartment|bedroom|home/.test(venue) ? COMFORT : THEMES[theme];
        if (!want) return null;
        const wornKey = o.current ? keyOf(o.current) : null;
        const fits = (look) => {
            if (!look || isBare(look) || (wornKey && keyOf(look) === wornKey)) return false;
            const facts = coverageFacts(look);
            if (!facts || !facts.categories.every((c) => EVENINGWEAR.has(c))) return false;
            if (want.categories && !facts.categories.some((c) => want.categories.includes(c))) return false;
            if (want.templates && !facts.templates.some((t) => want.templates.test(t))) return false;
            if (want.regions && want.regions.has.some((r) => !facts.regions.includes(r))) return false;
            if (want.regions && want.regions.not.some((r) => facts.regions.includes(r))) return false;
            if (want.colours && !want.colours.includes(colourOf(look))) return false;
            return true;
        };
        return (Array.isArray(looks) ? looks : []).find(fits) || null;
    }

    const api = {
        THEMES,
        themeLook,
        STYLE_WORDS,
        choose,
        score,
        keyOf,
        byName,
        undressStep,
        undressPlan,
        outfitState,
        colourOf,
        isBare,
        coverageOf,
        isComplete,
        tagOutfits,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_OUTFIT_DECISION_ENGINE = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
