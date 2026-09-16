/**
 * SceneTaleConversationView — keep Scene Tale inside Conversation.
 *
 * StoryPlayer owns the story state machine. This module owns where that state is presented.
 * The avatar viewport remains the stage; the Conversation column owns narration, choices,
 * playback controls, the compact background soundtrack and the terminal completion UI.
 *
 * The current StoryPlayer still creates its small HUD for headset/special-environment fallback.
 * On the normal desktop/mobile page this module adopts that HUD into #chat-history immediately,
 * neutralises its fixed-position layout and keeps it there for the life of the story.
 *
 * Exposes: window.NEXUS_SCENE_TALE_VIEW
 */
const SceneTaleConversationView = (() => {
    'use strict';

    const HUD_ID = 'nexus-scene-tale-hud';
    const ROW_ID = 'nexus-scene-tale-conversation-row';
    const STYLE_ID = 'nexus-scene-tale-conversation-styles';
    const SOUNDTRACK_CLASS = 'nexus-scene-tale-soundtrack';
    const PLAYER_CLASS = 'nexus-scene-tale-soundtrack-player';

    let rootObserver = null;
    let hudObserver = null;
    let rowObserver = null;
    let currentHud = null;

    const CSS = `
#${ROW_ID}{display:block;width:100%;margin:10px 0 14px;box-sizing:border-box}
#${ROW_ID} #${HUD_ID}{position:relative!important;left:auto!important;right:auto!important;bottom:auto!important;transform:none!important;z-index:auto!important;width:100%!important;max-width:none!important;pointer-events:auto!important;margin:0!important;color:inherit!important}
#${ROW_ID} #${HUD_ID} .nexus-story-card,#${ROW_ID} #${HUD_ID} .nexus-story-bar{width:100%;box-sizing:border-box}
#${ROW_ID} #${HUD_ID} .nexus-story-card{margin:0 0 8px}
#${ROW_ID} #${HUD_ID} .nexus-story-bar{margin:0;display:flex;flex-wrap:wrap}
#${ROW_ID} #${HUD_ID}.is-complete .nexus-story-bar{display:none!important}
#${ROW_ID} #${HUD_ID}.is-complete .nexus-story-card{margin-bottom:0}
.${SOUNDTRACK_CLASS}{pointer-events:auto;display:flex;align-items:flex-start;gap:10px;justify-content:space-between;padding:9px 11px;margin:0 0 8px;border:1px solid rgba(255,255,255,.12);border-radius:12px;background:rgba(12,15,24,.55);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
.nexus-scene-tale-soundtrack-copy{min-width:0;flex:1}.nexus-scene-tale-soundtrack-kicker{font-size:.68rem;letter-spacing:.08em;text-transform:uppercase;opacity:.62;margin-bottom:2px}.nexus-scene-tale-soundtrack-title{font-size:.82rem;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.nexus-scene-tale-soundtrack-toggle{border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.07);color:inherit;border-radius:9px;padding:6px 8px;font:inherit;font-size:.72rem;cursor:pointer;flex:0 0 auto}.nexus-scene-tale-soundtrack-toggle:hover,.nexus-scene-tale-soundtrack-toggle:focus-visible{background:rgba(255,255,255,.13);outline:none}
.${PLAYER_CLASS}{display:none;width:min(260px,100%);margin:0 0 8px}.${PLAYER_CLASS}.is-open{display:block}.${PLAYER_CLASS} .nexus-yt-card{width:100%;max-width:260px;margin:0}. ${PLAYER_CLASS} .nexus-yt-meta{font-size:.72rem}
@media(max-width:700px){#${ROW_ID}{margin:8px 0 12px}. ${PLAYER_CLASS}{width:100%}. ${PLAYER_CLASS} .nexus-yt-card{max-width:100%}}
`;

    function ensureStyles(doc) {
        if (!doc || doc.getElementById(STYLE_ID)) return;
        const style = doc.createElement('style');
        style.id = STYLE_ID;
        style.textContent = CSS.replace(/\. nexus/g, '.nexus');
        (doc.head || doc.documentElement).appendChild(style);
    }

    function chatHost(doc) {
        return doc && doc.getElementById ? doc.getElementById('chat-history') : null;
    }

    function scrollConversation(host) {
        if (!host) return;
        try {
            host.scrollTop = host.scrollHeight;
        } catch (_) {}
    }

    function cleanupEmptyState(host) {
        if (!host || !host.querySelector) return;
        const empty = host.querySelector(':scope > .empty-state');
        if (empty) empty.remove();
    }

    function observeHud(hud) {
        if (hudObserver) hudObserver.disconnect();
        hudObserver = null;
        if (!hud || typeof MutationObserver === 'undefined') return;
        hudObserver = new MutationObserver(() => sync(hud));
        hudObserver.observe(hud, { childList: true, subtree: true, characterData: true, attributes: true });
    }

    function observeRow(row, hud) {
        if (rowObserver) rowObserver.disconnect();
        rowObserver = null;
        if (!row || typeof MutationObserver === 'undefined') return;
        rowObserver = new MutationObserver(() => {
            if (!hud || !row.contains(hud)) {
                if (row.parentNode) row.parentNode.removeChild(row);
                if (currentHud === hud) currentHud = null;
                if (hudObserver) hudObserver.disconnect();
                hudObserver = null;
                if (rowObserver) rowObserver.disconnect();
                rowObserver = null;
            }
        });
        rowObserver.observe(row, { childList: true });
    }

    function sync(hud = currentHud) {
        if (!hud) return false;
        const text = String(hud.textContent || '');
        const complete = /Story complete/i.test(text);
        hud.classList.toggle('is-complete', complete);
        const bar = hud.querySelector('.nexus-story-bar');
        if (bar) {
            bar.hidden = complete;
            bar.setAttribute('aria-hidden', complete ? 'true' : 'false');
        }
        const host = chatHost(hud.ownerDocument);
        scrollConversation(host);
        return complete;
    }

    function mountHud(hud, { doc } = {}) {
        const d = doc || (hud && hud.ownerDocument) || (typeof document !== 'undefined' ? document : null);
        const host = chatHost(d);
        if (!hud || !host) return null;
        ensureStyles(d);
        cleanupEmptyState(host);

        let row = d.getElementById(ROW_ID);
        if (!row) {
            row = d.createElement('div');
            row.id = ROW_ID;
            row.className = 'nexus-scene-tale-conversation-row';
            row.setAttribute('role', 'region');
            row.setAttribute('aria-label', 'Scene Tale');
            host.appendChild(row);
        }
        if (hud.parentNode !== row) row.appendChild(hud);

        // Inline layout wins over StoryPlayer's fallback HUD stylesheet without changing the
        // fallback itself. A page with no Conversation host keeps the fixed HUD unchanged.
        hud.style.position = 'relative';
        hud.style.left = 'auto';
        hud.style.right = 'auto';
        hud.style.bottom = 'auto';
        hud.style.transform = 'none';
        hud.style.zIndex = 'auto';
        hud.style.width = '100%';
        hud.style.maxWidth = 'none';
        hud.style.margin = '0';
        hud.style.pointerEvents = 'auto';
        hud.classList.add('is-conversation');

        currentHud = hud;
        observeHud(hud);
        observeRow(row, hud);
        sync(hud);
        scrollConversation(host);
        return row;
    }

    function adoptHud(doc) {
        const d = doc || (typeof document !== 'undefined' ? document : null);
        if (!d) return null;
        const hud = d.getElementById(HUD_ID);
        return hud ? mountHud(hud, { doc: d }) : null;
    }

    function removeSoundtrack(hud = currentHud) {
        if (!hud || !hud.querySelector) return false;
        const strip = hud.querySelector(`.${SOUNDTRACK_CLASS}`);
        const player = hud.querySelector(`.${PLAYER_CLASS}`);
        if (strip) strip.remove();
        if (player) player.remove();
        return Boolean(strip || player);
    }

    function attachSoundtrack(result, { doc, win, play = true } = {}) {
        const d = doc || (typeof document !== 'undefined' ? document : null);
        const w = win || (typeof window !== 'undefined' ? window : null);
        if (!d || !result) return null;
        const hud = d.getElementById(HUD_ID);
        if (!hud) return null;
        mountHud(hud, { doc: d });
        removeSoundtrack(hud);

        const bar = hud.querySelector('.nexus-story-bar');
        const strip = d.createElement('div');
        strip.className = SOUNDTRACK_CLASS;
        strip.setAttribute('data-scene-tale-soundtrack', '1');

        const copy = d.createElement('div');
        copy.className = 'nexus-scene-tale-soundtrack-copy';
        const kicker = d.createElement('div');
        kicker.className = 'nexus-scene-tale-soundtrack-kicker';
        kicker.textContent = 'Soundtrack';
        const title = d.createElement('div');
        title.className = 'nexus-scene-tale-soundtrack-title';
        title.textContent = `♫ ${String(result.title || 'Background music')}`;
        copy.appendChild(kicker);
        copy.appendChild(title);
        strip.appendChild(copy);

        const playerHost = d.createElement('div');
        playerHost.className = PLAYER_CLASS;
        playerHost.setAttribute('aria-label', 'Scene Tale soundtrack player');

        const embed = w && w.NEXUS_YT_2D;
        let card = null;
        if (embed && typeof embed.buildCard === 'function' && result.id) {
            const video = {
                id: String(result.id),
                name: String(result.title || ''),
                author: String(result.creator || ''),
                start: Number(result.start) || 0,
            };
            try {
                card = embed.buildCard(video, { doc: d });
                card.dataset.kind = 'music';
                card.dataset.creator = String(result.creator || '');
                card.classList.add('nexus-scene-tale-background-card');
                playerHost.appendChild(card);

                const toggle = d.createElement('button');
                toggle.type = 'button';
                toggle.className = 'nexus-scene-tale-soundtrack-toggle';
                toggle.textContent = 'Show player';
                toggle.setAttribute('aria-expanded', 'false');
                toggle.addEventListener('click', () => {
                    const open = !playerHost.classList.contains('is-open');
                    playerHost.classList.toggle('is-open', open);
                    toggle.textContent = open ? 'Hide player' : 'Show player';
                    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
                    scrollConversation(chatHost(d));
                });
                strip.appendChild(toggle);

                if (play && typeof embed.activate === 'function') {
                    embed.activate(card, video);
                    // YouTubeEmbed2D labels direct card activation as source=card. Scene Tale
                    // owns this playback, so restore the more useful source after activation.
                    const session = w && w.NEXUS_MEDIA_SESSION;
                    if (session && typeof session.requestPlay === 'function') {
                        session.requestPlay(result, { source: 'scene-tale' });
                    }
                }
            } catch (_) {
                card = null;
                playerHost.textContent = '';
            }
        }

        if (bar && bar.parentNode === hud) {
            hud.insertBefore(strip, bar);
            if (card) hud.insertBefore(playerHost, bar);
        } else {
            hud.appendChild(strip);
            if (card) hud.appendChild(playerHost);
        }
        sync(hud);
        return hud;
    }

    function install(doc) {
        const d = doc || (typeof document !== 'undefined' ? document : null);
        if (!d) return () => {};
        ensureStyles(d);
        adoptHud(d);
        if (rootObserver || typeof MutationObserver === 'undefined' || !d.body) return detach;
        rootObserver = new MutationObserver(() => adoptHud(d));
        rootObserver.observe(d.body, { childList: true, subtree: true });
        return detach;
    }

    function detach() {
        if (rootObserver) rootObserver.disconnect();
        if (hudObserver) hudObserver.disconnect();
        if (rowObserver) rowObserver.disconnect();
        rootObserver = null;
        hudObserver = null;
        rowObserver = null;
        currentHud = null;
    }

    const api = {
        HUD_ID,
        ROW_ID,
        STYLE_ID,
        CSS,
        install,
        detach,
        adoptHud,
        mountHud,
        sync,
        attachSoundtrack,
        removeSoundtrack,
    };

    if (typeof window !== 'undefined' && typeof document !== 'undefined' && !window.__NEXUS_SCENE_TALE_VIEW_NOAUTO__) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => install(document), { once: true });
        else install(document);
    }

    return api;
})();

if (typeof window !== 'undefined') window.NEXUS_SCENE_TALE_VIEW = SceneTaleConversationView;
if (typeof module !== 'undefined' && module.exports) module.exports = SceneTaleConversationView;
