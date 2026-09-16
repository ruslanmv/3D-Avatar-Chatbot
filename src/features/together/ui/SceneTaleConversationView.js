/**
 * SceneTaleConversationView — Conversation is the Scene Tale surface.
 *
 * Product rule:
 *   Together launches it -> the avatar performs it -> Conversation contains it.
 *
 * StoryPlayer owns timing, narration, branching and completion. This module owns presentation.
 * On the ordinary desktop/mobile page a StoryPlayer mounts directly into #chat-history, so
 * there is never a visible document.body HUD between the Ready screen and playback. The old
 * fixed HUD remains only as a fallback for pages/environments with no Conversation surface.
 *
 * The repository uses classic scripts rather than imports. Playground's StoryPlayer is exposed
 * on window.NEXUS_BD_PLAYGROUND, so this view installs one presentation bridge on its prototype
 * when that class becomes available. No story-state logic is replaced.
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
    const PATCH_FLAG = '__sceneTaleConversationViewPatched';

    let rootObserver = null;
    let hudObserver = null;
    let rowObserver = null;
    let patchTimer = null;
    let currentHud = null;
    let currentWin = null;
    let composerBinding = null;

    const CSS = `
#${ROW_ID}{display:block;width:100%;margin:10px 0 14px;box-sizing:border-box}
#${HUD_ID}{box-sizing:border-box;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#fff;pointer-events:none}
#${HUD_ID} *{box-sizing:border-box}
#${HUD_ID}:not(.is-conversation){position:fixed;left:50%;bottom:max(18px,env(safe-area-inset-bottom));transform:translateX(-50%);z-index:2147482500;width:min(680px,calc(100vw - 28px))}
#${ROW_ID} #${HUD_ID}{position:relative!important;left:auto!important;right:auto!important;bottom:auto!important;transform:none!important;z-index:auto!important;width:100%!important;max-width:none!important;pointer-events:auto!important;margin:0!important;color:inherit!important}
.nexus-story-shell{pointer-events:auto;width:100%;background:rgba(9,18,29,.72);border:1px solid rgba(24,218,255,.38);border-radius:16px;box-shadow:0 16px 50px rgba(0,0,0,.26);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);overflow:hidden}
#${HUD_ID}:not(.is-conversation) .nexus-story-shell{background:rgba(12,15,24,.82);border-color:rgba(255,255,255,.14)}
.nexus-story-heading{padding:15px 17px 11px;border-bottom:1px solid rgba(255,255,255,.08)}
.nexus-story-kicker{font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;color:#20d7f2;font-weight:700;margin-bottom:6px}
.nexus-story-heading-title{font-size:1.08rem;line-height:1.25;font-weight:750;letter-spacing:.01em;color:#fff;margin:0 0 3px}
.nexus-story-heading-note{font-size:.8rem;line-height:1.4;opacity:.66}
.nexus-story-card{pointer-events:auto;padding:15px 17px;margin:0;background:transparent;border:0;box-shadow:none}
.nexus-story-caption{font-size:.98rem;line-height:1.55;text-wrap:pretty;white-space:pre-wrap}
.nexus-story-starting{font-size:.9rem;line-height:1.5;opacity:.74}
.nexus-story-choice-title{font-size:.92rem;line-height:1.45;margin-bottom:11px}
.nexus-story-options{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.nexus-story-option{width:100%;border:1px solid rgba(24,218,255,.42);background:rgba(0,185,218,.08);color:inherit;border-radius:12px;padding:12px;text-align:left;font:inherit;cursor:pointer}
.nexus-story-option:hover,.nexus-story-option:focus-visible{background:rgba(0,185,218,.16);outline:none}
.nexus-story-option:active{transform:translateY(1px)}
.nexus-story-bar{pointer-events:auto;display:flex;align-items:center;gap:10px;padding:10px 12px;border-top:1px solid rgba(255,255,255,.08);background:rgba(0,0,0,.12)}
.nexus-story-title{font-weight:650;font-size:.82rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1}
#${ROW_ID} .nexus-story-title{display:none}
.nexus-story-time{font-size:.76rem;opacity:.72;font-variant-numeric:tabular-nums;margin-left:auto}
.nexus-story-btn{border:1px solid rgba(24,218,255,.34);background:rgba(0,185,218,.08);color:inherit;border-radius:10px;padding:7px 11px;font:inherit;font-size:.78rem;cursor:pointer}
.nexus-story-btn:hover,.nexus-story-btn:focus-visible{background:rgba(0,185,218,.16);outline:none}
.nexus-story-btn.is-end{opacity:.86}
.nexus-story-complete-title{font-weight:750;font-size:1rem;margin-bottom:5px}
.nexus-story-complete-note{font-size:.84rem;opacity:.74;margin-bottom:12px}
.nexus-story-complete-actions{display:flex;flex-wrap:wrap;gap:8px}
#${HUD_ID}.is-complete .nexus-story-bar{display:none!important}
#${HUD_ID}.is-complete .nexus-story-card{padding-bottom:16px}
.${SOUNDTRACK_CLASS}{pointer-events:auto;display:flex;align-items:flex-start;gap:10px;justify-content:space-between;padding:9px 12px;margin:0 12px 10px;border:1px solid rgba(255,255,255,.1);border-radius:11px;background:rgba(0,0,0,.13)}
.nexus-scene-tale-soundtrack-copy{min-width:0;flex:1}.nexus-scene-tale-soundtrack-kicker{font-size:.66rem;letter-spacing:.08em;text-transform:uppercase;opacity:.56;margin-bottom:2px}.nexus-scene-tale-soundtrack-title{font-size:.8rem;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.nexus-scene-tale-soundtrack-toggle{border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:inherit;border-radius:9px;padding:6px 8px;font:inherit;font-size:.72rem;cursor:pointer;flex:0 0 auto}.nexus-scene-tale-soundtrack-toggle:hover,.nexus-scene-tale-soundtrack-toggle:focus-visible{background:rgba(255,255,255,.12);outline:none}
.${PLAYER_CLASS}{display:none;width:min(280px,calc(100% - 24px));margin:0 12px 10px}.${PLAYER_CLASS}.is-open{display:block}.${PLAYER_CLASS} .nexus-yt-card{width:100%;max-width:280px;margin:0}.${PLAYER_CLASS} .nexus-yt-meta{font-size:.72rem}
.nexus-story-setup-label{display:block;font-size:.78rem;opacity:.72;margin:12px 0 5px}.nexus-story-setup-input{width:100%;min-height:72px;resize:vertical;border-radius:11px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:inherit;padding:10px;font:inherit}.nexus-story-radio{display:flex;align-items:center;gap:8px;margin:7px 0;font-size:.88rem}.nexus-story-progress{display:grid;gap:7px;margin:12px 0}.nexus-story-progress-row{font-size:.86rem;opacity:.72}.nexus-story-progress-row.is-done{opacity:1}.nexus-story-ready-meta{font-size:.84rem;opacity:.75;line-height:1.55;margin:8px 0 14px;white-space:pre-line}
@media(max-width:700px){#${ROW_ID}{margin:8px 0 12px}.nexus-story-options{grid-template-columns:1fr}.nexus-story-caption{font-size:.94rem}.${PLAYER_CLASS}{width:calc(100% - 24px)}.${PLAYER_CLASS} .nexus-yt-card{max-width:100%}}
@media(max-width:560px){#${HUD_ID}:not(.is-conversation){width:calc(100vw - 18px);bottom:max(9px,env(safe-area-inset-bottom))}.nexus-story-bar{gap:6px;flex-wrap:wrap}.nexus-story-btn{padding:7px 9px}.nexus-story-heading{padding:13px 14px 10px}.nexus-story-card{padding:13px 14px}}
`;

    function ensureStyles(doc) {
        if (!doc || doc.getElementById(STYLE_ID)) return;
        const style = doc.createElement('style');
        style.id = STYLE_ID;
        style.textContent = CSS;
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

    function storyInput(doc) {
        return doc && (doc.getElementById('speech-text') || doc.getElementById('chatInput'));
    }

    function storySend(doc) {
        return doc && (doc.getElementById('speak-btn') || doc.getElementById('sendBtn'));
    }

    function activePlayer(win) {
        const w = win || currentWin || (typeof window !== 'undefined' ? window : null);
        const director = w && w.NEXUS_BD;
        const panel = director && director.togetherPanel;
        const activity = panel && panel.activities && typeof panel.activities.get === 'function' ? panel.activities.get('playground') : null;
        return activity && activity.player ? activity.player : null;
    }

    function pauseForChat(win) {
        const player = activePlayer(win);
        if (!player || typeof player.pause !== 'function') return false;
        if (player.state !== 'playing' && player.state !== 'waiting-choice') return false;
        return player.pause() === true;
    }

    function bindComposer(doc, win) {
        const input = storyInput(doc);
        if (!input) return;
        if (!Object.prototype.hasOwnProperty.call(input.dataset, 'nexusSceneTalePlaceholder')) {
            input.dataset.nexusSceneTalePlaceholder = input.getAttribute('placeholder') || '';
        }
        input.setAttribute('placeholder', 'Talk to the story…');

        const send = storySend(doc);
        if (composerBinding && composerBinding.input === input && composerBinding.send === send) return;
        unbindComposer(false);

        const onSend = () => pauseForChat(win);
        const onKey = (event) => {
            if (event && event.key === 'Enter' && !event.shiftKey) pauseForChat(win);
        };
        if (send) send.addEventListener('click', onSend, true);
        input.addEventListener('keydown', onKey, true);
        composerBinding = { input, send, onSend, onKey };
    }

    function unbindComposer(restore = true) {
        const binding = composerBinding;
        if (!binding) return;
        if (binding.send) binding.send.removeEventListener('click', binding.onSend, true);
        if (binding.input) {
            binding.input.removeEventListener('keydown', binding.onKey, true);
            if (restore && Object.prototype.hasOwnProperty.call(binding.input.dataset, 'nexusSceneTalePlaceholder')) {
                const previous = binding.input.dataset.nexusSceneTalePlaceholder;
                binding.input.setAttribute('placeholder', previous);
                delete binding.input.dataset.nexusSceneTalePlaceholder;
            }
        }
        composerBinding = null;
    }

    function button(doc, parent, label, className, onClick) {
        const node = doc.createElement('button');
        node.type = 'button';
        node.className = className || '';
        node.textContent = label;
        if (onClick) node.addEventListener('click', onClick);
        parent.appendChild(node);
        return node;
    }

    function heading(hud, title) {
        const doc = hud.ownerDocument;
        let block = hud.querySelector('.nexus-story-heading');
        if (!block) {
            block = doc.createElement('div');
            block.className = 'nexus-story-heading';
            const kicker = doc.createElement('div');
            kicker.className = 'nexus-story-kicker';
            kicker.textContent = '✨ SCENE TALE';
            const name = doc.createElement('div');
            name.className = 'nexus-story-heading-title';
            const note = doc.createElement('div');
            note.className = 'nexus-story-heading-note';
            note.textContent = 'Fictional story inspired by this scene';
            block.appendChild(kicker);
            block.appendChild(name);
            block.appendChild(note);
            const shell = hud.querySelector('.nexus-story-shell') || hud;
            shell.insertBefore(block, shell.firstChild);
        }
        const name = block.querySelector('.nexus-story-heading-title');
        if (name) name.textContent = String(title || 'Scene Tale');
        return block;
    }

    function ensureShell(hud) {
        if (!hud) return null;
        let shell = hud.querySelector(':scope > .nexus-story-shell');
        if (shell) return shell;
        const doc = hud.ownerDocument;
        shell = doc.createElement('div');
        shell.className = 'nexus-story-shell';
        while (hud.firstChild) shell.appendChild(hud.firstChild);
        hud.appendChild(shell);
        return shell;
    }

    function removeExisting(doc) {
        if (!doc) return;
        const old = doc.getElementById(HUD_ID);
        if (old && old.parentNode) old.parentNode.removeChild(old);
        const row = doc.getElementById(ROW_ID);
        if (row && row.parentNode) row.parentNode.removeChild(row);
    }

    /**
     * Primary renderer used by StoryPlayer after the prototype bridge is installed.
     * It mounts straight into Conversation when possible. document.body is only the fallback.
     */
    function mountPlayer(player) {
        const doc = player && player.doc;
        if (!doc || !doc.createElement) return null;
        ensureStyles(doc);
        removeExisting(doc);

        const host = chatHost(doc);
        let parent = doc.body;
        let row = null;
        if (host) {
            cleanupEmptyState(host);
            row = doc.createElement('div');
            row.id = ROW_ID;
            row.className = 'nexus-scene-tale-conversation-row';
            row.setAttribute('role', 'region');
            row.setAttribute('aria-label', 'Scene Tale');
            host.appendChild(row);
            parent = row;
        }

        const hud = doc.createElement('div');
        hud.id = HUD_ID;
        hud.setAttribute('aria-live', 'polite');
        if (host) hud.classList.add('is-conversation');
        parent.appendChild(hud);

        const shell = doc.createElement('div');
        shell.className = 'nexus-story-shell';
        hud.appendChild(shell);
        heading(hud, player.plan && player.plan.title);

        const card = doc.createElement('div');
        card.className = 'nexus-story-card';
        const starting = doc.createElement('div');
        starting.className = 'nexus-story-starting';
        starting.textContent = 'Starting the story…';
        card.appendChild(starting);
        shell.appendChild(card);

        const bar = doc.createElement('div');
        bar.className = 'nexus-story-bar';
        const title = doc.createElement('span');
        title.className = 'nexus-story-title';
        title.textContent = String((player.plan && player.plan.title) || 'Scene Tale');
        const time = doc.createElement('span');
        time.className = 'nexus-story-time';
        time.textContent = '0:00';
        bar.appendChild(title);
        bar.appendChild(time);
        const pause = button(doc, bar, 'Pause', 'nexus-story-btn', () => {
            if (player.state === 'paused') player.resume();
            else player.pause();
        });
        button(doc, bar, 'End', 'nexus-story-btn is-end', () => player.end('user'));
        shell.appendChild(bar);

        player.hud = hud;
        player.card = card;
        player._titleEl = title;
        player._timeEl = time;
        player._pauseBtn = pause;

        currentHud = hud;
        currentWin = player.win || currentWin;
        observeHud(hud);
        if (row) observeRow(row, hud);
        if (host) bindComposer(doc, player.win);
        sync(hud);
        scrollConversation(host);
        return hud;
    }

    function observeHud(hud) {
        if (hudObserver) hudObserver.disconnect();
        hudObserver = null;
        if (!hud || typeof MutationObserver === 'undefined') return;
        hudObserver = new MutationObserver(() => sync(hud));
        hudObserver.observe(hud, { childList: true, subtree: true, characterData: true });
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
                unbindComposer(true);
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
        if (complete) unbindComposer(true);
        else if (hud.classList.contains('is-conversation')) bindComposer(hud.ownerDocument, currentWin);
        scrollConversation(chatHost(hud.ownerDocument));
        return complete;
    }

    /**
     * Compatibility path for a HUD created before this view finished loading. It is moved into
     * Conversation before the next useful interaction and decorated to match the primary view.
     */
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
        hud.classList.add('is-conversation');
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

        const existingTitle = hud.querySelector('.nexus-story-title');
        ensureShell(hud);
        heading(hud, existingTitle && existingTitle.textContent);
        const card = hud.querySelector('.nexus-story-card');
        if (card && (card.hidden || !String(card.textContent || '').trim())) {
            card.hidden = false;
            card.textContent = '';
            const starting = d.createElement('div');
            starting.className = 'nexus-story-starting';
            starting.textContent = 'Starting the story…';
            card.appendChild(starting);
        }

        currentHud = hud;
        observeHud(hud);
        observeRow(row, hud);
        bindComposer(d, currentWin || (typeof window !== 'undefined' ? window : null));
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
        const w = win || currentWin || (typeof window !== 'undefined' ? window : null);
        if (!d || !result) return null;
        const hud = d.getElementById(HUD_ID);
        if (!hud) return null;
        if (chatHost(d)) mountHud(hud, { doc: d });
        removeSoundtrack(hud);

        const shell = ensureShell(hud) || hud;
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

                const toggle = button(d, strip, 'Show player', 'nexus-scene-tale-soundtrack-toggle', () => {
                    const open = !playerHost.classList.contains('is-open');
                    playerHost.classList.toggle('is-open', open);
                    toggle.textContent = open ? 'Hide player' : 'Show player';
                    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
                    scrollConversation(chatHost(d));
                });
                toggle.setAttribute('aria-expanded', 'false');

                if (play && typeof embed.activate === 'function') {
                    embed.activate(card, video);
                    const session = w && w.NEXUS_MEDIA_SESSION;
                    if (session && typeof session.requestPlay === 'function') session.requestPlay(result, { source: 'scene-tale' });
                }
            } catch (_) {
                card = null;
                playerHost.textContent = '';
            }
        }

        if (bar && bar.parentNode) {
            bar.parentNode.insertBefore(strip, bar);
            if (card) bar.parentNode.insertBefore(playerHost, bar);
        } else {
            shell.appendChild(strip);
            if (card) shell.appendChild(playerHost);
        }
        sync(hud);
        return hud;
    }

    function decorateReadyControls(doc) {
        if (!doc || !doc.querySelectorAll) return;
        for (const start of doc.querySelectorAll('[data-action="start-story"]')) {
            if (start.dataset.sceneTaleStartingBound === '1') continue;
            start.dataset.sceneTaleStartingBound = '1';
            start.addEventListener('click', () => {
                start.disabled = true;
                start.textContent = 'Starting…';
            });
        }
        for (const edit of doc.querySelectorAll('[data-action="another-version"]')) {
            edit.textContent = 'Edit setup';
        }
        for (const meta of doc.querySelectorAll('.nexus-story-ready-meta')) {
            if (/Story ready/i.test(meta.textContent || '')) {
                meta.textContent = String(meta.textContent || '').replace('✓ Story ready · ✓ Scene ready · ', 'Ready to begin · ');
            }
        }
    }

    function patchStoryPlayer(playground) {
        const api = playground || (currentWin && currentWin.NEXUS_BD_PLAYGROUND) || (typeof window !== 'undefined' ? window.NEXUS_BD_PLAYGROUND : null);
        const StoryPlayer = api && api.StoryPlayer;
        if (!StoryPlayer || !StoryPlayer.prototype) return false;
        const proto = StoryPlayer.prototype;
        if (proto[PATCH_FLAG]) return true;

        const originalMount = proto._mount;
        const originalComplete = proto._paintComplete;
        const originalDetach = proto.detach;
        const originalError = proto._error;

        proto._mount = function sceneTaleConversationMount() {
            const mounted = mountPlayer(this);
            if (mounted) return mounted;
            return typeof originalMount === 'function' ? originalMount.call(this) : null;
        };
        proto._paintComplete = function sceneTaleConversationComplete() {
            const out = typeof originalComplete === 'function' ? originalComplete.call(this) : undefined;
            sync(this.hud);
            return out;
        };
        proto.detach = function sceneTaleConversationDetach() {
            const doc = this.doc;
            const out = typeof originalDetach === 'function' ? originalDetach.call(this) : undefined;
            const row = doc && doc.getElementById ? doc.getElementById(ROW_ID) : null;
            if (row && !row.querySelector(`#${HUD_ID}`) && row.parentNode) row.parentNode.removeChild(row);
            unbindComposer(true);
            if (currentHud === this.hud || !this.hud) currentHud = null;
            return out;
        };
        proto._error = function sceneTaleConversationError(why) {
            const out = typeof originalError === 'function' ? originalError.call(this, why) : undefined;
            unbindComposer(true);
            return out;
        };

        Object.defineProperty(proto, PATCH_FLAG, { configurable: true, value: true });
        return true;
    }

    function installStoryPlayerBridge(win) {
        const w = win || (typeof window !== 'undefined' ? window : null);
        currentWin = w || currentWin;
        if (patchStoryPlayer(w && w.NEXUS_BD_PLAYGROUND)) return true;
        if (patchTimer || !w || typeof w.setInterval !== 'function') return false;
        let tries = 0;
        patchTimer = w.setInterval(() => {
            tries += 1;
            if (patchStoryPlayer(w.NEXUS_BD_PLAYGROUND) || tries >= 200) {
                w.clearInterval(patchTimer);
                patchTimer = null;
            }
        }, 50);
        return false;
    }

    function install(doc, win) {
        const d = doc || (typeof document !== 'undefined' ? document : null);
        const w = win || (typeof window !== 'undefined' ? window : null);
        if (!d) return () => {};
        currentWin = w || currentWin;
        ensureStyles(d);
        installStoryPlayerBridge(w);
        adoptHud(d);
        decorateReadyControls(d);
        if (rootObserver || typeof MutationObserver === 'undefined' || !d.body) return detach;
        rootObserver = new MutationObserver(() => {
            adoptHud(d);
            decorateReadyControls(d);
        });
        rootObserver.observe(d.body, { childList: true, subtree: true });
        return detach;
    }

    function detach() {
        if (rootObserver) rootObserver.disconnect();
        if (hudObserver) hudObserver.disconnect();
        if (rowObserver) rowObserver.disconnect();
        if (patchTimer && currentWin && typeof currentWin.clearInterval === 'function') currentWin.clearInterval(patchTimer);
        rootObserver = null;
        hudObserver = null;
        rowObserver = null;
        patchTimer = null;
        currentHud = null;
        unbindComposer(true);
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
        mountPlayer,
        sync,
        attachSoundtrack,
        removeSoundtrack,
        decorateReadyControls,
        patchStoryPlayer,
        installStoryPlayerBridge,
        pauseForChat,
    };

    if (typeof window !== 'undefined' && typeof document !== 'undefined' && !window.__NEXUS_SCENE_TALE_VIEW_NOAUTO__) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => install(document, window), { once: true });
        else install(document, window);
    }

    return api;
})();

if (typeof window !== 'undefined') window.NEXUS_SCENE_TALE_VIEW = SceneTaleConversationView;
if (typeof module !== 'undefined' && module.exports) module.exports = SceneTaleConversationView;
