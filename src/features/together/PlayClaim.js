/**
 * Doing what she just said she would (batch T8).
 *
 * T5 gave her one way to play something: write `<play kind="…">query</play>` and the reply
 * handler runs it. Measured against the real gateway, that tag arrives 18 times in 20. The
 * other two are the problem this file exists for, because of *how* they fail:
 *
 *     YOU    I want watch a very romantic video
 *     NEXUS  Playing a romantic video for you. 💕
 *            → nothing plays
 *
 * That is worse than the apology T2 removed. "I can't do that" was at least true. This is the
 * app stating that it did something it did not do, and the user sitting there waiting for a
 * video that is never coming. A feature that works nine times in ten and lies the tenth time
 * is not ninety percent of a feature.
 *
 * ## The rule
 *
 * If a reply **claims** to be playing something, and no directive ran, play what the user
 * actually asked for.
 *
 * Every word of that is load-bearing:
 *
 * **Claims.** Not "mentions music" — claims to be acting, now. "Playing…", "here's…", "putting
 * something on". A reply that says *"I could put something on if you like"* has made no claim
 * and starts nothing; neither does one discussing a song. The alternative — playing whenever
 * media is mentioned — would have her start a track because somebody asked what her favourite
 * band is.
 *
 * **No directive ran.** This never competes with T5. A reply carrying a working tag is handled
 * there and this is not consulted, so nothing can play twice.
 *
 * **What the user actually asked for.** The query comes from the user's own message, held by
 * `PlayFollowUp` — never from the reply. She said "a romantic video" without saying which one;
 * inventing a specific search from her prose would be guessing at a request nobody made, and
 * `PlayFollowUp` already holds the searchable part of what the person typed. If it holds
 * nothing — because the user never asked for media — nothing plays, whatever the reply says.
 * The claim is permission to act on a request that exists, not a reason to invent one.
 *
 * ## Why this lives beside the parser rather than inside it
 *
 * `PlayDirective` answers "what did the model ask for". This answers "what did the model say
 * it had done". They fail in opposite directions — the first is silent when the tag is absent,
 * the second is wrong when it fires without a request — and keeping them separate means each
 * can be read, and mutated, on its own terms.
 *
 * Exposes: window.NEXUS_PLAY_CLAIM
 */
(function (global) {
    'use strict';

    /**
     * A reply that says it is doing it, right now.
     *
     * Anchored at a sentence start rather than searched for anywhere, so "I'm not playing
     * anything until you tell me the genre" cannot match on the word `playing` alone. Present
     * and immediate only: "I'll play something later" is a promise about the future and starts
     * nothing.
     *
     * The verb list is an enumeration, and enumerations are never complete — "Pulling up a
     * sweet, romantic video for you" was found by running the real model, not by thinking
     * harder. That is the honest limit of this file, and the reason the tag exists at all:
     * this is a net under T5, not a replacement for it. Each verb here was added because a
     * real reply used it, and none was added on speculation.
     */
    const CLAIM =
        /(?:^|[.!?]\s+|\n)\s*(?:ok(?:ay)?[,!.\s]+|sure[,!.\s]+|alright[,!.\s]+)?(?:i'?m |i am |i'?ll |i will |let me |now |try )?(?:play|plays|playing|put on|putting on|throw(?:ing)? on|start|starting|queue up|queuing up|cueing up|pull(?:ing)? up|bring(?:ing)? up|fir(?:e|ing) up|spin(?:ning)? up|load(?:ing)?|get(?:ting)?|recommend(?:ing)?|here'?s|here is|here you go|let'?s (?:listen|watch)|enjoy)\b/i;

    /**
     * A promise about later, which starts nothing.
     *
     * `I'll put on some calming music` was the reply that made `I'll` admissible: in a chat
     * where the app can play, that is the action, not a plan to act. But `I'll put something
     * on later` is genuinely a plan, and the difference is one word — so the word is what this
     * looks for, rather than the tense.
     */
    const DEFERRED = /\b(?:later|tomorrow|in a (?:bit|moment|minute|while)|afterwards|once you|when you)\b/i;

    /**
     * The claim, but explicitly about media.
     *
     * "Here's what I found about the weather" is a claim shape with nothing to do with playing,
     * and firing on it would start a video because she answered a question. So the reply has to
     * both claim to be acting *and* be talking about something playable.
     */
    const ABOUT_MEDIA =
        /\b(song|songs|music|track|tracks|tune|tunes|album|playlist|mix|radio|video|videos|clip|clips|movie|film|soundtrack|ost|beats|sound|sounds|instrumental|something to (?:listen|watch))\b/i;

    /**
     * Claims that are about media by construction.
     *
     * "Let's listen to something calm" names no media noun, and requiring one would miss it —
     * but there is nothing else "let's listen" could be about. These satisfy the media test on
     * their own rather than being bolted into `ABOUT_MEDIA`, where they would also let
     * *"we could listen to your idea"* through.
     */
    const SELF_EVIDENT = /\b(?:let'?s (?:listen|watch)|putting on|queuing up|cueing up)\b/i;

    /** A reply that is asking rather than acting. A question has not claimed anything. */
    const ASKING = /\?\s*$/;

    /**
     * Did this reply claim to be playing something?
     *
     * Two positives and one veto, in that order — a reply ending in a question mark is asking
     * what to play, however confidently the rest of it reads.
     */
    function claims(text) {
        const raw = String(text === null || text === undefined ? '' : text).trim();
        if (!raw || ASKING.test(raw) || DEFERRED.test(raw)) {
            return false;
        }
        if (!CLAIM.test(raw)) {
            return false;
        }
        return ABOUT_MEDIA.test(raw) || SELF_EVIDENT.test(raw);
    }

    /**
     * What to play to make the claim true, or `null`.
     *
     * `null` is the common answer and the safe one: no claim, no held request, or Together
     * switched off. The caller does nothing and the reply stands as written — which is the
     * right outcome when there was never a request behind it.
     */
    /**
     * She said nothing at all.
     *
     * Observed live: `free-best` is a reasoning model, and it sometimes spends its whole token
     * budget thinking and returns empty content. The app rendered an empty bubble and nothing
     * played, which from the user's side is the request vanishing.
     *
     * Silence is not a claim — `claims('')` is false and stays false, because nothing was
     * claimed. But it is the strongest available evidence that she did nothing, and when the
     * person has just asked for music, playing what they asked for beats an empty bubble by
     * any measure. So silence gets its own door into the backstop rather than being smuggled
     * through the claim test.
     */
    function silent(text) {
        return String(text === null || text === undefined ? '' : text).trim() === '';
    }

    function backstop(reply, options = {}) {
        if (!claims(reply) && !silent(reply)) {
            return null;
        }
        const sw = options.sw || (global && global.NEXUS_TOGETHER_SWITCH) || null;
        if (sw && typeof sw.isOn === 'function' && !sw.isOn()) {
            return null;
        }
        const follow = options.follow || (global && global.NEXUS_PLAY_FOLLOWUP) || null;
        if (!follow || typeof follow.peek !== 'function') {
            return null;
        }
        const pending = follow.peek();
        if (!pending || !pending.topic) {
            return null;
        }
        return { query: pending.topic, kind: pending.kind || 'video', source: 'claim' };
    }

    /**
     * Make the claim true. Returns whether anything was started.
     *
     * Not awaited, for the same reason `PlayDirective.consume` does not await: the sentence
     * should appear when she says it, not after a search round trip.
     */
    function honour(reply, options = {}) {
        const wanted = backstop(reply, options);
        if (!wanted) {
            return false;
        }
        const intent = options.intent || (global && global.NEXUS_MEDIA_INTENT) || null;
        if (!intent || typeof intent.fulfil !== 'function') {
            return false;
        }
        try {
            Promise.resolve(intent.fulfil(wanted)).catch(() => null);
        } catch (_) {
            // A backstop that throws must not take the reply down with it.
            return false;
        }
        return true;
    }

    const api = { CLAIM, ABOUT_MEDIA, SELF_EVIDENT, DEFERRED, claims, silent, backstop, honour };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (global) {
        global.NEXUS_PLAY_CLAIM = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
