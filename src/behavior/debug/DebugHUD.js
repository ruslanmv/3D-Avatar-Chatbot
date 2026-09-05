/**
 * DebugHUD — `?behaviorDebug=1` (spec v1.1 §9, batch B19).
 *
 * Layer weights, the last five picks with their score breakdown, and the session state, in
 * one corner of the screen. It exists because the three questions asked of this engine when
 * something looks wrong are always the same — *what is playing*, *why that clip*, and *is
 * the session even up* — and answering them by reading a console is slower than watching
 * the avatar again.
 *
 * ## It reads; it never writes
 *
 * The HUD calls `stats()` and renders. It holds no reference through which it could request
 * a clip, emit an event or change a weight, and a test asserts the file names no
 * `scheduler`, no `emit(` and no `request(`. A debug overlay that could alter behaviour
 * makes every observation it produces suspect.
 *
 * ## And it does not exist unless asked for
 *
 * `?behaviorDebug=1` in the URL, or `behaviorEngine.debug` in the config. Without one of
 * those this module is loaded (it is in the engine's own bundle) and never attached — no
 * DOM node, no interval, no `stats()` call. The engine already runs behind its own flag, so
 * this is the second of two switches, not the first.
 *
 * Exposes: window.NEXUS_BD_HUD
 */
const DebugHUD = (() => {
    'use strict';

    const DOM_ID = 'nexus-bd-debug-hud';

    /** Four a second. Fast enough to watch a crossfade, slow enough to cost nothing. */
    const REFRESH_MS = 250;

    const STYLE = [
        'position:fixed',
        'right:8px',
        'bottom:8px',
        'z-index:2147482000',
        'max-width:380px',
        'max-height:60vh',
        'overflow:auto',
        'padding:8px 10px',
        'border-radius:6px',
        'background:rgba(10,12,18,0.86)',
        'color:#cfe3ff',
        'font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace',
        'white-space:pre',
        'pointer-events:none',
        'text-shadow:0 1px 2px rgba(0,0,0,0.6)',
    ].join(';');

    class Hud {
        constructor({ director, doc, now = () => Date.now() } = {}) {
            this.director = director || null;
            this.doc = doc === undefined ? (typeof document !== 'undefined' ? document : null) : doc;
            this.now = now;
            this.node = null;
            this.timer = null;
            this.renders = 0;
        }

        get name() {
            return 'DebugHUD';
        }

        mount() {
            if (!this.doc || this.node) return this.node;
            this.node = this.doc.createElement('div');
            this.node.id = DOM_ID;
            this.node.setAttribute('aria-hidden', 'true'); // a developer tool, not content
            this.node.style.cssText = STYLE;
            (this.doc.body || this.doc.documentElement).appendChild(this.node);

            if (typeof setInterval === 'function') this.timer = setInterval(() => this.render(), REFRESH_MS);
            this.render();
            return this.node;
        }

        /** One frame of text. Pure enough to test without a DOM: returns what it wrote. */
        render() {
            const text = this.compose();
            if (this.node) this.node.textContent = text;
            this.renders++;
            return text;
        }

        compose() {
            const director = this.director;
            if (!director || typeof director.stats !== 'function') return 'Behavior Director — not running';

            let stats;
            try {
                stats = director.stats();
            } catch (error) {
                // A HUD that throws takes the render loop with it, which is a worse bug
                // than whatever it was trying to show.
                return `Behavior Director — stats threw: ${error && error.message}`;
            }

            return [this._headline(stats), this._layers(stats), this._picks(director), this._session(stats)]
                .filter(Boolean)
                .join('\n');
        }

        _headline(stats) {
            const registry = stats.registry || {};
            const kinds = Object.entries(registry)
                .map(([kind, count]) => `${count} ${kind}`)
                .join(' · ');
            const tier1 = stats.tier1 || {};
            return `▚ BEHAVIOR DIRECTOR   ${kinds || 'no clips'}   tier1 ${tier1.ready ? 'ready' : 'cold'}`;
        }

        _layers(stats) {
            const layers = stats.layers || [];
            if (!layers.length) return '  layers   (none active)';
            const rows = layers.map((layer) => {
                const weight = typeof layer === 'object' ? layer.weight : 0;
                const name = typeof layer === 'object' ? layer.name : String(layer);
                return `    ${pad(name, 11)}${bar(weight)} ${fixed(weight)}`;
            });
            return ['  layers'].concat(rows).join('\n');
        }

        _picks(director) {
            const log = director.pickLog;
            if (!log || typeof log.recent !== 'function') return null;
            const recent = log.recent(5);
            if (!recent.length) return '  picks    (none yet)';

            const rows = recent.map((entry) => {
                const chose = entry.chose || '—';
                const others = entry.candidates
                    .filter((c) => c.id !== entry.chose)
                    .map((c) => `${c.id}:${c.score}`)
                    .join(' ');
                const head = `    ${pad(entry.intent || '?', 12)}→ ${pad(chose, 22)}${fixed(entry.score)}`;
                return others ? `${head}\n      over ${others}` : head;
            });
            return ['  picks    (newest first)'].concat(rows).join('\n');
        }

        _session(stats) {
            const board = stats.blackboard || {};
            const session = stats.session || {};
            const consent = stats.consent || {};
            const flags = Object.entries(board.flags || {})
                .filter(([, on]) => on)
                .map(([name]) => name)
                .join(' ');

            return [
                '  state',
                `    mood     v ${fixed(board.valence)}  e ${fixed(board.energy)}   attention ${fixed(board.attention)}`,
                `    mode     ${board.mode || '—'}${board.scene ? ` · ${board.scene}` : ''}   activity ${board.activity || '—'}`,
                `    flags    ${flags || '—'}`,
                `    session  ${session.connected ? `up (${session.voiceState || 'idle'})` : 'down'}   consent ${consent.state || 'idle'}`,
            ].join('\n');
        }

        detach() {
            if (this.timer) clearInterval(this.timer);
            this.timer = null;
            if (this.node && this.node.parentNode) this.node.parentNode.removeChild(this.node);
            this.node = null;
        }

        get stats() {
            return { mounted: Boolean(this.node), renders: this.renders };
        }
    }

    function pad(text, width) {
        const value = String(text === null || text === undefined ? '' : text);
        return value.length >= width ? `${value.slice(0, width - 1)}…` : value + ' '.repeat(width - value.length);
    }

    function fixed(value) {
        return Number.isFinite(value) ? value.toFixed(2) : ' —  ';
    }

    /** Eight cells of weight, so a crossfade is visible as it happens. */
    function bar(weight) {
        const filled = Math.max(0, Math.min(8, Math.round((Number(weight) || 0) * 8)));
        return `[${'█'.repeat(filled)}${'·'.repeat(8 - filled)}]`;
    }

    /** Is the HUD asked for? URL first, then the config flag. */
    function requested(config = {}, location) {
        try {
            const search = (location || (typeof window !== 'undefined' ? window.location : null) || {}).search || '';
            if (new URLSearchParams(search).get('behaviorDebug') === '1') return true;
        } catch {
            /* no URL to read */
        }
        return Boolean(config.behaviorEngine && config.behaviorEngine.debug);
    }

    function attach(deps) {
        return new Hud(deps);
    }

    return { attach, Hud, requested, DOM_ID, REFRESH_MS };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_HUD = DebugHUD;
if (typeof module !== 'undefined' && module.exports) module.exports = DebugHUD;
