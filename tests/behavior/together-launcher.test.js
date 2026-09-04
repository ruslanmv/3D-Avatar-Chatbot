/**
 * The Together launcher (B30).
 *
 * The feature is one button, so most of these tests are about what it does *not* do. Three
 * claims carry the batch:
 *
 *   * it is additive — with the flag off the DOM is unchanged, and `detach()` restores it
 *     byte for byte, because every node it adds it injected rather than marked up;
 *   * opening the chooser starts nothing. No camera, no microphone, no capture, no mode
 *     change. A menu is not consent to what is on it;
 *   * closing the chooser and leaving an activity are different intentions, and conflating
 *     them is how somebody loses a focus block by tapping outside a panel.
 */

/* global describe, test, expect, beforeEach, afterEach */

const fs = require('fs');
const path = require('path');

const TogetherPanel = require('../../src/features/together/ui/TogetherPanel.js');
const TogetherLauncher = require('../../src/features/together/ui/TogetherLauncher.js');

const ROOT = path.join(__dirname, '..', '..');
const LAUNCHER_SOURCE = path.join(ROOT, 'src/features/together/ui/TogetherLauncher.js');
const codeOf = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** The footer as `index.html` actually ships it, plus the drawer group the entry joins. */
const MARKUP = `
<div class="avatar-card">
  <div class="avatar-footer-actions">
    <button id="reset-view-btn" class="emotion-trigger" type="button"><span>🎯</span></button>
    <button id="openPoseStudioBtn" class="emotion-trigger" type="button"><span>🎭</span></button>
    <button id="avatar-picker-btn" class="emotion-trigger" type="button"><span>👤</span></button>
    <div class="avatar-footer-right"><select id="avatar-select"></select></div>
  </div>
</div>
<nav>
  <div class="drawer-nav-group"><span class="drawer-nav-label">NAVIGATION</span>
    <button class="drawer-nav-item" id="drawer-settings-btn" type="button"><span>Settings</span></button>
  </div>
  <div class="drawer-nav-group"><span class="drawer-nav-label">EXPERIENCE</span>
    <button class="drawer-nav-item" id="drawer-vr-btn" type="button"><span>VR / AR Mode</span></button>
    <button class="drawer-nav-item" id="drawer-companion-btn" type="button"><span>Companion</span></button>
  </div>
</nav>`;

/** A consent machine that records what it was asked for and never opens anything. */
function fakeConsent() {
    const asked = [];
    let handler = () => {};
    return {
        asked,
        /** B36 counts these: a leaked grant is a revoke that never happened. */
        revoked: 0,
        grant: true,
        async request(source) {
            asked.push(source);
            if (!this.grant) {
                handler({ state: 'idle', reason: 'declined' });
                return null;
            }
            handler({ state: 'active', label: `Sharing ${source}` });
            return { source, live: true };
        },
        revoke(why) {
            this.revoked += 1;
            handler({ state: 'idle', reason: why });
            return true;
        },
        onChange(fn) {
            handler = fn;
            return () => {};
        },
    };
}

/**
 * A stand-in with the *real* activity's surface (B36).
 *
 * The generic `{start(arg), stop(why)}` this used to build was the shape the panel assumed
 * and the activities never had — which is precisely the bug B36 exists to fix. A stub that
 * keeps the wrong shape would let the old assumption pass forever, so each one now mirrors
 * what its file actually exposes: Watch has `playFile`/`shareTab` and no `start`, Journey has
 * `enter`/`exit`, Music needs a source, CoHost needs a moment detector.
 *
 * `consent` is passed to the ones that request for themselves, so the double-owner tests can
 * count real requests rather than a mock's intentions.
 */
function activity(id, label, { consent = null } = {}) {
    const base = {
        id,
        label,
        started: [],
        stopped: [],
        requests: [],
        async start(arg) {
            this.started.push(arg === undefined ? null : arg);
            return { ok: true };
        },
        stop(why) {
            this.stopped.push(why);
            return true;
        },
    };

    const asksForItself = async (source) => {
        base.requests.push(source);
        if (!consent) return { live: true };
        return consent.request(source);
    };

    if (id === 'watch') {
        // No `start`. This is the whole of the Watch bug.
        delete base.start;
        base.sourceLabel = 'YouTube tab';
        base.playFile = async function playFile(url) { this.started.push({ file: url }); return { ok: true }; };
        base.shareTab = async function shareTab() {
            const grant = await asksForItself('screen');
            if (!grant) return { ok: false, why: 'declined' };
            this.started.push({ tab: true });
            return { ok: true };
        };
    }
    if (id === 'journey') {
        delete base.start;
        delete base.stop;
        base.current = 'ocean';
        base.scenes = new Map([
            ['ocean', { id: 'ocean', title: 'Ocean', icon: '🌊' }],
            ['forest', { id: 'forest', title: 'Forest', icon: '🌲' }],
        ]);
        base.enter = function enter(sceneId) { this.started.push(sceneId); return true; };
        base.exit = function exit(why) { this.stopped.push(why); return true; };
    }
    if (id === 'music') {
        base.trackName = '';
        base.attachSource = function attachSource(url, { name = '' } = {}) {
            this.trackName = name; this.started.push({ audio: url }); return { ok: true };
        };
        base.detachSource = function detachSource() { this.trackName = ''; return true; };
    }
    if (id === 'cohost') base.momentSource = {};
    if (id === 'coach') {
        base.exercises = ['squat', 'push-up'];
        base.reps = 0;
        base.start = async function start(exercise) {
            const grant = await asksForItself('camera');
            if (!grant) return { ok: false, why: 'camera consent was declined' };
            this.exercise = exercise;
            this.started.push(exercise);
            return { ok: true };
        };
    }
    if (id === 'copilot') {
        base.steps = [];
        base.start = async function start(steps) {
            const grant = await asksForItself('camera');
            if (!grant) return { ok: false, why: 'camera consent was declined' };
            this.steps = steps || [];
            this.started.push(steps);
            return { ok: true };
        };
    }
    if (id === 'meeting') {
        base.start = async function start(options) {
            const grant = await asksForItself('meeting');
            if (!grant) return { ok: false, why: 'declined' };
            this.started.push(options);
            return { ok: true };
        };
    }
    return base;
}

function harness({ ids = ['watch', 'journey', 'music', 'cohost', 'focus', 'coach', 'copilot'], fresh = true } = {}) {
    // `fresh: false` keeps a page the caller has already staged — the ordering tests need
    // Companion's buttons in the toolbar before the launcher attaches.
    if (fresh) document.body.innerHTML = MARKUP;
    const consent = fakeConsent();
    const capture = { fromGrant: () => ({ stop() {}, stats: {} }) };
    const panel = TogetherPanel.attach({ consent, capture, config: {}, doc: document });
    const activities = {};
    for (const id of ids) {
        activities[id] = activity(id, `${id} together`, { consent });
        panel.register(activities[id]);
    }
    const launcher = TogetherLauncher.attach({ panel, doc: document, viewer: null });
    return { panel, launcher, consent, activities };
}

/** Click handlers kick off async starts; let them settle before asserting. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const button = () => document.getElementById(TogetherLauncher.BUTTON_ID);
const overlay = () => document.getElementById(TogetherPanel.PANEL_ID);
const tiles = () => [...document.querySelectorAll('.nexus-bd-together-tile')];
const options = () => [...document.querySelectorAll('.nexus-bd-together-option')];
/** B36: the first screen shows four; the rest are behind "More together". */
const moreButton = () => document.querySelector('.nexus-bd-together-more');
const revealAll = () => { const more = moreButton(); if (more) more.click(); };
const tileNamed = (name) => {
    let found = tiles().find((t) => t.textContent.includes(name));
    if (!found && moreButton()) {
        revealAll();
        found = tiles().find((t) => t.textContent.includes(name));
    }
    return found;
};
// B36: an option may carry a note under its label ("Your screen stops sharing when you
// leave Watch"), so match the label rather than the whole button.
const optionNamed = (name) => options().find((o) => o.textContent.startsWith(name));

afterEach(() => {
    document.body.innerHTML = '';
    const style = document.getElementById(TogetherLauncher.STYLE_ID);
    if (style) style.remove();
});

// ── additive ─────────────────────────────────────────────────────────────────

describe('it adds one control and moves nothing', () => {
    test('every pre-existing button keeps its id and its order', () => {
        document.body.innerHTML = MARKUP;
        const before = [...document.querySelectorAll('.avatar-footer-actions > *')].map((n) => n.id || n.className);
        harness();
        const after = [...document.querySelectorAll('.avatar-footer-actions > *')].map((n) => n.id || n.className);
        expect(after.filter((x) => x !== TogetherLauncher.BUTTON_ID)).toEqual(before);
    });

    test('with Companion absent it goes before the select group, where Companion puts its own', () => {
        harness();
        const kids = [...document.querySelector('.avatar-footer-actions').children];
        expect(kids[kids.length - 1].className).toBe('avatar-footer-right');
        expect(kids[kids.length - 2].id).toBe(TogetherLauncher.BUTTON_ID);
    });

    describe('the row reads 🎯 🎭 👤 👥 🪟 📞 whichever feature injects first', () => {
        /** Companion's own two buttons, inserted the way `CompanionMode.showButton()` does. */
        function injectCompanion() {
            const toolbar = document.querySelector('.avatar-footer-actions');
            const right = toolbar.querySelector('.avatar-footer-right');
            for (const id of ['companion-mode-btn', 'companion-call-btn']) {
                const b = document.createElement('button');
                b.id = id;
                b.type = 'button';
                toolbar.insertBefore(b, right);
            }
        }

        const ids = () =>
            [...document.querySelector('.avatar-footer-actions').children].map((n) => n.id || n.className);

        const EXPECTED = [
            'reset-view-btn',
            'openPoseStudioBtn',
            'avatar-picker-btn',
            TogetherLauncher.BUTTON_ID,
            'companion-mode-btn',
            'companion-call-btn',
            'avatar-footer-right',
        ];

        test('Companion first — we anchor on its window button', () => {
            document.body.innerHTML = MARKUP;
            injectCompanion();
            harness({ fresh: false });
            expect(ids()).toEqual(EXPECTED);
        });

        test('us first — Companion inserts before the select group, which is already after us', () => {
            harness();
            injectCompanion();
            expect(ids()).toEqual(EXPECTED);
        });
    });

    test('the mark is the drawn two-person glyph, not an emoji and not a borrowed mask', () => {
        harness();
        const svg = button().querySelector('svg.nexus-bd-together-mark');
        // Two heads and two shoulder arcs — the shape every icon set spells "group".
        expect(svg.querySelectorAll('circle')).toHaveLength(2);
        expect(svg.querySelectorAll('path')).toHaveLength(2);
        // Drawn, so it inherits the button's colour and follows it into the running state.
        expect(svg.getAttribute('stroke')).toBe('currentColor');
        // A real SVG element, not an HTML tag that merely spells svg and renders nothing.
        expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
        // The name lives on the button; the picture must not repeat it to a screen reader.
        expect(svg.getAttribute('aria-hidden')).toBe('true');
        // No character in the button at all — not Pose Studio's mask, not the old ✦, and
        // not 👥, whose rendering is a different picture on every platform.
        expect(button().textContent.trim()).toBe('');
    });

    test('the drawer entry is appended, so every existing item keeps its position', () => {
        document.body.innerHTML = MARKUP;
        const before = [...document.querySelectorAll('.drawer-nav-item')].map((n) => n.id);
        harness();
        const after = [...document.querySelectorAll('.drawer-nav-item')].map((n) => n.id);
        expect(after.slice(0, before.length)).toEqual(before);
        expect(after[after.length - 1]).toBe(TogetherLauncher.DRAWER_ID);
    });

    test('it joins EXPERIENCE, not the first group it finds', () => {
        harness();
        const group = document.getElementById(TogetherLauncher.DRAWER_ID).parentNode;
        expect(group.querySelector('.drawer-nav-label').textContent).toBe('EXPERIENCE');
    });

    test('detach leaves the DOM exactly as it was', () => {
        document.body.innerHTML = MARKUP;
        const before = document.body.innerHTML;
        const h = harness();
        expect(document.body.innerHTML).not.toBe(before);
        h.panel.detach();
        h.launcher.detach();
        expect(document.body.innerHTML).toBe(before);
        expect(document.getElementById(TogetherLauncher.STYLE_ID)).toBeNull();
    });

    test('no stylesheet of its own outside its namespace', () => {
        harness();
        const css = document.getElementById(TogetherLauncher.STYLE_ID).textContent;
        // Every rule that styles an element — at-rule headers are not selectors, and neither
        // is a comment. Stripped first: a comment containing a comma used to split into a
        // fragment the check then read as an un-namespaced selector, which made this test a
        // rule about prose rather than about CSS.
        const selectors = css
            .replace(/\/\*[\s\S]*?\*\//g, ' ')
            .split('}')
            .map((block) => block.slice(block.lastIndexOf('{', block.length) === -1 ? 0 : 0))
            .flatMap((block) => block.split('{')[0].split(','))
            .map((sel) => sel.trim())
            .filter((sel) => sel && !sel.startsWith('@'));
        for (const sel of selectors) {
            expect(`${sel} :: ${/nexus-bd-together/.test(sel)}`).toBe(`${sel} :: true`);
        }
    });

    test('a page without the toolbar is survivable, not a crash', () => {
        document.body.innerHTML = '<div></div>';
        const panel = TogetherPanel.attach({ consent: fakeConsent(), capture: {}, doc: document });
        expect(() => TogetherLauncher.attach({ panel, doc: document, viewer: null })).not.toThrow();
        expect(button()).toBeNull();
    });
});

// ── opening starts nothing ───────────────────────────────────────────────────

describe('opening the chooser starts nothing at all', () => {
    test('no permission is requested', () => {
        const h = harness();
        button().click();
        expect(h.consent.asked).toEqual([]);
    });

    test('no activity is started', () => {
        const h = harness();
        button().click();
        for (const a of Object.values(h.activities)) expect(a.started).toEqual([]);
    });

    test('the launcher itself cannot capture, animate or ask for anything', () => {
        // Every one of these belongs to something that already exists. A launcher that grew
        // one would be a second orchestration layer wearing a button.
        const source = codeOf(fs.readFileSync(LAUNCHER_SOURCE, 'utf8'));
        for (const token of [
            'getUserMedia',
            'getDisplayMedia',
            'MediaRecorder',
            'fetch(',
            'consent',
            'blackboard',
            'escalation',
            'mixer',
            'scheduler',
            'MediaPipe',
            'CompanionMode',
        ]) {
            expect(`${token}: ${source.includes(token)}`).toBe(`${token}: false`);
        }
        expect(source).toContain('class Launcher');
    });

    test('the first screen offers four experiences, ordered by user value', () => {
        // B36. Seven equal boxes was becoming a product catalogue. These four are what
        // somebody opens the launcher to do; the rest are one press away, and the order is
        // by value rather than by the batch number that happened to build each one.
        harness();
        button().click();
        const names = tiles().map((t) => t.querySelector('.nexus-bd-together-name').textContent);
        expect(names).toEqual(['Focus', 'Watch', 'Help me with this', 'Coach']);
    });

    test('More together reveals the rest without hiding the four', () => {
        harness();
        button().click();
        moreButton().click();
        const names = tiles().map((t) => t.querySelector('.nexus-bd-together-name').textContent);
        expect(names.slice(0, 4)).toEqual(['Focus', 'Watch', 'Help me with this', 'Coach']);
        expect(names).toEqual(expect.arrayContaining(['Journey', 'Music', 'Play']));
    });

    test('no tile names an implementation concept, on either screen', () => {
        harness();
        button().click();
        revealAll();
        const names = tiles().map((t) => t.querySelector('.nexus-bd-together-name').textContent).join(' ');
        for (const internal of ['Screen Insight', 'Copilot', 'Capture', 'Co-host', 'Pipeline', 'Behavior Director']) {
            expect(names).not.toContain(internal);
        }
    });

    test('an activity the contract does not know stays out of the chooser', () => {
        // `screen-insight` is a capability behind Watch and Help, not something a person
        // sets out to do — and B36 asks the contract rather than a table, so an activity
        // with no adapter cannot appear even if somebody registers it.
        const h = harness();
        h.panel.register(activity('screen-insight', 'Screen Insight'));
        button().click();
        revealAll();
        expect(tiles().map((t) => t.textContent).join(' ')).not.toContain('Screen Insight');
        expect(tiles()).toHaveLength(7);
    });

    test('a tile that cannot complete its journey is not offered at all', () => {
        // Music with no audio source and Play with no moment detector start something that
        // cannot work. Hiding them is the honest answer; a tile that fails after the user
        // has chosen is worse than one that was never there.
        document.body.innerHTML = MARKUP;
        const consent = fakeConsent();
        const panel = TogetherPanel.attach({ consent, capture: { fromGrant: () => ({ stop() {}, stats: {} }) }, config: {}, doc: document });
        panel.register({ id: 'music', start() {}, stop() {} });
        panel.register({ id: 'cohost', start() {}, stop() {} });
        panel.register(activity('focus', 'focus', { consent }));
        TogetherLauncher.attach({ panel, doc: document, viewer: null });
        button().click();
        revealAll();
        const names = tiles().map((t) => t.querySelector('.nexus-bd-together-name').textContent);
        expect(names).toEqual(['Focus']);
    });

    test('there is no generic Share Screen button on the first view', () => {
        harness();
        button().click();
        expect(overlay().textContent).not.toContain('Share screen');
        expect(overlay().textContent).toContain('What should we do?');
    });
});

// ── permission is activity-scoped ────────────────────────────────────────────

describe('permission comes after the choice, never before', () => {
    test('Journey never asks for anything', async () => {
        const h = harness();
        button().click();
        tileNamed('Journey').click();
        expect(overlay().textContent).toContain('Where should we go?');
        optionNamed('🌊 Ocean').click();
        await flush();
        expect(h.consent.asked).toEqual([]);
        expect(h.activities.journey.started).toEqual(['ocean']);
    });

    test('Focus never asks for anything, and needs no setup screen at all', async () => {
        // B36. One input with nothing to pick and nothing to type is not a question, so the
        // tile starts it. A setup screen showing a single button labelled "Start" is a step
        // that exists only to be got past.
        const h = harness();
        button().click();
        tileNamed('Focus').click();
        await flush();
        expect(h.consent.asked).toEqual([]);
        expect(h.activities.focus.started).toHaveLength(1);
        expect(h.panel.activeActivity).toBe('focus');
    });

    test('Watch asks for the screen exactly once when a tab is chosen', async () => {
        // The B36 bug in one assertion. `watch.shareTab()` requests the screen itself, and
        // the panel used to request first — `ConsentMachine.request()` revokes a live grant
        // before asking again, so the user was prompted twice and the first grant died.
        const h = harness();
        button().click();
        tileNamed('Watch').click();
        expect(h.consent.asked).toEqual([]);
        optionNamed('Share a tab').click();
        await flush();
        expect(h.consent.asked).toEqual(['screen']);
        expect(h.activities.watch.requests).toEqual(['screen']);
    });

    test('and asks for nothing when a local file is chosen', async () => {
        const h = harness();
        button().click();
        tileNamed('Watch').click();
        optionNamed('Open a video file').click();
        await flush();
        expect(h.consent.asked).toEqual([]);
    });

    test('Coach asks for the camera exactly once, and says so before it does', async () => {
        const h = harness();
        button().click();
        tileNamed('Coach').click();
        const squat = optionNamed('Squat');
        expect(squat.title).toMatch(/access/);
        squat.click();
        await flush();
        // Coach reaches consent through ScreenInsight. One owner, one prompt.
        expect(h.consent.asked).toEqual(['camera']);
        expect(h.activities.coach.started).toEqual(['squat']);
    });

    test('Coach offers the exercises Coach actually supports', () => {
        // The tile used to hardcode `arg: 'squat'`. B27 has real validation and refuses an
        // unsupported exercise by name; the setup screen now reads its list.
        harness();
        button().click();
        tileNamed('Coach').click();
        expect(options().map((o) => o.firstChild.textContent)).toEqual(['Squat', 'Push-up']);
    });

    test('declining leaves nothing running, and says so instead of going quiet', async () => {
        const h = harness();
        h.consent.grant = false;
        button().click();
        tileNamed('Play').click();
        optionNamed('Share game').click();
        await flush();
        expect(h.activities.cohost.started).toEqual([]);
        expect(h.panel.activeActivity).toBeNull();
        // B36. The old panel dropped the reason and showed the menu again: a tile tapped, a
        // dialog answered, and then nothing said.
        expect(overlay().textContent).toContain('needs permission');
        expect(options().map((o) => o.textContent)).toEqual(['Try again', 'Back']);
    });

    test('a failed start never leaves the camera on', async () => {
        // The P0. The panel opened the camera, Copilot refused for want of steps, and the
        // panel returned to the chooser with the grant still live — the consent badge told
        // the truth and the product did not.
        document.body.innerHTML = MARKUP;
        const consent = fakeConsent();
        const panel = TogetherPanel.attach({
            consent, capture: { fromGrant: () => ({ stop() {}, stats: {} }) }, config: {}, doc: document,
        });
        const cohost = activity('cohost', 'cohost', { consent });
        cohost.start = async () => ({ ok: false, why: 'no play profile — refusing to start' });
        panel.register(cohost);
        TogetherLauncher.attach({ panel, doc: document, viewer: null });

        button().click();
        tileNamed('Play').click();
        optionNamed('Share game').click();
        await flush();

        expect(panel.activeActivity).toBeNull();
        expect(consent.asked).toEqual(['screen']);
        // Opened by this call, so revoked by this call.
        expect(consent.revoked).toBeGreaterThan(0);
        expect(panel.pipeline).toBeNull();
        // And the activity's own words survive to the screen.
        expect(overlay().textContent).toContain('No play profile');
    });

    test('the panel still asks through the machine — it never sees a stream', () => {
        // B11's rule, unchanged: `share()` is the only door and this batch did not add one.
        const source = codeOf(fs.readFileSync(path.join(ROOT, 'src/features/together/ui/TogetherPanel.js'), 'utf8'));
        expect(source).toContain('this.consent.request(source)');
        expect(source).not.toContain('getDisplayMedia');
        expect(source).not.toContain('getUserMedia');
    });
});

// ── closing is not stopping ──────────────────────────────────────────────────

describe('dismissing the menu and leaving the activity are different', () => {
    async function running() {
        const h = harness();
        button().click();
        tileNamed('Focus').click();
        await flush();
        return h;
    }

    test('starting an activity gets the menu out of the way', async () => {
        const h = await running();
        expect(h.panel.isOpen).toBe(false);
        expect(h.panel.activeActivity).toBe('focus');
    });

    test('closing the chooser leaves the activity running', async () => {
        const h = await running();
        h.launcher.open();
        h.launcher.close();
        expect(h.panel.activeActivity).toBe('focus');
        expect(h.activities.focus.stopped).toEqual([]);
    });

    test('Stop activity stops it', async () => {
        const h = await running();
        button().click();
        optionNamed('Stop').click();
        expect(h.activities.focus.stopped).toEqual(['user']);
        expect(h.panel.activeActivity).toBeNull();
    });

    test('and hands the sharing back too', async () => {
        const h = harness();
        button().click();
        tileNamed('Watch').click();
        optionNamed('Share a tab').click();
        await flush();
        button().click();
        optionNamed('Stop').click();
        expect(h.panel.stats.sharing).toBe(false);
    });

    test('Change activity returns to the chooser with nothing running', async () => {
        const h = await running();
        button().click();
        optionNamed('Change').click();
        expect(h.activities.focus.stopped).toEqual(['changed']);
        expect(overlay().textContent).toContain('What should we do?');
    });

    test('reopening while an activity runs shows what is running, not the menu', async () => {
        const h = await running();
        h.launcher.close();
        button().click();
        expect(overlay().textContent).toContain('● FOCUS');
        expect(overlay().textContent).toContain('Stop');
        expect(h.panel.stats.view).toBe('running');
    });

    test('Back from a setup view returns to the chooser without starting anything', () => {
        const h = harness();
        button().click();
        tileNamed('Coach').click();
        document.querySelector('.nexus-bd-together-cancel').click();
        expect(overlay().textContent).toContain('What should we do?');
        expect(h.consent.asked).toEqual([]);
    });
});

// ── the three button states ──────────────────────────────────────────────────

describe('the button says one of three things', () => {
    test('idle, open, then running', async () => {
        const h = harness();
        expect(button().dataset.state).toBe('idle');
        expect(button().getAttribute('aria-label')).toBe('Together — watch, listen, focus or move with her');

        button().click();
        expect(button().dataset.state).toBe('open');
        expect(button().getAttribute('aria-expanded')).toBe('true');

        tileNamed('Focus').click();
        await flush();
        expect(button().dataset.state).toBe('running');
        expect(h.panel.activeActivity).toBe('focus');
    });

    test('running says so in the name, because the icon cannot', async () => {
        // B34 took the word out of the button. `data-state` drives a colour and a dot, and
        // neither reaches a screen reader — so the accessible name is now the only place
        // "something is already running" is stated, and it has to carry which one.
        const h = harness();
        button().click();
        tileNamed('Focus').click();
        await flush();
        expect(button().getAttribute('aria-label')).toBe('Together — Focus running');
        // The tooltip a sighted user gets says the same thing, rather than going stale.
        expect(button().title).toBe(button().getAttribute('aria-label'));
        expect(h.panel.activeActivity).toBe('focus');
    });

    test('and it goes back to the plain name when the activity stops', async () => {
        const h = harness();
        button().click();
        tileNamed('Focus').click();
        await flush();
        await h.panel.stopActivity();
        expect(button().dataset.state).not.toBe('running');
        expect(button().getAttribute('aria-label')).toBe('Together — watch, listen, focus or move with her');
    });

    test('it is not a feature toggle — the running button reopens the panel', async () => {
        const h = harness();
        button().click();
        tileNamed('Focus').click();
        await flush();
        expect(h.activities.focus.started).toHaveLength(1);
        h.launcher.close();
        button().click();
        expect(h.panel.isOpen).toBe(true);
        expect(h.activities.focus.stopped).toEqual([]);
    });

    test('Focus starts straight away, because it asks nothing at all', async () => {
        // B36 replaced B30's `direct` flag with a rule: an activity whose single input has
        // no permission, no picker and nothing to type has no question to ask. Music used to
        // be the direct one and now has a source to choose, which is what made it work.
        const h = harness();
        button().click();
        tileNamed('Focus').click();
        await flush();
        expect(h.panel.activeActivity).toBe('focus');
    });

    test('Music asks what to listen to instead of starting deaf', async () => {
        // B14 shipped a tile that set `running = true` against an analyser nothing supplied.
        const h = harness();
        button().click();
        tileNamed('Music').click();
        await flush();
        expect(h.panel.activeActivity).toBeNull();
        expect(overlay().textContent).toContain('What are we listening to?');
    });
});

// ── VR ───────────────────────────────────────────────────────────────────────

describe('in a headset the chooser is drawn, not laid out', () => {
    test('an immersive session routes to the panel renderer instead of the DOM', () => {
        document.body.innerHTML = MARKUP;
        const shown = [];
        const panel = TogetherPanel.attach({ consent: fakeConsent(), capture: {}, doc: document });
        for (const id of ['watch', 'focus']) panel.register(activity(id, id));
        const launcher = TogetherLauncher.attach({
            panel,
            doc: document,
            viewer: { xrSupport: { isPresenting: true } },
            panels: { show: (m) => shown.push(m) },
        });

        const result = launcher.open();
        expect(result).toEqual({ ok: true, surface: 'xr', spoken: true });
        expect(shown[0].kind).toBe('cards');
        expect(shown[0].data.cards.map((c) => c.value)).toEqual(['Watch', 'Focus']);
        // The DOM overlay stays shut: it would be invisible in an immersive session anyway.
        expect(panel.isOpen).toBe(false);
    });

    test('a headset with no renderer says so rather than opening an invisible panel', () => {
        document.body.innerHTML = MARKUP;
        const panel = TogetherPanel.attach({ consent: fakeConsent(), capture: {}, doc: document });
        const launcher = TogetherLauncher.attach({
            panel,
            doc: document,
            viewer: { xrSupport: { isPresenting: true } },
            panels: null,
        });
        expect(launcher.open()).toEqual({ ok: false, surface: 'xr', why: 'no panel renderer' });
    });

    test('out of the headset it is the DOM again', () => {
        const h = harness();
        expect(h.launcher.open()).toEqual({ ok: true, surface: '2d' });
        expect(h.launcher.stats.surface).toBe('2d');
    });
});

// ── mobile ───────────────────────────────────────────────────────────────────

describe('mobile is the same panel, by media query', () => {
    test('one implementation, not two', () => {
        const css = TogetherLauncher.CSS;
        expect(css).toContain('@media (max-width: 640px)');
        // The sheet re-lays out the *same* element — a base rule and one override, with
        // no second panel id anywhere. Two implementations would need two ids.
        // One panel id, styled twice — a base rule and one override. Two implementations
        // would need two ids.
        expect(css).not.toMatch(/nexus-bd-together-panel-(mobile|sheet|desktop)/);
        expect(css.match(/#nexus-bd-together-panel\s*\{/g)).toHaveLength(2);
        expect(codeOf(fs.readFileSync(LAUNCHER_SOURCE, 'utf8'))).not.toContain('isMobile');
    });

    test('it respects a reduced-motion preference', () => {
        expect(TogetherLauncher.CSS).toContain('prefers-reduced-motion');
    });

    test('the pill is reachable and labelled for a screen reader', () => {
        harness();
        expect(button().getAttribute('aria-label')).toBeTruthy();
        // B36: `dialog`, matching what it actually opens. See the a11y block above.
        expect(button().getAttribute('aria-haspopup')).toBe('dialog');
        expect(TogetherLauncher.CSS).toContain(':focus-visible');
    });
});

// ── keyboard and focus ───────────────────────────────────────────────────────

describe('it behaves like a menu for somebody not using a mouse', () => {
    const press = (key, opts = {}) =>
        document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...opts }));
    const pointerOn = (node) => node.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));

    test('opening moves focus into the chooser', () => {
        const h = harness();
        h.launcher.open();
        expect(document.activeElement).toBe(tiles()[0]);
    });

    test('Escape closes it', () => {
        const h = harness();
        h.launcher.open();
        press('Escape');
        expect(h.panel.isOpen).toBe(false);
    });

    test('and puts focus back on the button, not at the top of the document', () => {
        const h = harness();
        h.launcher.open();
        press('Escape');
        expect(document.activeElement).toBe(button());
    });

    test('Escape never stops a running activity', async () => {
        const h = harness();
        button().click();
        tileNamed('Focus').click();
        await flush();
        h.launcher.open();
        press('Escape');
        expect(h.panel.activeActivity).toBe('focus');
        expect(h.activities.focus.stopped).toEqual([]);
    });

    test('a click outside dismisses it', () => {
        const h = harness();
        h.launcher.open();
        pointerOn(document.querySelector('#reset-view-btn'));
        expect(h.panel.isOpen).toBe(false);
    });

    test('a click inside does not', () => {
        const h = harness();
        h.launcher.open();
        pointerOn(tiles()[0]);
        expect(h.panel.isOpen).toBe(true);
    });

    test('and the button keeps toggling rather than double-firing', () => {
        const h = harness();
        button().click();
        expect(h.panel.isOpen).toBe(true);
        pointerOn(button());
        expect(h.panel.isOpen).toBe(true);
        button().click();
        expect(h.panel.isOpen).toBe(false);
    });

    test('Tab wraps at the end, so focus cannot escape the open menu', () => {
        const h = harness();
        h.launcher.open();
        const focusable = [...overlay().querySelectorAll('button')];
        focusable[focusable.length - 1].focus();
        press('Tab');
        expect(document.activeElement).toBe(focusable[0]);
    });

    test('and Shift+Tab wraps at the start', () => {
        const h = harness();
        h.launcher.open();
        const focusable = [...overlay().querySelectorAll('button')];
        focusable[0].focus();
        press('Tab', { shiftKey: true });
        expect(document.activeElement).toBe(focusable[focusable.length - 1]);
    });

    test('the overlay is announced as the modal dialog it behaves like', () => {
        // B36. B34 gave this focus containment, Escape-to-close and focus movement into the
        // panel — modal-dialog keyboard behaviour — while leaving `aria-modal` off, so
        // assistive tech was told one thing and shown another. One model, not two.
        //
        // Modality is about the *menu*. Closing it still does not stop the activity, which
        // the test below this one asserts.
        const h = harness();
        h.launcher.open();
        expect(overlay().getAttribute('role')).toBe('dialog');
        expect(overlay().getAttribute('aria-label')).toBe('Together');
        expect(overlay().getAttribute('aria-modal')).toBe('true');
    });

    test('the button names the kind of thing it opens', () => {
        // `aria-haspopup="menu"` on a control that opens a `role="dialog"` names a pattern
        // the panel is not. The APG expects the popup type to be what actually opens.
        harness();
        expect(button().getAttribute('aria-haspopup')).toBe('dialog');
        expect(button().getAttribute('aria-controls')).toBe(TogetherPanel.PANEL_ID);
    });

    test('the button is easy to hit on a phone', () => {
        // 38px visual, 44px target. Apple asks for 44pt, Android for 48dp; the icon stays
        // the size it was and the hit area grows around it.
        harness();
        const target = Number.parseInt(button().style.minWidth || '0', 10);
        expect(target).toBeGreaterThanOrEqual(44);
        expect(Number.parseInt(button().style.minHeight || '0', 10)).toBeGreaterThanOrEqual(44);
    });

    test('document listeners exist only while it is open', () => {
        // A menu that keeps a keydown handler on the document forever is a menu that
        // eventually swallows somebody else's Escape.
        const h = harness();
        expect(h.launcher.stats.listening).toBe(false);
        h.launcher.open();
        expect(h.launcher.stats.listening).toBe(true);
        h.launcher.close();
        expect(h.launcher.stats.listening).toBe(false);
    });

    test('and detach takes them with it', () => {
        const h = harness();
        h.launcher.open();
        h.launcher.detach();
        expect(h.launcher.stats.listening).toBe(false);
        expect(() => press('Escape')).not.toThrow();
    });
});
