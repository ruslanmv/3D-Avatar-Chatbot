'use strict';

/**
 * Scene Tale owns Conversation during playback. The ordinary mobile chat overlay starts every
 * phone session collapsed, which normally hides .chat-main with !important. These regressions
 * ensure that entering Scene Tale suspends that state machine, exposes the story surface, and
 * restores the previous collapsed state exactly on exit.
 */

/* global describe, test, expect, beforeEach, afterEach, jest */

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
                    <div id="nexus-scene-tale-hud" class="has-choices">
                        <div class="nexus-story-options">
                            <button class="nexus-story-option">A confession</button>
                            <button class="nexus-story-option">A goodbye</button>
                        </div>
                    </div>
                </div>
            </main>
            <div class="chat-input-shell"><input id="speech-text" /></div>
        </section>
    `;
}

async function bootOverlay() {
    jest.resetModules();
    delete window.NEXUS_MOBILE_CHAT_OVERLAY;
    require('../../src/MobileChatOverlay.js');
    if (!window.NEXUS_MOBILE_CHAT_OVERLAY) {
        window.dispatchEvent(new Event('DOMContentLoaded'));
        await flush();
    }
    return window.NEXUS_MOBILE_CHAT_OVERLAY;
}

beforeEach(() => {
    mountMobileChat();
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
});

afterEach(() => {
    const api = window.NEXUS_MOBILE_CHAT_OVERLAY;
    if (api && api.isSuspended && api.isSuspended()) api.resume('scene-tale');
    delete window.NEXUS_MOBILE_CHAT_OVERLAY;
    document.documentElement.className = '';
    document.body.innerHTML = '';
    jest.resetModules();
});

describe('MobileChatOverlay Scene Tale ownership', () => {
    test('a phone that started collapsed exposes chat-main and prepared choices automatically', async () => {
        const api = await bootOverlay();
        const panel = document.querySelector('.chat-panel');
        const main = panel.querySelector('.chat-main');
        const history = panel.querySelector('.chat-history');

        expect(api).toBeTruthy();
        expect(panel.classList.contains('chat-overlay--collapsed')).toBe(true);

        document.documentElement.classList.add('nexus-scene-tale-active');
        await flush();

        expect(api.getState()).toEqual(expect.objectContaining({ suspended: true, reason: 'scene-tale' }));
        expect(panel.classList.contains('chat-overlay--collapsed')).toBe(false);
        expect(panel.classList.contains('chat-overlay--expanded')).toBe(false);
        expect(panel.classList.contains('chat-overlay--scene-tale')).toBe(true);
        expect(main.style.getPropertyValue('display')).toBe('block');
        expect(main.style.getPropertyPriority('display')).toBe('important');
        expect(history.style.getPropertyValue('display')).toBe('block');
        expect(history.style.getPropertyPriority('display')).toBe('important');
        expect(document.querySelectorAll('.nexus-story-option')).toHaveLength(2);

        // The normal overlay controls are suspended and cannot re-collapse the story surface.
        document.getElementById('chat-overlay-toggle').click();
        expect(panel.classList.contains('chat-overlay--collapsed')).toBe(false);
        expect(panel.classList.contains('chat-overlay--scene-tale')).toBe(true);
    });

    test('exiting Scene Tale restores the previous collapsed state and inline display exactly', async () => {
        const api = await bootOverlay();
        const panel = document.querySelector('.chat-panel');
        const main = panel.querySelector('.chat-main');
        const history = panel.querySelector('.chat-history');

        expect(panel.classList.contains('chat-overlay--collapsed')).toBe(true);
        expect(main.style.getPropertyValue('display')).toBe('');
        expect(history.style.getPropertyValue('display')).toBe('');

        document.documentElement.classList.add('nexus-scene-tale-active');
        await flush();
        document.documentElement.classList.remove('nexus-scene-tale-active');
        await flush();

        expect(api.getState()).toEqual(expect.objectContaining({ state: 'collapsed', suspended: false }));
        expect(panel.classList.contains('chat-overlay--scene-tale')).toBe(false);
        expect(panel.classList.contains('chat-overlay--collapsed')).toBe(true);
        expect(main.style.getPropertyValue('display')).toBe('');
        expect(history.style.getPropertyValue('display')).toBe('');
    });
});
