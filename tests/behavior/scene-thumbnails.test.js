/**
 * Scene thumbnails through the whole Together / Scene Tale lifecycle — and what they must not do.
 *
 * The pictures Together shows are the production ambience plates: the same calibrated files the
 * viewport renders, referenced read-only. That buys visual richness for nothing, and it puts one
 * very expensive mistake within reach — a thumbnail path that also *selects* a background, and a
 * user who opened a menu and found their scene changed.
 *
 * So each test here pairs the visible outcome with the invisible one. Every screen is painted
 * against a fully instrumented fake viewport whose every background entry point counts its calls,
 * and every test that checks a picture also checks that the counter is still zero.
 *
 * What is not asserted, because jsdom cannot: pixel geometry. jsdom evaluates no media queries and
 * measures no boxes, so "the thumbnail does not dominate the phone" is a browser fact. The layout
 * half is pinned as the CSS contract instead — the sizes the boxes are declared at — which is the
 * house pattern for this suite.
 */

/* global describe, test, expect, beforeEach, afterEach, jest */

const TogetherPanel = require('../../src/features/together/ui/TogetherPanel.js');
const PlaygroundActivity = require('../../src/features/together/activities/playground.js');
const SetupView = require('../../src/features/together/ui/SceneTaleSetupView.js');
const SceneArt = require('../../src/features/together/SceneArt.js');

const TERRACE = { id: 'ambient:terrace:night', label: 'Coastal Terrace · Twilight' };
const TERRACE_ART = 'assets/ambient/dark/coastal-terrace-twilight.webp';
const GARDEN = { id: 'ambient:garden:day', label: 'Meditation Garden · Day' };
const GARDEN_ART = 'assets/ambient/light/meditation-garden-day.webp';

/**
 * Every way a module in this repo can reach the rendered environment, each one counting.
 *
 * Deliberately over-complete: the manager and the catalogue are here even though a thumbnail has
 * no reason to want either, because the point is to catch the call nobody meant to write. A spy
 * on only the obvious entry point proves only that the obvious mistake was avoided.
 */
function viewport(scene) {
    const calls = [];
    const record =
        (name) =>
        (...args) => {
            calls.push({ name, args });
            return null;
        };
    window.NEXUS_VIEWER = {
        setDesktopBackground: record('setDesktopBackground'),
        setBackground: record('setBackground'),
        // The live read `SceneTaleSetupView` prefers over anything it is handed, so the
        // fake has to answer with the scene the test actually wired.
        getVisualState: () => ({ background: (scene || TERRACE).id }),
    };
    window.NEXUS_VIEWPORT_BACKGROUND_MANAGER = {
        apply: record('apply'),
        clear: record('clear'),
        reapplyCurrent: record('reapplyCurrent'),
        setGrounded: record('setGrounded'),
    };
    window.NEXUS_VIEWPORT_BACKGROUND_CATALOG = {
        get: record('catalog.get'),
        sourceFor: record('catalog.sourceFor'),
    };
    window.NEXUS_SCENE_AMBIENCE_CONTROLLER = { apply: record('controller.apply') };
    return {
        calls,
        /** The whole assertion, in one line, at the end of every test below. */
        untouched() {
            expect(calls.map((entry) => entry.name)).toEqual([]);
        },
    };
}

function consentMachine() {
    return { state: 'idle', onChange: () => () => {}, revoke: () => true };
}

function panel() {
    document.body.innerHTML = '<div id="host"></div>';
    const p = TogetherPanel.attach({ consent: consentMachine(), doc: document, win: window });
    p.mount(document.getElementById('host'));
    return p;
}

function wireDirector(p, scene) {
    window.NEXUS_SPICY = { isEnabled: () => false, onChange: () => () => {} };
    window.NEXUS_BD = {
        blackboard: { scene, activity: 'chat', escalationLevel: 0, nsfwAllowed: false },
        togetherPanel: p,
        adult: null,
        bus: { emit: jest.fn(), on: jest.fn(() => () => {}) },
    };
    return window.NEXUS_BD;
}

function flush() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

/** The Together shelf, with Scene Tale registered so its tile is actually drawn. */
function shelf(p) {
    const activity = PlaygroundActivity.attach({ win: window, doc: document });
    p.register(activity);
    p.open();
    return activity;
}

/** The Configure panel Playground paints, with the setup view's decoration applied on top. */
function configure(activity, p) {
    p.register(activity);
    p.open();
    document.querySelector('[data-activity="playground"]').click();
    SetupView.decorate(document);
    return document.getElementById(TogetherPanel.PANEL_ID);
}

beforeEach(() => {
    SceneArt.reset();
    window.NEXUS_SCENE_ART = SceneArt;
    window.NEXUS_TOGETHER_SWITCH = { enable: jest.fn() };
    localStorage.clear();
});

afterEach(() => {
    SetupView.detach();
    delete window.NEXUS_SCENE_ART;
    delete window.NEXUS_TOGETHER_SWITCH;
    delete window.NEXUS_BD;
    delete window.NEXUS_SPICY;
    delete window.NEXUS_VIEWER;
    delete window.NEXUS_VIEWPORT_BACKGROUND_MANAGER;
    delete window.NEXUS_VIEWPORT_BACKGROUND_CATALOG;
    delete window.NEXUS_SCENE_AMBIENCE_CONTROLLER;
    localStorage.clear();
    document.body.innerHTML = '';
});

describe('the Together shelf', () => {
    test('the Scene Tale tile shows the place she is actually in', () => {
        const view = viewport(TERRACE);
        const p = panel();
        wireDirector(p, TERRACE);
        const activity = shelf(p);

        const tile = document.querySelector('[data-activity=playground]');
        const img = tile.querySelector('img');
        expect(img.getAttribute('src')).toBe(TERRACE_ART);
        expect(img.dataset.sceneId).toBe(TERRACE.id);
        view.untouched();

        activity.detach();
    });

    test('and a different place gives a different tile, with no default baked in', () => {
        const view = viewport(GARDEN);
        const p = panel();
        wireDirector(p, GARDEN);
        const activity = shelf(p);

        expect(document.querySelector('[data-activity=playground] img').getAttribute('src')).toBe(GARDEN_ART);
        view.untouched();

        activity.detach();
    });

    test('an unrecognised place keeps the glyph rather than showing a grey box', () => {
        const unknown = { id: 'somewhere-else', label: 'Somewhere Else' };
        const view = viewport(unknown);
        const p = panel();
        wireDirector(p, unknown);
        const activity = shelf(p);

        const tile = document.querySelector('[data-activity=playground]');
        expect(tile.querySelector('img')).toBeNull();
        expect(tile.querySelector('.nexus-bd-together-icon')).toBeTruthy();
        expect(tile.textContent).toContain('Playground');
        view.untouched();

        activity.detach();
    });

    test('only Scene Tale gets a picture; the other tiles are unchanged', () => {
        const view = viewport(TERRACE);
        const p = panel();
        wireDirector(p, TERRACE);
        const activity = shelf(p);

        for (const tile of document.querySelectorAll('.nexus-bd-together-tile')) {
            if (tile.dataset.activity === 'playground') continue;
            expect(tile.querySelector('img')).toBeNull();
        }
        expect(document.querySelectorAll('.nexus-bd-together-tile').length).toBeGreaterThan(0);
        view.untouched();

        activity.detach();
    });
});

describe('Configure — the Current place card', () => {
    test('shows the authoritative label and the matching picture', () => {
        const view = viewport(TERRACE);
        const p = panel();
        wireDirector(p, TERRACE);
        const activity = PlaygroundActivity.attach({ win: window, doc: document });
        configure(activity, p);

        const card = document.querySelector('.nexus-scene-tale-place-card');
        expect(card.querySelector('.nexus-scene-tale-place-name').textContent).toBe('Coastal Terrace · Twilight');
        expect(card.querySelector('img').getAttribute('src')).toBe(TERRACE_ART);
        view.untouched();

        activity.detach();
    });

    test('follows the scene rather than remembering the first one it saw', () => {
        const view = viewport(GARDEN);
        const p = panel();
        wireDirector(p, GARDEN);
        const activity = PlaygroundActivity.attach({ win: window, doc: document });
        configure(activity, p);

        expect(document.querySelector('.nexus-scene-tale-place-card img').getAttribute('src')).toBe(GARDEN_ART);
        view.untouched();

        activity.detach();
    });

    test('a picture that fails to load leaves the label and the card intact', () => {
        // Item 8 of the brief, and the one worth being loudest about: a missing thumbnail is a
        // presentation failure. Nothing about it is allowed to reach the scene.
        const view = viewport(TERRACE);
        const p = panel();
        wireDirector(p, TERRACE);
        const activity = PlaygroundActivity.attach({ win: window, doc: document });
        configure(activity, p);

        const card = document.querySelector('.nexus-scene-tale-place-card');
        card.querySelector('img').dispatchEvent(new window.Event('error'));

        expect(card.querySelector('img')).toBeNull();
        expect(card.querySelector('.nexus-scene-tale-place-name').textContent).toBe('Coastal Terrace · Twilight');
        view.untouched();

        activity.detach();
    });
});

describe('Preparing, Ready, and the story that follows', () => {
    function planner(prepared) {
        return {
            prepare: jest.fn(({ onProgress }) => {
                ['scene', 'story'].forEach((step) => onProgress(step));
                return Promise.resolve({ plan: prepared, soundtrack: null });
            }),
        };
    }

    test('Preparing names the place, which it used to leave blank', async () => {
        // Twelve seconds of `Creating our story…` with four ticking rows and nothing saying which
        // of ten places the story was about. The scene had not been dropped; it was invisible.
        const view = viewport(TERRACE);
        const p = panel();
        wireDirector(p, TERRACE);
        const prepared = PlaygroundActivity.fallbackStory(TERRACE, '', false);
        const activity = PlaygroundActivity.attach({
            win: window,
            doc: document,
            planner: { prepare: () => new Promise(() => {}) },
            timingScale: 0,
        });
        configure(activity, p);
        activity.prepare({ idea: '', music: 'none' });
        await flush();

        const strip = document.querySelector('.nexus-story-scene-strip');
        expect(strip.dataset.sceneId).toBe(TERRACE.id);
        expect(strip.querySelector('img').getAttribute('src')).toBe(TERRACE_ART);
        expect(strip.textContent).toContain('Coastal Terrace · Twilight');
        view.untouched();
        expect(prepared.sceneId).toBe(TERRACE.id);

        activity.detach();
    });

    test('Ready shows the same place, from the plan the story was written against', async () => {
        const view = viewport(TERRACE);
        const p = panel();
        wireDirector(p, TERRACE);
        const prepared = PlaygroundActivity.fallbackStory(TERRACE, '', false);
        const activity = PlaygroundActivity.attach({
            win: window,
            doc: document,
            planner: planner(prepared),
            timingScale: 0,
        });
        configure(activity, p);
        await activity.prepare({ idea: '', music: 'none' });

        const strip = document.querySelector('.nexus-story-scene-strip');
        expect(strip.dataset.sceneId).toBe(TERRACE.id);
        expect(strip.querySelector('img').getAttribute('src')).toBe(TERRACE_ART);
        expect(document.querySelector('[data-action=start-story]')).toBeTruthy();
        view.untouched();

        activity.detach();
    });

    test('Another version keeps the place instead of falling back to a generic one', async () => {
        const view = viewport(TERRACE);
        const p = panel();
        wireDirector(p, TERRACE);
        const prepared = PlaygroundActivity.fallbackStory(TERRACE, '', false);
        const activity = PlaygroundActivity.attach({
            win: window,
            doc: document,
            planner: planner(prepared),
            timingScale: 0,
        });
        configure(activity, p);
        await activity.prepare({ idea: '', music: 'none' });
        document.querySelector('[data-action=another-version]').click();

        // Back on Configure, and the identity survived the round trip rather than being
        // re-derived from nothing.
        expect(activity._scene().id).toBe(TERRACE.id);
        expect(activity.preparedPlan).toBeNull();
        view.untouched();

        activity.detach();
    });

    test('the scene strip is one small row, never a second background', () => {
        // jsdom measures nothing, so this pins the declared contract: a bounded object-fit box,
        // inside a flex row, at a size no one could mistake for the environment behind her.
        const css = require('../../src/features/together/ui/SceneTaleConversationView.js').CSS;
        expect(css).toMatch(/\.nexus-story-scene-thumb\{[^}]*width:64px/);
        expect(css).toMatch(/\.nexus-story-scene-thumb\{[^}]*object-fit:cover/);
        expect(css).toMatch(/\.nexus-story-scene-strip\{[^}]*display:flex/);
        expect(css).not.toMatch(/\.nexus-story-scene-(strip|thumb)\{[^}]*position:(fixed|absolute)/);
        // And it gets smaller on a phone rather than taking the screen.
        expect(css).toMatch(/@media\(max-width:560px\)\{\.nexus-story-scene-strip[^@]*width:52px/);
    });

    test('the Current place card is a bounded landscape box at both widths', () => {
        const css = SetupView.CSS;
        expect(css).toMatch(/\.nexus-scene-tale-place-thumb\{[^}]*width:7\.25rem;height:3\.65rem/);
        expect(css).toMatch(/\.nexus-scene-tale-place-thumb\{[^}]*object-fit:cover/);
        // The phone rule shrinks it; it never becomes a full-width image.
        expect(css).toMatch(/\.nexus-scene-tale-place-thumb\{width:5\.25rem;flex-basis:5\.25rem;height:3rem\}/);
        expect(css).not.toMatch(/\.nexus-scene-tale-place-thumb\{[^}]*width:100%/);
    });
});

describe('what the whole lifecycle costs', () => {
    test('one scene on screen loads one file, not the library', async () => {
        // Twenty full-resolution plates exist. Walking Together → Configure → Preparing → Ready
        // must reference exactly the one place the user is in — anything that touches the other
        // nineteen is a page that downloads tens of megabytes to draw a 64px stamp.
        const view = viewport(TERRACE);
        const p = panel();
        wireDirector(p, TERRACE);
        const prepared = PlaygroundActivity.fallbackStory(TERRACE, '', false);
        const activity = PlaygroundActivity.attach({
            win: window,
            doc: document,
            planner: {
                prepare: ({ onProgress }) => {
                    onProgress('scene');
                    return Promise.resolve({ plan: prepared, soundtrack: null });
                },
            },
            timingScale: 0,
        });
        configure(activity, p);
        await activity.prepare({ idea: '', music: 'none' });

        const ambient = [...document.querySelectorAll('img')]
            .map((img) => img.getAttribute('src'))
            .filter((src) => /^assets\/ambient\//.test(src));
        // Not vacuous: there is art on screen, and it is all the one place.
        expect(ambient.length).toBeGreaterThan(0);
        expect([...new Set(ambient)]).toEqual([TERRACE_ART]);
        view.untouched();

        activity.detach();
    });

    test('no module in the thumbnail path encodes an image or names a second copy of one', () => {
        // Data URIs and a duplicated image directory are the two ways "make it fast" turns into
        // a second library that drifts from the calibrated one.
        const fs = require('fs');
        const path = require('path');
        const root = path.resolve(__dirname, '../..');
        for (const file of [
            'src/features/together/SceneArt.js',
            'src/features/together/ui/SceneTaleSetupView.js',
            'src/features/together/ui/SceneTaleArtView.js',
        ]) {
            const source = fs.readFileSync(path.join(root, file), 'utf8');
            expect(source).not.toMatch(/data:image\//);
            const paths = source.match(/assets\/[a-z0-9/-]+\.webp/g) || [];
            for (const found of paths) expect(found).toMatch(/^assets\/ambient\/(light|dark)\//);
        }
    });
});
