/**
 * SceneTaleMobileMode — stage-first Scene Tale presentation for phones.
 *
 * StoryPlayer owns narration/timing/branching. This module owns only the mobile presentation
 * and the Ready -> Playing handoff safety net. All observer-driven DOM writes are idempotent so
 * the Scene Tale HUD can never create a MutationObserver feedback loop that starves Together's
 * async start continuation.
 *
 * Exposes: window.NEXUS_SCENE_TALE_MOBILE_MODE
 */
const SceneTaleMobileMode = (() => {
    'use strict';

    const HUD_ID = 'nexus-scene-tale-hud';
    const ROW_ID = 'nexus-scene-tale-conversation-row';
    const STYLE_ID = 'nexus-scene-tale-mobile-mode-styles';
    const ACTIVE_CLASS = 'nexus-scene-tale-active';
    const CONFIGURE_CLASS = 'nexus-scene-tale-configure-active';
    const MOBILE_QUERY = '(max-width: 767px)';
    const NEAR_BOTTOM_PX = 60;
    const PANEL_PATCH_FLAG = '__sceneTaleStartGuardPatched';
    const READY_PATCH_FLAG = '__sceneTaleReadyGuardPatched';

    let rootObserver = null;
    let hudObserver = null;
    let currentHud = null;
    let currentWin = null;
    let currentDoc = null;
    let scrollHost = null;
    let userNearBottom = true;
    let composerBinding = null;
    let endGuard = null;
    let legacyViewDetached = false;
    let chromeSnapshot = null;
    let resizeHandler = null;
    let patchTimer = null;
    let scanning = false;
    let syncing = false;

    const CSS = `
@media (max-width:767px){
  html.${ACTIVE_CLASS},html.${ACTIVE_CLASS} body{height:100%;overflow:hidden!important;background:#020912}
  html.${ACTIVE_CLASS} .app-shell{height:100dvh;min-height:100dvh;overflow:hidden}
  html.${ACTIVE_CLASS} .topbar{position:fixed!important;top:0;left:0;right:0;z-index:90;min-height:56px!important;height:56px!important;padding:6px 10px!important;border-radius:0!important;background:rgba(5,15,25,.82)!important;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
  html.${ACTIVE_CLASS} .brand-inline-title{font-size:.9rem!important;line-height:1.1}
  html.${ACTIVE_CLASS} .brand-inline-sub{font-size:.62rem!important;line-height:1.1;gap:5px}
  html.${ACTIVE_CLASS} #status-indicator{width:7px!important;height:7px!important}
  html.${ACTIVE_CLASS} .content-layout{position:fixed!important;top:56px!important;left:0!important;right:0!important;bottom:0!important;display:block!important;padding:0!important;gap:0!important;overflow:hidden!important}
  html.${ACTIVE_CLASS} .avatar-panel{position:absolute!important;inset:0!important;max-height:none!important;min-height:0!important;overflow:hidden!important}
  html.${ACTIVE_CLASS} .avatar-card{height:100%!important;min-height:0!important;border:0!important;border-radius:0!important;background:transparent!important}
  html.${ACTIVE_CLASS} .avatar-preview-wrap{height:100%!important;min-height:0!important;max-height:none!important}
  html.${ACTIVE_CLASS} .avatar-viewport{height:100%!important;min-height:0!important}
  html.${ACTIVE_CLASS} .avatar-footer{display:none!important}
  html.${ACTIVE_CLASS} .chat-panel,
  html.${ACTIVE_CLASS} .chat-panel.chat-overlay--collapsed,
  html.${ACTIVE_CLASS} .chat-panel.chat-overlay--expanded{position:fixed!important;left:12px!important;right:12px!important;bottom:max(6px,env(safe-area-inset-bottom,0px))!important;top:auto!important;width:auto!important;height:auto!important;max-height:none!important;min-height:0!important;z-index:80!important;overflow:visible!important;transform:none!important;transition:none!important;background:transparent!important;border:0!important;box-shadow:none!important}
  html.${ACTIVE_CLASS} .chat-card{height:auto!important;min-height:0!important;display:flex!important;flex-direction:column!important;overflow:visible!important;background:transparent!important;border:0!important;box-shadow:none!important;contain:none!important}
  html.${ACTIVE_CLASS} .chat-card-header{display:none!important}
  html.${ACTIVE_CLASS} #chat-overlay-handle{display:none!important}
  html.${ACTIVE_CLASS} .chat-main{position:relative!important;flex:0 1 auto!important;min-height:0!important;max-height:min(34dvh,360px)!important;overflow:visible!important}
  html.${ACTIVE_CLASS} .chat-history{position:relative!important;inset:auto!important;padding:0!important;overflow:visible!important;overscroll-behavior:none!important;scrollbar-width:none!important}
  html.${ACTIVE_CLASS} .chat-history::-webkit-scrollbar{display:none!important}
  html.${ACTIVE_CLASS} #${ROW_ID}{margin:0!important;width:100%!important}
  html.${ACTIVE_CLASS} #${HUD_ID}{width:100%!important;margin:0!important;position:relative!important;left:auto!important;right:auto!important;bottom:auto!important;transform:none!important;z-index:auto!important;max-width:none!important}
  html.${ACTIVE_CLASS} #${HUD_ID} .nexus-story-shell{display:flex;flex-direction:column;max-height:min(34dvh,360px);overflow:hidden;border-radius:16px;background:rgba(5,15,25,.82);border:1px solid rgba(24,218,255,.38);box-shadow:0 14px 40px rgba(0,0,0,.38);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
  html.${ACTIVE_CLASS} #${HUD_ID}.has-choices .nexus-story-shell{max-height:min(44dvh,430px)}
  html.${ACTIVE_CLASS} #${HUD_ID}.is-complete .nexus-story-shell{max-height:min(40dvh,400px)}
  html.${ACTIVE_CLASS} #${HUD_ID}.transcript-expanded .nexus-story-shell{max-height:min(58dvh,520px)}
  html.${ACTIVE_CLASS} .nexus-story-heading{padding:10px 13px 8px!important;flex:0 0 auto}
  html.${ACTIVE_CLASS} .nexus-story-kicker{font-size:.62rem!important;margin-bottom:3px!important;letter-spacing:.1em}
  html.${ACTIVE_CLASS} .nexus-story-heading-title{font-size:.96rem!important;margin-bottom:1px!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  html.${ACTIVE_CLASS} .nexus-story-heading-note{display:none!important}
  html.${ACTIVE_CLASS} .nexus-story-place{font-size:.68rem;line-height:1.25;color:rgba(224,247,250,.62);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  html.${ACTIVE_CLASS} .nexus-scene-tale-hero{display:none!important}
  html.${ACTIVE_CLASS} .nexus-story-card{padding:10px 13px!important;overflow-y:auto!important;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;min-height:0;flex:1 1 auto}
  html.${ACTIVE_CLASS} .nexus-story-caption{font-size:.91rem!important;line-height:1.42!important;white-space:pre-wrap;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:4;overflow:hidden}
  html.${ACTIVE_CLASS} #${HUD_ID}.transcript-expanded .nexus-story-caption{-webkit-line-clamp:unset;display:block;overflow:visible}
  html.${ACTIVE_CLASS} .nexus-story-transcript-toggle{display:inline-flex;margin-top:7px;border:0;background:transparent;color:#20d7f2;padding:2px 0;font:inherit;font-size:.72rem;cursor:pointer}
  html.${ACTIVE_CLASS} .nexus-story-choice-title{font-size:.86rem!important;margin-bottom:8px!important}
  html.${ACTIVE_CLASS} .nexus-story-options{grid-template-columns:1fr!important;gap:7px!important}
  html.${ACTIVE_CLASS} .nexus-story-option{padding:10px 11px!important;min-height:42px!important;font-size:.86rem!important}
  html.${ACTIVE_CLASS} .nexus-story-bar{padding:8px 10px!important;gap:7px!important;flex-wrap:nowrap!important;flex:0 0 auto;background:rgba(0,0,0,.2)}
  html.${ACTIVE_CLASS} .nexus-story-time{font-size:.72rem!important;margin-left:auto!important}
  html.${ACTIVE_CLASS} .nexus-story-btn{min-height:38px;padding:7px 12px!important;font-size:.76rem!important}
  html.${ACTIVE_CLASS} .nexus-story-btn:not(.is-end){background:rgba(0,207,235,.16)!important;border-color:rgba(24,218,255,.58)!important;color:#e9fbff}
  html.${ACTIVE_CLASS} .nexus-story-btn.is-end{background:transparent!important;border-color:rgba(255,255,255,.13)!important;opacity:.62!important}
  html.${ACTIVE_CLASS} .nexus-story-btn.is-end.is-confirming{border-color:rgba(255,112,112,.46)!important;color:#ffb3b3!important;opacity:1!important}
  html.${ACTIVE_CLASS} .nexus-scene-tale-soundtrack,html.${ACTIVE_CLASS} .nexus-scene-tale-soundtrack-player{display:none!important}
  html.${ACTIVE_CLASS} .chat-input-shell{position:relative!important;bottom:auto!important;z-index:1!important;flex:0 0 auto!important;padding:6px 0 0!important;border:0!important;background:transparent!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
  html.${ACTIVE_CLASS} .chat-input-bar{grid-template-columns:40px 1fr 44px!important;gap:7px!important;padding:0!important}
  html.${ACTIVE_CLASS} .voice-btn-compact{width:40px!important;height:40px!important;border-radius:12px!important;background:rgba(0,40,45,.78)!important}
  html.${ACTIVE_CLASS} .chat-input{height:40px!important;min-height:40px!important;font-size:16px!important;border-radius:12px!important;background:rgba(2,10,18,.86)!important}
  html.${ACTIVE_CLASS} .send-btn{height:40px!important;min-width:44px!important;width:44px!important;padding:0!important;border-radius:12px!important}
  html.${ACTIVE_CLASS} .voice-status-inline,html.${ACTIVE_CLASS} .typing-row{display:none!important}
  html.${ACTIVE_CLASS} .pose-studio-root,html.${ACTIVE_CLASS} .avatar-picker-backdrop,html.${ACTIVE_CLASS} .avatar-picker-panel{display:none!important}
}
`;

    function isMobile(win) {
        const w = win || currentWin || (typeof window !== 'undefined' ? window : null);
        if (!w) return false;
        if (typeof w.matchMedia === 'function') return w.matchMedia(MOBILE_QUERY).matches;
        return Number(w.innerWidth) <= 767;
    }

    function setText(node, value) {
        if (!node) return false;
        const next = String(value == null ? '' : value);
        if (node.textContent === next) return false;
        node.textContent = next;
        return true;
    }

    function setAttribute(node, name, value) {
        if (!node || !node.getAttribute || !node.setAttribute) return false;
        const next = String(value);
        if (node.getAttribute(name) === next) return false;
        node.setAttribute(name, next);
        return true;
    }

    function toggleClass(node, name, active) {
        if (!node || !node.classList) return false;
        const next = Boolean(active);
        if (node.classList.contains(name) === next) return false;
        node.classList.toggle(name, next);
        return true;
    }

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

    function activePlayer(win) {
        const w = win || currentWin || (typeof window !== 'undefined' ? window : null);
        const director = w && w.NEXUS_BD;
        const panel = director && director.togetherPanel;
        const activity = panel && panel.activities && typeof panel.activities.get === 'function' ? panel.activities.get('playground') : null;
        return activity && activity.player ? activity.player : null;
    }

    function nearBottom(host) {
        if (!host) return true;
        const distance = Number(host.scrollHeight || 0) - Number(host.scrollTop || 0) - Number(host.clientHeight || 0);
        return distance <= NEAR_BOTTOM_PX;
    }

    function rememberScroll() {
        if (!scrollHost) return;
        userNearBottom = nearBottom(scrollHost);
    }

    function meaningfulMutation(records) {
        return records.some((record) => {
            const target = record.target && record.target.nodeType === 3 ? record.target.parentElement : record.target;
            if (!target || !target.closest) return record.type === 'childList';
            if (target.closest('.nexus-story-time')) return false;
            if (target.closest('.nexus-story-btn') && record.type === 'characterData') return false;
            return Boolean(
                record.type === 'childList'
                || target.closest('.nexus-story-caption')
                || target.closest('.nexus-story-options')
                || target.closest('.nexus-story-complete-title')
                || target.closest('.nexus-story-complete-note')
            );
        });
    }

    function mutationNeedsSync(records) {
        return records.some((record) => {
            const target = record.target && record.target.nodeType === 3 ? record.target.parentElement : record.target;
            return !(target && target.closest && target.closest('.nexus-story-time'));
        });
    }

    function storyState(win) {
        const player = activePlayer(win);
        return player && player.state ? String(player.state) : '';
    }

    function decorateSceneLabel(hud, win) {
        if (!hud || !hud.querySelector) return false;
        const heading = hud.querySelector('.nexus-story-heading');
        if (!heading) return false;
        let place = heading.querySelector('.nexus-story-place');
        if (!place) {
            place = hud.ownerDocument.createElement('div');
            place.className = 'nexus-story-place';
            heading.appendChild(place);
        }
        const player = activePlayer(win);
        const plan = player && player.plan;
        const label = String((plan && plan.sceneLabel) || '').trim();
        return setText(place, label && !/^current scene$/i.test(label) ? label : 'Scene Tale');
    }

    function decorateTranscript(hud) {
        if (!hud || !hud.querySelector) return;
        const caption = hud.querySelector('.nexus-story-caption');
        const card = hud.querySelector('.nexus-story-card');
        if (!card) return;
        const oldToggle = card.querySelector('.nexus-story-transcript-toggle');
        if (!caption || String(caption.textContent || '').trim().length <= 210) {
            if (oldToggle) oldToggle.remove();
            toggleClass(hud, 'transcript-expanded', false);
            return;
        }
        if (oldToggle) return;
        const toggle = hud.ownerDocument.createElement('button');
        toggle.type = 'button';
        toggle.className = 'nexus-story-transcript-toggle';
        toggle.textContent = 'Expand transcript';
        toggle.setAttribute('aria-expanded', 'false');
        toggle.addEventListener('click', () => {
            const expanded = !hud.classList.contains('transcript-expanded');
            toggleClass(hud, 'transcript-expanded', expanded);
            setText(toggle, expanded ? 'Collapse transcript' : 'Expand transcript');
            setAttribute(toggle, 'aria-expanded', expanded ? 'true' : 'false');
        });
        card.appendChild(toggle);
    }

    function updateChrome(doc, hud, win) {
        if (!doc) return;
        const title = doc.querySelector('.brand-inline-title');
        const status = doc.getElementById('status-text');
        if (!chromeSnapshot) {
            chromeSnapshot = {
                title: title ? title.textContent : null,
                status: status ? status.textContent : null,
            };
        }
        setText(title, 'Scene Tale');
        const state = storyState(win);
        const statusText = state === 'paused' ? 'PAUSED' : state === 'waiting-choice' ? 'YOUR CHOICE' : 'PLAYING';
        setText(status, statusText);
        decorateSceneLabel(hud, win);
    }

    function restoreChrome(doc) {
        if (!doc || !chromeSnapshot) return;
        const title = doc.querySelector('.brand-inline-title');
        const status = doc.getElementById('status-text');
        if (chromeSnapshot.title !== null) setText(title, chromeSnapshot.title);
        if (chromeSnapshot.status !== null) setText(status, chromeSnapshot.status);
        chromeSnapshot = null;
    }

    function pauseForChat(win) {
        const player = activePlayer(win);
        if (!player || typeof player.pause !== 'function') return false;
        if (player.state !== 'playing' && player.state !== 'waiting-choice') return false;
        return player.pause() === true;
    }

    function bindComposer(doc, win) {
        const input = doc && (doc.getElementById('speech-text') || doc.getElementById('chatInput'));
        const send = doc && (doc.getElementById('speak-btn') || doc.getElementById('sendBtn'));
        if (!input) return;
        if (composerBinding && composerBinding.input === input && composerBinding.send === send) return;
        unbindComposer(true);
        const previous = input.getAttribute('placeholder') || '';
        setAttribute(input, 'placeholder', 'Talk to the story…');
        const onSend = () => pauseForChat(win);
        const onKey = (event) => {
            if (event && event.key === 'Enter' && !event.shiftKey) pauseForChat(win);
        };
        if (send) send.addEventListener('click', onSend, true);
        input.addEventListener('keydown', onKey, true);
        composerBinding = { input, send, previous, onSend, onKey };
    }

    function unbindComposer(restore) {
        const binding = composerBinding;
        if (!binding) return;
        if (binding.send) binding.send.removeEventListener('click', binding.onSend, true);
        binding.input.removeEventListener('keydown', binding.onKey, true);
        if (restore) setAttribute(binding.input, 'placeholder', binding.previous);
        composerBinding = null;
    }

    function bindEndGuard(hud) {
        if (!hud || endGuard) return;
        endGuard = (event) => {
            const button = event.target && event.target.closest ? event.target.closest('.nexus-story-btn.is-end') : null;
            if (!button || !hud.contains(button)) return;
            const now = Date.now();
            const until = Number(button.dataset.sceneTaleConfirmUntil || 0);
            if (until > now) {
                toggleClass(button, 'is-confirming', false);
                delete button.dataset.sceneTaleConfirmUntil;
                return;
            }
            event.preventDefault();
            event.stopImmediatePropagation();
            button.dataset.sceneTaleConfirmUntil = String(now + 3000);
            toggleClass(button, 'is-confirming', true);
            setText(button, 'Confirm end');
            setTimeout(() => {
                if (!button.isConnected) return;
                if (Number(button.dataset.sceneTaleConfirmUntil || 0) <= Date.now()) {
                    toggleClass(button, 'is-confirming', false);
                    delete button.dataset.sceneTaleConfirmUntil;
                    setText(button, 'End');
                }
            }, 3050);
        };
        hud.addEventListener('click', endGuard, true);
    }

    function unbindEndGuard() {
        if (currentHud && endGuard) currentHud.removeEventListener('click', endGuard, true);
        endGuard = null;
    }

    function disableLegacyHudObserver(win) {
        if (legacyViewDetached) return;
        const w = win || currentWin;
        const view = w && w.NEXUS_SCENE_TALE_VIEW;
        if (view && typeof view.detach === 'function') {
            view.detach();
            legacyViewDetached = true;
        }
    }

    function restoreLegacyView(win, doc) {
        if (!legacyViewDetached) return;
        const w = win || currentWin;
        const d = doc || currentDoc;
        const view = w && w.NEXUS_SCENE_TALE_VIEW;
        legacyViewDetached = false;
        if (view && typeof view.install === 'function' && d) view.install(d, w);
    }

    function applyRootState(doc, active) {
        if (!doc || !doc.documentElement) return;
        if (active) toggleClass(doc.documentElement, CONFIGURE_CLASS, false);
        toggleClass(doc.documentElement, ACTIVE_CLASS, active);
        if (!doc.body) return;
        if (active) setAttribute(doc.body, 'data-scene-tale-active', '1');
        else if (doc.body.hasAttribute('data-scene-tale-active')) doc.body.removeAttribute('data-scene-tale-active');
    }

    function sync(hud = currentHud, { allowScroll = false } = {}) {
        if (!hud || syncing) return false;
        syncing = true;
        try {
            const doc = hud.ownerDocument;
            const win = currentWin || (doc && doc.defaultView) || null;
            const text = String(hud.textContent || '');
            const error = /Scene Tale paused/i.test(text);
            const hasChoices = Boolean(hud.querySelector('.nexus-story-options'));
            const complete = /Story complete/i.test(text);
            toggleClass(hud, 'has-choices', hasChoices);
            toggleClass(hud, 'is-complete', complete);
            decorateTranscript(hud);
            updateChrome(doc, hud, win);
            if (allowScroll && scrollHost && userNearBottom) {
                try { scrollHost.scrollTop = scrollHost.scrollHeight; } catch (_) {}
                rememberScroll();
            }
            if (error) deactivate({ restoreView: true });
            return complete;
        } finally {
            syncing = false;
        }
    }

    function observeHud(hud) {
        if (hudObserver) hudObserver.disconnect();
        hudObserver = null;
        if (!hud || typeof MutationObserver === 'undefined') return;
        hudObserver = new MutationObserver((records) => {
            if (!mutationNeedsSync(records)) return;
            sync(hud, { allowScroll: meaningfulMutation(records) });
        });
        hudObserver.observe(hud, { childList: true, subtree: true, characterData: true });
    }

    function activate(hud, doc, win) {
        if (!hud || !doc || !isMobile(win)) return false;
        if (currentHud === hud && doc.documentElement.classList.contains(ACTIVE_CLASS)) {
            sync(hud);
            return true;
        }
        if (currentHud && currentHud !== hud) deactivate({ restoreView: false });
        currentHud = hud;
        currentDoc = doc;
        currentWin = win || currentWin;
        ensureStyles(doc);
        // Playback owns mobile UI from this point. Setup must not remain active for even one frame.
        applyRootState(doc, true);
        disableLegacyHudObserver(currentWin);
        scrollHost = chatHost(doc);
        if (scrollHost) {
            userNearBottom = nearBottom(scrollHost);
            scrollHost.addEventListener('scroll', rememberScroll, { passive: true });
        }
        bindComposer(doc, currentWin);
        bindEndGuard(hud);
        observeHud(hud);
        sync(hud);
        return true;
    }

    function deactivate({ restoreView = true } = {}) {
        const doc = currentDoc;
        const win = currentWin;
        if (hudObserver) hudObserver.disconnect();
        hudObserver = null;
        if (scrollHost) scrollHost.removeEventListener('scroll', rememberScroll);
        scrollHost = null;
        unbindEndGuard();
        unbindComposer(true);
        restoreChrome(doc);
        applyRootState(doc, false);
        currentHud = null;
        currentDoc = null;
        if (restoreView) restoreLegacyView(win, doc);
    }

    function containsStoryHud(node) {
        if (!node || node.nodeType !== 1) return false;
        if (node.id === HUD_ID) return true;
        return Boolean(node.querySelector && node.querySelector(`#${HUD_ID}`));
    }

    function hudMutationRelevant(records) {
        return records.some((record) => {
            const added = [...(record.addedNodes || [])].some(containsStoryHud);
            const removed = [...(record.removedNodes || [])].some(containsStoryHud);
            return added || removed;
        });
    }

    function scan(doc, win) {
        if (scanning) return Boolean(currentHud);
        scanning = true;
        try {
            if (!doc || !isMobile(win)) {
                if (currentHud) deactivate({ restoreView: true });
                return false;
            }
            const hud = doc.getElementById(HUD_ID);
            if (hud) return activate(hud, doc, win);
            if (currentHud) deactivate({ restoreView: true });
            return false;
        } finally {
            scanning = false;
        }
    }

    function patchStartHandoff(win) {
        const w = win || currentWin || (typeof window !== 'undefined' ? window : null);
        if (!w) return false;
        let panelReady = false;
        let playgroundReady = false;

        const togetherApi = w.NEXUS_BD_TOGETHER_PANEL;
        const Panel = togetherApi && togetherApi.Panel;
        if (Panel && Panel.prototype && !Panel.prototype[PANEL_PATCH_FLAG]) {
            const originalStartActivity = Panel.prototype.startActivity;
            if (typeof originalStartActivity === 'function') {
                Panel.prototype.startActivity = async function guardedStartActivity(id, option = null) {
                    try {
                        return await originalStartActivity.call(this, id, option);
                    } catch (error) {
                        console.error('[Together] activity start failed', error);
                        try {
                            if (this.pipeline && typeof this.stopSharing === 'function') this.stopSharing('start failed');
                        } catch (_) {}
                        const contract = typeof this.contractFor === 'function' ? this.contractFor(id) : null;
                        const raw = this.activities && typeof this.activities.get === 'function' ? this.activities.get(id) : null;
                        try {
                            if (raw && raw.active && typeof raw.stop === 'function') raw.stop('start failed');
                        } catch (_) {}
                        const activity = contract || raw || { title: 'This activity' };
                        const failure = {
                            ok: false,
                            why: String((error && error.message) || error || 'The experience could not start'),
                        };
                        if (typeof this._fail === 'function') return this._fail(activity, failure);
                        return failure;
                    }
                };
                Object.defineProperty(Panel.prototype, PANEL_PATCH_FLAG, { configurable: true, value: true });
                panelReady = true;
            }
        } else if (Panel && Panel.prototype && Panel.prototype[PANEL_PATCH_FLAG]) {
            panelReady = true;
        }

        const playgroundApi = w.NEXUS_BD_PLAYGROUND;
        const Playground = playgroundApi && playgroundApi.Playground;
        if (Playground && Playground.prototype && !Playground.prototype[READY_PATCH_FLAG]) {
            const originalPaintReady = Playground.prototype._paintReady;
            if (typeof originalPaintReady === 'function') {
                Playground.prototype._paintReady = function guardedPaintReady(panel) {
                    const out = originalPaintReady.call(this, panel);
                    const root = panel && panel.root;
                    const start = root && root.querySelector ? root.querySelector('[data-action="start-story"]') : null;
                    if (!start || start.dataset.sceneTaleAwaitBound === '1') return out;
                    start.dataset.sceneTaleAwaitBound = '1';
                    const activity = this;
                    start.addEventListener('click', async (event) => {
                        event.preventDefault();
                        event.stopImmediatePropagation();
                        if (start.dataset.starting === '1') return;
                        start.dataset.starting = '1';
                        start.disabled = true;
                        setText(start, 'Starting…');
                        try {
                            const result = await panel.startActivity('playground', {
                                id: 'scene-tale',
                                permission: null,
                                preparedPlan: activity.preparedPlan,
                                soundtrack: activity.preparedSoundtrack,
                            });
                            if ((!result || result.ok === false) && start.isConnected) {
                                start.disabled = false;
                                setText(start, 'Start story');
                                delete start.dataset.starting;
                            }
                        } catch (error) {
                            console.error('[Scene Tale] Start failed', error);
                            if (start.isConnected) {
                                start.disabled = false;
                                setText(start, 'Try again');
                                delete start.dataset.starting;
                            }
                        }
                    }, true);
                    return out;
                };
                Object.defineProperty(Playground.prototype, READY_PATCH_FLAG, { configurable: true, value: true });
                playgroundReady = true;
            }
        } else if (Playground && Playground.prototype && Playground.prototype[READY_PATCH_FLAG]) {
            playgroundReady = true;
        }
        return panelReady && playgroundReady;
    }

    function install(doc, win) {
        const d = doc || (typeof document !== 'undefined' ? document : null);
        const w = win || (typeof window !== 'undefined' ? window : null);
        if (!d) return () => {};
        currentDoc = d;
        currentWin = w || currentWin;
        ensureStyles(d);
        patchStartHandoff(w);
        if (!patchTimer && w && typeof w.setInterval === 'function') {
            let attempts = 0;
            patchTimer = w.setInterval(() => {
                attempts += 1;
                const ok = patchStartHandoff(w);
                if (ok || attempts >= 40) {
                    w.clearInterval(patchTimer);
                    patchTimer = null;
                }
            }, 125);
        }
        scan(d, w);
        if (!rootObserver && typeof MutationObserver !== 'undefined' && d.body) {
            rootObserver = new MutationObserver((records) => {
                if (hudMutationRelevant(records)) scan(d, w);
            });
            rootObserver.observe(d.body, { childList: true, subtree: true });
        }
        if (!resizeHandler && w && typeof w.addEventListener === 'function') {
            resizeHandler = () => scan(d, w);
            w.addEventListener('resize', resizeHandler);
        }
        return detach;
    }

    function detach() {
        if (rootObserver) rootObserver.disconnect();
        rootObserver = null;
        if (patchTimer && currentWin && typeof currentWin.clearInterval === 'function') currentWin.clearInterval(patchTimer);
        patchTimer = null;
        if (resizeHandler && currentWin && typeof currentWin.removeEventListener === 'function') currentWin.removeEventListener('resize', resizeHandler);
        resizeHandler = null;
        deactivate({ restoreView: true });
        currentWin = null;
        currentDoc = null;
        scanning = false;
        syncing = false;
    }

    const api = {
        HUD_ID,
        ROW_ID,
        STYLE_ID,
        ACTIVE_CLASS,
        CONFIGURE_CLASS,
        CSS,
        install,
        detach,
        scan,
        activate,
        deactivate,
        sync,
        isMobile,
        nearBottom,
        meaningfulMutation,
        containsStoryHud,
        hudMutationRelevant,
        setText,
        patchStartHandoff,
    };

    if (typeof window !== 'undefined' && typeof document !== 'undefined' && !window.__NEXUS_SCENE_TALE_MOBILE_NOAUTO__) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => install(document, window), { once: true });
        else install(document, window);
    }

    return api;
})();

if (typeof window !== 'undefined') window.NEXUS_SCENE_TALE_MOBILE_MODE = SceneTaleMobileMode;
if (typeof module !== 'undefined' && module.exports) module.exports = SceneTaleMobileMode;
