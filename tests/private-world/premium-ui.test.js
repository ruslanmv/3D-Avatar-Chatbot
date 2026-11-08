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

describe('PUI-3. the row is the box it lives in; only the transcript gives way', () => {
    /**
     * Read from the stylesheet: jsdom has no layout. Each rule below answers a failure the
     * screenshot harness (tools/qa/private-ui-shots.mjs) measured in a real browser:
     * desktop showed one reply in a half-empty column, phones lost the heading and chip rail
     * off the top of the sheet, landscape and the 320 px phone lost Closer / End off the bottom.
     */
    const css = () => document.getElementById('nexus-private-conversation-styles').textContent;
    const premium = () => css().slice(css().indexOf('PUI-3.'));

    test('no viewport-height or pixel cap on the transcript; the row fills its box at every width', () => {
        view.mount({ scene: 'Private cabaret' });
        expect(premium()).toMatch(
            /#nexus-private-conversation-row\{height:calc\(100% - 14px\);max-height:calc\(100% - 14px\)\}/
        );
        expect(premium()).toMatch(/\.nexus-private-card\{[^}]*max-height:none/);
        expect(premium()).not.toMatch(/\.nexus-private-card\{[^}]*max-height:min\(/);
        expect(premium()).not.toMatch(/#nexus-private-conversation-row\{[^}]*max-height:min\(/);
    });

    test('the transcript may shrink to nothing; End is never what gives way', () => {
        view.mount({ scene: 'Private cabaret' });
        expect(premium()).toMatch(/\.nexus-private-card\{[^}]*min-height:0/);
        // The footer that holds End keeps flex:0 0 auto from the base sheet; nothing overrides it.
        expect(css()).toMatch(/\.nexus-private-bar\{[^}]*flex:0 0 auto/);
        expect(premium()).not.toMatch(/\.nexus-private-bar\{[^}]*(display:none|flex:1)/);
    });

    test('replies are one row of pills, and touch controls are 44 px', () => {
        view.mount({ scene: 'Private cabaret' });
        expect(premium()).toMatch(/\.nexus-private-choices\{flex-direction:row/);
        expect(premium()).toMatch(/@media\(pointer:coarse\)\{[^}]*#nexus-playground-bar button[^}]*min-height:44px/);
    });

    test('on a phone or a short screen the heading and the chip rail share one line', () => {
        view.mount({ scene: 'Private cabaret' });
        expect(premium()).toMatch(/@media\(max-height:560px\),\(max-width:767px\)\{/);
        expect(premium()).toMatch(
            /:has\(\.nexus-private-action-slot:not\(:empty\)\) \.nexus-private-action-slot\{grid-column:2;grid-row:1/
        );
    });
});
