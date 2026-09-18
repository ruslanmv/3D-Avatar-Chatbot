'use strict';

/**
 * Regression: Scene Tale must never take ownership of MobileChatOverlay.
 *
 * The native mobile chat remains the same three-state touch/dropdown surface it was before
 * Together/Scene Tale existed. Scene Tale may ask that surface to open by clicking its existing
 * toggle, but it may not suspend listeners, replace classes, hide the handle, or write inline
 * display overrides into chat-main/chat-history.
 */

/* global describe, test, expect, beforeEach, afterEach, jest */

window.__NEXUS_SCENE_TALE_MOBILE_NOAUTO__ = true;
const MobileMode = require('../../src/features/together/ui/SceneTaleMobileMode.js');

function flush() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function mountMobileChat() {
    document.documentElement.className = 'is-mobile';
    document.body.innerHTML = `
        <section class="chat-panel">
            <button id="chat-overlay-handle" type="button">handle</button>
            <button id="chat-overlay-toggle" type="button">toggle</button>
            <main class="chat-main">
                <div id="chat-history" class="chat-history">
                    <div id="nexus-scene-tale-hud">
                        <div class="nexus-story-shell">
                            <div class="nexus-story-heading"><div class="nexus-story-heading-title">The Light That Stayed</div></div>
                            <div class="nexus-story-card">
                                <div class="nexus-story-choice-title">What would you like to do?</div>
                                <div class="nexus-story-options">
                                    <button class="nexus-story-option">A confession</button>
                                    <button class="nexus-story-option">A goodbye</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </main>
            <div class="chat-input-shell"><input id="speech-text" /></div>
        </section>
    `;
}

function mobileMatchMedia(query) {
    return {
        matches: /max-width\s*:\s*767px/.test(String(query)),
        media: String(query),
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
    };
}

async function bootOriginalOverlay() {
    jest.resetModules();
    require('../../src/MobileChatOverlay.js');
    window.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
}

beforeEach(() => {
    mountMobileChat();
    window.matchMedia = jest.fn(mobileMatchMedia);
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
    window.NEXUS_BD = {
        togetherPanel: {
            activities: new Map([
                [
                    'playground',
                    {
                        player: {
                            state: 'waiting-choice',
                            plan: { sceneLabel: 'Ocean · Moonlight' },
                            pause: jest.fn(),
                        },
                    },
                ],
            ]),
        },
    };
});

afterEach(() => {
    MobileMode.detach();
    delete window.NEXUS_BD;
    document.documentElement.className = '';
    document.body.innerHTML = '';
    jest.resetModules();
});

describe('Mobile chat remains authoritative during Scene Tale', () => {
    test('Scene Tale opens a collapsed chat through the existing toggle and leaves the dropdown cycle intact', async () => {
        await bootOriginalOverlay();
        const panel = document.querySelector('.chat-panel');
        const toggle = document.getElementById('chat-overlay-toggle');
        const handle = document.getElementById('chat-overlay-handle');
        const main = panel.querySelector('.chat-main');
        const history = panel.querySelector('.chat-history');

        expect(panel.classList.contains('chat-overlay--collapsed')).toBe(true);
        expect(window.NEXUS_MOBILE_CHAT_OVERLAY).toBeUndefined();

        MobileMode.install(document, window);
        await flush();

        // Activation uses the ORIGINAL toggle once: collapsed -> default.
        expect(panel.classList.contains('chat-overlay--collapsed')).toBe(false);
        expect(panel.classList.contains('chat-overlay--expanded')).toBe(false);
        expect(panel.classList.contains('chat-overlay--scene-tale')).toBe(false);
        expect(handle).not.toBeNull();
        expect(handle.style.display).toBe('');
        expect(main.style.display).toBe('');
        expect(history.style.display).toBe('');

        // Native user interaction is still authoritative: default -> expanded -> collapsed.
        toggle.click();
        expect(panel.classList.contains('chat-overlay--expanded')).toBe(true);
        toggle.click();
        expect(panel.classList.contains('chat-overlay--collapsed')).toBe(true);

        // A required choice may re-open the chat, but again only through the native toggle.
        MobileMode.sync(document.getElementById(MobileMode.HUD_ID));
        expect(panel.classList.contains('chat-overlay--collapsed')).toBe(false);
        expect(panel.classList.contains('chat-overlay--expanded')).toBe(false);
    });

    test('Scene Tale CSS never targets the dropdown handle or core chat-panel geometry', () => {
        expect(MobileMode.CSS).not.toMatch(/chat-overlay-handle/);
        expect(MobileMode.CSS).not.toMatch(/\.chat-panel/);
        expect(MobileMode.CSS).not.toMatch(/\.chat-main/);
        expect(MobileMode.CSS).not.toMatch(/\.chat-history/);
        expect(MobileMode.CSS).not.toMatch(/chat-overlay--scene-tale/);
    });
});

afterAll(() => {
    delete window.__NEXUS_SCENE_TALE_MOBILE_NOAUTO__;
});
