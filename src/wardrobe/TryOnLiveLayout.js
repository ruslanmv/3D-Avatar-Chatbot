/**
 * Avatar-first Try-On conversation presentation.
 *
 * This module only manages the existing chat DOM while a Try-On activity is active.
 * It never creates a second composer, WebGL renderer, conversation, or wardrobe state.
 * Watch: latest new NEXUS line. Conversation: recent turns. History: full transcript.
 * The existing chat history and voice/composer pipeline remain authoritative.
 */
(function (global) {
    'use strict';

    var STYLE_ID = 'nexus-tryon-live-layout-style';
    var MODES = ['watch', 'conversation', 'history'];
    var CSS = [
        '.nexus-live-tryon .chat-card{display:flex;flex-direction:column;min-height:0;background:linear-gradient(150deg,rgba(6,24,37,.97),rgba(4,14,27,.97));',
        'border:1px solid rgba(34,211,238,.34);box-shadow:0 16px 45px rgba(0,0,0,.24)}',
        '.nexus-live-tryon .chat-main{flex:1;min-height:0}',
        '.nexus-live-tryon .chat-input-shell{margin-top:auto}',
        '.nexus-live-tryon .chat-card-header{padding:.95rem 1.1rem;border-bottom:1px solid rgba(34,211,238,.16)}',
        '.nexus-live-tryon .nexus-live-subtitle{margin:.25rem 0 0;color:#83afbe;font-size:.75rem;line-height:1.4}',
        '.nexus-live-tryon .chat-card-header .section-title{font-size:1.05rem;letter-spacing:.035em}',
        '.nexus-live-tryon .chat-card-header .section-title .title-icon{display:none}',
        '.nexus-live-tryon .nexus-live-controls{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;',
        'justify-content:space-between;padding:.75rem 1rem .4rem}',
        '.nexus-live-tryon .nexus-live-modes{display:flex;gap:.4rem;align-items:center}',
        '.nexus-live-tryon .nexus-live-history-link{background:none;border-color:transparent;',
        'font-size:.76rem;color:#80c4d4}',
        '.nexus-live-tryon.nexus-live-watch .nexus-live-history-link{display:none}',
        '.nexus-live-tryon .nexus-live-button{appearance:none;border:1px solid rgba(34,211,238,.3);',
        'border-radius:11px;background:rgba(34,211,238,.055);padding:.52rem .8rem;color:#c6e9f0;',
        'font:600 .8rem/1.25 var(--font-sans,system-ui,sans-serif);cursor:pointer}',
        '.nexus-live-tryon .nexus-live-button[aria-pressed="true"]{background:rgba(0,207,232,.17);',
        'border-color:#0acfe8;color:#eafbff}',
        '.nexus-live-tryon .nexus-live-button:focus-visible{outline:2px solid #37e4ff;outline-offset:2px}',
        '.nexus-live-tryon .nexus-live-summary{display:none;margin:.6rem 1rem auto;padding:1.2rem;',
        'border-radius:16px;background:linear-gradient(145deg,rgba(9,64,65,.68),rgba(5,39,52,.65));',
        'border:1px solid rgba(35,219,185,.27);text-align:left}',
        '.nexus-live-tryon.nexus-live-watch .nexus-live-summary{display:block}',
        '.nexus-live-tryon .nexus-live-kicker{color:#44e5bb;font:700 .72rem/1.4 var(--font-display,system-ui);',
        'letter-spacing:.1em;margin:0 0 .8rem}',
        '.nexus-live-tryon .nexus-live-last-question{color:#9fc5d4;font-size:.83rem;',
        'margin:0 0 .6rem;line-height:1.35}',
        '.nexus-live-tryon .nexus-live-last-question[hidden]{display:none}',
        '.nexus-live-tryon .nexus-live-answer{font:500 clamp(1rem,1.45vw,1.3rem)/1.6 ',
        'var(--font-sans,system-ui);color:#e6f8fb;overflow-wrap:anywhere;margin:0}',
        '.nexus-live-tryon .nexus-live-suggestions{display:flex;flex-wrap:wrap;gap:.45rem;padding:0 1rem .8rem}',
        '.nexus-live-tryon .nexus-live-suggestions .nexus-live-button{font-weight:500;font-size:.76rem}',
        '.nexus-live-tryon.nexus-live-watch .chat-main{display:none}',
        '.nexus-live-tryon.nexus-live-watch #typing-indicator{display:none}',
        '.nexus-live-tryon.nexus-live-conversation .nexus-live-older{display:none!important}',
        '.nexus-live-tryon .chat-history{padding:.9rem 1rem;scroll-behavior:auto}',
        '.nexus-live-tryon .chat-message{max-width:96%;padding:.7rem .85rem;margin-bottom:.7rem;',
        'border-radius:13px;font-size:.9rem;box-shadow:none}',
        '.nexus-live-tryon .chat-message.user{background:rgba(31,58,83,.72);border-color:rgba(61,136,173,.24)}',
        '.nexus-live-tryon .chat-message.avatar{background:rgba(5,75,65,.56);border-color:rgba(31,179,150,.24)}',
        '.nexus-live-tryon .message-text{line-height:1.5}',
        '.nexus-live-tryon .chat-card-header #clear-history{display:none}',
        '.nexus-live-tryon.nexus-live-history .chat-card-header #clear-history{display:inline-block}',
        '@media(max-width:760px){',
        'html.is-mobile .nexus-live-tryon.nexus-live-watch .chat-panel{height:min(25dvh,210px)!important;',
        'min-height:170px;transition:height .2s ease}',
        'html.is-mobile .nexus-live-tryon.nexus-live-conversation .chat-panel,',
        'html.is-mobile .nexus-live-tryon.nexus-live-history .chat-panel{height:min(60dvh,530px)!important;',
        'min-height:260px;transition:height .2s ease}',
        'html.is-mobile .nexus-live-tryon .chat-panel .chat-card{',
        'background:rgba(4,17,29,.96)!important;border:1px solid rgba(34,211,238,.24)!important;',
        'border-radius:16px 16px 0 0;backdrop-filter:blur(14px)}',
        'html.is-mobile .nexus-live-tryon .chat-card-header{display:none}',
        'html.is-mobile .nexus-live-tryon .nexus-live-controls{padding:.45rem .7rem .2rem}',
        'html.is-mobile .nexus-live-tryon .nexus-live-summary{margin:.3rem .65rem auto;',
        'padding:.65rem .8rem;border-radius:12px}',
        'html.is-mobile .nexus-live-tryon .nexus-live-kicker{font-size:.65rem;margin-bottom:.3rem}',
        'html.is-mobile .nexus-live-tryon .nexus-live-answer{font-size:.82rem;line-height:1.4;',
        'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
        'html.is-mobile .nexus-live-tryon .nexus-live-suggestions{display:none}',
        'html.is-mobile .nexus-live-tryon .nexus-live-button{min-height:38px;padding:.38rem .6rem}',
        '}',
        '@media(prefers-reduced-motion:reduce){.nexus-live-tryon .chat-panel{transition:none!important}}',
    ].join('');

    function element(doc, tag, className, label) {
        var node = doc.createElement(tag);
        if (className) node.className = className;
        if (label !== undefined) node.textContent = label;
        return node;
    }

    function recentRows(rows, max) {
        return rows.slice(Math.max(0, rows.length - max));
    }

    function latestAssistantText(rows) {
        for (var i = rows.length - 1; i >= 0; i -= 1) {
            var message = rows[i].querySelector('.chat-message.avatar .message-text');
            if (message && message.textContent && message.textContent.trim()) {
                return message.textContent.trim();
            }
        }
        return '';
    }

    class TryOnLiveLayout {
        constructor(options) {
            options = options || {};
            this.doc = options.doc || global.document;
            this.mode = 'watch';
            this.baseline = 0;
            this.observer = null;
        }

        mount() {
            var doc = this.doc;
            if (!doc || this.layout) return this.layout || null;
            this.layout = doc.querySelector('.content-layout');
            this.card = doc.querySelector('.chat-panel .chat-card');
            this.history = doc.getElementById('chat-history');
            if (!this.layout || !this.card || !this.history) {
                this.layout = null;
                return null;
            }
            if (!doc.getElementById(STYLE_ID)) {
                var style = element(doc, 'style');
                style.id = STYLE_ID;
                style.textContent = CSS;
                (doc.head || doc.documentElement).appendChild(style);
            }
            this.baseline = this.rows().length;
            this.heading = this.card.querySelector('.chat-card-header .section-title');
            this.headingOriginal = this.heading ? this.heading.textContent : null;
            if (this.heading) {
                this.heading.textContent = 'CONVERSATION WITH NEXUS';
                var wrapper = this.heading.parentNode;
                this.subtitle = element(doc, 'p', 'nexus-live-subtitle', 'Your AI stylist · Live fashion and ideas');
                wrapper.appendChild(this.subtitle);
            }
            this.controls = element(doc, 'div', 'nexus-live-controls');
            this.controls.setAttribute('aria-label', 'Try-On conversation view');
            var group = element(doc, 'div', 'nexus-live-modes');
            this.modeButtons = {};
            var self = this;
            [
                ['watch', '● Live'],
                ['conversation', 'Conversation'],
            ].forEach(function (entry) {
                var button = element(doc, 'button', 'nexus-live-button', entry[1]);
                button.type = 'button';
                button.setAttribute('aria-label', entry[1] + ' mode');
                button.addEventListener('click', function () {
                    self.setMode(entry[0]);
                });
                self.modeButtons[entry[0]] = button;
                group.appendChild(button);
            });
            this.controls.appendChild(group);
            var historyLink = element(doc, 'button', 'nexus-live-button nexus-live-history-link', 'Full history ↗');
            historyLink.type = 'button';
            historyLink.setAttribute('aria-label', 'Open full conversation history');
            historyLink.addEventListener('click', function () { self.setMode(self.mode === 'history' ? 'conversation' : 'history'); });
            this.controls.appendChild(historyLink);
            this.historyLink = historyLink;
            this.summary = element(doc, 'section', 'nexus-live-summary');
            this.summary.setAttribute('aria-label', 'Latest NEXUS commentary');
            this.summary.appendChild(element(doc, 'p', 'nexus-live-kicker', '● NEXUS · LIVE COMMENTARY'));
            this.lastQuestion = element(doc, 'p', 'nexus-live-last-question');
            this.lastQuestion.hidden = true;
            this.summary.appendChild(this.lastQuestion);
            this.answer = element(doc, 'p', 'nexus-live-answer', 'Choose a look or ask me what to try next.');
            this.summary.appendChild(this.answer);
            this.suggestions = element(doc, 'div', 'nexus-live-suggestions');
            ['How would you style it?', 'Show me the back', 'What should we try next?'].forEach(function (label) {
                var button = element(doc, 'button', 'nexus-live-button', label);
                button.type = 'button';
                button.addEventListener('click', function () {
                    self.ask(label);
                });
                self.suggestions.appendChild(button);
            });
            var main = this.card.querySelector('.chat-main');
            this.card.insertBefore(this.controls, main);
            this.card.insertBefore(this.summary, main);
            this.card.insertBefore(this.suggestions, main);
            this.layout.classList.add('nexus-live-tryon');
            this.observer = new (doc.defaultView || global).MutationObserver(function () {
                self.update();
            });
            this.observer.observe(this.history, { childList: true, subtree: true, characterData: true });
            this.setMode('watch');
            return this.layout;
        }

        rows() {
            return this.history ? Array.prototype.slice.call(this.history.querySelectorAll('.chat-row')) : [];
        }

        update() {
            var rows = this.rows();
            if (rows.length < this.baseline) this.baseline = 0; // after CLEAR
            var live = rows.slice(this.baseline);
            var latest = latestAssistantText(live);
            if (latest && this.answer && this.answer.textContent !== latest) this.answer.textContent = latest;
            var latestQuestion = '';
            for (var i = live.length - 1; i >= 0; i -= 1) {
                var user = live[i].querySelector('.chat-message.user .message-text');
                if (user && user.textContent.trim()) { latestQuestion = user.textContent.trim(); break; }
            }
            if (this.lastQuestion) {
                this.lastQuestion.hidden = !latestQuestion;
                this.lastQuestion.textContent = latestQuestion ? 'YOU · ' + latestQuestion : '';
            }
            var visible = recentRows(rows, 4);
            rows.forEach(function (row) {
                row.classList.toggle('nexus-live-older', visible.indexOf(row) === -1);
            });
        }

        ask(text) {
            if (text === 'Show me the back') {
                var turn = this.doc.querySelector('.nexus-stage-action[data-command="turn"]') ||
                    this.doc.querySelector('#nexus-try-on-view [data-key="turn"]');
                if (turn && !turn.disabled) {
                    turn.click();
                    return;
                }
            }
            var input = this.doc.getElementById('speech-text');
            var send = this.doc.getElementById('speak-btn');
            if (!input || !send || send.disabled) return;
            input.value = text;
            input.dispatchEvent(new (this.doc.defaultView || global).Event('input', { bubbles: true }));
            send.click(); // always use the existing conversation/voice pipeline
        }

        setMode(mode) {
            if (MODES.indexOf(mode) === -1 || !this.layout) return;
            this.mode = mode;
            var self = this;
            MODES.forEach(function (name) {
                self.layout.classList.toggle('nexus-live-' + name, name === mode);
                if (self.modeButtons[name]) self.modeButtons[name].setAttribute('aria-pressed', name === mode ? 'true' : 'false');
            });
            if (this.historyLink) this.historyLink.textContent = mode === 'history' ? '‹ Recent' : 'Full history ↗';
            this.update();
            if (mode !== 'watch' && this.history) this.history.scrollTop = this.history.scrollHeight;
        }

        unmount() {
            if (this.observer) this.observer.disconnect();
            this.observer = null;
            if (this.layout) {
                ['nexus-live-tryon', 'nexus-live-watch', 'nexus-live-conversation', 'nexus-live-history'].forEach(
                    function (name) {
                        this.layout.classList.remove(name);
                    }.bind(this)
                );
            }
            this.rows().forEach(function (row) {
                row.classList.remove('nexus-live-older');
            });
            if (this.heading && this.headingOriginal !== null) this.heading.textContent = this.headingOriginal;
            if (this.subtitle) this.subtitle.remove();
            [this.controls, this.summary, this.suggestions].forEach(function (node) {
                if (node && node.parentNode) node.parentNode.removeChild(node);
            });
            this.controls = null;
            this.summary = null;
            this.suggestions = null;
            this.layout = null;
            this.card = null;
            this.history = null;
            this.historyLink = null;
            this.lastQuestion = null;
        }
    }

    var api = { TryOnLiveLayout: TryOnLiveLayout, recentRows: recentRows, latestAssistantText: latestAssistantText };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_TRYON_LIVE_LAYOUT = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
