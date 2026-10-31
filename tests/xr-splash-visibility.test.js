/**
 * XL7 — the HomePilot loading card is handed over by what the headset SHOWED, not by the clock.
 *
 * Over Air Link the session went 'hidden' 59 ms after it started and became 'visible' ~1 s later
 * (Link shows its own loading screen meanwhile, and a hidden session gets no frames). The card's
 * 900 ms minimum was counted from its creation, so it was disposed 80 ms before the headset could
 * first have shown it: 1 frame drawn, 0 seen. In the Quest's own browser the session is visible
 * from the start, which is why the card always showed there.
 *
 * Pinned here: the hand-over rule against both environments (the Air Link case with the real
 * timeline), the never-visible fallback, the report's account of the card's life and of who ended
 * the session, the hidden-session diagnosis, the card's texture refresh after a context restore,
 * and the ViewerEngine wiring that a jsdom test can reach.
 */

const fs = require('fs');
const path = require('path');
const S = require('../src/gltf-viewer/XRSplash.js');
const T = require('../src/gltf-viewer/XREntryTrace.js');

describe('when the card may give way', () => {
    test('native Quest Browser: visible from the start — ready, and seen for the minimum', () => {
        // card created 1000, first visible frame 1013, warm-up ready 1180
        expect(S.handOverAt({ readyAt: 1180, visibleSince: 1013 })).toBe(1013 + S.MIN_MS);
        // a slow warm-up: she is the last thing waited for
        expect(S.handOverAt({ readyAt: 5000, visibleSince: 1013 })).toBe(5000);
    });

    test('Air Link, the measured timeline: the old rule handed over unseen, the new one after it is seen', () => {
        const created = 33122; // card made, before the session existed
        const ready = 33315; // warm-up finished (180 ms)
        const firstVisibleFrame = 34108; // the session turned 'visible'
        const oldHandOver = S.endAt(created, ready);
        expect(oldHandOver).toBeLessThan(firstVisibleFrame); // 34022: gone 86 ms before it could be seen
        // Before the headset shows anything, the card waits (only the never-visible fallback applies)…
        expect(S.handOverAt({ readyAt: ready, visibleSince: null })).toBe(ready + S.MAX_UNSEEN_MS);
        // …and once seen, it stays its minimum.
        expect(S.handOverAt({ readyAt: ready, visibleSince: firstVisibleFrame })).toBe(firstVisibleFrame + S.MIN_MS);
    });

    test('a session the runtime never shows cannot hold the card forever', () => {
        const at = S.handOverAt({ readyAt: 2000, visibleSince: null });
        expect(at).toBe(2000 + S.MAX_UNSEEN_MS);
        expect(S.MAX_UNSEEN_MS).toBeGreaterThan(S.MIN_MS);
        expect(S.MAX_UNSEEN_MS).toBeLessThanOrEqual(10000);
    });

    test('not ready yet: no hand-over time at all', () => {
        expect(S.handOverAt({ readyAt: null, visibleSince: 1000 })).toBeNull();
    });
});

describe('the card survives a WebGL context restore', () => {
    test('refresh() repaints and re-marks its texture for upload', () => {
        const textures = [];
        class Obj {
            constructor() {
                this.position = { set() {} };
                this.rotation = { set() {}, z: 0 };
                this.children = [];
            }
            add(c) {
                this.children.push(c);
            }
            remove() {}
        }
        const THREE = {
            Scene: Obj,
            Group: Obj,
            Mesh: class extends Obj {
                constructor(g, m) {
                    super();
                    this.geometry = g;
                    this.material = m;
                }
            },
            Color: class {},
            Vector3: class {},
            CanvasTexture: class {
                constructor() {
                    textures.push(this);
                }
            },
            PlaneGeometry: class {},
            RingGeometry: class {},
            MeshBasicMaterial: class {},
            DoubleSide: 2,
        };
        const ctx = new Proxy({}, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => ((o[k] = v), true) });
        const splash = S.create(THREE, { image: null, doc: { createElement: () => ({ getContext: () => ctx }) } });
        textures[0].needsUpdate = false;
        splash.refresh();
        expect(textures[0].needsUpdate).toBe(true);
    });
});

function traced() {
    let t = 1000;
    const logs = [];
    const trace = T.create({ now: () => t, log: (...a) => logs.push(a.join(' ')), warn: () => {} });
    return { trace, logs, advance: (ms) => (t += ms) };
}

describe('the report tells the card’s life as the headset saw it', () => {
    function airLink(seen) {
        const x = traced();
        x.trace.begin({});
        for (const id of ['granted', 'gpu', 'card', 'session']) x.trace.step(id);
        x.trace.frame('card', { visible: true }); // the one frame before Link hides it
        x.advance(59);
        x.trace.note('session visibility → hidden');
        x.advance(900);
        if (seen) {
            x.trace.note('session visibility → visible');
            for (let i = 0; i < 80; i++) x.trace.frame('card', { visible: true });
            x.advance(950);
        }
        x.trace.finished(true);
        x.trace.frame('scene');
        return x;
    }

    test('frames seen vs drawn, and when it was first seen', () => {
        const x = airLink(true);
        const r = x.trace.report();
        expect(r).toMatch(/loading card: 81 of 81 frames while visible, first frame \+0 ms, first seen \+0 ms/);
        expect(r).toMatch(/her scene: first frame \+\d+ ms/);
    });

    test('a card handed over without ever being visible says so', () => {
        const x = traced();
        x.trace.begin({});
        x.trace.step('session');
        x.trace.frame('card', { visible: false });
        expect(x.trace.report()).toMatch(/loading card: 0 of 1 frames while visible.*never seen in the headset/);
    });

    test('who ended the session', () => {
        const page = airLink(true);
        page.trace.pageEnding('EXIT VR pressed');
        page.trace.ended();
        expect(page.logs.find((l) => l.includes('report'))).toMatch(/ended by: this page \(EXIT VR pressed\)/);

        const headset = airLink(true);
        headset.trace.ended();
        expect(headset.logs.find((l) => l.includes('report'))).toMatch(
            /ended by: the headset or its XR runtime \(this page did not ask\)/
        );
    });

    test('a long-hidden session is diagnosed as the runtime’s screen, not the page’s failure', () => {
        const x = traced();
        x.trace.begin({});
        for (const id of ['granted', 'gpu', 'card', 'session', 'warmup']) x.trace.step(id);
        x.trace.note('session visibility → hidden');
        x.advance(4000);
        expect(x.trace.check()).toMatch(/kept this session hidden since \+0 ms.*showing its own screen/);
    });
});

describe('ViewerEngine wiring', () => {
    const engine = fs.readFileSync(path.resolve(__dirname, '../src/gltf-viewer/ViewerEngine.js'), 'utf-8');
    const body = (sig) => {
        const start = engine.indexOf(sig);
        expect(start).toBeGreaterThan(-1);
        return engine.slice(start, engine.indexOf('\n    }\n', start));
    };

    test('entry hands over through handOverAt, with a fallback timer for a session never shown', () => {
        const finish = body('    _finishXREntry(entered) {');
        expect(finish).toMatch(/this\._splashReadyAt = performance\.now\(\)/);
        expect(finish).toMatch(/setTimeout\(\(\) => this\._maybeEndSplash\(\), \(S\.MAX_UNSEEN_MS/);
        expect(finish).not.toMatch(/S\.endAt\(/);
        const end = body('    _maybeEndSplash() {');
        expect(end).toMatch(
            /S\.handOverAt\(\{ readyAt: this\._splashReadyAt, visibleSince: this\._splashVisibleSince \}\)/
        );
        expect(end).toMatch(/const ended = !this\.renderer\.xr\.isPresenting/); // a session that ended never waits
    });

    test('a context restored while the card is up keeps the card, not her loop', () => {
        const start = engine.indexOf("addEventListener('webglcontextrestored'");
        const handler = engine.slice(start, engine.indexOf('});', start));
        const keepCard = handler.indexOf('if (this._splash) {');
        expect(keepCard).toBeGreaterThan(-1);
        expect(handler.indexOf('this._runSplashLoop()')).toBeGreaterThan(keepCard);
        expect(keepCard).toBeLessThan(handler.indexOf('this.animate()'));
        expect(handler).toMatch(/this\.vrSupport\?\.isToggling \|\| this\.vrSupport\?\._entering/);
    });

    test('three is handed one loop, once: switching card → her → none never restarts its desktop loop', () => {
        // three r147's renderer.setAnimationLoop(fn) calls animation.start() — the WINDOW rAF loop —
        // even mid-session, so each switch inside a session made her frame run twice.
        expect((engine.match(/this\.renderer\.setAnimationLoop\(/g) || []).length).toBe(1);
        const src = body('    _setLoop(fn) {');
        expect(src).toMatch(/this\.renderer\.setAnimationLoop\(/);
        // eslint-disable-next-line no-new-func
        const setLoop = new Function('fn', src.slice(src.indexOf('{') + 1));
        let desktopStarts = 0;
        let installed = null;
        const viewer = {
            renderer: {
                setAnimationLoop(cb) {
                    installed = cb;
                    if (cb) desktopStarts++; // what three r147 does on every call
                },
            },
        };
        const card = jest.fn();
        const her = jest.fn();
        setLoop.call(viewer, card);
        installed(1, 'frame');
        setLoop.call(viewer, null); // the warm-up holds the loop
        installed(2, 'frame');
        setLoop.call(viewer, her);
        installed(3, 'frame');
        expect(desktopStarts).toBe(1);
        expect(card).toHaveBeenCalledTimes(1);
        expect(her).toHaveBeenCalledWith(3, 'frame');
        expect(her).toHaveBeenCalledTimes(1);
    });

    test('the watchdog waits out a hidden session instead of re-arming her loop', () => {
        const dog = body('    _xrWatchdog(attempt, hiddenWaits = 0) {');
        const hidden = dog.indexOf("visibilityState === 'hidden'");
        expect(hidden).toBeGreaterThan(-1);
        expect(hidden).toBeLessThan(dog.indexOf('this.animate()'));
    });
});
