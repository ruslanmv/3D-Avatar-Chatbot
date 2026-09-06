/**
 * Together, opened from the phone drawer (mobile fix).
 *
 * Reported as *"I click and I cannot interact, it disappears"*, and it was three defects
 * stacked in one gesture:
 *
 *   1. **the drawer entry never closed the drawer.** Every other entry in that menu calls
 *      `closeDrawer()` first; this one only opened the panel. The drawer is
 *      `position: fixed; z-index: 1000` and the panel mounts inside `.avatar-card` at
 *      `z-index: 40`, so the panel opened a thousand layers underneath it;
 *   2. **the mobile sheet was never fixed.** The media query sets `left/right/bottom: 0` but
 *      the base rule is `position: absolute`, so those resolved against `.avatar-card` — a
 *      sheet pinned to a narrow card off to one side rather than to the phone. That is the
 *      clipped strip of tiles in the report;
 *   3. **the drawer's own scrim was inert.** Its CSS puts `opacity` and `pointer-events`
 *      behind `.open`, and only `hidden` was toggled — so the layer was there, transparent
 *      and click-through. A tap beside the drawer reached the page, and the panel's own
 *      dismiss-on-outside-click read that as "close".
 *
 * Each has a test, because each on its own is enough to reproduce the report.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TogetherLauncher = require('../src/features/together/ui/TogetherLauncher.js');

/** The drawer markup this feature injects itself into. */
const DRAWER = `
<div class="mobile-drawer-overlay" id="mobile-drawer-overlay"></div>
<aside class="mobile-drawer open" id="mobile-drawer">
  <button class="icon-btn" id="mobile-drawer-close" type="button" aria-label="Close menu"></button>
  <nav class="mobile-drawer-content">
    <div class="drawer-nav-group">
      <span class="drawer-nav-label">EXPERIENCE</span>
      <button class="drawer-nav-item" id="drawer-vr-btn" type="button"><span>VR / AR Mode</span></button>
    </div>
  </nav>
</aside>
<div class="avatar-card"><div class="avatar-footer-actions"></div></div>`;

function fakePanel() {
    return {
        isOpen: false,
        root: null,
        activities: new Map(),
        activeActivity: null,
        onChange: () => () => {},
        mount(host) {
            this.root = document.createElement('div');
            this.root.id = 'nexus-bd-together-panel';
            host.appendChild(this.root);
            return this.root;
        },
        open() {
            this.isOpen = true;
            return true;
        },
        close() {
            this.isOpen = false;
            return true;
        },
    };
}

beforeEach(() => {
    document.body.innerHTML = DRAWER;
});

describe('the drawer entry', () => {
    test('closes the drawer before opening the panel', () => {
        const panel = fakePanel();
        TogetherLauncher.attach({ panel, doc: document, viewer: null });
        const item = document.getElementById(TogetherLauncher.DRAWER_ID);
        expect(item).not.toBeNull();

        item.click();

        // The panel opened *and* the drawer went away. Either alone is the bug.
        expect(panel.isOpen).toBe(true);
        expect(document.getElementById('mobile-drawer').classList.contains('open')).toBe(false);
    });

    test("closes it through the app's own close button, so one thing owns the drawer", () => {
        const panel = fakePanel();
        const closed = jest.fn();
        document.getElementById('mobile-drawer-close').addEventListener('click', closed);
        TogetherLauncher.attach({ panel, doc: document, viewer: null });

        document.getElementById(TogetherLauncher.DRAWER_ID).click();
        expect(closed).toHaveBeenCalled();
    });

    test('falls back to the classes on a page wired differently', () => {
        // A page with the drawer markup but not the handler — and tests.
        document.getElementById('mobile-drawer-close').remove();
        const panel = fakePanel();
        TogetherLauncher.attach({ panel, doc: document, viewer: null });

        document.getElementById(TogetherLauncher.DRAWER_ID).click();
        expect(document.getElementById('mobile-drawer').classList.contains('open')).toBe(false);
        expect(document.getElementById('mobile-drawer-overlay').classList.contains('hidden')).toBe(true);
    });

    test('a page with no drawer at all is untouched', () => {
        document.body.innerHTML = '<div class="avatar-card"><div class="avatar-footer-actions"></div></div>';
        const panel = fakePanel();
        expect(() => TogetherLauncher.attach({ panel, doc: document, viewer: null })).not.toThrow();
        expect(document.getElementById(TogetherLauncher.DRAWER_ID)).toBeNull();
    });
});

describe('the mobile sheet', () => {
    /** The phone half of the launcher's stylesheet. */
    const mobile = () => {
        const css = TogetherLauncher.CSS;
        const at = css.indexOf('@media (max-width: 640px)');
        expect(at).toBeGreaterThan(-1);
        return css.slice(at, css.indexOf('@media (prefers-reduced-motion', at));
    };

    test('is positioned against the phone, not against the avatar card', () => {
        // Without this the sheet inherits `position: absolute` from the base rule and its
        // `bottom: 0` is the bottom of a narrow card somewhere in the page.
        expect(mobile()).toMatch(/#nexus-bd-together-panel\s*\{[^}]*position:\s*fixed/);
    });

    test('sits above the drawer rather than a thousand layers below it', () => {
        const z = /#nexus-bd-together-panel\s*\{[^}]*z-index:\s*(\d+)/.exec(mobile());
        expect(z).not.toBeNull();
        // `.mobile-drawer` is z-index 1000 in styles/main.css. A panel that cannot be raised
        // above it is a panel a stuck drawer can bury.
        expect(Number(z[1])).toBeGreaterThan(1000);
    });
});

describe('the drawer scrim', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

    test('is given the class its own CSS makes it clickable with', () => {
        // `.mobile-drawer-overlay` is transparent and `pointer-events: none` until `.open`.
        // Toggling only `hidden` left an invisible, click-through layer: taps beside the
        // drawer reached the page, and whatever was open there took them as "dismiss me".
        const open = /function openDrawer\(\)\s*\{[\s\S]*?\n\s*\}/.exec(html);
        expect(open).not.toBeNull();
        expect(open[0]).toMatch(/overlay\?\.classList\.add\('open'\)/);

        const close = /function closeDrawer\(\)\s*\{[\s\S]*?\n\s*\}/.exec(html);
        expect(close[0]).toMatch(/overlay\?\.classList\.remove\('open'\)/);
    });

    test('the stylesheet still gates it that way, so the fix keeps matching the CSS', () => {
        const css = fs.readFileSync(path.join(ROOT, 'styles/main.css'), 'utf8');
        expect(css).toMatch(/\.mobile-drawer-overlay\.open\s*\{[^}]*pointer-events:\s*auto/);
    });
});
