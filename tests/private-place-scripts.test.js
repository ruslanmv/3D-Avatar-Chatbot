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
        const keys = ['place.strip-stage.opening', 'place.dance-lounge.opening', 'place.notyet'];
        for (const show of new Set(Object.values(Scripts.PLACES).flatMap((p) => p.shows)))
            keys.push(`place.invite.${show}`);
        for (const lang of Locale.languages()) for (const key of keys) expect(Locale.t(key, null, lang)).not.toBe(key);
    });
});
