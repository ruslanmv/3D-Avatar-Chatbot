/**
 * Playground — the family-friendly way into scene-aware stories.
 *
 * This activity is intentionally small. It owns the product entry point and session boundary,
 * not the story engine: StoryPlanner/StoryPlayer land behind the `playground:start` event in a
 * later vertical slice. Shipping the tile first is useful only if it is honest, so starting
 * Scene Tale records a real Together activity state and emits a typed intent; it never claims
 * that narration, music or a generated plan already exist.
 *
 * ## Why this is a native Together contract
 *
 * `TogetherPanel` already has one extension point for a ninth activity: an object with
 * `__contract === true`. Using it means Playground gets the same desktop grid, mobile
 * two-column sheet, focus management, running state and Stop behavior as every other tile.
 * There is no desktop-only markup and no second mobile launcher to drift later.
 *
 * ## Family boundary
 *
 * Playground does not activate the adult profile and does not touch `allowNsfw`. The future
 * `PlaygroundSession` must derive its family profile only after any Intimate session has been
 * fully restored; this shell merely exposes the family entry point and emits no adult intent.
 *
 * Exposes: window.NEXUS_BD_PLAYGROUND
 */
const PlaygroundActivity = (() => {
    'use strict';

    const SCENE_TALE = Object.freeze({
        id: 'scene-tale',
        label: 'Scene Tale',
        permission: null,
        note: 'A short interactive story inspired by where we are.',
    });

    class Playground {
        constructor({ bus } = {}) {
            this.__contract = true;
            this.id = 'playground';
            this.title = 'Playground';
            this.icon = '✨';
            // Between Play and Focus. On the mobile two-column grid this gives the new entry
            // a predictable visible row rather than burying it beneath the wide Help tile.
            this.order = 45;
            this.prompt = 'What should we imagine together?';

            this.bus = bus || null;
            this.active = false;
            this.mode = null;
            this.startedAt = null;
        }

        get name() {
            return 'Playground';
        }

        inputs() {
            return [SCENE_TALE];
        }

        availability() {
            return { ok: true, why: '' };
        }

        async start({ input = {} } = {}) {
            const mode = String(input.id || 'scene-tale');
            if (mode !== SCENE_TALE.id) return { ok: false, why: `unknown Playground mode: ${mode}` };
            if (this.active) return { ok: false, why: 'Playground is already running' };

            this.active = true;
            this.mode = mode;
            this.startedAt = Date.now();
            this._emit('playground:start', {
                mode,
                audience: 'family',
                startedAt: this.startedAt,
            });
            return { ok: true, why: mode, mode };
        }

        stop(why = 'user') {
            if (!this.active) return false;
            const mode = this.mode;
            this.active = false;
            this.mode = null;
            this.startedAt = null;
            this._emit('playground:stop', { mode, why });
            return true;
        }

        status() {
            if (!this.active) return null;
            return { label: 'Scene Tale', detail: 'Playground' };
        }

        detach() {
            this.stop('detached');
        }

        _emit(event, payload) {
            if (this.bus && typeof this.bus.emit === 'function') this.bus.emit(event, payload);
        }

        get stats() {
            return {
                active: this.active,
                mode: this.mode,
                startedAt: this.startedAt,
            };
        }
    }

    function attach(deps) {
        return new Playground(deps);
    }

    return { attach, Playground, SCENE_TALE };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_PLAYGROUND = PlaygroundActivity;
if (typeof module !== 'undefined' && module.exports) module.exports = PlaygroundActivity;
