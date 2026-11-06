/**
 * VW3. New spaces — a hotel suite, a bedroom, a beach, an office, steampunk and cyberpunk
 * places, and the private rooms (a motel, a candlelit suite) for the Private experience.
 *
 * The rules that matter are about who may see what: a private room is never offered or loaded
 * outside Private, Experiences offers only general and romantic places, and a phone gets each
 * place's light stand-in or nothing.
 */
const fs = require('fs');
const path = require('path');
const Worlds = require('../src/gltf-viewer/VRWorlds.js');

const ROOT = path.join(__dirname, '..');
const { worlds, problems } = Worlds.validateCatalogue(
    JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/vr-worlds/worlds.json'), 'utf8'))
);

describe('the new spaces', () => {
    test('they are in the catalogue, valid, and each file is in the repository', () => {
        expect(problems).toEqual([]);
        const ids = worlds.filter((w) => w.place).map((w) => w.id);
        for (const id of [
            'hotel-suite',
            'bedroom',
            'lagoon-beach',
            'office',
            'airship-dock',
            'neon-street',
            'roadside-motel',
            'candlelit-suite',
        ])
            expect(ids).toContain(id);
        for (const w of worlds.filter((x) => x.scene))
            expect(fs.existsSync(path.join(ROOT, Worlds.ROOT, w.scene.src))).toBe(true);
    });

    test('the motel and the candlelit suite are private; nothing else is', () => {
        const priv = worlds
            .filter((w) => w.rating === 'private' && !w.lightFor)
            .map((w) => w.id)
            .sort();
        expect(priv).toEqual(['candlelit-suite', 'roadside-motel']);
        // A light stand-in is rated like the world it stands in for.
        for (const w of worlds.filter((x) => x.lightFor)) {
            const heavy = worlds.find((x) => x.id === w.lightFor);
            expect(`${w.id}: ${w.rating}`).toBe(`${w.id}: ${heavy.rating}`);
        }
    });
});

describe('who may see what', () => {
    test('Experiences ▸ Visit a place never offers a private room, on any device', () => {
        for (const tier of Worlds.TIERS) {
            const offered = Worlds.placesFor(worlds, { tier, include: ['general', 'romantic'] });
            expect(offered.length).toBeGreaterThan(0);
            for (const p of offered) expect(p.rating).not.toBe('private');
        }
    });

    test('Private offers its rooms; without privateOpen they resolve to nothing', () => {
        const inPrivate = Worlds.placesFor(worlds, {
            tier: 'desktop',
            include: ['romantic', 'private'],
            privateOpen: true,
        });
        expect(inPrivate.map((p) => p.id)).toEqual(
            expect.arrayContaining(['roadside-motel', 'candlelit-suite', 'hotel-suite'])
        );
        expect(Worlds.resolveFor(worlds, 'roadside-motel', 'desktop', false)).toBeNull();
        expect(Worlds.chooseWorld({ worlds, requested: 'roadside-motel', tier: 'desktop' })).toBeNull();
        expect(Worlds.chooseWorld({ worlds, requested: 'roadside-motel', tier: 'desktop', privateOpen: true })).toBe(
            'roadside-motel'
        );
        // And a place by activity name cannot open a private room either.
        expect(Worlds.chooseWorld({ worlds, activity: 'place-candlelit-suite', tier: 'desktop' })).toBeNull();
    });

    test('no activity mapping and no Settings choice ever brings a private room', () => {
        for (const tier of Worlds.TIERS) {
            for (const w of worlds) {
                for (const a of w.activities) {
                    const chosen = worlds.find((x) => x.id === Worlds.chooseWorld({ worlds, activity: a, tier }));
                    if (chosen) expect(chosen.rating).not.toBe('private');
                }
            }
            expect(Worlds.chooseWorld({ worlds, setting: 'roadside-motel', tier })).toBeNull();
        }
    });

    test('a phone gets each place light, or not at all', () => {
        const offered = Worlds.placesFor(worlds, {
            tier: 'mobile',
            include: ['general', 'romantic', 'private'],
            privateOpen: true,
        });
        for (const p of offered) {
            const shown = worlds.find((w) => w.id === p.world);
            expect(shown.triangles).toBeLessThanOrEqual(Worlds.MOBILE_TRIANGLES);
        }
        expect(Worlds.resolveFor(worlds, 'hotel-suite', 'mobile')).toBe('hotel-suite'); // built light everywhere
        expect(Worlds.resolveFor(worlds, 'bedroom', 'mobile')).toBe('bedroom-light');
        expect(Worlds.resolveFor(worlds, 'airship-dock', 'mobile')).toBeNull(); // 141K, no light stand-in
        expect(Worlds.resolveFor(worlds, 'neon-street', 'mobile')).toBe('neon-street'); // 16K
        // One card per place- a stand-in is never listed beside its original.
        expect(offered.some((p) => p.id.endsWith('-light'))).toBe(false);
    });
});

describe('the Places activity', () => {
    const Places = require('../src/features/together/activities/places.js');
    beforeEach(() => {
        window.NEXUS_VR_WORLDS = Worlds;
        const entered = [];
        window.__NEXUS_COMPANION_LIVE = {
            session: {
                entered,
                enter: (d, a, o) => entered.push([d, a, o && o.source]),
                active: () => entered.length > 0,
                activity: () => (entered.length ? entered[entered.length - 1][1] : null),
                end: jest.fn(),
            },
        };
    });
    afterEach(() => {
        delete window.NEXUS_VR_WORLDS;
        delete window.__NEXUS_COMPANION_LIVE;
    });

    test('hidden from the first screen, offers the places, starts one through the companion session', async () => {
        const places = Places.attach({});
        places._catalogue = { worlds };
        expect(places.hidden).toBe(true);
        const inputs = places.inputs();
        expect(inputs.map((i) => i.id)).toContain('hotel-suite');
        expect(inputs.map((i) => i.id)).not.toContain('roadside-motel');
        const r = await places.start({ input: { id: 'hotel-suite' } });
        expect(r.ok).toBe(true);
        expect(window.__NEXUS_COMPANION_LIVE.session.entered[0]).toEqual([
            'experiences',
            'place-hotel-suite',
            'together',
        ]);
        expect(places.status().label).toBe('Hotel suite');
        places.stop();
        expect(window.__NEXUS_COMPANION_LIVE.session.end).toHaveBeenCalled();
    });

    test('a private room cannot be started from here even by id', async () => {
        const places = Places.attach({});
        places._catalogue = { worlds };
        const r = await places.start({ input: { id: 'roadside-motel' } });
        expect(r.ok).toBe(false);
    });

    test('the place reads well in the status bar and counts as an activity with an end', () => {
        const Intent = require('../src/companion/ContextIntent');
        const Marks = require('../src/companion/ActivityMarks');
        expect(Intent.label('place-hotel-suite')).toBe('Hotel suite');
        expect(Marks.isExplicit('place-lagoon-beach')).toBe(true);
        expect(Marks.isExplicit('talk')).toBe(false);
    });
});

describe('Private asks for its room only after its gates', () => {
    test('the request is sent from start() after the consent flow entered, and withdrawn on stop()', () => {
        const src = fs.readFileSync(path.join(ROOT, 'src/features/together/activities/playground.js'), 'utf8');
        const start = src.slice(
            src.indexOf('this.adult.enter();'),
            src.indexOf("stop(why = 'user') {", src.indexOf('this.adult.enter();'))
        );
        expect(start).toMatch(/if \(this\.worldChoice\) this\._requestWorld\(this\.worldChoice\)/);
        expect(src).toMatch(/if \(wasActive\) this\._requestWorld\(null\)/);
        // The engine grants privateOpen only to the Private experience's own requests.
        const engine = fs.readFileSync(path.join(ROOT, 'src/gltf-viewer/ViewerEngine.js'), 'utf8');
        expect(engine).toMatch(/privateOpen: !!\(this\._worldRequest && this\._worldRequest\.owner === 'intimate'\)/);
    });
});
