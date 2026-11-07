/**
 * Premium Private UI: reuse the Playground action router without a second chip engine.
 * Render in the Private conversation, never across the avatar or without the Private card.
 * jsdom tests DOM ownership, not GPU screenshot quality.
 */
const Private = require('../../src/features/together/ui/PrivateConversationView.js');
const Templates = require('../../src/experiences/playgrounds/PlaygroundTemplateCatalog.js');
const Moods = require('../../src/experiences/playgrounds/PlaygroundMoodPresets.js');
const Router = require('../../src/experiences/playgrounds/PlaygroundInteractionRouter.js');

if (window.__NEXUS_PLAYGROUND_LIVE) window.__NEXUS_PLAYGROUND_LIVE.detach();

let view;
let router;

function shown(id, rating, owner) {
    window.dispatchEvent(
        new window.CustomEvent('nexus-world-shown', {
            detail: { id, base: id, rating, owner },
        })
    );
}

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

describe('Premium Private action rail', () => {
    test('Private venue chips do not cover the avatar when the Private surface has not mounted', () => {
        shown('private-cabaret', 'private', 'intimate');
        expect(router.template).toBeTruthy();
        expect(router.bar.hidden).toBe(true);
        expect(document.body.contains(router.bar)).toBe(false);
    });

    test('a verified Private venue reuses one chip toolbar in the Private card', () => {
        shown('private-cabaret', 'private', 'intimate');
        expect(view.mount({ scene: 'Private cabaret' })).toBe(true);
        const slot = document.querySelector('#nexus-private-conversation-row .nexus-private-action-slot');
        expect(slot).not.toBeNull();
        expect(router.bar.parentNode).toBe(slot);
        expect(router.bar.hidden).toBe(false);
        expect(router.bar.getAttribute('role')).toBe('toolbar');
        expect(router.bar.dataset.rating).toBe('private');
        expect(router.bar.querySelectorAll('button').length).toBe(router.template.actions.length);
        expect(document.querySelectorAll('#nexus-playground-bar')).toHaveLength(1);
    });

    test('removing the Private view immediately hides the Private chips', () => {
        view.mount({ scene: 'Private cabaret' });
        shown('private-cabaret', 'private', 'intimate');
        expect(router.bar.hidden).toBe(false);
        view.destroy();
        expect(router.bar.hidden).toBe(true);
        expect(document.getElementById('nexus-private-conversation-row')).toBeNull();
    });

    test('Private still exposes real consent controls, conversation and current pace', () => {
        expect(view.mount({ scene: 'Private cabaret' })).toBe(true);
        const row = document.getElementById(Private.ROW_ID);
        expect(row.querySelector('.nexus-private-log')).not.toBeNull();
        expect(row.querySelector('[data-private-action="end"]')).not.toBeNull();
        expect(row.querySelector('.nexus-private-heading-title')).not.toBeNull();
        expect(row.querySelector('.nexus-private-level')).not.toBeNull();
        expect(document.getElementById('nexus-private-conversation-styles').textContent).toContain(
            'Premium Private chrome'
        );
    });

    test('when the world changes, general Experience chips return to their ordinary surface', () => {
        view.mount({ scene: 'Private cabaret' });
        shown('private-cabaret', 'private', 'intimate');
        shown('irish-pub', 'general', null);
        expect(router.bar.hidden).toBe(false);
        expect(router.bar.parentNode).toBe(document.querySelector('.chat-input-shell'));
        expect(document.querySelector('.nexus-private-action-slot #nexus-playground-bar')).toBeNull();
    });
});
