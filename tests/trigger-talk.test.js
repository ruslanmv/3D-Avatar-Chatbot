/**
 * VR2 — hold the right trigger to talk; let go to send.
 *
 * Pinned: the trigger on a visible panel button is still a click and never records; off the panel
 * the right controller's trigger starts one recording and its release ends it; phone AR taps, Quest
 * AR sessions, hand-tracking pinches and the left trigger never record; trigger + B share one
 * recording; a hidden panel's buttons no longer catch the trigger; leaving VR mid-hold stops it.
 */

const fs = require('fs');
const path = require('path');
const THREE = require('../vendor/three-0.147.0/build/three.min.js');
const TT = require('../src/gltf-viewer/TriggerTalk.js');

const pad = (o) => Object.assign({ handedness: 'right', targetRayMode: 'tracked-pointer', gamepad: {} }, o);

describe('which trigger press may mean "talk"', () => {
    test('the right controller in VR', () => {
        expect(TT.isTalkTrigger(pad(), 'opaque')).toBe(true);
        expect(TT.isTalkTrigger(pad(), undefined)).toBe(true);
    });

    test('never phone AR, a Quest AR session, a hand pinch, the left hand or a gamepad-less source', () => {
        expect(TT.isTalkTrigger(pad({ targetRayMode: 'screen', handedness: 'none' }), 'alpha-blend')).toBe(false);
        expect(TT.isTalkTrigger(pad(), 'alpha-blend')).toBe(false);
        expect(TT.isTalkTrigger(pad(), 'additive')).toBe(false);
        expect(TT.isTalkTrigger(pad({ hand: {} }), 'opaque')).toBe(false);
        expect(TT.isTalkTrigger(pad({ handedness: 'left' }), 'opaque')).toBe(false);
        expect(TT.isTalkTrigger(pad({ gamepad: null }), 'opaque')).toBe(false);
        expect(TT.isTalkTrigger(null, 'opaque')).toBe(false);
    });
});

describe('a hidden panel catches nothing', () => {
    test('the first hit you can see wins; hidden objects and hidden parents are skipped', () => {
        const panel = new THREE.Group();
        const hiddenBtn = new THREE.Object3D();
        panel.add(hiddenBtn);
        panel.visible = false;
        const shownBtn = new THREE.Object3D();
        expect(TT.firstVisibleHit([{ object: hiddenBtn }, { object: shownBtn }]).object).toBe(shownBtn);
        expect(TT.firstVisibleHit([{ object: hiddenBtn }])).toBeNull();
        expect(TT.firstVisibleHit([])).toBeNull();
    });
});

describe('one recording, whatever holds it', () => {
    test('the first hold starts it, the last release ends it', () => {
        const h = TT.createHolders();
        expect(h.press('trigger')).toBe(true);
        expect(h.press('B')).toBe(false); // already recording
        expect(h.release('trigger')).toBe(false); // B still held
        expect(h.release('B')).toBe(true);
        expect(h.release('B')).toBe(false); // releasing twice ends nothing
    });
});

describe('VRControllers, run for real', () => {
    const src = fs
        .readFileSync(path.resolve(__dirname, '../src/gltf-viewer/VRControllers.js'), 'utf-8')
        .replace(/^import .*$/gm, '')
        .replace(/^export class VRControllers/m, 'class VRControllers');
    // eslint-disable-next-line no-new-func
    const VRControllers = new Function('THREE', `${src}\nreturn VRControllers;`)(THREE);

    function controllers({ blend = 'opaque', panelVisible = true } = {}) {
        const c = Object.create(VRControllers.prototype);
        c.tempMatrix = new THREE.Matrix4();
        c.raycaster = new THREE.Raycaster();
        c._talk = TT.createHolders();
        c.controllers = { left: null, right: { gamepad: { hapticActuators: [{ pulse: jest.fn() }] } } };
        c.renderer = { xr: { getSession: () => ({ environmentBlendMode: blend }) } };
        // A panel button straight ahead of the controller, 1 m away.
        const panel = new THREE.Group();
        panel.visible = panelVisible;
        const button = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), new THREE.MeshBasicMaterial());
        button.name = 'Btn:mic';
        button.position.set(0, 0, -1);
        panel.add(button);
        panel.updateMatrixWorld(true);
        c._activeUIInteractables = [button];
        c.onUIButtonClick = jest.fn();
        c.onPushToTalkStart = jest.fn();
        c.onPushToTalkEnd = jest.fn();
        return c;
    }
    const aimedAtPanel = () => new THREE.Object3D(); // at the origin, looking down -Z
    const aimedAway = () => {
        const o = new THREE.Object3D();
        o.rotation.y = Math.PI / 2; // looking along -X: the panel is off to the side
        o.updateMatrixWorld(true);
        return o;
    };

    test('on a visible panel button the trigger clicks, and records nothing', () => {
        const c = controllers();
        c._onTriggerDown(aimedAtPanel(), 'right', pad());
        c._onTriggerUp(aimedAtPanel(), 'right', pad());
        expect(c.onUIButtonClick).toHaveBeenCalledWith('Btn:mic', expect.anything(), expect.anything());
        expect(c.onPushToTalkStart).not.toHaveBeenCalled();
        expect(c.onPushToTalkEnd).not.toHaveBeenCalled();
    });

    test('off the panel: press starts recording, release sends — with a buzz at each edge', () => {
        const c = controllers();
        c._onTriggerDown(aimedAway(), 'right', pad());
        expect(c.onPushToTalkStart).toHaveBeenCalledTimes(1);
        c._onTriggerUp(aimedAway(), 'right', pad());
        expect(c.onPushToTalkEnd).toHaveBeenCalledTimes(1);
        expect(c.controllers.right.gamepad.hapticActuators[0].pulse).toHaveBeenCalledTimes(2);
    });

    test('aimed where the HIDDEN panel is: not a ghost click — it talks', () => {
        const c = controllers({ panelVisible: false });
        c._onTriggerDown(aimedAtPanel(), 'right', pad());
        expect(c.onUIButtonClick).not.toHaveBeenCalled();
        expect(c.onPushToTalkStart).toHaveBeenCalledTimes(1);
    });

    test('in an AR session the trigger never records', () => {
        const c = controllers({ blend: 'alpha-blend' });
        c._onTriggerDown(aimedAway(), 'right', pad());
        c._onTriggerUp(aimedAway(), 'right', pad());
        expect(c.onPushToTalkStart).not.toHaveBeenCalled();
        expect(c.onPushToTalkEnd).not.toHaveBeenCalled();
    });

    test('trigger and B together are one recording', () => {
        const c = controllers();
        c._onTriggerDown(aimedAway(), 'right', pad());
        c._talkPress('B', 'right');
        c._onTriggerUp(aimedAway(), 'right', pad());
        expect(c.onPushToTalkEnd).not.toHaveBeenCalled();
        c._talkRelease('B', 'right');
        expect(c.onPushToTalkStart).toHaveBeenCalledTimes(1);
        expect(c.onPushToTalkEnd).toHaveBeenCalledTimes(1);
    });

    test('leaving VR while holding the trigger stops the recording', () => {
        const c = controllers();
        c.playerRig = new THREE.Group();
        c._onTriggerDown(aimedAway(), 'right', pad());
        jest.spyOn(console, 'log').mockImplementation(() => {});
        c.setEnabled(false);
        console.log.mockRestore();
        expect(c.onPushToTalkEnd).toHaveBeenCalledTimes(1);
    });
});
