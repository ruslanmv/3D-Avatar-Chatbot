/**
 * PG2. Every place by name has a picture, and the Places menu is a grid of venue cards.
 *
 * Held here: each of the fourteen places names a preview that exists, is a 640×480 WebP and is
 * small enough for a menu; the catalogue keeps only safe image paths; `placesFor` hands the card
 * its picture, category and fallback paint; the Places activity passes them on; and the panel
 * draws a card with a 4:3 art box whose picture is decoration — the button's name is the place.
 * Privacy is unchanged: the picture rides on `placesFor`, which still decides what is offered.
 */
const fs = require('fs');
const path = require('path');
const Worlds = require('../src/gltf-viewer/VRWorlds.js');

const ROOT = path.join(__dirname, '..');
const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/vr-worlds/worlds.json'), 'utf8'));
const { worlds, problems } = Worlds.validateCatalogue(raw);
const named = worlds.filter((w) => w.place && !w.lightFor);

/** Width and height of a WebP file, from its header (VP8, VP8L or VP8X). */
function webpSize(buf) {
    if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null;
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L') {
        const b = buf.readUInt32LE(21);
        return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8X') return { w: buf.readUIntLE(24, 3) + 1, h: buf.readUIntLE(27, 3) + 1 };
    return null;
}

describe('the pictures', () => {
    test('all fourteen places have one: 640×480 WebP, at most 60 KB, and a category', () => {
        expect(problems).toEqual([]);
        expect(named.length).toBe(14); // LW2 added the apartment
        for (const w of named) {
            expect(`${w.id}: ${w.preview}`).toBe(`${w.id}: previews/${w.id}.webp`);
            expect(w.category).toMatch(/^[A-Z]/);
            const file = path.join(ROOT, Worlds.ROOT, w.preview);
            const buf = fs.readFileSync(file);
            expect(webpSize(buf)).toEqual({ w: 640, h: 480 });
            expect(buf.length).toBeLessThanOrEqual(60 * 1024);
        }
    });

    test('nothing in previews/ is orphaned', () => {
        const files = fs.readdirSync(path.join(ROOT, Worlds.ROOT, 'previews'));
        expect(files.sort()).toEqual(named.map((w) => `${w.id}.webp`).sort());
    });

    test('the catalogue keeps only an image path under its own folder', () => {
        const base = raw.worlds.find((w) => w.id === 'hotel-suite');
        const check = (preview, category) =>
            Worlds.validateCatalogue({ worlds: [{ ...base, preview, category }] }).worlds[0];
        expect(check('previews/hotel-suite.webp', 'Romantic').preview).toBe('previews/hotel-suite.webp');
        for (const bad of ['../x.webp', '/abs.webp', 'https://evil.example/x.webp', 'scenes/x.glb', 'a\\b.webp'])
            expect(check(bad).preview).toBeNull();
        expect(check(null, '<b>x</b>').category).toBeNull();
    });

    test('the render recipe is a committed tool, and it adds nothing to the app', () => {
        const tool = fs.readFileSync(path.join(ROOT, 'tools/vr/render-place-previews.mjs'), 'utf8');
        expect(tool).toMatch(/SPEC = Object\.freeze/);
        // The app gains no preview route or flag: nothing in src/ mentions the tool's markers.
        const engine = fs.readFileSync(path.join(ROOT, 'src/gltf-viewer/ViewerEngine.js'), 'utf8');
        expect(engine).not.toMatch(/render-place-previews|placePreview/);
    });
});

describe('the cards', () => {
    test('placesFor gives every offered place its picture, category and fallback paint', () => {
        for (const tier of Worlds.TIERS) {
            const offered = Worlds.placesFor(worlds, { tier, include: ['general', 'romantic'] });
            for (const p of offered) {
                expect(p.image).toBe(`${Worlds.ROOT}previews/${p.id}.webp`);
                expect(p.category).toBeTruthy();
                expect(p.tint.every((c) => /^#[0-9a-f]{6}$/i.test(c))).toBe(true);
                expect(p.rating).not.toBe('private');
            }
        }
    });

    describe('in the panel', () => {
        const Places = require('../src/features/together/activities/places.js');
        const TogetherPanel = require('../src/features/together/ui/TogetherPanel.js');
        let panel;

        beforeEach(() => {
            window.NEXUS_VR_WORLDS = Worlds;
            window.__NEXUS_COMPANION_LIVE = {
                session: { enter: jest.fn(), active: () => false, activity: () => null, end: jest.fn() },
            };
            document.body.innerHTML = '<div id="chat-history"></div>';
            const consent = { state: { state: 'idle' }, onChange: () => () => {}, request: jest.fn() };
            panel = TogetherPanel.attach({ consent, capture: {}, config: {}, doc: document, win: window });
            panel.mount(document.body);
            const places = Places.attach({});
            places._catalogue = { worlds };
            panel.register(places);
            panel.open();
            panel.choose('places');
        });
        afterEach(() => {
            delete window.NEXUS_VR_WORLDS;
            delete window.__NEXUS_COMPANION_LIVE;
            document.body.innerHTML = '';
        });

        test('every place is a card: a 4:3 art box with its picture, then name, category and line', () => {
            const list = document.querySelector('.nexus-bd-together-options');
            expect(list.classList.contains('is-venues')).toBe(true);
            const cards = [...document.querySelectorAll('.nexus-bd-together-venue')];
            const offered = Worlds.placesFor(worlds, { tier: 'desktop', include: ['general', 'romantic'] });
            expect(cards.length).toBe(offered.length);
            for (const card of cards) {
                const img = card.querySelector('.nexus-bd-together-venueart img');
                expect(img.getAttribute('alt')).toBe('');
                expect(img.getAttribute('src')).toMatch(/^assets\/vr-worlds\/previews\/[a-z0-9-]+\.webp$/);
                expect(img.getAttribute('loading')).toBe('lazy');
                expect(card.querySelector('.nexus-bd-together-venueart').getAttribute('aria-hidden')).toBe('true');
                expect(
                    card.querySelector('.nexus-bd-together-venueart').style.getPropertyValue('--venue-tint')
                ).toMatch(/gradient/);
                expect(card.querySelector('.nexus-bd-together-venuetitle').textContent).toBeTruthy();
                expect(card.querySelector('.nexus-bd-together-optiontag').textContent).toBeTruthy();
                expect(card.getAttribute('aria-label')).toMatch(
                    card.querySelector('.nexus-bd-together-venuetitle').textContent
                );
            }
        });

        test('a picture that fails leaves the painted card, not a broken image', () => {
            const img = document.querySelector('.nexus-bd-together-venueart img');
            const art = img.parentNode;
            img.dispatchEvent(new Event('error'));
            expect(art.querySelector('img')).toBeNull();
            expect(art.style.getPropertyValue('--venue-tint')).toMatch(/gradient/);
        });

        test('no private room is drawn here', () => {
            const ids = [...document.querySelectorAll('.nexus-bd-together-venue')].map((b) => b.dataset.input);
            for (const w of named.filter((x) => x.rating === 'private')) expect(ids).not.toContain(w.id);
        });
    });

    test('the grid widens the panel only on a wide screen, keeps two columns on a phone, and calms down', () => {
        const css = fs.readFileSync(path.join(ROOT, 'src/features/together/ui/TogetherLauncher.js'), 'utf8');
        expect(css).toMatch(/@media \(min-width: 641px\) \{\s*#nexus-bd-together-panel:has\(/);
        expect(css).toMatch(/aspect-ratio: 4 \/ 3/);
        expect(css).toMatch(
            /max-width: 640px\) \{\s*\.nexus-bd-together-options\.is-venues \{ grid-template-columns: repeat\(2/
        );
        expect(css).toMatch(
            /prefers-reduced-motion: reduce\) \{\s*\.nexus-bd-together-option\.nexus-bd-together-venue/
        );
    });
});
