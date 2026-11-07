/**
 * PG1. Playgrounds — an Irish pub, a neon discoteca, a private cabaret, a private (pretend) stream
 * studio and a creative academy, each with a template of things to do there.
 *
 * What is held here, in the order the master prompt ranks it: compatibility (nothing that was
 * there before changes shape), privacy (the two private venues are reachable from Private only,
 * and the studio cannot capture anything), then the venues themselves, the chips' lifecycle and
 * the phone layout. Properties are asserted, not sentences: a reworded chip must not fail this.
 */
const fs = require('fs');
const path = require('path');
const Worlds = require('../src/gltf-viewer/VRWorlds.js');
const Moods = require('../src/experiences/playgrounds/PlaygroundMoodPresets.js');
const Templates = require('../src/experiences/playgrounds/PlaygroundTemplateCatalog.js');
const Router = require('../src/experiences/playgrounds/PlaygroundInteractionRouter.js');

// Loading the router in a page attaches one for the page; the tests attach their own.
if (window.__NEXUS_PLAYGROUND_LIVE) window.__NEXUS_PLAYGROUND_LIVE.detach();

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const { worlds, problems } = Worlds.validateCatalogue(JSON.parse(read('assets/vr-worlds/worlds.json')));
const byId = (id) => worlds.find((w) => w.id === id);

const VENUES = ['irish-pub', 'neon-discoteca', 'private-cabaret', 'private-stream-studio', 'creative-academy'];
const PRIVATE = ['private-cabaret', 'private-stream-studio'];

describe('the venues are in the world catalogue', () => {
    test('valid, by name, rated as asked, every file present', () => {
        expect(problems).toEqual([]);
        for (const id of VENUES) {
            const w = byId(id);
            expect(w).toBeTruthy();
            expect(w.place).toBe(true);
            expect(w.lightFor).toBeNull();
        }
        expect(byId('irish-pub').rating).toBe('general');
        expect(['general', 'romantic']).toContain(byId('neon-discoteca').rating);
        expect(byId('creative-academy').rating).toBe('general');
        for (const id of PRIVATE) expect(byId(id).rating).toBe('private');
        for (const w of worlds) {
            if (w.scene) expect(fs.existsSync(path.join(ROOT, Worlds.ROOT, w.scene.src))).toBe(true);
            for (const p of w.props) expect(fs.existsSync(path.join(ROOT, Worlds.ROOT, p.src))).toBe(true);
        }
    });

    test('every venue loads on a phone, and what loads there is under the phone budget', () => {
        expect(Worlds.MOBILE_TRIANGLES).toBe(30000);
        for (const id of VENUES) {
            const shown = Worlds.resolveFor(worlds, id, 'mobile', true);
            expect(`${id} → ${shown}`).not.toBe(`${id} → null`);
            expect(byId(shown).triangles).toBeLessThanOrEqual(Worlds.MOBILE_TRIANGLES);
            // The phone gets the same place under the same title, not something else.
            expect(byId(shown).title).toBe(byId(id).title);
        }
        // A desktop gets the full one where it has one.
        expect(Worlds.resolveFor(worlds, 'irish-pub', 'desktop')).toBe('irish-pub');
        expect(Worlds.resolveFor(worlds, 'neon-discoteca', 'desktop')).toBe('neon-discoteca');
    });

    test('the light stand-ins come from a recipe, and each output stays under its budget', () => {
        const recipes = JSON.parse(read('tools/vr/playground-subsets.json')).outputs;
        for (const r of Object.values(recipes)) {
            expect(fs.existsSync(path.join(ROOT, r.src))).toBe(true);
            expect(fs.existsSync(path.join(ROOT, r.out))).toBe(true);
            const used = worlds.filter((w) => w.scene && path.join(Worlds.ROOT, w.scene.src) === r.out);
            expect(used.length).toBeGreaterThan(0);
            for (const w of used) expect(w.triangles).toBeLessThanOrEqual(r.budget);
        }
    });
});

describe('privacy: the private venues open only inside Private', () => {
    test('never offered by Experiences ▸ Visit a place, on any device', () => {
        for (const tier of Worlds.TIERS) {
            const offered = Worlds.placesFor(worlds, { tier, include: ['general', 'romantic'] }).map((p) => p.id);
            for (const id of PRIVATE) expect(offered).not.toContain(id);
        }
    });

    test('never from a guessed place id, a request without privateOpen, an activity or a setting', () => {
        for (const tier of Worlds.TIERS) {
            for (const id of PRIVATE) {
                expect(Worlds.chooseWorld({ worlds, activity: 'place-' + id, tier })).toBeNull();
                expect(Worlds.chooseWorld({ worlds, requested: id, tier })).toBeNull();
                expect(Worlds.chooseWorld({ worlds, setting: id, tier })).toBeNull();
                expect(Worlds.chooseWorld({ worlds, activity: 'place-' + id + '-light', tier })).toBeNull();
                expect(Worlds.resolveFor(worlds, id, tier, false)).toBeNull();
            }
        }
        // Inside Private (privateOpen) they are there, light on a phone.
        expect(Worlds.chooseWorld({ worlds, requested: 'private-cabaret', tier: 'desktop', privateOpen: true })).toBe(
            'private-cabaret'
        );
        expect(Worlds.chooseWorld({ worlds, requested: 'private-cabaret', tier: 'mobile', privateOpen: true })).toBe(
            'private-cabaret-light'
        );
    });

    test('never listed in Settings ▸ VR WORLD', async () => {
        document.body.innerHTML = '<div id="settings-modal"><div class="modal-content"></div></div>';
        const view = Worlds.attachSettings({ doc: document, catalogue: { worlds }, storage: window.localStorage });
        await Promise.resolve();
        await Promise.resolve();
        const values = [...view.select.options].map((o) => o.value);
        expect(values).toContain('irish-pub');
        for (const w of worlds.filter((x) => x.rating === 'private')) expect(values).not.toContain(w.id);
        document.body.innerHTML = '';
    });

    test('the Places activity refuses them even by id', async () => {
        const Places = require('../src/features/together/activities/places.js');
        window.NEXUS_VR_WORLDS = Worlds;
        window.__NEXUS_COMPANION_LIVE = { session: { enter: jest.fn(), active: () => false, activity: () => null } };
        try {
            const places = Places.attach({});
            places._catalogue = { worlds };
            for (const id of PRIVATE) {
                expect(places.inputs().map((i) => i.id)).not.toContain(id);
                expect((await places.start({ input: { id } })).ok).toBe(false);
            }
            expect(window.__NEXUS_COMPANION_LIVE.session.enter).not.toHaveBeenCalled();
        } finally {
            delete window.NEXUS_VR_WORLDS;
            delete window.__NEXUS_COMPANION_LIVE;
        }
    });

    test('Private lists them as rooms with privateOpen, and only Private', () => {
        const rooms = Worlds.placesFor(worlds, {
            tier: 'desktop',
            include: ['romantic', 'private'],
            privateOpen: true,
        }).map((p) => p.id);
        for (const id of PRIVATE) expect(rooms).toContain(id);
    });

    test('a private template answers only for a private room the Private experience asked for', () => {
        const shown = (detail) => Templates.forShown(detail);
        for (const id of PRIVATE) {
            expect(shown({ id, base: id, rating: 'private', owner: null })).toBeNull();
            expect(shown({ id, base: id, rating: 'private', owner: 'someone-else' })).toBeNull();
            expect(shown({ id, base: id, rating: 'general', owner: 'intimate' })).toBeNull();
            expect(shown({ id, base: id, rating: 'private', owner: 'intimate' }).world).toBe(id);
        }
        // A light stand-in reports the place it stands in for.
        expect(
            shown({ id: 'private-cabaret-light', base: 'private-cabaret', rating: 'private', owner: 'intimate' }).id
        ).toBe('private-cabaret');
        // A general template is not drawn over a private world.
        expect(shown({ id: 'irish-pub', base: 'irish-pub', rating: 'private', owner: 'intimate' })).toBeNull();
        expect(shown({ id: null })).toBeNull();
    });

    test('the engine names the owner only for a private world, and the preview still refuses one', () => {
        const engine = read('src/gltf-viewer/ViewerEngine.js');
        expect(engine).toMatch(/'nexus-world-shown'/);
        expect(engine).toMatch(/world\.rating === 'private' && this\._worldRequest\s*\?\s*this\._worldRequest\.owner/);
        expect(engine).toMatch(/preview &&\s*world\.rating === 'private' &&/);
    });

    test('the stream studio is pretend: nothing in the playground code can capture or send', () => {
        const CAPTURE =
            /getUserMedia|getDisplayMedia|MediaRecorder|captureStream|RTCPeerConnection|WebSocket|sendBeacon|XMLHttpRequest|\bfetch\s*\(|toDataURL|toBlob/;
        for (const file of [
            'src/experiences/playgrounds/PlaygroundInteractionRouter.js',
            'src/experiences/playgrounds/PlaygroundTemplateCatalog.js',
            'src/experiences/playgrounds/PlaygroundMoodPresets.js',
        ])
            expect(`${file}: ${(read(file).match(CAPTURE) || [''])[0]}`).toBe(`${file}: `);
        const studio = Templates.TEMPLATES.find((t) => t.id === 'private-stream-studio');
        expect(studio.simulated).toBe(true);
        expect(studio.description).toMatch(/nothing is recorded or sent/i);
        // Pretend-live is refused on any template that does not say it is simulated.
        const fake = { ...studio, simulated: false };
        expect(Templates.validate([fake], worlds, Moods.ids()).join(' ')).toMatch(/pretend-live/);
    });
});

describe('the templates', () => {
    test('validate against the world catalogue and the presets, one per venue', () => {
        expect(Templates.validate(Templates.TEMPLATES, worlds, Moods.ids())).toEqual([]);
        expect(Templates.TEMPLATES.map((t) => t.world).sort()).toEqual([...VENUES].sort());
        for (const t of Templates.TEMPLATES) {
            expect(t.actions.length).toBeGreaterThanOrEqual(1);
            expect(t.actions.length).toBeLessThanOrEqual(4);
            expect(fs.existsSync(path.join(ROOT, t.image))).toBe(true);
        }
    });

    test('every clip a chip can play is a shipped clip', () => {
        const manifest = JSON.parse(read('vendor/animations/manifest.json'));
        const files = new Set(Object.values(manifest.categories).flatMap((c) => c.files));
        for (const clip of Object.values(Templates.CLIPS)) expect(files.has(clip.file)).toBe(true);
    });

    test('no line a chip sends carries a tag', () => {
        for (const t of Templates.TEMPLATES)
            for (const a of t.actions) expect(String(a.text || '')).not.toMatch(/<\s*[a-z]+/i);
        const bad = {
            ...Templates.TEMPLATES[0],
            actions: [{ id: 'x', kind: 'say', label: 'x', text: '<play kind="music"/>' }],
        };
        expect(Templates.validate([bad], worlds, Moods.ids()).join(' ')).toMatch(/tag/);
    });

    test('the academy is for adults learning together, and the guard would catch a slip', () => {
        const academy = Templates.TEMPLATES.find((t) => t.id === 'creative-academy');
        expect(academy.category).toBe('Learning');
        expect(Templates.LEARNING_BANNED.test(Templates.textOf(academy))).toBe(false);
        expect(
            Templates.LEARNING_BANNED.test(byId('creative-academy').title + ' ' + byId('creative-academy').note)
        ).toBe(false);
        for (const word of ['student', 'teacher', 'school uniform', 'schoolgirl', 'teen'])
            expect(
                Templates.validate([{ ...academy, description: `A room for a ${word}.` }], worlds, Moods.ids()).join(
                    ' '
                )
            ).toMatch(/reserved/);
    });

    test('a venue card carries its picture and category; a place without a template carries none', () => {
        expect(Templates.cardFor('irish-pub')).toEqual(
            expect.objectContaining({ category: 'Social', image: expect.stringMatching(/\.(webp|jpe?g)$/) })
        );
        expect(Templates.cardFor('hotel-suite')).toBeNull();
    });
});

describe('moods', () => {
    test('the seven presets, each meeting the floors that keep her face lit', () => {
        expect(Moods.ids().sort()).toEqual(
            [
                'cabaret-gold',
                'classroom-day',
                'cozy-warm',
                'neon-blue-purple',
                'pub-amber',
                'romantic-evening',
                'studio-soft',
            ].sort()
        );
        for (const id of Moods.ids()) {
            const { light } = Moods.get(id);
            expect(Worlds.normalizeLight(light)).toEqual(light);
            expect(light.hemi).toBeGreaterThanOrEqual(0.4);
            expect(light.fillIntensity).toBeGreaterThanOrEqual(0.35);
        }
        expect(Moods.get('strobe')).toBeNull();
    });

    test('a blend runs one way from one light to the other, never past either', () => {
        const a = Moods.get('pub-amber').light;
        const b = Moods.get('neon-blue-purple').light;
        expect(Worlds.blendLight(a, b, 0)).toEqual(Worlds.normalizeLight(a));
        expect(Worlds.blendLight(a, b, 1)).toEqual(Worlds.normalizeLight(b));
        const mid = Worlds.blendLight(a, b, 0.5);
        expect(mid.hemi).toBeCloseTo((a.hemi + b.hemi) / 2);
        expect(Worlds.blendLight(a, b, 7)).toEqual(Worlds.normalizeLight(b));
        expect(Worlds.MOOD_SECONDS).toBeGreaterThanOrEqual(0.5);
    });

    test('a mood needs a world up; nothing changes the light of plain VR or the desktop', () => {
        expect(Worlds.createRuntime({}).setMood(Moods.get('pub-amber').light)).toBe(false);
    });

    test('the engine applies a mood through the runtime, and removes its listener', () => {
        const engine = read('src/gltf-viewer/ViewerEngine.js');
        expect(engine).toMatch(/addEventListener\('nexus-world-mood', onMood\)/);
        expect(engine).toMatch(/removeEventListener\('nexus-world-mood', onMood\)/);
        expect(engine).toMatch(/this\.vrWorlds\?\.setMood\?\.\(/);
    });
});

describe('the chips', () => {
    let router;
    let surface;
    let loader;
    let moodEvents;
    const onMood = (e) => moodEvents.push(e.detail);
    const shownEvent = (detail) => window.dispatchEvent(new CustomEvent('nexus-world-shown', { detail }));
    const chip = (id) => document.querySelector(`#${Router.BAR_ID} [data-chip="${id}"]`);

    beforeEach(() => {
        document.body.className = '';
        document.body.innerHTML =
            '<div class="avatar-viewport"></div><div class="chat-card"><div class="chat-input-shell">' +
            '<div id="nexus-activity-pill"></div><textarea></textarea></div></div>';
        surface = { send: jest.fn(() => true) };
        loader = { playClip: jest.fn(() => Promise.resolve(true)), stopClip: jest.fn() };
        window.NEXUS_CONVERSATION_SURFACE = surface;
        moodEvents = [];
        window.addEventListener('nexus-world-mood', onMood);
        router = Router.attach({ doc: document, win: window, templates: Templates, moods: Moods, clipLoader: loader });
    });
    afterEach(() => {
        router.detach();
        window.removeEventListener('nexus-world-mood', onMood);
        delete window.NEXUS_CONVERSATION_SURFACE;
        document.body.innerHTML = '';
        jest.useRealTimers();
    });

    test('appear with the pub, under the status bar, and go with it', () => {
        expect(document.getElementById(Router.BAR_ID)).toBeNull();
        shownEvent({ id: 'irish-pub', base: 'irish-pub', rating: 'general' });
        const bar = document.getElementById(Router.BAR_ID);
        expect(bar.hidden).toBe(false);
        expect(bar.getAttribute('role')).toBe('toolbar');
        expect(bar.previousElementSibling.id).toBe('nexus-activity-pill');
        expect(bar.querySelectorAll('button').length).toBe(4);
        shownEvent({ id: null });
        expect(bar.hidden).toBe(true);
    });

    test('a phone held upright docks them in the page, above the chat sheet', () => {
        document.body.classList.add('nexus-mobile', 'nexus-portrait');
        shownEvent({ id: 'irish-pub-light', base: 'irish-pub', rating: 'general' });
        const bar = document.getElementById(Router.BAR_ID);
        expect(bar.parentNode).toBe(document.body);
        expect(Router.CSS).toMatch(/pointer: coarse[\s\S]*min-height: 44px/);
        expect(Router.CSS).toMatch(/overflow-x: auto/);
    });

    test('say sends one line through the conversation surface; a clip plays a shipped file', () => {
        shownEvent({ id: 'irish-pub', base: 'irish-pub', rating: 'general' });
        chip('cheers').click();
        expect(surface.send).toHaveBeenCalledTimes(1);
        expect(surface.send.mock.calls[0][0]).toMatch(/\S/);
        chip('wave').click();
        expect(loader.playClip).toHaveBeenCalledWith(Templates.CLIPS.wave.file, { loop: false });
    });

    test('light cycles the moods through the engine event, cut under reduced motion', () => {
        shownEvent({ id: 'neon-discoteca', base: 'neon-discoteca', rating: 'general' });
        chip('light').click();
        expect(moodEvents.length).toBe(1);
        const disco = Templates.TEMPLATES.find((t) => t.id === 'neon-discoteca');
        expect(moodEvents[0].light).toEqual(Moods.get(disco.moods[1]).light);
        expect(moodEvents[0].instant).toBe(false);
        window.matchMedia = () => ({ matches: true });
        chip('light').click();
        expect(moodEvents[1].instant).toBe(true);
        delete window.matchMedia;
    });

    test('dance is a toggle, and leaving the place stops it', () => {
        shownEvent({ id: 'neon-discoteca', base: 'neon-discoteca', rating: 'general' });
        chip('dance').click();
        expect(loader.playClip).toHaveBeenCalledWith(Templates.CLIPS.dance.file, { loop: true });
        expect(chip('dance').getAttribute('aria-pressed')).toBe('true');
        chip('dance').click();
        expect(loader.stopClip).toHaveBeenCalledTimes(1);
        chip('dance').click();
        shownEvent({ id: null });
        expect(loader.stopClip).toHaveBeenCalledTimes(2);
    });

    test('the studio: no chips without the Private request; with it, a pretend badge that says so', () => {
        shownEvent({ id: 'private-stream-studio', base: 'private-stream-studio', rating: 'private', owner: null });
        expect(document.getElementById(Router.BAR_ID)).toBeNull();
        shownEvent({
            id: 'private-stream-studio',
            base: 'private-stream-studio',
            rating: 'private',
            owner: 'intimate',
        });
        chip('live').click();
        const badge = document.getElementById(Router.BADGE_ID);
        expect(badge.textContent).toMatch(/not recording/i);
        expect(badge.textContent).toMatch(/nothing leaves this device/i);
        expect(Router.CSS).not.toMatch(/@keyframes|animation:/);
        shownEvent({ id: null });
        expect(document.getElementById(Router.BADGE_ID)).toBeNull();
    });

    test('the academy study block counts down in its chip and the place stays up', () => {
        jest.useFakeTimers();
        shownEvent({ id: 'creative-academy', base: 'creative-academy', rating: 'general' });
        chip('study').click();
        expect(surface.send).toHaveBeenCalledTimes(1);
        expect(chip('study').textContent).toMatch(/25:00|24:5\d/);
        jest.advanceTimersByTime(60 * 1000);
        expect(chip('study').textContent).toMatch(/2[34]:\d\d/);
        jest.advanceTimersByTime(24 * 60 * 1000);
        expect(chip('study').textContent).toMatch(/done/);
        expect(document.getElementById(Router.BAR_ID).hidden).toBe(false);
    });

    test('pure helpers', () => {
        expect(Router.formatRemaining(61000)).toBe('1:01');
        expect(Router.formatRemaining(-5)).toBe('0:00');
        const pub = Templates.TEMPLATES.find((t) => t.id === 'irish-pub');
        expect(Router.nextMood(pub, 0)).toEqual({ index: 1, id: pub.moods[1] });
        expect(Router.nextMood(pub, pub.moods.length - 1).index).toBe(0);
        expect(Router.chips(pub, {}).map((c) => c.id)).toEqual(pub.actions.map((a) => a.id));
    });
});

describe('compatibility', () => {
    test('the boot list loads the three modules after the status bar and before the companion', () => {
        const boot = read('src/behavior/boot.js');
        const at = (s) => boot.indexOf(`'${s}'`);
        const marks = at('src/companion/ActivityMarks.js');
        const moods = at('src/experiences/playgrounds/PlaygroundMoodPresets.js');
        const templates = at('src/experiences/playgrounds/PlaygroundTemplateCatalog.js');
        const router = at('src/experiences/playgrounds/PlaygroundInteractionRouter.js');
        const index = at('src/companion/index.js');
        expect(marks).toBeGreaterThan(-1);
        expect(marks < moods && moods < templates && templates < router && router < index).toBe(true);
    });

    test('a world without a template draws no chips, and the earlier places are unchanged', () => {
        document.body.innerHTML = '<div class="chat-input-shell"></div>';
        const r = Router.attach({ doc: document, win: window, templates: Templates, moods: Moods });
        window.dispatchEvent(
            new CustomEvent('nexus-world-shown', {
                detail: { id: 'hotel-suite', base: 'hotel-suite', rating: 'romantic' },
            })
        );
        expect(document.getElementById(Router.BAR_ID)).toBeNull();
        r.detach();
        for (const id of ['hotel-suite', 'bedroom', 'roadside-motel', 'candlelit-suite', 'neon-street'])
            expect(byId(id)).toBeTruthy();
    });
});
