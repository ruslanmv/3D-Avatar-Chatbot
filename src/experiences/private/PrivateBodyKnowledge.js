/**
 * PB2. What she knows of her own body in Private, without flooding her prompt.
 *
 * Reported (2026-11-19, a real evening): asked "Cosa puoi mostrare?" she said only "Tutto"; asked
 * for a piercing she said she could not, and offered nothing else — she did not know which states
 * her look could show, nor that piercings come with a different bare look she could change into.
 * PB1 fixed the first by listing every state of her skin pack on every reply (≈250 tokens with a
 * full pack, and growing with each state Forge adds). This replaces that with the pattern every
 * catalogue in Private should follow (docs/claude/private-knowledge.md):
 *
 *   1. an INDEX, always: the families her look can show, with counts — a few dozen tokens, so she
 *      always knows what exists and can offer it;
 *   2. DETAIL on demand: a family's names only on the turn the person's words touch it (any of the
 *      app's nine languages), or all of them when they ask what she can show;
 *   3. filtered by WHERE SHE IS: a position-specific state only for the position she holds;
 *   4. under a hard BUDGET (`BUDGET`), enforced by tests/private-body-knowledge.test.js, so a new
 *      state or extra can never quietly grow the prompt.
 *
 * Extras (piercings, tattoos, marks, tan lines, writing) are part of a bare look, never switched
 * live: when they are asked about, she is told which bare looks in her wardrobe carry them, so she
 * can offer to change into one instead of only saying no.
 *
 * Information, never an action: a state changes only through the pace, their fist, where they
 * finish (the bridge), and a look through the wardrobe — never because she named it. Pure: names
 * and words in, lines out.
 */
(function (global) {
    'use strict';

    /** Characters, per line: the index always; a family's detail; everything, when asked. */
    const BUDGET = Object.freeze({ index: 300, detail: 600, all: 900 });

    /** Families, in the order they are listed. `re` matches a skin-pack state name. */
    const FAMILIES = Object.freeze([
        { id: 'arousal', re: /^(aroused|flushed|goosebumps|sweaty|afterglow|open|wide-open|anus-open|both-open)$/ },
        { id: 'pumped-oiled', re: /^(pumped|pumped-open|oiled|oiled-aroused)$/ },
        { id: 'fisting', re: /fisted|stretched/ },
        { id: 'sado', re: /^sado-/ },
        { id: 'finishes', re: /cum|creampie|finish/ },
        { id: 'sweat', re: /sweaty/ },
    ]);
    const LABEL = Object.freeze({
        arousal: 'arousal',
        'pumped-oiled': 'pumped or oiled',
        fisting: 'fisting',
        sado: 'rough (sado)',
        finishes: 'finishes',
        sweat: 'sweat',
        other: 'in a position',
    });

    /** Words that ask about a family, per family, across the app's languages (substrings, lower case). */
    const ASKS = Object.freeze({
        all: /cosa (puoi|sai|riesci a) (mostrar|far)|cosa mi (puoi|fai) vedere|fammi vedere tutto|what can you (show|do)|show me everything|what do you have|qué (puedes|sabes) (mostrar|hacer)|enséñamelo todo|qu.est-ce que tu (peux|sais) (montrer|faire)|was kannst du (zeigen|machen)|o que (podes|consegues) mostrar|何を見せ|何ができる|뭘 보여|뭐 할 수 있|能给我看什么|你能做什么/,
        finishes:
            /veng|sto per venire|sborr|sperma|creampie|dove vuoi che|finire|finish|cum|coming|me corro|me vengo|leche|semen|je jouis|sperme|ich komme|sperma|gozar|venho|esporr|イく|イキ|出す|精液|쌀게|정액|射|精液/,
        fisting: /pugno|fist|puño|poing|faust|punho|拳|주먹|피스팅/,
        sado: /sado|frust|\bcord[ae]\b|legat[ao]|\bcera\b|whip|rope|wax|bondage|látig|cuerd|cire|fouet|ligot|peitsch|seil|wachs|chicot|vela|ロープ|ムチ|蝋|채찍|밧줄|鞭|绳|蜡/,
        arousal:
            /apert|bagnat|eccitat|open|wet|aroused|abiert|mojad|ouvert|mouill|offen|feucht|abert|molhad|濡れ|開い|젖|벌려|湿|张开/,
        'pumped-oiled': /olio|oliat|oil|aceite|huile|öl|óleo|pump|gonfi|オイル|오일|油/,
        extras: /piercing|tatuag|tattoo|tatu|tatou|kiss|bac[ie]|rossetto|lipstick|segni|succhiott|marks|hickey|spank|sculacc|abbronz|tan line|glitter|scritt|writing|escrit|écrit|schrift|ピアス|タトゥー|피어싱|타투|穿孔|纹身/,
    });

    /**
     * BD21. Kinds of extra, by Forge's names (``tattoo-mons-rose``, ``piercings-labia``…), and the
     * words that ask for each — so asked for a piercing she names the looks that have piercings,
     * not every bare look in her closet.
     */
    const EXTRA_KINDS = Object.freeze([
        { re: /^piercings-/, ask: /piercing|ピアス|피어싱|穿孔/ },
        { re: /^tattoo-/, ask: /tatuag|tattoo|tatu|tatou|タトゥー|타투|纹身/ },
        { re: /^tan-/, ask: /abbronz|tan line|bronceado|bronzage|bräun|bronze/ },
        {
            re: /^(kisses-|love-bites|spanked)/,
            ask: /kiss|bac[ie]|rossetto|lipstick|segni|succhiott|marks|hickey|spank|sculacc/,
        },
        { re: /^writing-/, ask: /scritt|writing|escrit|écrit|schrift/ },
        { re: /^(glitter|body-paint|hearts)/, ask: /glitter|brillant|paillett|gold|oro/ },
    ]);

    function lookLabel(look) {
        const extras = Array.isArray(look && look.extras) ? look.extras : [];
        const name = String((look && look.name) || '').trim();
        return extras.length ? `${name} (${extras.map(human).join(', ')})` : name;
    }

    /** Her other bare looks worth naming for these words: those with the asked kind of extra first. */
    function looksFor(bareLooks, text) {
        const t = String(text || '').toLowerCase();
        const kinds = EXTRA_KINDS.filter((k) => k.ask.test(t));
        const has = (l) => (l.extras || []).some((e) => kinds.some((k) => k.re.test(e)));
        const matching = kinds.length ? bareLooks.filter(has) : [];
        return matching.length ? matching : bareLooks;
    }

    /** The position groups a state name belongs to (missionary-*, doggy-*, cowgirl-*), or null. */
    function poseOf(name) {
        const m = /^(doggy|missionary|cowgirl)-/.exec(name);
        return m ? m[1] : null;
    }

    function familyOf(name) {
        const f = FAMILIES.find((x) => x.re.test(name));
        return f ? f.id : 'other';
    }

    function human(name) {
        return String(name).replace(/-/g, ' ');
    }

    /** The families of a pack: { id: [names] }, `closed` left out (it is her body at rest). */
    function families(names) {
        const out = {};
        for (const n of names || []) {
            if (!n || n === 'closed') continue;
            const f = familyOf(n);
            (out[f] || (out[f] = [])).push(n);
        }
        return out;
    }

    /** The families the person's words ask about this turn. */
    function asked(text) {
        const t = String(text || '').toLowerCase();
        return Object.keys(ASKS).filter((k) => ASKS[k].test(t));
    }

    function clip(line, max) {
        return line.length <= max ? line : `${line.slice(0, max - 1).replace(/[,;\s]+\S*$/, '')}…`;
    }

    /**
     * Her body's lines for this turn: `{ index, detail }`. `names`: the states her look's pack holds;
     * `pose`: the position group she holds (doggy | missionary | cowgirl | null); `text`: the
     * person's words this turn; `bareLooks`: other bare looks in her wardrobe, as { name, extras }
     * (BD21: Forge's ``look.body.extras``); `wearing`: the extras painted on the look she has on.
     */
    function lines({ names, pose, text, bareLooks, wearing } = {}) {
        const fam = families(names);
        const ids = Object.keys(fam);
        const on = (Array.isArray(wearing) ? wearing : []).filter(Boolean);
        if (!ids.length && !(bareLooks || []).length && !on.length) return { index: null, detail: null };
        const counts = ids.map((id) => `${LABEL[id] || id} ${fam[id].length}`);
        if ((bareLooks || []).length) counts.push(`other bare looks ${bareLooks.length}`);
        // What is painted on her now is part of her body tonight: she can mention it, never remove it.
        if (on.length) counts.push(`on your skin now: ${on.map(human).join(', ')}`);
        const index = clip(
            `Your body can show tonight — ${counts.join(' · ')}. Each shows only when it really happens (the pace, their fist, where they finish); name one only when it fits.`,
            BUDGET.index
        );

        const want = asked(text);
        if (!want.length) return { index, detail: null };
        // Where she is decides which position-specific states are worth naming.
        const here = (n) => !poseOf(n) || !pose || poseOf(n) === pose;
        const parts = [];
        const all = want.includes('all');
        for (const id of ids) {
            if (!all && !want.includes(id)) continue;
            const list = fam[id].filter(here);
            if (list.length) parts.push(`${LABEL[id] || id}: ${list.map(human).join(', ')}`);
        }
        if ((all || want.includes('extras')) && (bareLooks || []).length) {
            parts.push(
                `piercings, tattoos and marks are part of a bare look, never added live — her other bare looks: ${looksFor(
                    bareLooks,
                    text
                )
                    .map(lookLabel)
                    .filter(Boolean)
                    .join('; ')} (offer to change into one if it is what they want)`
            );
        } else if (want.includes('extras')) {
            parts.push(
                'piercings, tattoos and marks are part of a bare look, never added live, and her wardrobe has no other bare look: say so warmly and offer what you can show'
            );
        }
        if (!parts.length) return { index, detail: null };
        const detail = clip(
            `What they are asking about, as your body can show it now — ${parts.join('; ')}.`,
            all ? BUDGET.all : BUDGET.detail
        );
        return { index, detail };
    }

    const api = { BUDGET, FAMILIES, ASKS, EXTRA_KINDS, families, asked, lines, poseOf, looksFor };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_PRIVATE_BODY_KNOWLEDGE = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
