/**
 * IntentFastPath — zero-latency voice/text command matcher.
 *
 * Maps common spoken commands ("sit down", "follow me", "sígueme", …)
 * straight to MotionPlan JSON in <1 ms, so the avatar reacts instantly
 * while the LLM is still generating its verbal reply. Anything that does
 * not match falls through to the LLM motion contract.
 *
 * Languages: EN, ES, IT, FR, DE, PT (extend RULES freely).
 *
 * Additive module: does not modify any existing code.
 * Pure module (no window/DOM access) so it is unit-testable in Node/Jest.
 *
 * @module IntentFastPath
 */

const IntentFastPath = (() => {
    'use strict';

    /**
     * Lowercase + strip accents/punctuation so "¡Siéntate!" matches "sientate".
     * @private
     */
    function _normalize(text) {
        return String(text || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^\p{L}\p{N}\s]/gu, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function _plan(commands, opts) {
        return Object.assign({ commands, interruptible: true, priority: 'high' }, opts || {});
    }

    /**
     * Longest utterance the fast path will act on. Spoken commands are short
     * and imperative; past this we hand over to the LLM, which can read intent
     * from context instead of pattern-matching a stray keyword.
     */
    const MAX_WORDS = 6;

    /**
     * Ordered rules — first match wins. Keep destructive/stop rules early.
     * Each rule: { label, re, plan }.
     */
    const RULES = [
        {
            label: 'stop',
            re: /\b(stop|halt|freeze|quieto|parate?|alto|fermati|ferma|arrete?|stopp|anhalten|para|pare)\b/,
            // "stop being sarcastic" is conversation, not a halt command. The
            // word gate alone does not catch it (five words), so the most
            // misfire-prone rule carries its own negative guard.
            not: /\b((dont|don t) stop|never stop|stop\s+(being|saying|talking|telling|pretending|acting|asking|joking|doing|making|trying|thinking|worrying|calling|treating|it|that|this)|para\s+de\s+\w+|deja\s+de\s+\w+|smetti\s+di\s+\w+)\b/,
            plan: () => _plan([{ type: 'stop' }]),
        },
        {
            label: 'follow',
            re: /\b(follow me|come with me|sigueme|ven conmigo|seguimi|vieni con me|suis moi|folge mir|komm mit|segue me|siga me|me segue)\b/,
            plan: () =>
                _plan([
                    { type: 'look_at', target: 'user_head' },
                    { type: 'expression', name: 'happy', weight: 0.4 },
                    { type: 'follow', target: 'user', distance_m: 1.5 },
                ]),
        },
        {
            label: 'stop_follow',
            re: /\b(stop following|wait here|stay( here)?|no me sigas|espera(me)? aqui|quedate|aspetta qui|resta qui|attends ici|reste ici|warte hier|bleib hier|espera aqui|fica ai)\b/,
            plan: () => _plan([{ type: 'stop_follow' }, { type: 'idle', name: 'idle' }]),
        },
        {
            label: 'come_here',
            re: /\b(come (here|closer|to me)|ven( aqui| aca)?|acercate|vieni( qui| qua)?|avvicinati|viens( ici)?|approche|komm( her)?|vem( ca| aqui)?|chega mais)\b/,
            plan: () =>
                _plan([
                    { type: 'look_at', target: 'user_head' },
                    { type: 'approach', target: 'user', distance_m: 0.9 },
                ]),
        },
        {
            label: 'go_away',
            re: /\b(go away|back off|step back|move back|get back|alejate|atras|retrocede|allontanati|indietro|va t en|recule|eloigne toi|geh weg|zuruck|afasta te|para tras)\b/,
            plan: () =>
                _plan([
                    { type: 'expression', name: 'sad', weight: 0.3 },
                    { type: 'retreat', distance_m: 2.0 },
                ]),
        },
        // Tier A — rotation only, so these run whatever the movement policy is.
        // MUST come before `stand`: its `levanta( te)?` alternative also matches
        // "levanta la mano", which would stand her up instead of raising a hand.
        {
            label: 'turn_around',
            re: /\b(turn\s*a?round|turn back|spin\s*a?round|date la vuelta|da(te)? la vuelta|girate|voltate|girati|voltati|gira ti|fais demi tour|tourne toi|dreh dich um|umdrehen|vira te|da meia volta|fammi vedere la schiena|mostrami la schiena|show me your back|let me see your back|muestrame la espalda|montre moi ton dos|zeig mir deinen rucken|mostra me as costas)\b/,
            plan: () => _plan([{ type: 'turn', degrees: 180 }]),
        },
        {
            label: 'turn_to_me',
            re: /\b(turn (to|toward|towards) me|face me|girate hacia mi|voltate hacia mi|mirame de frente|girati verso di me|tourne toi vers moi|dreh dich zu mir|vira te para mim)\b/,
            plan: () =>
                _plan([
                    { type: 'turn', target: 'user' },
                    { type: 'look_at', target: 'user_head' },
                ]),
        },
        {
            label: 'raise_hand',
            re: /\b(raise (your |the )?hand|put (your )?hand up|hands? up|levanta (la |tu )?mano|alza (la )?mano|leve (la )?main|heb die hand|hand hoch|levante a mao)\b/,
            plan: () =>
                _plan([
                    { type: 'raise_hand', side: 'right' },
                    { type: 'look_at', target: 'user_head' },
                ]),
        },
        {
            label: 'sit',
            re: /\b(sit( down)?|have a seat|take a seat|sientate|siediti|mettiti sedut[oa]|sedersi|assieds toi|setz dich|hinsetzen|senta( te)?|sente se)\b/,
            plan: () => _plan([{ type: 'sit', target: 'nearest_seat' }]),
        },
        {
            label: 'lay',
            re: /\b(lie down|lay down|lie( on the)? (floor|ground)|lay( on the)? (floor|ground)|acuestate|tumbate|sdraiati|stenditi|allonge toi|leg dich( hin)?)\b/,
            plan: () => _plan([{ type: 'lay' }]),
        },
        {
            label: 'stand',
            re: /\b(stand( up)?|get up|levantate|de pie|alzati|in piedi|leve toi|debout|steh auf|aufstehen|levanta( te)?)\b/,
            plan: () => _plan([{ type: 'stand' }]),
        },
        {
            label: 'handshake',
            re: /\b(shake (my )?hands?|hand ?shake|give me your hand|dame la mano|estrecha(me)? la mano|dammi la mano|stringimi la mano|serre moi la main|donne moi ta main|gib mir die hand|hand geben|me da a mao|aperto de mao)\b/,
            plan: () =>
                _plan([
                    { type: 'look_at', target: 'user_head' },
                    { type: 'approach', target: 'user', distance_m: 0.65 },
                    { type: 'offer_hand', side: 'right' },
                    { type: 'wait_contact', radius_m: 0.14, timeout_s: 6 },
                    { type: 'gesture', name: 'handshake' },
                    { type: 'expression', name: 'happy', weight: 0.6 },
                    { type: 'nod' },
                ]),
        },
        {
            label: 'high_five',
            re: /\b(high ?five|choca( esos)? cinco|dammi il cinque|tape la|top la|gib mir funf|toca aqui)\b/,
            plan: () =>
                _plan([
                    { type: 'approach', target: 'user', distance_m: 0.7 },
                    { type: 'offer_hand', side: 'right', name: 'high_five' },
                    { type: 'wait_contact', radius_m: 0.16, timeout_s: 5 },
                    { type: 'expression', name: 'happy', weight: 0.8 },
                ]),
        },
        {
            label: 'look_at_me',
            re: /\b(look at me|mirame|guardami|regarde moi|schau mich an|sieh mich an|olha (pra|para) mim)\b/,
            plan: () => _plan([{ type: 'look_at', target: 'user_head' }]),
        },
        {
            label: 'wave',
            re: /\b(wave|say hi|saluda(me)?|salutami|fai ciao|salue|fais coucou|wink mal|acena)\b/,
            plan: () =>
                _plan([
                    { type: 'wave', side: 'right' },
                    { type: 'expression', name: 'happy', weight: 0.5 },
                ]),
        },
        {
            label: 'dance',
            re: /\b(dance|baila|balla|balliamo|danse|tanz(e)?|danca)\b/,
            plan: () =>
                _plan([
                    { type: 'gesture', name: 'dance' },
                    { type: 'expression', name: 'happy', weight: 0.7 },
                ]),
        },
        // MO9. Gestures the tk256 VRMA set makes possible. "bye" is the commonest way a chat
        // ends; now she waves goodbye instead of standing still. Plain "ciao" is left out — it is
        // hello as often as goodbye.
        {
            label: 'goodbye',
            re: /\b(bye|bye bye|goodbye|good bye|see you|see ya|arrivederci|adios|au revoir|tsch(u|ü)ss|auf wiedersehen)\b/,
            plan: () =>
                _plan([
                    { type: 'gesture', name: 'goodbye' },
                    { type: 'expression', name: 'happy', weight: 0.5 },
                ]),
        },
        {
            label: 'jump',
            re: /\b(jump|hop|salta|saute)\b/,
            plan: () => _plan([{ type: 'gesture', name: 'jump' }]),
        },
        {
            label: 'look_around',
            re: /\b(look around|guardati (intorno|attorno)|mira alrededor|regarde autour|schau dich um)\b/,
            plan: () => _plan([{ type: 'gesture', name: 'look_around' }]),
        },
        // MO10. The BOOTH VRoid gestures people actually ask for. "show me your outfit" pairs with
        // the wardrobe: after a try-on she shows the look off head to toe. Bare "gira" is left out
        // — it is how Italian says "turn around", which has its own locomotion rule above.
        {
            label: 'peace_sign',
            re: /\b(peace sign|do a peace sign|v sign|segno della pace|fai la v|signo de paz|haz la v)\b/,
            plan: () =>
                _plan([
                    { type: 'gesture', name: 'peace_sign' },
                    { type: 'expression', name: 'happy', weight: 0.6 },
                ]),
        },
        {
            label: 'spin',
            re: /\b(spin|twirl|spin around|do a spin|fai una giravolta|giravolta|gira su te stessa|da una vuelta|haz un giro)\b/,
            plan: () =>
                _plan([
                    { type: 'gesture', name: 'spin' },
                    { type: 'expression', name: 'happy', weight: 0.5 },
                ]),
        },
        {
            label: 'model_pose',
            re: /\b(strike a pose|pose for me|model pose|do a pose|fai una posa|posa da modella|haz una pose|posa para m[ií])\b/,
            plan: () => _plan([{ type: 'gesture', name: 'model_pose' }]),
        },
        {
            label: 'show_outfit',
            re: /\b(show me your (outfit|clothes|look|dress)|show off your (outfit|look)|fammi vedere (il tuo |il |tuo )?(vestito|outfit|look)|mu[eé]strame tu (ropa|outfit|look))\b/,
            plan: () =>
                _plan([
                    { type: 'gesture', name: 'show_outfit' },
                    { type: 'expression', name: 'happy', weight: 0.5 },
                ]),
        },
        {
            label: 'bow',
            re: /\b(bow|take a bow|reverencia|inclinati|inchino|salut|verbeug dich|reverencia)\b/,
            plan: () => _plan([{ type: 'gesture', name: 'bow' }]),
        },
        {
            label: 'nod_yes',
            re: /\b(nod|say yes|di que si|annuisci|di si|dis oui|nick(e)?|acena que sim)\b/,
            plan: () => _plan([{ type: 'nod' }]),
        },
        {
            label: 'backflip',
            re: /\b(backflip|do a flip|salto (mortal|atras)|salto mortale|fais un salto|mach einen salto)\b/,
            plan: () =>
                _plan([
                    { type: 'gesture', name: 'backflip' },
                    { type: 'expression', name: 'surprised', weight: 0.6 },
                ]),
        },
    ];

    /**
     * MO3. Typos of the short commands people type in a hurry ("sirt down" was answered "Mi siedo
     * qui vicino" while she stood still: no rule matched, so the body was never asked).
     *
     * Two layers, both only for an utterance of at most three words that matched no rule as typed,
     * and only on its first word:
     *   - TYPOS: explicit misspellings of four-letter verbs, where an edit-distance rule would also
     *     turn real words into commands ("set"/"sat" -> sit, "step"/"top" -> stop).
     *   - one edit (insert, delete, substitute or swap two neighbours) away from a longer verb in
     *     FUZZY, for words of five letters or more, never a word in KEEP.
     */
    const TYPOS = {
        sirt: 'sit',
        sitt: 'sit',
        siit: 'sit',
        ist: 'sit',
        sti: 'sit',
        sitdown: 'sit down',
        stpo: 'stop',
        sotp: 'stop',
        stopp: 'stop',
        wvae: 'wave',
        wavr: 'wave',
    };
    const FUZZY = ['dance', 'stand', 'follow', 'siediti', 'seguimi', 'alzati', 'fermati', 'balla'];
    const KEEP = [
        'lance',
        'dunce',
        'danes',
        'stands',
        'hollow',
        'fellow',
        'allow',
        'ballo',
        'palla',
        'bella',
        'stance',
    ];

    function _oneEdit(a, b) {
        if (a === b) return false;
        const la = a.length,
            lb = b.length;
        if (Math.abs(la - lb) > 1) return false;
        if (la === lb) {
            const diff = [];
            for (let i = 0; i < la; i++) if (a[i] !== b[i]) diff.push(i);
            if (diff.length === 1) return true;
            return (
                diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]]
            );
        }
        const [s1, s2] = la < lb ? [a, b] : [b, a];
        let i = 0;
        while (i < s1.length && s1[i] === s2[i]) i++;
        return s1.slice(i) === s2.slice(i + 1);
    }

    function _corrected(t) {
        const words = t.split(' ');
        if (words.length > 3) return null;
        const first = words[0];
        let fixed = TYPOS[first] || null;
        if (!fixed && first.length >= 5 && KEEP.indexOf(first) === -1) {
            fixed = FUZZY.find((verb) => _oneEdit(first, verb)) || null;
        }
        return fixed ? [fixed].concat(words.slice(1)).join(' ') : null;
    }

    /**
     * UN2. Japanese, Korean and Chinese, which Private speaks and these rules did not.
     *
     * Matched against the raw text (NFC), not `_normalize`: NFD splits a Hangul syllable into
     * jamo and drops a kana's voicing mark (脱いで → 脱いて), so a pattern written the way people
     * type it would never match the normalised string. Each entry names an existing rule and
     * reuses its plan, so a pose asked for in Japanese moves her exactly as it does in English.
     * Short messages only: these scripts have no spaces, so the word count cannot tell a command
     * from a sentence, and a length bound does that job instead. Order matters: a spin is
     * checked before turning round, a dance before a jump.
     */
    const CJK_MAX = 16;
    const CJK_RULES = [
        { label: 'spin', re: /くるっと回って|一回転|回転して|빙글|한\s?바퀴|转个圈|转一圈|转圈/u },
        {
            label: 'turn_around',
            re: /振り向いて|後ろを向いて|背中を見せて|回って|뒤돌아|돌아\s?봐|돌아\s?서|등\s?보여\s?줘|转过身|转身|让我看看你的背/u,
        },
        { label: 'sit', re: /座って|座ろう|座りなさい|앉아|坐下|坐吧|请坐/u },
        { label: 'lay', re: /横になって|寝転んで|寝そべって|누워|躺下|躺着/u },
        { label: 'stand', re: /立って|立ち上がって|일어나|일어서|站起来|起来/u },
        { label: 'dance', re: /踊って|踊ろう|춤\s?춰|춤추자|跳舞|跳支舞/u },
        { label: 'wave', re: /手を振って|손\s?흔들어|挥手|挥挥手/u },
        { label: 'model_pose', re: /ポーズ|포즈|摆个姿势|摆姿势|摆个pose/u },
        { label: 'show_outfit', re: /服を見せて|옷\s?보여\s?줘|看看你的衣服|展示一下/u },
        { label: 'bow', re: /お辞儀|おじぎ|인사해|鞠躬/u },
        { label: 'look_at_me', re: /こっち見て|こっちを見て|나를\s?봐|날\s?봐|看着我|看我/u },
        { label: 'come_here', re: /こっちに来て|こっちおいで|이리\s?와|过来/u },
        { label: 'peace_sign', re: /ピース|브이|比个耶|比耶/u },
        { label: 'nod_yes', re: /うなずいて|끄덕|点头/u },
        { label: 'jump', re: /ジャンプ|점프|跳一下|跳起来/u },
    ];

    function _cjkRule(raw) {
        const text = String(raw || '')
            .normalize('NFC')
            .trim();
        if (!text || text.length > CJK_MAX) return null;
        for (const entry of CJK_RULES) {
            if (!entry.re.test(text)) continue;
            const rule = RULES.find((r) => r.label === entry.label);
            if (rule) return rule;
        }
        return null;
    }

    function _firstRule(t) {
        for (let i = 0; i < RULES.length; i++) {
            const rule = RULES[i];
            if (!rule.re.test(t)) continue;
            if (rule.not && rule.not.test(t)) continue; // known false positive
            return rule;
        }
        return null;
    }

    /**
     * Match an utterance against the fast-path table.
     * @param {string} text - raw user utterance (voice or typed)
     * @returns {{label: string, plan: Object}|null}
     */
    function match(text) {
        const t = _normalize(text);
        if (!t || t.length > 160) return null; // long sentences → let the LLM reason

        // Commands are short and imperative. Anything longer is a sentence
        // that merely happens to contain a command word ("I was going to say
        // we should stop by the shop later"), and the LLM has the context to
        // judge it. This is a cheap filter, not a complete one — see the `not`
        // guards, which catch short false positives the word count cannot.
        if (t.split(' ').length > MAX_WORDS) return null;

        let rule = _firstRule(t);
        let corrected = null;
        if (!rule) {
            corrected = _corrected(t);
            rule = corrected ? _firstRule(corrected) : null;
        }
        if (!rule) rule = _cjkRule(text);
        if (!rule) return null;
        const hit = { label: rule.label, plan: rule.plan() };
        if (corrected) hit.corrected = corrected;
        return hit;
    }

    return { match, RULES, CJK_RULES, _normalize, _corrected, _cjkRule, MAX_WORDS };
})();

if (typeof window !== 'undefined') window.NEXUS_INTENT_FASTPATH = IntentFastPath;
if (typeof module !== 'undefined' && module.exports) module.exports = IntentFastPath;
