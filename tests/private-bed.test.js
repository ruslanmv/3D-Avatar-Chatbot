/**
 * BS1. Positions done on a bed are done on the room's bed: the bed is measured from its model,
 * the catalogue carries it, and only a bed position moves the room — anything else puts it back.
 */
const path = require('path');
const Bed = require('../src/experiences/private/PrivateBed.js');
const Worlds = require('../src/gltf-viewer/VRWorlds.js');
const { measure, bedProp } = require('../tools/vr/bed-measure.cjs');
const raw = require('../assets/vr-worlds/worlds.json');

const { worlds } = Worlds.validateCatalogue(raw);

describe('BS1 the beds are measured, never typed', () => {
    test('every room with a bed prop carries a bed that measuring it again reproduces', () => {
        const withBed = raw.worlds.filter((w) => bedProp(w));
        expect(withBed.map((w) => w.id)).toEqual(
            expect.arrayContaining(['window-room', 'bright-hotel', 'candlelit-suite'])
        );
        for (const w of withBed) {
            const again = measure(bedProp(w), path.join(__dirname, '../assets/vr-worlds', bedProp(w).src));
            expect(w.bed).toEqual(again);
            expect(again.top).toBeGreaterThan(0.2);
            expect(again.top).toBeLessThan(1);
        }
    });

    test('written once per room: no stale duplicate keys left by an earlier run', () => {
        const text = require('fs').readFileSync(path.join(__dirname, '../assets/vr-worlds/worlds.json'), 'utf8');
        expect((text.match(/"bed":/g) || []).length).toBe(raw.worlds.filter((w) => w.bed).length);
    });

    test('the catalogue keeps a sane bed and drops a broken one', () => {
        const room = worlds.find((w) => w.id === 'bright-hotel');
        expect(room.bed).toEqual({ at: [0, -2.6], top: 0.444, length: 2 });
        const broken = Worlds.validateCatalogue({
            worlds: [{ ...raw.worlds.find((w) => w.id === 'bright-hotel'), id: 'x-room', bed: { at: [0], top: 9 } }],
        }).worlds[0];
        expect(broken.bed).toBeNull();
    });
});

describe('BS1 only a bed position moves the room, and anything else puts it back', () => {
    const fake = (bed) => {
        const calls = [];
        let onBed = false;
        const runtime = {
            bed,
            get onBed() {
                return onBed;
            },
            nestle: async (hips) => {
                calls.push(hips ? `bed:${hips.x},${hips.z}` : 'back');
                onBed = Boolean(hips);
                return { ok: true, onBed };
            },
        };
        const hips = { getWorldPosition: (v) => v.set(0.1, 0.9, 0.2) };
        class Vector3 {
            set(x, y, z) {
                Object.assign(this, { x, y, z });
                return this;
            }
        }
        const win = {
            THREE: { Vector3 },
            NEXUS_VIEWER: {
                vrWorlds: runtime,
                avatarManager: { _currentVRM: { humanoid: { getNormalizedBoneNode: () => hips } } },
            },
        };
        return { win, calls };
    };

    test('lying back goes on the bed; standing up comes back; a dance does not touch it', async () => {
        const { win, calls } = fake({ at: [0, -2.6], top: 0.444, length: 2 });
        expect((await Bed.sync(win, 'lie-back')).onBed).toBe(true);
        await Bed.sync(win, 'kneel');
        expect((await Bed.sync(win, null)).moved).toBe(false);
        expect(calls).toEqual(['bed:0.1,0.2', 'back']);
    });

    test('a room without a bed changes nothing', async () => {
        const { win, calls } = fake(null);
        await Bed.sync(win, 'all-fours');
        expect(calls).toEqual([]);
        expect(Bed.isBedPose('all-fours') && Bed.isBedPose('straddle') && !Bed.isBedPose('kneel')).toBe(true);
    });
});
