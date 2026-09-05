/**
 * PanelRenderer — structured data as a texture (addendum v1.2 §14.3, batch B20).
 *
 * A `display` message carries a kind and some data; this draws it onto a 2D canvas and hands
 * back a texture. That single decision is the batch:
 *
 * ## It is a texture, not DOM
 *
 * A DOM panel works in 2D and vanishes in VR — an immersive session renders its own
 * framebuffer and never sees the page. A texture works in all three the same way, on the
 * screen the app already has, at whatever distance the user is sitting. So there is one
 * renderer and one appearance rather than a web panel plus a VR panel that drift apart.
 *
 * It is also why the renderer is the reusable half of this batch and the assistant is a
 * separate one: tool results, coach stats and share cards all land here.
 *
 * ## Legible is a number, not an opinion
 *
 * "Reads legibly at Quest resolution" is checkable arithmetic, and `legibility()` does it:
 * the screen subtends a known angle (B12's cinema geometry), the canvas has a known pixel
 * count across it, so a font size in canvas pixels converts to **arc-minutes of visual
 * angle** at the user's eye. Twenty arc-minutes is the floor for comfortable reading; every
 * style below clears it with room, and a test asserts each one rather than trusting a
 * screenshot.
 *
 * The canvas resolution is chosen the same way: 2048 across 60° is 34 px per degree, which
 * is above a Quest 3's ~25 pixels per degree — so the headset, not the canvas, is the
 * limit, which is the right way round.
 *
 * ## The size limit is not enforced here
 *
 * The server rejects an oversized panel with its size named (`avatar_director/panels.py`).
 * By the time a payload reaches this file it has already been accepted, and re-checking here
 * would be a second limit that could disagree with the first. What this file does refuse is
 * a *kind* it cannot draw — a blank screen is worse than a message saying why.
 *
 * Exposes: window.NEXUS_BD_PANEL_RENDERER
 */
const PanelRenderer = (() => {
    'use strict';

    /**
     * Canvas pixels. 16:9 to match the screen, and 2048 across so the headset is the
     * limiting factor rather than the texture — see the header.
     */
    const CANVAS = { width: 2048, height: 1152 };

    /** B12's cinema geometry, in degrees of arc across the screen. */
    const SCREEN_ARC_DEGREES = 60;

    /** Below this a line is a smudge at three metres. Arc-minutes of cap height. */
    const LEGIBLE_ARCMIN = 20;

    /** Type scale, in canvas pixels. Every one of these is checked by `legibility()`. */
    const TYPE = {
        title: { size: 64, weight: 700, colour: '#f2f6ff' },
        row: { size: 44, weight: 400, colour: '#dce6f7' },
        key: { size: 40, weight: 600, colour: '#8fb4e8' },
        meta: { size: 32, weight: 400, colour: '#7e8ba3' },
    };

    const PADDING = 72;
    const ROW_HEIGHT = 78;
    const BACKGROUND = '#0b1017';

    /** Kinds this renderer can draw. A kind it cannot is refused, not blanked. */
    const KINDS = ['agenda', 'cards', 'tool_result', 'stats', 'share'];

    // ── legibility ───────────────────────────────────────────────────────────

    /**
     * Arc-minutes of visual angle for one canvas-pixel height, and for a font size.
     *
     * The screen subtends `arcDegrees` horizontally and the canvas spans it, so one canvas
     * pixel is `arcDegrees / canvasWidth` degrees wide — and, the texture being uniform,
     * the same tall. Cap height is about 70% of a font's nominal size, which is what a
     * reader actually resolves.
     *
     * @returns {{perPixelArcmin: number, styles: object, worst: {name, arcmin}}}
     */
    function legibility({ canvas = CANVAS, arcDegrees = SCREEN_ARC_DEGREES, type = TYPE } = {}) {
        const perPixelArcmin = (arcDegrees * 60) / canvas.width;
        const styles = {};
        let worst = null;
        for (const [name, style] of Object.entries(type)) {
            const arcmin = style.size * 0.7 * perPixelArcmin;
            styles[name] = { size: style.size, arcmin: round(arcmin), legible: arcmin >= LEGIBLE_ARCMIN };
            if (!worst || arcmin < worst.arcmin) worst = { name, arcmin: round(arcmin) };
        }
        return { perPixelArcmin: round(perPixelArcmin), styles, worst, floor: LEGIBLE_ARCMIN };
    }

    // ── drawing ──────────────────────────────────────────────────────────────

    class Renderer {
        constructor({ bus, three, makeCanvas, canvas = CANVAS } = {}) {
            this.bus = bus || null;
            this.three = three === undefined ? (typeof window !== 'undefined' ? window.THREE : null) : three;
            this.size = canvas;
            this._makeCanvas = makeCanvas || defaultCanvas;

            this.canvas = null;
            this.texture = null;
            this.current = null;
            this.shown = 0;
            this.refused = { unknownKind: 0, badData: 0 };
        }

        get name() {
            return 'PanelRenderer';
        }

        /**
         * Draw one panel.
         *
         * @returns {{ok: boolean, kind?: string, lines?: number, why?: string}} — a refusal
         * says why, because a blank screen is the least useful failure a panel can have.
         */
        show(message) {
            const kind = message && message.kind;
            const data = (message && message.data) || {};
            if (!KINDS.includes(kind)) {
                this.refused.unknownKind++;
                return { ok: false, why: `no renderer for kind ${kind}` };
            }
            if (typeof data !== 'object') {
                this.refused.badData++;
                return { ok: false, why: 'data is not an object' };
            }

            const lines = this._draw(kind, data);
            this.current = { kind, at: Date.now(), lines };
            this.shown++;
            if (this.texture) this.texture.needsUpdate = true;
            if (this.bus) this.bus.emit('panel:shown', { kind, lines });
            return { ok: true, kind, lines };
        }

        close(why = 'user') {
            if (!this.current) return false;
            const kind = this.current.kind;
            this.current = null;
            this._clear();
            if (this.texture) this.texture.needsUpdate = true;
            if (this.bus) this.bus.emit('panel:closed', { kind, why });
            return true;
        }

        /** The texture to put on the screen. Built once and reused. */
        get canvasTexture() {
            if (!this.three || !this.three.CanvasTexture) return null;
            if (!this.texture) {
                this.texture = new this.three.CanvasTexture(this._canvas());
                this.texture.minFilter = this.three.LinearFilter;
                this.texture.magFilter = this.three.LinearFilter;
            }
            return this.texture;
        }

        _canvas() {
            if (!this.canvas) this.canvas = this._makeCanvas(this.size.width, this.size.height);
            return this.canvas;
        }

        _context() {
            const canvas = this._canvas();
            return canvas.getContext('2d');
        }

        _clear() {
            const ctx = this._context();
            ctx.fillStyle = BACKGROUND;
            ctx.fillRect(0, 0, this.size.width, this.size.height);
        }

        /** @returns {number} how many lines were drawn — what a test can count. */
        _draw(kind, data) {
            const ctx = this._context();
            this._clear();

            let y = PADDING;
            if (data.title) {
                y = this._text(ctx, data.title, PADDING, y + TYPE.title.size, TYPE.title);
            }
            y += 24;

            const rows = rowsOf(kind, data);
            let drawn = 0;
            const bottom = this.size.height - PADDING;

            for (const row of rows) {
                if (y + ROW_HEIGHT > bottom) {
                    // Out of screen, not out of data. Said plainly rather than by stopping:
                    // a panel that quietly ends is indistinguishable from one that had
                    // nothing more to say.
                    this._text(ctx, `… ${rows.length - drawn} more`, PADDING, y + TYPE.meta.size, TYPE.meta);
                    break;
                }
                const [key, value] = splitRow(kind, row);
                if (key) this._text(ctx, key, PADDING, y + TYPE.row.size, TYPE.key);
                this._text(ctx, value, PADDING + (key ? 260 : 0), y + TYPE.row.size, TYPE.row);
                y += ROW_HEIGHT;
                drawn++;
            }

            if (!rows.length && !data.title) {
                this._text(ctx, '(nothing to show)', PADDING, PADDING + TYPE.row.size, TYPE.meta);
            }
            return drawn;
        }

        _text(ctx, text, x, y, style) {
            ctx.fillStyle = style.colour;
            ctx.font = `${style.weight} ${style.size}px system-ui, -apple-system, sans-serif`;
            ctx.textBaseline = 'alphabetic';
            ctx.fillText(String(text), x, y);
            return y;
        }

        detach() {
            this.close('detached');
            try {
                if (this.texture) this.texture.dispose();
            } catch (error) {
                console.warn('[BD] the panel texture refused to dispose', error);
            }
            this.texture = null;
            this.canvas = null;
        }

        get stats() {
            return {
                showing: this.current ? this.current.kind : null,
                lines: this.current ? this.current.lines : 0,
                shown: this.shown,
                refused: { ...this.refused },
                legibility: legibility({ canvas: this.size }),
            };
        }
    }

    /** The list a kind draws as rows, whatever that kind calls it. */
    function rowsOf(kind, data) {
        for (const key of ['items', 'cards', 'rows', 'stats', 'lines']) {
            if (Array.isArray(data[key])) return data[key];
        }
        return [];
    }

    /** A row as `[key, value]`. Each kind names its two columns differently. */
    function splitRow(kind, row) {
        if (typeof row === 'string') return ['', row];
        if (kind === 'agenda') return [row.at || '', row.what || ''];
        if (kind === 'stats') return [row.label || row.name || '', String(row.value ?? '')];
        if (kind === 'cards' || kind === 'share') return ['', row.title || row.text || ''];
        return [row.key || row.name || '', String(row.value ?? row.text ?? '')];
    }

    function defaultCanvas(width, height) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
    }

    function round(value) {
        return Math.round(value * 100) / 100;
    }

    function attach(deps) {
        return new Renderer(deps);
    }

    return { attach, Renderer, legibility, KINDS, CANVAS, TYPE, LEGIBLE_ARCMIN, SCREEN_ARC_DEGREES };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_PANEL_RENDERER = PanelRenderer;
if (typeof module !== 'undefined' && module.exports) module.exports = PanelRenderer;
