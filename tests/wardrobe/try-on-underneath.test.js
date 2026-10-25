/**
 * FC2. "Would black look better underneath?" — the stylist suggests, the person chooses, and
 * Forge recolours only the foundation of the look she has on. Pinned: what is sent to Forge,
 * that nothing is claimed before the new VRM has loaded, that switching back costs no second
 * job, that the companion's tag only opens the chooser, and what the card says in each state.
 */
const { TryOnSession } = require('../../src/wardrobe/TryOnSession.js');
const { TryOnView } = require('../../src/wardrobe/TryOnView.js');
const Reasons = require('../../src/wardrobe/TryOnReasons.js');
const Intent = require('../../src/wardrobe/TryOnIntent.js');
const Generator = require('../../src/wardrobe/TryOnGenerator.js');
const Tool = require('../../src/wardrobe/WardrobeTool.js');
const { TryOnUnderneath, cardsFor } = require('../../src/wardrobe/TryOnUnderneath.js');

const DRESS = {
    id: 'look_white',
    name: 'Black Bodycon Mini Dress & boots',
    vrmUrl: 'https://f/white.vrm',
    source: 'generated',
    prompt: 'black matte strapless bodycon mini dress + black stretch leather over-the-knee boots',
    underneath: { color: 'white', pieces: ['Tailored Full-Cup Bra', 'Tailored Briefs'] },
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function build({ create, failLoad = false } = {}) {
    document.body.innerHTML =
        '<div class="chat-panel"><div class="chat-card"><section class="nexus-live-summary"></section></div></div>' +
        '<div class="avatar-card"></div>';
    const controller = {
        original: { url: 'vendor/avatars/fem_vroid.vrm' },
        avatarManager: { getCurrent: () => controller.original },
        applyLook: jest.fn(async (look) => {
            if (failLoad && look.id !== DRESS.id) throw new Error('The VRM did not load.');
            return look;
        }),
        restore: jest.fn(async () => true),
    };
    const session = new TryOnSession({ controller });
    session.setLooks([{ ...DRESS, underneath: { ...DRESS.underneath, pieces: DRESS.underneath.pieces.slice() } }]);
    const generator = {
        availability: () => ({ ok: true }),
        identity: () => ({ kind: 'library' }),
        create: create || jest.fn(),
    };
    const view = new TryOnView({
        doc: document,
        session,
        generator,
        reasons: Reasons,
        intent: Intent,
        generatorApi: Generator,
        random: () => 0,
    });
    session.onChange = () => view.render();
    view.mount(document.querySelector('.avatar-card'));
    view.setLoading(false);
    return { view, session, controller, generator };
}

async function wearingTheDress(parts) {
    await parts.session.wear(parts.session.state().looks[0]);
    await flush();
}

describe('FC2 — the generator asks Forge for the colour alone', () => {
    const SAMPLE = require('../../src/wardrobe/AvatarIdentity.js');
    const { ForgeLibraryClient } = require('../../src/wardrobe/ForgeLibraryClient.js');

    function forge() {
        const calls = [];
        const client = {
            calls,
            async request(path, options = {}) {
                calls.push({
                    path,
                    method: options.method || 'GET',
                    body: options.body ? JSON.parse(options.body) : null,
                });
                if (path === '/v1/library') {
                    const a = SAMPLE.LIBRARY[0];
                    return { avatars: [{ slug: a.slug, sha256: a.sha256, available: true }] };
                }
                if (path.endsWith('/jobs')) return { id: 'job_1', state: 'queued' };
                return {
                    id: 'job_1',
                    state: 'completed',
                    look: { id: 'look_black', name: 'Black Bodycon Mini Dress', vrmUrl: '/v1/assets/x.vrm' },
                    // Forge's serialisation: the plan's garments are its `layers`, inner first.
                    plan: {
                        layers: [
                            { role: 'foundation', name: 'Black Tailored Briefs' },
                            { role: 'foundation', name: 'Black Tailored Full-Cup Bra' },
                            { role: 'one-piece', name: 'Black Bodycon Mini Dress' },
                        ],
                    },
                    fitReport: {},
                };
            },
            resolveUrl: (url) => url,
        };
        return client;
    }

    test('no outfit, the colour and the look it changes; never on the generic route', async () => {
        const client = forge();
        const a = SAMPLE.LIBRARY[0];
        const controller = {
            original: { url: `vendor/avatars/${a.file}`, name: 'Sample' },
            avatarId: 'Sample',
            forge: client,
            snapshot: () => controller.original,
        };
        const generator = new Generator.TryOnGenerator({
            service: { controller, remoteEnabled: true },
            library: new ForgeLibraryClient({ client, sleep: () => Promise.resolve() }),
            identity: SAMPLE,
            reasons: Reasons,
            origin: 'https://x/',
        });
        const made = await generator.create('', { recolour: true, foundationColor: 'black', baseLookId: 'look_white' });
        const post = client.calls.find((c) => c.method === 'POST');
        expect(post.body.outfit).toBeUndefined();
        expect(post.body.baseLookId).toBe('look_white');
        expect(post.body.options.foundationColor).toBe('black');
        expect(post.body.options.ensureFoundation).toBeUndefined();
        expect(made.underneath).toEqual({ color: 'black', pieces: ['Tailored Full-Cup Bra', 'Tailored Briefs'] });

        await expect(generator.create('', { recolour: true, foundationColor: 'black' })).rejects.toThrow(
            /Only a look Forge made/
        );
    });
});

describe('FC2 — TryOnView.underneath', () => {
    test('asks Forge to recolour the look she has on and reports success only once it is worn', async () => {
        const create = jest.fn(async () => ({
            id: 'look_black',
            name: 'whatever Forge called it',
            vrmUrl: 'https://f/black.vrm',
            source: 'generated',
            underneath: { color: 'black', pieces: [] },
        }));
        const parts = build({ create });
        await wearingTheDress(parts);
        const result = await parts.view.underneath('black');
        expect(create).toHaveBeenCalledWith(
            '',
            expect.objectContaining({ recolour: true, foundationColor: 'black', baseLookId: 'look_white' })
        );
        expect(result.ok).toBe(true);
        const on = parts.session.state().look;
        expect(on.id).toBe('look_black');
        // The same outfit: its name and recipe, and what it is made of underneath.
        expect(on.name).toBe(DRESS.name);
        expect(on.prompt).toBe(DRESS.prompt);
        expect(on.underneath.pieces).toEqual(DRESS.underneath.pieces);
        expect(parts.controller.applyLook).toHaveBeenLastCalledWith(on);
    });

    test('switching back to white wears the white one again: no second job', async () => {
        const create = jest.fn(async () => ({
            id: 'look_black',
            vrmUrl: 'https://f/black.vrm',
            source: 'generated',
            underneath: { color: 'black', pieces: [] },
        }));
        const parts = build({ create });
        await wearingTheDress(parts);
        await parts.view.underneath('black');
        const back = await parts.view.underneath('white');
        expect(back.ok).toBe(true);
        expect(create).toHaveBeenCalledTimes(1);
        expect(parts.session.state().look.id).toBe('look_white');
    });

    test('a look that did not load is not claimed, and her look is the one she had', async () => {
        const create = jest.fn(async () => ({
            id: 'look_black',
            vrmUrl: 'https://f/black.vrm',
            source: 'generated',
            underneath: { color: 'black', pieces: [] },
        }));
        const parts = build({ create, failLoad: true });
        await wearingTheDress(parts);
        const result = await parts.view.underneath('black');
        expect(result.ok).toBe(false);
        expect(result.why).toMatch(/did not load/);
    });

    test('the colour she already has, an unknown colour, or no look: said, not sent', async () => {
        const parts = build();
        expect((await parts.view.underneath('black')).why).toMatch(/Put a look on first/);
        await wearingTheDress(parts);
        expect(await parts.view.underneath('white')).toMatchObject({ ok: true, already: true });
        expect((await parts.view.underneath('see-through')).ok).toBe(false);
        expect(parts.generator.create).not.toHaveBeenCalled();
    });

    test('the companion’s tag opens the chooser with her pick, and changes nothing', async () => {
        const parts = build();
        await wearingTheDress(parts);
        const offered = jest.fn();
        parts.view.onUnderneath = offered;
        const result = await parts.view.runTool('underneath', { color: 'black' }, {});
        expect(result.ok).toBe(true);
        expect(offered).toHaveBeenCalledWith(expect.objectContaining({ suggested: 'black' }));
        expect(parts.generator.create).not.toHaveBeenCalled();
        expect(parts.session.state().look.id).toBe('look_white');
    });
});

describe('FC2 — the wardrobe tool', () => {
    test('reads <wardrobe action="underneath" color="black"/> and nothing it does not know', () => {
        expect(Tool.extract('Black would be gorgeous. <wardrobe action="underneath" color="black"/>').call).toEqual({
            name: 'wardrobe_underneath',
            args: { color: 'black' },
        });
        expect(Tool.extract('<wardrobe action="underneath" color="sheer"/>').rejected).toMatch(/colour/);
        expect(Tool.extract('<wardrobe action="underneath"/>').rejected).toBeTruthy();
    });

    test('she is told what she wears underneath only when there is a Forge look to change', () => {
        const base = { canCreate: true, groups: [], looks: [], current: 'Black Bodycon Mini Dress', running: true };
        expect(Tool.instruction({ ...base, underneath: null })).not.toMatch(/UNDERNEATH/);
        const told = Tool.instruction({ ...base, underneath: 'white tailored full-cup bra and tailored briefs' });
        expect(told).toMatch(/UNDERNEATH: under this look you are wearing white tailored/);
        expect(told).toMatch(/action="underneath" color="black"/);
        expect(told).toMatch(/Never say the colour has changed/);
    });
});

describe('FC2 — the chooser card', () => {
    test('White and Black as product cards, the stylist’s pick marked, no body picture', async () => {
        const parts = build();
        await wearingTheDress(parts);
        const card = new TryOnUnderneath({ doc: document, view: parts.view, generatorApi: Generator });
        card.show({ suggested: 'black' });
        const node = document.querySelector('.nexus-under');
        // W18: a pop-up over the stage, not a block in the chat.
        expect(node.parentNode.className).toBe('nexus-under-overlay');
        expect(node.getAttribute('role')).toBe('dialog');
        expect(node.getAttribute('aria-modal')).toBe('true');
        const cards = [...node.querySelectorAll('.nexus-under-card')];
        expect(cards.map((c) => c.dataset.color)).toEqual(['white', 'black']);
        expect(cards[0].textContent).toMatch(/Wearing now/);
        expect(cards[1].textContent).toMatch(/Stylist’s pick/);
        expect(cards[1].getAttribute('aria-pressed')).toBe('true');
        expect(node.textContent).toMatch(/Tailored full-cup bra · tailored briefs/);
        expect(node.querySelector('img')).toBeNull();
        expect(node.querySelector('.nexus-under-primary').textContent).toBe('Try it in black');
    });

    test('W18: Escape, the × and the backdrop close it — never while Forge is working — and focus goes back', async () => {
        const parts = build();
        await wearingTheDress(parts);
        const opener = document.createElement('button');
        document.body.appendChild(opener);
        opener.focus();
        const card = new TryOnUnderneath({ doc: document, view: parts.view, generatorApi: Generator });
        card.show({});
        expect(document.activeElement.closest('.nexus-under')).not.toBeNull(); // focus moved in
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(document.querySelector('.nexus-under-overlay')).toBeNull();
        expect(document.activeElement).toBe(opener);

        card.show({});
        document.querySelector('.nexus-under-x').click();
        expect(document.querySelector('.nexus-under-overlay')).toBeNull();

        let finish;
        parts.view.underneath = jest.fn(() => new Promise((resolve) => (finish = resolve)));
        card.show({});
        const pending = card.choose('black');
        const overlay = document.querySelector('.nexus-under-overlay');
        overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(document.querySelector('.nexus-under-overlay')).not.toBeNull(); // still working
        finish({ ok: false, why: 'test' });
        await pending;
        document.querySelector('.nexus-under-overlay').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(document.querySelector('.nexus-under-overlay')).toBeNull();
        opener.remove();
    });

    test('says what Forge is doing, then that black is on — only after it is', async () => {
        let finish;
        const parts = build();
        await wearingTheDress(parts);
        parts.view.underneath = jest.fn(() => new Promise((resolve) => (finish = resolve)));
        const card = new TryOnUnderneath({ doc: document, view: parts.view, generatorApi: Generator });
        card.show({ suggested: 'black' });
        const pending = card.choose('black');
        const node = document.querySelector('.nexus-under');
        expect(node.querySelector('[role="status"]').textContent).toMatch(/Asking Forge for black/);
        expect(node.textContent).not.toMatch(/is on/);
        expect(node.querySelector('.nexus-under-primary').disabled).toBe(true);
        const black = {
            ...DRESS,
            id: 'look_black',
            vrmUrl: 'https://f/black.vrm',
            family: 'look_white',
            underneath: { color: 'black', pieces: DRESS.underneath.pieces },
        };
        parts.session.add(black);
        await parts.session.wear(black); // what the real underneath() does before it answers
        finish({ ok: true, why: '' });
        await pending;
        expect(node.querySelector('.nexus-under-done').textContent).toMatch(/Black is on — same dress, same boots/);
        expect([...node.querySelectorAll('button')].map((b) => b.textContent)).toEqual(
            expect.arrayContaining(['Compare with white', 'Save look'])
        );
    });

    test('a failure says why, keeps her look, and offers Try again', async () => {
        const parts = build();
        await wearingTheDress(parts);
        parts.view.underneath = jest.fn(async () => ({ ok: false, why: 'Forge is busy.' }));
        const card = new TryOnUnderneath({ doc: document, view: parts.view, generatorApi: Generator });
        card.show({ suggested: 'black' });
        await card.choose('black');
        const alert = document.querySelector('.nexus-under [role="alert"]');
        expect(alert.textContent).toMatch(/Forge is busy\. Her look is unchanged\./);
        expect(document.querySelector('.nexus-under').textContent).toMatch(/Try again/);
    });

    test('a colour already made for this outfit is Ready', () => {
        const look = { family: 'f', underneath: { color: 'black' } };
        const looks = [look, { family: 'f', underneath: { color: 'white' } }];
        const cards = cardsFor(look, looks, null, Generator.FOUNDATION_COLORS);
        expect(cards.find((c) => c.value === 'white').state).toBe('Ready');
        expect(cards.find((c) => c.value === 'black').state).toBe('Wearing now');
    });
});
