/**
 * ShareCard — "she remembered" (addendum v1.2 §15.2, batch B25).
 *
 * The second distribution loop, and the quieter of the two. A clip is a thing that happened;
 * a share card is a thing she *knew*. It renders one curiosity callback — the line she said,
 * when, and a frame of her face at the moment she said it — as a PNG the user can post.
 *
 * ## It renders a record, never an invention
 *
 * The quote has to come from an actual `interest` record's callback (B16). A card that
 * generated a plausible-sounding "she remembered" would be a fabrication of the user's own
 * relationship with the thing, printed and shareable, and the fact that it would usually be
 * roughly right is what makes it worse rather than better. So `render()` takes a record and
 * refuses one without a quote, and a test asserts the refusal.
 *
 * ## The portrait is a frame, not a render
 *
 * The card draws whatever canvas it is handed. It does not pose her, light her, or pick a
 * flattering angle — a "she remembered" card showing a moment that did not look like that
 * is the same fabrication one layer down. If there is no frame, the card renders without
 * one: a missing portrait is a design case here, not an error branch.
 *
 * ## Nothing here reaches the network
 *
 * Audited for the whole of `src/features/clips/`, this file included. The PNG is a data URL;
 * B25's button hands it to the user and nobody else.
 *
 * Exposes: window.NEXUS_BD_SHARE_CARD
 */
const ShareCard = (() => {
    'use strict';

    /** Instagram-ish. Big enough to read on a phone, small enough to be a data URL. */
    const CARD = { width: 1080, height: 1350 };

    const PADDING = 72;

    /** The portrait sits at the top, the quote under it, the timestamp last. */
    const PORTRAIT = { height: 620 };

    const TYPE = {
        quote: { size: 58, weight: 600, colour: '#f2f6ff', lineHeight: 78 },
        topic: { size: 34, weight: 500, colour: '#8fb4e8' },
        stamp: { size: 30, weight: 400, colour: '#7e8ba3' },
    };

    const BACKGROUND = '#0b1017';

    /** A quote longer than this is a paragraph, and a paragraph is not a card. */
    const MAX_QUOTE = 220;

    /** How many lines of quote fit between the portrait and the timestamp. */
    const MAX_LINES = 6;

    class CardError extends Error {
        constructor(code, detail) {
            super(`${code}: ${detail}`);
            this.code = code;
            this.detail = detail;
        }
    }

    /**
     * Is this a real curiosity callback?
     *
     * Fail-soft in shape — it returns the problems rather than throwing — because a caller
     * that wants to grey out a button needs the list, and `render` is the one that refuses.
     */
    function validate(record) {
        const problems = [];
        if (!record || typeof record !== 'object') return ['not a record'];
        const quote = typeof record.quote === 'string' ? record.quote.trim() : '';
        if (!quote) problems.push('a card needs the line she actually said');
        if (quote.length > MAX_QUOTE) problems.push(`the quote is ${quote.length} characters; ${MAX_QUOTE} fit`);
        if (typeof record.topic !== 'string' || !record.topic.trim()) {
            problems.push('a card names the topic it came from');
        }
        if (!Number.isFinite(record.at)) problems.push('a card needs the moment it happened');
        return problems;
    }

    /** The timestamp, in the reader's own locale. */
    function stamp(at, locale) {
        const date = new Date(at);
        try {
            return date.toLocaleString(locale, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
            });
        } catch {
            return date.toISOString().slice(0, 16).replace('T', ' ');
        }
    }

    /** Greedy wrap against the measured width. Returns at most `MAX_LINES`. */
    function wrap(context, text, width, max = MAX_LINES) {
        const words = String(text).split(/\s+/).filter(Boolean);
        const lines = [];
        let line = '';
        for (const word of words) {
            const candidate = line ? `${line} ${word}` : word;
            if (line && context.measureText(candidate).width > width) {
                lines.push(line);
                line = word;
                if (lines.length === max) break;
            } else {
                line = candidate;
            }
        }
        if (lines.length < max && line) lines.push(line);
        else if (lines.length === max) lines[max - 1] = `${lines[max - 1].replace(/\s*\S*$/, '')} …`;
        return lines;
    }

    class Renderer {
        constructor({ makeCanvas, size = CARD, locale } = {}) {
            this.size = size;
            this._makeCanvas = makeCanvas || defaultCanvas;
            this.locale = locale;
            this.canvas = null;
            this.rendered = 0;
            this.refused = 0;
        }

        get name() {
            return 'ShareCard';
        }

        /**
         * One card.
         *
         * @param {{quote: string, topic: string, at: number}} record — a real curiosity callback
         * @param {*} [portrait] — a canvas or image to draw at the top; absent is fine
         * @returns {{canvas: *, lines: string[]}}
         */
        render(record, portrait = null) {
            const problems = validate(record);
            if (problems.length) {
                this.refused++;
                throw new CardError('card_invalid', problems.join('; '));
            }

            const canvas = this._canvas();
            const ctx = canvas.getContext('2d');
            const { width, height } = this.size;

            ctx.fillStyle = BACKGROUND;
            ctx.fillRect(0, 0, width, height);

            const drawnPortrait = this._portrait(ctx, portrait, width);

            const top = PADDING + (drawnPortrait ? PORTRAIT.height + PADDING : 0);
            const inner = width - PADDING * 2;

            ctx.textBaseline = 'top';
            ctx.fillStyle = TYPE.topic.colour;
            ctx.font = `${TYPE.topic.weight} ${TYPE.topic.size}px system-ui, sans-serif`;
            ctx.fillText(record.topic, PADDING, top);

            ctx.fillStyle = TYPE.quote.colour;
            ctx.font = `${TYPE.quote.weight} ${TYPE.quote.size}px system-ui, sans-serif`;
            const lines = wrap(ctx, `“${record.quote.trim()}”`, inner);
            lines.forEach((line, index) => {
                ctx.fillText(line, PADDING, top + TYPE.topic.size + 32 + index * TYPE.quote.lineHeight);
            });

            ctx.fillStyle = TYPE.stamp.colour;
            ctx.font = `${TYPE.stamp.weight} ${TYPE.stamp.size}px system-ui, sans-serif`;
            ctx.fillText(stamp(record.at, this.locale), PADDING, height - PADDING - TYPE.stamp.size);

            this.rendered++;
            return { canvas, lines, portrait: drawnPortrait };
        }

        /**
         * The portrait frame. Drawn as handed over — no posing, no relighting. Returns
         * whether anything was actually painted, so a caller can lay out either way.
         */
        _portrait(ctx, portrait, width) {
            if (!portrait) return false;
            const sourceWidth = portrait.width || portrait.videoWidth || 0;
            const sourceHeight = portrait.height || portrait.videoHeight || 0;
            if (!sourceWidth || !sourceHeight) return false;
            try {
                // Cover, centred: a letterboxed face on a share card reads as a mistake.
                const scale = Math.max(width / sourceWidth, PORTRAIT.height / sourceHeight);
                const w = sourceWidth * scale;
                const h = sourceHeight * scale;
                ctx.drawImage(portrait, (width - w) / 2, (PORTRAIT.height - h) / 2, w, h);
                return true;
            } catch (error) {
                console.warn('[BD] the share card has no portrait', error);
                return false;
            }
        }

        /** The PNG, as a data URL. Never a network call — see the header. */
        toDataURL() {
            const canvas = this.canvas;
            if (!canvas || typeof canvas.toDataURL !== 'function') return null;
            return canvas.toDataURL('image/png');
        }

        _canvas() {
            if (!this.canvas) this.canvas = this._makeCanvas(this.size.width, this.size.height);
            return this.canvas;
        }

        get stats() {
            return { rendered: this.rendered, refused: this.refused };
        }
    }

    function defaultCanvas(width, height) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
    }

    function attach(deps) {
        return new Renderer(deps);
    }

    return {
        attach,
        Renderer,
        CardError,
        validate,
        wrap,
        stamp,
        CARD,
        TYPE,
        MAX_QUOTE,
        MAX_LINES,
        PORTRAIT,
    };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_SHARE_CARD = ShareCard;
if (typeof module !== 'undefined' && module.exports) module.exports = ShareCard;
