/**
 * YouTube Everywhere (batches YT-1…YT-5).
 *
 * Two properties are load-bearing and each has a test that fails if it stops being true:
 *
 *   * the chat never touches YouTube's servers until someone presses play — a facade
 *     with a thumbnail is all a message costs, and there is no iframe in the DOM until a click;
 *   * nothing here produces a media stream URL — playback is always YouTube's own player,
 *     an embed in 2D or a shared tab in VR.
 *
 * Everything else is the additive contract: the original ChatManager element is returned
 * untouched when a message has no link, and the VR panel never learns the word "YouTube".
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const YT = require('../src/features/youtube/YouTubeLink.js');

beforeEach(() => {
    window.NEXUS_YT = YT;
    window.__NEXUS_YT_2D_NOAUTO__ = true;
    window.__NEXUS_YT_VR_NOAUTO__ = true;
    global.fetch = jest.fn(() => Promise.resolve({ ok: false }));
});

// ── YT-1: the parser ────────────────────────────────────────────────────────

describe('YouTubeLink.extract', () => {
    test.each([
        ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ', 0],
        ['https://youtu.be/dQw4w9WgXcQ?t=90', 'dQw4w9WgXcQ', 90],
        ['youtube.com/shorts/aBcDeFgHiJk', 'aBcDeFgHiJk', 0],
        ['https://m.youtube.com/watch?feature=share&v=aBcDeFgHiJk&t=1h2m3s', 'aBcDeFgHiJk', 3723],
        ['https://music.youtube.com/watch?v=aBcDeFgHiJk', 'aBcDeFgHiJk', 0],
        ['https://www.youtube.com/embed/aBcDeFgHiJk?start=12', 'aBcDeFgHiJk', 12],
        ['https://www.youtube.com/live/aBcDeFgHiJk', 'aBcDeFgHiJk', 0],
    ])('%s → %s @%is', (url, id, start) => {
        const [v] = YT.extract(`look at this ${url} please`);
        expect(v).toBeDefined();
        expect(v.id).toBe(id);
        expect(v.start).toBe(start);
    });

    test('dedupes, preserves order, ignores lookalikes', () => {
        const text =
            'a https://youtu.be/dQw4w9WgXcQ b https://youtu.be/aBcDeFgHiJk c https://youtu.be/dQw4w9WgXcQ d https://youtu.be/short';
        expect(YT.extract(text).map((v) => v.id)).toEqual(['dQw4w9WgXcQ', 'aBcDeFgHiJk']);
        expect(YT.extract('no links here')).toEqual([]);
        expect(YT.extract(null)).toEqual([]);
    });

    test('URL builders are the compliant ones', () => {
        expect(YT.embedUrl('dQw4w9WgXcQ', { start: 5 })).toBe(
            'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0&playsinline=1&start=5'
        );
        expect(YT.watchUrl('dQw4w9WgXcQ', 90)).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90s');
        expect(YT.thumbnail('dQw4w9WgXcQ')).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
        expect(YT.thumbnail('dQw4w9WgXcQ', 'maxres')).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg');
    });

    test('attachment round-trips', () => {
        const att = YT.toAttachment({ id: 'dQw4w9WgXcQ', start: 3, name: 'Never' });
        expect(att.type).toBe('youtube');
        expect(YT.isYouTubeAttachment(att)).toBe(true);
        expect(YT.fromAttachment(att)).toEqual({ id: 'dQw4w9WgXcQ', start: 3, name: 'Never' });
        expect(YT.isYouTubeAttachment({ type: 'image', url: 'https://x/y.png' })).toBe(false);
        const img = YT.toImageAttachment({ id: 'dQw4w9WgXcQ' });
        expect(img.type).toBe('image');
        expect(img.kind).toBe('youtube');
        expect(img.url).toContain('i.ytimg.com');
    });

    test('never produces a direct media stream URL', () => {
        const src = fs.readFileSync(path.join(ROOT, 'src/features/youtube/YouTubeLink.js'), 'utf8');
        const comp = fs.readFileSync(path.join(ROOT, 'src/features/youtube/YouTubeCompanion.js'), 'utf8');
        for (const s of [src, comp]) {
            expect(s).not.toMatch(/googlevideo\.com\/videoplayback/);
            expect(s).not.toMatch(/get_video_info|player_response|signatureCipher|yt-dlp|ytdl/);
        }
    });
});

// ── YT-3: the 2D cards ──────────────────────────────────────────────────────

describe('YouTubeEmbed2D', () => {
    let Embed;
    beforeEach(() => {
        jest.resetModules();
        window.NEXUS_YT = YT;
        Embed = require('../src/features/youtube/YouTubeEmbed2D.js');
        document.body.innerHTML = '<div id="chatMessages"></div>';
    });

    function fakeMessageEl(content, attachments) {
        const wrap = document.createElement('div');
        wrap.className = 'message bot';
        const c = document.createElement('div');
        c.className = 'message-content';
        const b = document.createElement('div');
        b.className = 'message-bubble';
        b.textContent = content;
        c.appendChild(b);
        wrap.appendChild(c);
        return { el: wrap, message: { content, attachments } };
    }

    test('a link renders a facade, not an iframe, until clicked', () => {
        const { el, message } = fakeMessageEl('watch https://youtu.be/dQw4w9WgXcQ?t=10');
        expect(Embed.decorate(el, message)).toBe(1);
        const card = el.querySelector('.nexus-yt-card');
        expect(card.dataset.ytId).toBe('dQw4w9WgXcQ');
        expect(card.querySelector('iframe')).toBeNull();
        expect(card.querySelector('.nexus-yt-thumb').src).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
        expect(el.querySelector('.message-bubble').textContent).toBe('watch https://youtu.be/dQw4w9WgXcQ?t=10');

        card.querySelector('.nexus-yt-facade').click();
        const frame = card.querySelector('iframe.nexus-yt-player');
        expect(frame).not.toBeNull();
        expect(frame.src).toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ');
        expect(frame.src).toContain('start=10');
        expect(frame.getAttribute('allow')).toContain('autoplay');
        expect(frame.getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin');
        expect(card.querySelector('.nexus-yt-facade')).toBeNull();
    });

    test('only one player at a time; the other card returns to its facade', () => {
        const a = fakeMessageEl('https://youtu.be/dQw4w9WgXcQ');
        const b = fakeMessageEl('https://youtu.be/aBcDeFgHiJk');
        Embed.decorate(a.el, a.message);
        Embed.decorate(b.el, b.message);
        a.el.querySelector('.nexus-yt-facade').click();
        b.el.querySelector('.nexus-yt-facade').click();
        expect(a.el.querySelector('iframe')).toBeNull();
        expect(a.el.querySelector('.nexus-yt-facade')).not.toBeNull();
        expect(b.el.querySelector('iframe')).not.toBeNull();
    });

    test('youtube attachments render too, capped per message', () => {
        const atts = ['dQw4w9WgXcQ', 'aBcDeFgHiJk', 'zzzzzzzzzzz', 'yyyyyyyyyyy'].map((id) => YT.toAttachment({ id }));
        const { el, message } = fakeMessageEl('results', atts);
        expect(Embed.decorate(el, message)).toBe(Embed.MAX_CARDS_PER_MESSAGE);
        expect(el.querySelectorAll('.nexus-yt-card').length).toBe(3);
    });

    test('ChatManager hook is additive: plain messages come back untouched, and it unhooks', () => {
        const calls = [];
        const cm = {
            createMessageElement(message) {
                calls.push(message);
                return fakeMessageEl(message.content).el;
            },
        };
        const unhook = Embed.hookChatManager(cm);
        const plain = cm.createMessageElement({ content: 'hello' });
        expect(plain.querySelector('.nexus-yt-card')).toBeNull();
        expect(plain.className).toBe('message bot');
        const linked = cm.createMessageElement({ content: 'https://youtu.be/dQw4w9WgXcQ' });
        expect(linked.querySelector('.nexus-yt-card')).not.toBeNull();
        expect(calls.length).toBe(2);
        Embed.hookChatManager(cm); // idempotent
        unhook();
        expect(cm.__nexusYtHooked).toBeUndefined();
        expect(
            cm.createMessageElement({ content: 'https://youtu.be/dQw4w9WgXcQ' }).querySelector('.nexus-yt-card')
        ).toBeNull();
    });

    test('/yt command is parsed and never reaches the LLM path', () => {
        expect(Embed.parseCommand('/yt lofi beats')).toBe('lofi beats');
        expect(Embed.parseCommand('/YouTube  jazz ')).toBe('jazz');
        expect(Embed.parseCommand('tell me about /yt')).toBeNull();
        expect(Embed.parseCommand('hello')).toBeNull();

        document.body.innerHTML = '<input id="chatInput"><button id="sendBtn"></button><div id="chatMessages"></div>';
        const input = document.getElementById('chatInput');
        const send = document.getElementById('sendBtn');
        const mainJsHandler = jest.fn();
        send.addEventListener('click', mainJsHandler);
        window.ChatManager = { addMessage: jest.fn(), addRichMessage: jest.fn() };
        window.NEXUS_YT_COMPANION = { apiKey: () => '', KEY_STORAGE: 'nexus.yt.apiKey', search: jest.fn() };
        Embed.hookCommand(document);
        input.value = '/yt lofi';
        send.click();
        expect(mainJsHandler).not.toHaveBeenCalled();
        expect(input.value).toBe('');
        expect(window.ChatManager.addMessage).toHaveBeenCalledWith('/yt lofi', 'user');
        input.value = 'normal message';
        send.click();
        expect(mainJsHandler).toHaveBeenCalledTimes(1);
    });
});

// ── YT-2 / YT-4: companion tab and the VR bridge ────────────────────────────

describe('YouTubeCompanion', () => {
    const Companion = require('../src/features/youtube/YouTubeCompanion.js');

    function fakeWindow() {
        const opened = [];
        const w = {
            open: jest.fn((url, name) => {
                const h = {
                    url,
                    name,
                    closed: false,
                    location: { href: url },
                    close() {
                        this.closed = true;
                    },
                };
                opened.push(h);
                return h;
            }),
            opened,
        };
        return w;
    }

    test('opens once, then navigates the same named tab (one permission per evening)', async () => {
        const win = fakeWindow();
        const c = new Companion.Companion({ win });
        expect(c.isOpen()).toBe(false);
        c.open('dQw4w9WgXcQ');
        c.navigate('aBcDeFgHiJk', 30);
        expect(win.open).toHaveBeenCalledTimes(1);
        expect(win.open.mock.calls[0][1]).toBe(Companion.WINDOW_NAME);
        expect(win.opened[0].location.href).toBe('https://www.youtube.com/watch?v=aBcDeFgHiJk&t=30s');
        expect(c.current).toEqual({ id: 'aBcDeFgHiJk', start: 30 });
        c.close();
        expect(win.opened[0].closed).toBe(true);
        expect(c.isOpen()).toBe(false);
    });

    test('startParty hands the tab to Watch.shareTab when it exists', async () => {
        const win = fakeWindow();
        const c = new Companion.Companion({ win });
        const watch = { shareTab: jest.fn(async () => ({ source: 'tab' })) };
        const r = await c.startParty('dQw4w9WgXcQ', 0, { watch });
        expect(watch.shareTab).toHaveBeenCalledTimes(1);
        expect(r.watch).toEqual({ source: 'tab' });
        expect(r.companion).toBe(win.opened[0]);
    });

    test('search is hidden without a key and maps results when one is given', async () => {
        expect(await Companion.search('lofi', { key: '' })).toBeNull();
        const fetchImpl = jest.fn(async () => ({
            ok: true,
            json: async () => ({
                items: [
                    { id: { videoId: 'dQw4w9WgXcQ' }, snippet: { title: 'T', channelTitle: 'C' } },
                    { id: { videoId: 'bad' } },
                ],
            }),
        }));
        const r = await Companion.search('lofi', { key: 'K', fetchImpl });
        expect(r).toEqual([{ id: 'dQw4w9WgXcQ', start: 0, name: 'T', author: 'C' }]);
        expect(fetchImpl.mock.calls[0][0]).toContain('videoEmbeddable=true');
    });
});

describe('YouTubeVRBridge', () => {
    let Bridge;
    let panel;
    let media;
    beforeEach(() => {
        jest.resetModules();
        window.NEXUS_YT = YT;
        window.NEXUS_YT_CONFIG = undefined;
        Bridge = require('../src/features/youtube/YouTubeVRBridge.js');
        panel = {
            messages: [],
            appendMessage(role, text) {
                this.messages.push({ role, text });
            },
            appendRichMessage(m) {
                this.messages.push(m);
            },
        };
        media = {
            shown: [],
            show(att) {
                this.shown.push(att);
            },
        };
        window.ChatManager = { addRichMessage: jest.fn(), addMessage: jest.fn() };
    });
    afterEach(() => Bridge.detach());

    test('a link in VR chat becomes an image card the panel already knows how to draw', () => {
        Bridge.attach({ vrChatPanel: panel, vrMediaPanel: media });
        panel.appendMessage('bot', 'try https://youtu.be/dQw4w9WgXcQ');
        const m = panel.messages[0];
        expect(m.attachments).toHaveLength(1);
        expect(m.attachments[0]).toMatchObject({ type: 'image', kind: 'youtube', youtubeId: 'dQw4w9WgXcQ' });
        expect(m.attachments[0].url).toContain('i.ytimg.com');
        panel.appendMessage('bot', 'no link');
        expect(panel.messages[1]).toEqual({ role: 'bot', text: 'no link' });
    });

    test('youtube attachments are converted; image attachments pass through', () => {
        Bridge.attach({ vrChatPanel: panel, vrMediaPanel: media });
        panel.appendRichMessage({
            role: 'bot',
            text: 'x',
            attachments: [YT.toAttachment({ id: 'dQw4w9WgXcQ' }), { type: 'image', url: 'https://a/b.png' }],
        });
        const atts = panel.messages[0].attachments;
        expect(atts.map((a) => a.type)).toEqual(['image', 'image']);
        expect(atts[0].kind).toBe('youtube');
        expect(atts[1].url).toBe('https://a/b.png');
    });

    test('a tap navigates the companion when open, otherwise waits for the session to end', () => {
        const comp = { isOpen: jest.fn(() => true), navigate: jest.fn() };
        window.NEXUS_YT_COMPANION = comp;
        Bridge.attach({ vrChatPanel: panel, vrMediaPanel: media });
        const att = YT.toImageAttachment({ id: 'dQw4w9WgXcQ', start: 7 });
        media.show(att);
        expect(media.shown[0]).toBe(att); // poster still drawn by the original panel
        expect(comp.navigate).toHaveBeenCalledWith('dQw4w9WgXcQ', 7);

        comp.isOpen.mockReturnValue(false);
        media.show(YT.toImageAttachment({ id: 'aBcDeFgHiJk' }));
        expect(comp.navigate).toHaveBeenCalledTimes(1);
        expect(Bridge._state.pending.youtubeId).toBe('aBcDeFgHiJk');
        expect(Bridge.flushPending()).toBe(true);
        expect(window.ChatManager.addRichMessage).toHaveBeenCalledTimes(1);
        expect(window.ChatManager.addRichMessage.mock.calls[0][2][0]).toMatchObject({
            type: 'youtube',
            youtubeId: 'aBcDeFgHiJk',
        });
        expect(Bridge.flushPending()).toBe(false);
    });

    test('the VR panel source never learns the word YouTube', () => {
        const src = fs.readFileSync(path.join(ROOT, 'src/gltf-viewer/VRChatPanel.js'), 'utf8');
        expect(src).not.toMatch(/youtube/i);
    });
});

// ── YT-5: proxy routes stay off the stream path ─────────────────────────────

describe('nexus-proxy youtube routes', () => {
    const { isYouTubeUrl, ID_RE } = require('../nexus-proxy/youtube-routes.js');
    test('only https YouTube hosts, only 11-char ids', () => {
        expect(isYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
        expect(isYouTubeUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(true);
        expect(isYouTubeUrl('http://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(false);
        expect(isYouTubeUrl('https://evil.example/youtube.com')).toBe(false);
        expect(ID_RE.test('dQw4w9WgXcQ')).toBe(true);
        expect(ID_RE.test('../../etc')).toBe(false);
    });
});
