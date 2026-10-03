/**
 * W16. Her wardrobe as a tool: an MCP-shaped definition, one executor, reached from the chat
 * by a tag that is stripped once, run at most once, re-checked when it runs, and never offers
 * what she may not be offered.
 */
const Tool = require('../../src/wardrobe/WardrobeTool.js');
const { OutfitDictionary } = require('../../src/wardrobe/OutfitDictionary.js');
const SNAPSHOT = require('../../assets/wardrobe/outfits.json');

async function dictionary(art) {
    const library = {
        available: true,
        outfits: () => Promise.resolve(SNAPSHOT),
        bodyArt: () => Promise.resolve(art || { placements: [], designs: [] }),
    };
    const dict = new OutfitDictionary({ library });
    await dict.load();
    await dict._loadBodyArt(library);
    return dict;
}

function activity({ open = false, looks = ['Crop top & jeans'], current = null, running = false } = {}) {
    return {
        request: jest.fn(async () => ({ ok: true, why: '' })),
        availability: () => ({ ok: true, why: '' }),
        privateOpen: () => open,
        shelf: () => ({ looks, current, running }),
    };
}

const wardrobe = { service: { remoteEnabled: true } };

beforeEach(() => {
    localStorage.clear();
    Tool.setEnabled(true);
});

describe('WardrobeTool — the tool', () => {
    test('is described the way an MCP server describes a tool', () => {
        Tool.TOOLS.forEach((tool) => {
            expect(tool.name).toMatch(/^wardrobe_[a-z]+$/);
            expect(typeof tool.description).toBe('string');
            expect(tool.inputSchema.type).toBe('object');
        });
    });

    test('call routes to Try-On and is refused when the switch is off', async () => {
        const a = activity();
        expect(await Tool.call('wardrobe_wear', { outfit: 'little-black-dress' }, { activity: a })).toEqual({
            ok: true,
            why: '',
        });
        expect(a.request).toHaveBeenCalledWith('wear', { outfit: 'little-black-dress' });
        Tool.setEnabled(false);
        expect((await Tool.call('wardrobe_wear', { outfit: 'x' }, { activity: a })).ok).toBe(false);
        expect(a.request).toHaveBeenCalledTimes(1);
        expect((await Tool.call('wardrobe_nope', {}, { activity: a })).ok).toBe(false);
    });
});

describe('WardrobeTool — what she is told', () => {
    test('the dictionary by group, her shelf and what she has on; nothing private while closed', async () => {
        const dict = await dictionary({
            placements: [{ id: 'lower-back', name: 'Lower back' }],
            designs: [{ id: 'lotus-ornament-01', name: 'Lotus', placements: ['lower-back'] }],
        });
        const closed = Tool.systemPromptSuffix({ dictionary: dict, activity: activity(), wardrobe });
        expect(closed).toMatch(/YOUR WARDROBE/);
        expect(closed).toMatch(/little-black-dress = Little black dress/);
        expect(closed).toMatch(/Crop top & jeans/);
        expect(closed).not.toMatch(/lingerie|bikini|stockings|tattoo/i);

        const open = Tool.systemPromptSuffix({ dictionary: dict, activity: activity({ open: true }), wardrobe });
        expect(open).toMatch(/lace-lingerie-set/);
        expect(open).toMatch(/action="tattoo"/);
        expect(open).toMatch(/lotus-ornament-01/);
    });

    test('a haul in progress makes her the host', async () => {
        const dict = await dictionary();
        const text = Tool.systemPromptSuffix({ dictionary: dict, activity: activity({ running: true }), wardrobe });
        expect(text).toMatch(/TRY-ON HAUL IS ON/);
        expect(text).toMatch(/keep or return/);
    });

    test('empty when it could not run: switch off, no Try-On, nothing to wear', async () => {
        const dict = await dictionary();
        Tool.setEnabled(false);
        expect(Tool.systemPromptSuffix({ dictionary: dict, activity: activity(), wardrobe })).toBe('');
        Tool.setEnabled(true);
        expect(Tool.systemPromptSuffix({ dictionary: dict, activity: null, wardrobe })).toBe('');
        expect(
            Tool.systemPromptSuffix({
                dictionary: dict,
                activity: activity({ looks: [] }),
                wardrobe: { service: { remoteEnabled: false } },
            })
        ).toBe('');
    });

    test('without Forge she is told only about her saved looks', async () => {
        const dict = await dictionary();
        const text = Tool.systemPromptSuffix({
            dictionary: dict,
            activity: activity(),
            wardrobe: { service: { remoteEnabled: false } },
        });
        expect(text).toMatch(/action="wear" look=/);
        expect(text).not.toMatch(/action="create"|little-black-dress/);
    });
});

describe('WardrobeTool — the tag', () => {
    test('stripped from what is shown and run once', async () => {
        const a = activity();
        const shown = Tool.consume(
            'Let me try the little black dress!\n<wardrobe action="wear" outfit="little-black-dress"/>',
            { activity: a }
        );
        expect(shown).toBe('Let me try the little black dress!');
        await Promise.resolve();
        expect(a.request).toHaveBeenCalledWith('wear', { outfit: 'little-black-dress' });
    });

    test('at most one per reply: the rest are stripped and never run', () => {
        const out = Tool.extract('Two! <wardrobe action="create" prompt="red midi dress"/> <wardrobe action="keep"/>');
        expect(out.call).toEqual({ name: 'wardrobe_create', args: { prompt: 'red midi dress' } });
        expect(out.extra).toBe(1);
        expect(out.clean).toBe('Two!');
    });

    test.each([
        ['<wardrobe action="wear" outfit="x" url="http://evil"/>', /unknown attribute/],
        ['<wardrobe action="delete"/>', /unknown action/],
        ['<wardrobe action="create" prompt="<script>"/>', null],
        ['<wardrobe action="wear"/>', /needs an outfit or a look/],
        ['<wardrobe action="tattoo" design="../x" placement="nape"/>', /design and a placement/],
    ])('%s is stripped and refused', (tag, reason) => {
        const out = Tool.extract('Okay. ' + tag);
        expect(out.call).toBeNull();
        // Markup inside a value never even reads as a tag; it is scrubbed as a fragment.
        if (reason) expect(out.rejected).toMatch(reason);
        expect(out.clean).not.toMatch(/wardrobe/);
    });

    test('a bodied, unclosed or bare tag never shows', () => {
        expect(Tool.scrub('Hi <wardrobe action="keep">http://x</wardrobe> there')).toBe('Hi there');
        expect(Tool.scrub('Hi <wardrobe action="wear" outfit="')).toBe('Hi');
        expect(Tool.scrub('Sure.\nwardrobe action="keep"')).toBe('Sure.');
    });

    test('the switch is re-read when the tag runs, not when the prompt was built', async () => {
        const a = activity();
        Tool.setEnabled(false);
        expect(Tool.consume('Sure. <wardrobe action="undo"/>', { activity: a })).toBe('Sure.');
        await Promise.resolve();
        expect(a.request).not.toHaveBeenCalled();
    });
});
