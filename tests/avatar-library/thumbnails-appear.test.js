/**
 * V5. A thumbnail shows on its card the moment it is made, not after a reload.
 *
 * The first visit renders every core avatar's thumbnail one after another and redrew the grid
 * only when all were done — and an avatar that threw ended the run before that redraw — so the
 * cards kept their emoji placeholders until the person reloaded the page. vrm-manager.js is a
 * plain script Jest cannot require: the wiring is pinned in its source, and showCardPreview is
 * run from its own text against real DOM cards.
 */

/* global describe, test, expect, beforeEach */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const manager = fs.readFileSync(path.join(ROOT, 'vrm-manager.js'), 'utf8');

function topLevel(head) {
    const body = manager.slice(manager.indexOf(head));
    return body.slice(0, body.indexOf('\n}\n') + 2);
}

function method(head) {
    const body = manager.slice(manager.indexOf(head));
    return body.slice(0, body.indexOf('\n    },'));
}

// eslint-disable-next-line no-new-func
const showCardPreview = new Function(`${topLevel('function showCardPreview(')}; return showCardPreview;`)();

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

function card(id, icon = '🧑') {
    const c = document.createElement('div');
    c.className = 'vm-card';
    c.dataset.avatarId = id;
    c.innerHTML = `<div class="vm-card-preview vm-placeholder">${icon}</div><h3>${id}</h3>`;
    return c;
}

describe('showCardPreview', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    test("replaces the placeholder on every card for that avatar, and only that avatar's", () => {
        const mine = [card('core-a'), card('core-a')]; // My Avatars and Browse Catalog
        const other = card('core-b');
        [...mine, other].forEach((c) => document.body.appendChild(c));

        expect(showCardPreview('core-a', PNG, 'AvatarSample A')).toBe(2);

        mine.forEach((c) => {
            const img = c.querySelector('.vm-card-preview');
            expect(img.tagName).toBe('IMG');
            expect(img.getAttribute('src')).toBe(PNG);
            expect(img.alt).toBe('AvatarSample A');
            expect(c.querySelector('h3').textContent).toBe('core-a'); // the rest of the card is kept
        });
        expect(other.querySelector('.vm-card-preview').classList.contains('vm-placeholder')).toBe(true);
    });

    test('a picture that will not load goes back to the icon it replaced', () => {
        const c = card('core-a', '🧑‍🎤');
        document.body.appendChild(c);
        showCardPreview('core-a', PNG, 'A');
        c.querySelector('img').dispatchEvent(new Event('error'));
        const back = c.querySelector('.vm-card-preview');
        expect(back.tagName).toBe('DIV');
        expect(back.textContent).toBe('🧑‍🎤');
    });

    test('does nothing without an id or a picture, or when the card already shows it', () => {
        document.body.appendChild(card('core-a'));
        expect(showCardPreview('', PNG)).toBe(0);
        expect(showCardPreview('core-a', '')).toBe(0);
        expect(showCardPreview('core-a', PNG)).toBe(1);
        expect(showCardPreview('core-a', PNG)).toBe(0);
    });
});

describe('wiring', () => {
    test('every card says which avatar it shows', () => {
        expect(method('    buildCard(item, isInstalledView = false) {')).toMatch(/card\.dataset\.avatarId = item\.id;/);
    });

    test('a finished thumbnail goes on screen before it is saved, for every caller', () => {
        const save = topLevel('async function generateAndSaveThumbnail(');
        expect(save.indexOf('showCardPreview(item.id, preview')).toBeGreaterThan(-1);
        expect(save.indexOf('showCardPreview(')).toBeLessThan(save.indexOf('await saveThumbToDB('));
    });

    test('one avatar that fails does not end the first-visit run', () => {
        const auto = method('    async autoGenerateMissingThumbnails() {');
        const loop = auto.slice(auto.indexOf('for (const item of valid)'));
        expect(loop).toMatch(/try \{\s*await generateAndSaveThumbnail\(item\);\s*\} catch/);
    });
});
