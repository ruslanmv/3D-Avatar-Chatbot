/**
 * Places — Experiences ▸ Visit a place (VW3).
 *
 * The 3D spaces — a hotel suite, a bedroom, a lagoon beach, an office, a steampunk airship
 * dock, a neon street — were reachable only as a side effect of an experience that happened to
 * name one. This is the door to them by name: a short list, one tap, and she is there with you.
 *
 * What it does is deliberately small. Choosing a place enters the companion session as
 * `place-<id>` (so the status bar reads "Experiences · Hotel suite" with End experience, she says
 * one line, and the prompt knows where you are), and the engine — which already follows the
 * session — puts the world up. Ending it ends the session, and the world fades away.
 *
 * Only general and romantic places are offered here. Private places (the motel, the candlelit
 * suite) are offered only inside the Private experience, after its own consent and adult gates;
 * `VRWorlds.placesFor` and `resolveFor` are the rule, this file only asks them. On a phone each
 * place resolves to its light stand-in, and a place with none is simply not listed.
 *
 * Native Together contract (`__contract`), hidden from the first screen: Experiences opens it.
 *
 * Exposes: window.NEXUS_BD_PLACES
 */
(function (global) {
    'use strict';

    function worldsApi() {
        return (global && global.NEXUS_VR_WORLDS) || null;
    }

    function currentTier() {
        const W = worldsApi();
        const doc = global && global.document;
        const mobile = !!(doc && doc.documentElement && doc.documentElement.classList.contains('is-mobile'));
        return W ? W.tierFor({ xr: false, mobile }) : 'desktop';
    }

    function companionSession() {
        const live = global && global.__NEXUS_COMPANION_LIVE;
        return live && live.session ? live.session : null;
    }

    class Places {
        constructor({ bus } = {}) {
            this.__contract = true;
            this.id = 'places';
            this.title = 'Places';
            this.icon = '🗺️';
            this.order = 7;
            this.hidden = true;
            this.prompt = 'Where shall we go?';
            this.bus = bus || null;
            this.active = false;
            this.current = null;
            this._catalogue = null;
            this._warm();
        }

        /** The catalogue arrives once; `inputs()` must answer synchronously, so it is warmed. */
        _warm() {
            const W = worldsApi();
            if (!W || typeof W.loadCatalogue !== 'function') return;
            Promise.resolve(W.loadCatalogue())
                .then((catalogue) => {
                    this._catalogue = catalogue;
                })
                .catch(() => {});
        }

        _places() {
            const W = worldsApi();
            if (!W || !this._catalogue) return [];
            return W.placesFor(this._catalogue.worlds, { tier: currentTier(), include: ['general', 'romantic'] });
        }

        availability() {
            if (!worldsApi()) return { ok: false, why: 'Places are not loaded on this page.' };
            if (!companionSession()) return { ok: false, why: 'The companion is still getting ready.' };
            if (this._catalogue && !this._places().length)
                return { ok: false, why: 'No places can load on this device.' };
            return { ok: true, why: '' };
        }

        inputs() {
            return this._places().map((p) => ({
                id: p.id,
                label: p.title,
                note: p.note,
                permission: null,
                destination: 'experiences',
            }));
        }

        async start({ input = {} } = {}) {
            const place = this._places().find((p) => p.id === String(input.id || ''));
            if (!place) return { ok: false, why: 'That place is not available here.' };
            const session = companionSession();
            if (!session || typeof session.enter !== 'function')
                return { ok: false, why: 'The companion is not ready.' };
            const W = worldsApi();
            session.enter('experiences', (W ? W.PLACE_PREFIX : 'place-') + place.id, { source: 'together' });
            this.active = true;
            this.current = place;
            return { ok: true, why: place.id };
        }

        stop(why = 'user') {
            const was = this.active;
            this.active = false;
            this.current = null;
            const session = companionSession();
            try {
                const activity = session && session.active && session.active() ? String(session.activity() || '') : '';
                if (was && activity.startsWith('place-') && typeof session.end === 'function') session.end();
            } catch (_) {
                /* the world follows the session; nothing else to undo */
            }
            return was ? { ok: true, why } : false;
        }

        status() {
            return this.active && this.current ? { label: this.current.title, detail: 'Experiences' } : null;
        }
    }

    const api = {
        Places,
        attach(options) {
            return new Places(options || {});
        },
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_BD_PLACES = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
