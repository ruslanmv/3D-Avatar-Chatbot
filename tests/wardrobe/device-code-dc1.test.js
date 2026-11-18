/**
 * DC1. A headset pairs with a six-character code instead of pasting a grant.
 *
 * Properties: what counts as a code (and that a pasted grant never does), that a code is traded
 * with the chosen Forge for the grant it carries and then saved exactly as a pasted grant is, and
 * that every way it can fail says so in the field's status line and saves nothing.
 */

/* global describe, test, expect, beforeEach, jest */

const Config = require('../../src/wardrobe/WardrobeConfig.js');
const Settings = require('../../src/wardrobe/WardrobeForgeSettings.js');

const GRANT = 'eyJ2IjoxLCJpZCI6ImcxIn0.c2lnbmF0dXJl';

describe('what a pairing code is', () => {
    test.each([
        ['K7P-4QX', 'K7P4QX'],
        ['k7p 4qx', 'K7P4QX'],
        [' K7P4QX ', 'K7P4QX'],
    ])('"%s" is the code %s', (typed, code) => {
        expect(Config.deviceCode(typed)).toBe(code);
    });

    test.each(['', 'K7P4Q', 'K7P4QXX', 'K0P4QX', 'K1P4QX', 'KOP4QX', GRANT])('"%s" is not a code', (typed) => {
        expect(Config.deviceCode(typed)).toBeNull();
    });
});

describe('trading a code for its grant', () => {
    const ok = (body) => jest.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => body }));

    test('posts the code to the chosen Forge and answers its grant', async () => {
        const fetch = ok({ token: GRANT, id: 'g1' });
        const got = await Config.redeemDeviceCode('k7p-4qx', 'https://forge.example/', fetch);
        expect(got).toEqual({ ok: true, why: '', grant: GRANT });
        const [url, init] = fetch.mock.calls[0];
        expect(url).toBe('https://forge.example/v1/device-codes/redeem');
        expect(JSON.parse(init.body)).toEqual({ code: 'K7P4QX' });
    });

    test.each([
        [{ ok: false, status: 404 }, /mistyped, already used or expired/],
        [{ ok: false, status: 429 }, /Too many tries/],
        [{ ok: true, status: 200, json: async () => ({}) }, /did not send a grant/],
    ])('a refusal is said, not thrown (%#)', async (response, why) => {
        const got = await Config.redeemDeviceCode('K7P4QX', 'https://forge.example', () => Promise.resolve(response));
        expect(got.ok).toBe(false);
        expect(got.why).toMatch(why);
    });

    test('no Forge chosen, or no network: said, not thrown', async () => {
        expect((await Config.redeemDeviceCode('K7P4QX', '', ok({}))).why).toMatch(/Choose a Forge/);
        const down = () => Promise.reject(new Error('offline'));
        expect((await Config.redeemDeviceCode('K7P4QX', 'https://forge.example', down)).why).toMatch(/Could not reach/);
    });
});

describe('the Settings field', () => {
    function page() {
        document.body.innerHTML =
            '<button id="settings-btn"></button><div id="settings-modal"><div class="modal-content">' +
            '<div class="config-section"><h3 class="config-title">DEVELOPER</h3></div></div></div>';
    }

    beforeEach(() => {
        localStorage.clear();
        window.NEXUS_WARDROBE = { config: {}, service: { config: {} } };
        window.NEXUS_WARDROBE_CONFIG = { apiUrl: 'https://forge.example' };
    });

    async function type(value, fetch) {
        page();
        Settings.attach({ doc: document, config: Config, fetch });
        const field = document.getElementById('wardrobe-forge-grant');
        field.value = value;
        field.dispatchEvent(new Event('change'));
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));
        return { field, status: document.getElementById('wardrobe-forge-status').textContent };
    }

    test('a typed code is redeemed and saved as the grant, as if it had been pasted', async () => {
        const fetch = jest.fn((url) =>
            Promise.resolve(
                /redeem/.test(url)
                    ? { ok: true, status: 200, json: async () => ({ token: GRANT }) }
                    : { ok: true, status: 200, json: async () => ({ templates: 1 }) }
            )
        );
        const { field, status } = await type('k7p-4qx', fetch);
        expect(localStorage.getItem(Config.GRANT_KEY)).toBe(GRANT);
        expect(field.value).toBe(GRANT);
        expect(status).toMatch(/Paired/);
        expect(window.NEXUS_WARDROBE.service.config.grant).toBe(GRANT);
    });

    test('a pasted grant is saved as before, without asking Forge', async () => {
        const fetch = jest.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => ({}) }));
        const { status } = await type(GRANT, fetch);
        expect(localStorage.getItem(Config.GRANT_KEY)).toBe(GRANT);
        expect(status).toMatch(/^Read grant saved/);
        expect(fetch.mock.calls.some(([url]) => /redeem/.test(url))).toBe(false);
    });

    test('a code Forge refuses saves nothing and says why', async () => {
        const fetch = jest.fn((url) =>
            Promise.resolve(
                /redeem/.test(url) ? { ok: false, status: 404 } : { ok: true, status: 200, json: async () => ({}) }
            )
        );
        const { status } = await type('K7P4QX', fetch);
        expect(localStorage.getItem(Config.GRANT_KEY)).toBeNull();
        expect(status).toMatch(/did not work/);
    });

    test('the field shows its text while typed in and is masked again after', () => {
        page();
        Settings.attach({ doc: document, config: Config, fetch: jest.fn() });
        const field = document.getElementById('wardrobe-forge-grant');
        field.dispatchEvent(new Event('focus'));
        expect(field.type).toBe('text');
        field.dispatchEvent(new Event('blur'));
        expect(field.type).toBe('password');
    });
});
