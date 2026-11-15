/**
 * PMA. Private keeps its minimalist card: the Playground chips wait behind one ⋯.
 *
 * The regression this pins: a phone started Private with "A dance", "Take a bow" and more as a
 * rail across the Private heading. The router still owns every chip (it docks its one toolbar
 * into `.nexus-private-action-slot`); the view only keeps that slot in a closed menu until the
 * person opens it.
 */
const Private = require('../../src/features/together/ui/PrivateConversationView.js');
const Templates = require('../../src/experiences/playgrounds/PlaygroundTemplateCatalog.js');
const Moods = require('../../src/experiences/playgrounds/PlaygroundMoodPresets.js');
const Router = require('../../src/experiences/playgrounds/PlaygroundInteractionRouter.js');
require('../../src/features/together/PrivateLocale.js');

if (window.__NEXUS_PLAYGROUND_LIVE) window.__NEXUS_PLAYGROUND_LIVE.detach();

let view;
let router;

function shown(id, rating, owner) {
    window.dispatchEvent(new window.CustomEvent('nexus-world-shown', { detail: { id, base: id, rating, owner } }));
}

const q = (selector) => document.querySelector(`#${Private.ROW_ID} ${selector}`);

beforeEach(() => {
    document.body.innerHTML = '<div class="chat-input-shell"></div><div id="chat-history"></div>';
    view = new Private.View({ doc: document, win: window });
    router = Router.attach({ doc: document, win: window, templates: Templates, moods: Moods });
});

afterEach(() => {
    if (view) view.destroy();
    if (router) router.detach();
    document.body.innerHTML = '';
});

describe('Private more actions', () => {
    test('Private starts with no chip on screen: the menu is closed and never opens by itself', () => {
        shown('private-cabaret', 'private', 'intimate');
        view.mount({ scene: 'Private cabaret' });
        const panel = q('.nexus-private-more-panel');
        const more = q('.nexus-private-more');
        expect(router.bar.parentNode).toBe(q('.nexus-private-action-slot'));
        expect(panel.hidden).toBe(true);
        expect(panel.contains(router.bar)).toBe(true);
        // The heading holds no chip: only the kicker, the pace, the place and the one ⋯.
        expect(q('.nexus-private-heading').querySelectorAll('#nexus-playground-bar button')).toHaveLength(0);
        expect(more.hidden).toBe(false);
        expect(more.getAttribute('aria-expanded')).toBe('false');
        expect(more.getAttribute('aria-label')).toBe('More actions');
        expect(more.getAttribute('aria-controls')).toBe(panel.id);
    });

    test('a scene with nothing to offer shows no ⋯ at all', () => {
        view.mount({ scene: 'Private cabaret' });
        expect(q('.nexus-private-more').hidden).toBe(true);
        expect(q('.nexus-private-more-panel').hidden).toBe(true);
    });

    test('the ⋯ opens the menu with the scene’s real actions, and the conversation is untouched', () => {
        shown('private-cabaret', 'private', 'intimate');
        view.mount({ scene: 'Private cabaret' });
        const log = q('.nexus-private-log');
        const before = { log: log.innerHTML, level: q('.nexus-private-level').textContent };
        q('.nexus-private-more').click();
        const panel = q('.nexus-private-more-panel');
        expect(panel.hidden).toBe(false);
        expect(q('.nexus-private-more').getAttribute('aria-expanded')).toBe('true');
        expect(panel.querySelectorAll('#nexus-playground-bar button')).toHaveLength(router.template.actions.length);
        expect(document.activeElement).toBe(panel.querySelector('#nexus-playground-bar button'));
        expect(log.innerHTML).toBe(before.log);
        expect(q('.nexus-private-level').textContent).toBe(before.level);
        // The pace, the replies' home and End are where they were.
        expect(q('[data-private-action="end"]')).not.toBeNull();
    });

    test('an action still runs through the router, and the menu closes after it', () => {
        shown('private-cabaret', 'private', 'intimate');
        view.mount({ scene: 'Private cabaret' });
        const ran = [];
        const listen = (event) => ran.push(event.detail.actionId);
        window.addEventListener('nexus-playground-action', listen);
        q('.nexus-private-more').click();
        const chip = q('.nexus-private-more-panel #nexus-playground-bar button');
        chip.click();
        window.removeEventListener('nexus-playground-action', listen);
        expect(ran[0]).toBe(router.template.actions[0].id);
        expect(q('.nexus-private-more-panel').hidden).toBe(true);
        expect(q('.nexus-private-more').getAttribute('aria-expanded')).toBe('false');
    });

    test('Close, Escape and a tap outside each close it, and nothing else changes', () => {
        shown('private-cabaret', 'private', 'intimate');
        view.mount({ scene: 'Private cabaret' });
        const panel = q('.nexus-private-more-panel');
        const more = q('.nexus-private-more');

        more.click();
        q('.nexus-private-more-close').click();
        expect(panel.hidden).toBe(true);
        expect(document.activeElement).toBe(more);

        more.click();
        panel.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(panel.hidden).toBe(true);

        more.click();
        q('.nexus-private-log').dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
        expect(panel.hidden).toBe(true);

        more.click();
        more.click();
        expect(panel.hidden).toBe(true);
        expect(document.getElementById(Private.ROW_ID)).not.toBeNull();
        expect(router.bar.parentNode).toBe(q('.nexus-private-action-slot'));
    });

    test('the labels follow the app language', () => {
        const previous = window.AppLanguage;
        window.AppLanguage = { code: 'it-IT' };
        try {
            shown('private-cabaret', 'private', 'intimate');
            view.mount({ scene: 'Private cabaret' });
            expect(q('.nexus-private-more').getAttribute('aria-label')).not.toBe('More actions');
            expect(q('.nexus-private-more-close').textContent).not.toBe('actions.close');
        } finally {
            if (previous) window.AppLanguage = previous;
            else delete window.AppLanguage;
        }
    });

    test('outside Private the Playground chips keep their ordinary place', () => {
        shown('irish-pub', 'general', null);
        expect(router.bar.hidden).toBe(false);
        expect(router.bar.parentNode).toBe(document.querySelector('.chat-input-shell'));
    });

    test('every language names the menu and its Close', () => {
        const locale = window.NEXUS_PRIVATE_LOCALE;
        const codes = ['en-US', 'es-ES', 'it-IT', 'fr-FR', 'de-DE', 'pt-BR', 'ja-JP', 'ko-KR', 'zh-CN'];
        const seen = new Set();
        codes.forEach((code) => {
            const more = locale.t('actions.more', null, code);
            expect(more && more !== 'actions.more').toBeTruthy();
            expect(locale.t('actions.close', null, code)).not.toBe('actions.close');
            seen.add(more);
        });
        expect(seen.size).toBe(codes.length);
    });
});
