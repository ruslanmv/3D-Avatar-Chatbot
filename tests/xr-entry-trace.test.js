/**
 * XL4 — every step of entering VR, recorded (src/gltf-viewer/XREntryTrace.js), and a render loop
 * a single throwing subsystem can no longer stop.
 *
 * The person's Quest Link log showed the session start and the warm-up finish, then nothing until
 * they quit a frozen headset. These tests pin what the trace must be able to tell apart: no frames
 * asked for, stuck on the loading card, stuck in the warm-up, running-but-throwing — and that the
 * report prints by itself when the session ends.
 */

const fs = require('fs');
const path = require('path');
const T = require('../src/gltf-viewer/XREntryTrace.js');
const S = require('../src/gltf-viewer/XRSplash.js');

function clock() {
    let t = 1000;
    return { now: () => t, advance: (ms) => (t += ms) };
}

function traced() {
    const c = clock();
    const logs = [];
    const warns = [];
    const steps = [];
    const trace = T.create({
        now: c.now,
        log: (...a) => logs.push(a.join(' ')),
        warn: (...a) => warns.push(a.map(String).join(' ')),
        onStep: (id, label, short) => steps.push({ id, label, short }),
    });
    return { c, logs, warns, steps, trace };
}

/** Drive a trace through entry up to (and including) `upTo`. */
function enterUpTo(t, upTo) {
    t.trace.begin({ features: ['local-floor'] });
    for (const id of ['granted', 'gpu', 'card', 'session', 'warmup', 'warmed']) {
        t.c.advance(100);
        t.trace.step(id);
        if (id === upTo) return;
    }
    if (upTo === 'finished') {
        t.c.advance(10);
        t.trace.finished(true);
    }
}

describe('steps', () => {
    test('each step is shown with a sentence for the headset and a word for the desktop button', () => {
        const t = traced();
        enterUpTo(t, 'warmup');
        expect(t.steps.map((s) => s.id)).toEqual(['request', 'granted', 'gpu', 'card', 'session', 'warmup']);
        for (const s of T.STEPS.filter((x) => x.id !== 'scene')) {
            expect(s.label.length).toBeGreaterThanOrEqual(s.short.length);
            expect(s.short.length).toBeLessThanOrEqual(12); // the launch row must not grow
        }
        expect(t.logs.some((l) => /\[VR entry\] 6\/9 warmup \+500 ms/.test(l))).toBe(true);
    });

    test('the first scene frame is itself a step; frames are counted per loop', () => {
        const t = traced();
        enterUpTo(t, 'finished');
        t.trace.frame('card');
        t.trace.frame('card');
        t.trace.frame('scene');
        t.trace.frame('scene');
        const snap = t.trace.snapshot();
        expect(snap.frames).toEqual({ card: 2, scene: 2 });
        expect(snap.steps.scene).toBeTruthy();
        expect(t.steps.filter((s) => s.id === 'scene')).toHaveLength(1);
    });

    test('a new attempt forgets the last one', () => {
        const t = traced();
        enterUpTo(t, 'finished');
        t.trace.frame('scene');
        t.trace.begin({});
        expect(t.trace.snapshot().frames.scene).toBe(0);
        expect(t.trace.snapshot().steps.finished).toBeUndefined();
    });
});

describe('diagnosis — the four freezes that look the same from inside the headset', () => {
    test('nothing wrong while it is simply running', () => {
        const t = traced();
        enterUpTo(t, 'finished');
        t.trace.frame('scene');
        t.c.advance(10000);
        expect(t.trace.check()).toBeNull();
    });

    test('the headset never asked for a frame', () => {
        const t = traced();
        enterUpTo(t, 'warmup');
        t.c.advance(3500);
        expect(t.trace.check()).toMatch(/not asking this page for frames/);
    });

    test('stuck on the loading card: entry finished, her scene never drew', () => {
        const t = traced();
        enterUpTo(t, 'finished');
        t.trace.frame('card');
        t.c.advance(2500);
        expect(t.trace.check()).toMatch(/Stuck on the loading card/);
    });

    test('stuck in the warm-up', () => {
        const t = traced();
        enterUpTo(t, 'warmup');
        t.trace.frame('card');
        t.c.advance(26000);
        expect(t.trace.check()).toMatch(/warm-up has not finished/);
    });

    test('running, but a subsystem throws every frame — named, with its first message', () => {
        const t = traced();
        enterUpTo(t, 'finished');
        t.trace.frame('scene');
        t.trace.error('VR panel', new Error('boom'));
        t.trace.error('VR panel', new Error('boom again'));
        expect(t.trace.snapshot().errors['VR panel']).toMatchObject({ count: 2, message: 'boom' });
        expect(t.warns.filter((w) => /VR panel threw/.test(w))).toHaveLength(1); // printed once
        expect(t.trace.check()).toMatch(/VR panel threw during frames \(first: boom\)/);
    });

    test('a failure names its step', () => {
        const t = traced();
        enterUpTo(t, 'gpu');
        t.trace.fail('gpu', new Error('The WebGL context did not come back'));
        expect(t.trace.check()).toMatch(/failed at "gpu": The WebGL context did not come back/);
    });

    test('the same finding is warned once, not every check', () => {
        const t = traced();
        enterUpTo(t, 'finished');
        t.c.advance(3000);
        const finding = t.trace.check();
        expect(finding).toMatch(/not asking this page for frames/); // no frame at all outranks the card
        t.trace.check();
        expect(t.warns.filter((w) => w.includes(finding))).toHaveLength(1);
    });
});

describe('the report', () => {
    test('prints by itself when the session ends — once — with steps, frames and the finding', () => {
        const t = traced();
        enterUpTo(t, 'finished');
        t.trace.frame('card');
        t.c.advance(5000);
        t.trace.note('session visibility → visible-blurred');
        t.trace.ended();
        t.trace.ended();
        const reports = t.logs.filter((l) => l.startsWith('[VR entry] report'));
        expect(reports).toHaveLength(1);
        const r = reports[0];
        expect(r).toMatch(/✔ warmed/);
        expect(r).toMatch(/· scene\s+\(not reached\)/);
        expect(r).toMatch(/frames: loading card 1, her scene 0/);
        expect(r).toMatch(/session visibility → visible-blurred/);
        expect(r).toMatch(/→ Stuck on the loading card/);
    });

    test('says so when there is nothing to report yet', () => {
        expect(traced().trace.report()).toMatch(/no entry recorded/);
    });
});

describe('the loading card shows the step', () => {
    test('setStatus repaints the line under the name, and only when it changes', () => {
        const painted = [];
        const ctx = new Proxy(
            {},
            {
                get: (o, k) => (k in o ? o[k] : k === 'fillText' ? (text) => painted.push(text) : () => {}),
                set: (o, k, v) => ((o[k] = v), true),
            }
        );
        const doc = { createElement: () => ({ getContext: () => ctx }) };
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
            CanvasTexture: class {},
            PlaneGeometry: class {},
            RingGeometry: class {},
            MeshBasicMaterial: class {},
            DoubleSide: 2,
        };
        const splash = S.create(THREE, { image: null, doc });
        painted.length = 0;
        splash.setStatus('Preparing graphics…');
        expect(painted).toContain('Preparing graphics…');
        const n = painted.length;
        splash.setStatus('Preparing graphics…');
        expect(painted.length).toBe(n);
    });
});

describe('wiring', () => {
    const read = (f) => fs.readFileSync(path.resolve(__dirname, '../src/gltf-viewer', f), 'utf-8');
    const engine = read('ViewerEngine.js');
    const vr = read('VRSupport.js');

    test('every subsystem call in the render loop is inside its own try', () => {
        const start = engine.indexOf('    animate() {');
        const loop = engine.slice(start, engine.indexOf('\n    }\n', start));
        const calls = [
            'this.avatarManager?.update(dt)',
            'NEXUS_PROCEDURAL_ANIMATOR?.update?.(t, dt)',
            'this.vrControllers.update(dt)',
            'this.vrPoseSystem?.update(dt)',
            'this.vrPuppetInteraction?.update(dt)',
            'this.vrIntimacySystem?.update(dt)',
            'NEXUS_LOCOMOTION?.update?.(dt)',
            'NEXUS_MOTION?.update?.(dt)',
            'this.vrChatPanel?.update()',
            'this.postProcessing.render()',
        ];
        for (const call of calls) {
            const at = loop.indexOf(call);
            expect(at).toBeGreaterThan(-1);
            const before = loop.slice(0, at);
            // the nearest enclosing block opened by `try {` has not been closed by a `catch` yet
            expect(before.lastIndexOf('try {')).toBeGreaterThan(before.lastIndexOf('catch (e)'));
        }
        expect(loop).toContain("this._xrTrace?.frame('scene')");
    });

    test('the loading card loop is guarded and counts only frames the headset asked for', () => {
        const start = engine.indexOf('    _beginXRSplash() {');
        const card = engine.slice(start, engine.indexOf('\n    }\n', start));
        expect(card).toMatch(/if \(this\.renderer\.xr\.isPresenting\) this\._xrTrace\?\.frame\('card'\)/);
        expect(card.indexOf('try {')).toBeLessThan(card.indexOf('this.renderer.render(splash.scene'));
    });

    test('entry records its steps in order, its failure, its end, and prints the report on session end', () => {
        const enter = vr.slice(vr.indexOf('async toggleVR'), vr.indexOf('    async _makeXRCompatible'));
        const order = ["mark('granted')", "mark('gpu')", "mark('card'", "mark('session'", "mark('warmup')"];
        let last = -1;
        for (const m of order) {
            const at = enter.indexOf(m);
            expect(at).toBeGreaterThan(last);
            last = at;
        }
        expect(enter).toMatch(/trace\?\.fail\(stepNow, err\)/);
        expect(enter).toMatch(/this\.trace\?\.finished\(Boolean\(this\.renderer\.xr\.isPresenting\)\)/);
        expect(vr).toMatch(/'sessionend'[\s\S]{0,400}this\.trace\?\.ended\(\)/);
    });

    test('after entry a watchdog checks that her scene really drew', () => {
        const start = engine.indexOf('    _finishXREntry(entered) {');
        const fin = engine.slice(start, engine.indexOf('\n    }\n', start));
        expect(fin).toMatch(/setTimeout\(\(\) => this\._xrWatchdog\(0\), 2500\)/);
    });
});

describe('XL5 — WebXR layers only in a headset’s own browser', () => {
    const vrSrc = fs
        .readFileSync(path.resolve(__dirname, '../src/gltf-viewer/VRSupport.js'), 'utf-8')
        .replace(/^export class VRSupport/m, 'class VRSupport');
    // eslint-disable-next-line no-new-func
    const VRSupport = new Function(`${vrSrc}\nreturn VRSupport;`)();
    const QUEST =
        'Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/33.0 Chrome/126.0';
    const WINDOWS_LINK =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36';

    test('Quest Browser keeps the layer path it has been working on', () => {
        expect(VRSupport.wantsLayers({ userAgent: QUEST, hasQuadLayer: true })).toBe(true);
    });

    test('desktop Chrome driving Link gets the classic XRWebGLLayer, even though it offers layers', () => {
        expect(VRSupport.wantsLayers({ userAgent: WINDOWS_LINK, hasQuadLayer: true })).toBe(false);
    });

    test('?xrLayers forces either way, but never asks a browser that cannot do layers', () => {
        expect(VRSupport.wantsLayers({ userAgent: WINDOWS_LINK, search: '?xrLayers=1', hasQuadLayer: true })).toBe(
            true
        );
        expect(VRSupport.wantsLayers({ userAgent: QUEST, search: '?a=b&xrLayers=off', hasQuadLayer: true })).toBe(
            false
        );
        expect(VRSupport.wantsLayers({ userAgent: QUEST, search: '?xrLayers=1', hasQuadLayer: false })).toBe(false);
    });

    test('toggleVR asks through that rule, and pulses status after the session starts', () => {
        const enter = vrSrc.slice(vrSrc.indexOf('async toggleVR'), vrSrc.indexOf('    async _makeXRCompatible'));
        expect(enter).toMatch(/if \(\s*VRSupport\.wantsLayers\(/);
        expect(enter.indexOf("optionalFeatures.push('layers')")).toBeGreaterThan(enter.indexOf('wantsLayers'));
        expect(enter.indexOf('trace?.pulse()')).toBeGreaterThan(enter.indexOf("mark('session'"));
    });
});

describe('XL5 — a status line while the session runs', () => {
    test('says how many frames each loop drew and what is wrong, warning once', () => {
        const t = traced();
        enterUpTo(t, 'warmup');
        t.trace.frame('card');
        t.c.advance(1000);
        expect(t.trace.pulse()).toBeNull();
        expect(t.logs[t.logs.length - 1]).toMatch(
            /status .*loading card 1 frames, her scene 0 frames, step warmup — ok/
        );

        const s = traced();
        enterUpTo(s, 'warmup');
        s.c.advance(3500);
        expect(s.trace.pulse()).toMatch(/not asking this page for frames/);
        s.trace.pulse();
        expect(s.warns.filter((w) => /not asking this page/.test(w))).toHaveLength(1);
    });
});
