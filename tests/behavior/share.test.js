/**
 * Clip button and "she remembered" cards (B25) — the two distribution loops.
 *
 * Three acceptance sentences:
 *
 *   * saving never uploads — checked as the absence of any way to, over the whole of
 *     `src/features/clips/`, plus the positive: a save is an object URL, an anchor and a
 *     revoke, and the test watches all three;
 *   * the "clip that?" toast appears at most once a minute and never blocks — driven over
 *     ten simulated minutes of macro events;
 *   * both loops tear down in the adult tier — and *tear down* means the recorder is
 *     stopped and its buffer dropped, not that a button is hidden.
 */

/* global describe, test, expect, beforeEach, afterEach, jest */

const fs = require('fs');
const path = require('path');

const EventBus = require('../../src/behavior/EventBus.js');
const Blackboard = require('../../src/behavior/ContextBlackboard.js');
const ClipRecorder = require('../../src/features/clips/ClipRecorder.js');
const ShareCard = require('../../src/features/clips/ShareCard.js');
const ClipButton = require('../../src/features/clips/ui/ClipButton.js');

const ROOT = path.join(__dirname, '..', '..');
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'behavior.config.json'), 'utf8'));
const BUTTON_SOURCE = path.join(ROOT, 'src', 'features', 'clips', 'ui', 'ClipButton.js');
const CARD_SOURCE = path.join(ROOT, 'src', 'features', 'clips', 'ShareCard.js');

const codeOf = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** A record shaped like a real B16 curiosity callback. */
const RECORD = {
    topic: 'user.hobby.aquarium',
    quote: 'Did the new shrimp settle in okay? You said they were hiding behind the driftwood.',
    at: Date.UTC(2026, 8, 1, 19, 42),
};

/** A 2D context that records everything painted, so a test can read the card. */
function fakeCanvas(width, height) {
    const calls = { fillText: [], fillRect: [], drawImage: [], fonts: [] };
    return {
        width,
        height,
        calls,
        toDataURL: () => 'data:image/png;base64,AAAA',
        getContext: () => ({
            fillText: (...a) => calls.fillText.push(a),
            fillRect: (...a) => calls.fillRect.push(a),
            drawImage: (...a) => calls.drawImage.push(a),
            measureText: (text) => ({ width: String(text).length * 26 }),
            set font(v) {
                calls.fonts.push(v);
            },
            set fillStyle(v) {},
            set textBaseline(v) {},
        }),
    };
}

// ── the share card ───────────────────────────────────────────────────────────

describe('a card renders a record, never an invention', () => {
    function cards() {
        let made = null;
        const renderer = ShareCard.attach({
            makeCanvas: (w, h) => (made = fakeCanvas(w, h)),
            locale: 'en-GB',
        });
        return { renderer, canvas: () => made };
    }

    test('a real callback renders', () => {
        const c = cards();
        const result = c.renderer.render(RECORD);
        expect(result.lines.length).toBeGreaterThan(0);
        expect(c.canvas().calls.fillText.length).toBeGreaterThanOrEqual(3);
    });

    test('her quote is on it, in quotation marks', () => {
        const c = cards();
        c.renderer.render(RECORD);
        const painted = c
            .canvas()
            .calls.fillText.map((a) => a[0])
            .join(' ');
        expect(painted).toContain('shrimp');
        expect(painted).toContain('“');
    });

    test('the topic and the timestamp are on it', () => {
        const c = cards();
        c.renderer.render(RECORD);
        const painted = c.canvas().calls.fillText.map((a) => a[0]);
        expect(painted).toContain('user.hobby.aquarium');
        expect(painted.some((line) => /2026/.test(line))).toBe(true);
    });

    test('a card with no quote is refused', () => {
        // A generated "she remembered" would be a fabrication of the user's own
        // relationship with the thing, printed and shareable.
        expect(() => cards().renderer.render({ topic: 'x', at: 1 })).toThrow(/card_invalid/);
    });

    test('and so is one with no topic or no moment', () => {
        expect(() => cards().renderer.render({ quote: 'hi', at: 1 })).toThrow(/card_invalid/);
        expect(() => cards().renderer.render({ quote: 'hi', topic: 't' })).toThrow(/card_invalid/);
    });

    test('a refusal names every problem, not just the first', () => {
        const problems = ShareCard.validate({});
        expect(problems.length).toBeGreaterThan(1);
    });

    test('a paragraph is not a card', () => {
        const long = { ...RECORD, quote: 'x'.repeat(ShareCard.MAX_QUOTE + 1) };
        expect(() => cards().renderer.render(long)).toThrow(/characters/);
    });

    test('a long quote wraps and is ellipsised rather than overflowing', () => {
        const context = fakeCanvas(1080, 1350).getContext();
        const lines = ShareCard.wrap(context, 'word '.repeat(200), 900);
        expect(lines).toHaveLength(ShareCard.MAX_LINES);
        expect(lines[lines.length - 1]).toMatch(/…$/);
    });

    test('the portrait is drawn as handed over', () => {
        const c = cards();
        const result = c.renderer.render(RECORD, { width: 800, height: 600 });
        expect(result.portrait).toBe(true);
        expect(c.canvas().calls.drawImage).toHaveLength(1);
    });

    test('a missing portrait is a design case, not an error', () => {
        const c = cards();
        expect(c.renderer.render(RECORD, null).portrait).toBe(false);
        expect(c.renderer.render(RECORD, { width: 0, height: 0 }).portrait).toBe(false);
        expect(c.renderer.stats.rendered).toBe(2);
    });

    test('a portrait that will not draw costs the card nothing', () => {
        const renderer = ShareCard.attach({
            makeCanvas: (w, h) => {
                const canvas = fakeCanvas(w, h);
                const context = canvas.getContext();
                canvas.getContext = () => ({
                    ...context,
                    drawImage: () => {
                        throw new Error('tainted');
                    },
                });
                return canvas;
            },
        });
        const original = console.warn;
        console.warn = () => {};
        try {
            expect(renderer.render(RECORD, { width: 10, height: 10 }).portrait).toBe(false);
        } finally {
            console.warn = original;
        }
    });

    test('the PNG is a data URL, never a request', () => {
        const c = cards();
        c.renderer.render(RECORD);
        expect(c.renderer.toDataURL()).toMatch(/^data:image\/png/);
        expect(codeOf(fs.readFileSync(CARD_SOURCE, 'utf8'))).not.toContain('fetch(');
    });

    test('an unknown locale falls back rather than throwing', () => {
        const renderer = ShareCard.attach({ makeCanvas: fakeCanvas, locale: 'not-a-locale' });
        expect(() => renderer.render(RECORD)).not.toThrow();
    });
});

// ── the button ───────────────────────────────────────────────────────────────

function button({ adult = false, buffered = 5, recording = true } = {}) {
    const bus = new EventBus();
    const blackboard = new Blackboard();
    blackboard.adultVerified = adult;
    blackboard.nsfwAllowed = adult;

    const clicks = [];
    const revoked = [];
    const created = [];
    const originalCreate = global.URL.createObjectURL;
    const originalRevoke = global.URL.revokeObjectURL;
    global.URL.createObjectURL = (blob) => {
        created.push(blob);
        return `blob:fake/${created.length}`;
    };
    global.URL.revokeObjectURL = (href) => revoked.push(href);

    const recorder = {
        recording,
        stopped: [],
        saves: 0,
        save() {
            this.saves++;
            return buffered
                ? { blob: { size: buffered * 1000 }, source: 'canvas', durationMs: buffered * 1000, at: 1000 }
                : null;
        },
        stop(why) {
            this.stopped.push(why);
            this.recording = false;
        },
    };

    let cardCanvas = null;
    const cards = ShareCard.attach({ makeCanvas: (w, h) => (cardCanvas = fakeCanvas(w, h)) });

    let clock = 100000;
    const btn = ClipButton.attach({
        bus,
        blackboard,
        config: CONFIG,
        recorder,
        cards,
        now: () => clock,
    });

    // Watch the anchor the save path builds.
    const originalClick = global.HTMLAnchorElement.prototype.click;
    global.HTMLAnchorElement.prototype.click = function click() {
        clicks.push({ href: this.href, download: this.download });
    };

    return {
        bus,
        blackboard,
        recorder,
        cards,
        btn,
        clicks,
        created,
        revoked,
        cardCanvas: () => cardCanvas,
        tick: (ms) => (clock += ms),
        at: () => clock,
        restore() {
            global.URL.createObjectURL = originalCreate;
            global.URL.revokeObjectURL = originalRevoke;
            global.HTMLAnchorElement.prototype.click = originalClick;
            btn.detach();
            document.querySelectorAll(`#${ClipButton.DOM_ID}`).forEach((n) => n.remove());
        },
    };
}

describe('one tap saves locally', () => {
    let b;
    afterEach(() => b && b.restore());

    test('it makes an object URL, clicks a download anchor, and revokes', () => {
        jest.useFakeTimers();
        b = button();
        const result = b.btn.save();
        expect(result.ok).toBe(true);
        expect(b.created).toHaveLength(1);
        expect(b.clicks).toHaveLength(1);
        expect(b.clicks[0].download).toMatch(/^clip-.*\.webm$/);
        jest.runAllTimers();
        expect(b.revoked).toEqual(['blob:fake/1']);
        jest.useRealTimers();
    });

    test('a live object URL is not left pinning the clip in memory', () => {
        jest.useFakeTimers();
        b = button();
        b.btn.save();
        jest.runAllTimers();
        expect(b.revoked).toHaveLength(b.created.length);
        jest.useRealTimers();
    });

    test('the anchor is removed again — the page is not littered', () => {
        b = button();
        b.btn.save();
        expect(document.querySelectorAll('a[download]')).toHaveLength(0);
    });

    test('nothing buffered is a refusal with a reason, not a broken file', () => {
        b = button({ buffered: 0 });
        expect(b.btn.save()).toEqual({ ok: false, why: 'there is nothing buffered yet' });
        expect(b.clicks).toEqual([]);
    });

    test('the clip length comes from the recorder, not from the button', () => {
        b = button({ buffered: 30 });
        expect(b.btn.save().durationMs).toBe(30000);
        expect(b.recorder.saves).toBe(1);
    });

    test('saving asks for the configured buffer length', () => {
        b = button();
        expect(CONFIG.clips.bufferSec).toBe(30);
        expect(b.btn.bufferSec).toBe(30);
    });
});

describe('saving never uploads', () => {
    test('the whole clips directory names nothing that could send bytes', () => {
        // The same check `scripts/audit-privacy.mjs` runs, kept here too: an audit that
        // only runs in CI is one a developer discovers after pushing.
        const files = [];
        (function walk(dir) {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) walk(full);
                else if (entry.name.endsWith('.js')) files.push(full);
            }
        })(path.join(ROOT, 'src', 'features', 'clips'));

        expect(files.length).toBeGreaterThanOrEqual(3);
        for (const file of files) {
            const source = codeOf(fs.readFileSync(file, 'utf8'));
            for (const token of [
                'fetch(',
                'XMLHttpRequest',
                'WebSocket',
                'sendBeacon',
                'EventSource',
                'import(',
                'axios',
                'https://',
                'http://',
            ]) {
                expect(`${path.basename(file)}:${token}:${source.includes(token)}`).toBe(
                    `${path.basename(file)}:${token}:false`
                );
            }
        }
    });

    test('and there is no share sheet either — the clip goes to disk', () => {
        const source = codeOf(fs.readFileSync(BUTTON_SOURCE, 'utf8'));
        expect(source).not.toContain('navigator.share');
        expect(source).toContain('createObjectURL');
    });
});

describe('the "clip that?" toast', () => {
    let b;
    afterEach(() => b && b.restore());

    test('a macro event offers a clip', () => {
        b = button();
        b.bus.emit('game:moment', { kind: 'win', tier: 'macro', macroEvent: true });
        expect(b.btn.stats.suggested).toBe(1);
        expect(document.getElementById(ClipButton.DOM_ID)).toBeTruthy();
    });

    test('a surge does not — a toast every time the screen flashes is an advert', () => {
        b = button();
        b.bus.emit('game:moment', { kind: 'surge', tier: 'macro', macroEvent: false });
        b.bus.emit('game:moment', { kind: 'hit', tier: 'micro', macroEvent: false });
        expect(b.btn.stats.suggested).toBe(0);
    });

    test('at most once a minute, over ten minutes of wins', () => {
        b = button();
        const seen = [];
        b.bus.on('clip:suggested', (event) => seen.push(event.at));
        // A win every two seconds for ten minutes.
        for (let i = 0; i < 300; i++) {
            b.bus.emit('game:moment', { kind: 'win', tier: 'macro', macroEvent: true });
            b.tick(2000);
        }
        expect(seen.length).toBeGreaterThan(1);
        for (let i = 1; i < seen.length; i++) {
            expect(seen[i] - seen[i - 1]).toBeGreaterThanOrEqual(ClipButton.SUGGEST_GAP_MS);
        }
        expect(seen.length).toBeLessThanOrEqual(11);
    });

    test('a suppressed suggestion is counted, not silently dropped', () => {
        b = button();
        b.btn.suggest('win');
        b.btn.suggest('win');
        expect(b.btn.stats.suppressed).toBe(1);
    });

    test('it never blocks — no modal, no await, no dialog', () => {
        const source = codeOf(fs.readFileSync(BUTTON_SOURCE, 'utf8'));
        for (const token of ['await ', 'window.confirm', 'window.alert', 'showModal', 'aria-modal']) {
            expect(source).not.toContain(token);
        }
        expect(source).toContain('class Button');
    });

    test('it announces itself politely rather than interrupting', () => {
        b = button();
        b.btn.suggest('win');
        expect(document.getElementById(ClipButton.DOM_ID).getAttribute('role')).toBe('status');
    });

    test('tapping it saves', () => {
        b = button();
        b.btn.suggest('win');
        document.getElementById(ClipButton.DOM_ID).click();
        expect(b.clicks).toHaveLength(1);
    });

    test('and the toast goes away when it does', () => {
        b = button();
        b.btn.suggest('win');
        b.btn.save();
        expect(document.getElementById(ClipButton.DOM_ID)).toBeNull();
    });

    test('it goes away by itself too', () => {
        jest.useFakeTimers();
        b = button();
        b.btn.suggest('win');
        jest.advanceTimersByTime(ClipButton.TOAST_MS + 1);
        expect(document.getElementById(ClipButton.DOM_ID)).toBeNull();
        jest.useRealTimers();
    });

    test('nothing is offered when nothing is recording', () => {
        b = button({ recording: false });
        expect(b.btn.suggest('win')).toBeNull();
    });

    test('the nudge can be turned off in config without touching the button', () => {
        b = button();
        b.btn.suggestOnMacro = false;
        expect(b.btn.onMoment({ kind: 'win', macroEvent: true })).toBeNull();
    });
});

// ── the adult tier ───────────────────────────────────────────────────────────

describe('both loops tear down in the adult tier', () => {
    let b;
    afterEach(() => b && b.restore());

    test('a verified NSFW session stops the recorder at attach time', () => {
        // Not "the button is hidden": hiding it would leave thirty seconds of the session
        // buffered, which is the single worst artefact this product could hold.
        b = button({ adult: true });
        expect(b.recorder.stopped).toEqual(['adult tier']);
        expect(b.recorder.recording).toBe(false);
        expect(b.btn.stats.tornDown).toBe(true);
    });

    test('saving is refused afterwards', () => {
        b = button({ adult: true });
        expect(b.btn.save()).toEqual({ ok: false, why: 'clips are off in this session' });
        expect(b.clicks).toEqual([]);
    });

    test('cards are refused afterwards', () => {
        b = button({ adult: true });
        expect(b.btn.card(RECORD)).toEqual({ ok: false, why: 'cards are off in this session' });
    });

    test('and no toast can appear', () => {
        b = button({ adult: true });
        b.bus.emit('game:moment', { kind: 'win', macroEvent: true });
        expect(document.getElementById(ClipButton.DOM_ID)).toBeNull();
        expect(b.btn.stats.suggested).toBe(0);
    });

    test('it tears down mid-session when the tier becomes active', () => {
        b = button();
        expect(b.btn.available).toBe(true);
        b.blackboard.adultVerified = true;
        b.blackboard.nsfwAllowed = true;
        b.bus.emit('mode:changed', {});
        expect(b.recorder.recording).toBe(false);
        expect(b.btn.available).toBe(false);
    });

    test('teardown is idempotent', () => {
        b = button({ adult: true });
        b.btn.teardown('again');
        expect(b.recorder.stopped).toEqual(['adult tier']);
    });

    test('either signal alone is a setting, not a state', () => {
        // A user who ticked a box in settings and never went near the adult tier keeps
        // their clips. Both conditions are what makes the tier *active*.
        expect(ClipButton.adultActive({ adultVerified: true, nsfwAllowed: false })).toBe(false);
        expect(ClipButton.adultActive({ adultVerified: false, nsfwAllowed: true })).toBe(false);
        expect(ClipButton.adultActive({ adultVerified: true, nsfwAllowed: true })).toBe(true);
        expect(ClipButton.adultActive(null)).toBe(false);
    });
});

// ── the second loop, end to end ──────────────────────────────────────────────

describe('a card from a real curiosity callback', () => {
    let b;
    afterEach(() => b && b.restore());

    test('it renders and returns a PNG data URL', () => {
        b = button();
        const result = b.btn.card(RECORD);
        expect(result.ok).toBe(true);
        expect(result.url).toMatch(/^data:image\/png/);
        expect(b.btn.stats.cards).toBe(1);
    });

    test('an invented one is refused with the reason', () => {
        b = button();
        const result = b.btn.card({ topic: 'user.hobby.aquarium', at: Date.now() });
        expect(result.ok).toBe(false);
        expect(result.why).toMatch(/the line she actually said/);
    });

    test('the record shape is the one B16 stores', () => {
        // `topic` is an LTM key and `quote` is the callback she spoke; a card that read
        // `summary` instead would print the machine's note rather than her line.
        expect(ShareCard.validate(RECORD)).toEqual([]);
        expect(ShareCard.validate({ ...RECORD, quote: '' })).toHaveLength(1);
    });
});
