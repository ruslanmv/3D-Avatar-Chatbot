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
        // The desktop rule, at the start of a line; the phone rule (body.nexus-mobile…) is fixed on purpose.
        expect(Marks.CSS).not.toMatch(
            new RegExp('(^|\\n)#' + Marks.PILL_ID + ' \\{[^}]*position:\\s*(absolute|fixed)')
        );
    });

    test('a non-experience activity says End, with the activity in its spoken name', () => {
        const { marks } = rig('life', 'relax');
        const end = marks.pill.querySelector('button');
        expect(end.textContent).toBe('End');
        expect(end.getAttribute('aria-label')).toBe('End relax');
    });
});

// ── DX2: phones ──────────────────────────────────────────────────────────────

const Bar = require('../../src/companion/DestinationBar');

describe('on a phone the experience is a mini-player above the chat sheet', () => {
    test('it docks 8 px above the chat sheet, wherever the sheet is', () => {
        expect(Marks.dockOffset(664, 576)).toBe(96);
        expect(Marks.dockOffset(664, 300)).toBe(372); // sheet expanded
        expect(Marks.dockOffset(664, 0)).toBeNull();
        expect(Marks.dockOffset(0, 300)).toBeNull();
    });
    test('portrait phones only; landscape and desktop keep it in the composer', () => {
        expect(Marks.CSS).toMatch(/body\.nexus-mobile\.nexus-portrait #nexus-activity-pill \{[^}]*position: fixed/);
        const { marks } = (() => {
            document.body.className = 'nexus-mobile';
            document.body.innerHTML = '<div class="chat-card"></div><div class="chat-input-shell"></div>';
            const session = {
                on: () => () => {},
                active: () => true,
                source: () => 'together',
                activity: () => 'seaside',
                destination: () => 'experiences',
            };
            return { marks: Marks.attach({ doc: document, session, label: () => 'Seaside Evening' }) };
        })();
        expect(marks.pill.parentNode).toBe(document.querySelector('.chat-input-shell')); // landscape
        document.body.classList.add('nexus-portrait');
        marks.refresh();
        expect(marks.pill.parentNode).toBe(document.body); // out of the clipped sheet
        document.body.className = '';
    });
    test('fingers get 44 px targets', () => {
        expect(Marks.CSS).toMatch(/@media \(pointer: coarse\)[\s\S]*min-height: 44px/);
        expect(Bar.CSS).toMatch(/@media \(pointer: coarse\)[\s\S]*min-height: 44px/);
    });
    test('no backtick inside either template literal of CSS', () => {
        // One did once: it closed the string and turned the rest of the stylesheet into code.
        for (const css of [Marks.CSS, Bar.CSS]) expect(css).toMatch(/\}\s*$/);
        expect(Marks.CSS).toMatch(/pointer: coarse/);
    });
});

describe('the experience sheet sits above the phone chat sheet', () => {
    const card = { top: 60, bottom: 664, left: 0, right: 390 };
    test('above the chat, its height capped so her face stays clear', () => {
        const fit = Bar.sheetFit(card, { top: 576, bottom: 664, left: 0, right: 390 });
        expect(fit.bottom).toBe(664 - 576 + 8);
        expect(fit.maxHeight).toBe(Math.round((576 - 60) * 0.55));
    });
    test('on a desktop the chat is beside the card: CSS decides', () => {
        expect(Bar.sheetFit(card, { top: 60, bottom: 664, left: 400, right: 900 })).toBeNull();
    });
});

describe('phones held sideways keep her', () => {
    const css = fs.readFileSync(path.join(__dirname, '../../styles/main.css'), 'utf8');
    test('the keyboard rule hides her only while a text field has focus', () => {
        const rule = css.slice(css.indexOf('@media (max-height: 450px) and (max-width: 767px)'));
        const block = rule.slice(0, rule.indexOf('\n}\n'));
        expect(block).toMatch(/html\.nexus-keyboard-open \.avatar-panel/);
        expect(block).not.toMatch(/\n\s{4}\.avatar-panel \{/);
        expect(read('src/MobileChatOverlay.js')).toMatch(/nexus-keyboard-open/);
    });
});
