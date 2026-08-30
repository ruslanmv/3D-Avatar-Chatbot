/**
 * LLMTagAdapter — the `[[emote:…]]` channel (spec v1.1 §6.8, batch B4).
 *
 * ## Why this wraps rather than edits
 *
 * This repo already has an LLM→body channel: `MotionContract` appends a contract, the model
 * ends its reply with a ```motion fence, `MotionBlockParser` masks it while it streams and
 * `MotionIntegration.processReply` executes and strips it. `main.js` calls that facade in
 * exactly three places, and every one of them is a place a tag must not survive.
 *
 * So the tag channel **decorates `window.NEXUS_MOTION`** instead of adding a fourth call
 * site to `main.js`. Spec §1.5 asks for exactly this ("existing managers are wrapped, never
 * rewritten"), the repo's own `BehaviorEngine.js` sets the precedent, and it means the two
 * channels are masked in one pass rather than two — the failure mode §7 warns about.
 *
 * The wrap is idempotent, calls the original first, and is fully restored by `detach()`.
 *
 * ## What it guarantees
 *
 *   - a tag split across token boundaries still parses (the whole accumulated string is
 *     rescanned each time, so a tag arriving as `[[emo` + `te:happy 0.8]]` is one tag);
 *   - a tag never reaches the chat transcript, because `maskStreaming` also hides a
 *     *partial* trailing tag — otherwise `[[emo` flashes on screen for one frame;
 *   - a tag never reaches TTS, because `speakText` is called with `processReply`'s output;
 *   - an unknown name, a malformed tag or one over the rate limit is dropped silently and
 *     the text still renders.
 *
 * Exposes: window.NEXUS_BD_TAG_ADAPTER
 */
const LLMTagAdapter = (() => {
    'use strict';

    /** `[[emote:name]]` or `[[emote:name 0.8]]`. Tolerates stray spacing, nothing else. */
    const TAG = /\[\[\s*emote\s*:\s*([a-z_]+)\s*([01](?:\.\d+)?)?\s*\]\]/gi;

    /**
     * A tag that has begun but not closed, at the very end of the buffer.
     *
     * `[^\]]*` is not enough: `[[emote:happy 0.8]` contains a `]` and is still unterminated,
     * and that exact string leaked one frame of `[[emote:happy 0.8]` onto the screen before
     * a test caught it. What matters is a `[[` with no `]]` after it.
     */
    const PARTIAL_TAIL = /\[\[(?:(?!\]\])[\s\S])*$/;

    const DEFAULTS = {
        whitelist: [],
        maxPerReply: 3,
        minGapMs: 1500,
        defaultIntensity: 0.6,
    };

    /**
     * The pure half: no DOM, no globals, no bus. Given accumulated text it reports which
     * tags are newly complete and hands back text with every tag removed.
     */
    class EmoteTagParser {
        constructor(options = {}) {
            this.options = { ...DEFAULTS, ...options };
            this.reset();
        }

        /** New reply, fresh budget. */
        reset() {
            this._firedAt = new Set(); // character offsets already fired, so none fires twice
            this._count = 0;
            this._lastFiredMs = 0;
            this.dropped = { unknown: 0, rateLimited: 0, budget: 0 };
        }

        /**
         * @param {string} accumulated everything received so far in this reply
         * @param {number} [now] injectable clock, so the gap rule is testable
         * @returns {{name: string, intensity: number, source: string}[]} newly fired intents
         */
        feed(accumulated, now = Date.now()) {
            if (typeof accumulated !== 'string' || !accumulated) return [];
            const fired = [];

            TAG.lastIndex = 0;
            let match;
            while ((match = TAG.exec(accumulated)) !== null) {
                const at = match.index;
                if (this._firedAt.has(at)) continue; // already reported on an earlier token
                this._firedAt.add(at);

                const name = match[1].toLowerCase();
                if (this.options.whitelist.length && !this.options.whitelist.includes(name)) {
                    this.dropped.unknown++;
                    continue;
                }
                if (this._count >= this.options.maxPerReply) {
                    this.dropped.budget++;
                    continue;
                }
                if (this._lastFiredMs && now - this._lastFiredMs < this.options.minGapMs) {
                    this.dropped.rateLimited++;
                    continue;
                }

                const intensity = match[2] === undefined ? this.options.defaultIntensity : Number(match[2]);
                this._count++;
                this._lastFiredMs = now;
                fired.push({ name, intensity, source: 'llm' });
            }
            return fired;
        }

        /** Text with every complete tag removed, and the spacing left tidy. */
        static strip(text) {
            if (typeof text !== 'string') return text;
            return tidy(text.replace(TAG, ''));
        }

        /**
         * Text safe to *display mid-stream*: complete tags gone, and a tag that has only
         * half arrived hidden too. Without the second part the user watches `[[emo` appear
         * and vanish, which is exactly the leak §6.8 says must not happen.
         */
        static maskStreaming(text) {
            if (typeof text !== 'string') return text;
            return tidy(text.replace(TAG, '').replace(PARTIAL_TAIL, ''));
        }
    }

    /**
     * Clean up after a removed tag: the double space it stood in, the space it left before
     * punctuation, and the trailing space at the end of a line or of the reply. Content is
     * never trimmed — only whitespace the tag itself was responsible for.
     */
    function tidy(text) {
        return text
            .replace(/[ \t]{2,}/g, ' ')
            .replace(/[ \t]+([.,!?;:])/g, '$1')
            .replace(/[ \t]+$/gm, '')
            .replace(/[ \t]+$/, '');
    }

    /**
     * The §6.8 contract, appended to whatever contract the app already sends. Worded to sit
     * after MotionContract's block without contradicting it: that one governs the body plan,
     * this one governs momentary emotion.
     */
    function promptSuffix(whitelist) {
        return (
            '\n\nWhen emotionally relevant, append at most one tag per sentence, max 3 per\n' +
            'reply: [[emote:<name> <intensity 0..1>]]\n' +
            `Allowed names: ${whitelist.join(', ')}.\n` +
            'Never invent names. Tags are invisible to the user and stripped before TTS.\n'
        );
    }

    /**
     * Wire the parser to the running app.
     *
     * @param {object} deps
     * @param {object} deps.bus         the Behavior Director's event bus
     * @param {object} deps.config      behavior.config.json
     * @param {object} [deps.motion]    window.NEXUS_MOTION; absent is survivable
     * @returns {{name: string, detach: function}}
     */
    function attach({ bus, config = {}, motion } = {}) {
        const whitelist = config.emoteWhitelist || [];
        const limits = config.emoteRateLimit || {};
        const parser = new EmoteTagParser({
            whitelist,
            maxPerReply: limits.maxPerReply ?? DEFAULTS.maxPerReply,
            minGapMs: limits.minGapMs ?? DEFAULTS.minGapMs,
        });

        const host = motion || (typeof window !== 'undefined' ? window.NEXUS_MOTION : null);
        const restore = [];
        let lastAccumulated = '';

        if (host && !host.__nexusBdWrapped) {
            wrap(host, 'maskStreaming', (original) => (text) => {
                // One pass, both channels: the motion fence first (its own masker), then
                // the emote tags. Masking twice in two places is how one of them gets missed.
                const emitted = parser.feed(text);
                for (const intent of emitted) bus.emit('intent', intent);

                const delta =
                    typeof text === 'string' && text.startsWith(lastAccumulated)
                        ? text.slice(lastAccumulated.length)
                        : text;
                if (delta) bus.emit('llm:token', { text: delta });
                lastAccumulated = typeof text === 'string' ? text : '';

                return EmoteTagParser.maskStreaming(original ? original(text) : text);
            });

            wrap(host, 'processReply', (original) => (text) => {
                // The non-streaming path never touches maskStreaming, so the final text is
                // also where a reply's first and only chance to fire its tags can happen.
                for (const intent of parser.feed(text)) bus.emit('intent', intent);
                const cleaned = EmoteTagParser.strip(original ? original(text) : text);
                parser.reset();
                lastAccumulated = '';
                return cleaned;
            });

            wrap(host, 'systemPromptSuffix', (original) => (...args) => {
                const base = original ? original(...args) : '';
                return `${base}${promptSuffix(whitelist)}`;
            });

            host.__nexusBdWrapped = true;
        }

        function wrap(target, method, factory) {
            // Keep the raw original for restoring and a bound one for calling. Restoring the
            // bound copy would leave `motion.maskStreaming` a different function object than
            // the one that was there before, which is not what "restores it exactly" means.
            const original = typeof target[method] === 'function' ? target[method] : null;
            target[method] = factory(original ? original.bind(target) : null);
            restore.push(() => {
                if (original) target[method] = original;
                else delete target[method];
            });
        }

        return {
            name: 'LLMTagAdapter',
            parser,
            detach() {
                for (const undo of restore.splice(0).reverse()) undo();
                if (host) delete host.__nexusBdWrapped;
                parser.reset();
            },
        };
    }

    return { attach, EmoteTagParser, promptSuffix, TAG_RE: TAG };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_TAG_ADAPTER = LLMTagAdapter;
if (typeof module !== 'undefined' && module.exports) module.exports = LLMTagAdapter;
