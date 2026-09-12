/**
 * The one place a scene change happens (batch A9).
 *
 * Two routes reach this module — a radio in Settings and a `<ambience>` tag from the model — and
 * the controller's whole job is to be the single point where they converge, so that the rules
 * that must hold for both (no-op guard, the event, the switch) cannot be implemented twice and
 * drift.
 *
 * The assertions that earn their place:
 *
 *   * **no own scene field.** `AI_SCENE_AMBIENCE.md` §9 calls a `currentSceneId` on this object
 *     "a bug, not a convenience", and it is: the moment the controller caches what is showing,
 *     Settings can display *Ocean* while the scene is *Forest*. Asserted structurally, by
 *     inspecting the module's own source, because a test of behaviour would pass right up until
 *     the day the cache went stale.
 *   * **cooldown is model-only.** A user may click as fast as they like. A refusal that caught
 *     manual clicks would read as a broken radio button.
 *   * **the switch is re-read here.** The directive checks it too (A10), but the controller is
 *     reachable from A11's settings path as well, so the check has to live at the point of
 *     application and not only on the way in.
 */

const fs = require('fs');
const path = require('path');

const Controller = require('../src/features/ambience/SceneAmbienceController.js');
const Switch = require('../src/features/ambience/SceneAmbienceSwitch.js');
const Resolver = require('../src/features/ambience/SceneAmbienceResolver.js');

const source = fs.readFileSync(path.resolve(__dirname, '../src/features/ambience/SceneAmbienceController.js'), 'utf-8');

/**
 * The source with its comments removed.
 *
 * The structural assertions below forbid certain names, and this module's header *explains* why
 * it does not use them — so asserting against the raw text failed on the documentation rather
 * than on the code. Comments are prose about the rule; the rule is about what executes.
 */
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** A fixed daytime clock. Without one, "sea" resolves to Ocean/Sunrise by day and
 *  Ocean/Moonlight after 19:00 — the resolver's time-of-day weight would make these tests pass
 *  in the morning and fail in the evening. */
const NOON = new Date(2026, 8, 12, 12, 0, 0).getTime();

/** A viewer that records what it was told, and reports back what it was last told. */
function fakeViewer(initial) {
    return {
        applied: [],
        _bg: initial === undefined ? 'black' : initial,
        getVisualState() {
            return { background: this._bg, renderMode: 'anime' };
        },
        setDesktopBackground(key) {
            this.applied.push(key);
            this._bg = key;
        },
    };
}

const ENTRIES = [
    { id: 'ambient:ocean:day', type: 'image', label: 'Ocean', category: 'relax', tags: ['sea', 'ocean', 'relax'] },
    { id: 'ambient:ocean:night', type: 'image', label: 'Ocean', category: 'sleep', tags: ['sea', 'ocean', 'night'] },
    { id: 'ambient:garden:day', type: 'image', label: 'Garden', category: 'meditation', tags: ['garden', 'calm'] },
];

function fakeCatalog(entries) {
    const list = entries === undefined ? ENTRIES : entries;
    return {
        images: () => list.slice(),
        has: (id) => list.some((e) => e.id === id) || ['black', 'dark', 'gray', 'light', 'white'].indexOf(id) !== -1,
        get: (id) => list.find((e) => e.id === id) || null,
    };
}

/** Everything the controller needs, with the clock under our control. */
function deps(overrides) {
    const base = {
        viewer: fakeViewer(),
        catalog: fakeCatalog(),
        resolver: Resolver,
        switch: Switch,
        now: () => 1000,
    };
    return Object.assign(base, overrides || {});
}

beforeEach(() => {
    localStorage.clear();
    Switch.reset();
    Controller.reset();
});

describe('no duplicate state — §9, asserted structurally', () => {
    test('the module declares no current-scene field of its own', () => {
        // The failure this prevents: a cached id that disagrees with the renderer. There is
        // exactly one answer to "what is showing", and it lives in ViewerEngine.
        expect(code).not.toMatch(/currentSceneId/);
        expect(code).not.toMatch(/let\s+currentScene\b/);
        expect(code).not.toMatch(/this\._current(Scene|Background)/);
    });

    test('it reads the answer from getVisualState instead', () => {
        expect(source).toContain('getVisualState');
    });

    test('currentScene() reflects the viewer, not a stored copy', () => {
        const d = deps();
        d.viewer._bg = 'ambient:garden:day';
        expect(Controller.currentScene(d)).toBe('ambient:garden:day');
        // Changed behind the controller's back — a cache would now be wrong.
        d.viewer._bg = 'ambient:ocean:night';
        expect(Controller.currentScene(d)).toBe('ambient:ocean:night');
    });

    test('a viewer that cannot report gives null rather than throwing', () => {
        expect(Controller.currentScene(deps({ viewer: null }))).toBeNull();
        expect(Controller.currentScene(deps({ viewer: {} }))).toBeNull();
    });
});

describe('apply — the no-op guard', () => {
    test('requesting the scene already showing changes nothing', () => {
        const d = deps();
        d.viewer._bg = 'ambient:ocean:day';
        const result = Controller.apply('ambient:ocean:day', { source: 'settings' }, d);
        expect(result.changed).toBe(false);
        expect(result.reason).toBe('already-showing');
        expect(d.viewer.applied).toEqual([]);
    });

    test('and fires no event', () => {
        const d = deps();
        d.viewer._bg = 'ambient:ocean:day';
        const seen = [];
        const off = Controller.onChange((e) => seen.push(e));
        Controller.apply('ambient:ocean:day', { source: 'settings' }, d);
        off();
        expect(seen).toEqual([]);
    });

    test('a real change applies once and reports it', () => {
        const d = deps();
        const result = Controller.apply('ambient:ocean:day', { source: 'settings' }, d);
        expect(result.changed).toBe(true);
        expect(d.viewer.applied).toEqual(['ambient:ocean:day']);
    });

    test('an id the catalogue does not know is refused, not passed through', () => {
        // The LLM never supplies ids (A10 rejects the attribute), but A11's settings path and a
        // stale localStorage value both can. Refusing here keeps ViewerEngine's contract simple.
        const d = deps();
        const result = Controller.apply('ambient:forest:day', { source: 'settings' }, d);
        expect(result.changed).toBe(false);
        expect(result.reason).toBe('unknown-scene');
        expect(d.viewer.applied).toEqual([]);
    });

    test('a colour id is a legitimate target', () => {
        // "Take the picture away" has to be expressible, and the five colours are how.
        const d = deps();
        d.viewer._bg = 'ambient:ocean:day';
        expect(Controller.apply('black', { source: 'settings' }, d).changed).toBe(true);
        expect(d.viewer.applied).toEqual(['black']);
    });

    test('a missing or empty id is refused', () => {
        const d = deps();
        for (const bad of [undefined, null, '', '   ', 42, {}]) {
            expect(Controller.apply(bad, { source: 'settings' }, d).changed).toBe(false);
        }
        expect(d.viewer.applied).toEqual([]);
    });
});

describe('the change event', () => {
    test('it fires exactly once per real change, carrying the source', () => {
        Switch.enable();
        const d = deps();
        const seen = [];
        const off = Controller.onChange((e) => seen.push(e));
        Controller.apply('ambient:ocean:day', { source: 'model', intent: 'sea' }, d);
        off();
        expect(seen).toHaveLength(1);
        expect(seen[0].id).toBe('ambient:ocean:day');
        expect(seen[0].source).toBe('model');
        expect(seen[0].intent).toBe('sea');
    });

    test('settings changes are labelled as such, so A11 can skip echoing them back', () => {
        const d = deps();
        const seen = [];
        const off = Controller.onChange((e) => seen.push(e));
        Controller.apply('ambient:garden:day', { source: 'settings' }, d);
        off();
        expect(seen[0].source).toBe('settings');
    });

    test('an unknown source is recorded rather than silently relabelled', () => {
        const d = deps();
        const seen = [];
        const off = Controller.onChange((e) => seen.push(e));
        Controller.apply('ambient:garden:day', {}, d);
        off();
        expect(seen[0].source).toBe('unknown');
    });

    test('one throwing listener does not stop the others', () => {
        const d = deps();
        const seen = [];
        const offBad = Controller.onChange(() => {
            throw new Error('listener');
        });
        const offGood = Controller.onChange((e) => seen.push(e));
        expect(() => Controller.apply('ambient:ocean:day', { source: 'settings' }, d)).not.toThrow();
        offBad();
        offGood();
        expect(seen).toHaveLength(1);
    });

    test('onChange returns a working unsubscribe', () => {
        const d = deps();
        const seen = [];
        const off = Controller.onChange((e) => seen.push(e));
        off();
        Controller.apply('ambient:ocean:day', { source: 'settings' }, d);
        expect(seen).toEqual([]);
    });

    test('a non-function listener is ignored rather than stored', () => {
        expect(() => Controller.onChange(null)).not.toThrow();
        expect(typeof Controller.onChange(null)).toBe('function');
    });

    test('it also dispatches a DOM event, so non-module code can listen', () => {
        const d = deps();
        const seen = [];
        const handler = (e) => seen.push(e.detail);
        window.addEventListener(Controller.EVENT, handler);
        Controller.apply('ambient:ocean:day', { source: 'settings' }, d);
        window.removeEventListener(Controller.EVENT, handler);
        expect(seen).toHaveLength(1);
        expect(seen[0].id).toBe('ambient:ocean:day');
    });

    test('the event name is not in the NEXUS_AMBIENT namespace', () => {
        // That namespace belongs to a different feature; colliding would cross two features'
        // wires with no error message.
        expect(Controller.EVENT).toBe('nexus:scene-ambience-change');
        expect(code).not.toMatch(/nexus_ambient_enabled|NEXUS_AMBIENT\b/);
    });
});

describe('the cooldown is model-only', () => {
    // The cooldown only ever applies to the model, so every case here needs the permission on.
    beforeEach(() => Switch.enable());

    test('a second model change inside 20 s is refused', () => {
        let t = 10_000;
        const d = deps({ now: () => t });
        expect(Controller.apply('ambient:ocean:day', { source: 'model' }, d).changed).toBe(true);
        t += 19_000;
        const second = Controller.apply('ambient:garden:day', { source: 'model' }, d);
        expect(second.changed).toBe(false);
        expect(second.reason).toBe('cooldown');
        expect(d.viewer.applied).toEqual(['ambient:ocean:day']);
    });

    test('after 20 s it is allowed again', () => {
        let t = 10_000;
        const d = deps({ now: () => t });
        Controller.apply('ambient:ocean:day', { source: 'model' }, d);
        t += 20_000;
        expect(Controller.apply('ambient:garden:day', { source: 'model' }, d).changed).toBe(true);
        expect(d.viewer.applied).toEqual(['ambient:ocean:day', 'ambient:garden:day']);
    });

    test('the first model change in a session is never refused', () => {
        const d = deps({ now: () => 0 });
        expect(Controller.apply('ambient:ocean:day', { source: 'model' }, d).changed).toBe(true);
    });

    test('manual selection ignores the cooldown entirely', () => {
        let t = 10_000;
        const d = deps({ now: () => t });
        Controller.apply('ambient:ocean:day', { source: 'model' }, d);
        t += 100;
        expect(Controller.apply('ambient:garden:day', { source: 'settings' }, d).changed).toBe(true);
        t += 100;
        expect(Controller.apply('ambient:ocean:night', { source: 'settings' }, d).changed).toBe(true);
    });

    test('a manual change does not start a cooldown against the model', () => {
        // Clicking a radio must not make her next legitimate response fail. The timestamp
        // records model changes only.
        let t = 10_000;
        const d = deps({ now: () => t });
        Controller.apply('ambient:ocean:day', { source: 'settings' }, d);
        t += 100;
        expect(Controller.apply('ambient:garden:day', { source: 'model' }, d).changed).toBe(true);
    });

    test('a refused model change does not reset the clock', () => {
        // Otherwise three rapid tags would hold the cooldown open indefinitely.
        let t = 10_000;
        const d = deps({ now: () => t });
        Controller.apply('ambient:ocean:day', { source: 'model' }, d);
        t += 15_000;
        expect(Controller.apply('ambient:garden:day', { source: 'model' }, d).reason).toBe('cooldown');
        t += 5_000;
        expect(Controller.apply('ambient:garden:day', { source: 'model' }, d).changed).toBe(true);
    });

    test('a no-op does not start a cooldown either', () => {
        let t = 10_000;
        const d = deps({ now: () => t });
        d.viewer._bg = 'ambient:ocean:day';
        Controller.apply('ambient:ocean:day', { source: 'model' }, d);
        t += 100;
        expect(Controller.apply('ambient:garden:day', { source: 'model' }, d).changed).toBe(true);
    });

    test('the window is 20 seconds, stated once', () => {
        expect(Controller.COOLDOWN_MS).toBe(20_000);
    });

    test('reset clears it, so a test or a reload starts clean', () => {
        const d = deps({ now: () => 10_000 });
        Controller.apply('ambient:ocean:day', { source: 'model' }, d);
        Controller.reset();
        expect(Controller.apply('ambient:garden:day', { source: 'model' }, d).changed).toBe(true);
    });
});

describe('the switch gates the model, never the user', () => {
    test('ambience off → a model change is refused', () => {
        Switch.disable();
        const d = deps();
        const result = Controller.apply('ambient:ocean:day', { source: 'model' }, d);
        expect(result.changed).toBe(false);
        expect(result.reason).toBe('disabled');
        expect(d.viewer.applied).toEqual([]);
    });

    test('ambience off → a settings change still succeeds', () => {
        // The mental model: Viewport Background = what I see; Ambience = whether she may change
        // it. A radio that stopped working when the toggle was off would break that in two.
        Switch.disable();
        const d = deps();
        expect(Controller.apply('ambient:ocean:day', { source: 'settings' }, d).changed).toBe(true);
    });

    test('off by default, so a model change is refused on a fresh profile', () => {
        const d = deps();
        expect(Controller.apply('ambient:ocean:day', { source: 'model' }, d).reason).toBe('disabled');
    });

    test('ambience on → a model change succeeds', () => {
        Switch.enable();
        const d = deps();
        expect(Controller.apply('ambient:ocean:day', { source: 'model' }, d).changed).toBe(true);
    });

    test('the switch is read at apply time, not captured earlier', () => {
        Switch.enable();
        const d = deps();
        Switch.disable();
        expect(Controller.apply('ambient:ocean:day', { source: 'model' }, d).reason).toBe('disabled');
    });

    test('a missing switch module refuses the model and allows the user', () => {
        const d = deps({ switch: null });
        delete global.NEXUS_SCENE_AMBIENCE_SWITCH;
        try {
            expect(Controller.apply('ambient:ocean:day', { source: 'model' }, d).reason).toBe('disabled');
            expect(Controller.apply('ambient:garden:day', { source: 'settings' }, d).changed).toBe(true);
        } finally {
            global.NEXUS_SCENE_AMBIENCE_SWITCH = Switch;
        }
    });
});

describe('requestByIntent — the entry point A10 calls', () => {
    test('a known intent resolves and applies', async () => {
        Switch.enable();
        const d = deps();
        const result = await Controller.requestByIntent({ intent: 'sea', source: 'model', now: NOON }, d);
        expect(result.changed).toBe(true);
        expect(result.id).toBe('ambient:ocean:day');
        expect(d.viewer.applied).toEqual(['ambient:ocean:day']);
    });

    test('it passes the stored preference into the resolver', async () => {
        Switch.enable();
        Switch.setPreference('night');
        const seen = [];
        const d = deps({
            resolver: {
                resolve(input) {
                    seen.push(input);
                    return 'ambient:ocean:night';
                },
            },
        });
        await Controller.requestByIntent({ intent: 'sea', source: 'model' }, d);
        expect(seen[0].preference).toBe('night');
        expect(seen[0].intent).toBe('sea');
    });

    test('an intent nothing can satisfy is declined without touching the viewer', async () => {
        Switch.enable();
        const d = deps();
        const result = await Controller.requestByIntent({ intent: 'forest', source: 'model' }, d);
        expect(result.changed).toBe(false);
        expect(result.reason).toBe('no-match');
        expect(d.viewer.applied).toEqual([]);
    });

    test('it refuses before resolving when ambience is off', async () => {
        // Cheaper, and it keeps "she is not allowed" distinct from "there was no match" in logs.
        const resolved = [];
        const d = deps({
            resolver: {
                resolve(input) {
                    resolved.push(input);
                    return 'ambient:ocean:day';
                },
            },
        });
        const result = await Controller.requestByIntent({ intent: 'sea', source: 'model' }, d);
        expect(result.reason).toBe('disabled');
        expect(resolved).toEqual([]);
    });

    test('a settings-sourced intent request works with ambience off', async () => {
        const d = deps();
        const result = await Controller.requestByIntent({ intent: 'sea', source: 'settings', now: NOON }, d);
        expect(result.changed).toBe(true);
    });

    test('it defaults to the model source, because that is the caller that matters', async () => {
        const d = deps();
        const result = await Controller.requestByIntent({ intent: 'sea' }, d);
        expect(result.reason).toBe('disabled');
    });

    test('an empty catalogue declines rather than throwing', async () => {
        Switch.enable();
        const d = deps({ catalog: fakeCatalog([]) });
        expect((await Controller.requestByIntent({ intent: 'sea', source: 'model' }, d)).changed).toBe(false);
    });

    test('a resolver that throws declines rather than taking the reply down', async () => {
        Switch.enable();
        const d = deps({
            resolver: {
                resolve() {
                    throw new Error('resolver');
                },
            },
        });
        const result = await Controller.requestByIntent({ intent: 'sea', source: 'model' }, d);
        expect(result.changed).toBe(false);
        expect(d.viewer.applied).toEqual([]);
    });

    test('it never accepts an id, a path or a URL from the caller', async () => {
        // The security property of the whole AI path: intent words in, catalogue ids out. A
        // caller-supplied id here would be a hole straight through A10's attribute whitelist.
        Switch.enable();
        const d = deps();
        const result = await Controller.requestByIntent(
            { intent: 'sea', id: 'https://elsewhere/x.webp', src: '../../etc/passwd', source: 'model', now: NOON },
            d
        );
        expect(result.id).toBe('ambient:ocean:day');
        expect(d.viewer.applied).toEqual(['ambient:ocean:day']);
    });

    test('the resolved id is looked up in the catalogue before it is applied', async () => {
        // Belt and braces: a resolver handed a doctored entry list cannot reach the viewer with
        // an id the catalogue does not vouch for.
        Switch.enable();
        const d = deps({ resolver: { resolve: () => 'ambient:nowhere:day' } });
        const result = await Controller.requestByIntent({ intent: 'sea', source: 'model' }, d);
        expect(result.changed).toBe(false);
        expect(d.viewer.applied).toEqual([]);
    });

    test('no arguments at all is a decline, not a crash', async () => {
        expect((await Controller.requestByIntent()).changed).toBe(false);
    });
});

describe('the globals fallback, which is how this ships before A11', () => {
    test('it reads the global viewer, catalogue, resolver and switch', () => {
        const viewer = fakeViewer();
        global.NEXUS_VIEWER = viewer;
        global.NEXUS_VIEWPORT_BACKGROUND_CATALOG = fakeCatalog();
        try {
            expect(Controller.apply('ambient:ocean:day', { source: 'settings' }).changed).toBe(true);
            expect(viewer.applied).toEqual(['ambient:ocean:day']);
        } finally {
            delete global.NEXUS_VIEWER;
            delete global.NEXUS_VIEWPORT_BACKGROUND_CATALOG;
        }
    });

    test('with nothing wired up at all it declines quietly', () => {
        const bg = global.NEXUS_VIEWPORT_BACKGROUND_CATALOG;
        delete global.NEXUS_VIEWPORT_BACKGROUND_CATALOG;
        try {
            expect(Controller.apply('ambient:ocean:day', { source: 'settings' }).changed).toBe(false);
        } finally {
            if (bg) global.NEXUS_VIEWPORT_BACKGROUND_CATALOG = bg;
        }
    });

    test('it exposes itself under the scene-ambience name', () => {
        expect(global.NEXUS_SCENE_AMBIENCE_CONTROLLER).toBe(Controller);
    });
});

describe('house shape', () => {
    test('no top-level import or export', () => {
        expect(code).not.toMatch(/^\s*import\s/m);
        expect(code).not.toMatch(/^\s*export\s/m);
    });

    test('dual export, so the browser and Jest both get it', () => {
        expect(source).toContain('module.exports = api;');
        expect(source).toContain('global.NEXUS_SCENE_AMBIENCE_CONTROLLER = api;');
    });

    test('it fails soft — warnings, never throws', () => {
        expect(code).toContain('console.warn');
        expect(code).not.toMatch(/\bthrow new\b/);
    });

    test('it applies through setDesktopBackground and nothing lower', () => {
        // Not scene.background, not a texture, not the renderer. One application point.
        expect(code).toContain('setDesktopBackground');
        expect(code).not.toMatch(/scene\.background|TextureLoader|dispose\(/);
    });
});
