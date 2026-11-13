/**
 * PX5. Her wardrobe, used where she is standing — no haul, no second screen.
 *
 * Reported from a Private session:
 *
 *     YOU    Mettiti un vestito elegante.
 *     →      the app opens Try-On Haul; the Private conversation is gone
 *
 * `WardrobeTool.call` has one executor, `TryOnHaulActivity.request`, and its first line starts
 * the activity through the Together panel. Starting an activity is leaving the one that was
 * running: Private stops, its room and music are handed back, and the person is looking at a
 * shelf of looks and a haul host. Everything needed to change her clothes was underneath that
 * screen the whole time and none of it needs the screen:
 *
 *   TryOnSession          the wear / undo history, on the controller — no view involved
 *   WardrobeController    the only thing that swaps her avatar; holds the camera across the
 *                         swap and keeps the snapshot that puts her back (LT3, W3)
 *   TryOnGenerator        makes a new look through Forge
 *   TryOnHaulActivity.loadLooks   her looks, from every source, filtered by who may see what
 *
 * This file is those four without the view. It never calls `startActivity`, never mounts
 * anything, and never touches the viewer directly — the controller stays the only avatar
 * swapper (CLAUDE.md, Wardrobe).
 *
 * ## What it is careful about
 *
 * - **She stays visible.** `applyLook` loads the new model and only then replaces the old one;
 *   a load that fails throws before anything was removed, and `TryOnSession._failed` leaves her
 *   in what she had on.
 * - **A late result is undone, not applied.** A look that finishes loading after the session
 *   ended (or after a newer request) is taken off again; a look that finished *generating* by
 *   then is kept on her shelf and not worn.
 * - **Adult outfits follow the existing gate.** Private-rated sets and looks exist here only
 *   when `TryOnPrivate.evaluate` says `open` for her — private mode on *and* Forge's operator
 *   declares this avatar adult. Asking for one otherwise is refused with that reason.
 * - **Leaving puts her back** unless the person kept the look: a private look never follows her
 *   into ordinary chat.
 *
 * Exposes: window.NEXUS_IN_SCENE_WARDROBE
 */
(function (global) {
    'use strict';

    const LOOKS_FRESH_MS = 60000;

    function keyOf(look) {
        return look ? String(look.lookId || look.id || look.vrmUrl || look.vrm_url || look.name || '') : '';
    }

    function isPrivate(look) {
        return Boolean(look && (look.private === true || (look.rating && look.rating !== 'general')));
    }

    class InSceneWardrobe {
        /**
         * Everything is injectable for tests; on the page each falls back to the global the
         * wardrobe scripts define. Resolved when used, not when constructed: `src/wardrobe/` loads
         * from `index.html` after `boot.js` has run this file.
         */
        constructor(options) {
            const o = options || {};
            this.win = o.win || global;
            this.deps = o.deps || {};
            this.session = null;
            this.generator = null;
            this.looks = [];
            this.entries = [];
            this.privateOpen = false;
            this.canCreate = false;
            this._loadedAt = -Infinity;
            this._loading = null;
            this._abort = null;
            this.recent = [];
            this.closed = false;
            this.state = { status: 'idle', name: null, why: null, progress: null };
            this.listeners = new Set();
        }

        _dep(name, find) {
            if (this.deps[name] !== undefined) return this.deps[name];
            try {
                return find(this.win) || null;
            } catch (_) {
                return null;
            }
        }

        _service() {
            return this._dep('service', (w) => w.NEXUS_WARDROBE && w.NEXUS_WARDROBE.service);
        }

        availability() {
            const service = this._service();
            const Session = this._dep('Session', (w) => w.NEXUS_TRY_ON_SESSION && w.NEXUS_TRY_ON_SESSION.TryOnSession);
            if (!service || !service.controller || !Session) return { ok: false, why: 'wardrobe-not-ready' };
            // A haul that is open owns the controller's history; two of them would fight over it.
            const haul = this._dep('haul', (w) => w.NEXUS_TRY_ON && w.NEXUS_TRY_ON.activity);
            try {
                if (haul && typeof haul.status === 'function' && haul.status())
                    return { ok: false, why: 'haul-running' };
            } catch (_) {
                /* a haul that cannot answer is not running */
            }
            return { ok: true, why: '' };
        }

        onChange(fn) {
            if (typeof fn !== 'function') return () => {};
            this.listeners.add(fn);
            return () => this.listeners.delete(fn);
        }

        /** What the strip shows: `{status, name, canUndo, why, progress}`. */
        snapshot() {
            const head = this.session && typeof this.session.head === 'function' ? this.session.head() : null;
            const worn = this.session ? this.session.worn : null;
            const wearing = worn && !worn.original ? worn : null;
            return {
                status: this.state.status,
                why: this.state.why,
                progress: this.state.progress,
                name: wearing && (!isPrivate(wearing) || this.privateOpen) ? String(wearing.name || '') : null,
                wearing: Boolean(wearing),
                canUndo: Boolean(this.session && this.session.history && this.session.history.length > 1 && head),
            };
        }

        _set(status, why, progress) {
            this.state = { status, why: why || null, progress: progress || null };
            const snap = this.snapshot();
            for (const fn of [...this.listeners]) {
                try {
                    fn(snap);
                } catch (_) {
                    /* one bad listener does not stop the others */
                }
            }
        }

        /** The session, the generator, her looks and the private gate — once, then kept fresh. */
        async open() {
            const available = this.availability();
            if (!available.ok) return available;
            const service = this._service();
            if (!this.session) {
                const Session = this._dep('Session', (w) => w.NEXUS_TRY_ON_SESSION.TryOnSession);
                this.session = new Session({ controller: service.controller, onChange: () => {} });
                const Generator = this._dep(
                    'Generator',
                    (w) => w.NEXUS_TRY_ON_GENERATOR && w.NEXUS_TRY_ON_GENERATOR.TryOnGenerator
                );
                const Identity = this._dep('Identity', (w) => w.NEXUS_AVATAR_IDENTITY);
                const Reasons = this._dep('Reasons', (w) => w.NEXUS_TRY_ON_REASONS);
                try {
                    this.generator = Generator
                        ? new Generator({ service, identity: Identity, reasons: Reasons })
                        : null;
                } catch (_) {
                    this.generator = null;
                }
            }
            if (Date.now() - this._loadedAt < LOOKS_FRESH_MS) return { ok: true, why: '' };
            if (!this._loading) this._loading = this._load(service).finally(() => (this._loading = null));
            await this._loading;
            return { ok: true, why: '' };
        }

        async _load(service) {
            const gen = this.generator;
            const Identity = this._dep('Identity', (w) => w.NEXUS_AVATAR_IDENTITY);
            let identity = null;
            try {
                identity = gen ? gen.identity() : Identity ? Identity.resolve(service.controller.original) : null;
            } catch (_) {
                identity = null;
            }
            try {
                this.canCreate = Boolean(gen && gen.availability().ok);
            } catch (_) {
                this.canCreate = false;
            }
            this.privateOpen = await this._evaluatePrivate(identity);
            const loadLooks = this._dep(
                'loadLooks',
                (w) => w.NEXUS_TRY_ON_HAUL_ACTIVITY && w.NEXUS_TRY_ON_HAUL_ACTIVITY.loadLooks
            );
            try {
                const found = loadLooks
                    ? await loadLooks({
                          service,
                          library: gen && gen.library,
                          identity,
                          privateOpen: this.privateOpen,
                      })
                    : [];
                this.looks = Array.isArray(found) ? found : [];
            } catch (_) {
                this.looks = [];
            }
            // Looks made earlier in this session stay on the shelf even if a source did not list them.
            const made = (this.session.looks || []).filter((l) => !this.looks.some((x) => keyOf(x) === keyOf(l)));
            this.session.setLooks(this.looks.concat(made));
            this.looks = this.session.looks.slice();
            const dict = this._dep(
                'dictionary',
                (w) =>
                    w.NEXUS_OUTFIT_DICTIONARY &&
                    w.NEXUS_OUTFIT_DICTIONARY.forPage &&
                    w.NEXUS_OUTFIT_DICTIONARY.forPage(w)
            );
            this.dictionary = dict;
            try {
                if (dict && typeof dict.load === 'function') await dict.load();
                this.entries =
                    dict && typeof dict.entries === 'function' ? dict.entries({ privateOpen: this.privateOpen }) : [];
            } catch (_) {
                this.entries = [];
            }
            this._loadedAt = Date.now();
        }

        /** TryOnPrivate's answer for her — the same question the haul asks (`evaluatePrivate`). */
        async _evaluatePrivate(identity) {
            const Private = this._dep('Private', (w) => w.NEXUS_TRY_ON_PRIVATE);
            if (!Private) return false;
            const gen = this.generator;
            const on = Private.privateOn(this.win);
            let published = null;
            if (on && this.canCreate && identity && identity.kind === 'library') {
                try {
                    published = await gen.library.library();
                } catch (_) {
                    published = null;
                }
            }
            try {
                const verdict = Private.evaluate({ privateOn: on, identity, published, canCreate: this.canCreate });
                return Boolean(verdict && verdict.mode === 'open');
            } catch (_) {
                return false;
            }
        }

        /** The look she has on, or null for her own outfit. */
        current() {
            const worn = this.session ? this.session.worn : null;
            return worn && !worn.original ? worn : null;
        }

        /** Her saved looks by name, for the prompt — private ones only while the gate is open. */
        names() {
            return this.looks.map((l) => String(l.name || '')).filter(Boolean);
        }

        /**
         * Decide what a request means, without changing anything.
         * `{ok, choice}` or `{ok: false, why}` — `adult-ineligible` when the thing named exists
         * but only for an avatar declared adult with private mode on.
         */
        plan(request) {
            const Engine = this._dep('Engine', (w) => w.NEXUS_OUTFIT_DECISION_ENGINE);
            if (!Engine) return { ok: false, why: 'wardrobe-not-ready' };
            const r = request || {};
            // PX15. The private gate first. "Ponte el sujetador negro" was answered with "Crop top &
            // jeans" — "negro" matched an ordinary look before this check was ever reached, so an
            // underwear request on an avatar not declared adult changed her into something else.
            if ((r.style === 'sexy' || r.style === 'lingerie') && !this.privateOpen)
                return { ok: false, why: 'adult-ineligible' };
            const choice = Engine.choose({
                request: r,
                looks: this.looks,
                entries: this.entries,
                current: this.current(),
                canCreate: this.canCreate,
                recent: this.recent,
            });
            if (choice) return { ok: true, choice };
            if (r.outfit && this.dictionary && typeof this.dictionary.find === 'function') {
                let hidden = null;
                try {
                    hidden = this.dictionary.find(r.outfit, { privateOpen: true });
                } catch (_) {
                    hidden = null;
                }
                if (hidden && !this.privateOpen) return { ok: false, why: 'adult-ineligible' };
                if (hidden && !this.canCreate) return { ok: false, why: 'forge-unavailable' };
            }
            if ((r.style === 'sexy' || r.style === 'lingerie') && !this.privateOpen)
                return { ok: false, why: 'adult-ineligible' };
            if (!this.looks.length && !this.canCreate) return { ok: false, why: 'no-outfits' };
            return { ok: false, why: 'no-match' };
        }

        /** Put a saved look on. Her previous outfit stays until this one has loaded. */
        async wearLook(look, alive) {
            const stillMine = typeof alive === 'function' ? alive : () => true;
            if (!this.session || this.closed) return { ok: false, why: 'wardrobe-not-ready' };
            if (isPrivate(look) && !this.privateOpen) return { ok: false, why: 'adult-ineligible' };
            this._set('changing');
            let landed = false;
            try {
                landed = await this.session.wear(look);
            } catch (_) {
                landed = false;
            }
            if (!landed) {
                this._set('failed', (this.session && this.session.error) || 'load-failed');
                return { ok: false, why: 'load-failed' };
            }
            if (!stillMine()) {
                // It arrived for a session that is over, or after a newer request: take it off.
                try {
                    await this.session.undo();
                } catch (_) {
                    /* the session's own end restores her */
                }
                this._set('idle');
                return { ok: false, why: 'stale' };
            }
            const key = keyOf(look);
            this.recent = this.recent.filter((k) => k !== key).concat(key);
            this._set('worn');
            return { ok: true, look };
        }

        /** Make a new look (a dictionary set, or plain garment words) and put it on. */
        async create(request, alive) {
            const stillMine = typeof alive === 'function' ? alive : () => true;
            if (!this.session || this.closed) return { ok: false, why: 'wardrobe-not-ready' };
            if (!this.generator || !this.canCreate) return { ok: false, why: 'forge-unavailable' };
            const r = request || {};
            if (r.private && !this.privateOpen) return { ok: false, why: 'adult-ineligible' };
            if (this._abort) return { ok: false, why: 'busy' };
            this._abort = typeof AbortController !== 'undefined' ? new AbortController() : null;
            this._set('creating');
            let look = null;
            try {
                look = await this.generator.create(r.prompt, {
                    baseLookId: r.baseLookId || undefined,
                    preset: r.preset || undefined,
                    signal: this._abort ? this._abort.signal : undefined,
                    onProgress: (progress) => {
                        if (!this.closed) this._set('creating', null, progress);
                    },
                });
            } catch (error) {
                this._abort = null;
                const aborted = error && error.name === 'AbortError';
                this._set(aborted ? 'idle' : 'failed', aborted ? null : (error && error.message) || 'create-failed');
                return { ok: false, why: aborted ? 'stale' : 'create-failed', message: error && error.message };
            }
            this._abort = null;
            if (!look) {
                this._set('failed', 'create-failed');
                return { ok: false, why: 'create-failed' };
            }
            if (r.outfitId) look.outfitId = r.outfitId;
            if (r.label) look.name = r.label;
            if (r.private) look.private = true;
            // Made is made: it goes on her shelf whether or not it is still wanted on her.
            this.session.add(look);
            this.looks = this.session.looks.slice();
            if (!stillMine()) {
                this._set('idle');
                return { ok: false, why: 'stale', look };
            }
            return this.wearLook(look, alive);
        }

        /** Change one part of what she has on, keeping the rest (Forge builds on the worn look). */
        change(prompt, alive) {
            const base = this.current();
            const baseLookId = base && base.source === 'forge' ? base.lookId || base.id : null;
            return this.create({ prompt, baseLookId }, alive);
        }

        async undo() {
            if (!this.session || this.closed) return { ok: false, why: 'wardrobe-not-ready' };
            if (!this.session.history || this.session.history.length < 2) return { ok: false, why: 'nothing-to-undo' };
            this._set('changing');
            let done = false;
            try {
                done = await this.session.undo();
            } catch (_) {
                done = false;
            }
            this._set(done ? (this.current() ? 'worn' : 'idle') : 'failed', done ? null : 'load-failed');
            return done ? { ok: true } : { ok: false, why: 'load-failed' };
        }

        /**
         * The session is over. A job still running is cancelled; she goes back to what she wore
         * when it began, unless `keep` and the look is one ordinary chat may see.
         */
        async close(options) {
            if (this.closed) return true;
            this.closed = true;
            if (this._abort) {
                try {
                    this._abort.abort();
                } catch (_) {
                    /* already finished */
                }
            }
            const session = this.session;
            this.listeners.clear();
            if (!session) return true;
            const worn = this.current();
            try {
                if (options && options.keep && worn && !isPrivate(worn)) await session.keep();
                await session.end();
            } catch (error) {
                console.warn('[InSceneWardrobe] could not put her outfit back', error);
            }
            return true;
        }
    }

    const api = { InSceneWardrobe, keyOf, isPrivate };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_IN_SCENE_WARDROBE = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
