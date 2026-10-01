/**
 * W14. Importing a wardrobe pack in the browser: checked whole before anything is kept,
 * private looks only with private mode, and imported looks listed like any other artifact.
 */
const fs = require('fs');
const path = require('path');
const { zip } = require('./zip-support.js');

const SHIPPED = path.join(__dirname, '../../vendor/wardrobe');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(SHIPPED, 'wardrobe.json'), 'utf8'));
const SAMPLE_A = {
    kind: 'library',
    slug: 'avatar-sample-a',
    file: 'AvatarSample_A.vrm',
    sha256: MANIFEST.avatars.find((a) => a.avatarId === 'avatar-sample-a').sourceSha256,
};

function load() {
    jest.resetModules();
    delete window.NEXUS_WARDROBE_PACK_VALIDATOR;
    delete window.NEXUS_WARDROBE_IMPORTER;
    const Validator = require('../../src/wardrobe/WardrobePackValidator.js');
    const Importer = require('../../src/wardrobe/WardrobeArtifactImporter.js');
    return { Validator, Importer };
}

/** A pack of AvatarSample A's shipped looks, re-zipped under its own id: `edit` may change it first. */
function samplePack(edit = (manifest) => manifest) {
    const looks = MANIFEST.looks.filter((look) => look.avatarId === 'avatar-sample-a');
    const manifest = edit({
        ...MANIFEST,
        pack: { ...MANIFEST.pack, id: 'test-pack' },
        avatars: MANIFEST.avatars.filter((a) => a.avatarId === 'avatar-sample-a'),
        looks: looks.map((look) => ({ ...look })),
    });
    const entries = [{ name: 'wardrobe.json', data: Buffer.from(JSON.stringify(manifest)), deflate: true }];
    looks.forEach((look) => {
        entries.push({ name: look.vrmUrl, data: fs.readFileSync(path.join(SHIPPED, look.vrmUrl)) });
        entries.push({ name: look.previewUrl, data: fs.readFileSync(path.join(SHIPPED, look.previewUrl)) });
    });
    return { buffer: zip(entries), entries };
}

function importer(Importer, { privateOn = false } = {}) {
    const store = new Importer.MemoryPackStore();
    let n = 0;
    const URLImpl = { createObjectURL: jest.fn(() => `blob:test/${(n += 1)}`), revokeObjectURL: jest.fn() };
    const source = new Importer.ImportedWardrobeSource({ store, URLImpl });
    const onChange = jest.fn();
    return {
        store,
        source,
        URLImpl,
        onChange,
        flow: new Importer.WardrobeImporter({ store, source, onChange, privateOn: () => privateOn }),
    };
}

describe('reading a zip', () => {
    test.each([['../escape.vrm'], ['/etc/passwd'], ['looks/../../index.html'], ['index.html'], ['looks/a/run.js']])(
        'refuses %s before inflating anything',
        async (name) => {
            const { Importer } = load();
            await expect(Importer.readZip(zip([{ name, data: Buffer.from('x') }]))).rejects.toThrow(/may not/);
        }
    );

    test('refuses a symbolic link, and a compressed model (the zip-bomb shape)', async () => {
        const { Importer } = load();
        await expect(
            Importer.readZip(zip([{ name: 'looks/a/look.vrm', data: Buffer.from('x'), symlink: true }]))
        ).rejects.toThrow('symbolic link');
        await expect(
            Importer.readZip(zip([{ name: 'looks/a/look.vrm', data: Buffer.alloc(4096), deflate: true }]))
        ).rejects.toThrow('compressed');
    });

    test('reads a v1 bundle’s avatars.json without refusing it', async () => {
        const { Importer } = load();
        const files = await Importer.readZip(zip([{ name: 'avatars.json', data: Buffer.from('{}'), deflate: true }]));
        expect(Object.keys(files)).toEqual(['avatars.json']);
    });
});

describe('importing a pack', () => {
    test('a verified pack is summarised, kept on yes, and listed as imported looks for her', async () => {
        const { Importer, Validator } = load();
        const { flow, source, store, onChange } = importer(Importer);
        const prepared = await flow.prepare(samplePack().buffer);
        expect(prepared.problems).toEqual([]);
        expect(prepared.summary).toMatchObject({
            id: 'test-pack',
            looks: 2,
            verified: true,
            licences: ['CC0-1.0'],
            private: false,
        });
        expect(await store.list()).toEqual([]); // nothing is kept before the person says yes

        await prepared.commit();
        expect(onChange).toHaveBeenCalled();
        const looks = await source.listLooks();
        expect(looks.map((look) => look.key).sort()).toEqual([
            'imported:test-pack:avatar-sample-a:crop-top-jeans',
            'imported:test-pack:avatar-sample-a:maxi-sundress',
        ]);
        looks.forEach((look) => {
            expect(look.vrmUrl).toMatch(/^blob:test\/\d+#look\.vrm$/);
            expect(look.sha256).toMatch(/^[0-9a-f]{64}$/);
            expect(look.sourceLabel).toBe('Imported');
            expect(Validator.visibility(look, { identity: SAMPLE_A, unratedAs: 'swimwear' }).visible).toBe(true);
        });
        expect(await flow.list()).toEqual([expect.objectContaining({ id: 'test-pack', looks: 2 })]);
    });

    test('one changed byte refuses the whole pack, and nothing is kept', async () => {
        const { Importer } = load();
        const { flow, store } = importer(Importer);
        const { entries } = samplePack();
        const vrm = entries.find((entry) => entry.name.endsWith('.vrm'));
        vrm.data = Buffer.from(vrm.data);
        vrm.data[vrm.data.length - 1] ^= 0xff;
        const prepared = await flow.prepare(zip(entries));
        expect(prepared.ok).toBe(false);
        expect(prepared.problems.join(' ')).toContain('SHA-256');
        expect(await store.list()).toEqual([]);
    });

    test('a private pack needs private mode to import, and even then shows only when private outfits are open', async () => {
        const { Importer, Validator } = load();
        const rated = samplePack((manifest) => {
            manifest.visibility = 'private';
            manifest.looks[0].rating = 'swimwear';
            return manifest;
        }).buffer;

        const off = await importer(Importer).flow.prepare(rated);
        expect(off.ok).toBe(false);
        expect(off.problems.join(' ')).toContain('private mode');

        const { flow, source } = importer(Importer, { privateOn: true });
        const prepared = await flow.prepare(rated);
        expect(prepared.summary).toMatchObject({ private: true, gated: 1 });
        await prepared.commit();
        const swim = (await source.listLooks()).find((look) => look.rating === 'swimwear');
        expect(Validator.visibility(swim, { identity: SAMPLE_A, unratedAs: 'swimwear' }).visible).toBe(false);
        expect(Validator.visibility(swim, { identity: SAMPLE_A, privateOpen: true }).visible).toBe(true);
    });

    test('a pack cannot declare anything: its permission fields never reach a look', async () => {
        const { Importer } = load();
        const { flow, source } = importer(Importer);
        const claims = samplePack((manifest) => {
            manifest.depictsAdult = true;
            manifest.looks.forEach((look) => Object.assign(look, { depictsAdult: true, trusted: true }));
            return manifest;
        }).buffer;
        await (await flow.prepare(claims)).commit();
        (await source.listLooks()).forEach((look) => {
            expect(look).not.toHaveProperty('depictsAdult');
            expect(look).not.toHaveProperty('trusted');
        });
    });

    test('an older v1 bundle imports unverified, gets a hash to guard it, and its unrated looks are gated', async () => {
        const { Importer, Validator } = load();
        const vrm = fs.readFileSync(path.join(SHIPPED, MANIFEST.looks[0].vrmUrl));
        const manifest = {
            schemaVersion: 1,
            avatarId: 'avatar-sample-a',
            looks: [
                { id: 'original', name: 'Everyday', type: 'source' },
                { id: 'look_1', name: 'Studio look', vrmUrl: 'looks/avatar-sample-a/look_1/look.vrm' },
            ],
        };
        const bundle = zip([
            { name: 'wardrobe.json', data: Buffer.from(JSON.stringify(manifest)), deflate: true },
            { name: 'avatars.json', data: Buffer.from('{}'), deflate: true },
            { name: 'looks/avatar-sample-a/look_1/look.vrm', data: vrm },
        ]);
        const { flow, source } = importer(Importer, { privateOn: false });
        const prepared = await flow.prepare(bundle);
        // Unrated counts as gated, so an unrated pack is a private pack.
        expect(prepared.problems.join(' ')).toContain('private mode');
        const privately = importer(Importer, { privateOn: true });
        const accepted = await privately.flow.prepare(bundle);
        expect(accepted.summary).toMatchObject({ verified: false, looks: 1 });
        expect(accepted.summary.id).toMatch(/^bundle-avatar-sample-a-[0-9a-f]{8}$/);
        await accepted.commit();
        const [look] = await privately.source.listLooks();
        expect(look.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(Validator.visibility(look, { identity: SAMPLE_A, unratedAs: 'swimwear' }).visible).toBe(false);
        expect(source).toBeDefined();
    });

    test('removing a pack lets go of its files', async () => {
        const { Importer } = load();
        const { flow, source, URLImpl } = importer(Importer);
        await (await flow.prepare(samplePack().buffer)).commit();
        await source.listLooks();
        await flow.remove('test-pack');
        expect(URLImpl.revokeObjectURL).toHaveBeenCalledTimes(URLImpl.createObjectURL.mock.calls.length);
        expect(await source.listLooks()).toEqual([]);
    });
});

describe('in Try-On', () => {
    test('her imported looks are listed with the built-in ones, and only hers', async () => {
        const { Importer } = load();
        const TryOn = require('../../src/wardrobe/TryOnHaulActivity.js');
        const { flow, source } = importer(Importer);
        await (await flow.prepare(samplePack().buffer)).commit();
        const service = { importedSource: source, staticSource: null };
        const hers = await TryOn.loadLooks({ service, identity: SAMPLE_A });
        expect(hers.map((look) => look.key).sort()).toEqual([
            'imported:test-pack:avatar-sample-a:crop-top-jeans',
            'imported:test-pack:avatar-sample-a:maxi-sundress',
        ]);
        const someoneElse = { kind: 'library', slug: 'fem-vroid', sha256: 'f'.repeat(64) };
        expect(await TryOn.loadLooks({ service, identity: someoneElse })).toEqual([]);
    });

    test('the view shows what a pack is before keeping it, and keeps it only on yes', async () => {
        load();
        const { TryOnView } = require('../../src/wardrobe/TryOnView.js');
        const { TryOnSession } = require('../../src/wardrobe/TryOnSession.js');
        document.body.innerHTML = '';
        const commit = jest.fn(async () => ({}));
        const fake = {
            list: jest.fn(async () => []),
            remove: jest.fn(async () => {}),
            prepare: jest.fn(async () => ({
                ok: true,
                problems: [],
                commit,
                summary: {
                    id: 'p',
                    name: 'Evening pack',
                    looks: 3,
                    avatars: ['AvatarSample A'],
                    verified: true,
                    licences: ['CC0-1.0'],
                    private: false,
                    gated: 0,
                },
            })),
        };
        const onImported = jest.fn();
        const session = new TryOnSession({ controller: { original: {}, applyLook: jest.fn(), restore: jest.fn() } });
        const view = new TryOnView({ doc: document, session, importer: fake, onImported });
        view.mount(null);
        view.setLoading(false);
        await view._chooseFile(new Blob(['zip']));
        const text = document.getElementById('nexus-try-on-view').textContent;
        expect(text).toContain('3 looks · Evening pack');
        expect(text).toContain('Made for AvatarSample A');
        expect(commit).not.toHaveBeenCalled();
        document.querySelector('[data-key="import-confirm"]').click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(commit).toHaveBeenCalledTimes(1);
        expect(onImported).toHaveBeenCalled();
        view.unmount();
    });
});
