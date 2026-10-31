/**
 * ARConversation — AR1. Placing her starts the conversation, and it is the one she was already in.
 *
 * Phone AR already had a conversation bridge (initAROverlay in src/main.js): TAP TO PLACE opens
 * the microphone, SEND goes through handleUserMessage, replies play as captions. Three things in
 * it were wrong, and this module holds the rules that replace them, pure so they are tested:
 *
 *   1. A tap that placed nothing still said "Avatar placed — talk to me!" and opened the mic.
 *      ARSupport.placeAvatarAtReticle returns early with no surface under the reticle (and with no
 *      avatar loaded), but it returned nothing either way, so the tap handler could not tell. It
 *      now returns { placed, reason }; `afterPlaceTap` turns that into what the status line says,
 *      whether the microphone may open, and the haptic. The mic opens only on a real placement —
 *      the tap is still the user gesture that authorises it, so the next tap, on a surface, does.
 *
 *   2. Every typed AR message appeared twice. The SEND handler drew a user bubble and then called
 *      handleUserMessage, whose renderer (addMessageToHistory) mirrors every message into AR. The
 *      conversation pipeline is now the only thing that draws a turn.
 *
 *   3. The AR transcript was its own little list: whatever had been mirrored into it since page
 *      load, including desktop chat typed while AR was closed, capped at eight. It now opens on the
 *      conversation itself — the last turns of the store the model reads (`_surface().history()`,
 *      which holds replies with their directive tags already stripped) — rebuilt on every entry,
 *      so leaving and re-entering AR can neither lose nor repeat a turn.
 *
 * IIFE with the dual export; index.html loads it after ARCoachingOverlay, main.js reads
 * window.NEXUS_AR_CONVERSATION when an AR session starts or a tap lands. Tested in
 * tests/ar-conversation.test.js.
 */
(function (global) {
    'use strict';

    const TRANSCRIPT_MAX = 8;

    /**
     * The AR transcript's opening contents: user and assistant turns that carry text, oldest
     * first, the last `max` of them. Roles become the overlay's 'user' / 'bot'.
     */
    function seedTranscript(history, max) {
        const n = max == null ? TRANSCRIPT_MAX : max;
        const out = [];
        for (const m of Array.isArray(history) ? history : []) {
            if (!m || typeof m.content !== 'string') continue;
            const text = m.content.trim();
            if (!text) continue;
            if (m.role === 'user') out.push({ role: 'user', text });
            else if (m.role === 'assistant') out.push({ role: 'bot', text });
        }
        return n > 0 ? out.slice(-n) : [];
    }

    /**
     * What a tap on TAP TO PLACE leads to, from ARSupport.placeAvatarAtReticle's answer:
     * { voice, status, haptic }. `t(key, fallback)` localises; missing keys use the fallback.
     */
    function afterPlaceTap(result, t) {
        const tr = typeof t === 'function' ? t : (_k, fb) => fb;
        if (result && result.placed) {
            return { placed: true, voice: true, status: tr('ar_placed', 'Placed — just talk to me'), haptic: 15 };
        }
        if (result && result.reason === 'no-avatar') {
            return {
                placed: false,
                voice: false,
                status: tr('ar_place_loading', 'She is still loading — tap again in a moment'),
                haptic: 0,
            };
        }
        return {
            placed: false,
            voice: false,
            status: tr('ar_place_no_surface', 'Point at the floor until the ring appears, then tap'),
            haptic: [10, 60, 10],
        };
    }

    const api = { TRANSCRIPT_MAX, seedTranscript, afterPlaceTap };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_AR_CONVERSATION = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
