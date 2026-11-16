/**
 * UN14. What a look really covers, from Forge's own garment templates — never from how a look
 * is named.
 *
 * The failure this exists for: UN11's real browser run undressed her to "Black Garter Set" and
 * her own cardigan stayed on, because `OutfitDecisionEngine` decided a look was whole by matching
 * words like "set". Forge replaces only the regions a garment covers; everything else of hers
 * stays rendered. So "is this a complete outfit" is a question about regions, and Forge's
 * templates answer it: `under-garter-set-v1` covers waist, hips and upper legs — no chest.
 *
 * The data is `assets/wardrobe/garment-coverage.json`, generated from a Forge checkout by
 * `tools/wardrobe/sync-coverage.mjs` (Forge's HTTP catalogue carries no coverage, and gives a
 * private look's template only to its operator). A look is resolved to templates only by
 * verified links, in this order:
 *
 * 1. its own `templateId` (Forge's prebuilt list), or the template ids in `garments`;
 * 2. the dictionary outfit it is (`outfitId`), whose entry lists its garments' templates;
 * 3. its name or prompt, exactly as Forge names a template look — "<colour> <Template Name>",
 *    pieces joined by " + ", Forge's "Micro" cut word before a tailored name, and the
 *    "Suspender Straps" of a hosiery set, which is not a garment template. Measured on
 *    avatar-sample-a's 265 prebuilt looks against their true templateId: every one resolved,
 *    none to the wrong template.
 *
 * Anything else is unknown, and unknown is never treated as covering anything: a look the
 * wardrobe cannot verify is not offered as a step of undressing.
 */
(function (global) {
    'use strict';

    const FILE = 'assets/wardrobe/garment-coverage.json';
    /** Upper and lower body: a look covering both replaces her own top and bottom. */
    const WHOLE = ['chest', 'hips'];
    /** How much of her each region is, for "less fabric": torso first, accessories barely. */
    const WEIGHT = {
        chest: 1,
        waist: 0.5,
        hips: 1,
        upperLegs: 0.5,
        lowerLegs: 0.25,
        upperArms: 0.25,
        lowerArms: 0.25,
        shoulders: 0.25,
        feet: 0,
    };
    /** Hosiery pieces Forge names in a set's title that are not garment templates. */
    const NOT_A_GARMENT = new Set(['suspender straps']);

    let data = null;
    let byName = new Map();
    let loading = null;

    function use(json) {
        if (!json || typeof json !== 'object' || !json.templates) return false;
        data = json;
        byName = new Map(Object.entries(json.templates).map(([id, t]) => [String(t.name || '').toLowerCase(), id]));
        return true;
    }

    /** Fetch the coverage file once (the browser); in Node the file is read at load time. */
    function load(win) {
        if (data) return Promise.resolve(true);
        if (loading) return loading;
        const w = win || global;
        const f = w && typeof w.fetch === 'function' ? w.fetch.bind(w) : null;
        if (!f) return Promise.resolve(false);
        loading = f(FILE)
            .then((r) => (r && r.ok ? r.json() : null))
            .then((json) => use(json))
            .catch((error) => {
                console.warn('[Wardrobe] garment coverage could not be read; looks stay unverified', error);
                return false;
            })
            .finally(() => {
                loading = null;
            });
        return loading;
    }

    function ready() {
        return Boolean(data);
    }

    function stripColours(words) {
        const colours = new Set((data && data.colours) || []);
        let i = 0;
        while (i < words.length && colours.has(words[i])) i += 1;
        return words.slice(i);
    }

    /** One piece of a look's name → a template id, or null; NOT_A_GARMENT → ''. */
    function pieceTemplate(piece) {
        const words = stripColours(String(piece).toLowerCase().trim().split(/\s+/).filter(Boolean));
        const name = words.join(' ');
        if (!name) return null;
        if (NOT_A_GARMENT.has(name)) return '';
        if (byName.has(name)) return byName.get(name);
        if (words[0] === 'micro' && byName.has(words.slice(1).join(' '))) return byName.get(words.slice(1).join(' '));
        return null;
    }

    function fromName(text) {
        if (!text) return null;
        const ids = [];
        for (const piece of String(text).split('+')) {
            const id = pieceTemplate(piece);
            if (id === null) return null;
            if (id) ids.push(id);
        }
        return ids.length ? ids : null;
    }

    /** The Forge templates a look is made of, by verified links only; null when unknown. */
    function templatesOf(look, entries) {
        if (!look || !data) return null;
        const known = (id) => typeof id === 'string' && data.templates[id];
        if (known(look.templateId)) return [look.templateId];
        if (Array.isArray(look.garments)) {
            const ids = look.garments.map((g) => (typeof g === 'string' ? g : g && g.template));
            if (ids.length && ids.every(known)) return ids;
        }
        if (look.outfitId && Array.isArray(entries)) {
            const entry = entries.find((e) => e && e.id === look.outfitId);
            const ids = entry && Array.isArray(entry.garments) ? entry.garments.map((g) => g && g.template) : [];
            if (ids.length && ids.every(known)) return ids;
        }
        return fromName(look.name) || fromName(look.prompt);
    }

    /**
     * What a look covers: `{ templates, regions, complete, amount }`, or null when unknown.
     * `complete`: it covers her upper and lower body, so none of her own top or bottom shows.
     * `amount`: how much of her it covers (0 for nothing; a bra and briefs 2; a bodysuit 2.5).
     */
    function describe(look, entries) {
        const templates = templatesOf(look, entries);
        if (!templates) return null;
        const regions = [...new Set(templates.flatMap((id) => data.templates[id].coverage || []))];
        // Her hips count by how much of them the fullest bottom covers (Forge's front and back
        // coverage): a thong is not briefs, though both "cover the hips".
        const shares = templates.map((id) => data.templates[id]);
        const hipsShare = shares.some((t) => (t.coverage || []).includes('hips') && t.hipsShare === undefined)
            ? 1
            : Math.max(0, ...shares.map((t) => (t.hipsShare === undefined ? 0 : t.hipsShare)));
        const amount = regions.reduce(
            (n, r) => n + (WEIGHT[r] === undefined ? 0.25 : WEIGHT[r]) * (r === 'hips' ? hipsShare : 1),
            0
        );
        return {
            templates,
            categories: [...new Set(templates.map((id) => data.templates[id].category))],
            regions,
            complete: WHOLE.every((r) => regions.includes(r)),
            amount: Math.round(amount * 100) / 100,
        };
    }

    /** Two garments or looks can be worn together when they cover none of the same regions. */
    function compatible(a, b, entries) {
        const x = describe(a, entries);
        const y = describe(b, entries);
        if (!x || !y) return false;
        return !x.regions.some((r) => y.regions.includes(r));
    }

    /**
     * What the renderer shows with this look on: its regions, and whether any of her own outfit
     * is still visible (a look that is not complete leaves her own top or bottom on).
     */
    function rendered(look, entries) {
        if (!look) return { look: null, regions: [], ownOutfitVisible: true, known: true };
        const d = describe(look, entries);
        if (!d) return { look, regions: [], ownOutfitVisible: null, known: false };
        return { look, regions: d.regions, ownOutfitVisible: !d.complete, known: true };
    }

    // In Node (Jest, tools) the file is beside us in the repository: read it now.
    if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
        try {
            use(require('../../../assets/wardrobe/garment-coverage.json'));
        } catch (_) {
            /* not in a checkout: load() will fetch it */
        }
    }

    const api = { FILE, WHOLE, WEIGHT, use, load, ready, templatesOf, describe, compatible, rendered };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_WARDROBE_COVERAGE = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
