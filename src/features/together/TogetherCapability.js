/**
 * Telling her what she can actually do (batch T2).
 *
 * The transcript this exists to change:
 *
 *     YOU    can you find music about relaxation
 *     NEXUS  I'm sorry, but I don't have the capability to directly find specific music…
 *     YOU    can you play it
 *     NEXUS  I'm sorry, but I don't have the ability to directly play music.
 *
 * She was right. Nothing in her system prompt had ever mentioned that this app can search
 * YouTube and put a player in the chat, so "I can't" was the only honest answer available to
 * her. Adding patterns to the intent matcher would not have fixed it either: a pattern that
 * misses hands the message to the same uninformed model, and no list of patterns is ever
 * complete.
 *
 * So the fix is one paragraph, appended to the prompt she already gets, at the four sites that
 * already append `NEXUS_MOTION` and `NEXUS_CURRENT_MEDIA`.
 *
 * ## Why a tag and not a tool call
 *
 * This app talks to OpenAI, Claude, watsonx, Ollama and OllaBridge, and only some of those
 * expose tool calling through this client. A fenced tag works on every one of them, degrades to
 * visible text on none of them (the parser strips it before display and before TTS — batch T5),
 * and costs nothing to add. Tool calling is the better mechanism where it exists, and the wrong
 * one to build on when four of five paths cannot use it.
 *
 * ## Why the instruction is worded the way it is
 *
 * *Do not ask permission first* — the transcript's second turn is her asking whether to search,
 * getting "yes", and then listing genres instead of playing anything. Every extra turn is a
 * chance to lose the thread, and somebody who said "play relaxing music" has already answered
 * the question they are about to be asked.
 *
 * *Including indirectly* — "I want to relax" is a request for music. Recognising that is the
 * whole reason the model is in this path at all; a regex could have caught "play relaxing
 * music" on its own.
 *
 * *Exactly one* — a reply that emits three directives would start three things. T5 enforces
 * that on the parsing side too, because an instruction is not a guarantee.
 *
 * Empty when Together is off, so a chat with Together off sends the prompt it has always sent,
 * byte for byte.
 *
 * Exposes: window.NEXUS_TOGETHER_CAPABILITY
 */
(function (global) {
    'use strict';

    /** The tag the model emits. Chosen to be something ordinary prose will not contain. */
    const OPEN = '<play';
    const CLOSE = '</play>';

    function sw() {
        return global && global.NEXUS_TOGETHER_SWITCH ? global.NEXUS_TOGETHER_SWITCH : null;
    }

    /** Whether anything can actually search right now — no point promising what cannot run. */
    function canSearch() {
        const registry = global && global.NEXUS_DISCOVERY ? global.NEXUS_DISCOVERY : null;
        if (registry && typeof registry.forCapability === 'function') {
            try {
                if (registry.forCapability('video.search') || registry.forCapability('music.search')) {
                    return true;
                }
            } catch (_) {
                /* a registry that throws is a registry that cannot search */
            }
        }
        // The keyless samples are a real answer: with no API key anywhere she can still play
        // something, so she can still truthfully say she can play something.
        const samples = global && global.NEXUS_DISCOVERY_SAMPLES ? global.NEXUS_DISCOVERY_SAMPLES : null;
        return Boolean(samples && typeof samples.forCapability === 'function');
    }

    const INSTRUCTION = [
        '',
        'MEDIA YOU CAN PLAY',
        'You can search for and play music and video directly in this chat. When someone asks',
        'for something to watch or listen to — including indirectly, as in "I want to relax" or',
        '"I need to focus" — choose something and play it by writing, on its own line:',
        '  <play kind="music">search terms</play>',
        'Use kind="video" for something to watch. Say one short sentence about what you are',
        'putting on, and write the tag. Choose something yourself and play it: do not ask',
        'permission, do not ask what mood or genre they want, and do not propose ("how about',
        'some acoustic guitar?") — proposing is asking. If the request is vague, pick something',
        'that fits and play it; they will tell you if they wanted something else. Do not list',
        'options unless you were asked for options. Write at most one tag per reply.',
        '',
        'NEVER write a URL, a link, or a video ID yourself, and never name a specific track or',
        'video as though you had already found it. You have not searched — the app does that',
        'when it reads your tag, and it shows the real result it found. A link you write is a',
        'guess that looks like a fact, and it will be wrong.',
        'Earlier messages in this chat include cards the app itself posted, which name a real',
        'track and its link. Those are the app speaking, not you. Never copy or imitate their',
        'wording — writing one yourself produces a card that looks official and is invented.',
    ].join('\n');

    /**
     * The paragraph to append, or `''`.
     *
     * `''` in three cases, each of them a case where the promise would be false: Together is
     * off, the switch module is missing, or nothing can search.
     */
    function systemPromptSuffix() {
        const state = sw();
        if (!state || !state.isOn()) {
            return '';
        }
        if (!canSearch()) {
            return '';
        }
        return `\n${INSTRUCTION}\n`;
    }

    const api = { OPEN, CLOSE, INSTRUCTION, canSearch, systemPromptSuffix };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (global) {
        global.NEXUS_TOGETHER_CAPABILITY = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
