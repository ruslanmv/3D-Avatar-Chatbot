/**
 * NL2. Her room in normal light: the person's choice, remembered, applied to each private room
 * shown, flipped live from the ⋯ chip or Settings; off gives the room its own light back.
 */
const Moods = require('../src/experiences/playgrounds/PlaygroundMoodPresets.js');
const RL = require('../src/experiences/private/PrivateRoomLight.js');

describe('NL2. the room light in Private', () => {
    let moods;
    let off;
    const onMood = (e) => moods.push(e.detail);
    const shown = (detail) => window.dispatchEvent(new CustomEvent('nexus-world-shown', { detail }));

    beforeEach(() => {
        localStorage.clear();
        window.NEXUS_PLAYGROUND_MOODS = Moods;
        moods = [];
        window.addEventListener('nexus-world-mood', onMood);
        off = RL.install(window);
    });
    afterEach(() => {
        off();
        window.removeEventListener('nexus-world-mood', onMood);
        delete window.NEXUS_PLAYGROUND_MOODS;
    });

    test('off by default: a private room keeps its own light', () => {
        expect(RL.isNormal()).toBe(false);
        shown({ id: 'window-room', rating: 'private' });
        expect(moods).toEqual([]);
    });

    test('chosen, every private room shown gets normal light (sky, fog and floor too); public ones never', () => {
        RL.setNormal(true, window);
        expect(localStorage.getItem(RL.STORAGE_KEY)).toBe('normal');
        shown({ id: 'window-room', rating: 'private' });
        expect(moods.at(-1)).toMatchObject({
            light: Moods.get('normal-room').light,
            room: Moods.get('normal-room').room,
        });
        const n = moods.length;
        shown({ id: 'irish-pub', rating: 'general' });
        expect(moods.length).toBe(n);
    });

    test('flipped in the middle of an evening: at once, and off gives the room its own light back', () => {
        shown({ id: 'window-room', rating: 'private' });
        RL.setNormal(true, window);
        expect(moods.at(-1).room).toBeTruthy();
        expect(moods.at(-1).instant).toBe(false); // blended mid-evening, never a jump (Meta comfort)
        RL.setNormal(false, window);
        expect(moods.at(-1)).toMatchObject({ light: null, room: null });
        expect(RL.isNormal()).toBe(false);
    });

    test('the Settings row follows the choice and changes it', () => {
        document.body.innerHTML = '<div class="config-section"><input id="spicy-mode-toggle" type="checkbox"></div>';
        const box = RL.mountSetting(document);
        expect(box.checked).toBe(false);
        box.checked = true;
        box.dispatchEvent(new Event('change'));
        expect(RL.isNormal()).toBe(true);
        RL.setNormal(false, window);
        expect(box.checked).toBe(false);
        document.body.innerHTML = '';
    });

    test('a ⋯ chip label in every language', () => {
        const Locale = require('../src/features/together/PrivateLocale.js');
        for (const lang of ['en-US', 'it-IT', 'es-ES', 'fr-FR', 'de-DE', 'pt-BR', 'ja-JP', 'ko-KR', 'zh-CN']) {
            const t = (k) => Locale.t(k, lang);
            expect(t('light.normal.label')).toMatch(/💡/);
            expect(t('light.room.label')).toMatch(/💡/);
            expect(t('light.normal.label')).not.toBe(t('light.room.label'));
        }
    });
});
