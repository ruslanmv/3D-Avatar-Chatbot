/**
 * HA1. Her hair aside: only hair joints move, they fall along her forward and away from someone
 * behind her, and release writes back exactly what was there (snapshot and restore).
 */
const Hair = require('../src/gltf-viewer/HairAside.js');
const Intent = require('../src/experiences/private/PrivateActionIntent.js');

function joint(name, settings) {
    const dir = { ...settings.gravityDir };
    dir.set = function (x, y, z) {
        this.x = x;
        this.y = y;
        this.z = z;
    };
    return { bone: { name }, settings: { ...settings, gravityDir: dir } };
}

function vrmWith(joints) {
    return { springBoneManager: { joints: new Set(joints) } };
}

describe('HA1. HairAside', () => {
    afterEach(() => Hair.release());

    test('hair joints are recognised by name; bust, skirt and accessories are not', () => {
        for (const n of ['J_Sec_Hair1_01', 'HairJoint-3a', 'hair_back_02', '髪_1'])
            expect(Hair.isHairJoint(n)).toBe(true);
        for (const n of ['J_Sec_L_Bust1', 'J_Sec_Skirt_01', 'Ribbon_L', '', null])
            expect(Hair.isHairJoint(n)).toBe(false);
    });

    test('the direction is her forward, a little down, unit length; a side leans over that shoulder', () => {
        const d = Hair.asideDirection({ x: 0, z: 1 }, 'front');
        expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 6);
        expect(d.z).toBeGreaterThan(0.8);
        expect(d.y).toBeLessThan(0);
        expect(Math.abs(d.x)).toBeLessThan(1e-9);
        const left = Hair.asideDirection({ x: 0, z: 1 }, 'left');
        const right = Hair.asideDirection({ x: 0, z: 1 }, 'right');
        expect(Math.sign(left.x)).toBe(-Math.sign(right.x));
        expect(left.z).toBeGreaterThan(0);
        // No forward (degenerate): still a valid direction, never NaN.
        const none = Hair.asideDirection({ x: 0, z: 0 }, 'front');
        expect(Number.isFinite(none.x + none.y + none.z)).toBe(true);
    });

    test('apply moves only the hair, release writes back exactly what was there', () => {
        const before = { gravityPower: 0.2, stiffness: 1.5, gravityDir: { x: 0, y: -1, z: 0 }, dragForce: 0.4 };
        const hair = joint('J_Sec_Hair1_01', before);
        const bust = joint('J_Sec_L_Bust1', before);
        const vrm = vrmWith([hair, bust]);
        expect(Hair.apply(vrm, { x: 0, z: -1 }, 'front')).toBe(1);
        expect(Hair.isOn(vrm)).toBe(true);
        expect(hair.settings.gravityDir.z).toBeLessThan(-0.8);
        expect(hair.settings.gravityPower).toBeGreaterThan(before.gravityPower);
        expect(hair.settings.stiffness).toBeLessThan(before.stiffness);
        expect(hair.settings.dragForce).toBe(before.dragForce);
        expect(bust.settings.gravityDir).toMatchObject(before.gravityDir);
        expect(bust.settings.stiffness).toBe(before.stiffness);
        // Applied twice (another side) keeps the first snapshot: release is still the original.
        Hair.apply(vrm, { x: 0, z: -1 }, 'left');
        expect(Hair.release()).toBe(true);
        expect(hair.settings.gravityPower).toBe(before.gravityPower);
        expect(hair.settings.stiffness).toBe(before.stiffness);
        expect({ ...hair.settings.gravityDir, set: undefined }).toMatchObject(before.gravityDir);
        expect(Hair.isOn()).toBe(false);
        expect(Hair.release()).toBe(false);
    });

    test('a body without spring hair answers 0 and holds nothing', () => {
        expect(Hair.apply(vrmWith([]), { x: 0, z: 1 })).toBe(0);
        expect(Hair.apply({}, { x: 0, z: 1 })).toBe(0);
        expect(Hair.isOn()).toBe(false);
    });

    test('her forward: VRM 0.x faces local −Z, VRM 1.0 +Z, turned by the root', () => {
        const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
        expect(Hair.forwardOf({ matrixWorld: { elements: identity }, userData: { vrmForwardNegZ: true } })).toEqual({
            x: -0,
            z: -1,
        });
        expect(Hair.forwardOf({ matrixWorld: { elements: identity }, userData: { vrmForwardNegZ: false } })).toEqual({
            x: 0,
            z: 1,
        });
    });

    test('the words, in the nine languages, and what they are not', () => {
        const hair = (t) => {
            const p = Intent.hairFrom(t);
            return p ? `${p.params.move}${p.params.side ? ':' + p.params.side : ''}` : null;
        };
        for (const t of [
            'Move your hair aside',
            'Sposta i capelli da parte',
            'Aparta el pelo a un lado',
            'Écarte tes cheveux sur le côté',
            'Nimm die Haare zur Seite',
            'Afasta o cabelo para o lado',
            '髪をよけて',
            '머리카락을 옆으로 넘겨',
            '把头发拨开',
        ])
            expect(hair(t)).toBe('aside:front');
        expect(hair('sposta i capelli a sinistra')).toBe('aside:left');
        expect(hair('capelli come prima')).toBe('back');
        expect(hair('I love your hair')).toBeNull();
        expect(hair('pull my hair')).toBeNull();
        expect(hair('move for me')).toBeNull();
    });
});
