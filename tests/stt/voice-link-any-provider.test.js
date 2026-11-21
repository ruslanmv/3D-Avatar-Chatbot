/**
 * VL1. Pair OllaBridge once and her SonicAgent voice and listening work whatever AI provider
 * answers the chat (OpenAI, 2026-11-21): the link lives in ADVANCED VOICE, not only under the
 * OllaBridge provider, and a token with no saved address uses OllaBridge Cloud's.
 */
const Config = require('../../src/stt/SonicAgentVoiceConfig.js');
const Settings = require('../../src/stt/SonicAgentVoiceSettings.js');

function page() {
    document.body.innerHTML =
        '<div id="settings-modal"><div class="modal-content">' +
        '<select id="tts-engine"></select><select id="stt-provider"></select>' +
        '<div class="config-section"><h3 class="config-title">DEVELOPER</h3></div>' +
        '</div></div>';
}

describe('VL1. the voice keeps its own link to OllaBridge', () => {
    beforeEach(() => {
        localStorage.clear();
        delete window.__nexusPairOllaBridgeCode;
        delete window.__nexusVoiceRetry;
        page();
    });

    test('chat on OpenAI, OllaBridge paired with no saved address: the voice is configured', () => {
        localStorage.setItem(
            'nexus_llm_settings',
            JSON.stringify({
                provider: 'openai',
                openai: { api_key: 'sk-x' },
                ollabridge: { base_url: '', pair_token: 'tok' },
            })
        );
        expect(Config.gatewayInfo()).toEqual({ baseUrl: 'https://app.ollabridge.com', token: 'tok' });
        Config.set({ enabled: true });
        expect(Config.allowed('tts')).toEqual({ ok: true });
    });

    test('not linked: the voice section has no code box of its own and points to the one card', () => {
        localStorage.setItem('nexus_llm_settings', JSON.stringify({ provider: 'openai' }));
        document.body.insertAdjacentHTML(
            'afterbegin',
            '<div id="ollabridge-card" class="config-section"><input id="ollabridge-pair-code" /></div>'
        );
        const card = document.getElementById('ollabridge-card');
        card.scrollIntoView = jest.fn();
        Settings.attach({ doc: document, config: Config });
        expect(document.getElementById('sonic-link-state').textContent).toMatch(/Not linked.*OLLABRIDGE card/);
        expect(document.querySelectorAll('input[id*="pair"]')).toHaveLength(1); // only the card's
        document.getElementById('sonic-link-go').click();
        expect(card.scrollIntoView).toHaveBeenCalled();
        expect(document.activeElement.id).toBe('ollabridge-pair-code');
    });

    test('linked: the voice section says so and offers nothing to pair', () => {
        localStorage.setItem(
            'nexus_llm_settings',
            JSON.stringify({
                provider: 'openai',
                ollabridge: { base_url: 'https://app.ollabridge.com', pair_token: 't' },
            })
        );
        Settings.attach({ doc: document, config: Config });
        expect(document.getElementById('sonic-link-state').textContent).toMatch(
            /Linked to OllaBridge \(app\.ollabridge\.com\).*any AI provider/
        );
        expect(document.getElementById('sonic-link-go').style.display).toBe('none');
    });
});

describe('VL2. one OllaBridge card, paired once', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../src/main.js'), 'utf8');

    test('the pairing row is moved into one always-shown card under AI PROVIDER, never copied', () => {
        const mount = src.slice(
            src.indexOf('function __nexusMountOllaBridgeCard'),
            src.indexOf('function __nexusWireOllaBridgePairButton')
        );
        expect(mount).toMatch(/card\.append\(title, hint, row\)/);
        expect(mount).toMatch(/row\.dataset\.always = '1'/);
        expect(mount).toMatch(/providerSection\.insertAdjacentElement\('afterend', card\)/);
        // Neither the provider switch nor the auth mode hides it any more.
        expect(src).toMatch(/if \(pairRowHide && !pairRowHide\.dataset\.always\)/);
    });

    test("pairing with another provider selected never takes that provider's BASE URL", () => {
        const pair = src.slice(
            src.indexOf("btn.addEventListener('click', async () => {\n        const codeInput"),
            src.indexOf("window.addEventListener('DOMContentLoaded', __nexusWireOllaBridgePairButton)")
        );
        expect(pair).toMatch(/selected\.value === 'ollabridge' && baseUrlInput \? baseUrlInput\.value\.trim\(\) : ''/);
    });
});
