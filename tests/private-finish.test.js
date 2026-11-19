/**
 * UN35. Finishing from the ⋯ menu: a chip per place the look can show, at the closest step only,
 * and each chip's line, in every language, parsed back to its own place — so a tap is exactly the
 * person's own words, gated and shown on her the same way.
 *
 * Properties, not prose: rewording a chip must not fail these; a chip whose line parses to another
 * place (or to nothing), or a chip drawn where it could only be refused, must.
 */
const Intent = require('../src/experiences/private/PrivateActionIntent.js');
const Policy = require('../src/experiences/private/PrivateActionPolicy.js');

const PLACES = ['back', 'inside', 'both', 'ass', 'all'];
const finish = (said) => {
    const r = Intent.parse(said, {});
    return r && r.name === 'body.finish' ? r.params.where : null;
};

describe('UN35 every finish chip line is its own place, in every language', () => {
    const Locale = require('../src/features/together/PrivateLocale.js');
    for (const lang of Locale.languages()) {
        test.each(PLACES)(`${lang}: the %s chip sends a line that parses back to it`, (key) => {
            const line = Locale.t(`finish.${key}.say`, null, lang);
            const label = Locale.t(`finish.${key}.label`, null, lang);
            expect(line).not.toBe(`finish.${key}.say`);
            expect(label).not.toBe(`finish.${key}.label`);
            expect(finish(line)).toBe(key);
        });
    }

    test('a finish line is a finish, never a position', () => {
        const parsed = Intent.parse("I'm cumming on your back", {});
        expect(parsed.name).toBe('body.finish');
        expect(Policy.validate(parsed.name, parsed.params).ok).toBe(true);
    });
});

describe('UN35 the ⋯ menu: finish chips', () => {
    const Private = require('../src/features/together/ui/PrivateConversationView.js');
    require('../src/features/together/PrivateLocale.js');
    let view;
    let spicy;
    const chips = () =>
        Array.from(document.querySelectorAll(`#${Private.ROW_ID} .nexus-private-finish .nexus-private-position`));

    beforeEach(() => {
        document.body.innerHTML = '<div class="chat-input-shell"></div><div id="chat-history"></div>';
        spicy = true;
        window.NEXUS_SPICY = { isEnabled: () => spicy };
        window.NEXUS_PRIVATE_ACTION_POLICY = Policy;
        view = new Private.View({ doc: document, win: window });
        view.mount({ scene: 'Private cabaret' });
    });
    afterEach(() => {
        if (view) view.destroy();
        delete window.NEXUS_SPICY;
        document.body.innerHTML = '';
    });

    test('only the places the bridge reports, only at the closest step, and a tap is their line', () => {
        const sent = [];
        const handlers = { onPosition: (line, key) => sent.push([line, key]) };
        view.showActions({ finishPlaces: ['back', 'inside'] }, handlers);
        view.setPace({ level: 3, steps: [], hasLadder: false });
        expect(chips()).toHaveLength(0);
        view.setPace({ level: 4, steps: [], hasLadder: false });
        expect(chips().map((b) => b.dataset.privateFinish)).toEqual(['back', 'inside']);
        chips()[0].click();
        expect(sent).toEqual([["I'm cumming on your back", 'back']]);
        // The look can show nothing: no chips. Spicy off: no chips.
        view.showActions({ finishPlaces: [] }, handlers);
        expect(chips()).toHaveLength(0);
        spicy = false;
        view.showActions({ finishPlaces: ['back'] }, handlers);
        expect(chips()).toHaveLength(0);
    });
});
