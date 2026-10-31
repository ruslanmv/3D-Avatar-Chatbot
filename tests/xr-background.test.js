/**
 * XP1 — what `vr-session-start` does to the viewport, by device and session kind.
 *
 * The rule: a Meta Quest AR session gets passthrough the way mixed reality expects it —
 * nothing painted, no VR floor grid, no viewpoint offset. Quest VR and phone AR keep
 * exactly what they had, because the person said both are fine as they are.
 */

const XB = require('../src/gltf-viewer/XRBackground.js');

const UA = {
    quest3:
        'Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'OculusBrowser/35.3.0.0 SamsungBrowser/4.0 Chrome/126.0.6478.122 VR Safari/537.36',
    androidPhone:
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/126.0.0.0 Mobile Safari/537.36',
};

/** The mapping the handler used before XP1, written out so a drift from it fails here. */
function legacy(value) {
    return { color: value === 'blue' ? 0x1a1a2e : 0x000000, ground: value !== 'void' };
}

const VALUES = ['black', 'blue', 'void', 'passthrough'];

test('recognises a Quest browser, and not a phone', () => {
    expect(XB.isQuestUA(UA.quest3)).toBe(true);
    expect(XB.isQuestUA(UA.androidPhone)).toBe(false);
    expect(XB.isQuestUA(undefined)).toBe(false);
});

describe('Quest AR — passthrough', () => {
    test.each(VALUES)('BG %s: nothing is painted and no grid goes down', (value) => {
        expect(XB.sessionStartBackground({ value, isAR: true, isQuest: true })).toBeNull();
    });

    test('no eye-level offset: content stays registered to the real floor', () => {
        expect(XB.eyeLevelBoost({ isAR: true, isQuest: true })).toBe(0);
    });
});

describe('Quest VR — unchanged, black by default', () => {
    test.each(VALUES)('BG %s: the colour and grid it always got', (value) => {
        expect(XB.sessionStartBackground({ value, isAR: false, isQuest: true })).toEqual(legacy(value));
    });

    test('default is black with the floor grid', () => {
        expect(XB.sessionStartBackground({ isAR: false, isQuest: true })).toEqual({ color: 0x000000, ground: true });
    });

    test('keeps the +0.15 m eye-level boost', () => {
        expect(XB.eyeLevelBoost({ isAR: false, isQuest: true })).toBe(0.15);
    });
});

describe('phone AR — unchanged', () => {
    test.each(VALUES)('BG %s: exactly the old behaviour', (value) => {
        expect(XB.sessionStartBackground({ value, isAR: true, isQuest: false })).toEqual(legacy(value));
    });

    test('keeps the eye-level boost it had', () => {
        expect(XB.eyeLevelBoost({ isAR: true, isQuest: false })).toBe(0.15);
    });
});

test('no context at all behaves like today (black, grid, boost)', () => {
    expect(XB.sessionStartBackground()).toEqual({ color: 0x000000, ground: true });
    expect(XB.eyeLevelBoost()).toBe(0.15);
});
