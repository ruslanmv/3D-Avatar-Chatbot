/**
 * FC1. The "Underneath" row in Customize: one radio group, a word on every chip, the choice
 * kept at once and read by the generator for the next look.
 */
global.NEXUS_TRY_ON_GENERATOR = require('../../src/wardrobe/TryOnGenerator.js');
const { ForgeGarmentCatalogWorkspace } = require('../../src/wardrobe/ForgeGarmentCatalogWorkspace');

describe('choosing what she wears underneath', () => {
    let workspace;

    beforeEach(async () => {
        localStorage.clear();
        document.body.innerHTML = '<div class="chat-panel"><div class="chat-card"></div></div>';
        workspace = new ForgeGarmentCatalogWorkspace({
            doc: document,
            client: { getGarmentCatalog: async () => ({ categories: [] }) },
            view: null,
        });
        await workspace.open();
    });

    afterEach(() => workspace.destroy());

    const group = () => document.querySelector('[role="radiogroup"]');
    const chip = (name) => [...group().querySelectorAll('[role="radio"]')].find((c) => c.textContent === name);

    test('every colour is offered by name, beige checked until another is chosen', () => {
        expect(group().getAttribute('aria-labelledby')).toBeTruthy();
        const names = [...group().querySelectorAll('[role="radio"]')].map((c) => c.textContent);
        expect(names).toEqual(['Beige', 'Nude', 'White', 'Black', 'Red', 'Pink']);
        expect(chip('Beige').getAttribute('aria-checked')).toBe('true');
        expect(group().textContent).toMatch(/next look/);
    });

    test('a choice is kept at once, without applying a garment, and survives reopening', async () => {
        chip('Black').click();
        expect(chip('Black').getAttribute('aria-checked')).toBe('true');
        expect(chip('Beige').getAttribute('aria-checked')).toBe('false');
        expect(global.NEXUS_TRY_ON_GENERATOR.foundationColor()).toBe('black');
        workspace.close();
        await workspace.open();
        expect(chip('Black').getAttribute('aria-checked')).toBe('true');
        chip('White').click();
        expect(global.NEXUS_TRY_ON_GENERATOR.foundationColor()).toBe('white');
    });
});
