/**
 * Remote screenshot (batch RS1).
 *
 * Four properties are load-bearing here, and each of them has a test that fails the moment
 * it stops being true:
 *
 *   * **one picture, one answer.** "What do you see?" is answered about the frame already on
 *     screen. If this feature ever captures a second time to answer a follow-up, the words
 *     describe a screen the user cannot see and nothing in the transcript says so;
 *   * **ordinary conversation is untouched.** A message the intent parser does not claim
 *     reaches the model exactly as it would with this folder deleted;
 *   * **every failure is a sentence**, naming the machine the fix is on — never a status code;
 *   * **the picture survives a failed answer.** A vision model that cannot read the frame
 *     does not take the frame away with it.
 */

const Frames = require('../src/features/screen/frameStore.js');

let Screen;
let Card;
let Ask;

/** A fetch whose answers are declared per URL fragment. Anything unmatched is a 404. */
function fakeFetch(routes) {
    return jest.fn((url, init) => {
        for (const [fragment, reply] of Object.entries(routes)) {
            if (String(url).includes(fragment)) {
                const out = typeof reply === 'function' ? reply(url, init) : reply;
                return Promise.resolve(
                    Object.assign(
                        {
                            ok: true,
                            status: 200,
                            json: () => Promise.resolve(out.body === undefined ? out : out.body),
                            blob: () => Promise.resolve(out.blob || { size: 12 }),
                        },
                        out.status ? { status: out.status, ok: out.status < 400 } : {}
                    )
                );
            }
        }
        return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    });
}

const BRIDGE = { base: 'https://bridge.example', auth: 'tok' };

/** Wait for a condition, bounded. Returns whether it ever became true. */
async function until(predicate, tries = 60) {
    for (let i = 0; i < tries; i += 1) {
        if (predicate()) {
            return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return false;
}

function handle(overrides) {
    return Object.assign(
        {
            frame_id: 'aaaa1111',
            url: '/v1/screen/frame/aaaa1111',
            width: 1280,
            height: 720,
            bytes: 4096,
            age_s: 0,
            expires_in_s: 600,
            mechanism: 'share',
            device: 'Home PC',
        },
        overrides || {}
    );
}

beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '<div id="chat-history"></div>';
    window.__NEXUS_SCREEN_ASK_NOAUTO__ = true;
    Frames.clear();
    window.NEXUS_SCREEN_FRAMES = Frames;
    Screen = require('../src/features/screen/remoteScreen.js');
    Card = require('../src/features/screen/ScreenCard.js');
    Ask = require('../src/features/screen/ScreenAsk.js');
    window.NEXUS_SCREEN = Screen;
    window.NEXUS_SCREEN_CARD = Card;
    Screen.invalidate();
    // jsdom has no object URLs. The card only ever hands the string to an <img>.
    global.URL.createObjectURL = jest.fn(() => 'blob:frame');
});

// ── the frame store ─────────────────────────────────────────────────────────

describe('frameStore', () => {
    test('remembers a capture and hands back the newest', () => {
        Frames.remember(handle({ frame_id: 'one' }), 1000);
        Frames.remember(handle({ frame_id: 'two' }), 2000);
        expect(Frames.latest(2000).frame_id).toBe('two');
    });

    test('dates a frame by the age the server reported, not by its clock', () => {
        // The server's `captured_at` is in the server's clock, which is not this browser's.
        // A frame reported as 30s old must read as 30s old here, whatever either clock says.
        const stored = Frames.remember(handle({ age_s: 30 }), 100000);
        expect(stored.taken_at_local).toBe(100000 - 30000);
        expect(Frames.ageOf(stored, 100000)).toBe(30000);
    });

    test('forgets a frame once it is past the TTL the server enforces', () => {
        Frames.remember(handle(), 0);
        expect(Frames.latest(Frames.TTL_MS - 1)).not.toBeNull();
        expect(Frames.latest(Frames.TTL_MS + 1)).toBeNull();
        expect(Frames.size()).toBe(0);
    });
});

// ── capability, and the sentence for every way it can be no ─────────────────

describe('capability', () => {
    test('an unlinked bridge is not an error, it is an offer to look at this screen', async () => {
        const cap = await Screen.capability({ bridge: null, force: true });
        expect(cap.available).toBe(false);
        const said = Screen.describe(cap);
        expect(said.fallback).toBe('share');
        expect(said.text).toMatch(/share it/i);
        expect(said.text).toMatch(/HomePilot/);
    });

    test('a bridge from before this feature says so, and still offers the local screen', async () => {
        const cap = await Screen.capability({
            bridge: BRIDGE,
            force: true,
            fetch: fakeFetch({}), // 404: no such route on an older bridge
        });
        expect(cap.reason).toBe('unsupported');
        expect(Screen.describe(cap).fallback).toBe('share');
    });

    test('capture switched off on that machine names the machine, not a status code', async () => {
        const cap = await Screen.capability({
            bridge: BRIDGE,
            force: true,
            fetch: fakeFetch({
                '/v1/screen/capability': { ok: true, available: false, reason: 'disabled', device: 'Home PC' },
            }),
        });
        const said = Screen.describe(cap);
        expect(said.text).toContain('Home PC');
        expect(said.text).not.toMatch(/\b(4\d\d|5\d\d|error)\b/i);
    });

    test('an offline computer reads as offline, not as broken', async () => {
        const cap = await Screen.capability({
            bridge: BRIDGE,
            force: true,
            fetch: jest.fn(() => Promise.reject(new Error('down'))),
        });
        expect(cap.reason).toBe('unreachable');
        expect(Screen.describe(cap).text).toMatch(/offline/i);
    });

    test('the probe is cached, so a per-keystroke check is not a per-keystroke request', async () => {
        const f = fakeFetch({ '/v1/screen/capability': { ok: true, available: true, device: 'Home PC' } });
        await Screen.capability({ bridge: BRIDGE, fetch: f, force: true });
        await Screen.capability({ bridge: BRIDGE, fetch: f });
        expect(f).toHaveBeenCalledTimes(1);
    });
});

// ── the intent ──────────────────────────────────────────────────────────────

describe('parseIntent', () => {
    test.each([
        'take a screenshot of my pc',
        'Take a screenshot',
        'show me my computer',
        "show me what's on my pc",
        'look at my home pc',
        'screenshot my remote computer',
        '/screen',
    ])('claims "%s"', (text) => {
        expect(Ask.parseIntent(text, false)).toEqual(expect.objectContaining({ kind: 'capture' }));
    });

    test.each(['what is on my pc', 'what can you see on my computer', 'why is it failing on my laptop'])(
        '"%s" captures and answers in one turn',
        (text) => {
            expect(Ask.parseIntent(text, false).kind).toBe('look-and-ask');
        }
    );

    test.each([
        'play some lofi',
        'what do you think about this design',
        'can you help me with my code',
        'take a look at this function',
        'screenshot',
    ])('leaves "%s" for the model', (text) => {
        expect(Ask.parseIntent(text, false)).toBeNull();
    });

    test('"what do you see?" is only ours while a screenshot exists', () => {
        // Without this rule the phrase would stop reaching the model on every page load,
        // which is a much worse bug than not recognising it.
        expect(Ask.parseIntent('what do you see?', false)).toBeNull();
        expect(Ask.parseIntent('what do you see?', true).kind).toBe('explain');
    });
});

// ── the round trip ──────────────────────────────────────────────────────────

describe('look', () => {
    test('shows a card and remembers the frame', async () => {
        const deps = {
            bridge: BRIDGE,
            fetch: fakeFetch({
                '/v1/screen/capability': { ok: true, available: true, device: 'Home PC' },
                '/v1/screen/capture': { ok: true, frame: handle() },
                '/v1/screen/frame/': { blob: { size: 9 } },
            }),
        };
        const out = await Ask.look({ deps, doc: document, screen: Screen });
        expect(out.ok).toBe(true);
        const card = document.querySelector('.nexus-screen-card');
        expect(card).not.toBeNull();
        expect(card.dataset.frameId).toBe('aaaa1111');
        expect(card.textContent).toContain('Home PC');
        expect(card.textContent).toContain('Just now');
        expect(Frames.latest().frame_id).toBe('aaaa1111');
    });

    test('says what it is doing while it waits, and stops saying it afterwards', async () => {
        let release;
        const gate = new Promise((r) => {
            release = r;
        });
        const deps = {
            bridge: BRIDGE,
            fetch: jest.fn((url) => {
                if (String(url).includes('capability')) {
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        json: () => Promise.resolve({ ok: true, available: true, device: 'Home PC' }),
                    });
                }
                if (String(url).includes('capture')) {
                    return gate.then(() => ({
                        ok: true,
                        status: 200,
                        json: () => Promise.resolve({ ok: true, frame: handle() }),
                    }));
                }
                return Promise.resolve({ ok: true, status: 200, blob: () => Promise.resolve({ size: 3 }) });
            }),
        };
        const running = Ask.look({ deps, doc: document, screen: Screen });
        // Asserted while the capture is genuinely still in flight — the gate below is what
        // holds it there, so this is the only moment the transient state exists at all.
        // Waited for by condition rather than by a fixed number of ticks: how many
        // microtasks a fetch chain costs is an implementation detail, and a test that
        // encodes it passes today and fails on a refactor that changed nothing real.
        expect(await until(() => document.querySelector('.nexus-screen-thinking'))).toBe(true);
        expect(document.body.textContent).toContain('Looking at Home PC…');
        release();
        await running;
        expect(document.querySelector('.nexus-screen-thinking')).toBeNull();
    });

    test('a refused capture is a sentence in the chat, and no card', async () => {
        const deps = {
            bridge: BRIDGE,
            fetch: fakeFetch({
                '/v1/screen/capability': { ok: true, available: true, device: 'Home PC' },
                '/v1/screen/capture': {
                    status: 409,
                    body: { ok: false, error: 'disabled', message: 'Remote screen viewing is off on Home PC.' },
                },
            }),
        };
        const out = await Ask.look({ deps, doc: document, screen: Screen });
        expect(out.ok).toBe(false);
        expect(document.querySelector('.nexus-screen-card')).toBeNull();
        expect(document.body.textContent).toContain('Remote screen viewing is off on Home PC.');
    });
});

describe('ask', () => {
    function ready() {
        return {
            bridge: BRIDGE,
            fetch: fakeFetch({
                '/v1/screen/capability': { ok: true, available: true, device: 'Home PC' },
                '/v1/screen/capture': { ok: true, frame: handle() },
                '/v1/screen/frame/': { blob: { size: 9 } },
                '/v1/screen/explain': {
                    ok: true,
                    frame_id: 'aaaa1111',
                    analysis_text: 'VS Code is open with a Python traceback: ModuleNotFoundError for requests.',
                    meta: { model: 'moondream' },
                },
            }),
        };
    }

    test('answers about the frame already on screen — it does not capture again', async () => {
        const deps = ready();
        await Ask.look({ deps, doc: document, screen: Screen });
        const capturesBefore = deps.fetch.mock.calls.filter((c) => String(c[0]).includes('/capture')).length;

        await Ask.ask('what do you see?', { deps, doc: document, screen: Screen });

        const capturesAfter = deps.fetch.mock.calls.filter((c) => String(c[0]).includes('/capture')).length;
        // The whole feature turns on this number not changing.
        expect(capturesAfter).toBe(capturesBefore);
        const explained = deps.fetch.mock.calls.find((c) => String(c[0]).includes('/explain'));
        expect(JSON.parse(explained[1].body).frame_id).toBe('aaaa1111');
        expect(document.body.textContent).toContain('ModuleNotFoundError');
    });

    test('cites the screenshot it used, and the citation finds that card', async () => {
        const deps = ready();
        await Ask.look({ deps, doc: document, screen: Screen });
        await Ask.ask('what do you see?', { deps, doc: document, screen: Screen });

        const cite = document.querySelector('.nexus-screen-cite');
        expect(cite).not.toBeNull();
        expect(cite.textContent).toMatch(/^↳ Screenshot · \d\d:\d\d:\d\d$/);
        cite.click();
        expect(document.querySelector('.nexus-screen-card.is-cited')).not.toBeNull();
    });

    test('captures first when asked about a screenshot that no longer exists', async () => {
        const deps = ready();
        const out = await Ask.ask('what do you see?', { deps, doc: document, screen: Screen });
        expect(out.ok).toBe(true);
        expect(document.querySelector('.nexus-screen-card')).not.toBeNull();
    });

    test('a vision model that says nothing useful does not take the picture away', async () => {
        const deps = ready();
        deps.fetch = fakeFetch({
            '/v1/screen/capability': { ok: true, available: true, device: 'Home PC' },
            '/v1/screen/capture': { ok: true, frame: handle() },
            '/v1/screen/frame/': { blob: { size: 9 } },
            // "ersatz" — the real output that made this look like a broken product.
            '/v1/screen/explain': { ok: true, analysis_text: 'ersatz', meta: { model: 'moondream:latest' } },
        });
        await Ask.look({ deps, doc: document, screen: Screen });
        const out = await Ask.ask('what do you see?', { deps, doc: document, screen: Screen });

        expect(out.ok).toBe(false);
        expect(document.querySelector('.nexus-screen-card')).not.toBeNull();
        expect(document.body.textContent).toContain('moondream:latest');
        expect(document.body.textContent).not.toContain('ersatz');
    });

    test('an expired frame asks for a new one instead of failing silently', async () => {
        const deps = ready();
        await Ask.look({ deps, doc: document, screen: Screen });
        deps.fetch = fakeFetch({
            '/v1/screen/explain': {
                ok: false,
                error: 'expired',
                message: 'That screenshot has expired. Ask me to take another.',
            },
        });
        const out = await Ask.ask('what do you see?', { deps, doc: document, screen: Screen });
        expect(out.reason).toBe('expired');
        expect(document.body.textContent).toContain('take another');
        expect(Frames.size()).toBe(0);
    });
});

// ── the card ────────────────────────────────────────────────────────────────

describe('ScreenCard', () => {
    test('freshness is stated in words a person reads, not a ticking clock', () => {
        expect(Card.freshness(0)).toBe('Just now');
        expect(Card.freshness(9000)).toBe('Just now');
        expect(Card.freshness(18000)).toBe('18 sec ago');
        expect(Card.freshness(4 * 60000)).toBe('4 min ago');
        expect(Card.freshness(90 * 60000)).toBe('1 h ago');
    });

    test('carries the three things the brief allows, and none of the internals', () => {
        const record = Frames.remember(handle(), 0);
        const card = Card.build(record, { doc: document, src: 'blob:x', now: () => 0, tick: false });
        expect(card.querySelector('.nexus-screen-device').textContent).toBe('Home PC');
        expect(card.querySelector('.nexus-screen-age').textContent).toBe('Just now');
        expect(card.querySelector('.nexus-screen-ask')).not.toBeNull();
        // No frame id, no byte count, no model name, no dimensions on the face of the card.
        const face = card.querySelector('.nexus-screen-foot').textContent;
        expect(face).not.toContain('aaaa1111');
        expect(face).not.toContain('4096');
        expect(face).not.toContain('1280');
    });

    test('says where the pixels went, without dumping a policy on every capture', () => {
        const record = Frames.remember(handle(), 0);
        const card = Card.build(record, { doc: document, src: 'blob:x', now: () => 0, tick: false });
        const privacy = card.querySelector('.nexus-screen-privacy');
        // Closed by default: a notice on every capture is a notice nobody reads.
        expect(privacy.hasAttribute('open')).toBe(false);
        expect(privacy.textContent).toContain('Deleted in');
        expect(privacy.textContent).toContain('Analysis');
    });

    test('retires itself when the frame expires rather than offering a dead button', () => {
        let t = 0;
        const record = Frames.remember(handle(), t);
        const card = Card.build(record, { doc: document, src: 'blob:x', now: () => t, tick: false });
        expect(card.querySelector('.nexus-screen-ask').disabled).toBe(false);

        t = Frames.TTL_MS + 1000;
        card.refreshLabel();
        expect(card.classList.contains('is-expired')).toBe(true);
        expect(card.querySelector('.nexus-screen-ask').disabled).toBe(true);
        expect(card.querySelector('.nexus-screen-age').textContent).toBe('Expired');
    });

    test('enlarges into a lightbox that closes on Escape', () => {
        const record = Frames.remember(handle(), 0);
        const card = Card.build(record, { doc: document, src: 'blob:x', now: () => 0, tick: false });
        document.body.appendChild(card);
        card.querySelector('.nexus-screen-shot').click();
        expect(document.querySelector('.nexus-screen-lightbox')).not.toBeNull();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(document.querySelector('.nexus-screen-lightbox')).toBeNull();
    });
});

// ── the composer hook ───────────────────────────────────────────────────────

describe('hook', () => {
    beforeEach(() => {
        document.body.innerHTML =
            '<div id="chat-history"></div><input id="speech-text" /><button id="speak-btn"></button>';
    });

    test('an ordinary message is never intercepted', () => {
        const send = document.getElementById('speak-btn');
        const seen = jest.fn();
        send.addEventListener('click', seen);
        Ask.hook(document);

        document.getElementById('speech-text').value = 'tell me a joke';
        send.click();
        expect(seen).toHaveBeenCalled();
    });

    test('a screenshot request never reaches the app handler', () => {
        const send = document.getElementById('speak-btn');
        const seen = jest.fn();
        send.addEventListener('click', seen);
        Ask.hook(document);

        document.getElementById('speech-text').value = 'take a screenshot of my pc';
        send.click();
        expect(seen).not.toHaveBeenCalled();
        expect(document.getElementById('speech-text').value).toBe('');
    });
});
