/**
 * Paired successfully, and unreachable (batch M10).
 *
 * One screen, contradicting itself, in a fresh incognito profile:
 *
 *     ✅ Paired successfully! Device: dev_PqaOCOHoCVKg
 *     BASE URL   https://app.ollabridge.com
 *     MODEL      DEFAULT                          ← no models fetched
 *     🔌 TEST CONNECTION
 *     ❌ OllaBridge: Missing Base URL. Enter the OllaBridge URL in Settings…
 *
 * The box shows a URL and the app says there isn't one, because the box carries it as a
 * **placeholder**. On a fresh profile it looks filled and every read of `.value` returns `''`.
 *
 * Pairing still worked, because `LLMManager` defaults the URL inside its own settings. Then
 * the first save or connection test read the empty box and wrote `''` over that default — so
 * the provider that had just paired could not be reached, the model list stayed on DEFAULT,
 * and every message came back "Sorry, I encountered an error."
 *
 * Every other provider already had a fallback at each of these sites. Ollama gets localhost,
 * WatsonX its region host, OllaBridge got `''`. That asymmetry was the whole bug.
 */

const fs = require('fs');
const path = require('path');

const MAIN = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const DEFAULT_URL = 'https://app.ollabridge.com';

describe('the box that looks filled and reads empty', () => {
    test('it really is only a placeholder — that is the trap', () => {
        const field = /<input id="base-url"[^>]*>/.exec(INDEX);
        expect(field).not.toBeNull();
        expect(field[0]).toMatch(/placeholder="https:\/\/app\.ollabridge\.com"/);
        expect(field[0]).not.toMatch(/\svalue=/);
    });
});

describe('an empty box means "use the default", never "no URL"', () => {
    /** Every place main.js decides what base URL OllaBridge should use. */
    function ollabridgeFallbacks() {
        return [...MAIN.matchAll(/ollabridge[^\n]*base_url[^\n]*\n?|base_url:[^\n]*OLLABRIDGE[^\n]*/gi)].map(
            (m) => m[0]
        );
    }

    test('the default is named once, not retyped at each site', () => {
        expect(MAIN).toMatch(/const OLLABRIDGE_DEFAULT_BASE_URL = 'https:\/\/app\.ollabridge\.com'/);
    });

    test('reading settings falls back to it', () => {
        expect(MAIN).toMatch(/settings\.ollabridge\.base_url \|\| OLLABRIDGE_DEFAULT_BASE_URL/);
    });

    test('and writing them does too — this is the line that clobbered it', () => {
        // `base_url: config.baseUrl || ''` is what wrote the emptiness back over a working
        // default on the first save after pairing.
        expect(MAIN).toMatch(/base_url: config\.baseUrl \|\| OLLABRIDGE_DEFAULT_BASE_URL/);
        expect(MAIN).not.toMatch(/patch\.ollabridge = \{[\s\S]{0,120}base_url: config\.baseUrl \|\| '',/);
    });

    test('no OllaBridge base_url anywhere still falls back to the empty string', () => {
        const bad = [...MAIN.matchAll(/ollabridge\?\.base_url \|\| ''|settings\.ollabridge\.base_url \|\| ''/g)];
        expect(bad.map((m) => m[0])).toEqual([]);
    });
});

describe('the symmetry that was missing', () => {
    test('Ollama and WatsonX always had a default on these lines', () => {
        // Named so the next person can see the rule rather than the exception: every provider
        // with one well-known home fills the box with it.
        expect(MAIN).toMatch(/settings\.ollama\.base_url \|\| 'http:\/\/localhost:11434'/);
        expect(MAIN).toMatch(/base_url: config\.baseUrl \|\| 'https:\/\/us-south\.ml\.cloud\.ibm\.com'/);
    });

    test('and now OllaBridge does at the same three places', () => {
        const hits = [...MAIN.matchAll(/OLLABRIDGE_DEFAULT_BASE_URL/g)];
        // One declaration plus every site that reads or writes the field.
        expect(hits.length).toBeGreaterThanOrEqual(6);
    });
});

describe('what a fresh profile now shows', () => {
    test('the settings panel fills the box rather than leaving a placeholder', () => {
        expect(MAIN).toMatch(
            /\$\('base-url'\)\.value =\s*\n?\s*config\.baseUrl \|\| \(config\.provider === 'ollabridge' \? OLLABRIDGE_DEFAULT_BASE_URL : ''\)/
        );
    });

    test('and so does switching provider with nothing saved yet', () => {
        // The incognito branch: no unified settings at all.
        expect(MAIN).toMatch(/const fallback = provider === 'ollabridge' \? OLLABRIDGE_DEFAULT_BASE_URL : ''/);
    });
});

describe('the manager and the page agree on where OllaBridge lives', () => {
    test('one URL, two files, no drift', () => {
        // They disagreed in effect, not in text: the manager defaulted it and the page wrote
        // empty over the top. If these two strings ever diverge, this is where it shows.
        const manager = fs.readFileSync(path.join(__dirname, '..', 'src', 'LLMManager.js'), 'utf8');
        expect(manager).toMatch(new RegExp(`OLLABRIDGE_DEFAULT_BASE_URL = '${DEFAULT_URL}'`));
        expect(MAIN).toMatch(new RegExp(`OLLABRIDGE_DEFAULT_BASE_URL = '${DEFAULT_URL}'`));
    });
});
