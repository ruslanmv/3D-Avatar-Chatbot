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
 * tile of Together's: pick Try-On, choose looks (or make one), wear them one at a time,
 * keep one or go back.
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
 *
 * Which looks: hers only. A look is a whole avatar file, so wearing another character's
 * look would replace her with someone else. The bundled wardrobe names its owner
 * (`avatarId`) and is listed only when that is her (or unnamed, "default"); Forge's
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

    function keyOf(look) {
        return (look && (look.id || look.vrmUrl)) || null;
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
     * deps: {service, library, identity}
     */
    async function loadLooks({ service, library, identity }) {
        const found = [];
        const source = service && service.staticSource;
        if (source) {
            try {
                const manifest = await source.load(false);
                if (ownedBy(manifest && manifest.avatarId, identity)) found.push(...(await source.listLooks()));
            } catch (error) {
                console.warn('[Try-On] the bundled wardrobe could not be read', error);
            }
        }
        if (library && library.available && identity && identity.kind === 'library') {
            try {
                const wardrobe = await library.client.getWardrobe(identity.slug);
                ((wardrobe && wardrobe.looks) || [])
                    .filter((look) => look && look.vrmUrl && look.type !== 'source')
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

        let session = null;
        let view = null;
        let generator = null;
        let ending = null;

        const service = () => (deps.wardrobe && deps.wardrobe.service) || null;

        function studioUrl(identity) {
            const config = (deps.wardrobe && deps.wardrobe.config) || {};
            if (!config.apiUrl || !identity || identity.kind !== 'library') return null;
            return `${config.apiUrl}/studio/?avatar=${encodeURIComponent(identity.slug)}`;
        }

        function host() {
            if (!doc) return null;
            const panel = doc.getElementById('nexus-bd-together-panel');
            return (panel && panel.parentNode) || null;
        }

        async function finish(why) {
            if (!ending) {
                ending = (async () => {
                    let result = { kept: false, restored: false };
                    try {
                        if (session) result = await session.end();
                    } catch (error) {
                        console.warn('[Try-On] ending the haul failed', error);
                    }
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
                if (!Session || !View) return { ok: false, why: NOT_READY };
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
                view = new View({
                    doc,
                    session,
                    generator,
                    reasons: Reasons,
                    studioUrl: studioUrl(identity),
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
                view.mount(host());
                loadLooks({ service: svc, library: generator && generator.library, identity })
                    .then((looks) => {
                        if (!session) return;
                        session.setLooks(looks);
                        if (view) view.setLoading(false);
                    })
                    .catch((error) => {
                        console.warn('[Try-On] loading looks failed', error);
                        if (view) view.setLoading(false);
                    });
                return { ok: true, why: '' };
            },

            stop(why = 'user') {
                finish(why);
                return true;
            },

            status() {
                if (!session) return null;
                const state = session.state();
                if (state.phase === 'running' && state.look) {
                    return {
                        label: UI.title,
                        detail: `Look ${state.index + 1} of ${state.total} · ${state.look.name || 'Look'}`,
                    };
                }
                return {
                    label: UI.title,
                    detail: state.chosen.length ? `${state.chosen.length} chosen` : 'Choosing looks',
                };
            },
        };
        return activity;
    }

    return { ID, UI, create, loadLooks, ownedBy };
})();

if (typeof window !== 'undefined') window.NEXUS_TRY_ON_HAUL_ACTIVITY = TryOnHaulActivity;
if (typeof module !== 'undefined' && module.exports) module.exports = TryOnHaulActivity;
