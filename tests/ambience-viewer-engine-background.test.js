/**
 * Wiring the background manager into ViewerEngine (batch A5).
 *
 * `ViewerEngine.js` is an ES module with twenty imports, and this repo has no Babel config, so
 * Jest cannot `require()` it and `eval()` would die on the first `import`. The house answer is to
 * read the file and assert on its source — see `tests/vr-intimacy-system.test.js:571`. That is
 * what this does, and it suits the batch: A5 is five specific edits, the *behaviour* they produce
 * is already covered by A4's 45 unit tests, and what needs pinning here is that each edit is
 * present and that the pattern it replaced is gone.
 *
 * Three of the assertions are worth more than the rest:
 *
 *   * **the VR-exit rebuild is gone.** `BG_COLORS['ambient:terrace:night']` is `undefined`, so
 *     the old `?? 0x000000` painted black over somebody's chosen scene on leaving VR. If that
 *     line ever comes back, an image selection silently dies in XR again.
 *   * **load order in index.html.** The three ambience scripts must come before
 *     `engine-bridge.js`. Get it wrong and there is no error at all — the globals are simply
 *     undefined, ViewerEngine null-guards, and scenic backgrounds quietly never work.
 *   * **BG_COLORS and the catalogue agree.** Two lists of the same five ids, deliberately (one is
 *     an ES module, the other must stay testable). Drift shows up as a Settings card that selects
 *     and does nothing.
 */

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.resolve(__dirname, '../src/gltf-viewer/ViewerEngine.js'), 'utf-8');
const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf-8');
const Catalog = require('../src/gltf-viewer/ambience/ViewportBackgroundCatalog.js');

/**
 * The body of one method, by its *definition* rather than its first mention.
 *
 * Worth a helper: `src.indexOf('_createBackgroundManager()')` finds the constructor's call to it
 * on line 105, not the method on line 1630, so a naive slice runs backwards and silently matches
 * nothing. A test that passes because its slice was empty is worse than no test.
 */
function methodBody(name) {
    const start = src.indexOf(`\n    ${name}(`);
    if (start === -1) throw new Error(`no method ${name} in ViewerEngine.js`);
    const end = src.indexOf('\n    }', start);
    return src.slice(start, end === -1 ? undefined : end);
}

/** The BG_COLORS literal. Sliced to its own closing brace — DEFAULT_RENDER_MODE is referenced
 *  earlier in the file, so using that as the end anchor produces a backwards slice. */
function bgColorsBlock() {
    const start = src.indexOf('static BG_COLORS');
    return src.slice(start, src.indexOf('};', start));
}

describe('edit 1 — the manager is constructed, null-guarded', () => {
    test('it is built in the constructor', () => {
        expect(src).toContain('this.backgroundManager = this._createBackgroundManager();');
    });

    test('a missing script returns null rather than throwing', () => {
        expect(src).toContain("if (!factory || typeof factory.attach !== 'function' || !catalog) {");
        expect(src).toMatch(/_createBackgroundManager\(\)\s*\{[\s\S]{0,600}return null;/);
    });

    test('it hands over this engine own TextureLoader, not a second one', () => {
        expect(src).toContain('const loader = new THREE.TextureLoader();');
        expect(src).toContain("loader.setCrossOrigin('anonymous');");
        expect(src).toContain('loader.load(src, resolve, undefined, reject);');
    });

    test('it hands over BG_COLORS rather than a second copy of the values', () => {
        expect(src).toContain('colors: ViewerEngine.BG_COLORS,');
    });

    test('it hands over the real viewport measurement', () => {
        expect(src).toContain('getViewportSize: () => this._getViewportSize(),');
    });

    test('the catalogue is loaded, and a late arrival re-applies the saved scene', () => {
        // engine-bridge applies desktop_bg synchronously at boot, before the data file has
        // arrived. Without this, a saved scene would lose to the fallback colour on every load.
        expect(src).toContain("if (typeof catalog.load === 'function' && !catalog.hasImages())");
        expect(src).toContain('ViewerEngine.BG_COLORS[key] === undefined');
    });

    test('that check compares against undefined, because black is falsy', () => {
        // `if (!BG_COLORS[key])` would treat black (0x000000) as unknown and send it to the
        // scene catalogue, which does not have it.
        expect(src).not.toMatch(/if\s*\(\s*key\s*&&\s*!ViewerEngine\.BG_COLORS\[key\]\s*\)/);
    });
});

describe('edit 2 — setDesktopBackground delegates, and stays backward compatible', () => {
    test('the five colour keys still resolve through BG_COLORS', () => {
        expect(src).toContain('const color = ViewerEngine.BG_COLORS[key];');
    });

    test('a non-colour id is only accepted if the catalogue knows it', () => {
        expect(src).toContain('if (!this.backgroundManager || !this.backgroundManager.catalog?.has?.(key)) {');
    });

    test('an unknown id is still the same silent no-op as before', () => {
        // A stale desktop_bg written by a newer build must not break a boot. The early return
        // is what makes that true, and it predates this batch.
        const fn = src.slice(src.indexOf('setDesktopBackground(key) {'));
        expect(fn.slice(0, 1200)).toContain('return;');
    });

    test('the XR guard is preserved on both paths', () => {
        const fn = methodBody('setDesktopBackground');
        // While presenting, record the selection and leave the immersive view alone. A flat
        // rectangular image must never be pushed into a headset. Both branches need the guard.
        expect(fn.match(/if \(!this\.renderer\.xr\.isPresenting\)/g)).toHaveLength(2);
    });

    test('colours route through the manager so image → colour disposes the texture', () => {
        const fn = methodBody('setDesktopBackground');
        expect(fn).toContain('this.backgroundManager.apply(key);');
        // …and fall back to the original line when the manager is absent, so behaviour with
        // the scripts missing is exactly what it was.
        expect(fn).toContain('this.scene.background = new THREE.Color(color);');
    });
});

describe('edit 3 — leaving VR restores the image, not black', () => {
    test('the restore goes through reapplyCurrent, carrying the selection of record', () => {
        // A12-1 added the argument. Without it, reapplyCurrent restored whatever the *manager*
        // last applied — and the manager is deliberately never told about a selection made
        // while presenting, so a scene chosen in the headset was discarded on exit.
        expect(src).toContain('this.backgroundManager.reapplyCurrent(this._desktopBgKey);');
    });

    test('the unconditional colour rebuild is gone from the VR-exit path', () => {
        // The bug this batch fixes. BG_COLORS['ambient:terrace:night'] is undefined, so
        // `?? 0x000000` painted black over a chosen scene every time somebody left VR.
        const exit = src.slice(src.indexOf("addEventListener('vr-session-end'"));
        const restore = exit.slice(0, exit.indexOf('Restore desktop hemisphere light'));
        expect(restore).toContain('if (this.backgroundManager) {');
        expect(restore).toMatch(/} else \{[\s\S]{0,400}BG_COLORS\[this\._desktopBgKey\] \?\? 0x000000/);
    });

    test('VR entry is untouched: it still snapshots and paints a solid colour', () => {
        expect(src).toContain('this._vrSavedBackground = this.scene.background;');
        expect(src).toContain(
            "this.scene.background = new THREE.Color(this._vrBackgroundColor === 'blue' ? 0x1a1a2e : 0x000000);"
        );
    });

    test('the four VR background options are unchanged', () => {
        for (const option of ['passthrough', 'void', 'blue']) {
            expect(src).toContain(option);
        }
        expect(src).toContain("if (key === 'vrBackground')");
    });
});

describe('edit 4 — resize keeps the crop correct', () => {
    test('onResize is called from the existing resize lifecycle', () => {
        expect(src).toContain('this.backgroundManager?.onResize(w, h);');
    });

    test('it is inside resize(), after the renderer and composer are sized', () => {
        const fn = src.slice(src.indexOf('    resize() {'));
        const body = fn.slice(0, fn.indexOf('\n    }'));
        expect(body.indexOf('this.backgroundManager?.onResize')).toBeGreaterThan(
            body.indexOf('this.postProcessing?.setSize')
        );
    });

    test('no new resize listener was introduced', () => {
        // resize() is already debounced and already driven by two listeners — window and
        // visualViewport — both of which predate this batch. A third would fire twice and fight
        // the first two, so the count staying at two is the assertion.
        const listeners = src.match(/addEventListener\('resize'/g) || [];
        expect(listeners).toHaveLength(2);
        expect(src).toContain("window.addEventListener('resize', this._onResize)");
        expect(src).toContain("window.visualViewport.addEventListener('resize'");
    });
});

describe('edit 5 — a render-mode switch keeps the chosen background', () => {
    test('it re-applies the current selection instead of forcing black', () => {
        expect(src).toContain("this.setDesktopBackground(this._desktopBgKey || 'black');");
    });

    test("the old unconditional setDesktopBackground('black') is gone", () => {
        // The one intentional behaviour change in this batch. Before it, Anime ↔ Cinematic
        // discarded the user's choice — already true for `white`, far more noticeable once the
        // choice can be a photograph.
        expect(src).not.toMatch(/this\.setDesktopBackground\('black'\);/);
    });
});

describe('index.html load order — the failure with no error message', () => {
    const scripts = [
        'src/gltf-viewer/ambience/coverTransform.js',
        'src/gltf-viewer/ambience/ViewportBackgroundCatalog.js',
        'src/gltf-viewer/ambience/ViewportBackgroundManager.js',
    ];

    test.each(scripts)('%s is loaded', (file) => {
        expect(html).toContain(`<script src="${file}"></script>`);
    });

    test('all three load before engine-bridge.js', () => {
        // Get this wrong and there is no error at all: the globals are undefined, ViewerEngine
        // null-guards, and scenic backgrounds quietly never work.
        const bridge = html.indexOf('src="src/engine-bridge.js"');
        for (const file of scripts) {
            expect(html.indexOf(file)).toBeLessThan(bridge);
        }
    });

    test('they are plain scripts, not modules', () => {
        // They are IIFEs attaching to window.NEXUS_*. As type="module" the globals would still
        // be set, but the ordering guarantee against a deferred module would be lost.
        for (const file of scripts) {
            expect(html).not.toContain(`<script type="module" src="${file}"`);
        }
    });

    test('the catalogue is loaded before the manager that reads it', () => {
        expect(html.indexOf('ViewportBackgroundCatalog.js')).toBeLessThan(html.indexOf('ViewportBackgroundManager.js'));
    });

    test('the five colour cards in Settings are untouched', () => {
        for (const value of ['black', 'dark', 'gray', 'light', 'white']) {
            expect(html).toContain(`name="desktop-bg" value="${value}"`);
        }
    });
});

describe('BG_COLORS and the catalogue must not drift', () => {
    test('the id sets are identical', () => {
        const ids = [...bgColorsBlock().matchAll(/^\s+([a-z]+):\s*0x[0-9a-f]{6},/gm)].map((m) => m[1]);
        expect(ids).toHaveLength(5);
        expect(ids.sort()).toEqual([...Catalog.COLOR_IDS].sort());
    });

    test('every catalogue colour has a hex value in BG_COLORS', () => {
        // The manager warns at runtime when this is false, because the symptom is otherwise a
        // card that selects and does nothing. This is the test that stops it happening.
        const block = bgColorsBlock();
        for (const entry of Catalog.colors()) {
            expect(block).toContain(`${entry.id}: ${entry.swatch.replace('#', '0x')}`);
        }
    });
});

describe('what this batch deliberately did not touch', () => {
    test('no PMREM or environment map change', () => {
        // The background is a picture behind the avatar. Avatar lighting is untouched.
        expect(methodBody('_createBackgroundManager')).not.toMatch(/environment|PMREM|RoomEnvironment/);
    });

    test('tone mapping and exposure are not changed for the background', () => {
        expect(methodBody('_createBackgroundManager')).not.toMatch(/toneMapping|toneMappingExposure/);
    });

    test('the manager is given the scene, not the renderer', () => {
        // It has no business resizing, clearing or re-configuring the renderer.
        const start = src.indexOf('return factory.attach({');
        const call = src.slice(start, src.indexOf('});', start));
        expect(call).toContain('scene: this.scene,');
        expect(call).not.toContain('renderer');
    });
});
