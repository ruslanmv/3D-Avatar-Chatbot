/**
 * PrivateConversationView — presentation for an active Private experience.
 *
 * Together launches the experience and the avatar performs it, but Conversation owns every
 * visible control. IntimateExperienceSession remains responsible for consent and timing.
 */
const PrivateConversationView = (() => {
    'use strict';

    const ROW_ID = 'nexus-private-conversation-row';
    const STYLE_ID = 'nexus-private-conversation-styles';

    /**
     * How loud the Private soundtrack comes in, as a YouTube player percentage.
     *
     * A YouTube player starts at whatever the viewer last left it at, which in practice is
     * 100. That is a fine level for a track somebody chose to listen to and the wrong one for
     * background music under a quiet conversation: it arrives over the top of her first line
     * and the person's only recourse is to open the player and drag a slider, in the one mode
     * where fiddling with controls is most unwelcome.
     *
     * 15 is low enough to sit under speech and high enough to still be there. It is
     * deliberately not shared with Scene Tale, whose soundtrack *is* the point of the scene
     * and which nobody has complained about.
     */
    const VOLUME = 15;

    /**
     * The strip Scene Tale draws, in Private's colours. Required under jest, read off the
     * window in the browser; resolved again per call because boot order is not require order.
     */
    const StripApi = (() => {
        try {
            // eslint-disable-next-line global-require
            return typeof require === 'function' ? require('./SoundtrackStrip.js') : null;
        } catch (error) {
            return typeof window !== 'undefined' ? window.NEXUS_SOUNDTRACK_STRIP : null;
        }
    })();
    const CSS = `
#${ROW_ID}{display:block;width:100%;margin:10px 0 14px;box-sizing:border-box;color:inherit}
#${ROW_ID} *{box-sizing:border-box}.nexus-private-shell{overflow:hidden;border:1px solid rgba(244,128,166,.4);border-radius:16px;background:linear-gradient(145deg,rgba(39,15,36,.9),rgba(22,13,28,.82));box-shadow:0 16px 50px rgba(23,5,21,.3);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
.nexus-private-heading{padding:15px 17px 11px;border-bottom:1px solid rgba(255,255,255,.08)}.nexus-private-kicker{color:#f49aba;font-size:.72rem;font-weight:750;letter-spacing:.09em}.nexus-private-heading-title{font-size:1.08rem;font-weight:750;margin:5px 0 2px}.nexus-private-place{font-size:.8rem;opacity:.68}.nexus-private-card{padding:15px 17px}.nexus-private-copy{font-size:.98rem;line-height:1.55;white-space:pre-wrap;text-wrap:pretty}.nexus-private-actions{display:grid;gap:8px;margin-top:13px}.nexus-private-btn{border:1px solid rgba(244,128,166,.34);background:rgba(244,128,166,.09);color:inherit;border-radius:11px;padding:10px 12px;text-align:left;font:inherit;font-size:.82rem;cursor:pointer}.nexus-private-btn:hover,.nexus-private-btn:focus-visible{background:rgba(244,128,166,.18);outline:none}.nexus-private-bar{display:flex;align-items:center;gap:8px;padding:10px 12px;border-top:1px solid rgba(255,255,255,.08)}.nexus-private-level{font-size:.76rem;opacity:.76;flex:1}.nexus-private-bar .nexus-private-btn{padding:7px 10px}.nexus-private-soundtrack{margin:0 14px 12px;font-size:.78rem}.nexus-private-soundtrack-strip{display:flex;align-items:flex-start;gap:10px;justify-content:space-between;padding:9px 12px;border:1px solid rgba(244,128,166,.2);border-radius:11px;background:rgba(244,128,166,.06)}.nexus-private-soundtrack-copy{min-width:0;flex:1}.nexus-private-soundtrack-kicker{font-size:.66rem;letter-spacing:.08em;text-transform:uppercase;opacity:.56;margin-bottom:2px}.nexus-private-soundtrack-title{font-size:.8rem;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.nexus-private-soundtrack-creator{font-size:.7rem;line-height:1.3;opacity:.58;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}.nexus-private-soundtrack-toggle{border:1px solid rgba(244,128,166,.28);background:rgba(244,128,166,.1);color:inherit;border-radius:9px;padding:6px 8px;font:inherit;font-size:.72rem;cursor:pointer;flex:0 0 auto}.nexus-private-soundtrack-toggle:hover,.nexus-private-soundtrack-toggle:focus-visible{background:rgba(244,128,166,.2);outline:none}.nexus-private-soundtrack-player{display:none;width:min(280px,100%);margin-top:9px}.nexus-private-soundtrack-player.is-open{display:block}.nexus-private-soundtrack-player .nexus-yt-card{width:100%;max-width:280px;margin:0}.nexus-private-soundtrack-player .nexus-yt-meta{font-size:.72rem}.nexus-private-complete{font-size:1rem;font-weight:750;margin-bottom:6px}.nexus-private-note{font-size:.84rem;line-height:1.5;opacity:.74}.is-complete .nexus-private-bar{display:none}
@media(max-width:560px){#${ROW_ID}{margin:8px 0 12px}.nexus-private-heading,.nexus-private-card{padding:13px 14px}.nexus-private-copy{font-size:.94rem}.nexus-private-bar{flex-wrap:wrap}.nexus-private-soundtrack{margin:0 12px 10px}.nexus-private-soundtrack-player{width:100%}.nexus-private-soundtrack-player .nexus-yt-card{max-width:100%}}
`;

    function ensureStyles(doc) {
        if (!doc || doc.getElementById(STYLE_ID)) return;
        const style = doc.createElement('style');
        style.id = STYLE_ID;
        style.textContent = CSS;
        (doc.head || doc.documentElement).appendChild(style);
    }

    class View {
        constructor({ doc, win, onCozy, onEnd, onUserMessage } = {}) {
            this.doc = doc || (typeof document !== 'undefined' ? document : null);
            this.win = win || (typeof window !== 'undefined' ? window : null);
            this.handlers = { onCozy, onEnd, onUserMessage };
            this.row = null;
            this.card = null;
            this.level = null;
            this._composer = null;
            this._hostObserver = null;
        }

        mount({ preset, scene } = {}) {
            const host = this.doc && this.doc.getElementById('chat-history');
            if (!host) return false;
            ensureStyles(this.doc);
            this.destroy();
            const row = this.doc.createElement('section');
            row.id = ROW_ID;
            row.setAttribute('aria-live', 'polite');
            row.innerHTML = `<div class="nexus-private-shell"><header class="nexus-private-heading"><div class="nexus-private-kicker">🔐 PRIVATE</div><div class="nexus-private-heading-title"></div><div class="nexus-private-place"></div></header><div class="nexus-private-card"></div><div class="nexus-private-soundtrack" hidden></div><footer class="nexus-private-bar"><span class="nexus-private-level">Warm</span></footer></div>`;
            row.querySelector('.nexus-private-heading-title').textContent = (preset && preset.label) || 'Private';
            row.querySelector('.nexus-private-place').textContent = scene || 'Current place';
            const bar = row.querySelector('.nexus-private-bar');
            bar.append(
                this._button('Keep it cozy', 'cozy', this.handlers.onCozy),
                this._button('End', 'end', this.handlers.onEnd)
            );
            this.row = row;
            this.card = row.querySelector('.nexus-private-card');
            this.level = row.querySelector('.nexus-private-level');
            const empty = host.querySelector(':scope > .empty-state');
            if (empty) empty.remove();
            host.appendChild(row);
            this._ensureConversationVisible();
            this._bindComposer();
            this._observeHost(host);
            this._scroll(host);
            return true;
        }

        showStarting() {
            this.showMessage('Starting gently. You remain in control of the pace.');
        }
        showMessage(text, actions = []) {
            if (!this.card) return;
            this.card.textContent = '';
            const copy = this.doc.createElement('div');
            copy.className = 'nexus-private-copy';
            copy.textContent = String(text || '');
            this.card.appendChild(copy);
            if (actions.length) {
                const list = this.doc.createElement('div');
                list.className = 'nexus-private-actions';
                actions.forEach((action) => list.appendChild(this._button(action.label, action.id, action.run)));
                this.card.appendChild(list);
            }
        }
        showMoodChoice(options, prompt) {
            // The prompt is an argument now because a planned session writes its own, and a
            // generated evening that asks its one question in a stock sentence gives itself
            // away at exactly the wrong moment.
            this.showMessage(prompt || 'What kind of mood should we keep?', options);
        }
        showConsentCheckIn(options) {
            this.showMessage('Would you like to keep this sweet, or make it a little more intense?', options);
        }
        setPace(label) {
            if (this.level) this.level.textContent = label || 'Warm';
        }
        /**
         * Show what is playing — and actually play it.
         *
         * This used to write `♫ <the provider's title>` into a div and stop there. Private
         * asked `MediaSession` to play, which records that playback was *requested* and owns
         * no player, so the session named a track and then ran in silence for five minutes
         * while the line on screen insisted otherwise. The strip carries a real collapsed
         * YouTube card now, the same one Scene Tale has had all along.
         *
         * The player stays inside this row rather than going through
         * `ConversationPublisher`, which would post an ordinary chat message with the watch
         * URL in its text — and that text is what `_persistChat` saves. A Private moment
         * leaves nothing in the transcript, which is the promise the completion card makes.
         *
         * It comes in at `VOLUME`, not at whatever the last thing played was set to. See the
         * constant.
         */
        attachSoundtrack(track, { play = true, volume = VOLUME } = {}) {
            if (!this.row || !track) return null;
            const slot = this.row.querySelector('.nexus-private-soundtrack');
            if (!slot) return null;
            const strips = (this.win && this.win.NEXUS_SOUNDTRACK_STRIP) || StripApi;
            slot.textContent = '';
            slot.hidden = false;
            if (!strips || typeof strips.render !== 'function') {
                slot.textContent = `♫ ${track.title || 'Soft private soundtrack'}`;
                return null;
            }
            const built = strips.render(track, {
                doc: this.doc,
                win: this.win,
                play,
                volume,
                // No `source`: `IntimateExperienceSession` already tells `MediaSession` it is
                // taking the music, and it is the half that also knows to hand it back on
                // exit. A second announcement from the strip would make two owners of one fact.
                marker: 'data-private-soundtrack',
                playerLabel: 'Private soundtrack player',
                classes: {
                    strip: 'nexus-private-soundtrack-strip',
                    copy: 'nexus-private-soundtrack-copy',
                    kicker: 'nexus-private-soundtrack-kicker',
                    title: 'nexus-private-soundtrack-title',
                    creator: 'nexus-private-soundtrack-creator',
                    toggle: 'nexus-private-soundtrack-toggle',
                    player: 'nexus-private-soundtrack-player',
                    card: 'nexus-private-background-card',
                },
                onToggle: () => this._scroll(this.doc && this.doc.getElementById('chat-history')),
            });
            if (!built) {
                slot.textContent = `♫ ${track.title || 'Soft private soundtrack'}`;
                return null;
            }
            slot.appendChild(built.strip);
            if (built.card) slot.appendChild(built.player);
            return built;
        }
        showComplete({ onAgain, onBack } = {}) {
            if (!this.row || !this.card) return;
            this.row.classList.add('is-complete');
            this.card.innerHTML =
                '<div class="nexus-private-complete">✓ Private moment complete</div><div class="nexus-private-note">A quiet ending, with no pressure to continue.<br>Nothing from this Private moment was added to Playground Histories.</div>';
            const actions = this.doc.createElement('div');
            actions.className = 'nexus-private-actions';
            actions.append(
                this._button('Another private moment', 'again', onAgain),
                this._button('Back to Together', 'back', onBack)
            );
            this.card.appendChild(actions);
        }
        showError(message) {
            this.showMessage(message || 'Private could not continue.');
        }
        destroy() {
            if (this._hostObserver) this._hostObserver.disconnect();
            this._hostObserver = null;
            this._unbindComposer();
            const old = this.doc && this.doc.getElementById(ROW_ID);
            if (old) old.remove();
            this.row = this.card = this.level = null;
        }
        _ensureConversationVisible() {
            const panel = this.doc && this.doc.querySelector('.chat-panel');
            if (!panel || !panel.classList.contains('chat-overlay--collapsed')) return;
            const toggle = this.doc.getElementById('chat-overlay-toggle');
            if (toggle && typeof toggle.click === 'function') toggle.click();
        }
        _observeHost(host) {
            if (!host || typeof MutationObserver === 'undefined') return;
            if (this._hostObserver) this._hostObserver.disconnect();
            this._hostObserver = new MutationObserver(() => {
                if (!this.row) return;
                // Chat restore/clear code can replace the history children after an activity
                // has mounted. The active experience remains authoritative, so put its one
                // persistent row back rather than leaving a running Private session invisible.
                if (!this.row.isConnected || this.row.parentNode !== host) {
                    const empty = host.querySelector(':scope > .empty-state');
                    if (empty) empty.remove();
                    host.appendChild(this.row);
                }
                this._scroll(host);
            });
            this._hostObserver.observe(host, { childList: true });
        }
        _scroll(host) {
            if (!host) return;
            try {
                host.scrollTop = host.scrollHeight;
            } catch (_) {}
        }
        _button(label, action, handler) {
            const button = this.doc.createElement('button');
            button.type = 'button';
            button.className = 'nexus-private-btn';
            button.textContent = label;
            button.dataset.privateAction = action;
            if (handler) button.addEventListener('click', handler);
            return button;
        }
        _bindComposer() {
            const input = this.doc.getElementById('speech-text') || this.doc.getElementById('chatInput');
            if (!input) return;
            const send = this.doc.getElementById('speak-btn') || this.doc.getElementById('sendBtn');
            const previous = input.getAttribute('placeholder') || '';
            input.setAttribute('placeholder', 'Talk privately…');
            const notify = () => {
                if (typeof this.handlers.onUserMessage === 'function') this.handlers.onUserMessage();
            };
            const key = (event) => {
                if (event.key === 'Enter' && !event.shiftKey) notify();
            };
            if (send) send.addEventListener('click', notify, true);
            input.addEventListener('keydown', key, true);
            this._composer = { input, send, previous, notify, key };
        }
        _unbindComposer() {
            const b = this._composer;
            if (!b) return;
            if (b.send) b.send.removeEventListener('click', b.notify, true);
            b.input.removeEventListener('keydown', b.key, true);
            b.input.setAttribute('placeholder', b.previous);
            this._composer = null;
        }
    }

    return { View, ROW_ID, VOLUME };
})();

if (typeof window !== 'undefined') window.NEXUS_PRIVATE_CONVERSATION_VIEW = PrivateConversationView;
if (typeof module !== 'undefined' && module.exports) module.exports = PrivateConversationView;
