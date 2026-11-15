/**
 * BL2. A bare look is known by what Forge says it is and by what the renderer shows — never by
 * its name. Found by replaying Forge's manifest through the decision engine: the manifest had
 * dropped `templateId`, so `isBare` was never true and every bare request ended `no-bare-look`.
 */
const Engine = require('../../src/experiences/private/OutfitDecisionEngine.js');
const { InSceneWardrobe } = require('../../src/experiences/private/InSceneWardrobe.js');
const { loadLooks } = require('../../src/wardrobe/TryOnHaulActivity.js');

const HER = 'a'.repeat(64);
const forge = (looks) => ({
    available: true,
    resolveUrl: (u) => `https://forge.test${u}`,
    client: { getWardrobe: async () => ({ looks }) },
});

describe('BL2. bare identity from Forge', () => {
    test('wardrobeState or the bare template says bare; a name never does', () => {
        expect(Engine.isBare({ name: 'Look', wardrobeState: 'bare' })).toBe(true);
        expect(Engine.isBare({ name: 'Look', templateId: 'body-bare-v1' })).toBe(true);
        expect(Engine.isBare({ name: 'Bare Naked Nude' })).toBe(false);
        expect(Engine.isBare({ name: 'Black Lingerie Set', wardrobeState: null })).toBe(false);
    });

    test('the manifest fields survive loading: state, template, and the hash the controller verifies', async () => {
        const looks = await loadLooks({
            library: forge([
                {
                    id: 'look_bare',
                    name: 'Bare authored body',
                    vrmUrl: '/v1/assets/looks/look_bare/look.vrm',
                    private: true,
                    templateId: 'body-bare-v1',
                    wardrobeState: 'bare',
                    sourceSha256: HER,
                    outputSha256: 'b'.repeat(64),
                },
            ]),
            identity: { kind: 'library', slug: 'her', sha256: HER },
            privateOpen: true,
        });
        expect(looks).toHaveLength(1);
        expect(looks[0]).toMatchObject({ templateId: 'body-bare-v1', wardrobeState: 'bare', sha256: 'b'.repeat(64) });
        expect(Engine.isBare(looks[0])).toBe(true);
        const plan = Engine.undressPlan({
            looks,
            current: null,
            naked: true,
            allureOf: () => ({ band: 'complete', score: 1 }),
        });
        expect(plan).toMatchObject({ state: 'bare', look: { id: 'look_bare' } });
    });

    test('a look made from another version of her is not hers', async () => {
        const looks = await loadLooks({
            library: forge([
                { id: 'look_old', name: 'Bare', vrmUrl: '/x.vrm', wardrobeState: 'bare', sourceSha256: 'c'.repeat(64) },
            ]),
            identity: { kind: 'library', slug: 'her', sha256: HER },
            privateOpen: true,
        });
        expect(looks).toEqual([]);
    });
});

describe('BL2. the renderer is asked what is drawn', () => {
    const mesh = (userData = {}, extra = {}) => ({ isMesh: true, visible: true, userData, parent: null, ...extra });
    function scene(children) {
        const root = { userData: {}, parent: null, children };
        const walk = (o, fn) => {
            fn(o);
            (o.children || []).forEach((c) => walk(c, fn));
        };
        children.forEach(function link(c) {
            c.parent = c.parent || root;
            (c.children || []).forEach((g) => {
                g.parent = c;
                link(g);
            });
        });
        root.traverse = (fn) => walk(root, fn);
        return root;
    }
    const wardrobeOn = (root) =>
        new InSceneWardrobe({ win: { NEXUS_VIEWER: { avatarManager: { currentRoot: root } } } });

    test('garment meshes Forge put on her are counted; her body and a detached garment node are not', () => {
        const dressed = scene([
            mesh({}), // her body
            { userData: { wardrobeForge: { kind: 'garment' } }, children: [mesh({})] }, // a tee, drawn
            mesh({ wardrobeForge: { kind: 'garment' } }), // briefs, drawn
        ]);
        expect(wardrobeOn(dressed).renderedGarments()).toBe(2);
        const bare = scene([mesh({}), { userData: { wardrobeForge: { kind: 'garment' } }, children: [] }]);
        expect(wardrobeOn(bare).renderedGarments()).toBe(0);
    });

    test('a hidden garment is not drawn; no renderer means it cannot be asked', () => {
        const hidden = scene([mesh({}), mesh({ wardrobeForge: { kind: 'garment' } }, { visible: false })]);
        expect(wardrobeOn(hidden).renderedGarments()).toBe(0);
        expect(new InSceneWardrobe({ win: {} }).renderedGarments()).toBeNull();
    });
});
