/**
 * PP1. What each private room is for: the room exists as a private place, its show is one she
 * knows, the invitation follows the pace, and every language has her lines.
 */
const Scripts = require('../src/experiences/private/PrivatePlaceScripts.js');
const Routines = require('../src/experiences/private/PrivateRoutines.js');
const Policy = require('../src/experiences/private/PrivateActionPolicy.js');
const Locale = require('../src/features/together/PrivateLocale.js');
const worlds = require('../assets/vr-worlds/worlds.json').worlds;

const offer = (id, level, offered) =>
    Scripts.showToOffer(Scripts.PLACES[id], { level, routines: Routines, poseLevel: Policy.poseLevel, offered });

describe('PP1 room scripts', () => {
    test('each script is a private place, and its shows are shows she knows', () => {
        for (const script of Object.values(Scripts.PLACES)) {
            const w = worlds.find((x) => x.id === script.id);
            expect(w && w.place && w.rating).toBe('private');
            for (const show of script.shows) expect(Routines.ROUTINES[show]).toBeTruthy();
            expect(Scripts.promptLines(script)[0]).toMatch(/^THIS ROOM: /);
        }
        expect(Scripts.forWorld('candlelit-suite')).toBeNull();
        expect(Scripts.promptLines(null)).toEqual([]);
    });

    test('the best show the pace has opened, once; a lower ceiling falls back', () => {
        expect(offer('strip-stage', 1)).toBeNull();
        // A Sensual evening (ceiling 3) never opens the striptease: she offers to tease instead.
        expect(offer('strip-stage', 3)).toBe('tease');
        expect(offer('strip-stage', 4)).toBe('striptease');
        expect(offer('strip-stage', 4, ['striptease'])).toBeNull();
        expect(offer('dance-lounge', Routines.level('table-dance', Policy.poseLevel))).toBe('table-dance');
    });

    test('her opening, each invitation and "not yet" exist in every language', () => {
        const keys = ['place.notyet', 'place.deal.ok'];
        for (const script of Object.values(Scripts.PLACES)) {
            keys.push(`place.${script.id}.opening`);
            for (const deal of script.deals || []) keys.push(`place.deal.${deal}`);
        }
        for (const show of new Set(Object.values(Scripts.PLACES).flatMap((p) => p.shows)))
            keys.push(`place.invite.${show}`);
        for (const lang of Locale.languages()) for (const key of keys) expect(Locale.t(key, null, lang)).not.toBe(key);
    });

    test('WR1: the deal at the door decides what she invites them to, and the prompt says it', () => {
        const room = Scripts.PLACES['window-room'];
        const evening = Routines.level('window-evening', Policy.poseLevel);
        expect(evening).toBe(4);
        // Their choice first; only gentler ones after it, never a bolder one they did not choose.
        expect(
            Scripts.showToOffer(room, {
                level: 4,
                routines: Routines,
                poseLevel: Policy.poseLevel,
                wish: 'window-evening',
            })
        ).toBe('window-evening');
        expect(
            Scripts.showToOffer(room, { level: 4, routines: Routines, poseLevel: Policy.poseLevel, wish: 'tease' })
        ).toBe('tease');
        expect(
            Scripts.showToOffer(room, {
                level: 4,
                routines: Routines,
                poseLevel: Policy.poseLevel,
                wish: 'tease',
                offered: ['tease'],
            })
        ).toBeNull();
        for (const deal of room.deals) expect(room.shows).toContain(deal);
        const lines = Scripts.promptLines(room, Routines.ROUTINES['window-evening'].name).join('\n');
        expect(lines).toMatch(/^THIS ROOM: .*over 25.*by your own choice/);
        expect(lines).toMatch(/never real money/);
        expect(lines).toMatch(/TONIGHT'S DEAL: they chose the whole evening/);
    });

    test('WR1: the evening asks where to finish, and never finishes on its own', () => {
        const steps = Routines.ROUTINES['window-evening'].steps;
        expect(steps.filter((x) => x.undress).length).toBeGreaterThanOrEqual(1);
        expect(steps[steps.length - 1].body).toMatch(/asking them where they want to finish/);
        expect(steps.some((x) => x.finish)).toBe(false);
    });
});
