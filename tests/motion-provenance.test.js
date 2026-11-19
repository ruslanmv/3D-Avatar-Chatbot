/**
 * MP1. Every motion Claude created is in the registry, tagged by how it was made, and each method
 * can be switched off without deleting anything. Properties: a renamed preset or a reworded
 * description must not fail these; an unregistered clip, a registry entry pointing at nothing, or
 * a switch that does not reach Pose Studio, the shows or the living layer, must.
 */
const fs = require('fs');
const path = require('path');
const MP = require('../src/gltf-viewer/MotionProvenance.js');
const Routines = require('../src/experiences/private/PrivateRoutines.js');
const Living = require('../src/experiences/private/PrivateLivingMotion.js');

const ROOT = path.join(__dirname, '..');

beforeEach(() => {
    localStorage.clear();
    window.NEXUS_MOTION_PROVENANCE = MP;
});
afterEach(() => {
    delete window.NEXUS_MOTION_PROVENANCE;
    delete window.NEXUS_PRIVATE_POSES;
    localStorage.clear();
});

describe('MP1 the registry is true to the tree', () => {
    test('every item has a known method, a batch, what it is, files that exist and how to remove it', () => {
        expect(MP.ITEMS.length).toBeGreaterThan(10);
        for (const item of MP.ITEMS) {
            expect(MP.METHODS[item.method]).toBeTruthy();
            expect(item.batch).toBeTruthy();
            expect(item.what.length).toBeGreaterThan(10);
            expect(item.remove.length).toBeGreaterThan(20);
            for (const f of item.files) expect(fs.existsSync(path.join(ROOT, f))).toBe(true);
        }
        expect(new Set(MP.ITEMS.map((i) => i.id)).size).toBe(MP.ITEMS.length);
    });

    test('every CC0 clip shipped is registered as converted, and every registered clip ships', () => {
        const shipped = fs
            .readdirSync(path.join(ROOT, 'addons/vrma-cc0'))
            .filter((f) => f.endsWith('.vrma'))
            .map((f) => `addons/vrma-cc0/${f}`);
        const registered = MP.ITEMS.filter((i) => i.method === 'converted-cc0-clip').map((i) => i.name);
        expect(registered.sort()).toEqual(shipped.sort());
    });

    test('every show the app offers is registered as composed, and nothing else is', () => {
        const shows = MP.ITEMS.filter((i) => i.method === 'composed-show').map((i) => i.name);
        expect(shows.sort()).toEqual([...Routines.ORDER].sort());
    });

    test('every registered preset exists in the pose system and in Pose Studio', () => {
        const poses = fs.readFileSync(path.join(ROOT, 'src/gltf-viewer/VRPoseSystem.js'), 'utf8');
        const panel = fs.readFileSync(path.join(ROOT, 'src/PoseStudioPanel.js'), 'utf8');
        for (const item of MP.ITEMS.filter((i) => i.method === 'hand-authored-preset')) {
            expect(poses).toMatch(new RegExp(`\\n    ${item.name}: \\{`));
            if (item.name !== 'floorOpen') expect(panel).toContain(`name: '${item.name}'`);
        }
    });

    test('the clips the shows dance are the registered ones', () => {
        for (const clip of Object.values(Routines.CLIPS))
            expect(MP.ITEMS.some((i) => i.method === 'converted-cc0-clip' && i.name === clip)).toBe(true);
    });
});

describe('MP1 a method off reaches everything made that way, and removes nothing', () => {
    test('on by default; off and on again are kept on this device', () => {
        for (const m of Object.keys(MP.METHODS)) expect(MP.isMethodOn(m)).toBe(true);
        MP.setMethodOn('converted-cc0-clip', false);
        expect(MP.isMethodOn('converted-cc0-clip')).toBe(false);
        expect(JSON.parse(localStorage.getItem(MP.STORAGE_KEY))).toEqual(['converted-cc0-clip']);
        MP.setMethodOn('converted-cc0-clip', true);
        expect(MP.isMethodOn('converted-cc0-clip')).toBe(true);
    });

    test('what Claude did not make is always allowed', () => {
        for (const m of Object.keys(MP.METHODS)) MP.setMethodOn(m, false);
        expect(MP.presetAllowed('kneeling')).toBe(true);
        expect(MP.clipAllowed('vendor/animations/vrma/Clapping.vrma')).toBe(true);
    });

    test('converted clips off: the danced shows close, the others stay', () => {
        MP.setMethodOn('converted-cc0-clip', false);
        expect(Routines.available('striptease')).toBe(false);
        expect(Routines.available('table-dance')).toBe(false);
        expect(Routines.available('tease')).toBe(true);
        expect(Routines.openAt(4, () => 1)).not.toContain('striptease');
    });

    test('hand-authored presets off: shows that use one close (through Private positions)', () => {
        window.NEXUS_PRIVATE_POSES = require('../src/experiences/private/PrivatePoseController.js');
        MP.setMethodOn('hand-authored-preset', false);
        expect(Routines.available('ride')).toBe(false); // straddle
        expect(Routines.available('open-for-you')).toBe(false); // sittingOpen, lyingKneesUp
    });

    test('composed shows off: none is offered, and the show code is all still there', () => {
        MP.setMethodOn('composed-show', false);
        expect(Routines.openAt(4, () => 1)).toEqual([]);
        expect(Object.keys(Routines.ROUTINES).length).toBe(Routines.ORDER.length);
    });

    test('living layer off: it draws nothing, with its own switch still on', () => {
        expect(Living.isOn()).toBe(true);
        MP.setMethodOn('procedural-layer', false);
        expect(Living.isOn()).toBe(false);
        MP.setMethodOn('procedural-layer', true);
        expect(Living.isOn()).toBe(true);
    });

    test('Pose Studio and the pose system filter the presets through the registry', () => {
        const poses = fs.readFileSync(path.join(ROOT, 'src/gltf-viewer/VRPoseSystem.js'), 'utf8');
        const panel = fs.readFileSync(path.join(ROOT, 'src/PoseStudioPanel.js'), 'utf8');
        expect(poses).toMatch(/MP\.presetAllowed\(name\)/);
        expect(poses).toMatch(/MP\.allowed\('transition:stagger'\)/);
        expect(panel).toMatch(/MP\.presetAllowed\(p\.name\)/);
    });
});

describe('MP1 the Settings rows', () => {
    test('one switch per method in the Private Mode section, driving the registry both ways', () => {
        document.body.innerHTML =
            '<div class="config-section"><div class="input-group"><input type="checkbox" id="spicy-mode-toggle"></div></div>';
        const group = MP.mountSetting(document);
        const boxes = group.querySelectorAll('[data-motion-method]');
        expect(boxes).toHaveLength(Object.keys(MP.METHODS).length);
        expect(MP.mountSetting(document)).toBe(group);
        const box = group.querySelector('[data-motion-method="composed-show"]');
        box.checked = false;
        box.dispatchEvent(new Event('change'));
        expect(MP.isMethodOn('composed-show')).toBe(false);
        MP.setMethodOn('composed-show', true);
        expect(box.checked).toBe(true);
        document.body.innerHTML = '';
    });
});
