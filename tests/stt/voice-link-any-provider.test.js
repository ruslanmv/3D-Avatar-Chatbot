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

    test('not linked: the voice section offers the pairing code, whatever the provider', () => {
        localStorage.setItem('nexus_llm_settings', JSON.stringify({ provider: 'openai' }));
        Settings.attach({ doc: document, config: Config });
        expect(document.getElementById('sonic-link-state').textContent).toMatch(/Not linked to OllaBridge/);
        expect(document.getElementById('sonic-link-pair').style.display).toBe('flex');
    });

    test('pairing here keeps the chat on OpenAI, says linked, and starts her chosen voice again', async () => {
        localStorage.setItem('nexus_llm_settings', JSON.stringify({ provider: 'openai', openai: { api_key: 'sk-x' } }));
        const retry = jest.fn();
        window.__nexusVoiceRetry = retry;
        window.__nexusPairOllaBridgeCode = jest.fn(async (code) => {
            const s = JSON.parse(localStorage.getItem('nexus_llm_settings'));
            s.ollabridge = { base_url: 'https://app.ollabridge.com', pair_token: 'paired-' + code };
            localStorage.setItem('nexus_llm_settings', JSON.stringify(s));
            return { ok: true, device_id: 'd1' };
        });
        Settings.attach({ doc: document, config: Config });
        retry.mockClear();
        document.getElementById('sonic-pair-code').value = 'ABCD1234';
        document.getElementById('sonic-pair').click();
        await new Promise((r) => setTimeout(r, 0));
        expect(window.__nexusPairOllaBridgeCode).toHaveBeenCalledWith('ABCD1234');
        expect(JSON.parse(localStorage.getItem('nexus_llm_settings')).provider).toBe('openai');
        expect(document.getElementById('sonic-link-state').textContent).toMatch(
            /Linked to OllaBridge \(app\.ollabridge\.com\).*any AI provider/
        );
        expect(document.getElementById('sonic-link-pair').style.display).toBe('none');
        expect(retry).toHaveBeenCalled();
    });
});
