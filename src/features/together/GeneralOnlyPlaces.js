/**
 * GO1. Places that are only ever General: the school. Reachable from Private, never in Private.
 *
 * The school is in Private's destination list, and the person may choose it there — or accept
 * her invitation to go, or open a link to it, or come back to a saved visit. Whichever way, the
 * school is shown in General mode: ordinary conversation, exploring, clubs and sports, nothing
 * of Private's. So every route to it goes through one hand-off, here:
 *
 *   1. a wear still on its way is cancelled (the wardrobe controller's BI3 `cancel`), so no
 *      private look lands after this;
 *   2. Private is stopped through its own stop path — the panel's `stopActivity`, which runs
 *      the bridge's `end`: pending actions become stale, her body is released from any pose,
 *      the travel timer is cleared, the evening's story ends, and her outfit goes back to her
 *      own; the consent flow exits and the room request is withdrawn;
 *   3. only then is the place visited as an ordinary Experiences visit (`places`), so the
 *      renderer loads it for that owner and no other.
 *
 * Why routes and not the renderer: Private's room request reaches the engine before any later
 * listener could refuse it, so the hand-off is done where the choice is made (the room card),
 * and caught as a request (her invitation, the setup's Begin) or as a shown world (a link, a
 * save) everywhere else. Private started while she is at the school is ended at once with the
 * same hand-off; going to any other place makes Private available again through its normal
 * controls. A "General" badge stays on screen while a general-only place is shown.
 *
 * Nothing here filters what is said in the school: it is the General experience, whole.
 */
(function (global) {
    'use strict';

    const BADGE_ID = 'nexus-general-badge';
    const REASON = 'general-place';

    /** A general-only world: its own `generalOnly`, or that of the place it stands in for. Pure. */
    function isGeneralOnly(worlds, id) {
        const list = Array.isArray(worlds) ? worlds : [];
        const world = list.find((w) => w && w.id === id);
        if (!world) return false;
        if (world.generalOnly === true) return true;
        const parent = world.lightFor ? list.find((w) => w && w.id === world.lightFor) : null;
        return Boolean(parent && parent.generalOnly === true);
    }

    /** The place a world id is a visit to: a light stand-in visits the place it stands in for. Pure. */
    function placeOf(worlds, id) {
        const list = Array.isArray(worlds) ? worlds : [];
        const world = list.find((w) => w && w.id === id);
        return world && world.lightFor ? world.lightFor : id;
    }

    class GeneralOnlyPlaces {
        constructor(options) {
            const o = options || {};
            this.win = o.win || global;
            /**
             * The RAW catalogue (worlds.json as written). The page's validated catalogue
             * (`VRWorlds.validateCatalogue`) builds a fresh object per world and does not carry
             * `generalOnly`, so this module reads the file itself for that one flag.
             */
            this.worlds = Array.isArray(o.worlds) ? o.worlds : null;
            /** The validated catalogue (what `placesFor` takes), when the page has it. */
            this.catalogue = Array.isArray(o.catalogue) ? o.catalogue : null;
            this.shown = null; // the general-only world on screen, or null
            /**
             * Where she was and what the evening was, kept when Private is left for the school:
             * `{ world, place, preset, at }`. The evening's story is already remembered by the
             * bridge's own `end` (`commitStory`); this is only the way back.
             */
            this.previous = null;
            this._loading = null;
            this.intimateRequest = null; // the last room Private asked for
            this.leaving = null; // a hand-off in progress
            this._off = [];
        }

        _director() {
            return (this.win && this.win.NEXUS_BD) || null;
        }

        /** Whether Private is running now. */
        privateActive() {
            const bd = this._director();
            const intimate = bd && bd.intimate;
            if (intimate && (intimate.active || (intimate.adult && intimate.adult.active))) return true;
            const panel = bd && bd.togetherPanel;
            return Boolean(panel && panel.active === 'intimate');
        }

        isGeneralOnly(id) {
            return Boolean(id) && isGeneralOnly(this.worlds, id);
        }

        /** The catalogue, loaded once and kept; resolves to the worlds (or []). */
        ensureWorlds() {
            if (this.worlds) return Promise.resolve(this.worlds);
            if (this._loading) return this._loading;
            const W = this.win && this.win.NEXUS_VR_WORLDS;
            const fetcher = this.win && typeof this.win.fetch === 'function' ? this.win.fetch.bind(this.win) : null;
            if (!W || !fetcher) return Promise.resolve([]);
            const url = W.CATALOGUE_URL || 'assets/vr-worlds/worlds.json';
            this._loading = Promise.resolve(fetcher(url))
                .then((response) => (response && response.ok ? response.json() : { worlds: [] }))
                .then((data) => {
                    this.worlds = Array.isArray(data && data.worlds) ? data.worlds : [];
                    return this.worlds;
                })
                .catch(() => [])
                .finally(() => {
                    this._loading = null;
                });
            return this._loading;
        }

        _shownWorld() {
            try {
                const runtime = this.win.NEXUS_VIEWER && this.win.NEXUS_VIEWER.vrWorlds;
                return (runtime && runtime.activeId) || null;
            } catch (_) {
                return null;
            }
        }

        /** Private's destination list: the general-only places, marked so the card can say so. */
        destinations(placesFor, tier) {
            const W = this.win && this.win.NEXUS_VR_WORLDS;
            if (!this.worlds || !W || typeof W.placesFor !== 'function') return [];
            const fn = typeof placesFor === 'function' ? placesFor : W.placesFor;
            // `placesFor` takes the validated catalogue; which of them are general-only is read
            // from the raw one.
            return fn(this.catalogue || this.worlds, { tier, include: ['general'] })
                .filter((p) => this.isGeneralOnly(p.id))
                .map((p) => ({ ...p, generalOnly: true }));
        }

        /** Step 1–2: end Private through its own path. Returns whether it was running. */
        endPrivate() {
            const win = this.win;
            this._rememberPrevious();
            try {
                const controller =
                    win.NEXUS_WARDROBE && win.NEXUS_WARDROBE.service && win.NEXUS_WARDROBE.service.controller;
                if (controller && typeof controller.cancel === 'function') controller.cancel();
            } catch (error) {
                console.warn('[GeneralOnly] a pending wear could not be cancelled', error);
            }
            const was = this.privateActive();
            const bd = this._director();
            try {
                const panel = bd && bd.togetherPanel;
                if (panel && panel.active === 'intimate' && typeof panel.stopActivity === 'function') {
                    panel.stopActivity(REASON);
                } else if (bd && bd.intimate && typeof bd.intimate.stop === 'function') {
                    bd.intimate.stop(REASON);
                }
            } catch (error) {
                console.warn('[GeneralOnly] Private did not stop cleanly', error);
            }
            this.intimateRequest = null;
            return was;
        }

        /** A place an ordinary visit (Experiences ▸ Visit a place) can show: general or romantic. */
        _visitable(id) {
            const world = (this.worlds || []).find((w) => w && w.id === id);
            return Boolean(
                world &&
                    world.place === true &&
                    !this.isGeneralOnly(id) &&
                    ['general', 'romantic'].includes(world.rating)
            );
        }

        _rememberPrevious() {
            if (this.previous || !this.privateActive()) return;
            const bd = this._director();
            const world = this.intimateRequest || this._shownWorld();
            const base = world ? placeOf(this.worlds, world) : null;
            this.previous = {
                world: world || null,
                place: base && this._visitable(base) ? base : null,
                preset: (bd && bd.intimate && bd.intimate.preset) || null,
                at: Date.now(),
            };
        }

        /**
         * The way back, through normal navigation: leave the school, and if she was at a place an
         * ordinary visit can show (a general or romantic one), visit it again. A private room is
         * not visitable that way: Private brings it back through its own controls.
         */
        async goBack() {
            const previous = this.previous;
            const bd = this._director();
            const panel = bd && bd.togetherPanel;
            if (panel && panel.active === 'places' && typeof panel.stopActivity === 'function')
                panel.stopActivity('back');
            this.previous = null;
            if (previous && previous.place && panel && typeof panel.startActivity === 'function') {
                const result = await panel.startActivity('places', { id: previous.place, permission: null });
                return { ok: Boolean(result && result.ok !== false), returnedTo: previous.place };
            }
            return { ok: true, returnedTo: null, privateRoom: Boolean(previous && previous.world) };
        }

        /** The hand-off: end Private, then visit the place in General mode. One at a time. */
        leavePrivateFor(id) {
            if (!this.worlds) return this.ensureWorlds().then(() => this.leavePrivateFor(id));
            const place = placeOf(this.worlds, id);
            if (!this.isGeneralOnly(place)) return Promise.resolve({ ok: false, why: 'not-general-only' });
            if (this.leaving && this.leaving.place === place) return this.leaving.promise;
            const run = async () => {
                this.endPrivate();
                const panel = this._director() && this._director().togetherPanel;
                if (!panel || typeof panel.startActivity !== 'function') return { ok: false, why: 'no-panel' };
                const result = await panel.startActivity('places', { id: place, permission: null });
                return result || { ok: false, why: 'not-started' };
            };
            const promise = run().finally(() => {
                if (this.leaving && this.leaving.promise === promise) this.leaving = null;
            });
            this.leaving = { place, promise };
            return promise;
        }

        _badge(on) {
            const doc = this.win && this.win.document;
            if (!doc || !doc.body) return;
            let badge = doc.getElementById(BADGE_ID);
            if (!on) {
                if (badge) badge.remove();
                return;
            }
            if (badge) {
                const back = badge.querySelector('[data-action="general-back"]');
                if (back) back.style.display = this.previous ? '' : 'none';
            }
            if (!badge) {
                badge = doc.createElement('div');
                badge.id = BADGE_ID;
                badge.setAttribute('role', 'status');
                badge.style.cssText =
                    'position:fixed;top:72px;left:50%;transform:translateX(-50%);z-index:60;' +
                    'display:flex;gap:10px;align-items:center;' +
                    'padding:4px 12px;border-radius:999px;font:600 12px/1.4 system-ui,sans-serif;' +
                    'background:rgba(20,40,60,0.78);color:#e8f4ff';
                const label = doc.createElement('span');
                label.textContent = 'General';
                badge.appendChild(label);
                // The way back, only when there is somewhere she came from.
                const back = doc.createElement('button');
                back.type = 'button';
                back.dataset.action = 'general-back';
                back.textContent = 'Back';
                back.style.cssText =
                    'font:inherit;color:inherit;background:transparent;border:1px solid currentColor;' +
                    'border-radius:999px;padding:0 8px;cursor:pointer';
                back.addEventListener('click', () => this.goBack());
                back.style.display = this.previous ? '' : 'none';
                badge.appendChild(back);
                doc.body.appendChild(badge);
            }
        }

        onWorldRequest(detail) {
            const d = detail || {};
            if (d.owner !== 'intimate') return;
            if (!this.worlds) {
                this.ensureWorlds().then(() => this.onWorldRequest(d));
                return;
            }
            this.intimateRequest = d.id || null;
            // Her invitation accepted, or Begin with the school chosen: hand off instead.
            if (d.id && this.isGeneralOnly(d.id)) this.leavePrivateFor(d.id);
        }

        onWorldShown(detail) {
            const id = detail && detail.id ? String(detail.id) : null;
            if (!this.worlds) {
                this.ensureWorlds().then(() => this.onWorldShown(detail));
                return;
            }
            const general = Boolean(id) && this.isGeneralOnly(id);
            this.shown = general ? id : null;
            if (!general) this.previous = null; // somewhere else now: nothing to go back from
            this._badge(general);
            // A link or a saved visit landed in the school with Private still running.
            if (general && this.privateActive()) this.leavePrivateFor(id);
        }

        onPrivateStart() {
            // Private's own room request follows its start; wait for it, then decide.
            const later = (this.win && this.win.setTimeout) || setTimeout;
            later(() => {
                if (!this.shown || !this.privateActive()) return;
                if (this.intimateRequest && !this.isGeneralOnly(this.intimateRequest)) return; // going elsewhere
                this.endPrivate();
            }, 0);
        }

        attach() {
            const win = this.win;
            if (!win || typeof win.addEventListener !== 'function') return this;
            const request = (e) => this.onWorldRequest(e && e.detail);
            const shown = (e) => this.onWorldShown(e && e.detail);
            win.addEventListener('nexus-world-request', request);
            win.addEventListener('nexus-world-shown', shown);
            this._off.push(() => win.removeEventListener('nexus-world-request', request));
            this._off.push(() => win.removeEventListener('nexus-world-shown', shown));
            // The director (and its bus) is built after this file loads: subscribe when it exists.
            if (!this._subscribe()) {
                let tries = 0;
                const timer = win.setInterval(() => {
                    tries += 1;
                    if (this._subscribe() || tries > 240) win.clearInterval(timer);
                }, 500);
                this._off.push(() => win.clearInterval(timer));
            }
            this.ensureWorlds();
            return this;
        }

        _subscribe() {
            if (this._subscribed) return true;
            const bus = this._director() && this._director().bus;
            if (!bus || typeof bus.on !== 'function') return false;
            const off = bus.on('intimate:start', () => this.onPrivateStart());
            if (typeof off === 'function') this._off.push(off);
            this._subscribed = true;
            return true;
        }

        detach() {
            this._off.splice(0).forEach((off) => {
                try {
                    off();
                } catch (_) {
                    /* already gone */
                }
            });
            this._badge(false);
        }
    }

    function forPage() {
        const win = global;
        if (!win) return null;
        if (!win.__NEXUS_GENERAL_ONLY) win.__NEXUS_GENERAL_ONLY = new GeneralOnlyPlaces({ win }).attach();
        return win.__NEXUS_GENERAL_ONLY;
    }

    // On the page (not under Jest's require): attach once, as soon as the module loads.
    if (global && global.document && !(typeof module !== 'undefined' && module.exports)) forPage();

    const api = { GeneralOnlyPlaces, isGeneralOnly, placeOf, forPage, BADGE_ID, REASON };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_GENERAL_ONLY_PLACES = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
