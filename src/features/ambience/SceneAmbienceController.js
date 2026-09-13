/**
 * The one place a scene change happens (batch A9).
 *
 * Two routes want to change where you both are, and they arrive from opposite directions:
 *
 *     a radio in Settings ──┐
 *                           ├──► SceneAmbienceController ──► ViewerEngine.setDesktopBackground()
 *     <ambience intent=…> ──┘
 *
 * Everything that must be true of *both* lives here, once: the no-op guard, the event, the
 * catalogue check, the switch. Implemented twice, those four would have drifted by the second
 * feature request — and the ways they drift are all invisible until somebody reports that the
 * radio button sometimes does nothing.
 *
 * ## It stores no copy of the current scene
 *
 * The single most important line in this file is the one that is not here. `ViewerEngine`
 * already owns what is showing, as `_desktopBgKey`, and publishes it through
 * `getVisualState().background`. A `currentSceneId` field on this object would be a second
 * answer to a question that has one — and the first time the two disagreed, Settings would show
 * *Ocean* while the viewport showed *Garden*, with no error anywhere. So `currentScene()` reads
 * through every time. It is a property getter by intent; the cost is a function call.
 *
 * This is the same reasoning as "snapshot and restore, do not undo" elsewhere in this codebase:
 * do not maintain a parallel model of state you do not own.
 *
 * ## Intent words in, catalogue ids out
 *
 * `requestByIntent()` takes `{intent, mood}` — words — and resolves them against the catalogue
 * itself. It deliberately ignores an `id`, a `src` or a URL on that object even if one is
 * present, because the caller on that path is text a language model wrote. A10's attribute
 * whitelist is the first gate; this is the second, and the resolved id is looked up in the
 * catalogue before it reaches the viewer, so even a doctored entry list cannot get an arbitrary
 * string into `setDesktopBackground`.
 *
 * ## The cooldown, and why it is model-only
 *
 * The prompt asks her not to redecorate constantly, but an instruction is not a guarantee — the
 * same reason "at most one per reply" is enforced by the parser rather than by asking. So a
 * model-initiated change within twenty seconds of the previous *successful* model-initiated
 * change is refused.
 *
 * It does not apply to Settings. A person may click as fast as they like, and a radio button
 * that silently ignored the second click in twenty seconds would read as broken. Nor does a
 * manual change arm the cooldown against her: clicking a radio must not make her next
 * legitimate response fail.
 *
 * Only a change that actually happened arms it. Otherwise three rapid tags would each push the
 * window forward and hold it open indefinitely.
 *
 * Exposes: window.NEXUS_SCENE_AMBIENCE_CONTROLLER
 */
(function (global) {
    'use strict';

    /** Twenty seconds, stated once. See the header for why this is model-only. */
    const COOLDOWN_MS = 20_000;

    /**
     * The event name, and the `scene-` in the middle is the point.
     *
     * Together's idle dimmer already owns an "ambient" namespace for its own global and storage
     * key. Borrowing it would cross two unrelated features' wires with no error message to find
     * it by, so this feature is "scene ambience" everywhere — the switch keys, the globals, this
     * event.
     *
     * Two existing guards enforce the separation by *grepping* the tree, one for the dimmer's
     * global and one for that feature's directory. Both read comments as code, because grep
     * cannot do otherwise. So this note describes the neighbour instead of naming it: writing
     * either token here, even to say we avoid it, fails a guard on prose. See
     * `tests/together-ambient.test.js` and `tests/behavior/parity.smoke.test.js`.
     */
    const EVENT = 'nexus:scene-ambience-change';

    /** The sources that mean anything. Anything else is recorded as-is, never relabelled. */
    const MODEL = 'model';
    const SETTINGS = 'settings';

    const listeners = new Set();

    /** When the last *successful* model-initiated change happened, or null. */
    let lastModelChangeAt = null;

    function viewerFor(deps) {
        return (deps && deps.viewer) || (global && global.NEXUS_VIEWER) || null;
    }

    function catalogFor(deps) {
        return (deps && deps.catalog) || (global && global.NEXUS_VIEWPORT_BACKGROUND_CATALOG) || null;
    }

    function resolverFor(deps) {
        return (deps && deps.resolver) || (global && global.NEXUS_SCENE_AMBIENCE_RESOLVER) || null;
    }

    function switchFor(deps) {
        return (deps && deps.switch) || (global && global.NEXUS_SCENE_AMBIENCE_SWITCH) || null;
    }

    function clock(deps) {
        const now = deps && deps.now;
        if (typeof now === 'function') return now();
        return Date.now();
    }

    /**
     * What is showing, read from the renderer every time.
     *
     * Never cached. See the header — a cache here is the bug that makes Settings and the
     * viewport disagree.
     */
    function currentScene(deps) {
        const viewer = viewerFor(deps);
        try {
            if (!viewer || typeof viewer.getVisualState !== 'function') return null;
            const state = viewer.getVisualState();
            return state && typeof state.background === 'string' ? state.background : null;
        } catch (_) {
            // A viewer mid-teardown, or one that has not finished booting. Not knowing is a
            // valid answer; throwing would take a chat reply down with it.
            return null;
        }
    }

    function announce(detail) {
        for (const listener of Array.from(listeners)) {
            try {
                listener(detail);
            } catch (_) {
                // One bad listener must not stop the others being told.
            }
        }
        // Also as a DOM event, so Settings markup and other non-module code can listen without
        // reaching for this module's global.
        try {
            if (global && typeof global.dispatchEvent === 'function' && typeof global.CustomEvent === 'function') {
                global.dispatchEvent(new global.CustomEvent(EVENT, { detail }));
            }
        } catch (_) {
            // No DOM (a worker, a test harness). The listener set already fired.
        }
    }

    /**
     * Subscribe to real changes. Returns an unsubscribe function, always — a caller storing the
     * return value should never have to check it first.
     */
    function onChange(listener) {
        if (typeof listener !== 'function') return function () {};
        listeners.add(listener);
        return function () {
            listeners.delete(listener);
        };
    }

    /**
     * Apply a scene by id.
     *
     * @param {string} id a catalogue id — a scene or one of the five colours
     * @param {object} [options] `{ source: 'settings'|'model', intent, mood }`
     * @param {object} [deps] injection seam; globals are the fallback
     * @returns {{changed:boolean, id:string|null, reason:string|null, source:string}}
     */
    function apply(id, options, deps) {
        const opts = options || {};
        const source = typeof opts.source === 'string' && opts.source ? opts.source : 'unknown';
        const fromModel = source === MODEL;
        const key = typeof id === 'string' ? id.trim() : '';

        function no(reason) {
            return { changed: false, id: key || null, reason, source };
        }

        if (!key) return no('no-scene');

        // Re-read the permission here, at the point of application. The directive checks it too,
        // but this function is also reachable from the Settings path, so the check has to live
        // where the change happens rather than only on one way in.
        if (fromModel) {
            const sw = switchFor(deps);
            if (!sw || typeof sw.isEnabled !== 'function' || !sw.isEnabled()) {
                console.warn('[SceneAmbience] a model scene change was refused: ambience is off');
                return no('disabled');
            }
        }

        const catalog = catalogFor(deps);
        if (!catalog || typeof catalog.has !== 'function') {
            console.warn('[SceneAmbience] no catalogue is available — scene change skipped');
            return no('no-catalog');
        }
        if (!catalog.has(key)) {
            // A stale `desktop_bg` from a newer build, or a renamed asset. Warn and leave the
            // current background alone rather than painting something unexpected.
            console.warn(`[SceneAmbience] unknown scene "${key}" — keeping the current background`);
            return no('unknown-scene');
        }

        // Nothing to do, and nothing to announce. Checked before the cooldown so that a
        // duplicate request neither consumes the window nor reports a failure.
        if (currentScene(deps) === key) return no('already-showing');

        if (fromModel && lastModelChangeAt !== null && clock(deps) - lastModelChangeAt < COOLDOWN_MS) {
            console.warn('[SceneAmbience] a model scene change was refused: too soon after the last one');
            return no('cooldown');
        }

        const viewer = viewerFor(deps);
        if (!viewer || typeof viewer.setDesktopBackground !== 'function') {
            console.warn('[SceneAmbience] no viewer is available — scene change skipped');
            return no('no-viewer');
        }

        try {
            viewer.setDesktopBackground(key);
        } catch (error) {
            console.warn('[SceneAmbience] the viewer refused a scene change:', error && error.message);
            return no('apply-failed');
        }

        // Armed only by a change that actually happened, and only by the model.
        if (fromModel) lastModelChangeAt = clock(deps);

        const detail = {
            id: key,
            source,
            intent: typeof opts.intent === 'string' ? opts.intent : null,
            mood: typeof opts.mood === 'string' ? opts.mood : null,
        };
        announce(detail);
        return { changed: true, id: key, reason: null, source };
    }

    /**
     * Apply a scene from an intent word, which is the only shape the model can ask in.
     *
     * Any `id`, `src` or `url` on `request` is ignored by construction — this function reads
     * `intent` and `mood` and nothing else, then resolves against the catalogue. A10 rejects
     * those attributes already; this is the second gate, and the reason the AI path cannot
     * express "show me this URL" even if the first gate were bypassed.
     *
     * Returns a promise, so a caller may await it. Nothing here is actually async — the texture
     * load downstream is — but a promise keeps the call site honest about that.
     */
    function requestByIntent(request, deps) {
        const req = request || {};
        const source = typeof req.source === 'string' && req.source ? req.source : MODEL;

        function no(reason) {
            return Promise.resolve({ changed: false, id: null, reason, source });
        }

        // Checked before resolving: cheaper, and it keeps "she is not allowed" distinct from
        // "there was no match" in the console, which matters when somebody reports that asking
        // for the sea did nothing.
        if (source === MODEL) {
            const sw = switchFor(deps);
            if (!sw || typeof sw.isEnabled !== 'function' || !sw.isEnabled()) {
                console.warn('[SceneAmbience] a scene request was refused: ambience is off');
                return no('disabled');
            }
        }

        const resolver = resolverFor(deps);
        const catalog = catalogFor(deps);
        if (!resolver || typeof resolver.resolve !== 'function') return no('no-resolver');
        if (!catalog || typeof catalog.images !== 'function') return no('no-catalog');

        const sw = switchFor(deps);
        const preference =
            sw && typeof sw.getPreference === 'function'
                ? sw.getPreference()
                : typeof req.preference === 'string'
                  ? req.preference
                  : 'auto';

        // The resolver's contract is `resolve(...) → sceneId | null` — a bare string, not an
        // object. Worth naming here because assuming `{id}` is the obvious mistake, and it fails
        // as "nothing matched" rather than as a type error.
        let resolvedId = null;
        try {
            resolvedId = resolver.resolve({
                entries: catalog.images(),
                intent: req.intent,
                mood: req.mood,
                preference,
                now: req.now,
            });
        } catch (error) {
            // A resolver that throws must not take her reply down with it. She said something
            // true; the scenery simply did not change.
            console.warn('[SceneAmbience] the resolver failed:', error && error.message);
            return no('resolve-failed');
        }

        if (typeof resolvedId !== 'string' || !resolvedId) {
            console.warn(`[SceneAmbience] nothing in the catalogue matches "${req.intent}"`);
            return no('no-match');
        }

        return Promise.resolve(apply(resolvedId, { source, intent: req.intent || null, mood: req.mood || null }, deps));
    }

    /** Forget the cooldown. For tests, and for anything that re-initialises the page. */
    function reset() {
        lastModelChangeAt = null;
    }

    const api = {
        COOLDOWN_MS,
        EVENT,
        MODEL,
        SETTINGS,
        apply,
        currentScene,
        onChange,
        requestByIntent,
        reset,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (global) {
        global.NEXUS_SCENE_AMBIENCE_CONTROLLER = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
