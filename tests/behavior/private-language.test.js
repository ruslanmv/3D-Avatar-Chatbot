/* global describe, test, expect, beforeEach, afterEach */

/**
 * P14 — the card speaks the language the rest of the app speaks.
 *
 * The defect these cover is one screen, not one string: a session on `it-IT` produced Italian
 * replies interleaved with English buttons, an English pace word and English acknowledgements,
 * because `AppLanguage` cascaded into STT, TTS and the LLM while Private's own words were literals
 * inside logic.
 *
 * The assertions are properties, never sentences — per the house rule, a test pinned to prose fails
 * on an edit that changes nothing. So: *no visible English*, *every key present in every pack*,
 * *the fallback chain in that order*, rather than "the button says Più vicino".
 */

const fs = require('fs');
const path = require('path');

const PrivateLocale = require('../../src/features/together/PrivateLocale.js');
const PrivateChoices = require('../../src/features/together/PrivateChoices.js');
const PrivateConversationView = require('../../src/features/together/ui/PrivateConversationView.js');

function speak(code) {
    window.AppLanguage = { code };
    window.NEXUS_PRIVATE_LOCALE = PrivateLocale;
}

function page() {
    document.body.innerHTML = `
        <section class="chat-panel">
            <div id="chat-history"><div class="empty-state">No transmissions recorded</div></div>
            <input id="speech-text" placeholder="Message">
            <button id="speak-btn" type="button">Send</button>
        </section>`;
}

afterEach(() => {
    delete window.AppLanguage;
    delete window.NEXUS_PRIVATE_LOCALE;
    document.body.innerHTML = '';
});

describe('PrivateLocale', () => {
    test('every pack answers every key the English one does', () => {
        // A missing key is invisible in review and obvious in production: the pack falls through to
        // English and one button on an otherwise Italian card is in the wrong language.
        const keys = Object.keys(PrivateLocale.PACKS['en-US']);
        for (const code of PrivateLocale.languages()) {
            const missing = keys.filter((key) => PrivateLocale.PACKS[code][key] === undefined);
            expect({ code, missing }).toEqual({ code, missing: [] });
        }
    });

    test('and names itself, for the one place a prompt has to say it', () => {
        for (const code of PrivateLocale.languages()) {
            expect(typeof PrivateLocale.NAMES[code]).toBe('string');
            expect(PrivateLocale.NAMES[code].length).toBeGreaterThan(0);
        }
    });

    test('the chain is pack, then English, then the key itself', () => {
        speak('it-IT');
        expect(PrivateLocale.t('controls.end')).toBe(PrivateLocale.PACKS['it-IT']['controls.end']);
        // The key rather than an empty string, deliberately: a button reading `nope.not.a.key` is a
        // bug anybody can see and report, and an invisible button is a bug nobody can.
        expect(PrivateLocale.t('nope.not.a.key')).toBe('nope.not.a.key');
    });

    test('an unknown or absent language is English rather than nothing', () => {
        window.AppLanguage = { code: 'xx-XX' };
        expect(PrivateLocale.code()).toBe('en-US');
        delete window.AppLanguage;
        expect(PrivateLocale.code()).toBe('en-US');
        expect(PrivateLocale.t('controls.end')).toBe(PrivateLocale.PACKS['en-US']['controls.end']);
    });

    test('the language is read per call, so changing it mid-session takes effect', () => {
        // The whole reason nothing here is cached. Somebody changes the language in Settings while
        // Private is running; her replies come back in the new one on the very next turn, and a
        // footer holding a pack captured at mount would be the last English thing on screen.
        speak('it-IT');
        const italian = PrivateLocale.t('controls.end');
        window.AppLanguage.code = 'de-DE';
        expect(PrivateLocale.t('controls.end')).not.toBe(italian);
        expect(PrivateLocale.t('controls.end')).toBe(PrivateLocale.PACKS['de-DE']['controls.end']);
    });

    test('interpolation fills what it is given and leaves what it is not', () => {
        speak('en-US');
        expect(PrivateLocale.t('pace.aria.step', { step: 2, total: 3 })).toContain('2');
        expect(PrivateLocale.t('pace.aria.step', { step: 2 })).toContain('{total}');
    });

    test('pace levels are clamped rather than trusted', () => {
        speak('en-US');
        expect(PrivateLocale.pace(0)).toBe(PrivateLocale.t('pace.1'));
        expect(PrivateLocale.pace(9)).toBe(PrivateLocale.t('pace.3'));
        expect(PrivateLocale.pace(undefined)).toBe(PrivateLocale.t('pace.1'));
    });
});

describe('the Private card, in the language the app is in', () => {
    let view;

    afterEach(() => {
        if (view) view.destroy();
        view = null;
    });

    /** Anything a person reading Italian would notice as not being Italian. */
    function englishOnScreen(root) {
        const english = Object.entries(PrivateLocale.PACKS['en-US'])
            // The pace words and the kicker are shared across packs in places, and a one-word
            // false positive would make this test noise. Only the phrases worth catching.
            .filter(([key]) => /^(controls|complete|card\.(you|her|thinking)|composer)\./.test(key))
            .map(([, value]) => value)
            .filter((value) => /[A-Za-z]{4}/.test(value));
        const text = `${root.textContent} ${[...root.querySelectorAll('[aria-label],[placeholder]')]
            .map((n) => `${n.getAttribute('aria-label') || ''} ${n.getAttribute('placeholder') || ''}`)
            .join(' ')}`;
        return english.filter((phrase) => text.includes(phrase));
    }

    test('no English survives on an Italian card — controls, ladder, roles or composer', () => {
        speak('it-IT');
        page();
        view = new PrivateConversationView.View({ doc: document, win: window });
        view.mount({ preset: { label: 'Sensual' }, scene: 'Terrazza sul mare' });
        view.setPace({
            level: 2,
            maxLevel: 3,
            hasLadder: true,
            steps: [
                { level: 1, reached: true, current: false },
                { level: 2, reached: true, current: true },
                { level: 3, reached: false, current: false },
            ],
            forwardKey: 'more',
            forward: 'More',
            canEase: true,
        });
        view.showMessage('Una battuta che il modello ha scritto in italiano.');
        view.renderUserTurn('E una risposta.');

        const row = document.getElementById('nexus-private-conversation-row');
        expect(englishOnScreen(row)).toEqual([]);
        expect(document.getElementById('speech-text').placeholder).toBe(
            PrivateLocale.PACKS['it-IT']['composer.placeholder']
        );
    });

    test('nor on the completion card, which is the last thing anybody reads', () => {
        speak('it-IT');
        page();
        view = new PrivateConversationView.View({ doc: document, win: window });
        view.mount({ preset: { label: 'Sensual' }, scene: '' });
        view.showComplete({});
        const row = document.getElementById('nexus-private-conversation-row');
        expect(englishOnScreen(row)).toEqual([]);
        // Built from nodes rather than an HTML string, so a translated line cannot carry markup.
        expect(row.querySelector('.nexus-private-note br')).not.toBeNull();
    });

    test('the place slot is empty when no scene is set, never a placeholder', () => {
        // `currentSceneLabel` returns the sentence fragment `this place` for prose, and the header
        // printed it as though it were somewhere's name.
        speak('en-US');
        page();
        view = new PrivateConversationView.View({ doc: document, win: window });
        view.mount({ preset: { label: 'Romantic' }, scene: '' });
        expect(document.querySelector('.nexus-private-place').textContent).toBe('');
    });

    test('a caller that predates forwardKey still gets a forward button', () => {
        speak('en-US');
        page();
        view = new PrivateConversationView.View({ doc: document, win: window });
        view.mount({ preset: { label: 'Romantic' }, scene: '' });
        view.setPace({ level: 1, maxLevel: 3, hasLadder: false, steps: [], forward: 'Closer', canEase: false });
        expect(document.querySelector('[data-private-action="closer"]')).not.toBeNull();
    });
});

describe('the language directive, on the path most replies actually take', () => {
    /**
     * `AppLanguage` is an IIFE with no `module.exports`, so this is the house pattern for a file
     * that cannot be required — see `tests/camera-presets.test.js`. Evaluating it runs `init()`,
     * which null-guards every element it looks for and is happy against an empty page.
     */
    function load() {
        const src = fs.readFileSync(path.join(__dirname, '../../src/AppLanguage.js'), 'utf8');
        // eslint-disable-next-line no-eval
        eval(src);
        return window.AppLanguage;
    }

    test('reaches sendMessageStream, which is how OpenAI, Claude and Ollama are called', () => {
        // The defect: only `sendMessage` and `sendMessageStructured` were wrapped, and `main.js`
        // routes three of the five providers through streaming. Those three received no language
        // instruction at all — the setting appeared to work only because OllaBridge and watsonx are
        // excluded from streaming.
        const seen = {};
        window._nexusLLM = {
            sendMessage: (msg, sys) => {
                seen.plain = sys;
            },
            sendMessageStructured: (msg, sys) => {
                seen.structured = sys;
            },
            sendMessageStream: (msg, sys, history, onToken) => {
                seen.stream = sys;
                seen.onToken = onToken;
            },
        };
        const app = load();
        expect(app._patchLLM()).toBe(true);

        const token = () => {};
        window._nexusLLM.sendMessage('hi', 'RULES');
        window._nexusLLM.sendMessageStructured('hi', 'RULES');
        window._nexusLLM.sendMessageStream('hi', 'RULES', [], token);

        const directive = app.directive();
        for (const which of ['plain', 'structured', 'stream']) {
            expect(seen[which]).toContain('RULES');
            expect(seen[which]).toContain(directive);
        }
        // Rest args, not `(msg, sys, hist)`. A fixed-arity wrapper drops the fourth argument, and
        // the fourth argument is the token callback — every streaming reply would arrive silent.
        expect(seen.onToken).toBe(token);
        delete window._nexusLLM;
    });

    test('and wraps once, however many times it is called', () => {
        let sys = '';
        window._nexusLLM = {
            sendMessageStream: (msg, prompt) => {
                sys = prompt;
            },
        };
        const app = load();
        app._patchLLM();
        app._patchLLM();
        window._nexusLLM.sendMessageStream('hi', 'RULES');
        const directive = app.directive();
        expect(sys.split(directive).length - 1).toBe(1);
        delete window._nexusLLM;
    });
});

describe('the choices offered when the model wrote none', () => {
    beforeEach(() => speak('it-IT'));

    test('are in the card language, and still pass the rules they always did', () => {
        for (const state of [
            { opening: true, scene: true },
            { opening: true, scene: false },
            { intent: 'question' },
            { energy: 'quiet', music: true },
            { energy: 'quiet', music: false },
            { pace: 'Warm' },
            { pace: 'Sensual', music: true },
        ]) {
            const choices = PrivateChoices.fallback(state);
            expect(choices.length).toBeGreaterThanOrEqual(2);
            // Drawn from the active pack, not from the English floor. Stated as membership rather
            // than as "not English": `Mm.` is the same in several packs, and asserting difference
            // would fail on a correct translation.
            const italian = Object.values(PrivateLocale.PACKS['it-IT']);
            for (const line of choices) expect(italian).toContain(line);
            for (const line of choices) {
                expect(PrivateChoices.usable(line)).toBe(line);
            }
            // The quiet option is last, always, and stays recognisable through translation: it is
            // answered locally rather than sent to the model, and `isQuiet` is how that is known.
            expect(PrivateChoices.isQuiet(choices[choices.length - 1])).toBe(true);
        }
    });

    test('the quiet option is bracketed in every pack, because that is how it is recognised', () => {
        for (const code of PrivateLocale.languages()) {
            expect(PrivateChoices.isQuiet(PrivateLocale.PACKS[code]['choice.quiet'])).toBe(true);
        }
    });

    test('and every translated choice is short enough to be a button', () => {
        for (const code of PrivateLocale.languages()) {
            for (const [key, value] of Object.entries(PrivateLocale.PACKS[code])) {
                if (!key.startsWith('choice.')) continue;
                expect(PrivateChoices.usable(value)).toBe(value);
            }
        }
    });
});
