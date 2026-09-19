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
     * How many turns stay on screen.
     *
     * Enough to read as a conversation — her line, the answer, her reaction — and few enough
     * that the card stays a third of a phone rather than becoming a transcript the avatar has
     * to share the screen with. Older turns scroll away rather than being a scrollback.
     */
    const MAX_TURNS = 6;

    /**
     * How many turns of this conversation reach the model (P10).
     *
     * Private's history is session-local now, which raises a question ordinary chat never had to
     * answer: how much of it to send. Deliberately small. A long window in an intimate
     * conversation is not more context, it is more chance for the model to reach back past a
     * `Slow down` to whatever the register was before it — and pace, once eased, must stay eased.
     * Ten turns is plenty for continuity within a five-minute moment and short enough that the
     * present dominates it.
     *
     * It is also the latency budget. Every turn in the window is tokens the provider reads before
     * it writes anything, and the reported session was one where waiting was the problem.
     */
    const HISTORY_WINDOW = 10;

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
#${ROW_ID}{display:block;width:100%;margin:8px 0 10px;box-sizing:border-box;color:inherit}
#${ROW_ID} *{box-sizing:border-box}.nexus-private-shell{overflow:hidden;border:1px solid rgba(244,128,166,.4);border-radius:16px;background:linear-gradient(145deg,rgba(39,15,36,.9),rgba(22,13,28,.82));box-shadow:0 16px 50px rgba(23,5,21,.3);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
.nexus-private-heading{display:flex;align-items:baseline;gap:8px;padding:9px 13px;border-bottom:1px solid rgba(255,255,255,.07);font-size:.74rem}.nexus-private-kicker{color:#f49aba;font-size:.72rem;font-weight:750;letter-spacing:.09em}.nexus-private-heading-title{font-size:.8rem;font-weight:700;margin:0}.nexus-private-place{font-size:.74rem;opacity:.55;margin-left:auto}.nexus-private-card{padding:12px 14px;max-height:34vh;overflow-y:auto;overscroll-behavior:contain}.nexus-private-log{display:grid;gap:10px}.nexus-private-turn{display:grid;gap:2px}.nexus-private-who{font-size:.62rem;letter-spacing:.1em;font-weight:700;opacity:.42}.nexus-private-turn.is-you .nexus-private-who{color:#9fd8ea}.nexus-private-turn.is-her .nexus-private-who{color:#f08fb6}.nexus-private-turn.is-you .nexus-private-copy{opacity:.78}.nexus-private-copy{font-size:.95rem;line-height:1.5;white-space:pre-wrap;text-wrap:pretty}.nexus-private-turn.is-streaming .nexus-private-copy::after{content:'▍';opacity:.5;animation:nexus-private-caret 1s steps(2) infinite}@keyframes nexus-private-caret{0%,100%{opacity:.15}50%{opacity:.7}}.nexus-private-pending{padding-top:9px;border-top:1px solid rgba(255,255,255,.07);opacity:.8}.nexus-private-thinking{display:flex;align-items:center;gap:5px;margin-top:12px;height:10px}.nexus-private-dot{width:6px;height:6px;border-radius:50%;background:#f49aba;opacity:.35;animation:nexus-private-dot 1.25s ease-in-out infinite}.nexus-private-dot:nth-child(2){animation-delay:.18s}.nexus-private-dot:nth-child(3){animation-delay:.36s}@keyframes nexus-private-dot{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:.95;transform:translateY(-3px)}}.nexus-private-kicker{animation:nexus-private-breathe 5.5s ease-in-out infinite}@keyframes nexus-private-breathe{0%,100%{opacity:.72}50%{opacity:1}}@media(prefers-reduced-motion:reduce){.nexus-private-dot,.nexus-private-kicker,.nexus-private-turn.is-streaming .nexus-private-copy::after{animation:none}.nexus-private-dot{opacity:.6}}.nexus-private-actions{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:11px}.nexus-private-btn{border:1px solid rgba(240,143,182,.32);background:rgba(240,143,182,.09);color:inherit;border-radius:10px;padding:8px 10px;text-align:center;font:inherit;font-size:.8rem;cursor:pointer}.nexus-private-btn:hover,.nexus-private-btn:focus-visible{background:rgba(244,128,166,.18);outline:none}.nexus-private-btn:disabled{cursor:default;opacity:.4}.nexus-private-btn.is-chosen{opacity:.85;border-color:rgba(240,143,182,.55);background:rgba(240,143,182,.16)}.nexus-private-bar{display:flex;align-items:center;gap:8px;padding:7px 11px;border-top:1px solid rgba(255,255,255,.07)}.nexus-private-level{font-size:.72rem;opacity:.6;flex:1}.nexus-private-bar .nexus-private-btn{padding:6px 9px;font-size:.76rem}.nexus-private-soundtrack{margin:0 11px 9px;font-size:.74rem}.nexus-private-soundtrack-strip{display:flex;align-items:center;gap:8px;justify-content:space-between;padding:5px 9px;border:1px solid rgba(240,143,182,.16);border-radius:9px;background:rgba(240,143,182,.05)}.nexus-private-soundtrack-copy{min-width:0;flex:1}.nexus-private-soundtrack-kicker{display:none}.nexus-private-soundtrack-title{font-size:.74rem;line-height:1.3;opacity:.72;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.nexus-private-soundtrack-creator{display:none}.nexus-private-soundtrack-toggle{border:0;background:transparent;color:inherit;opacity:.5;padding:2px 4px;font:inherit;font-size:.7rem;cursor:pointer;flex:0 0 auto;text-decoration:underline}.nexus-private-soundtrack-toggle:hover,.nexus-private-soundtrack-toggle:focus-visible{opacity:.9;outline:none}.nexus-private-soundtrack-player{display:none;width:min(280px,100%);margin-top:9px}.nexus-private-soundtrack-player.is-open{display:block}.nexus-private-soundtrack-player .nexus-yt-card{width:100%;max-width:280px;margin:0}.nexus-private-soundtrack-player .nexus-yt-meta{font-size:.72rem}.nexus-private-complete{font-size:1rem;font-weight:750;margin-bottom:6px}.nexus-private-note{font-size:.84rem;line-height:1.5;opacity:.74}.is-complete .nexus-private-bar{display:none}
@media(max-width:560px){#${ROW_ID}{margin:6px 0 8px}.nexus-private-card{padding:11px 13px;max-height:30vh}.nexus-private-copy{font-size:.92rem}.nexus-private-soundtrack{margin:0 10px 8px}.nexus-private-soundtrack-player{width:100%}.nexus-private-soundtrack-player .nexus-yt-card{max-width:100%}}
`;

    /**
     * Did a mutation batch add a real chat message, as opposed to our own row moving?
     *
     * The Private row lives in `#chat-history` too and gets re-appended when chat restore code
     * replaces the children, so "something was added" on its own would hide the thinking dots
     * every time the session repaired itself. An element that is neither our row nor inside it
     * is a message the chat pipeline wrote.
     */
    function addedAMessage(records, ownRow) {
        for (const record of records || []) {
            for (const node of (record && record.addedNodes) || []) {
                if (!node || node.nodeType !== 1) continue;
                if (node === ownRow) continue;
                if (ownRow && typeof ownRow.contains === 'function' && ownRow.contains(node)) continue;
                if (node.classList && node.classList.contains('empty-state')) continue;
                return true;
            }
        }
        return false;
    }

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
            /** A question with buttons that an interjection must give back. See showMessage. */
            this._pending = null;
            /** The three-dot row, while she is thinking. See showThinking. */
            this._thinking = null;
            /** The rolling transcript inside the card. */
            this.log = null;
            /** The surface this view replaced, restored on destroy. */
            this._previousSurface = null;
            /**
             * This conversation's turns, and the only copy of them (P10).
             *
             * `handleUserMessage` wrote every turn into `window.chatHistory` and called
             * `_persistChat`, which put it in `localStorage` under `nexus_chat_messages` — so a
             * Private conversation survived the session, the page and the browser restart, and
             * came back as ordinary chat scrollback the next time somebody opened the app. The
             * completion card promises a quiet ending with nothing kept; ordinary chat
             * persistence is the exact opposite of one.
             *
             * An array on the view, so it is gone when the card is gone. Nothing writes it to
             * disk and nothing outside this session can read it.
             */
            this._history = [];
            /** The CLEAR subscription, dropped on destroy. See `_watchReset`. */
            this._unwatchReset = null;
        }

        mount({ preset, scene } = {}) {
            const host = this.doc && this.doc.getElementById('chat-history');
            if (!host) return false;
            ensureStyles(this.doc);
            this.destroy();
            const row = this.doc.createElement('section');
            row.id = ROW_ID;
            row.setAttribute('aria-live', 'polite');
            row.innerHTML = `<div class="nexus-private-shell"><header class="nexus-private-heading"><div class="nexus-private-kicker">🔐 PRIVATE</div><div class="nexus-private-heading-title"></div><div class="nexus-private-place"></div></header><div class="nexus-private-card"><div class="nexus-private-log"></div></div><div class="nexus-private-soundtrack" hidden></div><footer class="nexus-private-bar"><span class="nexus-private-level">Warm</span></footer></div>`;
            row.querySelector('.nexus-private-heading-title').textContent = (preset && preset.label) || 'Private';
            row.querySelector('.nexus-private-place').textContent = scene || 'Current place';
            const bar = row.querySelector('.nexus-private-bar');
            bar.append(
                // `Keep it cozy` is lovely copy and a poor permanent safety control: as the
                // one always-visible way to ease off it has to say what it does without
                // needing to be learned. It survives as a contextual dialogue choice.
                this._button('↓ Slow down', 'cozy', this.handlers.onCozy),
                this._button('End', 'end', this.handlers.onEnd)
            );
            this.row = row;
            this.card = row.querySelector('.nexus-private-card');
            this.log = row.querySelector('.nexus-private-log');
            this.level = row.querySelector('.nexus-private-level');
            const empty = host.querySelector(':scope > .empty-state');
            if (empty) empty.remove();
            host.appendChild(row);
            this._ensureConversationVisible();
            this._bindComposer();
            this._observeHost(host);
            this._installSurface();
            this._watchReset();
            this._scroll(host);
            return true;
        }

        /**
         * Private becomes the conversation while it is running.
         *
         * Until this, `main.js` drew an ordinary `YOU` bubble and streamed an ordinary `NEXUS`
         * bubble into the same scroll container as the card, and the card watched them happen
         * through a MutationObserver. Two presentation systems, and a person left deciding
         * which of the two things on screen they were talking to.
         *
         * The previous surface is kept rather than assumed, so `destroy` restores whatever was
         * installed rather than forcing the default — the day a third surface exists, assuming
         * would silently drop it.
         */
        _installSurface() {
            const api = this.win && this.win.NEXUS_CONVERSATION_SURFACE;
            if (!api || typeof api.use !== 'function') return false;
            this._previousSurface = api.use(this.surface());
            return true;
        }

        /**
         * CLEAR must empty this conversation too (P10).
         *
         * `ConversationReset` is the single owner of forgetting, and it erases
         * `nexus_chat_messages` and calls `chatHistory.clear()`. Private's turns are in neither of
         * those any more — which is the point — so without this, pressing CLEAR during a Private
         * session wiped the screen while leaving the model's context untouched: she would still
         * have remembered what the person had just erased, and could have referred to it in the
         * next reply. That is the one failure mode a CLEAR button must not have.
         */
        _watchReset() {
            const api = this.win && this.win.NEXUS_CONVERSATION_RESET;
            if (!api || typeof api.onReset !== 'function') return false;
            this._unwatchReset = api.onReset(() => {
                this._history = [];
                if (this.log) this.log.textContent = '';
                this._pending = null;
                this.hideThinking();
            });
            return true;
        }

        _restoreSurface() {
            const api = this.win && this.win.NEXUS_CONVERSATION_SURFACE;
            if (!api || typeof api.use !== 'function') return false;
            if (this._previousSurface) api.use(this._previousSurface);
            else if (typeof api.reset === 'function') api.reset();
            this._previousSurface = null;
            return true;
        }

        showStarting() {
            this.showMessage('Starting gently. You remain in control of the pace.');
        }

        /**
         * Three dots, while she is working out what to say.
         *
         * The card was a still image between beats, and the gaps are long: 75 s, 90 s and 75 s
         * between the scheduled lines, plus however long the provider takes to answer anything
         * typed in between. A reported session sat through `OllaBridge returned 504; retrying`
         * with nothing on screen moving, which is indistinguishable from the feature having
         * crashed — and in the one mode where the whole point is that somebody is present with
         * you, "frozen" is the worst possible reading.
         *
         * Appended rather than written through `showMessage`, deliberately: this must not
         * disturb a question that is on screen. The mood choice stays tappable while she
         * thinks.
         */
        showThinking() {
            if (!this.card || this._thinking) return null;
            const wrap = this.doc.createElement('div');
            wrap.className = 'nexus-private-thinking';
            wrap.dataset.privateThinking = '1';
            // Announced once, as a status rather than a live transcript: a screen reader that
            // read three dots on every frame would be unusable.
            wrap.setAttribute('role', 'status');
            wrap.setAttribute('aria-label', 'She is thinking');
            for (let i = 0; i < 3; i += 1) {
                const dot = this.doc.createElement('span');
                dot.className = 'nexus-private-dot';
                wrap.appendChild(dot);
            }
            this.card.appendChild(wrap);
            this._thinking = wrap;
            this._scroll(this.doc && this.doc.getElementById('chat-history'));
            return wrap;
        }

        hideThinking() {
            if (!this._thinking) return false;
            if (this._thinking.parentNode) this._thinking.remove();
            this._thinking = null;
            return true;
        }

        /** Whether the dots are up, so a caller can avoid re-arming a timer it already has. */
        get isThinking() {
            return Boolean(this._thinking);
        }

        /**
         * Say something, and — when it is an interjection — give back the question it landed on.
         *
         * The card holds one message at a time, so every `showMessage` wipes what was there.
         * That was fine while only the scheduled beats wrote to it, and became a real defect
         * the moment a footer button could write to it too: pressing **Keep it cozy** while
         * *"What kind of mood should we keep?"* was on screen replaced the question and its two
         * buttons with one acknowledgement. `_showMoodChoice` is a one-shot `setTimeout`, so the
         * question was never re-offered — the user lost that beat permanently and the rest of
         * the session silently ran on the default mood. From the outside it reads as the button
         * having broken the card, which is very close to what it did.
         *
         * So a message with its own actions is remembered as *pending*, and an interjection —
         * a message with no actions of its own — restores it underneath. A scheduled beat
         * clears it, because a beat is the session moving on rather than talking over itself.
         */
        /**
         * Say something.
         *
         * `interjection` survives as an argument and no longer does anything, and that is the
         * point: it existed because the card held exactly one message, so a footer button
         * answering while *"What kind of mood should we keep?"* was on screen destroyed the
         * question and its two buttons — permanently, since `_showMoodChoice` is a one-shot.
         * The fix then was to redraw the question underneath the answer. In a transcript the
         * question never left, so redrawing it produced the buttons twice. The property the
         * old machinery protected is now structural.
         */
        showMessage(text, actions = []) {
            const turn = this._turn('her', text);
            if (!turn) return;
            if (actions.length) {
                this._attachActions(turn, actions);
                this._pending = { text: String(text || ''), actions };
            }
            this._trim();
        }

        /**
         * One turn in the transcript.
         *
         * The card used to hold exactly one message and wipe it on every write, which is what a
         * scripted HUD wants and the opposite of what a conversation wants: her line vanished
         * the moment the person answered, so there was never anything on screen that looked
         * like the two of them talking. It keeps the last `MAX_TURNS` now and lets the rest
         * scroll away.
         */
        _turn(who, text, { dots = false } = {}) {
            if (!this.log) return null;
            const body = String(text == null ? '' : text);
            if (!body && !dots) return null;
            const row = this.doc.createElement('div');
            row.className = `nexus-private-turn is-${who === 'you' ? 'you' : 'her'}`;
            row.dataset.privateTurn = who === 'you' ? 'you' : 'her';
            const label = this.doc.createElement('div');
            label.className = 'nexus-private-who';
            label.textContent = who === 'you' ? 'YOU' : 'HER';
            const copy = this.doc.createElement('div');
            copy.className = 'nexus-private-copy';
            copy.textContent = body;
            row.append(label, copy);
            this.log.appendChild(row);
            this._scroll(this.doc && this.doc.getElementById('chat-history'));
            return row;
        }

        /**
         * The choices under a turn, live until one of them is taken.
         *
         * Consuming them matters more in a transcript than it did in a card that wiped itself:
         * the answered question stays on screen, so without this the same check-in could be
         * accepted twice and the same mood chosen again an hour later. The chosen label stays
         * visible — it is part of the conversation — and stops being a control.
         */
        _attachActions(turn, actions) {
            if (!turn || !actions || !actions.length) return null;
            const list = this.doc.createElement('div');
            list.className = 'nexus-private-actions';
            const consume = (chosen) => {
                list.dataset.spent = '1';
                for (const button of list.querySelectorAll('button')) {
                    button.disabled = true;
                    button.removeAttribute('data-private-action');
                    button.classList.toggle('is-chosen', button === chosen);
                }
                if (this._pending && this._pending.actions === actions) this._pending = null;
            };
            actions.forEach((action) => {
                const button = this._button(action.label, action.id, () => {
                    if (list.dataset.spent === '1') return;
                    consume(button);
                    if (typeof action.run === 'function') action.run();
                });
                list.appendChild(button);
            });
            turn.appendChild(list);
            return list;
        }

        /**
         * Keep the recent few. A private moment is a conversation, not an archive.
         *
         * A turn carrying live buttons is never trimmed: those are the only copy of a question
         * the session asked once, and scrolling it away would take the answer with it.
         */
        _trim() {
            if (!this.log) return;
            const turns = [...this.log.querySelectorAll(':scope > .nexus-private-turn')];
            let over = Math.max(0, turns.length - MAX_TURNS);
            for (const old of turns) {
                if (over <= 0) break;
                if (old.querySelector('.nexus-private-actions:not([data-spent])')) continue;
                old.remove();
                over -= 1;
            }
        }

        /**
         * A turn the person typed, drawn inside the experience rather than under it.
         *
         * This is the half that made Private feel like two applications: `main.js` drew an
         * ordinary `YOU` bubble in the same scroll container, and the card could only watch it
         * happen through a MutationObserver.
         */
        renderUserTurn(text) {
            this.hideThinking();
            const turn = this._turn('you', text);
            this._trim();
            return turn;
        }

        /**
         * Her reply, streaming into the transcript from its first token.
         *
         * Returns the handle `ConversationSurface` hands to `main.js`, so the reply visually
         * belongs to this moment rather than appearing somewhere else once it is finished.
         */
        beginAssistantTurn() {
            this.hideThinking();
            const turn = this._turn('her', '', { dots: true });
            const copy = turn && turn.querySelector('.nexus-private-copy');
            const view = this;
            let settled = false;
            if (turn) turn.classList.add('is-streaming');
            return {
                id: 'private',
                node: turn,
                textNode: copy,
                append(full) {
                    if (!copy) return;
                    copy.textContent = String(full == null ? '' : full);
                    if (turn) turn.classList.remove('is-streaming');
                    view._scroll(view.doc && view.doc.getElementById('chat-history'));
                },
                finish(full) {
                    settled = true;
                    if (!copy) return;
                    copy.textContent = String(full == null ? '' : full);
                    if (turn) turn.classList.remove('is-streaming');
                    view._trim();
                },
                discard() {
                    // The user pressed CLEAR mid-sentence, or the provider failed. An empty
                    // turn left behind would be a nameless gap in the conversation.
                    if (!settled && turn && turn.parentNode) turn.remove();
                },
            };
        }

        /**
         * The surface Private installs while it is running.
         *
         * `renderError` deliberately reads as her rather than as the app: an error inside a
         * private moment is still something she says, and a red system row would break the one
         * thing this mode is for.
         */
        /**
         * The session-local store (P10). See `_history`.
         *
         * `persist()` is deliberately a no-op rather than absent: the caller should not have to
         * know which surfaces persist, and a missing method would read as an oversight. Not
         * writing to disk is the feature.
         */
        history() {
            const view = this;
            return {
                id: 'private',
                getHistory() {
                    return view._history.slice(-HISTORY_WINDOW);
                },
                addMessage(role, text) {
                    const body = String(text == null ? '' : text);
                    if (!body) return;
                    view._history.push({ role: role === 'user' ? 'user' : 'assistant', content: body });
                    // Bounded well above the window so the trim is never in the hot path, and so
                    // a long session cannot grow it without limit.
                    if (view._history.length > HISTORY_WINDOW * 4) {
                        view._history.splice(0, view._history.length - HISTORY_WINDOW * 2);
                    }
                },
                persist() {
                    // Nothing. That is the promise the completion card makes.
                },
            };
        }

        surface() {
            const view = this;
            return {
                id: 'private',
                history() {
                    return view.history();
                },
                renderUser(text) {
                    view.renderUserTurn(text);
                },
                renderAssistant(text) {
                    view.hideThinking();
                    view._turn('her', text);
                    view._trim();
                },
                renderError(text) {
                    view.hideThinking();
                    view._turn('her', text);
                    view._trim();
                },
                beginAssistant() {
                    return view.beginAssistantTurn();
                },
            };
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
            this._restoreSurface();
            if (this._unwatchReset) {
                try {
                    this._unwatchReset();
                } catch (_) {}
                this._unwatchReset = null;
            }
            if (this._hostObserver) this._hostObserver.disconnect();
            this._hostObserver = null;
            this._unbindComposer();
            const old = this.doc && this.doc.getElementById(ROW_ID);
            if (old) old.remove();
            this._pending = null;
            this._thinking = null;
            // The only copy of the conversation, dropped with the card. See `_history`.
            this._history = [];
            this.row = this.card = this.level = this.log = null;
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
            this._hostObserver = new MutationObserver((records) => {
                if (!this.row) return;
                // A reply landing in the transcript is the end of thinking, and it is the only
                // signal available here: the composer is observed rather than intercepted, so
                // the ordinary chat pipeline owns the request and never reports back. A new
                // child of the history that is not our own row is that reply.
                if (this._thinking && addedAMessage(records, this.row)) this.hideThinking();
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
