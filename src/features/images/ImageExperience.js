/**
 * Conversational image experience layered on top of ImagePlugin.
 *
 * Keeps the provider/plugin core removable while improving the user-facing path:
 * - typo-tolerant natural image intents are intercepted before the text LLM
 * - "find/show a picture" means real-photo search; "generate/draw" means AI
 * - recent image results can be opened by click/tap or conversational follow-up
 * - personal Pollinations keys can be stored locally and sent only to the
 *   same-origin image gateway for the request
 * - concise chat feedback replaces provider/debug language
 */
(function (global) {
    'use strict';

    const media = global && global.NEXUS_IMAGE_MEDIA;
    if (!media) return;

    const POLLINATIONS_KEY_STORE = 'nexus.images.pollinationsApiKey';
    const VIEWER_ID = 'nexus-image-viewer';
    const objectUrls = new Set();
    const AI_ACTIONS = ['generate', 'create', 'render', 'draw', 'make'];
    const FIND_ACTIONS = ['find', 'show', 'search', 'lookup', 'give'];
    const IMAGE_NOUNS = ['image', 'images', 'picture', 'pictures', 'photo', 'photos', 'photograph', 'photographs'];
    const SELECTION_ACTIONS = ['display', 'show', 'open', 'view', 'enlarge', 'zoom'];
    const ORDINAL_INDEX = Object.freeze({
        first: 0,
        '1st': 0,
        one: 0,
        fist: 0,
        second: 1,
        '2nd': 1,
        two: 1,
        third: 2,
        '3rd': 2,
        three: 2,
        fourth: 3,
        '4th': 3,
        four: 3,
    });
    let recentResults = [];
    let lastViewerFocus = null;

    function storage() {
        try {
            return global.localStorage || null;
        } catch (_) {
            return null;
        }
    }

    function pollinationsKey() {
        const s = storage();
        if (!s) return '';
        try {
            return String(s.getItem(POLLINATIONS_KEY_STORE) || '').trim();
        } catch (_) {
            return '';
        }
    }

    function setPollinationsKey(value) {
        const s = storage();
        if (!s) return '';
        const clean = String(value || '').trim();
        try {
            if (clean) s.setItem(POLLINATIONS_KEY_STORE, clean);
            else s.removeItem(POLLINATIONS_KEY_STORE);
        } catch (_) {}
        return clean;
    }

    function editDistance(a, b, limit = 2) {
        const left = String(a || '').toLowerCase();
        const right = String(b || '').toLowerCase();
        if (Math.abs(left.length - right.length) > limit) return limit + 1;
        const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
        for (let i = 1; i <= left.length; i += 1) {
            const current = [i];
            let rowMin = current[0];
            for (let j = 1; j <= right.length; j += 1) {
                const cost = left[i - 1] === right[j - 1] ? 0 : 1;
                current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
                rowMin = Math.min(rowMin, current[j]);
            }
            if (rowMin > limit) return limit + 1;
            previous.splice(0, previous.length, ...current);
        }
        return previous[right.length];
    }

    function closestWord(token, words, limit = 2) {
        const value = String(token || '').toLowerCase();
        let best = null;
        let distance = limit + 1;
        for (const word of words) {
            const found = editDistance(value, word, limit);
            if (found < distance) {
                best = word;
                distance = found;
            }
        }
        return distance <= limit ? best : null;
    }

    function parseIntent(text) {
        const value = String(text || '')
            .replace(/\s+/g, ' ')
            .trim();
        if (!value) return null;

        const exact = typeof media.parseIntent === 'function' ? media.parseIntent(value) : null;
        if (exact) {
            if (exact.mode === 'auto' && !/^\//.test(value)) return { query: exact.query, mode: 'real' };
            return exact;
        }

        const stripped = value
            .replace(/^(?:can|could|would|will)\s+you\s+/i, '')
            .replace(/^please\s+/i, '')
            .trim();
        const tokens = stripped.split(/\s+/);
        if (tokens.length < 2) return null;

        const first = tokens[0].toLowerCase();
        const aiAction = closestWord(first, AI_ACTIONS, 2);
        let findAction = closestWord(first, FIND_ACTIONS, 2);
        let actionOffset = 1;
        if (!aiAction && !findAction && first === 'look' && tokens[1] && closestWord(tokens[1], ['up'], 1)) {
            findAction = 'lookup';
            actionOffset = 2;
        }
        if (!aiAction && !findAction) return null;

        let nounIndex = -1;
        for (let i = actionOffset; i < Math.min(tokens.length, actionOffset + 7); i += 1) {
            const token = tokens[i].replace(/[^a-z]/gi, '').toLowerCase();
            if (closestWord(token, IMAGE_NOUNS, 2)) {
                nounIndex = i;
                break;
            }
        }
        if (nounIndex < 0) return null;

        let queryTokens = tokens.slice(nounIndex + 1);
        while (queryTokens.length && /^(?:of|about|for|showing|with|on)$/i.test(queryTokens[0])) {
            queryTokens = queryTokens.slice(1);
        }
        const query = queryTokens.join(' ').trim();
        if (!query) return null;

        if (aiAction) return { query, mode: 'ai' };
        const beforeNoun = tokens.slice(actionOffset, nounIndex).join(' ').toLowerCase();
        return { query, mode: /\b(?:ai|generated)\b/.test(beforeNoun) ? 'ai' : 'real' };
    }

    function parseSelectionIntent(text) {
        const value = String(text || '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
        if (!value) return null;

        const stripped = value
            .replace(/^(?:can|could|would|will)\s+you\s+/, '')
            .replace(/^please\s+/, '')
            .replace(/^show\s+me\s+/, 'show ')
            .trim();
        const action = stripped.split(/\s+/)[0];
        if (!SELECTION_ACTIONS.includes(action)) return null;
        if (!/\b(?:image|images|picture|pictures|photo|photos|one)\b/.test(stripped)) return null;

        if (/\blast\b/.test(stripped)) return { index: 'last' };
        const ordinal = stripped.match(/\b(first|1st|one|fist|second|2nd|two|third|3rd|three|fourth|4th|four)\b/);
        if (ordinal) return { index: ORDINAL_INDEX[ordinal[1]] };

        const numbered = stripped.match(/\b(?:image|picture|photo)\s+(\d+)\b/);
        if (numbered) return { index: Math.max(0, Number(numbered[1]) - 1) };
        return null;
    }

    function installPollinationsProvider() {
        const provider = media.PollinationsProvider;
        if (!provider || provider.__nexusPersonalKey) return false;
        provider.__nexusPersonalKey = true;

        const originalStatus = provider.status.bind(provider);
        const originalReady = provider.ready.bind(provider);
        const originalSearch = provider.search.bind(provider);

        provider.status = function status() {
            const base = originalStatus();
            if (!pollinationsKey()) return base;
            return Object.assign({}, base, {
                configured: true,
                available: true,
                reason: 'ok',
            });
        };

        provider.ready = async function ready(deps = {}) {
            if (pollinationsKey()) return provider.status();
            await originalReady(deps);
            return provider.status();
        };

        provider.search = async function search(query, options = {}) {
            const personalKey = pollinationsKey();
            if (!personalKey) return originalSearch(query, options);
            const prompt = String(query || '')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 1200);
            if (!prompt) return [];
            const fetchImpl = options.fetch || (global.fetch && global.fetch.bind(global));
            if (!fetchImpl) return [];
            const size =
                options.width && options.height
                    ? { width: options.width, height: options.height }
                    : media.dimensions(options.ratio || '1:1');
            const seed = Number.isFinite(Number(options.seed))
                ? Math.abs(Math.floor(Number(options.seed)))
                : Math.floor(Math.random() * 1000000);
            const response = await fetchImpl(media.ROUTE, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'image/*',
                    'X-Nexus-Pollinations-Key': personalKey,
                },
                body: JSON.stringify({
                    provider: 'pollinations',
                    prompt,
                    width: size.width,
                    height: size.height,
                    seed,
                }),
            });
            if (!response.ok) throw new Error(`AI image generation failed (${response.status}).`);
            const blob = await response.blob();
            if (!global.URL || typeof global.URL.createObjectURL !== 'function') return [];
            const url = global.URL.createObjectURL(blob);
            objectUrls.add(url);
            return [
                {
                    id: `pollinations-personal-${seed}`,
                    provider: 'pollinations',
                    kind: 'image',
                    type: 'ai',
                    title: prompt,
                    creator: 'Pollinations.ai',
                    alt: `AI-generated image: ${prompt}`,
                    width: size.width,
                    height: size.height,
                    url,
                    thumbnail: url,
                    sourceUrl: 'https://pollinations.ai',
                },
            ];
        };
        return true;
    }

    function installSettings(doc) {
        const d = doc || global.document;
        if (!d || d.getElementById('nexus-image-pollinations-key')) return null;
        const panel = d.getElementById('nexus-image-settings');
        if (!panel) return null;

        const label = d.createElement('label');
        label.className = 'input-label';
        label.htmlFor = 'nexus-image-pollinations-key';
        label.textContent = '✨ POLLINATIONS API KEY — OPTIONAL';

        const input = d.createElement('input');
        input.id = 'nexus-image-pollinations-key';
        input.className = 'text-input';
        input.type = 'password';
        input.autocomplete = 'off';
        input.placeholder = 'Your Pollinations key (optional)';
        input.value = pollinationsKey();
        input.addEventListener('change', () => {
            setPollinationsKey(input.value);
            const settings = global.NEXUS_DISCOVERY_SETTINGS;
            if (settings && typeof settings.render === 'function') settings.render(d);
        });

        const note = d.createElement('p');
        note.className = 'nexus-image-settings-note';
        note.textContent =
            'Pollinations uses the Vercel deployment key automatically when available. Your personal key stays in this browser and is sent only to this site’s image gateway for generation requests.';

        panel.appendChild(label);
        panel.appendChild(input);
        panel.appendChild(note);
        return input;
    }

    function chatElements(doc) {
        const d = doc || global.document;
        if (!d) return {};
        const liveInput = d.getElementById('speech-text');
        return {
            history: d.getElementById('chat-history') || d.getElementById('chatHistory'),
            input: liveInput || d.getElementById('chatInput'),
            send: liveInput ? d.getElementById('speak-btn') : d.getElementById('sendBtn'),
        };
    }

    function remember(text, who) {
        if (global.ChatManager && typeof global.ChatManager.addMessage === 'function') return;
        const history = global.chatHistory;
        if (!history || typeof history.addMessage !== 'function') return;
        try {
            history.addMessage(who === 'user' ? 'user' : 'assistant', String(text || ''));
            if (typeof global._persistChat === 'function') global._persistChat();
        } catch (_) {}
    }

    function lastBotMessage(doc) {
        const elements = chatElements(doc);
        if (!elements.history) return null;
        const nodes = elements.history.querySelectorAll('.chat-message.avatar, .chat-message.bot');
        return nodes.length ? nodes[nodes.length - 1] : null;
    }

    function say(text, who, doc) {
        const d = doc || global.document;
        if (!d) return null;
        remember(text, who);
        if (global.ChatManager && typeof global.ChatManager.addMessage === 'function') {
            global.ChatManager.addMessage(text, who === 'user' ? 'user' : 'bot');
            return who === 'user' ? null : lastBotMessage(d);
        }
        const host = chatElements(d).history;
        if (!host) return null;
        const empty = host.querySelector('.empty-state');
        if (empty) empty.remove();
        const row = d.createElement('div');
        row.className = 'chat-row';
        const message = d.createElement('div');
        message.className = `chat-message ${who === 'user' ? 'user' : 'avatar'}`;
        const sender = d.createElement('div');
        sender.className = `message-sender ${who === 'user' ? 'user' : 'avatar'}`;
        sender.textContent = who === 'user' ? 'YOU' : 'NEXUS';
        const body = d.createElement('div');
        body.className = 'message-text';
        body.textContent = text;
        message.appendChild(sender);
        message.appendChild(body);
        row.appendChild(message);
        host.appendChild(row);
        host.scrollTop = host.scrollHeight;
        return message;
    }

    function injectViewerStyle(doc) {
        const d = doc || global.document;
        if (!d || d.getElementById('nexus-image-viewer-style')) return;
        const style = d.createElement('style');
        style.id = 'nexus-image-viewer-style';
        style.textContent = `
            .nexus-image-card-img[data-nexus-image-open="1"] { cursor: zoom-in; }
            .nexus-image-card-img[data-nexus-image-open="1"]:focus { outline: 2px solid var(--primary,#00e5ff); outline-offset: -2px; }
            .nexus-image-viewer { position:fixed; inset:0; z-index:12000; display:flex; align-items:center; justify-content:center; padding:24px; background:rgba(0,0,0,.88); backdrop-filter:blur(6px); }
            .nexus-image-viewer[hidden] { display:none!important; }
            .nexus-image-viewer-dialog { position:relative; display:flex; flex-direction:column; align-items:center; max-width:96vw; max-height:94vh; }
            .nexus-image-viewer-img { display:block; max-width:94vw; max-height:82vh; width:auto; height:auto; object-fit:contain; border-radius:12px; box-shadow:0 24px 70px rgba(0,0,0,.55); background:#111; }
            .nexus-image-viewer-close { position:absolute; top:-14px; right:-14px; width:38px; height:38px; border:1px solid rgba(255,255,255,.22); border-radius:999px; background:rgba(15,18,22,.94); color:#fff; font-size:24px; line-height:34px; cursor:pointer; }
            .nexus-image-viewer-caption { max-width:min(90vw,900px); margin-top:10px; color:rgba(255,255,255,.86); font-size:.8rem; line-height:1.4; text-align:center; }
            @media (max-width:600px) { .nexus-image-viewer { padding:12px; } .nexus-image-viewer-img { max-width:96vw; max-height:78vh; } .nexus-image-viewer-close { top:6px; right:6px; } }
        `;
        (d.head || d.documentElement).appendChild(style);
    }

    function closeViewer(doc) {
        const d = doc || global.document;
        const viewer = d && d.getElementById(VIEWER_ID);
        if (!viewer || viewer.hidden) return false;
        viewer.hidden = true;
        if (lastViewerFocus && typeof lastViewerFocus.focus === 'function') {
            try {
                lastViewerFocus.focus();
            } catch (_) {}
        }
        lastViewerFocus = null;
        return true;
    }

    function ensureViewer(doc) {
        const d = doc || global.document;
        if (!d) return null;
        injectViewerStyle(d);
        const found = d.getElementById(VIEWER_ID);
        if (found) return found;

        const viewer = d.createElement('div');
        viewer.id = VIEWER_ID;
        viewer.className = 'nexus-image-viewer';
        viewer.hidden = true;
        viewer.setAttribute('role', 'dialog');
        viewer.setAttribute('aria-modal', 'true');
        viewer.setAttribute('aria-label', 'Image preview');

        const dialog = d.createElement('div');
        dialog.className = 'nexus-image-viewer-dialog';
        const close = d.createElement('button');
        close.type = 'button';
        close.className = 'nexus-image-viewer-close';
        close.setAttribute('aria-label', 'Close image preview');
        close.textContent = '×';
        const image = d.createElement('img');
        image.className = 'nexus-image-viewer-img';
        const caption = d.createElement('div');
        caption.className = 'nexus-image-viewer-caption';

        close.addEventListener('click', () => closeViewer(d));
        viewer.addEventListener('click', (event) => {
            if (event.target === viewer) closeViewer(d);
        });
        d.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !viewer.hidden) closeViewer(d);
        });

        dialog.appendChild(close);
        dialog.appendChild(image);
        dialog.appendChild(caption);
        viewer.appendChild(dialog);
        (d.body || d.documentElement).appendChild(viewer);
        return viewer;
    }

    function openViewer(item, doc) {
        const d = doc || global.document;
        if (!d || !item || !item.url) return false;
        const viewer = ensureViewer(d);
        if (!viewer) return false;
        const image = viewer.querySelector('.nexus-image-viewer-img');
        const caption = viewer.querySelector('.nexus-image-viewer-caption');
        const close = viewer.querySelector('.nexus-image-viewer-close');
        lastViewerFocus = d.activeElement;
        image.src = item.url;
        image.alt = item.alt || item.title || 'Image preview';
        caption.textContent = item.title || item.alt || '';
        viewer.hidden = false;
        if (close && typeof close.focus === 'function') close.focus();
        return true;
    }

    function rememberResults(results) {
        recentResults = Array.isArray(results) ? results.filter((item) => item && item.url).slice(0, 12) : [];
        return recentResults.slice();
    }

    function recentImageResults() {
        return recentResults.slice();
    }

    function enhanceRenderedResults(message, results, doc) {
        const d = doc || global.document;
        if (!d || !message || !Array.isArray(results)) return 0;
        const grids = message.querySelectorAll('.nexus-image-grid');
        const grid = grids.length ? grids[grids.length - 1] : null;
        if (!grid) return 0;
        const images = [...grid.querySelectorAll('.nexus-image-card-img')];
        images.forEach((image, index) => {
            const item = results[index];
            if (!item || !item.url) return;
            image.dataset.nexusImageOpen = '1';
            image.tabIndex = 0;
            image.setAttribute('role', 'button');
            image.setAttribute('aria-label', `Open ${item.title || item.alt || `image ${index + 1}`} full size`);
            image.title = 'Click to enlarge';
            image.addEventListener('click', () => openViewer(item, d));
            image.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openViewer(item, d);
                }
            });
        });
        return images.length;
    }

    function presentResults(message, results, doc) {
        rememberResults(results);
        if (!message || typeof media.renderResults !== 'function') return 0;
        const count = media.renderResults(message, results, doc);
        enhanceRenderedResults(message, recentResults, doc);
        return count;
    }

    function providerLabel(provider) {
        if (!provider) return 'image provider';
        if (provider.ID === 'homepilot-remote') return 'HomePilot Remote';
        if (provider.ID === 'pollinations') return 'Pollinations';
        if (provider.ID === 'pexels') return 'Pexels';
        return provider.ID || 'image provider';
    }

    function ordinalLabel(index) {
        return ['first', 'second', 'third', 'fourth'][index] || `image ${index + 1}`;
    }

    function handleSelection(selection, originalText, doc) {
        const d = doc || global.document;
        if (!d || !selection || !recentResults.length) return false;
        const index = selection.index === 'last' ? recentResults.length - 1 : Number(selection.index);
        say(originalText, 'user', d);
        if (!Number.isInteger(index) || index < 0 || index >= recentResults.length) {
            say(`I only have ${recentResults.length} recent image${recentResults.length === 1 ? '' : 's'} to display.`, 'bot', d);
            return true;
        }
        const item = recentResults[index];
        say(`Opening the ${ordinalLabel(index)} image.`, 'bot', d);
        openViewer(item, d);
        return true;
    }

    async function handleIntent(intent, originalText, doc) {
        const d = doc || global.document;
        say(originalText, 'user', d);
        const provider = await media.chooseProvider(intent.mode);
        if (!provider) {
            const text =
                intent.mode === 'ai'
                    ? 'I can generate images once an AI generator is ready. Open Settings → Discovery & Media and choose Pollinations or HomePilot Remote. Pollinations can use the site key or your own key.'
                    : 'I can search photos once Pexels is ready. The site key is used automatically, or you can add your own Pexels key in Settings → Discovery & Media.';
            say(text, 'bot', d);
            return true;
        }

        let results;
        try {
            results = await provider.search(intent.query, {
                max: intent.mode === 'ai' ? 1 : 4,
                ratio: '1:1',
            });
        } catch (error) {
            const message = String(error && error.message ? error.message : error || '');
            if (/\((?:401|403)\)/.test(message)) {
                say(
                    `The ${providerLabel(provider)} key was rejected. Check it in Settings → Discovery & Media.`,
                    'bot',
                    d
                );
            } else {
                say(`I couldn’t reach ${providerLabel(provider)} right now. Please try again.`, 'bot', d);
            }
            return true;
        }

        if (!Array.isArray(results) || !results.length) {
            say(
                intent.mode === 'ai'
                    ? 'I couldn’t generate that image right now.'
                    : 'I couldn’t find matching photos right now.',
                'bot',
                d
            );
            return true;
        }

        const text =
            intent.mode === 'ai'
                ? `Here’s the image I generated with ${providerLabel(provider)}.`
                : `Here ${results.length === 1 ? 'is' : 'are'} ${results.length} ${intent.query} photo${results.length === 1 ? '' : 's'}.`;
        const message = say(text, 'bot', d);
        if (message) presentResults(message, results, d);
        return true;
    }

    function installInterceptor(doc) {
        const d = doc || global.document;
        if (!d || global.__nexusImageConversationIntercept) return false;
        global.__nexusImageConversationIntercept = true;

        const run = (event) => {
            const elements = chatElements(d);
            if (!elements.input) return false;
            const value = String(elements.input.value || '').trim();
            const selection = recentResults.length ? parseSelectionIntent(value) : null;
            const intent = selection ? null : parseIntent(value);
            if (!selection && !intent) return false;
            if (event) {
                event.preventDefault();
                event.stopPropagation();
                if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
            }
            elements.input.value = '';
            if (selection) return handleSelection(selection, value, d);
            handleIntent(intent, value, d).catch((error) => {
                if (global.console) global.console.warn('[NEXUS_IMAGE_EXPERIENCE] handler failed:', error);
                say('I couldn’t complete that image request right now.', 'bot', d);
            });
            return true;
        };

        const click = (event) => {
            const elements = chatElements(d);
            const target = event.target && event.target.closest ? event.target.closest('button') : event.target;
            if (target && elements.send && target === elements.send) run(event);
        };
        const keydown = (event) => {
            const elements = chatElements(d);
            if (event.key === 'Enter' && !event.shiftKey && event.target === elements.input) run(event);
        };
        global.addEventListener('click', click, true);
        global.addEventListener('keydown', keydown, true);
        global.__nexusImageConversationCleanup = () => {
            global.removeEventListener('click', click, true);
            global.removeEventListener('keydown', keydown, true);
            delete global.__nexusImageConversationIntercept;
            delete global.__nexusImageConversationCleanup;
        };
        return true;
    }

    function cleanup() {
        if (typeof global.__nexusImageConversationCleanup === 'function') {
            global.__nexusImageConversationCleanup();
        }
        closeViewer(global.document);
        const viewer = global.document && global.document.getElementById(VIEWER_ID);
        if (viewer) viewer.remove();
        recentResults = [];
        if (!global.URL || typeof global.URL.revokeObjectURL !== 'function') return;
        for (const url of objectUrls) {
            try {
                global.URL.revokeObjectURL(url);
            } catch (_) {}
        }
        objectUrls.clear();
    }

    function mount(doc) {
        installPollinationsProvider();
        installSettings(doc);
        ensureViewer(doc);
        installInterceptor(doc);
        const d = doc || global.document;
        const settingsButton = d && d.getElementById('settings-btn');
        if (settingsButton && !settingsButton.__nexusImageExperience) {
            settingsButton.__nexusImageExperience = true;
            settingsButton.addEventListener('click', () => installSettings(d));
        }
        return true;
    }

    const api = {
        POLLINATIONS_KEY_STORE,
        VIEWER_ID,
        pollinationsKey,
        setPollinationsKey,
        editDistance,
        parseIntent,
        parseSelectionIntent,
        installPollinationsProvider,
        installSettings,
        installInterceptor,
        rememberResults,
        recentImageResults,
        enhanceRenderedResults,
        presentResults,
        openViewer,
        closeViewer,
        handleSelection,
        handleIntent,
        mount,
        cleanup,
    };

    media.POLLINATIONS_KEY_STORE = POLLINATIONS_KEY_STORE;
    media.pollinationsKey = pollinationsKey;
    media.setPollinationsKey = setPollinationsKey;
    media.parseConversationalIntent = parseIntent;
    media.openImageViewer = openViewer;
    global.NEXUS_IMAGE_EXPERIENCE = api;

    if (typeof global.addEventListener === 'function') {
        global.addEventListener('beforeunload', cleanup, { once: true });
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = api;

    if (global.document && !global.__NEXUS_IMAGE_EXPERIENCE_NOAUTO__) {
        if (global.document.readyState === 'loading') {
            global.document.addEventListener('DOMContentLoaded', () => mount(), { once: true });
        } else {
            mount();
        }
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
