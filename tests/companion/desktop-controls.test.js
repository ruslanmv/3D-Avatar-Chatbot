/**
 * DX1. Desktop controls never sit on top of each other, and Close never ends anything.
 *
 * The red Exit chip was absolutely positioned in the avatar card's bottom-left corner — the
 * exact spot of the footer's first button (🎯 Reset Camera) — so a tap meant to reset the view
 * could end Seaside Evening. It is now "End experience" inside the experience sheet, and the
 * conversation panel's status bar is the one other place an experience is ended.
 */
const fs = require('fs');
const path = require('path');
const Marks = require('../../src/companion/ActivityMarks');

const read = (rel) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');

describe('the avatar card has no floating Exit', () => {
    test('End experience is styled inside the sheet only, never positioned over the footer', () => {
        const src = read('src/companion/DestinationBar.js');
        const css = src.slice(src.indexOf('const CSS = `'), src.indexOf('`;', src.indexOf('const CSS = `')));
        // Each CSS rule whose selector names the Exit, with its declarations.
        const exitRules = [...css.matchAll(/([^{}\n][^{\n]*\$\{EXIT_ID\}[^{\n]*)\{([^}]*)\}/g)];
        expect(exitRules.length).toBeGreaterThan(0);
        for (const [, selector, body] of exitRules) {
            expect(body).not.toMatch(/position:\s*(absolute|fixed)/);
            if (!/\[hidden\]|focus-visible|:hover/.test(selector))
                expect(selector).toMatch(/SHEET_ID\} #\$\{EXIT_ID\}/);
        }
        // Not appended to the card itself any more; it goes into the sheet's experience row.
        expect(src).not.toMatch(/host\.appendChild\(exit\)/);
        expect(src).toMatch(/row\.appendChild\(exit\)/);
        expect(src).toMatch(/'End experience'/);
    });
});

describe('the conversation status bar', () => {
    function rig(destination, activity) {
        document.body.innerHTML =
            '<div id="chat-history"></div><div class="chat-input-shell"><textarea></textarea></div>';
        const listeners = [];
        const session = {
            on: (fn) => (listeners.push(fn), () => {}),
            active: () => true,
            source: () => 'together',
            activity: () => activity,
            destination: () => destination,
            end: jest.fn(),
        };
        const marks = Marks.attach({
            doc: document,
            session,
            label: (id) => (id === 'seaside' ? 'Seaside Evening' : id),
        });
        return { marks, session };
    }

    test('it is its own row before the composer, full width, and names what End ends', () => {
        const { marks } = rig('experiences', 'seaside');
        const shell = document.querySelector('.chat-input-shell');
        expect(shell.firstChild).toBe(marks.pill);
        expect(marks.pill.hidden).toBe(false);
        const end = marks.pill.querySelector('button');
        expect(end.textContent).toBe('End experience');
        expect(end.getAttribute('aria-label')).toBe('End Seaside Evening');
        expect(Marks.CSS).toMatch(/width: 100%/);
        expect(Marks.CSS).not.toMatch(new RegExp('#' + Marks.PILL_ID + ' \\{[^}]*position:\\s*(absolute|fixed)'));
    });

    test('a non-experience activity says End, with the activity in its spoken name', () => {
        const { marks } = rig('life', 'relax');
        const end = marks.pill.querySelector('button');
        expect(end.textContent).toBe('End');
        expect(end.getAttribute('aria-label')).toBe('End relax');
    });
});
