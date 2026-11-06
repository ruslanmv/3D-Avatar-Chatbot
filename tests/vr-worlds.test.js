/**
 * VW1. Places for VR: what is chosen, what the catalogue may hold, and the comfort rules every
 * shipped world is held to. The runtime draws with THREE and is checked in a real browser
 * (`?vrWorld=<id>`); what is tested here is everything it decides.
 */
const fs = require('fs');
const path = require('path');
const Worlds = require('../src/gltf-viewer/VRWorlds.js');

const ROOT = path.join(__dirname, '..');
const CATALOGUE = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/vr-worlds/worlds.json'), 'utf8'));

describe('the shipped catalogue', () => {
    const { worlds, problems } = Worlds.validateCatalogue(CATALOGUE);

    test('every world is valid and every comfort rule holds', () => {
        expect(problems).toEqual([]);
        expect(worlds.length).toBeGreaterThanOrEqual(10);
    });

    test('every file a world names is in the repository', () => {
        for (const w of worlds) {
            for (const file of Object.values(w.panorama)) {
                expect(fs.existsSync(path.join(ROOT, Worlds.ROOT, file))).toBe(true);
            }
            for (const prop of w.props) {
                expect(`${w.id}: ${prop.src} ${fs.existsSync(path.join(ROOT, Worlds.ROOT, prop.src))}`).toBe(
                    `${w.id}: ${prop.src} true`
                );
            }
        }
    });

    test('a glTF never points at a file that is not beside it', () => {
        // The sci-fi kit shipped its textures in another folder; its models were rewired to them.
        const kits = path.join(ROOT, 'assets/vr-worlds/kits');
        const walk = (dir) =>
            fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
                const full = path.join(dir, e.name);
                return e.isDirectory() ? walk(full) : full.endsWith('.gltf') ? [full] : [];
            });
        const used = new Set(worlds.flatMap((w) => w.props.map((p) => path.join(ROOT, Worlds.ROOT, p.src))));
        for (const file of walk(kits).filter((f) => used.has(f))) {
            const gltf = JSON.parse(fs.readFileSync(file, 'utf8'));
            for (const item of [...(gltf.images || []), ...(gltf.buffers || [])]) {
                if (!item.uri || item.uri.startsWith('data:')) continue;
                expect(
                    `${path.basename(file)} → ${item.uri} ${fs.existsSync(path.join(path.dirname(file), item.uri))}`
                ).toBe(`${path.basename(file)} → ${item.uri} true`);
            }
        }
    });

    test('Quest texture budget: no panorama over 4096, no kit texture over 1024', () => {
        const sizeOfJpeg = (buf) => {
            for (let i = 2; i < buf.length; ) {
                const marker = buf[i + 1];
                const len = buf.readUInt16BE(i + 2);
                if (marker >= 0xc0 && marker <= 0xc2) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
                i += 2 + len;
            }
            return null;
        };
        const dir = path.join(ROOT, 'assets/vr-worlds/panoramas');
        for (const f of fs.readdirSync(dir)) {
            const s = sizeOfJpeg(fs.readFileSync(path.join(dir, f)));
            expect(s.w).toBeLessThanOrEqual(4096);
            expect(s.w).toBe(s.h * 2); // equirectangular
        }
        const walk = (d) =>
            fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
                const full = path.join(d, e.name);
                return e.isDirectory() ? walk(full) : /\.png$/i.test(full) ? [full] : [];
            });
        for (const png of walk(path.join(ROOT, 'assets/vr-worlds/kits'))) {
            const buf = fs.readFileSync(png);
            expect(Math.max(buf.readUInt32BE(16), buf.readUInt32BE(20))).toBeLessThanOrEqual(1024);
        }
    });

    test('the experiences have their places', () => {
        const by = (a) => Worlds.chooseWorld({ worlds, activity: a });
        expect(by('seaside')).toBe('seaside-evening');
        expect(by('forest')).toBe('under-the-trees');
        expect(by('meditation')).toBe('starlit-lake');
        expect(by('scene-tale')).toBe('garden-after-dark');
    });

    test('every kit has its licence beside it, and PROVENANCE names every kit and panorama', () => {
        const provenance = fs.readFileSync(path.join(ROOT, 'assets/vr-worlds/PROVENANCE.md'), 'utf8');
        for (const kit of fs.readdirSync(path.join(ROOT, 'assets/vr-worlds/kits'))) {
            expect(provenance).toContain(kit);
            expect(fs.existsSync(path.join(ROOT, 'assets/vr-worlds/kits', kit, 'License.txt'))).toBe(true);
        }
        for (const f of fs.readdirSync(path.join(ROOT, 'assets/vr-worlds/panoramas'))) {
            expect(provenance).toContain(f.replace(/_[24]k\.jpg$/, ''));
        }
        expect(provenance).toMatch(/CC0/);
    });
});

describe('which world', () => {
    const worlds = [
        { id: 'a', activities: ['seaside'] },
        { id: 'b', activities: [] },
    ];
    test('plain VR stays plain unless a place is asked for (XP1)', () => {
        expect(Worlds.chooseWorld({ worlds })).toBeNull();
        expect(Worlds.chooseWorld({ worlds, setting: 'auto', activity: 'talk' })).toBeNull();
    });
    test('an experience brings its place; a chosen world otherwise', () => {
        expect(Worlds.chooseWorld({ worlds, activity: 'seaside' })).toBe('a');
        expect(Worlds.chooseWorld({ worlds, setting: 'b' })).toBe('b');
        expect(Worlds.chooseWorld({ worlds, setting: 'b', activity: 'seaside' })).toBe('a');
    });
    test('never in AR, never when off, never an unknown id', () => {
        expect(Worlds.chooseWorld({ worlds, setting: 'b', isAR: true })).toBeNull();
        expect(Worlds.chooseWorld({ worlds, setting: 'off', activity: 'seaside' })).toBeNull();
        expect(Worlds.chooseWorld({ worlds, setting: 'nowhere' })).toBeNull();
    });
    test('the setting is stored and announced', () => {
        localStorage.clear();
        const seen = [];
        window.addEventListener('nexus-vr-world-change', (e) => seen.push(e.detail.setting));
        expect(Worlds.readSetting()).toBe('auto');
        Worlds.writeSetting('b');
        expect(Worlds.readSetting()).toBe('b');
        expect(seen).toEqual(['b']);
    });
});

describe('the catalogue is a trust boundary', () => {
    test('paths cannot leave assets/vr-worlds or name a URL', () => {
        for (const bad of ['../secret.glb', '/etc/x.jpg', 'https://x.com/a.glb', 'a\\b.glb', 'a//b.glb', 'x.exe', ''])
            expect(Worlds.isSafePath(bad)).toBe(false);
        expect(Worlds.isSafePath('kits/kenney-nature-kit/log.glb')).toBe(true);
    });
    test('a bad prop is dropped alone; a world with no picture is dropped', () => {
        const { worlds, problems } = Worlds.validateCatalogue({
            worlds: [
                {
                    id: 'ok',
                    panorama: { '2k': 'panoramas/x_2k.jpg' },
                    props: [
                        { src: '../x.glb', height: 1, at: [3, 0, -3] },
                        { src: 'kits/a.glb', at: [3, 0, -3] },
                        { src: 'kits/b.glb', height: 1, at: [3, 0, -3] },
                    ],
                },
                { id: 'nopic', panorama: {} },
            ],
        });
        expect(worlds.map((w) => w.id)).toEqual(['ok']);
        expect(worlds[0].props.map((p) => p.src)).toEqual(['kits/b.glb']);
        expect(problems).toHaveLength(3);
    });
});

describe('comfort (Meta VR guidance)', () => {
    const at = (x, z, extra) => ({ at: [x, 0, z], ...(extra || {}) });
    test('nothing within a metre of the person, nothing between the two of you, nothing inside her', () => {
        expect(Worlds.comfortProblem(at(0.3, 0.6))).toMatch(/1 m/);
        expect(Worlds.comfortProblem(at(0.2, -0.2))).toMatch(/between/);
        expect(Worlds.comfortProblem(at(0.1, -0.4))).toMatch(/inside/);
        expect(Worlds.comfortProblem(at(1.6, -1.5))).toBeNull();
        expect(Worlds.comfortProblem(at(0, -0.4, { flat: true }))).toBeNull(); // a rug
    });
    test('night worlds still light her face', () => {
        const { worlds } = Worlds.validateCatalogue({
            worlds: [{ id: 'dark', panorama: { '2k': 'p.jpg' }, light: { hemi: 0.05, fillIntensity: 0 } }],
        });
        expect(worlds[0].light.hemi).toBeGreaterThanOrEqual(0.4);
        expect(worlds[0].light.fillIntensity).toBeGreaterThanOrEqual(0.35);
    });
    test('place changes fade through black, a quarter second each way', () => {
        expect(Worlds.FADE_SECONDS).toBeGreaterThanOrEqual(0.15);
        expect(Worlds.FADE_SECONDS).toBeLessThanOrEqual(0.5);
        let o = 0;
        for (let i = 0; i < 10; i++) o = Worlds.fadeStep(o, 1, 0.05, Worlds.FADE_SECONDS);
        expect(o).toBe(1);
        expect(Worlds.fadeStep(1, 0, 0.1, 0.25)).toBeCloseTo(0.6);
        expect(Worlds.fadeStep(0.5, 0.5, 1, 0.25)).toBe(0.5);
    });
});

describe('geometry', () => {
    test('the photograph lies on the ground below the camera height', () => {
        const flat = Worlds.flattenBelow([0, -60, 0, 0, -1, 0, 0, 30, 0], 1.7);
        const want = [0, -1.7, 0, 0, -1, 0, 0, 30, 0];
        Array.from(flat).forEach((v, i) => expect(v).toBeCloseTo(want[i], 5));
    });
    test('props are sized by height or width and centred on their spot', () => {
        expect(Worlds.fitScale({ x: 2, y: 4, z: 1 }, { height: 2 })).toBe(0.5);
        expect(Worlds.fitScale({ x: 2, y: 4, z: 3 }, { width: 6 })).toBe(2);
        const off = Worlds.placementOffset({ min: { x: 0, y: -0.5, z: 0 }, max: { x: 2, y: 1, z: 4 } }, 2);
        expect(off).toEqual({ x: 2, y: -1, z: 4 });
    });
    test('4K on a GPU that takes it, 2K otherwise', () => {
        const w = { panorama: { '4k': 'a4.jpg', '2k': 'a2.jpg' } };
        expect(Worlds.panoramaFor(w, { maxTextureSize: 8192 })).toBe('a4.jpg');
        expect(Worlds.panoramaFor(w, { maxTextureSize: 2048 })).toBe('a2.jpg');
    });
    test('the runtime never starts a loop or moves the camera', () => {
        const src = fs.readFileSync(path.join(ROOT, 'src/gltf-viewer/VRWorlds.js'), 'utf8');
        expect(src).not.toMatch(/setAnimationLoop|requestAnimationFrame|camera\.position\.set|WebGLRenderer\(/);
    });
});
