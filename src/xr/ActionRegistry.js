/**
 * ActionRegistry — the single, data-only source of truth for what the avatar
 * can be asked to do, and how people ask for it in each language.
 *
 * WHY (the growth problem): before this module, adding one action meant
 * touching regex rules, the parser whitelist, the policy lists, a handler,
 * and the clip map. B5 already made clip FILES one-entry (the manifest +
 * addons index). This module makes the remaining growth surfaces one-entry:
 *
 *   1. TIERS   — capability classification per command type. The runtime
 *                authorities stay literal on purpose — the parser whitelist
 *                and the policy lists are security boundaries, and literals
 *                are the right thing for a boundary — but
 *                tests/action-registry.test.js fails the build the moment
 *                this table and those literals drift apart.
 *   2. ACTIONS — one record per *sayable* action: multilingual example
 *                phrases (EN/ES/IT — the retrieval corpus for the future
 *                embedding tier, and the target the telemetry flywheel
 *                feeds) plus the icon the command-echo toast shows.
 *
 * Adding a future motion = drop the clip where B5's index finds it, then add
 * ONE record here: { id, icon, phrases }. Nothing else to touch.
 *
 * The phrases are DATA today (tests + the upcoming Tier-1.5 retrieval), not
 * runtime matching: the regex fast path stays hand-tuned on purpose — it is
 * deterministic, 6 µs, and pinned by tests. Mine new phrases from
 * `NEXUS_MOTION.getTelemetry().missed_recent` — utterances the regex missed
 * but the LLM acted on. That loop is the cheapest recall you will ever buy.
 *
 * Additive module: does not modify any existing code.
 * Pure data + lookups (no window/DOM access) — unit-testable in Node/Jest.
 *
 * @module ActionRegistry
 */

const ActionRegistry = (() => {
    'use strict';

    /**
     * Capability tier per command type. Must mirror, exactly:
     *   - MotionBlockParser.ALLOWED_TYPES  (every key — no more, no less)
     *   - MotionPolicy.MOVEMENT_TYPES      (the 'movement' keys)
     *   - MotionPolicy.ALWAYS_ALLOWED      (the 'control' keys)
     * tests/action-registry.test.js enforces all three equalities.
     */
    const TIERS = {
        // control — must survive every filter, at every setting
        stop: 'control',
        stop_follow: 'control',
        // movement — root translation, gated by Settings → Movement
        approach: 'movement',
        retreat: 'movement',
        follow: 'movement',
        // expressive — in-place, rides on the master switch alone
        look_at: 'expressive',
        expression: 'expressive',
        gesture: 'expressive',
        wave: 'expressive',
        nod: 'expressive',
        point: 'expressive',
        offer_hand: 'expressive',
        wait_contact: 'expressive',
        turn: 'expressive',
        raise_hand: 'expressive',
        sit: 'expressive',
        stand: 'expressive',
        idle: 'expressive',
        speak_start: 'expressive',
        speak_end: 'expressive',
        pause: 'expressive',
    };

    /**
     * Sayable actions. `id` matches the IntentFastPath label where one
     * exists (the sync test enforces coverage), plus gesture-only extras
     * that B5's clip index already makes playable. Phrases are short and
     * imperative — the register people actually use with a companion.
     */
    const ACTIONS = [
        // ── control ──
        {
            id: 'stop',
            icon: '🛑',
            phrases: {
                en: ['stop', 'stop it', 'freeze', 'hold on'],
                es: ['para', 'detente', 'quieta', 'alto'],
                it: ['fermati', 'ferma', 'basta', 'stop'],
            },
        },
        {
            id: 'stop_follow',
            icon: '✋',
            phrases: {
                en: ['stop following me', 'stay here', 'wait here'],
                es: ['deja de seguirme', 'quédate aquí', 'espera aquí'],
                it: ['smetti di seguirmi', 'resta qui', 'aspetta qui'],
            },
        },
        // ── movement ──
        {
            id: 'follow',
            icon: '🚶',
            phrases: {
                en: ['follow me', 'come with me', 'walk with me', 'stay with me'],
                es: ['sígueme', 'ven conmigo', 'camina conmigo', 'acompáñame'],
                it: ['seguimi', 'vieni con me', 'cammina con me', 'stammi vicino'],
            },
        },
        {
            id: 'come_here',
            icon: '🫴',
            phrases: {
                en: ['come here', 'come closer', 'come to me', 'over here'],
                es: ['ven aquí', 'acércate', 'ven acá', 'ven'],
                it: ['vieni qui', 'avvicinati', 'vieni da me', 'qui'],
            },
        },
        {
            id: 'go_away',
            icon: '↩️',
            phrases: {
                en: ['go away', 'back off', 'step back', 'give me space'],
                es: ['aléjate', 'atrás', 'retrocede', 'dame espacio'],
                it: ['allontanati', 'indietro', 'vai via', 'dammi spazio'],
            },
        },
        // ── rotation / attention ──
        {
            id: 'turn_around',
            icon: '🔄',
            phrases: {
                en: ['turn around', 'do a 180', 'face away', 'turn round'],
                es: ['date la vuelta', 'media vuelta', 'voltéate', 'gírate'],
                it: ['girati', 'voltati', 'di spalle', 'fai mezzo giro'],
            },
        },
        {
            id: 'turn_to_me',
            icon: '↪️',
            phrases: {
                en: ['turn to me', 'face me', 'turn towards me'],
                es: ['gírate hacia mí', 'mírame de frente', 'voltea hacia mí'],
                it: ['girati verso di me', 'mettiti di fronte', 'voltati verso di me'],
            },
        },
        {
            id: 'look_at_me',
            icon: '👀',
            phrases: {
                en: ['look at me', 'look here', 'eyes on me'],
                es: ['mírame', 'mira aquí', 'ojos aquí'],
                it: ['guardami', 'guarda qui', 'occhi su di me'],
            },
        },
        // ── gestures ──
        {
            id: 'raise_hand',
            icon: '🙋',
            phrases: {
                en: ['raise your hand', 'hand up', 'put your hand up', 'hands up'],
                es: ['levanta la mano', 'alza la mano', 'manos arriba', 'sube la mano'],
                it: ['alza la mano', 'mano alzata', 'su la mano', 'mani in alto'],
            },
        },
        {
            id: 'wave',
            icon: '👋',
            phrases: {
                en: ['wave', 'say hello', 'wave at me', 'greet me'],
                es: ['saluda', 'di hola', 'salúdame', 'haz un saludo'],
                it: ['saluta', 'di ciao', 'salutami', 'fai ciao con la mano'],
            },
        },
        {
            id: 'handshake',
            icon: '🤝',
            phrases: {
                en: ['shake my hand', 'handshake', 'give me your hand'],
                es: ['dame la mano', 'estrecha mi mano', 'choca la mano'],
                it: ['dammi la mano', 'stringimi la mano', 'qua la mano'],
            },
        },
        {
            id: 'high_five',
            icon: '✋',
            phrases: {
                en: ['high five', 'give me five', 'up top'],
                es: ['choca esos cinco', 'dame cinco', 'esos cinco'],
                it: ['batti il cinque', 'dammi il cinque', 'dammi cinque'],
            },
        },
        {
            id: 'bow',
            icon: '🙇',
            phrases: {
                en: ['bow', 'take a bow', 'bow down'],
                es: ['haz una reverencia', 'inclínate', 'reverencia'],
                it: ['fai un inchino', 'inchinati', 'inchino'],
            },
        },
        {
            id: 'nod_yes',
            icon: '✅',
            phrases: {
                en: ['nod', 'say yes', 'nod your head'],
                es: ['asiente', 'di que sí', 'mueve la cabeza'],
                it: ['annuisci', 'di di sì', 'fai sì con la testa'],
            },
        },
        {
            id: 'clap',
            icon: '👏',
            phrases: {
                en: ['clap', 'applaud', 'give a round of applause'],
                es: ['aplaude', 'un aplauso', 'aplausos'],
                it: ['applaudi', 'un applauso', 'batti le mani'],
            },
        },
        // ── posture ──
        {
            id: 'sit',
            icon: '🪑',
            phrases: {
                en: ['sit down', 'take a seat', 'have a seat', 'sit'],
                es: ['siéntate', 'toma asiento', 'a sentarse', 'siéntese'],
                it: ['siediti', 'accomodati', 'a sedere', 'siedi'],
            },
        },
        {
            id: 'stand',
            icon: '🧍',
            phrases: {
                en: ['stand up', 'get up', 'on your feet', 'rise'],
                es: ['levántate', 'de pie', 'ponte de pie', 'arriba'],
                it: ['alzati', 'in piedi', 'su', 'tirati su'],
            },
        },
        // ── performance ──
        {
            id: 'dance',
            icon: '💃',
            phrases: {
                en: ['dance', 'dance for me', 'show me some moves', 'bust a move'],
                es: ['baila', 'baila para mí', 'muéstrame unos pasos', 'a bailar'],
                it: ['balla', 'balla per me', 'fammi vedere come balli', 'danza'],
            },
        },
        {
            id: 'backflip',
            icon: '🤸',
            phrases: {
                en: ['backflip', 'do a flip', 'do a backflip'],
                es: ['salto mortal', 'haz un salto mortal', 'haz una voltereta'],
                it: ['salto mortale', 'fai un salto mortale', 'fai una capriola'],
            },
        },
        // ── gesture-only extras (playable via B5's clip index) ──
        // "twerk" used to live here. Its only clip, dancingTwerk.vrma, is
        // Mixamo-origin and inverts the legs on a VRM rig, so it is no longer
        // selectable — and advertising an action with nothing behind it makes
        // the avatar promise a move it cannot perform.
        {
            id: 'victory',
            icon: '🏆',
            phrases: {
                en: ['celebrate', 'victory pose', 'you won'],
                es: ['celebra', 'pose de victoria', 'festeja'],
                it: ['festeggia', 'posa della vittoria', 'esulta'],
            },
        },
    ];

    const _byId = Object.create(null);
    for (const a of ACTIONS) _byId[a.id] = a;

    /** @returns {Object} a copy of the full tier table */
    function tiers() {
        return Object.assign({}, TIERS);
    }

    /** @returns {string|null} 'control' | 'movement' | 'expressive' */
    function tierOf(type) {
        return TIERS[String(type || '').toLowerCase()] || null;
    }

    /** All command types the tier table knows (≡ the parser whitelist). */
    function commandTypes() {
        return Object.keys(TIERS);
    }

    /** Command types belonging to one tier. */
    function typesInTier(tier) {
        return Object.keys(TIERS).filter((t) => TIERS[t] === tier);
    }

    /** All sayable action ids. */
    function ids() {
        return ACTIONS.map((a) => a.id);
    }

    /** Look an action up by id. */
    function action(id) {
        return _byId[String(id || '').toLowerCase()] || null;
    }

    /** Toast icon for an action id (null when unknown). */
    function icon(id) {
        const a = action(id);
        return a && a.icon ? a.icon : null;
    }

    /**
     * Example phrases for one action — one language, or all languages
     * flattened. This is the corpus the future retrieval tier embeds.
     * @param {string} id
     * @param {string} [lang] - 'en' | 'es' | 'it'
     * @returns {string[]}
     */
    function phrasesFor(id, lang) {
        const a = action(id);
        if (!a || !a.phrases) return [];
        if (lang) return a.phrases[lang] ? a.phrases[lang].slice() : [];
        const out = [];
        for (const l of Object.keys(a.phrases)) out.push.apply(out, a.phrases[l]);
        return out;
    }

    return { TIERS, ACTIONS, tiers, tierOf, commandTypes, typesInTier, ids, action, icon, phrasesFor };
})();

if (typeof window !== 'undefined') window.NEXUS_ACTION_REGISTRY = ActionRegistry;
if (typeof module !== 'undefined' && module.exports) module.exports = ActionRegistry;
