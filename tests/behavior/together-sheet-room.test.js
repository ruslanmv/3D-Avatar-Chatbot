/**
 * "Open Together with the chat history full and Together is not shown — the middle is broken."
 *
 * The sheet and the chat overlay both want the bottom of a phone, and the sheet was the one
 * giving way. `composerInset` reserves the space bottom furniture occupies, and `.chat-panel`
 * expanded is bottom-anchored and most of the screen — so the reservation came out around 70%,
 * the sheet was told `bottom: 70%` with a max-height of what was left, and the result was a
 * clipped sliver pinned to the top of the phone showing two and a half rows of eight tiles.
 *
 * Two fixes, tested here as two properties:
 *
 *   1. a surface is not furniture — a candidate taller than half the viewport is something the
 *      sheet should be drawn over, not something it should sit above;
 *   2. opening Together collapses the transcript and closing puts it back, because whoever
 *      pressed Together is looking at Together.
 */

/* global describe, test, expect, beforeEach, afterEach, jest */

const inset = require('../../src/features/together/ui/composerInset.js');
const Launcher = require('../../src/features/together/ui/TogetherLauncher.js');
const TogetherPanel = require('../../src/features/together/ui/TogetherPanel.js');

/** A phone-sized document whose only bottom furniture is what the test names. */
function phone({ height = 915, width = 412 } = {}) {
    const root = { style: new Map() };
    const doc = {
        documentElement: {
            style: {
                setProperty: (k, v) => root.style.set(k, v),
                removeProperty: (k) => root.style.delete(k),
                getPropertyValue: (k) => root.style.get(k) || '',
            },
        },
        querySelector: () => null,
    };
    const win = { innerWidth: width, innerHeight: height, visualViewport: null };
    return { doc, win, read: () => root.style.get('--nexus-composer-inset') || '' };
}

function rect({ top, height, bottom }) {
    return { getBoundingClientRect: () => ({ top, bottom, height, left: 0, right: 412 }) };
}

describe('a surface is not bottom furniture', () => {
    test('a composer bar is reserved', () => {
        const { doc, win, read } = phone();
        doc.querySelector = (sel) => (sel === '.chat-input-shell' ? rect({ top: 839, bottom: 915, height: 76 }) : null);
        inset.apply(doc, win);
        expect(read()).toBe('76px');
    });

    test('an expanded chat overlay is not', () => {
        // The reported bug, as a number: 70% of the screen reserved, leaving the sheet
        // `min(62dvh, 30dvh - 4.5rem)` — a sliver — and pushing it to the top of the phone.
        const { doc, win, read } = phone();
        doc.querySelector = (sel) => {
            if (sel === '.chat-input-shell') return rect({ top: 839, bottom: 915, height: 76 });
            if (sel === '.chat-panel') return rect({ top: 275, bottom: 915, height: 640 });
            return null;
        };
        inset.apply(doc, win);
        expect(read()).toBe('76px');
    });

    test('a composer grown under an open keyboard is still reserved', () => {
        // The visual viewport shrinks under the keyboard, so the bar is a much larger
        // fraction of it. A threshold that ignored this would break the case the module
        // was originally written for.
        const { doc, win, read } = phone();
        doc.querySelector = (sel) =>
            sel === '.chat-input-shell' ? rect({ top: 600, bottom: 915, height: 315 }) : null;
        inset.apply(doc, win);
        expect(read()).toBe('315px');
    });

    test('the reservation can never strand the sheet off screen', () => {
        const { doc, win, read } = phone();
        doc.querySelector = (sel) => (sel === '.chat-panel' ? rect({ top: 10, bottom: 915, height: 905 }) : null);
        inset.apply(doc, win);
        expect(Number.parseInt(read(), 10)).toBeLessThanOrEqual(Math.round(915 * 0.5));
    });
});

describe('opening Together gives it the room', () => {
    let launcher;

    function page({ collapsed = false, width = 412 } = {}) {
        document.body.innerHTML = `
            <div class="avatar-card">
                <div class="avatar-footer-actions"><div class="avatar-footer-right"></div></div>
            </div>
            <section class="chat-panel${collapsed ? ' chat-overlay--collapsed' : ''}">
                <button id="chat-overlay-toggle" type="button">Toggle</button>
                <div id="chat-history"></div>
            </section>`;
        const panel = document.querySelector('.chat-panel');
        document
            .getElementById('chat-overlay-toggle')
            .addEventListener('click', () => panel.classList.toggle('chat-overlay--collapsed'));
        window.innerWidth = width;
        const together = TogetherPanel.attach({
            consent: { state: 'idle', onChange: () => () => {}, revoke: () => true },
            doc: document,
            win: window,
        });
        launcher = Launcher.attach({ panel: together, doc: document });
        return { panel, together };
    }

    afterEach(() => {
        if (launcher && typeof launcher.detach === 'function') launcher.detach();
        launcher = null;
        document.body.innerHTML = '';
        window.innerWidth = 1024;
    });

    test('an expanded transcript is collapsed, and restored on close', () => {
        const { panel } = page({ collapsed: false });
        expect(panel.classList.contains('chat-overlay--collapsed')).toBe(false);

        launcher.open();
        expect(panel.classList.contains('chat-overlay--collapsed')).toBe(true);

        launcher.close();
        expect(panel.classList.contains('chat-overlay--collapsed')).toBe(false);
    });

    test('a transcript that was already collapsed is left collapsed', () => {
        const { panel } = page({ collapsed: true });
        launcher.open();
        expect(panel.classList.contains('chat-overlay--collapsed')).toBe(true);
        launcher.close();
        // Not expanded on the way out: restore means "as it was", not "open".
        expect(panel.classList.contains('chat-overlay--collapsed')).toBe(true);
    });

    test('something else expanding it in between is not undone', () => {
        // PrivateConversationView expands the transcript when a session mounts, because its
        // card lives in the history. Collapsing it on the way out would fight that.
        const { panel } = page({ collapsed: false });
        launcher.open();
        expect(panel.classList.contains('chat-overlay--collapsed')).toBe(true);

        document.getElementById('chat-overlay-toggle').click();
        expect(panel.classList.contains('chat-overlay--collapsed')).toBe(false);

        launcher.close();
        expect(panel.classList.contains('chat-overlay--collapsed')).toBe(false);
    });

    test('opening twice does not lose the original state', () => {
        const { panel } = page({ collapsed: false });
        launcher.open();
        launcher.open();
        launcher.close();
        expect(panel.classList.contains('chat-overlay--collapsed')).toBe(false);
    });

    test('desktop is left alone — the panel is a card beside the avatar there', () => {
        const { panel } = page({ collapsed: false, width: 1280 });
        launcher.open();
        expect(panel.classList.contains('chat-overlay--collapsed')).toBe(false);
        launcher.close();
        expect(panel.classList.contains('chat-overlay--collapsed')).toBe(false);
    });
});
