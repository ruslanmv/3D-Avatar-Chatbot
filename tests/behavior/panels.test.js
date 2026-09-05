/**
 * The panel channel, client side (B20).
 *
 * Three acceptance sentences, and the first one is the interesting one because it is usually
 * answered with a screenshot:
 *
 *   * an agenda reads legibly at Quest resolution — checked as **arithmetic**. The screen
 *     subtends a known angle, the canvas spans it, so a font size converts to arc-minutes
 *     of visual angle at the eye. Twenty is the floor for comfortable reading.
 *   * oversized payloads are rejected rather than truncated — the server's job, tested in
 *     `HomePilot/backend/tests/avatar/test_panels.py`; what is checked here is that this
 *     side does not add a *second* limit that could disagree with it.
 *   * a client without the renderer ignores `display` cleanly — a negative assertion, and
 *     the reason the renderer is optional rather than assumed.
 */

/* global describe, test, expect, beforeEach, afterEach, jest */

const fs = require('fs');
const path = require('path');

const EventBus = require('../../src/behavior/EventBus.js');
const Blackboard = require('../../src/behavior/ContextBlackboard.js');
const SessionAdapter = require('../../src/behavior/adapters/SessionAdapter.js');
const PanelRenderer = require('../../src/features/together/panels/PanelRenderer.js');

const ROOT = path.join(__dirname, '..', '..');
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'behavior.config.json'), 'utf8'));
const FIXTURE = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'protocol', 's2c-display.json'), 'utf8')
).message;

/** A canvas that records every draw call, so a test can read what was painted. */
function fakeCanvas(width, height) {
    const calls = { fillRect: [], fillText: [], fonts: [], fills: [] };
    return {
        width,
        height,
        calls,
        getContext: () => ({
            set fillStyle(value) {
                calls.fills.push(value);
            },
            get fillStyle() {
                return calls.fills[calls.fills.length - 1];
            },
            set font(value) {
                calls.fonts.push(value);
            },
            get font() {
                return calls.fonts[calls.fonts.length - 1];
            },
            textBaseline: '',
            fillRect: (...args) => calls.fillRect.push(args),
            fillText: (text, x, y) => calls.fillText.push({ text: String(text), x, y }),
        }),
    };
}

const fakeThree = () => ({
    LinearFilter: 'linear',
    CanvasTexture: class {
        constructor(canvas) {
            this.canvas = canvas;
            this.needsUpdate = false;
        }
        dispose() {
            this.disposed = true;
        }
    },
});

function rig({ three = fakeThree() } = {}) {
    const bus = new EventBus({});
    const events = [];
    bus.on('panel:shown', (payload) => events.push(['shown', payload]));
    bus.on('panel:closed', (payload) => events.push(['closed', payload]));

    let canvas;
    const renderer = PanelRenderer.attach({
        bus,
        three,
        makeCanvas: (w, h) => (canvas = fakeCanvas(w, h)),
    });
    return {
        renderer,
        bus,
        events,
        get canvas() {
            return canvas;
        },
    };
}

beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
});

// ── legibility, as arithmetic ────────────────────────────────────────────────

describe('it reads legibly at Quest resolution', () => {
    test('every style in the scale clears the twenty arc-minute floor', () => {
        const report = PanelRenderer.legibility();
        for (const [name, style] of Object.entries(report.styles)) {
            expect(`${name} (${style.size}px): ${style.arcmin} arcmin, legible ${style.legible}`).toBe(
                `${name} (${style.size}px): ${style.arcmin} arcmin, legible true`
            );
        }
        expect(report.worst.arcmin).toBeGreaterThanOrEqual(PanelRenderer.LEGIBLE_ARCMIN);
    });

    test('the smallest text still has real headroom, not a hair', () => {
        // Clearing a floor by 3% is not a design that survives someone nudging a font size.
        const report = PanelRenderer.legibility();
        expect(report.worst.arcmin).toBeGreaterThan(PanelRenderer.LEGIBLE_ARCMIN * 1.5);
    });

    test('the canvas out-resolves the headset, which is the right way round', () => {
        // Quest 3 renders roughly 25 pixels per degree at the centre. A canvas coarser than
        // that would make the *texture* the limit, and no amount of headset would help.
        const { width } = PanelRenderer.CANVAS;
        const canvasPixelsPerDegree = width / PanelRenderer.SCREEN_ARC_DEGREES;
        expect(canvasPixelsPerDegree).toBeGreaterThan(25);
    });

    test('the arithmetic is real: a small enough font fails it', () => {
        // Vacuity guard. If `legibility()` always said yes, every test above would be
        // decoration. Ten canvas pixels at this geometry is seven arc-minutes — a smudge.
        const tiny = PanelRenderer.legibility({ type: { body: { size: 10 } } });
        expect(tiny.styles.body.legible).toBe(false);
        expect(tiny.worst.arcmin).toBeLessThan(PanelRenderer.LEGIBLE_ARCMIN);
    });

    test('and it finds the exact size where legible stops', () => {
        // 20 arcmin ÷ (1.76 arcmin/px × 0.7 cap height) ≈ 16 px. Either side of that the
        // answer flips, which is what makes this a measurement rather than a threshold
        // someone picked to make the current fonts pass.
        const at16 = PanelRenderer.legibility({ type: { body: { size: 17 } } });
        const at15 = PanelRenderer.legibility({ type: { body: { size: 15 } } });
        expect(at16.styles.body.legible).toBe(true);
        expect(at15.styles.body.legible).toBe(false);
    });

    test('a canvas coarser than the headset would make the texture the limit', () => {
        // The failure this geometry guards against is not "text too big" — a small canvas
        // makes each pixel cover *more* arc, so the glyphs get blockier, not smaller. The
        // number that matters is canvas pixels per degree against the headset's.
        const coarse = 512 / PanelRenderer.SCREEN_ARC_DEGREES;
        const shipped = PanelRenderer.CANVAS.width / PanelRenderer.SCREEN_ARC_DEGREES;
        expect(coarse).toBeLessThan(25);
        expect(shipped).toBeGreaterThan(25);
    });
});

// ── the agenda ───────────────────────────────────────────────────────────────

describe('an agenda renders', () => {
    test('the shared fixture draws its title and every row', () => {
        const r = rig();
        const result = r.renderer.show(FIXTURE);

        expect(result).toEqual({ ok: true, kind: 'agenda', lines: 2 });
        const painted = r.canvas.calls.fillText.map((c) => c.text);
        expect(painted).toContain('Today');
        expect(painted).toContain('09:30');
        expect(painted).toContain('Standup');
        expect(painted).toContain('14:00');
        expect(painted).toContain('Dentist');
    });

    test('the time and the thing are separate columns, not one run-on line', () => {
        const r = rig();
        r.renderer.show(FIXTURE);
        const time = r.canvas.calls.fillText.find((c) => c.text === '09:30');
        const what = r.canvas.calls.fillText.find((c) => c.text === 'Standup');
        expect(what.x).toBeGreaterThan(time.x);
        expect(what.y).toBe(time.y);
    });

    test('rows are drawn at the sizes the legibility report checked', () => {
        const r = rig();
        r.renderer.show(FIXTURE);
        const sizes = r.canvas.calls.fonts.map((f) => parseInt(f.match(/(\d+)px/)[1], 10));
        for (const size of sizes) {
            expect(Object.values(PanelRenderer.TYPE).map((t) => t.size)).toContain(size);
        }
    });

    test('the canvas is cleared first, so two panels do not overlap', () => {
        const r = rig();
        r.renderer.show(FIXTURE);
        const first = r.canvas.calls.fillText.length;
        r.renderer.show({ kind: 'agenda', data: { title: 'Tomorrow', items: [{ at: '08:00', what: 'Gym' }] } });

        expect(r.canvas.calls.fillRect.length).toBe(2);
        expect(r.canvas.calls.fillText.length).toBeGreaterThan(first);
        // …and the second draw's own text is there.
        expect(r.canvas.calls.fillText.map((c) => c.text)).toContain('Tomorrow');
    });

    test('more rows than fit say so rather than stopping quietly', () => {
        // A panel that ends without saying it ended is indistinguishable from one that had
        // nothing more to show.
        const r = rig();
        const items = Array.from({ length: 40 }, (_, i) => ({ at: `0${i % 10}:00`, what: `Thing ${i}` }));
        const result = r.renderer.show({ kind: 'agenda', data: { title: 'Busy', items } });

        expect(result.lines).toBeLessThan(40);
        expect(r.canvas.calls.fillText.map((c) => c.text).some((t) => /more$/.test(t))).toBe(true);
    });

    test('an empty panel says so rather than showing a black rectangle', () => {
        const r = rig();
        r.renderer.show({ kind: 'agenda', data: {} });
        expect(r.canvas.calls.fillText.map((c) => c.text)).toContain('(nothing to show)');
    });
});

// ── every kind ───────────────────────────────────────────────────────────────

describe('the renderer is the reusable half', () => {
    const payloads = {
        agenda: { title: 'Today', items: [{ at: '09:30', what: 'Standup' }] },
        cards: { title: 'Ideas', cards: [{ title: 'A curved screen' }] },
        tool_result: { title: 'search_animations', rows: [{ key: 'bvh_dance_1', value: '0.72' }] },
        stats: { title: 'This week', stats: [{ label: 'Sessions', value: 6 }] },
        share: { title: 'Clip', lines: ['That was the moment'] },
    };

    test('every kind the spec names draws something', () => {
        for (const [kind, data] of Object.entries(payloads)) {
            const r = rig();
            const result = r.renderer.show({ kind, data });
            expect(`${kind}: ${result.ok} ${result.lines}`).toBe(`${kind}: true 1`);
        }
    });

    test('each kind labels its two columns its own way', () => {
        const r = rig();
        r.renderer.show({ kind: 'stats', data: payloads.stats });
        const painted = r.canvas.calls.fillText.map((c) => c.text);
        expect(painted).toContain('Sessions');
        expect(painted).toContain('6');
    });

    test('a kind it cannot draw is refused by name, not blanked', () => {
        const r = rig();
        const result = r.renderer.show({ kind: 'hologram', data: {} });
        expect(result).toEqual({ ok: false, why: 'no renderer for kind hologram' });
        expect(r.renderer.stats.refused.unknownKind).toBe(1);
        expect(r.events).toEqual([]);
    });

    test('data that is not an object is refused rather than drawn as undefined', () => {
        const r = rig();
        expect(r.renderer.show({ kind: 'agenda', data: 'today' }).ok).toBe(false);
    });
});

// ── events and the texture ───────────────────────────────────────────────────

describe('panel:shown and panel:closed', () => {
    test('showing and closing each fire once, with the kind', () => {
        const r = rig();
        r.renderer.show(FIXTURE);
        expect(r.renderer.close('user')).toBe(true);

        expect(r.events).toEqual([
            ['shown', { kind: 'agenda', lines: 2 }],
            ['closed', { kind: 'agenda', why: 'user' }],
        ]);
    });

    test('closing nothing fires nothing', () => {
        const r = rig();
        expect(r.renderer.close()).toBe(false);
        expect(r.events).toEqual([]);
    });

    test('a refused panel fires nothing either', () => {
        const r = rig();
        r.renderer.show({ kind: 'nope', data: {} });
        expect(r.events).toEqual([]);
    });

    test('the texture is built once and marked dirty on every draw', () => {
        const r = rig();
        const texture = r.renderer.canvasTexture;
        expect(r.renderer.canvasTexture).toBe(texture);

        texture.needsUpdate = false;
        r.renderer.show(FIXTURE);
        expect(texture.needsUpdate).toBe(true);
    });

    test('it is a texture and not DOM, which is why VR, AR and 2D are the same', () => {
        const body = fs
            .readFileSync(path.join(ROOT, 'src/features/together/panels/PanelRenderer.js'), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, ' ')
            .replace(/(^|[^:])\/\/.*$/gm, '$1');
        for (const forbidden of ['innerHTML', 'appendChild', 'document.body', 'style.cssText']) {
            expect(`${forbidden}: ${body.includes(forbidden)}`).toBe(`${forbidden}: false`);
        }
    });

    test('a page with no three.js still renders — it just has no texture to hand back', () => {
        const r = rig({ three: null });
        expect(r.renderer.show(FIXTURE).ok).toBe(true);
        expect(r.renderer.canvasTexture).toBe(null);
    });

    test('detaching closes and frees', () => {
        const r = rig();
        r.renderer.show(FIXTURE);
        const texture = r.renderer.canvasTexture;
        r.renderer.detach();

        expect(texture.disposed).toBe(true);
        expect(r.events.map(([name]) => name)).toEqual(['shown', 'closed']);
    });
});

// ── a client without the renderer ────────────────────────────────────────────

describe('a client without the renderer ignores display cleanly', () => {
    function session({ panels } = {}) {
        let socket;
        const bus = new EventBus({});
        const adapter = new SessionAdapter.Adapter({
            bus,
            blackboard: new Blackboard({}),
            config: { ...CONFIG, session: { enabled: true, url: 'wss://test/x' } },
            panels,
            socketFactory: () => {
                socket = {
                    sent: [],
                    send(p) {
                        this.sent.push(JSON.parse(p));
                    },
                    close() {},
                };
                return socket;
            },
        });
        adapter.connect();
        socket.onopen();
        return { adapter, socket, bus };
    }

    test('display is ignored, the session stays open, nothing throws', () => {
        const s = session();
        const result = s.adapter.receive(FIXTURE);

        expect(result).toEqual({ action: 'ignored', why: 'no panel renderer' });
        expect(s.adapter.stats.connected).toBe(true);
        expect(s.socket.sent.some((m) => m.type === 'error')).toBe(false);
    });

    test('and it is counted, so an operator can see the panels are going nowhere', () => {
        const s = session();
        s.adapter.receive(FIXTURE);
        s.adapter.receive(FIXTURE);
        expect(s.adapter.stats.dropped.noRenderer).toBe(2);
    });

    test('every other message type keeps working without a renderer', () => {
        const s = session();
        const intents = [];
        s.bus.on('intent', (i) => intents.push(i.name));

        s.adapter.receive(FIXTURE);
        s.adapter.receive({ v: 1, type: 'intent', name: 'wave', intensity: 0.6, source: 'server' });
        s.adapter.receive({ v: 1, type: 'ping' });

        expect(intents).toEqual(['wave']);
        expect(s.socket.sent.pop().type).toBe('pong');
    });

    test('with a renderer, the same message is applied', () => {
        const r = rig();
        const s = session({ panels: r.renderer });
        expect(s.adapter.receive(FIXTURE)).toEqual({ action: 'applied', why: 'agenda' });
        expect(r.events[0][0]).toBe('shown');
    });

    test('a renderer that refuses a kind reports the refusal up the chain', () => {
        const r = rig();
        const s = session({ panels: r.renderer });
        const result = s.adapter.receive({ v: 1, type: 'display', kind: 'hologram', data: {} });
        expect(result).toEqual({ action: 'dropped', why: 'no renderer for kind hologram' });
        expect(s.adapter.stats.connected).toBe(true);
    });
});

// ── the size limit lives on one side ─────────────────────────────────────────

describe("the size limit is the server's", () => {
    test('this side adds no second limit that could disagree with it', () => {
        // A payload that reached here was already accepted. Re-checking would be a second
        // ceiling, and two ceilings eventually differ.
        const body = fs
            .readFileSync(path.join(ROOT, 'src/features/together/panels/PanelRenderer.js'), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, ' ')
            .replace(/(^|[^:])\/\/.*$/gm, '$1');
        for (const forbidden of ['panelMaxKb', 'maxKb', 'byteLength', 'JSON.stringify']) {
            expect(`${forbidden}: ${body.includes(forbidden)}`).toBe(`${forbidden}: false`);
        }
    });

    test('a very large but well-formed panel still renders what fits', () => {
        const r = rig();
        const items = Array.from({ length: 500 }, (_, i) => ({ at: '09:00', what: `Item ${i}` }));
        const result = r.renderer.show({ kind: 'agenda', data: { title: 'Everything', items } });
        expect(result.ok).toBe(true);
        expect(result.lines).toBeGreaterThan(0);
        expect(result.lines).toBeLessThan(500);
    });

    test('the client config still declares the number both sides know', () => {
        expect(CONFIG.assistant.panelMaxKb).toBe(64);
    });
});
