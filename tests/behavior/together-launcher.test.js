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
            handler({ state: 'idle', reason: why });
            return true;
        },
        onChange(fn) {
            handler = fn;
            return () => {};
        },
    };
}

function activity(id, label) {
    return {
        id,
        label,
        started: [],
        stopped: [],
        async start(arg) {
            this.started.push(arg === undefined ? null : arg);
            return { ok: true };
        },
        stop(why) {
            this.stopped.push(why);
            return true;
        },
    };
}

function harness({ ids = ['watch', 'journey', 'music', 'cohost', 'focus', 'coach', 'copilot'] } = {}) {
    document.body.innerHTML = MARKUP;
    const consent = fakeConsent();
    const capture = { fromGrant: () => ({ stop() {}, stats: {} }) };
    const panel = TogetherPanel.attach({ consent, capture, config: {}, doc: document });
    const activities = {};
    for (const id of ids) {
        activities[id] = activity(id, `${id} together`);
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
const tileNamed = (name) => tiles().find((t) => t.textContent.includes(name));
const optionNamed = (name) => options().find((o) => o.textContent === name);

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

    test('the pill sits before the select group, where Companion puts its own', () => {
        harness();
        const kids = [...document.querySelector('.avatar-footer-actions').children];
        expect(kids[kids.length - 1].className).toBe('avatar-footer-right');
        expect(kids[kids.length - 2].id).toBe(TogetherLauncher.BUTTON_ID);
    });

    test('it does not reuse the mask Pose Studio already owns', () => {
        harness();
        expect(button().textContent).toContain('✦');
        expect(button().textContent).not.toContain('🎭');
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
        // Every rule that styles an element — at-rule headers are not selectors.
        const selectors = css
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

    test('the chooser offers seven experiences and names no architecture', () => {
        harness();
        button().click();
        const names = tiles().map((t) => t.querySelector('.nexus-bd-together-name').textContent);
        expect(names).toEqual(['Watch', 'Journey', 'Music', 'Play', 'Focus', 'Coach', 'Help me with this']);
        for (const internal of ['Screen Insight', 'Copilot', 'Capture', 'Co-host', 'Pipeline']) {
            expect(names.join(' ')).not.toContain(internal);
        }
    });

    test('an activity the table does not know stays out of the chooser', () => {
        // `screen-insight` is a capability behind Watch and Help, not something a person
        // sets out to do.
        const h = harness();
        h.panel.register(activity('screen-insight', 'Screen Insight'));
        button().click();
        expect(tiles().map((t) => t.textContent)).not.toContain(expect.stringContaining('Screen Insight'));
        expect(tiles()).toHaveLength(7);
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

    test('Focus never asks for anything either', async () => {
        const h = harness();
        button().click();
        tileNamed('Focus').click();
        optionNamed('Start').click();
        await flush();
        expect(h.consent.asked).toEqual([]);
        expect(h.activities.focus.started).toHaveLength(1);
    });

    test('Watch asks for the screen only when a tab is chosen', async () => {
        const h = harness();
        button().click();
        tileNamed('Watch').click();
        expect(h.consent.asked).toEqual([]);
        optionNamed('Share a tab').click();
        await flush();
        expect(h.consent.asked).toEqual(['screen']);
    });

    test('and not when a local file is chosen', async () => {
        const h = harness();
        button().click();
        tileNamed('Watch').click();
        optionNamed('Open local video').click();
        await flush();
        expect(h.consent.asked).toEqual([]);
        expect(h.activities.watch.started).toEqual(['file']);
    });

    test('Coach asks for the camera, and says so before it does', async () => {
        const h = harness();
        button().click();
        tileNamed('Coach').click();
        expect(optionNamed('Use camera').title).toMatch(/camera/);
        optionNamed('Use camera').click();
        await flush();
        expect(h.consent.asked).toEqual(['camera']);
    });

    test('declining leaves nothing running and every other channel alone', async () => {
        const h = harness();
        h.consent.grant = false;
        button().click();
        tileNamed('Play').click();
        optionNamed('Share game').click();
        await flush();
        expect(h.activities.cohost.started).toEqual([]);
        expect(h.panel.activeActivity).toBeNull();
        expect(overlay().textContent).toContain('What should we do?');
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
        optionNamed('Start').click();
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
        optionNamed('Stop activity').click();
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
        optionNamed('Stop activity').click();
        expect(h.panel.stats.sharing).toBe(false);
    });

    test('Change activity returns to the chooser with nothing running', async () => {
        const h = await running();
        button().click();
        optionNamed('Change activity').click();
        expect(h.activities.focus.stopped).toEqual(['changed']);
        expect(overlay().textContent).toContain('What should we do?');
    });

    test('reopening while an activity runs shows what is running, not the menu', async () => {
        const h = await running();
        h.launcher.close();
        button().click();
        expect(overlay().textContent).toContain('● FOCUS');
        expect(overlay().textContent).toContain('Stop activity');
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
        expect(button().textContent).toContain('Together');

        button().click();
        expect(button().dataset.state).toBe('open');
        expect(button().getAttribute('aria-expanded')).toBe('true');

        tileNamed('Focus').click();
        optionNamed('Start').click();
        await flush();
        expect(button().dataset.state).toBe('running');
        expect(button().textContent).toContain('FOCUS');
        expect(h.panel.activeActivity).toBe('focus');
    });

    test('it is not a feature toggle — the running button reopens the panel', async () => {
        const h = harness();
        button().click();
        tileNamed('Music').click();
        await flush();
        expect(h.activities.music.started).toHaveLength(1);
        h.launcher.close();
        button().click();
        expect(h.panel.isOpen).toBe(true);
        expect(h.activities.music.stopped).toEqual([]);
    });

    test('Music starts straight away, because it needs no setup', async () => {
        const h = harness();
        button().click();
        tileNamed('Music').click();
        await flush();
        expect(h.panel.activeActivity).toBe('music');
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
        expect(button().getAttribute('aria-haspopup')).toBe('menu');
        expect(TogetherLauncher.CSS).toContain(':focus-visible');
    });
});
