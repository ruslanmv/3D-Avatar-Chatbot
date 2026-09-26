/**
 * W5. Making a look for Try-On: which route, what the person sees while it runs, and
 * what never happens — the avatar is not touched by any of it.
 */
const Identity = require('../../src/wardrobe/AvatarIdentity.js');
const Reasons = require('../../src/wardrobe/TryOnReasons.js');
const { ForgeLibraryClient } = require('../../src/wardrobe/ForgeLibraryClient.js');
const { TryOnGenerator, fitPassed } = require('../../src/wardrobe/TryOnGenerator.js');

const SAMPLE_A = Identity.LIBRARY[0];
const PASSED = {
    vrmValid: true,
    humanoidValid: true,
    weightsValid: true,
    skeletonPreserved: true,
    sourceRecoverable: true,
    clippingCheck: 'clearance-only',
};

/** A Forge that answers the routes Try-On uses, and records what it was asked. */
function fakeForge({ published, states, final, refuse } = {}) {
    const calls = [];
    let polls = 0;
    const script = states || ['validating', 'fitting', 'completed'];
    const forge = {
        calls,
        async request(path, options = {}) {
            calls.push({ path, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
            if (path === '/v1/library') {
                if (published === 'offline') throw new TypeError('Failed to fetch');
                return {
                    avatars: published || [{ slug: SAMPLE_A.slug, sha256: SAMPLE_A.sha256, available: true }],
                };
            }
            if (path.endsWith('/jobs') && options.method === 'POST') {
                if (refuse) {
                    const error = new Error(refuse.message);
                    error.status = refuse.status;
                    error.reason = refuse.reason;
                    throw error;
                }
                return { id: 'job_1', state: 'queued' };
            }
            if (path.startsWith('/v1/jobs/')) {
                const state = script[Math.min(polls, script.length - 1)];
                polls += 1;
                if (state !== 'completed') return { id: 'job_1', state, ...(final || {}) };
                return {
                    id: 'job_1',
                    state,
                    look: {
                        id: 'look_1',
                        name: 'Black Satin Dress',
                        vrmUrl: '/v1/assets/looks/look_1/look.vrm',
                        previewUrl: '/v1/assets/looks/look_1/preview.webp',
                    },
                    fitReport: PASSED,
                    ...(final || {}),
                };
            }
            throw new Error(`unexpected ${path}`);
        },
        async generate(options) {
            calls.push({ path: '/v1/generate', method: 'POST', body: options });
            return { jobId: 'job_1' };
        },
        resolveUrl: (url) => (url && url.startsWith('/') ? `https://forge.example${url}` : url),
    };
    return forge;
}

function setup(original, forgeOptions) {
    const forge = fakeForge(forgeOptions);
    const viewer = { setAvatarByUrl: jest.fn() };
    const controller = {
        original,
        avatarId: original && original.name,
        forge,
        snapshot: jest.fn(() => original),
        _conditionsForCurrentAvatar: () => ({ modification: 'allow' }),
    };
    const library = new ForgeLibraryClient({ client: forge, sleep: () => Promise.resolve() });
    const generator = new TryOnGenerator({
        service: { controller, remoteEnabled: true },
        library,
        identity: Identity,
        reasons: Reasons,
        origin: 'https://yourfriend.online/',
    });
    return { forge, generator, viewer };
}

describe('TryOnGenerator', () => {
    test('a built-in avatar is dressed through the library route by slug, with nothing uploaded', async () => {
        const { forge, generator } = setup({ url: `vendor/avatars/${SAMPLE_A.file}`, name: 'AvatarSample A' });
        const look = await generator.create('black satin cocktail dress');
        const post = forge.calls.find((call) => call.method === 'POST');
        expect(post.path).toBe(`/v1/library/${SAMPLE_A.slug}/jobs`);
        expect(post.body.outfit.prompt).toBe('black satin cocktail dress');
        expect(post.body.avatar).toBeUndefined(); // the server supplies the avatar and its licence
        expect(look).toMatchObject({
            id: 'look_1',
            vrmUrl: 'https://forge.example/v1/assets/looks/look_1/look.vrm',
            fitPassed: true,
            source: 'generated',
            avatar: SAMPLE_A.slug,
        });
    });

    test('an external avatar goes to the generate route with an absolute URL and its terms', async () => {
        const { forge, generator } = setup({ url: 'uploads/aiko.vrm', name: 'Aiko' });
        await generator.create('red skater skirt');
        const post = forge.calls.find((call) => call.path === '/v1/generate');
        expect(post.body).toMatchObject({
            avatarUrl: 'https://yourfriend.online/uploads/aiko.vrm',
            prompt: 'red skater skirt',
            conditionsOfUse: { modification: 'allow' },
        });
    });

    test('progress is Forge’s real states, in order, starting before the first poll', async () => {
        const { generator } = setup({ url: `vendor/avatars/${SAMPLE_A.file}` });
        const seen = [];
        await generator.create('navy pleated mini skirt', { onProgress: (p) => seen.push(p.current) });
        expect(seen).toEqual([Reasons.progress('queued').current, 'Checking the avatar', 'Fitting it to her', 'Ready']);
    });

    test('a refusal becomes Forge’s reason as a sentence, and the avatar is never touched', async () => {
        const { generator, viewer } = setup(
            { url: `vendor/avatars/${SAMPLE_A.file}` },
            { refuse: { status: 428, reason: 'requires_adult_declaration', message: 'needs a declaration' } }
        );
        await expect(generator.create('red triangle bikini')).rejects.toMatchObject({
            name: 'TryOnError',
            message: Reasons.REASONS.requires_adult_declaration,
            reason: 'requires_adult_declaration',
        });
        expect(viewer.setAvatarByUrl).not.toHaveBeenCalled();
    });

    test('a job Forge rejects part-way is explained the same way', async () => {
        const { generator } = setup(
            { url: `vendor/avatars/${SAMPLE_A.file}` },
            { states: ['validating', 'rejected'], final: { reason: 'fitting_failed', error: 'x' } }
        );
        await expect(generator.create('ball gown')).rejects.toMatchObject({ message: Reasons.REASONS.fitting_failed });
    });

    test('if Forge holds different bytes for her, the look is refused before a job is made', async () => {
        const { forge, generator } = setup(
            { url: `vendor/avatars/${SAMPLE_A.file}` },
            { published: [{ slug: SAMPLE_A.slug, sha256: 'f'.repeat(64), available: true }] }
        );
        await expect(generator.create('white blouse')).rejects.toMatchObject({ reason: 'library_mismatch' });
        expect(forge.calls.some((call) => call.method === 'POST')).toBe(false);
    });

    test('when the library listing cannot be fetched the job still goes ahead', async () => {
        const { generator } = setup({ url: `vendor/avatars/${SAMPLE_A.file}` }, { published: 'offline' });
        await expect(generator.create('white blouse')).resolves.toMatchObject({ id: 'look_1' });
    });

    test('cancelling ends the wait at once with an AbortError', async () => {
        const { generator } = setup(
            { url: `vendor/avatars/${SAMPLE_A.file}` },
            { states: ['validating', 'fitting', 'fitting', 'fitting', 'completed'] }
        );
        const controller = new AbortController();
        const run = generator.create('green maxi skirt', {
            signal: controller.signal,
            onProgress: (p) => p.current === 'Fitting it to her' && controller.abort(),
        });
        await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    });

    test('without Forge, or before the avatar has loaded, it says why instead of trying', async () => {
        const offline = new TryOnGenerator({
            service: { controller: {}, remoteEnabled: false },
            identity: Identity,
            reasons: Reasons,
        });
        expect(offline.availability().ok).toBe(false);
        await expect(offline.create('dress')).rejects.toThrow(/needs Wardrobe Forge/);
        const { generator } = setup(null);
        await expect(generator.create('dress')).rejects.toThrow(/finish loading/);
        await expect(generator.create('   ')).rejects.toThrow(/Describe the look/);
    });

    test('fitPassed agrees with Forge’s own rule', () => {
        expect(fitPassed(PASSED)).toBe(true);
        expect(fitPassed({ ...PASSED, clippingCheck: 'failed' })).toBe(false);
        expect(fitPassed({ ...PASSED, weightsValid: false })).toBe(false);
        expect(fitPassed(null)).toBe(null);
    });
});

describe('ForgeLibraryClient', () => {
    test('reuses the existing client for every request and caches the library listing', async () => {
        const forge = fakeForge();
        const library = new ForgeLibraryClient({ client: forge, sleep: () => Promise.resolve() });
        await library.library();
        await library.library();
        expect(forge.calls.filter((call) => call.path === '/v1/library')).toHaveLength(1);
        expect(new ForgeLibraryClient({}).available).toBe(false);
    });
});
