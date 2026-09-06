/**
 * The Together sheet stops underneath the chat composer.
 *
 * Measured in a 412x915 phone viewport before the fix: the sheet's bottom edge sat at 915 and
 * the composer's top edge at 839, so **76 pixels of the sheet were under a bar that takes the
 * tap**. In Music that is "Open an audio file" and "Back"; in Watch it is the whole confirm row.
 * The sheet was not scrolling either — its content fitted in the space it had been given — so
 * nothing about it looked wrong. The buttons were simply dead.
 *
 * The fix is layout, not z-index, and this file holds it to that. Raising the sheet over the
 * composer would have hidden the chat bar instead of the button: the same collision, wearing the
 * other hat.
 *
 * Two halves are tested here:
 *
 *   * `composerInset.js` measures how much of the bottom the composer owns and publishes it as
 *     `--nexus-composer-inset`. It is measured rather than written down because the composer is
 *     not one height: collapsed it is a bar, expanded it is most of the screen, and with the
 *     keyboard up the visual viewport shrinks under it. A constant would be right in one of
 *     those states.
 *   * the launcher's mobile stylesheet spends that number — on `bottom` *and* on `max-height`,
 *     because reserving the space at only one end moves the overlap rather than removing it.
 */

const fs = require('fs');
const path = require('path');

const inset = require('../src/features/together/ui/composerInset.js');
const TogetherLauncher = require('../src/features/together/ui/TogetherLauncher.js');

const CSS = TogetherLauncher.CSS;
const MOBILE = CSS.slice(CSS.indexOf('@media (max-width: 640px)'));
const PANEL_RULE = MOBILE.slice(MOBILE.indexOf('#nexus-bd-together-panel'), MOBILE.indexOf('.nexus-bd-together-grid'));

/** A document with a composer whose top edge is `top` in a viewport `height` tall. */
function screen({ height = 915, width = 412, composerTop = 839, visual = null } = {}) {
    const doc = {
        documentElement: {
            style: {
                _values: {},
                setProperty(name, value) {
                    this._values[name] = value;
                },
                removeProperty(name) {
                    delete this._values[name];
                },
                getPropertyValue(name) {
                    return this._values[name] || '';
                },
            },
        },
        querySelector(selector) {
            if (selector !== '.chat-input-shell') return null;
            return {
                getBoundingClientRect: () => ({
                    top: composerTop,
                    bottom: height,
                    height: height - composerTop,
                    left: 0,
                    right: width,
                }),
            };
        },
    };
    const win = { innerHeight: height, innerWidth: width };
    if (visual) win.visualViewport = visual;
    return { doc, win };
}

describe('measuring what the composer already owns', () => {
    test('it reserves everything from the composer down, not just the bar', () => {
        // 915 - 839. Measuring from the top edge rather than adding the bar's height folds in
        // the safe-area padding the composer already carries, and anything sitting below it, so
        // nothing has to guess at env(safe-area-inset-bottom) or count it twice.
        const { doc, win } = screen();
        expect(inset.measure(doc, win)).toBe(76);
    });

    test("it reserves what is on screen, not the composer's whole box", () => {
        // A bar can extend past the fold — iOS draws it through the home-indicator area, and a
        // partially scrolled container does the same. Reserving its full height then takes room
        // for pixels nobody can see, and the sheet shrinks for no reason.
        const { doc, win } = screen();
        doc.querySelector = (selector) =>
            selector !== '.chat-input-shell'
                ? null
                : {
                      getBoundingClientRect: () => ({ top: 839, bottom: 940, height: 101, left: 0, right: 412 }),
                  };
        expect(inset.measure(doc, win)).toBe(76);
    });

    test('it follows the visual viewport, which is what the keyboard shrinks', () => {
        // `innerHeight` does not change when an Android keyboard opens. `visualViewport.height`
        // does, and a sheet sized from the wrong one is back underneath the composer.
        const { doc, win } = screen({ visual: { height: 500, offsetTop: 0 } });
        expect(inset.viewportHeight(win)).toBe(500);
        expect(inset.measure(doc, win)).toBeLessThan(76 + 500);
    });

    test('something that is not at the bottom is not in the way', () => {
        const { doc, win } = screen({ composerTop: 100 });
        doc.querySelector = () => ({
            getBoundingClientRect: () => ({ top: 100, bottom: 200, height: 100, left: 0, right: 412 }),
        });
        expect(inset.measure(doc, win)).toBe(0);
    });

    test('a reservation is never allowed to swallow the whole screen', () => {
        // Better a cramped sheet than one with no height at all — an invisible panel is a worse
        // failure than a short one, and this is the shape a mis-measure would take.
        const { doc, win } = screen({ composerTop: 10 });
        expect(inset.measure(doc, win)).toBeLessThanOrEqual(Math.round(915 * 0.75));
    });

    test('no composer measures zero rather than throwing', () => {
        const { doc, win } = screen();
        doc.querySelector = () => null;
        expect(inset.measure(doc, win)).toBe(0);
    });

    test('a selector the document rejects is not an error', () => {
        const { doc, win } = screen();
        doc.querySelector = () => {
            throw new Error('bad selector');
        };
        expect(() => inset.measure(doc, win)).not.toThrow();
        expect(inset.measure(doc, win)).toBe(0);
    });
});

describe('publishing it', () => {
    test('the property carries the measurement', () => {
        const { doc, win } = screen();
        inset.apply(doc, win);
        expect(doc.documentElement.style.getPropertyValue('--nexus-composer-inset')).toBe('76px');
    });

    test('measured-and-there-is-none is written down as 0, not left blank', () => {
        // Blank means "JS has not run", and the stylesheet answers that with a static fallback
        // reserving space for a bar that is not there. The two situations want different
        // answers, so they get different values.
        const { doc, win } = screen();
        doc.querySelector = () => null;
        inset.apply(doc, win);
        expect(doc.documentElement.style.getPropertyValue('--nexus-composer-inset')).toBe('0px');
    });

    test('a desktop window reserves nothing at all', () => {
        // Above the breakpoint the panel is a floating card beside the avatar; there is no sheet
        // and nothing to avoid.
        const { doc, win } = screen({ width: 1280 });
        inset.apply(doc, win);
        expect(doc.documentElement.style.getPropertyValue('--nexus-composer-inset')).toBe('');
    });

    test('it uses the same breakpoint the sheet does', () => {
        expect(CSS).toContain(`@media (max-width: ${inset.MOBILE_MAX}px)`);
    });
});

describe('keeping it current', () => {
    function watchable(overrides = {}) {
        const listeners = [];
        const { doc, win } = screen(overrides);
        win.addEventListener = (event, fn) => listeners.push([event, fn]);
        win.removeEventListener = (event, fn) => {
            const index = listeners.findIndex(([e, f]) => e === event && f === fn);
            if (index >= 0) listeners.splice(index, 1);
        };
        win.visualViewport = {
            height: overrides.height || 915,
            offsetTop: 0,
            addEventListener: win.addEventListener,
            removeEventListener: win.removeEventListener,
        };
        return { doc, win, listeners };
    }

    test('it measures once immediately, so the first sheet is already clear', () => {
        const { doc, win } = watchable();
        inset.watch({ doc, win });
        expect(doc.documentElement.style.getPropertyValue('--nexus-composer-inset')).toBe('76px');
    });

    test('it listens for the keyboard as well as for rotation', () => {
        const { doc, win, listeners } = watchable();
        inset.watch({ doc, win });
        const events = listeners.map(([event]) => event);
        expect(events).toContain('resize');
        expect(events).toContain('orientationchange');
        // Twice: once on window, once on the visual viewport, which is the one that moves.
        expect(events.filter((e) => e === 'resize').length).toBeGreaterThan(1);
        expect(events).toContain('scroll');
    });

    test('a later resize is picked up', () => {
        const { doc, win, listeners } = watchable();
        inset.watch({ doc, win });
        doc.querySelector = () => ({
            getBoundingClientRect: () => ({ top: 600, bottom: 915, height: 315, left: 0, right: 412 }),
        });
        for (const [, fn] of listeners) fn();
        expect(doc.documentElement.style.getPropertyValue('--nexus-composer-inset')).toBe('315px');
    });

    test('stopping removes every listener it added', () => {
        const { doc, win, listeners } = watchable();
        const stop = inset.watch({ doc, win });
        expect(listeners.length).toBeGreaterThan(0);
        stop();
        expect(listeners).toHaveLength(0);
        expect(() => stop()).not.toThrow();
    });

    test('a document with nothing to watch still returns a working stop', () => {
        expect(() => inset.watch({ doc: null, win: null })()).not.toThrow();
    });
});

describe('the sheet spends the number', () => {
    test('it no longer sits on the bottom of the screen', () => {
        expect(PANEL_RULE).not.toMatch(/bottom:\s*0\b/);
    });

    test('its bottom edge is offset by the composer', () => {
        expect(PANEL_RULE).toMatch(/bottom:\s*var\(--nexus-composer-inset/);
    });

    test('and so is its height — reserving at one end only moves the overlap', () => {
        // A sheet offset upward but still 62% tall grows off the top of the screen instead of
        // under the composer. Both ends, or neither.
        const maxHeights = PANEL_RULE.match(/max-height:[^;]+;/g) || [];
        expect(maxHeights.length).toBeGreaterThanOrEqual(2);
        for (const declaration of maxHeights) {
            expect(declaration).toContain('--nexus-composer-inset');
        }
    });

    test('dvh is used, with vh underneath it for phones that lack it', () => {
        // Mobile browser chrome changes the usable viewport; vh does not notice. The vh
        // declaration comes first so a browser that understands dvh overrides it.
        const maxHeights = PANEL_RULE.match(/max-height:[^;]+;/g) || [];
        expect(maxHeights[0]).toContain('vh');
        expect(maxHeights[0]).not.toContain('dvh');
        expect(maxHeights[maxHeights.length - 1]).toContain('dvh');
    });

    test('the fallback reserves real space before the measurement arrives', () => {
        // Including the safe area, because in that window nothing has measured past it yet.
        expect(PANEL_RULE).toContain('env(safe-area-inset-bottom, 0px)');
    });

    test('it scrolls internally rather than growing past its cap', () => {
        expect(PANEL_RULE).toMatch(/overflow-y:\s*auto/);
        expect(PANEL_RULE).toMatch(/overscroll-behavior:\s*contain/);
    });

    test('there is padding under the last button', () => {
        expect(PANEL_RULE).toMatch(/padding-bottom:\s*max\(/);
    });

    test('this is not a z-index fix', () => {
        // The panel already outranked the composer. Stacking it higher would have hidden the
        // chat bar instead of the button — the same collision, wearing the other hat.
        const before = fs.readFileSync(
            path.join(__dirname, '..', 'src', 'features', 'together', 'ui', 'TogetherLauncher.js'),
            'utf8'
        );
        expect(before).toContain('This is layout, not z-index');
    });
});

describe('the launcher starts and stops the measuring', () => {
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
        document.body.innerHTML =
            '<div class="avatar-card"><div class="avatar-footer-actions">' +
            '<div class="avatar-footer-right"></div></div></div>';
        delete global.window.NEXUS_COMPOSER_INSET;
    });

    test('attach begins it and detach ends it', () => {
        // A watcher left running after detach keeps listeners on the window and the visual
        // viewport, writing a property nothing reads.
        const calls = { started: 0, stopped: 0 };
        global.window.NEXUS_COMPOSER_INSET = {
            watch() {
                calls.started += 1;
                return () => {
                    calls.stopped += 1;
                };
            },
        };
        const launcher = TogetherLauncher.attach({ panel: fakePanel(), doc: document, viewer: null });
        expect(calls.started).toBe(1);
        launcher.detach();
        expect(calls.stopped).toBe(1);
    });

    test('and attaching without the module is not an error', () => {
        // The sheet then falls back to the static reservation in the stylesheet, which is worse
        // than a measurement and much better than the launcher failing to attach at all.
        expect(() => TogetherLauncher.attach({ panel: fakePanel(), doc: document, viewer: null })).not.toThrow();
    });

    test('a watcher that throws on start does not take the launcher with it', () => {
        global.window.NEXUS_COMPOSER_INSET = {
            watch() {
                throw new Error('no viewport');
            },
        };
        expect(() => TogetherLauncher.attach({ panel: fakePanel(), doc: document, viewer: null })).not.toThrow();
    });
});
