/**
 * W7. Try-On, as a Together activity.
 *
 * It lives with the wardrobe, not in Together's activities folder, on purpose. Files
 * there are behaviour-engine modules: `boot.js` loads them from its flag-guarded list and
 * nothing else may (the parity baseline and `tests/behavior/composition.test.js` hold
 * that). This one is the wardrobe's adapter *into* Together — inert on its own, a factory
 * that `TryOnTogetherBridge` calls only once Together is running — so it loads with the
 * wardrobe and the engine's loading rules stay exactly as they were.
 *
 * The wardrobe used to be its own floating 👗 button and drawer — a second launcher beside
 * Together, competing for the same corner of a phone. This is the same capability as one
 * tile of Together's: pick Try-On and play — tap a look and she wears it, ask for a change
 * and Forge makes it, compare, undo, heart a few, keep one or go back (LT1–LT2).
 *
 * It speaks the activity contract natively (`__contract: true`, B36), so `ActivityContract`
 * passes it through untouched and no adapter is written for it; and it carries its own
 * `ui` (title, icon, order), so the chooser shows it without an entry in the panel's
 * table. Nothing in the panel or in `boot.js` is edited: `TryOnTogetherBridge` registers
 * it once both Together and the wardrobe exist.
 *
 * - `inputs()` is one input that asks nothing, so the panel starts it straight from the
 *   tile (a setup screen whose only button is "Start" is a step that exists to be got past).
 * - `availability()` answers from what exists now: without the wardrobe service there is
 *   nothing to try on, and the panel says so in a sentence instead of hiding the tile.
 * - `start()` opens `TryOnView` where the panel was and loads her looks behind it.
 * - `stop()` — the panel's Stop, or the view closing — ends the haul through
 *   `TryOnSession.end()`, which restores her exactly once unless a look was kept.
 * - `status()` is the launcher's one-line running state: "Look 2 of 4 · Burgundy Evening".
 * - Turn (LT2) spins her round to show the back. It is a view of her, not a change to her:
 *   it rotates the loaded model's root and puts the exact yaw back when the haul ends, and a
 *   newly worn look — a new file — faces the camera on its own.
 *
 * Which looks: hers only. A look is a whole avatar file, so wearing another character's
 * look would replace her with someone else. Each bundled look names its owner (its own
 * `avatarId`, else the manifest's) and is listed only when that is her (or unnamed,
 * "default") and was made from her exact file (W11); Forge's
 * wardrobe is read by her library slug. Fail soft throughout — a source that cannot be
 * read is skipped with a warning and the others still show.
 *
 * Exposes: window.NEXUS_TRY_ON_HAUL_ACTIVITY
 */
const TryOnHaulActivity = (() => {
    'use strict';

    const ID = 'try-on-haul';
    const UI = Object.freeze({ title: 'Try-On', icon: '👗', order: 45 });
    const NOT_READY = 'The wardrobe is still getting ready. Try again in a moment.';

    const TURN_MS = 700;

    /**
     * Turn her round and back. Relative to the yaw the model loaded with (VRM 0.x files are
     * turned at load), so "back" is always exactly that yaw again — snapshot and restore.
     */
    function makeTurner(manager, g) {
        let root = null;
        let base = 0;
        let turned = false;
        let frame = null;
        const raf = g.requestAnimationFrame ? g.requestAnimationFrame.bind(g) : null;
        const cancel = g.cancelAnimationFrame ? g.cancelAnimationFrame.bind(g) : () => {};
        const reduced = () => {
            try {
                return Boolean(g.matchMedia && g.matchMedia('(prefers-reduced-motion: reduce)').matches);
            } catch (_) {
                return false;
            }
        };
        const current = () => {
            const now = manager && manager.currentRoot;
            if (now && now !== root) {
                // A new file: whatever we turned is gone, and this one faces the camera.
                if (frame !== null) cancel(frame);
                frame = null;
                root = now;
                base = now.rotation ? now.rotation.y : 0;
                turned = false;
            }
            return root && root.rotation ? root : null;
        };
        const to = (yaw) => {
            if (frame !== null) cancel(frame);
            frame = null;
            if (!raf || reduced()) {
                root.rotation.y = yaw;
                return;
            }
            const from = root.rotation.y;
            const start = Date.now();
            const target = root;
            const step = () => {
                const t = Math.min(1, (Date.now() - start) / TURN_MS);
                const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
                target.rotation.y = from + (yaw - from) * ease;
                frame = t < 1 ? raf(step) : null;
            };
            frame = raf(step);
        };
        return {
            toggle() {
                if (!current()) return false;
                turned = !turned;
                to(base + (turned ? Math.PI : 0));
                return turned;
            },
            reset() {
                if (frame !== null) cancel(frame);
                frame = null;
                if (root && root.rotation && turned && manager && manager.currentRoot === root) root.rotation.y = base;
                turned = false;
            },
        };
    }

    function keyOf(look) {
        return (look && (look.key || look.id || look.vrmUrl)) || null;
    }

    /** Is a bundled wardrobe (`avatarId`) hers? Unnamed or "default" bundles belong to anyone. */
    function ownedBy(owner, identity) {
        if (!owner || owner === 'default') return true;
        if (!identity) return false;
        return owner === identity.slug || owner === identity.name || owner === identity.file;
    }

    /**
     * Her looks, from every source that answers, without duplicates.
     *
     * deps: {service, library, identity, privateOpen}
     *   privateOpen  TryOnPrivate's answer for her is `open` (private mode on and her owner
     *                declares her adult). Only then does an imported look above general show.
     */
    async function loadLooks({ service, library, identity, privateOpen = false }) {
        const found = [];
        const source = service && service.staticSource;
        if (source) {
            try {
                // W11. Ownership is per look: the shipped pack carries looks for five avatars,
                // so the manifest has no single owner and "unnamed belongs to anyone" would
                // offer her every one of them. A look made for another version of her (its
                // source hash differs from hers) is hers in name only, and is left out too.
                const manifest = await source.load(false);
                const owner = manifest && manifest.avatarId;
                const worn = identity && identity.sha256 ? String(identity.sha256).toLowerCase() : null;
                (await source.listLooks()).forEach((look) => {
                    if (!ownedBy(look.avatarId || owner, identity)) return;
                    const made = look.fit && look.fit.sourceSha256;
                    if (made && worn && made !== worn) return;
                    // The shipped pack is general only; a private look arrives with imports (W14).
                    if (look.rating && look.rating !== 'general') return;
                    found.push(look);
                });
            } catch (error) {
                console.warn('[Try-On] the bundled wardrobe could not be read', error);
            }
        }
        // W14. Packs imported in this browser. Untrusted, so an unrated look is gated like
        // swimwear, and the validator decides visibility exactly as it does everywhere else.
        const imported = service && service.importedSource;
        const Validator = typeof window !== 'undefined' ? window.NEXUS_WARDROBE_PACK_VALIDATOR : null;
        if (imported && Validator) {
            try {
                (await imported.listLooks()).forEach((look) => {
                    const verdict = Validator.visibility(look, { identity, privateOpen, unratedAs: 'swimwear' });
                    if (verdict.visible) found.push(look);
                });
            } catch (error) {
                console.warn('[Try-On] imported packs could not be read', error);
            }
        }
        if (library && library.available && identity && identity.kind === 'library') {
            try {
                const wardrobe = await library.client.getWardrobe(identity.slug);
                // W17. A Forge keeps one wardrobe per library avatar, and the public Space is
                // shared: every visitor who asked for "Yellow sundress" left one there. Listed
                // whole, her strip held the same name five times, and the host was told about
                // five sundresses. One per name — the first Forge lists — is the look she has.
                const named = new Set();
                ((wardrobe && wardrobe.looks) || [])
                    .filter((look) => look && look.vrmUrl && look.type !== 'source')
                    .filter((look) => {
                        const name = String(look.name || '')
                            .trim()
                            .toLowerCase();
                        if (!name) return true;
                        if (named.has(name)) return false;
                        named.add(name);
                        return true;
                    })
                    .forEach((look) =>
                        found.push({
                            ...look,
                            vrmUrl: library.resolveUrl(look.vrmUrl),
                            previewUrl: look.previewUrl ? library.resolveUrl(look.previewUrl) : null,
                            source: 'forge',
                        })
                    );
            } catch (error) {
                // A wardrobe Forge has never made a look for is a 404: not an error, just empty.
                if (!error || error.status !== 404) console.warn('[Try-On] Forge wardrobe could not be read', error);
            }
        } else if (service && service.remoteSource) {
            try {
                found.push(...(await service.remoteSource.listLooks()));
            } catch (error) {
                console.warn('[Try-On] remote wardrobe could not be read', error);
            }
        }
        const byKey = new Map();
        found.forEach((look) => {
            const key = keyOf(look);
            if (key && !byKey.has(key)) byKey.set(key, look);
        });
        return [...byKey.values()];
    }

    /**
     * deps:
     *   wardrobe   window.NEXUS_WARDROBE ({service, config})
     *   panel      the TogetherPanel, told when the haul ends from inside the view
     *   doc        the document
     *   Session, View, Generator, Library, Identity, Reasons   injected for tests
     */
    function create(deps = {}) {
        const g = typeof window !== 'undefined' ? window : {};
        const doc = deps.doc || (typeof document !== 'undefined' ? document : null);
        const Session = deps.Session || (g.NEXUS_TRY_ON_SESSION && g.NEXUS_TRY_ON_SESSION.TryOnSession);
        const View = deps.View || (g.NEXUS_TRY_ON_VIEW && g.NEXUS_TRY_ON_VIEW.TryOnView);
        const Generator = deps.Generator || (g.NEXUS_TRY_ON_GENERATOR && g.NEXUS_TRY_ON_GENERATOR.TryOnGenerator);
        const Identity = deps.Identity || g.NEXUS_AVATAR_IDENTITY;
        const Reasons = deps.Reasons || g.NEXUS_TRY_ON_REASONS;
        const Private = deps.Private || g.NEXUS_TRY_ON_PRIVATE;
        const Intent = deps.Intent || g.NEXUS_TRY_ON_INTENT;
        const Reactions = deps.Reactions || g.NEXUS_TRY_ON_REACTIONS || null;
        const Dictionary = deps.Dictionary || g.NEXUS_OUTFIT_DICTIONARY || null;
        const Conversation = deps.Conversation || g.NEXUS_TRY_ON_CONVERSATION || null;
        const spicy = () => deps.spicy || g.NEXUS_SPICY || null;
        const WARM_EVERY_MS = 60000;
        const SPIN_HOLD_MS = 2600;

        let session = null;
        let view = null;
        let generator = null;
        let ending = null;
        let unwatchPrivate = null;
        let turner = null;
        let ready = null; // looks listed and the private gate asked, once per haul
        let host = null; // W17. the haul's host in the conversation (TryOnConversation)
        // W16. What the companion is told, kept between hauls: whether private outfits are
        // open for her, and the names on her shelf. Refreshed in the background (`warm`) so
        // the prompt can be built synchronously and still be about now.
        let privateIsOpen = false;
        let shelfNames = [];
        let warmedAt = -Infinity;
        let warming = null;
        let dictionary = null;

        const service = () => (deps.wardrobe && deps.wardrobe.service) || null;

        function studioUrl(identity) {
            const config = (deps.wardrobe && deps.wardrobe.config) || {};
            if (!config.apiUrl || !identity || identity.kind !== 'library') return null;
            return `${config.apiUrl}/studio/?avatar=${encodeURIComponent(identity.slug)}`;
        }

        function hostElement() {
            if (!doc) return null;
            const panel = doc.getElementById('nexus-bd-together-panel');
            return (panel && panel.parentNode) || null;
        }

        /** TryOnPrivate's answer for her, with or without a view to show it on. */
        async function evaluatePrivate(identity, gen) {
            if (!Private) return { mode: 'off' };
            const on = Private.privateOn({ NEXUS_SPICY: spicy() });
            const canCreate = Boolean(gen && gen.availability().ok);
            let published = null;
            if (on && canCreate && identity && identity.kind === 'library') {
                try {
                    published = await gen.library.library();
                } catch (_) {
                    published = null;
                }
            }
            return Private.evaluate({ privateOn: on, identity, published, canCreate });
        }

        async function updatePrivate(identity) {
            if (!Private || !view) return false;
            const state = await evaluatePrivate(identity, generator);
            if (view) view.setPrivate(state);
            privateIsOpen = Boolean(state && state.mode === 'open');
            return privateIsOpen;
        }

        function pageDictionary() {
            if (deps.dictionary) return deps.dictionary;
            if (!dictionary && Dictionary && typeof Dictionary.forPage === 'function')
                dictionary = Dictionary.forPage(g);
            return dictionary;
        }

        /**
         * W16. Refresh what the companion is told — private gate, shelf, dictionary — at most
         * once a minute, in the background. Never throws; a failure leaves the last answer.
         */
        function warm(force) {
            if (warming || (!force && Date.now() - warmedAt < WARM_EVERY_MS)) return warming;
            const svc = service();
            if (!svc || !svc.controller) return null;
            warmedAt = Date.now();
            warming = (async () => {
                try {
                    const gen = Generator
                        ? new Generator({ service: svc, identity: Identity, reasons: Reasons })
                        : null;
                    const identity = gen ? gen.identity() : Identity ? Identity.resolve(svc.controller.original) : null;
                    const dict = pageDictionary();
                    if (dict) await dict.load();
                    if (!view) {
                        const state = await evaluatePrivate(identity, gen);
                        privateIsOpen = Boolean(state && state.mode === 'open');
                        const looks = await loadLooks({
                            service: svc,
                            library: gen && gen.library,
                            identity,
                            privateOpen: privateIsOpen,
                        });
                        shelfNames = uniqueNames(looks);
                    }
                } catch (error) {
                    console.warn('[Try-On] could not refresh what the companion knows', error);
                } finally {
                    warming = null;
                }
            })();
            return warming;
        }

        /** Her shelf by name, each name once: the same look made twice is one thing to ask for. */
        function uniqueNames(looks) {
            return [...new Set(looks.map((look) => look && look.name).filter(Boolean))];
        }

        /** Is a look one the conversation must not record? Private by rating, by set or by ink. */
        function isPrivateLook(look) {
            if (!look) return false;
            if (look.private) return true;
            if (look.rating && look.rating !== 'general') return true;
            if (look.bodyArt && look.bodyArt.length) return true;
            const dict = pageDictionary();
            const entry = dict && look.outfitId ? dict.find(look.outfitId, { privateOpen: true }) : null;
            return Boolean(entry && entry.private);
        }

        /** The spin: turn her to show the back, then round again. */
        function spin() {
            if (!turner) return;
            if (!turner.toggle()) return;
            g.setTimeout(() => {
                if (turner) turner.toggle();
                if (view) view.turned = false;
                if (view) view.render();
            }, SPIN_HOLD_MS);
        }

        /** W17. A look arrived: the host's reveal, and every third one the spin. */
        function onLanding(event) {
            if (!host) return null;
            if (isPrivateLook(event.look)) {
                // OD2. The host still counts it, so its outro knows to name only the looks it was
                // told about, and posts nothing: a private look stays off the record. Answering with its promise
                // told the view the reveal was handled, so with a model configured a private
                // look got no word at all; answering null hands it to Try-On's own reaction.
                host.reveal({ ...event, private: true }).catch(() => {});
                return null;
            }
            return host.reveal({ ...event, private: false }).then((result) => {
                if (result && result.spin) g.setTimeout(spin, 1200);
                return result;
            });
        }

        function hostOpen(looks, canCreate) {
            if (!host) return;
            const dict = pageDictionary();
            const ideas = (dict ? dict.entries({ privateOpen: false }) : []).map((e) => e.title);
            const shelf = looks.filter((look) => !isPrivateLook(look)).map((look) => look.name);
            host.open({ total: shelf.length, canCreate, ideas: shuffle(shelf.concat(ideas)).slice(0, 3) });
        }

        function shuffle(list) {
            const out = list.slice();
            for (let i = out.length - 1; i > 0; i -= 1) {
                const j = Math.floor(Math.random() * (i + 1));
                [out[i], out[j]] = [out[j], out[i]];
            }
            return out;
        }

        async function finish(why) {
            if (!ending) {
                ending = (async () => {
                    let result = { kept: false, restored: false };
                    // W17. What the outro recaps, read before the session ends: her hearted
                    // looks and the one she kept — general ones only, by name.
                    let recap = null;
                    if (session && host) {
                        const state = session.state();
                        const byKey = new Map(state.looks.map((look) => [keyOf(look), look]));
                        recap = {
                            favorites: state.favorites
                                .map((key) => byKey.get(key))
                                .filter((look) => look && !isPrivateLook(look))
                                .map((look) => look.name),
                            kept:
                                state.phase === 'kept' && state.look && !isPrivateLook(state.look)
                                    ? state.look.name
                                    : null,
                        };
                    }
                    // Said as the haul ends, not after: putting her original back can take as
                    // long as any look, and an outro twenty seconds late reads as an afterthought.
                    if (recap) host.outro(recap);
                    try {
                        if (session) result = await session.end();
                    } catch (error) {
                        console.warn('[Try-On] ending the haul failed', error);
                    }
                    host = null;
                    ready = null;
                    if (turner) turner.reset();
                    turner = null;
                    if (unwatchPrivate) unwatchPrivate();
                    unwatchPrivate = null;
                    if (view) view.unmount();
                    view = null;
                    session = null;
                    return { why, ...result };
                })();
            }
            return ending;
        }

        const activity = {
            __contract: true,
            id: ID,
            title: UI.title,
            icon: UI.icon,
            order: UI.order,
            ui: UI,

            inputs() {
                return [{ id: 'open', label: 'Open Try-On', permission: null }];
            },

            availability() {
                const svc = service();
                if (!svc || !svc.controller) return { ok: false, why: NOT_READY };
                if (!Session || !View || !Intent) return { ok: false, why: NOT_READY };
                return { ok: true, why: '' };
            },

            async start() {
                const available = activity.availability();
                if (!available.ok) return available;
                if (view) return { ok: true, why: 'already open' };
                const svc = service();
                ending = null;
                generator = Generator ? new Generator({ service: svc, identity: Identity, reasons: Reasons }) : null;
                const identity = generator
                    ? generator.identity()
                    : Identity
                      ? Identity.resolve(svc.controller.original)
                      : null;
                session = new Session({
                    controller: svc.controller,
                    onChange: () => view && view.render(),
                });
                // W17. The host, when there is a model to host with.
                host = deps.host || (Conversation ? new Conversation.TryOnConversation({ global: g }) : null);
                if (host && typeof host.available === 'function' && !host.available()) host = null;
                const dict = pageDictionary();
                const manager = svc.controller.avatarManager;
                turner = manager && 'currentRoot' in manager ? makeTurner(manager, g) : null;
                view = new View({
                    doc,
                    session,
                    generator,
                    reasons: Reasons,
                    intent: Intent,
                    reactions: Reactions,
                    turn: turner,
                    dictionary: dict,
                    onLanding,
                    studioUrl: studioUrl(identity),
                    importer: svc.importer || null,
                    onImported: () => reload(),
                    onClose: (why) => {
                        finish(why).then(() => {
                            // Tell the panel, so the launcher stops saying Try-On is running.
                            const panel = deps.panel;
                            if (panel && panel.active === ID && typeof panel.stopActivity === 'function') {
                                panel.stopActivity(why);
                            }
                        });
                    },
                });
                view.mount(hostElement());
                if (dict) dict.load().then(() => view && view.render());
                // W10. Private mode unlocks private outfits for avatars Forge declares adult.
                // Asked now and again whenever private mode is switched, so the screen follows
                // Settings while it is open.
                // W14. Her looks are listed again when private outfits open or close for her
                // (an imported private look appears or goes) and after a pack is imported.
                let privateOpen = false;
                const reload = () =>
                    loadLooks({ service: svc, library: generator && generator.library, identity, privateOpen })
                        .then((looks) => {
                            if (!session) return;
                            session.setLooks(looks);
                            shelfNames = uniqueNames(looks);
                            if (view) view.setLoading(false);
                            return looks;
                        })
                        .catch((error) => {
                            console.warn('[Try-On] loading looks failed', error);
                            if (view) view.setLoading(false);
                        });
                const refreshPrivate = () =>
                    Promise.resolve(updatePrivate(identity)).then((open) => {
                        if (Boolean(open) !== privateOpen) {
                            privateOpen = Boolean(open);
                            reload();
                        }
                    });
                const firstPrivate = refreshPrivate();
                const gate = spicy();
                if (gate && typeof gate.onChange === 'function') unwatchPrivate = gate.onChange(refreshPrivate);
                const firstLooks = reload();
                ready = Promise.all([firstPrivate, firstLooks]).catch(() => null);
                // W17. The haul opens in the conversation once her looks are listed.
                Promise.resolve(firstLooks).then((looks) =>
                    hostOpen(looks || [], Boolean(generator && generator.availability().ok))
                );
                return { ok: true, why: '' };
            },

            /**
             * W16. One wardrobe tool call from the companion (WardrobeTool.call). Opens Try-On
             * when it is not open — through the panel, so the launcher knows it is running —
             * waits for her looks and the private gate, then hands it to the view.
             */
            async request(action, args) {
                if (!view) {
                    const panel = deps.panel;
                    if (panel && typeof panel.startActivity === 'function') await panel.startActivity(ID, {});
                    else await activity.start({});
                }
                if (!view) return { ok: false, why: NOT_READY };
                if (ready) await ready;
                return view.runTool(action, args || {}, { privateOpen: privateIsOpen });
            },

            /** W16. Whether private outfits are open for her (TryOnPrivate), as last asked. */
            privateOpen() {
                warm();
                return privateIsOpen;
            },

            /** W16. Her saved looks and what she has on, by name, for the companion's prompt. */
            shelf() {
                warm();
                const state = session ? session.state() : null;
                const current = state && state.look && !isPrivateLook(state.look) ? state.look.name : null;
                return { looks: shelfNames.slice(), current, running: Boolean(session) };
            },

            stop(why = 'user') {
                finish(why);
                return true;
            },

            status() {
                if (!session) return null;
                const state = session.state();
                const look = state.going && !state.going.original ? state.going : state.look;
                if (look) {
                    const at = state.looks.findIndex((item) => keyOf(item) === keyOf(look));
                    return {
                        label: UI.title,
                        detail:
                            at === -1
                                ? look.name || 'Look'
                                : `Look ${at + 1} of ${state.total} · ${look.name || 'Look'}`,
                    };
                }
                return { label: UI.title, detail: state.began ? 'Original' : 'Browsing looks' };
            },
        };
        // W16. Know her wardrobe before the first message, not after it: the prompt is built
        // synchronously, so what it says is whatever was warmed before the person typed.
        if (!deps.noWarm && typeof g.setTimeout === 'function') g.setTimeout(() => warm(true), 0);
        return activity;
    }

    return { ID, UI, create, loadLooks, ownedBy, makeTurner };
})();

if (typeof window !== 'undefined') window.NEXUS_TRY_ON_HAUL_ACTIVITY = TryOnHaulActivity;
if (typeof module !== 'undefined' && module.exports) module.exports = TryOnHaulActivity;
