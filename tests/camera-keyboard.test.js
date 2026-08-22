'use strict';

/**
 * Keyboard camera control.
 *
 * The mouse already orbits and dollies. These pin the keyboard half: the key
 * MAPPING (which keys we claim, and — more importantly — which we refuse), and
 * the dolly ARITHMETIC, which is the part that decides whether zoom feels right.
 */

/* global describe, test, expect, beforeAll, afterEach */

const CF = require('../src/gltf-viewer/CameraFraming');

let CK;

beforeAll(() => {
    global.window = global.window || {};
    window.NEXUS_CAMERA_FRAMING = CF;
    require('../src/gltf-viewer/CameraKeyboard.js');
    CK = window.NEXUS_CAMERA_KEYBOARD;
});

afterEach(() => {
    const el = document.getElementById('poseStudioRoot');
    if (el) el.remove();
});

const key = (k, extra) => CK.routeKey(Object.assign({ key: k }, extra));

describe('zoom must be MULTIPLICATIVE, not additive', () => {
    // A fixed subtraction crawls when far and slams into the model when near;
    // the same metre covers wildly different angular amounts at each range.
    test('one press moves the same PROPORTION at any distance', () => {
        const near = CF.dollyStep({ distance: 2, direction: 1 });
        const far = CF.dollyStep({ distance: 20, direction: 1 });
        expect(near / 2).toBeCloseTo(far / 20, 10);
    });

    test('and never the same absolute amount', () => {
        const nearDelta = 2 - CF.dollyStep({ distance: 2, direction: 1 });
        const farDelta = 20 - CF.dollyStep({ distance: 20, direction: 1 });
        expect(farDelta).toBeGreaterThan(nearDelta * 5);
    });

    test('in brings the camera closer, out pushes it away', () => {
        expect(CF.dollyStep({ distance: 5, direction: 1 })).toBeLessThan(5);
        expect(CF.dollyStep({ distance: 5, direction: -1 })).toBeGreaterThan(5);
    });

    test('in then out returns to where it started', () => {
        const inOnce = CF.dollyStep({ distance: 5, direction: 1 });
        expect(CF.dollyStep({ distance: inOnce, direction: -1 })).toBeCloseTo(5, 10);
    });

    test('Shift is a finer step, in both directions', () => {
        const coarse = 5 - CF.dollyStep({ distance: 5, direction: 1 });
        const fine = 5 - CF.dollyStep({ distance: 5, direction: 1, fine: true });
        expect(fine).toBeGreaterThan(0);
        expect(fine).toBeLessThan(coarse);
    });
});

describe('the OrbitControls clamps hold', () => {
    test('zooming in stops at minDistance', () => {
        const out = CF.dollyStep({ distance: 0.52, direction: 1, minDistance: 0.5, maxDistance: 25 });
        expect(out === null || out >= 0.5).toBe(true);
    });

    test('zooming out stops at maxDistance', () => {
        const out = CF.dollyStep({ distance: 24.9, direction: -1, minDistance: 0.5, maxDistance: 25 });
        expect(out === null || out <= 25).toBe(true);
    });

    test('already against the clamp reports no movement rather than churning', () => {
        expect(CF.dollyStep({ distance: 0.5, direction: 1, minDistance: 0.5, maxDistance: 25 })).toBeNull();
        expect(CF.dollyStep({ distance: 25, direction: -1, minDistance: 0.5, maxDistance: 25 })).toBeNull();
    });

    test('nonsense input returns null rather than a bad distance', () => {
        expect(CF.dollyStep(null)).toBeNull();
        expect(CF.dollyStep({ distance: 0, direction: 1 })).toBeNull();
        expect(CF.dollyStep({ distance: 5, direction: 0 })).toBeNull();
    });
});

describe('pan must scale with distance, for the same reason zoom is a ratio', () => {
    // A fixed number of world units is a huge jump when the camera is close to
    // her face and an imperceptible nudge when it is backed off to see the whole
    // body. Expressing the step as a fraction of the VISIBLE FRAME makes one
    // press feel identical at every zoom level.
    const FOV = 50;

    test('a press covers the same FRACTION of the frame at any distance', () => {
        const visible = (d) => 2 * d * Math.tan((FOV * Math.PI) / 180 / 2);
        const near = CF.panStep({ distance: 2, fovDeg: FOV });
        const far = CF.panStep({ distance: 20, fovDeg: FOV });
        expect(near / visible(2)).toBeCloseTo(far / visible(20), 10);
    });

    test('so the absolute step grows with distance', () => {
        expect(CF.panStep({ distance: 20, fovDeg: FOV })).toBeGreaterThan(CF.panStep({ distance: 2, fovDeg: FOV }) * 5);
    });

    test('Shift pans a smaller amount, matching Shift on zoom', () => {
        const coarse = CF.panStep({ distance: 5, fovDeg: FOV });
        const fine = CF.panStep({ distance: 5, fovDeg: FOV, fine: true });
        expect(fine).toBeGreaterThan(0);
        expect(fine).toBeLessThan(coarse);
    });

    test('a wider lens sees more, so one press travels further', () => {
        expect(CF.panStep({ distance: 5, fovDeg: 80 })).toBeGreaterThan(CF.panStep({ distance: 5, fovDeg: 30 }));
    });

    test('nonsense input yields 0 rather than NaN', () => {
        expect(CF.panStep(null)).toBe(0);
        expect(CF.panStep({ distance: 0, fovDeg: FOV })).toBe(0);
        expect(CF.panStep({ distance: 5, fovDeg: 0 })).toBe(0);
        expect(CF.panStep({ distance: 5, fovDeg: FOV, fraction: 0 })).toBe(0);
    });
});

describe('the keys we claim', () => {
    test('every form of plus zooms in — they are physically different keys', () => {
        expect(key('+')).toBe('zoom_in');
        expect(key('=')).toBe('zoom_in'); // unshifted plus
        expect(CK.routeKey({ key: 'Unidentified', code: 'NumpadAdd' })).toBe('zoom_in');
    });

    test('and every form of minus zooms out', () => {
        expect(key('-')).toBe('zoom_out');
        expect(key('_')).toBe('zoom_out');
        expect(CK.routeKey({ key: 'Unidentified', code: 'NumpadSubtract' })).toBe('zoom_out');
    });

    test('1/2/3 are the character-creator framings, ordered by closeness', () => {
        expect(key('1')).toBe('preset:fullBody');
        expect(key('2')).toBe('preset:bust');
        expect(key('3')).toBe('preset:face');
    });

    test('0 resets, matching the browser and Blender reflex', () => {
        expect(key('0')).toBe('reset');
    });

    test('the arrows orbit around her', () => {
        expect(key('ArrowUp')).toBe('pitch_up');
        expect(key('ArrowDown')).toBe('pitch_down');
        expect(key('ArrowLeft')).toBe('yaw_left');
        expect(key('ArrowRight')).toBe('yaw_right');
    });

    test('Shift + arrow slides the frame instead of rotating it', () => {
        // Orbit and pan answer different questions: orbit is "show me the other
        // side", pan is "the boots are not centred". Reaching an off-centre
        // detail by orbiting would cost the angle the user chose.
        expect(key('ArrowLeft', { shiftKey: true })).toBe('pan_left');
        expect(key('ArrowRight', { shiftKey: true })).toBe('pan_right');
        expect(key('ArrowUp', { shiftKey: true })).toBe('pan_up');
        expect(key('ArrowDown', { shiftKey: true })).toBe('pan_down');
    });
});

describe('the keys we refuse — this is the important half', () => {
    test('Ctrl/Cmd +/- is the browser page zoom and must pass through', () => {
        for (const mod of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
            expect(key('+', mod)).toBeNull();
            expect(key('-', mod)).toBeNull();
            expect(key('1', mod)).toBeNull();
        }
    });

    test('nothing fires while typing — the chat box is the usual focus', () => {
        for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
            expect(key('-', { target: { tagName } })).toBeNull();
            expect(key('1', { target: { tagName } })).toBeNull();
        }
        expect(key('0', { target: { tagName: 'DIV', isContentEditable: true } })).toBeNull();
    });

    test('a normal element does not count as typing', () => {
        expect(key('+', { target: { tagName: 'BODY' } })).toBe('zoom_in');
    });

    test('W and S are NOT bound — a bare letter beside a chat box is a trap', () => {
        for (const k of ['w', 'W', 's', 'S', 'a', 'd', 'q', 'e']) expect(key(k)).toBeNull();
    });

    test('unmapped digits and keys are ignored', () => {
        for (const k of ['4', '5', '9', 'Enter', 'Escape', 'Tab', ' ']) expect(key(k)).toBeNull();
    });
});

describe('Pose Studio keeps the arrows while it is open', () => {
    const openPoseStudio = (hidden) => {
        const el = document.createElement('div');
        el.id = 'poseStudioRoot';
        if (hidden) el.classList.add('hidden');
        document.body.appendChild(el);
    };

    test('open — only the HORIZONTAL arrows are released to it', () => {
        openPoseStudio(false);
        expect(key('ArrowLeft')).toBeNull();
        expect(key('ArrowRight')).toBeNull();
    });

    test('open — the vertical arrows keep orbiting, since it never claims them', () => {
        openPoseStudio(false);
        expect(key('ArrowUp')).toBe('pitch_up');
        expect(key('ArrowDown')).toBe('pitch_down');
    });

    test('open — Shift-pan is released horizontally too, so the pair stays consistent', () => {
        openPoseStudio(false);
        expect(key('ArrowLeft', { shiftKey: true })).toBeNull();
        expect(key('ArrowUp', { shiftKey: true })).toBe('pan_up');
    });

    test('but zoom and the framings still work while it is open', () => {
        openPoseStudio(false);
        expect(key('+')).toBe('zoom_in');
        expect(key('2')).toBe('preset:bust');
    });

    test('hidden — the horizontal arrows come back', () => {
        openPoseStudio(true);
        expect(key('ArrowLeft')).toBe('yaw_left');
        expect(key('ArrowUp')).toBe('pitch_up');
    });

    test('absent — every arrow works', () => {
        expect(key('ArrowLeft')).toBe('yaw_left');
        expect(key('ArrowUp')).toBe('pitch_up');
    });
});

describe('acting without a viewer never throws', () => {
    test('every action degrades to false', () => {
        const all = [
            'zoom_in',
            'zoom_out',
            'reset',
            'pitch_up',
            'pitch_down',
            'yaw_left',
            'yaw_right',
            'pan_left',
            'pan_right',
            'pan_up',
            'pan_down',
            'preset:face',
        ];
        for (const a of all) {
            expect(() => CK.runAction(a, false)).not.toThrow();
            expect(CK.runAction(a, false)).toBe(false);
        }
    });

    test('an unknown action is a no-op', () => {
        expect(CK.runAction('nonsense', false)).toBe(false);
        expect(CK.runAction(null, false)).toBe(false);
    });
});
