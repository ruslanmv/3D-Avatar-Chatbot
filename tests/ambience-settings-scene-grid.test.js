/**
 * The Settings scene grid (batch A6).
 *
 * This is the first batch a human can see, and the first that touches shared files, so the
 * assertions split into three kinds:
 *
 *   * **the cards themselves** — built from the catalogue, with the DOM shape the stylesheet
 *     depends on. The adjacent-sibling selector is the one that fails silently: put anything
 *     between the radio and `.provider-content` and selection simply stops showing while every
 *     other thing keeps working.
 *   * **what must not have changed** — the five colour cards, the save path, the sync path. A6
 *     is additive, and "additive" is a claim worth testing rather than asserting in a commit
 *     message.
 *   * **the delegated listener** — the one real edit to `main.js`. A per-radio `forEach` runs
 *     once at init, so cards injected later would have no handler at all: the card would
 *     highlight on click and the background would not change. That is the bug this batch would
 *     otherwise have shipped.
 *
 * `main.js` is a 5,000-line ES module that cannot be `require`d under jsdom, so the parts of
 * this that concern it read its source — the house pattern, as in
 * `tests/ambience-viewer-engine-background.test.js`.
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf-8');
const css = fs.readFileSync(path.join(root, 'styles/main.css'), 'utf-8');
const mainSrc = fs.readFileSync(path.join(root, 'src/main.js'), 'utf-8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets/ambient/backgrounds.json'), 'utf-8'));

const Catalog = require('../src/gltf-viewer/ambience/ViewportBackgroundCatalog.js');

/**
 * Pixel dimensions of a lossy WebP, read from the bitstream header.
 *
 * There is no image decoder available under jsdom, and the point of the assertion that uses
 * this is that the *files* agree — a check performed against anything but the bytes would be
 * checking the manifest against itself.
 */
function webpSize(buf) {
    if (buf.subarray(0, 4).toString('ascii') !== 'RIFF' || buf.subarray(8, 12).toString('ascii') !== 'WEBP') {
        throw new Error('not a WebP');
    }
    if (buf.subarray(12, 16).toString('ascii') !== 'VP8 ') {
        throw new Error(`unhandled WebP chunk ${buf.subarray(12, 16).toString('ascii')}`);
    }
    // Simple lossy VP8: a 3-byte frame tag, the 3-byte start code 9d 01 2a, then two
    // 16-bit little-endian fields whose low 14 bits are the dimensions.
    return {
        width: buf.readUInt16LE(26) & 0x3fff,
        height: buf.readUInt16LE(28) & 0x3fff,
    };
}

/** The body of one top-level function in main.js, by its definition. */
function mainFn(name) {
    const start = mainSrc.indexOf(`\nfunction ${name}(`);
    if (start === -1) throw new Error(`no function ${name} in main.js`);
    const end = mainSrc.indexOf('\n}', start);
    return mainSrc.slice(start, end === -1 ? undefined : end);
}

describe('the assets exist, and the catalogue names them', () => {
    test('every src and thumb the manifest names is a real file', () => {
        // The failure otherwise: a card that renders, selects, and shows nothing — with a 404 in
        // the console that nobody is looking at.
        for (const scene of manifest.scenes) {
            for (const key of ['src', 'thumb']) {
                expect(fs.existsSync(path.join(root, scene[key]))).toBe(true);
            }
        }
    });

    test('there are ten of them, in light and dark pairs', () => {
        expect(manifest.scenes).toHaveLength(10);
        const light = manifest.scenes.filter((s) => s.src.includes('/light/'));
        const dark = manifest.scenes.filter((s) => s.src.includes('/dark/'));
        expect(light).toHaveLength(5);
        expect(dark).toHaveLength(5);
    });

    test('every scene is the same pixel size, so the grid cannot go ragged', () => {
        // Mixed aspect ratios would crop differently card to card and, worse, differently in
        // the viewport — the cover transform is computed per image against the live viewport,
        // so one odd aspect ratio means one scene that frames unlike all the others.
        const sizes = new Set(
            manifest.scenes.map((scene) => {
                const dims = webpSize(fs.readFileSync(path.join(root, scene.src)));
                return `${dims.width}x${dims.height}`;
            })
        );
        expect([...sizes]).toHaveLength(1);
        const [only] = [...sizes];
        const [w, h] = only.split('x').map(Number);
        // Close enough to 16:9 that a 16:9 thumbnail box crops almost nothing.
        expect(Math.abs(w / h - 16 / 9)).toBeLessThan(0.02);
    });

    test('they are WebP, and none is large enough to stall a settings panel', () => {
        for (const scene of manifest.scenes) {
            const file = path.join(root, scene.src);
            expect(scene.src.endsWith('.webp')).toBe(true);
            // RIFF....WEBP — checked as bytes, because an extension is not a format.
            const head = fs.readFileSync(file).subarray(0, 12);
            expect(head.subarray(0, 4).toString('ascii')).toBe('RIFF');
            expect(head.subarray(8, 12).toString('ascii')).toBe('WEBP');
            expect(fs.statSync(file).size).toBeLessThan(400 * 1024);
        }
    });

    test('the whole set fits the budget the plan set aside', () => {
        const total = manifest.scenes.reduce((n, s) => n + fs.statSync(path.join(root, s.src)).size, 0);
        expect(total).toBeLessThan(1.28 * 1024 * 1024);
    });

    test('the catalogue ingests all ten with no rejections', () => {
        Catalog.reset();
        const report = Catalog.ingest(manifest);
        // `ingest` reports counts, not lists — accepted/rejected are numbers.
        expect(report.rejected).toBe(0);
        expect(report.accepted).toBe(10);
        expect(Catalog.images()).toHaveLength(10);
        Catalog.reset();
    });

    test('provenance names the source repository and the exact commit', () => {
        // The commit matters: it is what makes "byte-identical to upstream" a checkable claim
        // rather than a reassuring sentence.
        const note = fs.readFileSync(path.join(root, 'assets/ambient/PROVENANCE.md'), 'utf-8');
        expect(note).toContain('ruslanmv/yourfriend');
        expect(note).toContain('60f421b');
    });

    test('provenance records the upstream licence, and this repo can carry it', () => {
        // CLAUDE.md: anything added must be Apache-2.0 or compatible, with provenance recorded
        // where the asset lands. Upstream carries an Apache-2.0 LICENSE, so this is a citation
        // rather than an assertion — and the note has to point at it.
        const note = fs.readFileSync(path.join(root, 'assets/ambient/PROVENANCE.md'), 'utf-8');
        expect(note).toMatch(/Apache-2\.0/);
        expect(note).toContain('yourfriend/blob/master/LICENSE');
        expect(note).not.toMatch(/declares no licence/i);
    });

    test('the fallback generator is in the tree and described as a fallback', () => {
        expect(fs.existsSync(path.join(root, 'tools/ambience/generate-backgrounds.py'))).toBe(true);
        const note = fs.readFileSync(path.join(root, 'assets/ambient/PROVENANCE.md'), 'utf-8');
        expect(note).toContain('tools/ambience/generate-backgrounds.py');
        expect(note).toMatch(/is not what ships|are \*\*not\*\* photoreal/i);
    });
});

describe('index.html — the container only, never the cards', () => {
    test('the grid is present and empty in the markup', () => {
        // No image URL lives in the HTML. Adding a scene is a data change, and that is what
        // keeps one list of what exists rather than two.
        expect(html).toContain('id="bg-scene-grid"');
        expect(html).not.toContain('assets/ambient/light/');
        expect(html).not.toContain('assets/ambient/dark/');
    });

    test('scenes are their own section, and the colours follow as the fallback', () => {
        // A17 split what used to be one VIEWPORT BACKGROUND section. The order is the claim:
        // the artwork is the subject and the five colours are what shows when there is none.
        const scenesHeading = html.indexOf('>SCENES<');
        const grid = html.indexOf('id="bg-scene-grid"');
        const fallbackHeading = html.indexOf('FALLBACK BACKGROUND');
        const colours = html.indexOf('id="bg-selector"');
        const shadows = html.indexOf('SHADOWS');
        expect(scenesHeading).toBeGreaterThan(-1);
        expect(scenesHeading).toBeLessThan(grid);
        expect(grid).toBeLessThan(fallbackHeading);
        expect(fallbackHeading).toBeLessThan(colours);
        expect(colours).toBeLessThan(shadows);
    });

    test('both kinds still share one radio group', () => {
        // The reason they were one section, and the part that must survive being two: a colour
        // and a scene are alternatives, not independent settings. Two groups is how the panel
        // ends up showing Ocean while the background is black.
        const sceneRadio = renderSource().match(/radio\.name = '([^']+)'/);
        expect(sceneRadio).not.toBeNull();
        expect(html).toContain(`name="${sceneRadio[1]}" value="black"`);
    });

    test('the heading is labelled for assistive technology', () => {
        expect(html).toContain('id="bg-scene-heading"');
        expect(html).toContain('aria-labelledby="bg-scene-heading"');
        expect(html).toContain('role="group"');
    });

    test('the five colour cards are byte-for-byte what they were', () => {
        for (const value of ['black', 'dark', 'gray', 'light', 'white']) {
            expect(html).toContain(`name="desktop-bg" value="${value}"`);
        }
        expect(html.match(/name="desktop-bg"/g)).toHaveLength(5);
    });
});

/** The renderer's source, for assertions that compare markup against what the code emits. */
function renderSource() {
    const start = mainSrc.indexOf('function _renderSceneBackgroundCards()');
    const end = mainSrc.indexOf('\nfunction ', start + 1);
    const slice = mainSrc.slice(start, end);
    if (slice.length < 200) throw new Error('could not slice _renderSceneBackgroundCards from main.js');
    return slice;
}

describe('styles — additive, and the selector that fails silently', () => {
    test('the adjacent-sibling rule is untouched', () => {
        // If this ever becomes a descendant selector, every card in the panel stops showing its
        // checked state at once.
        expect(css).toContain('.provider-radio:checked + .provider-content');
    });

    test('the thumbnail crops rather than letterboxes', () => {
        // A thumbnail that letterboxed would show the whole image while selecting it shows a
        // crop — the card would misrepresent what it does.
        const rule = css.slice(css.indexOf('.provider-thumb {'));
        expect(rule.slice(0, 400)).toContain('background-size: cover');
        expect(rule.slice(0, 400)).toContain('aspect-ratio: 16 / 9');
    });

    test('keyboard focus is visible', () => {
        expect(css).toContain('.provider-radio:focus-visible + .provider-content');
        expect(css).toMatch(/focus-visible \+ \.provider-content \{[\s\S]{0,120}outline:/);
    });

    test('the scene grid narrows on a phone', () => {
        expect(css).toContain('.provider-grid--scenes');
        const scoped = css.slice(css.indexOf('.provider-grid--scenes'));
        expect(scoped.slice(0, 400)).toContain('grid-template-columns: repeat(3, 1fr)');
        expect(css).toMatch(/@media \(max-width: 480px\) \{[\s\S]{0,200}provider-grid--scenes/);
    });

    test('the base .provider-grid is still two columns for every other section', () => {
        const base = css.slice(css.indexOf('.provider-grid {'));
        expect(base.slice(0, 200)).toContain('grid-template-columns: repeat(2, 1fr)');
    });
});

describe('main.js — the cards are built, not templated', () => {
    const render = mainFn('_renderSceneBackgroundCards');

    test('labels go through textContent, never innerHTML', () => {
        // Labels are free text in a data file. This is the difference between a label that
        // contains markup and markup.
        expect(render).toContain('.textContent = scene.label');
        expect(render).not.toMatch(/innerHTML/);
    });

    test('the radio is the immediately preceding sibling of .provider-content', () => {
        const radio = render.indexOf('card.appendChild(radio)');
        const content = render.indexOf('card.appendChild(content)');
        expect(radio).toBeGreaterThan(-1);
        expect(content).toBeGreaterThan(radio);
        // Nothing else is appended to the card between them. Sliced past the opening call, or
        // the assertion trivially finds the marker it started from.
        expect(render.slice(radio + 'card.appendChild(radio);'.length, content)).not.toContain('card.appendChild');
    });

    test('each card carries the scene id as its radio value', () => {
        expect(render).toContain("radio.name = 'desktop-bg'");
        expect(render).toContain('radio.value = scene.id');
    });

    test('it clears before it draws, so reopening cannot double the cards', () => {
        const clear = render.indexOf("grid.textContent = ''");
        expect(clear).toBeGreaterThan(-1);
        expect(clear).toBeLessThan(render.indexOf('grid.appendChild'));
    });

    test('no scenes hides the grid and says so', () => {
        // A17: the heading is now a section title, so hiding it would take the fallback colours
        // out of context and leave somebody whose scenes failed to load with nothing to read.
        expect(render).toContain('grid.hidden = empty');
        expect(render).toContain('note.hidden = !empty');
    });

    test('a missing file marks the card instead of showing the wrong picture', () => {
        expect(render).toContain('provider-thumb--missing');
        expect(render).toContain('probe.onerror');
    });

    test('it reads a catalogue and nothing else for its list', () => {
        // A17 put the library in front: the grid renders every source, not only the built-in
        // one, and still contains no path of its own.
        expect(render).toContain('NEXUS_SCENE_CATALOG');
        expect(render).toContain('catalog.images()');
        expect(render).not.toMatch(/assets\/ambient/);
    });
});

describe('main.js — the delegated listener, which is the one real edit', () => {
    test('the per-radio forEach is gone', () => {
        // It ran once at init. Cards injected afterwards would have had no handler: the card
        // highlights, the background does not change, and nothing errors.
        expect(mainSrc).not.toMatch(/querySelectorAll\('input\[name="desktop-bg"\]'\)\.forEach/);
    });

    test('one document-level listener handles every card, present and future', () => {
        expect(mainSrc).toContain("if (!radio || radio.name !== 'desktop-bg') return;");
        expect(mainSrc).toContain('window.NEXUS_VIEWER?.setDesktopBackground(radio.value);');
    });

    test('the other three radio groups keep their own listeners', () => {
        // Only desktop-bg grows new cards at runtime, so only it needed changing. Converting
        // the others would have been scope the batch did not ask for.
        for (const name of ['render-mode', 'desktop-shadow']) {
            expect(mainSrc).toContain(`querySelectorAll('input[name="${name}"]').forEach`);
        }
    });
});

describe('main.js — the paths the plan said must not change, and did not', () => {
    test('the save path still writes whatever is checked, opaquely', () => {
        expect(mainSrc).toContain('const bgRadio = document.querySelector(\'input[name="desktop-bg"]:checked\');');
        expect(mainSrc).toContain("localStorage.setItem('desktop_bg', desktopBg);");
    });

    test('the engine sync still ticks by value', () => {
        expect(mainSrc).toContain('input[name="desktop-bg"][value="${vis.background}"]');
    });

    test('pre-select compares values rather than interpolating a selector', () => {
        // A scene id contains colons, and a stored value could contain a quote. Interpolating
        // either makes querySelector throw and takes the whole Settings panel with it.
        const fn = mainFn('_preselectBackgroundCard');
        expect(fn).toContain('radio.value === savedBg');
        expect(fn).not.toContain('CSS.escape');
    });

    test('the cards are drawn before the pre-select runs', () => {
        // Otherwise a saved scene has no radio to find and the panel silently shows Black.
        const open = mainSrc.slice(mainSrc.indexOf('function openSettings()'));
        const body = open.slice(0, open.indexOf('\n}'));
        expect(body.indexOf('_ensureSceneBackgroundCards()')).toBeLessThan(body.indexOf('_preselectBackgroundCard()'));
    });

    test('a late catalogue load redraws and re-ticks', () => {
        // engine-bridge applies desktop_bg synchronously at boot, before the data file lands.
        const fn = mainFn('_ensureSceneBackgroundCards');
        expect(fn).toContain('catalog.hasImages()');
        expect(fn).toContain('_renderSceneBackgroundCards();');
        expect(fn).toContain('_preselectBackgroundCard();');
        expect(fn).toContain('.catch(');
    });
});

describe('the grid, rendered for real in jsdom', () => {
    let grid;
    let heading;
    let note;

    beforeEach(() => {
        document.body.innerHTML =
            '<h3 class="config-title" id="bg-scene-heading">SCENES</h3>' +
            '<div class="provider-grid provider-grid--scenes" id="bg-scene-grid"></div>' +
            '<p id="bg-scene-empty" hidden>No scenes are installed.</p>';
        grid = document.getElementById('bg-scene-grid');
        heading = document.getElementById('bg-scene-heading');
        note = document.getElementById('bg-scene-empty');
        Catalog.reset();
    });

    afterEach(() => {
        Catalog.reset();
        document.body.innerHTML = '';
    });

    /**
     * The render function, lifted out of main.js and evaluated.
     *
     * main.js is an ES module with imports, so it cannot be required. Reading one function's
     * source and evaluating it is the same pattern `tests/camera-presets.test.js` uses, and it
     * means these assertions run the shipping code rather than a copy of it.
     */
    function renderer() {
        const start = mainSrc.indexOf('function _renderSceneBackgroundCards()');
        const end = mainSrc.indexOf('\n}', start) + 2;
        // eslint-disable-next-line no-eval
        return eval(`(${mainSrc.slice(start, end)})`);
    }

    test('it draws one card per catalogue scene, in order', () => {
        Catalog.ingest(manifest);
        window.NEXUS_VIEWPORT_BACKGROUND_CATALOG = Catalog;
        renderer()();
        const cards = grid.querySelectorAll('label.provider-card');
        expect(cards).toHaveLength(10);
        const values = [...grid.querySelectorAll('input[name="desktop-bg"]')].map((r) => r.value);
        expect(values).toEqual(manifest.scenes.map((s) => s.id));
    });

    test('each card has the DOM shape the stylesheet needs', () => {
        Catalog.ingest(manifest);
        window.NEXUS_VIEWPORT_BACKGROUND_CATALOG = Catalog;
        renderer()();
        for (const card of grid.querySelectorAll('label.provider-card')) {
            const radio = card.firstElementChild;
            expect(radio.tagName).toBe('INPUT');
            expect(radio.className).toBe('provider-radio');
            // The adjacent sibling. This is the assertion that keeps selection visible.
            expect(radio.nextElementSibling.className).toBe('provider-content');
        }
    });

    test('the thumbnail is the scene image, cropped by CSS', () => {
        Catalog.ingest(manifest);
        window.NEXUS_VIEWPORT_BACKGROUND_CATALOG = Catalog;
        renderer()();
        const thumb = grid.querySelector('.provider-thumb');
        expect(thumb.style.backgroundImage).toContain('assets/ambient/');
        expect(thumb.style.backgroundImage).toContain('.webp');
    });

    test('a label containing markup stays text', () => {
        Catalog.ingest({
            schemaVersion: 1,
            scenes: [
                {
                    id: 'ambient:x:day',
                    type: 'image',
                    label: '<img src=x onerror=alert(1)>',
                    src: 'assets/ambient/light/open-sky.webp',
                    thumb: 'assets/ambient/light/open-sky.webp',
                },
            ],
        });
        window.NEXUS_VIEWPORT_BACKGROUND_CATALOG = Catalog;
        renderer()();
        expect(grid.querySelector('img')).toBeNull();
        expect(grid.querySelector('.provider-name').textContent).toBe('<img src=x onerror=alert(1)>');
    });

    test('rendering twice leaves ten cards, not twenty', () => {
        Catalog.ingest(manifest);
        window.NEXUS_VIEWPORT_BACKGROUND_CATALOG = Catalog;
        const render = renderer();
        render();
        render();
        expect(grid.querySelectorAll('label.provider-card')).toHaveLength(10);
    });

    test('an empty catalogue hides the grid and shows the note', () => {
        window.NEXUS_VIEWPORT_BACKGROUND_CATALOG = Catalog;
        renderer()();
        expect(grid.querySelectorAll('label')).toHaveLength(0);
        expect(grid.hidden).toBe(true);
        expect(note.hidden).toBe(false);
        // The section title stays: it is what the fallback colours below are an alternative to.
        expect(heading.hidden).toBe(false);
    });

    test('scenes arriving later un-hide it', () => {
        window.NEXUS_VIEWPORT_BACKGROUND_CATALOG = Catalog;
        const render = renderer();
        render();
        expect(grid.hidden).toBe(true);
        Catalog.ingest(manifest);
        render();
        expect(grid.hidden).toBe(false);
        expect(heading.hidden).toBe(false);
    });

    test('no catalogue at all is a no-op, not a crash', () => {
        delete window.NEXUS_VIEWPORT_BACKGROUND_CATALOG;
        expect(() => renderer()()).not.toThrow();
        expect(grid.children).toHaveLength(0);
    });

    test('the variant label is shown when there is one', () => {
        Catalog.ingest(manifest);
        window.NEXUS_VIEWPORT_BACKGROUND_CATALOG = Catalog;
        renderer()();
        const variants = [...grid.querySelectorAll('.provider-variant')].map((n) => n.textContent);
        expect(variants).toContain('Sunrise');
        expect(variants).toContain('Moonlight');
    });
});
