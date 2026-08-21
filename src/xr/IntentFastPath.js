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
     * Ordered rules — first match wins. Keep destructive/stop rules early.
     * Each rule: { label, re, plan }.
     */
    const RULES = [
        {
            label: 'stop',
            re: /\b(stop|halt|freeze|quieto|parate?|alto|fermati|ferma|arrete?|stopp|anhalten|para|pare)\b/,
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
        {
            label: 'sit',
            re: /\b(sit( down)?|have a seat|take a seat|sientate|siediti|assieds toi|setz dich|hinsetzen|senta( te)?|sente se)\b/,
            plan: () => _plan([{ type: 'sit', target: 'nearest_seat' }]),
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
            re: /\b(dance|baila|balla|danse|tanz(e)?|danca)\b/,
            plan: () =>
                _plan([
                    { type: 'gesture', name: 'dance' },
                    { type: 'expression', name: 'happy', weight: 0.7 },
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
     * Match an utterance against the fast-path table.
     * @param {string} text - raw user utterance (voice or typed)
     * @returns {{label: string, plan: Object}|null}
     */
    function match(text) {
        const t = _normalize(text);
        if (!t || t.length > 160) return null; // long sentences → let the LLM reason
        for (let i = 0; i < RULES.length; i++) {
            if (RULES[i].re.test(t)) {
                return { label: RULES[i].label, plan: RULES[i].plan() };
            }
        }
        return null;
    }

    return { match, RULES, _normalize };
})();

if (typeof window !== 'undefined') window.NEXUS_INTENT_FASTPATH = IntentFastPath;
if (typeof module !== 'undefined' && module.exports) module.exports = IntentFastPath;
