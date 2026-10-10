/**
 * W11. `vendor/wardrobe/` is always a pack the check accepts — this test is what makes
 * `npm run validate` say so — and the check refuses every way a pack goes wrong.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const Pack = require('../../scripts/wardrobe-pack.cjs');
const { zip } = require('./zip-support.js');

const SHIPPED = path.join(__dirname, '../../vendor/wardrobe');

describe('the shipped wardrobe pack', () => {
    let files;
    beforeAll(() => {
        files = Pack.readDir(SHIPPED);
    });

    test('passes the check: every byte, every avatar pin, nothing orphaned', async () => {
        const result = await Pack.checkPack(files);
        expect(result.problems).toEqual([]);
        expect(result.ok).toBe(true);
    });

    test('one changed byte in one look fails it', async () => {
        const vrm = Object.keys(files).find((name) => name.endsWith('.vrm'));
        const tampered = Buffer.from(files[vrm]);
        tampered[tampered.length - 1] ^= 0xff;
        const result = await Pack.checkPack({ ...files, [vrm]: tampered });
        expect(result.ok).toBe(false);
        expect(result.problems.join('\n')).toContain('SHA-256');
    });

    test('a file nothing names, a missing file, and a look above general all fail it', async () => {
        const orphan = await Pack.checkPack({ ...files, 'looks/extra/look.vrm': Buffer.from('x') });
        expect(orphan.problems.join('\n')).toContain('named by nothing');

        const vrm = Object.keys(files).find((name) => name.endsWith('.vrm'));
        const missing = { ...files };
        delete missing[vrm];
        expect((await Pack.checkPack(missing)).problems.join('\n')).toContain('is missing');

        const manifest = JSON.parse(files['wardrobe.json']);
        manifest.looks[0].rating = 'swimwear';
        const rated = await Pack.checkPack({ ...files, 'wardrobe.json': Buffer.from(JSON.stringify(manifest)) });
        expect(rated.problems.join('\n')).toContain('rated swimwear');
    });

    test('a pack made from a different copy of one of our avatars cannot install', async () => {
        const manifest = JSON.parse(files['wardrobe.json']);
        manifest.avatars[0].sourceSha256 = 'f'.repeat(64);
        const result = await Pack.checkPack({ ...files, 'wardrobe.json': Buffer.from(JSON.stringify(manifest)) });
        expect(result.problems.join('\n')).toContain('made from a different file');
    });
});

describe('reading an untrusted zip', () => {
    test.each([
        ['../escape.vrm'],
        ['/etc/passwd'],
        ['looks/../../index.html'],
        ['looks\\a\\look.vrm'],
        ['index.html'],
        ['looks/a/run.js'],
    ])('refuses %s before inflating anything', (name) => {
        expect(() => Pack.readZip(zip([{ name, data: Buffer.from('x') }]))).toThrow(/may not/);
    });

    test('refuses a symbolic link', () => {
        const archive = zip([{ name: 'looks/a/look.vrm', data: Buffer.from('/etc/passwd'), symlink: true }]);
        expect(() => Pack.readZip(archive)).toThrow('symbolic link');
    });

    test('reads stored and deflated entries back byte for byte', () => {
        const json = Buffer.from(JSON.stringify({ schemaVersion: 2, looks: [] }));
        const files = Pack.readZip(
            zip([
                { name: 'wardrobe.json', data: json, deflate: true },
                { name: 'looks/a/b/1/look.vrm', data: Buffer.from('glTF') },
            ])
        );
        expect(files['wardrobe.json'].equals(json)).toBe(true);
        expect(files['looks/a/b/1/look.vrm'].toString()).toBe('glTF');
    });

    test('a pack that fails its check changes nothing on disk', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-'));
        const target = path.join(dir, 'wardrobe');
        fs.mkdirSync(target);
        fs.writeFileSync(path.join(target, 'wardrobe.json'), '{"keep": true}');
        const source = path.join(dir, 'bad.zip');
        fs.writeFileSync(source, zip([{ name: 'wardrobe.json', data: Buffer.from('{"schemaVersion": 2}') }]));
        const result = await Pack.installPack(source, target);
        expect(result.installed).toBe(false);
        expect(fs.readFileSync(path.join(target, 'wardrobe.json'), 'utf8')).toBe('{"keep": true}');
        expect(fs.readdirSync(dir).sort()).toEqual(['bad.zip', 'wardrobe']);
        fs.rmSync(dir, { recursive: true, force: true });
    });
});
