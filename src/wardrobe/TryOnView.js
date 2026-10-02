/**
 * W7, LT2. What Try-On looks like: one live screen, with her as the show.
 *
 * It sits exactly where the Together panel sits — the same card over the avatar on a
 * desktop, the same bottom sheet above the composer on a phone — and reuses Together's
 * own classes (`nexus-bd-together-head`, `-option`, `-cancel`, ...), so it reads as a screen
 * of Together rather than a second product. It is its own element, not a child of the
 * panel, because the panel draws only the input kinds it knows and this is additive: the
 * panel is not edited. The panel closes itself when an activity starts ("get out of the
 * way"), and this appears in its place; if the panel is reopened it is drawn over this one
 * (a lower z-index), which is the "Stop / Change" flow people already know.
 *
 * W7 had two screens — choose looks, press START, then step through them — and the first
 * one was mostly configuration: an import link, a Forge warning, a pink private box, a
 * counter, a disabled button. LT2 is one continuous screen, a remote control under the
 * avatar: her looks in a strip (tap one and she wears it), "+ New", one composer ("Tell me
 * what to change…"), a few chips, and — once she has something on — Save, Compare, Turn,
 * Undo and Keep. Library management (import a pack, manage packs, the Studio) is behind
 * "Wardrobe ···", because it is not the game. Without Forge, the composer says so in five
 * quiet words and every saved look still works.
 *
 * Private is a category tab beside For you / Casual / Dressy, not a second wardrobe in a
 * pink box: choosing it changes the suggestions, and nothing else. What is offered there is
 * exactly what TryOnPrivate answers; the gating is Forge's and private mode's, unchanged.
 *
 * Nothing here decides anything. Wearing, history, compare, favourites and Show Mode are
 * `TryOnSession`'s; reading what was typed is `TryOnIntent`'s; making a look is
 * `TryOnGenerator`'s; her one-line reactions are `TryOnReactions`'; the words are
 * `TryOnReasons`'. This file turns their state into elements and clicks back into calls,
 * and plays the reveal when a look lands.
 *
 * Accessibility, because a haul is operated with the avatar in view and the hands busy:
 * it is a labelled modal dialog; Tab stays inside it; Escape ends a compare or, before
 * anything is worn, goes back — it never ends a haul by surprise; ← and → step through her
 * looks; the look strip's cards are pressed/not-pressed buttons; progress and reactions
 * are announced politely; motion respects prefers-reduced-motion.
 *
 * Exposes: window.NEXUS_TRY_ON_VIEW
 */
(function (global) {
    'use strict';

    var ROOT_ID = 'nexus-try-on-view';
    var STYLE_ID = 'nexus-try-on-style';
    var REVEAL_MS = 900;

    // No backticks anywhere in this stylesheet: it is a plain string.
    var CSS = [
        '#nexus-try-on-view{position:absolute;left:50%;bottom:4.6rem;transform:translateX(-50%);',
        'width:min(90%,30rem);max-height:60%;overflow-y:auto;z-index:39;padding:.7rem .85rem .6rem;',
        'border-radius:14px;background:rgba(11,16,23,.94);border:1px solid rgba(34,211,238,.26);',
        'box-shadow:0 14px 40px rgba(0,0,0,.5);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);',
        'color:#e8ecf2;font-family:var(--font-sans,system-ui,sans-serif);text-align:center}',
        '#nexus-try-on-view[hidden]{display:none}',
        '#nexus-try-on-view.is-floating{position:fixed;bottom:1.2rem}',
        '.nexus-try-on-head{display:flex;align-items:center;justify-content:space-between;gap:.5rem;margin:0 0 .1rem}',
        '.nexus-try-on-head .nexus-bd-together-head{margin:0}',
        '.nexus-try-on-hide{background:none;border:0;padding:.2rem .1rem;color:#7d8797;font:600 .68rem/1 inherit;cursor:pointer}',
        '.nexus-try-on-remote{display:flex;align-items:center;justify-content:center;gap:.35rem;margin:.2rem 0 .1rem}',
        '.nexus-try-on-remote .nexus-try-on-act{flex:0 0 auto;min-width:2.4rem}',
        '.nexus-try-on-stage{margin:0 0 .3rem;touch-action:pan-y}',
        '.nexus-try-on-current{margin:0;font-size:1rem;font-weight:650}',
        '.nexus-try-on-counter{margin:.15rem 0 0;font-size:.68rem;letter-spacing:.14em;text-transform:uppercase;color:#7d8797}',
        '.nexus-try-on-stage.is-revealing .nexus-try-on-current{animation:nexus-try-on-reveal .9s ease both}',
        '@keyframes nexus-try-on-reveal{0%{opacity:0;transform:translateY(6px) scale(.96);letter-spacing:.08em}',
        '60%{opacity:1}100%{opacity:1;transform:none;letter-spacing:normal}}',
        '.nexus-try-on-flash{position:absolute;inset:0;pointer-events:none;z-index:38;border-radius:inherit;',
        'background:radial-gradient(ellipse at 50% 42%,rgba(255,255,255,.28),rgba(34,211,238,.08) 45%,transparent 70%);',
        'animation:nexus-try-on-flash .9s ease-out both}',
        '@keyframes nexus-try-on-flash{0%{opacity:0}25%{opacity:1}100%{opacity:0}}',
        '.nexus-try-on-react{margin:.35rem auto .55rem;max-width:26rem;padding:.5rem .7rem;border-radius:12px;',
        'background:rgba(34,211,238,.08);border:1px solid rgba(34,211,238,.22);animation:nexus-try-on-fade .3s ease both}',
        '.nexus-try-on-react p{margin:0 0 .4rem;font-size:.84rem;font-style:italic;color:#dff6fb}',
        '@keyframes nexus-try-on-fade{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}',
        '.nexus-try-on-row{display:flex;flex-wrap:wrap;justify-content:center;gap:.35rem}',
        '.nexus-try-on-actions{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.3rem;margin:.2rem 0 .45rem}',
        '.nexus-try-on-act{padding:.42rem .3rem;border-radius:9px;cursor:pointer;background:rgba(255,255,255,.05);',
        'border:1px solid rgba(255,255,255,.12);color:#e8ecf2;font:600 .76rem/1.1 inherit}',
        '.nexus-try-on-act[aria-pressed="true"]{border-color:rgba(240,143,182,.7);color:#f6d9e6;background:rgba(240,143,182,.12)}',
        '.nexus-try-on-act.is-on{border-color:rgba(34,211,238,.75);background:rgba(34,211,238,.13)}',
        '.nexus-try-on-act:disabled,.nexus-try-on-chip:disabled,.nexus-try-on-card:disabled{opacity:.42;cursor:default}',
        '.nexus-try-on-strip{display:flex;gap:.4rem;overflow-x:auto;padding:.1rem .1rem .35rem;margin:0 0 .35rem;',
        'scroll-snap-type:x proximity;overscroll-behavior-x:contain;text-align:left}',
        '.nexus-try-on-card{position:relative;flex:0 0 4.5rem;min-width:0;display:flex;flex-direction:column;gap:.2rem;',
        'padding:.3rem;border-radius:10px;cursor:pointer;scroll-snap-align:start;background:rgba(255,255,255,.045);',
        'border:1px solid rgba(255,255,255,.09);color:#e8ecf2;font:inherit;text-align:left;transition:background .14s ease,border-color .14s ease}',
        '.nexus-try-on-card:hover{background:rgba(34,211,238,.1)}',
        '.nexus-try-on-card[aria-pressed="true"]{border-color:rgba(34,211,238,.8);background:rgba(34,211,238,.14)}',
        '.nexus-try-on-card.is-going{border-style:dashed;border-color:rgba(34,211,238,.6)}',
        '.nexus-try-on-card.is-new{justify-content:center;align-items:center;color:#7fd6e8}',
        '.nexus-try-on-thumb{width:100%;aspect-ratio:1/1;object-fit:cover;object-position:center 30%;border-radius:7px;display:grid;',
        'place-items:center;background:rgba(255,255,255,.05);font-size:1.4rem}',
        '.nexus-try-on-name{font-size:.7rem;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.nexus-try-on-heart{position:absolute;top:.4rem;right:.4rem;font-size:.75rem;color:#f08fb6;text-shadow:0 1px 2px #000}',
        '.nexus-try-on-fit{font-size:.62rem;color:#7fd6a2}.nexus-try-on-fit.is-bad{color:#e8b04a}',
        '.nexus-try-on-empty,.nexus-try-on-prompt{margin:.2rem 0 .6rem;font-size:.84rem;color:#a9b3c1}',
        '.nexus-try-on-tabs{display:flex;justify-content:center;gap:.25rem;margin:0 0 .45rem}',
        '.nexus-try-on-tab{padding:.32rem .6rem;border-radius:999px;cursor:pointer;background:none;color:#a9b3c1;',
        'border:1px solid transparent;font:600 .7rem/1 inherit;letter-spacing:.04em}',
        '.nexus-try-on-tab[aria-selected="true"]{color:#e8ecf2;border-color:rgba(34,211,238,.55);background:rgba(34,211,238,.1)}',
        '.nexus-try-on-tab.is-private[aria-selected="true"]{border-color:rgba(240,143,182,.6);background:rgba(240,143,182,.1)}',
        '.nexus-try-on-composer{display:flex;gap:.35rem;margin:0 0 .35rem}',
        '.nexus-try-on-composer input{flex:1;min-width:0;padding:.5rem .7rem;border-radius:10px;',
        'border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#e8ecf2;font:inherit;font-size:.84rem}',
        '.nexus-try-on-composer input:focus{outline:none;border-color:rgba(34,211,238,.7)}',
        '.nexus-try-on-chip{padding:.4rem .62rem;border-radius:999px;cursor:pointer;font:500 .74rem/1 inherit;',
        'color:#d9eef3;background:rgba(34,211,238,.07);border:1px solid rgba(34,211,238,.3)}',
        '.nexus-try-on-chip.is-private{color:#f6d9e6;background:rgba(240,143,182,.1);border-color:rgba(240,143,182,.4)}',
        '.nexus-try-on-chips{margin:0 0 .4rem}',
        '.nexus-try-on-ask{margin:0 0 .55rem}.nexus-try-on-ask p{margin:0 0 .35rem;font-size:.8rem;color:#c9d3df}',
        '.nexus-try-on-progress{margin:.1rem 0 .55rem;padding:.5rem .6rem;border-radius:10px;background:rgba(255,255,255,.04)}',
        '.nexus-try-on-stages{list-style:none;margin:0 0 .3rem;padding:0;display:flex;justify-content:center;gap:.9rem;',
        'font-size:.66rem;font-weight:700;letter-spacing:.14em;color:#5b6575}',
        '.nexus-try-on-stages li.is-done{color:#7fd6a2}.nexus-try-on-stages li.is-active{color:#22d3ee}',
        '.nexus-try-on-progress-line{margin:0;font-size:.8rem;color:#c9d3df}',
        '.nexus-try-on-steps{list-style:none;margin:.35rem 0 0;padding:0;display:grid;gap:.15rem;font-size:.72rem;color:#a9b3c1;text-align:left}',
        '.nexus-try-on-steps li::before{content:"○";display:inline-block;width:1.1rem;color:#5b6575}',
        '.nexus-try-on-steps li.is-done::before{content:"✓";color:#7fd6a2}',
        '.nexus-try-on-steps li.is-active{color:#e8ecf2}.nexus-try-on-steps li.is-active::before{content:"●";color:#22d3ee}',
        '.nexus-try-on-note{margin:0 0 .35rem;font-size:.72rem;color:#7d8797}',
        '.nexus-try-on-error{margin:.2rem 0 .5rem;font-size:.8rem;color:#f0a38f}',
        '.nexus-try-on-primary{display:block;width:100%;padding:.58rem;border:0;border-radius:10px;cursor:pointer;margin:.1rem 0 0;',
        'background:linear-gradient(120deg,#22d3ee,#2aa7c9);color:#061018;font:700 .82rem/1 inherit;letter-spacing:.06em}',
        '.nexus-try-on-primary:disabled{opacity:.42;cursor:default}',
        '.nexus-try-on-foot{display:flex;justify-content:space-between;align-items:center;gap:.5rem;margin:0 0 .25rem}',
        '#nexus-try-on-view .nexus-bd-together-cancel{margin-top:.35rem}',
        '.nexus-try-on-link{background:none;border:0;padding:.25rem 0;color:#7fb7c9;font:inherit;font-size:.76rem;cursor:pointer}',
        '.nexus-try-on-link:disabled{opacity:.5;cursor:default}',
        '.nexus-try-on-menu{margin:0 0 .55rem;padding:.55rem .65rem;border-radius:10px;text-align:left;font-size:.78rem;',
        'color:#a9b3c1;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.08);display:grid;gap:.3rem}',
        '.nexus-try-on-file{display:none}',
        '.nexus-try-on-pack{display:flex;justify-content:space-between;gap:.5rem;align-items:center}',
        '.nexus-try-on-import-summary{margin:.1rem 0 .5rem;padding-left:1.1rem;display:grid;gap:.15rem;color:#c9d3df}',
        '.nexus-try-on-import-actions{display:grid;grid-template-columns:1fr 1fr;gap:.5rem}',
        '.nexus-try-on-step{padding:.55rem;border-radius:9px;cursor:pointer;background:rgba(255,255,255,.05);',
        'border:1px solid rgba(255,255,255,.12);color:#e8ecf2;font:600 .8rem/1 inherit}',
        '.nexus-try-on-studio{color:#7fb7c9}',
        '.nexus-try-on-card:focus-visible,.nexus-try-on-primary:focus-visible,.nexus-try-on-act:focus-visible,',
        '.nexus-try-on-chip:focus-visible,.nexus-try-on-tab:focus-visible,.nexus-try-on-step:focus-visible',
        '{outline:2px solid var(--accent-cyan,#22d3ee);outline-offset:2px}',
        '.nexus-try-on-live{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}',
        '@media (max-width:640px){#nexus-try-on-view{position:fixed;z-index:1000;left:0;right:0;width:auto;transform:none;',
        'bottom:var(--nexus-composer-inset,calc(88px + env(safe-area-inset-bottom,0px)));',
        'max-height:min(62dvh,calc(100dvh - var(--nexus-composer-inset,88px) - 4rem));',
        'border-radius:16px 16px 0 0;border-left:none;border-right:none;border-bottom:none;',
        'padding-bottom:max(.9rem,env(safe-area-inset-bottom,0px));overscroll-behavior:contain}',
        '.nexus-try-on-card{flex-basis:4.4rem}}',
        '@media (prefers-reduced-motion:reduce){.nexus-try-on-card{transition:none}',
        '.nexus-try-on-stage.is-revealing .nexus-try-on-current,.nexus-try-on-flash,.nexus-try-on-react{animation:none}}',
    ].join('');

    function h(doc, tag, props, children) {
        var node = doc.createElement(tag);
        Object.keys(props || {}).forEach(function (key) {
            var value = props[key];
            if (value === undefined || value === null || value === false) return;
            if (key === 'class') node.className = value;
            else if (key === 'text') node.textContent = value;
            else if (key.indexOf('on') === 0) node.addEventListener(key.slice(2), value);
            else node.setAttribute(key, value === true ? '' : value);
        });
        (children || []).forEach(function (child) {
            if (child) node.appendChild(child);
        });
        return node;
    }

    function reducedMotion(doc) {
        var win = doc && doc.defaultView;
        try {
            return Boolean(win && win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
        } catch (_) {
            return false;
        }
    }

    class TryOnView {
        /**
         * options.doc, options.session (TryOnSession), options.generator (TryOnGenerator),
         * options.reasons (TryOnReasons), options.intent (TryOnIntent),
         * options.reactions (TryOnReactions), options.studioUrl, options.onClose(why),
         * options.importer (WardrobeImporter, W14), options.onImported(),
         * options.turn ({toggle(), reset()} — turns her round; absent hides Turn),
         * options.timers, options.random   injected for tests
         */
        constructor(options) {
            options = options || {};
            this.doc = options.doc || global.document;
            this.session = options.session;
            this.generator = options.generator || null;
            this.Reasons = options.reasons || global.NEXUS_TRY_ON_REASONS;
            this.Intent = options.intent || global.NEXUS_TRY_ON_INTENT;
            this.Reactions = options.reactions || global.NEXUS_TRY_ON_REACTIONS || null;
            this.studioUrl = options.studioUrl || null;
            this.onClose = options.onClose || function () {};
            this.turner = options.turn || null;
            this.random = options.random || Math.random;
            this.timers = options.timers || {
                setTimeout: function (fn, ms) {
                    return setTimeout(fn, ms);
                },
                clearTimeout: function (id) {
                    clearTimeout(id);
                },
            };
            // W14. Importing a wardrobe pack: nothing is stored until the person has read what
            // the pack is and said yes, so `prepared` sits between the file and the store.
            this.importer = options.importer || null;
            this.onImported = options.onImported || function () {};
            this.importState = null; // null | {busy} | {prepared} | {error}
            this.packs = [];
            this.menuOpen = false;
            this.root = null;
            this.loading = true;
            this.creating = false;
            this.progress = null;
            this.details = false;
            this.createError = null;
            this.notice = null; // a one-line answer to something typed ("She's already wearing that.")
            this.ask = null; // {question, options} from TryOnIntent
            this.reaction = null; // {line, actions}, for a few seconds
            this.draft = '';
            this.category = 'for-you';
            this.compareMenu = false;
            this.turned = false;
            this.collapsed = false; // the remote bar: her look in full view, the controls in one row
            this._keepOpen = false; // the person asked for the full sheet: stop collapsing it for them
            this._abort = null;
            this._seenLanded = 0;
            this._wears = 0;
            this._made = null; // the look just made, so its landing gets the "made for me" line
            this._revealNext = false;
            // W10. What private mode unlocks for her: {mode: off | locked | open}, from TryOnPrivate.
            this.privateState = { mode: 'off' };
            this._onKey = this._onKey.bind(this);
        }

        mount(host) {
            if (!this.doc) return null;
            if (!this.doc.getElementById(STYLE_ID)) {
                var style = this.doc.createElement('style');
                style.id = STYLE_ID;
                style.textContent = CSS;
                (this.doc.head || this.doc.documentElement).appendChild(style);
            }
            var existing = this.doc.getElementById(ROOT_ID);
            if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
            this.root = h(this.doc, 'div', {
                id: ROOT_ID,
                role: 'dialog',
                'aria-modal': 'true',
                'aria-label': 'Try-On',
            });
            this.host = host || null;
            var parent = host || this.doc.body;
            if (!host) this.root.classList.add('is-floating');
            parent.appendChild(this.root);
            this.root.addEventListener('keydown', this._onKey);
            this.render();
            this._loadPacks();
            var first = this.root.querySelector('.nexus-try-on-card:not([disabled]), button:not([disabled]), input');
            if (first) first.focus();
            return this.root;
        }

        unmount() {
            if (this._abort) this._abort.abort();
            if (this._reactionTimer) this.timers.clearTimeout(this._reactionTimer);
            if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
            this.root = null;
        }

        /** W10. Private mode's answer for this avatar (TryOnPrivate.evaluate). */
        setPrivate(state) {
            this.privateState = state || { mode: 'off' };
            if (this.privateState.mode === 'off' && this.category === 'private') this.category = 'for-you';
            this.render();
        }

        setLoading(loading) {
            this.loading = Boolean(loading);
            this.render();
        }

        _canCreate() {
            return Boolean(this.generator && this.generator.availability && this.generator.availability().ok);
        }

        _canBuildOn() {
            if (!this._canCreate() || !this.generator.identity) return false;
            try {
                return this.generator.identity().kind === 'library';
            } catch (_) {
                return false;
            }
        }

        // ------------------------------------------------------------ render
        render() {
            if (!this.root) return;
            var state = this.session.state();
            this._noticeLanding(state);
            var doc = this.doc;
            var parts = [this._head(state), this._stage(state)];
            if (this.collapsed && state.began) {
                if (this.reaction) parts.push(this._reaction());
                return this._paint(state, parts.concat(this._remote(state)));
            }
            if (this.reaction) parts.push(this._reaction());
            if (state.began) parts.push(this._actions(state));
            if (state.error) parts.push(h(doc, 'p', { class: 'nexus-try-on-error', role: 'alert', text: state.error }));
            parts.push(this._strip(state));
            if (this.creating) parts.push(this._progress());
            if (this.createError) {
                parts.push(h(doc, 'p', { class: 'nexus-try-on-error', role: 'alert', text: this.createError }));
            }
            var tabs = this._tabs();
            if (tabs) parts.push(tabs);
            parts.push(this._composer());
            // Without Forge the composer already says so; the same answer twice is noise.
            var quiet = Boolean(this.Intent) && this.notice === this.Intent.UNAVAILABLE && !this._canCreate();
            if (this.notice && !quiet) parts.push(h(doc, 'p', { class: 'nexus-try-on-note', text: this.notice }));
            if (this.ask) parts.push(this._ask());
            parts.push(this._chips(state));
            parts.push(this._foot(state));
            if (this.menuOpen) parts.push(this._menu());
            if (state.began) {
                parts.push(
                    h(doc, 'button', {
                        type: 'button',
                        class: 'nexus-try-on-primary',
                        'data-key': 'keep',
                        disabled: !state.look || state.busy,
                        text: state.look ? '♥ KEEP THIS LOOK' : 'KEEP THIS LOOK',
                        onclick: this.keep.bind(this),
                    })
                );
            }
            parts.push(
                h(doc, 'button', {
                    type: 'button',
                    class: 'nexus-bd-together-cancel',
                    'data-key': state.began ? 'end' : 'back',
                    text: state.began ? 'End haul' : 'Back',
                    onclick: function () {
                        this.close(state.began ? 'ended' : 'back');
                    }.bind(this),
                })
            );
            this._paint(state, parts);
        }

        _paint(state, parts) {
            var doc = this.doc;
            var live = h(doc, 'div', { class: 'nexus-try-on-live', 'aria-live': 'polite' });
            live.textContent = this._announcement(state);
            var focusedKey =
                doc.activeElement && doc.activeElement.getAttribute ? doc.activeElement.getAttribute('data-key') : null;
            var scroll = this.root.querySelector('.nexus-try-on-strip');
            var scrollLeft = scroll ? scroll.scrollLeft : 0;
            this.root.replaceChildren(h(doc, 'div', {}, parts), live);
            var strip = this.root.querySelector('.nexus-try-on-strip');
            if (strip) strip.scrollLeft = scrollLeft;
            if (focusedKey) {
                var again = this.root.querySelector('[data-key="' + focusedKey + '"]');
                if (again) again.focus();
            }
        }

        /**
         * "TOGETHER · TRY-ON", and once she has something on, Hide: the sheet shrinks to one
         * row so the look is seen whole. A remote that covers the show defeats the reveal.
         */
        _head(state) {
            var doc = this.doc;
            var self = this;
            return h(doc, 'div', { class: 'nexus-try-on-head' }, [
                h(doc, 'span', { 'aria-hidden': 'true', style: 'width:2.6rem' }),
                h(doc, 'p', { class: 'nexus-bd-together-head', text: 'TOGETHER · TRY-ON' }),
                state.began
                    ? h(doc, 'button', {
                          type: 'button',
                          class: 'nexus-try-on-hide',
                          'data-key': 'collapse',
                          'aria-expanded': this.collapsed ? 'false' : 'true',
                          text: this.collapsed ? 'More ▴' : 'Hide ▾',
                          onclick: function () {
                              self.collapsed = !self.collapsed;
                              self._keepOpen = !self.collapsed;
                              self.render();
                          },
                      })
                    : h(doc, 'span', { 'aria-hidden': 'true', style: 'width:2.6rem' }),
            ]);
        }

        /** The collapsed remote: previous, save, compare, turn, next. */
        _remote(state) {
            var doc = this.doc;
            var self = this;
            var button = function (key, text, label, run, extra) {
                return h(
                    doc,
                    'button',
                    Object.assign(
                        {
                            type: 'button',
                            class: 'nexus-try-on-act',
                            'data-key': key,
                            'aria-label': label,
                            text: text,
                            onclick: run,
                        },
                        extra || {}
                    )
                );
            };
            return [
                h(doc, 'div', { class: 'nexus-try-on-remote' }, [
                    button('previous', '‹', 'Previous look', function () {
                        self._step(-1);
                    }),
                    button('favorite', state.favorite ? '♥' : '♡', 'Save', this.favorite.bind(this), {
                        'aria-pressed': state.favorite ? 'true' : 'false',
                        disabled: !state.look,
                    }),
                    button(
                        'compare',
                        '◐',
                        state.comparing ? 'Back to the current look' : 'Compare',
                        function () {
                            if (state.comparing) return self.compare(null);
                            return self.compare(state.canCompare.previous ? 'previous' : 'original');
                        },
                        { disabled: !state.comparing && !state.canCompare.previous && !state.canCompare.original }
                    ),
                    this.turner ? button('turn', '↻', 'Turn', this.turn.bind(this)) : null,
                    button('next', '›', 'Next look', function () {
                        self._step(1);
                    }),
                ]),
            ];
        }

        _announcement(state) {
            if (state.error) return state.error;
            if (this.createError) return this.createError;
            if (this.creating && this.progress && this.progress.stage) return this.progress.stage.line;
            if (this.reaction) return this.reaction.line;
            if (state.comparing)
                return 'Showing ' + (state.comparing === 'original' ? 'the original' : 'the previous look');
            if (state.look) return state.look.name;
            return '';
        }

        /** A look landed since the last render: play the reveal, maybe let her react. */
        _noticeLanding(state) {
            if (state.landed === this._seenLanded) return;
            this._seenLanded = state.landed;
            var landing = state.lastLanding || {};
            var look = landing.look;
            if (!look || look.original || landing.cause === 'compare' || landing.cause === 'compare-end') return;
            this.turned = false; // a new avatar file faces the camera again
            this._revealNext = true; // the next stage drawn plays the reveal, once
            this._flash();
            // The reveal is for seeing her, and the full sheet covers most of her: it folds to
            // the one-row remote as she arrives — unless the person has asked for it open, or is
            // half-way through typing, in which case taking the composer away would be the
            // surprise. (Focus alone is not typing: the composer has it from the moment the
            // sheet opens.)
            var typing = Boolean(String(this.draft || '').trim());
            if (!this._keepOpen && !typing && !this.menuOpen) this.collapsed = true;
            if (landing.cause === 'wear') this._wears += 1;
            if (!this.Reactions) return;
            var generated = Boolean(this._made && this._made.key === this._key(look));
            var history = state.history;
            var previous = history.length >= 2 ? this.session.history[history.length - 2] : null;
            var reaction = this.Reactions.react(
                {
                    look: look,
                    previous: previous && !previous.original ? previous : null,
                    cause: landing.cause,
                    generated: generated,
                    change: generated ? this._made.change : null,
                    wears: generated ? 0 : this._wears,
                },
                this.random
            );
            if (generated) this._made = null;
            if (reaction) this._showReaction(reaction);
        }

        _showReaction(reaction) {
            this.reaction = reaction;
            if (this._reactionTimer) this.timers.clearTimeout(this._reactionTimer);
            this._reactionTimer = this.timers.setTimeout(
                function () {
                    this._reactionTimer = null;
                    this.reaction = null;
                    this.render();
                }.bind(this),
                (this.Reactions && this.Reactions.SHOW_FOR_MS) || 6000
            );
        }

        /** The reveal's light, over the avatar card — once per arrival, never on a compare. */
        _flash() {
            var card = this.host;
            if (!card || reducedMotion(this.doc)) return;
            var flash = h(this.doc, 'div', { class: 'nexus-try-on-flash', 'aria-hidden': 'true' });
            card.appendChild(flash);
            this.timers.setTimeout(function () {
                if (flash.parentNode) flash.parentNode.removeChild(flash);
            }, REVEAL_MS + 100);
        }

        _stage(state) {
            var doc = this.doc;
            var self = this;
            var children = [];
            var revealing = this._revealNext;
            this._revealNext = false;
            if (!state.began && !state.going) {
                children.push(h(doc, 'p', { class: 'nexus-try-on-current', text: 'What should she try?' }));
            } else {
                var showing = state.going || state.worn || {};
                var name = state.comparing
                    ? state.comparing === 'original'
                        ? 'Original'
                        : (showing && showing.name) || 'Previous look'
                    : (state.going || state.look || {}).name || 'Original';
                children.push(h(doc, 'p', { class: 'nexus-try-on-current', text: name }));
                var line;
                if (state.busy) line = 'Putting it on…';
                else if (state.comparing)
                    line = state.comparing === 'original' ? 'Original ↔ current' : 'Previous ↔ current';
                else if (state.playing) line = 'Show mode';
                else if (state.look && state.position !== -1)
                    line = 'Look ' + (state.position + 1) + ' of ' + state.total;
                else if (!state.look) line = 'How she started';
                if (line) children.push(h(doc, 'p', { class: 'nexus-try-on-counter', text: line }));
                var look = state.look;
                if (look && look.fitPassed === false && !state.comparing) {
                    children.push(h(doc, 'p', { class: 'nexus-try-on-fit is-bad', text: 'Fit needs work' }));
                }
            }
            var stage = h(doc, 'div', { class: 'nexus-try-on-stage' + (revealing ? ' is-revealing' : '') }, children);
            // Swipe the stage to step through her looks, as the arrow keys do.
            var startX = null;
            stage.addEventListener('pointerdown', function (event) {
                startX = event.clientX;
            });
            stage.addEventListener('pointerup', function (event) {
                if (startX === null) return;
                var dx = event.clientX - startX;
                startX = null;
                if (Math.abs(dx) > 40) self._step(dx < 0 ? 1 : -1);
            });
            return stage;
        }

        _reaction() {
            var doc = this.doc;
            var self = this;
            var reaction = this.reaction;
            var buttons = reaction.actions
                .filter(function (action) {
                    return action.id !== 'turn' || self.turner;
                })
                .map(function (action) {
                    return h(doc, 'button', {
                        type: 'button',
                        class: 'nexus-try-on-chip',
                        'data-key': 'react:' + action.id,
                        text: action.label,
                        onclick: function () {
                            self.reaction = null;
                            self._reactionAction(action.id);
                        },
                    });
                });
            return h(doc, 'div', { class: 'nexus-try-on-react', role: 'status' }, [
                h(doc, 'p', { text: '“' + reaction.line + '”' }),
                h(doc, 'div', { class: 'nexus-try-on-row' }, buttons),
            ]);
        }

        _reactionAction(id) {
            if (id === 'turn') return this.turn();
            if (id === 'keep') return this.keep();
            if (id === 'favorite') return this.favorite();
            if (id === 'compare') return this.compare('previous');
            if (id === 'color') return this.say('change colour');
            return null;
        }

        _actions(state) {
            var doc = this.doc;
            var self = this;
            var look = state.look;
            var canPrev = state.canCompare.previous;
            var canOrig = state.canCompare.original;
            var compare = h(doc, 'button', {
                type: 'button',
                class: 'nexus-try-on-act' + (state.comparing ? ' is-on' : ''),
                'data-key': 'compare',
                disabled: !state.comparing && !canPrev && !canOrig,
                'aria-label': state.comparing ? 'Back to the current look' : 'Compare',
                text: state.comparing ? '◐ Back' : '◐ Compare',
                onclick: function () {
                    if (state.comparing) return self.compare(null);
                    if (canPrev && canOrig) {
                        self.compareMenu = !self.compareMenu;
                        return self.render();
                    }
                    return self.compare(canPrev ? 'previous' : 'original');
                },
            });
            var row = [
                h(doc, 'button', {
                    type: 'button',
                    class: 'nexus-try-on-act',
                    'data-key': 'favorite',
                    'aria-pressed': state.favorite ? 'true' : 'false',
                    disabled: !look,
                    text: state.favorite ? '♥ Saved' : '♡ Save',
                    onclick: this.favorite.bind(this),
                }),
                compare,
                this.turner
                    ? h(doc, 'button', {
                          type: 'button',
                          class: 'nexus-try-on-act' + (this.turned ? ' is-on' : ''),
                          'data-key': 'turn',
                          disabled: state.busy,
                          text: '↻ Turn',
                          onclick: this.turn.bind(this),
                      })
                    : null,
                h(doc, 'button', {
                    type: 'button',
                    class: 'nexus-try-on-act',
                    'data-key': 'undo',
                    disabled: !state.canUndo,
                    text: '↶ Undo',
                    onclick: function () {
                        self.session.undo();
                    },
                }),
            ];
            var box = h(doc, 'div', {}, [
                h(
                    doc,
                    'div',
                    {
                        class: 'nexus-try-on-actions',
                        style: this.turner ? null : 'grid-template-columns:repeat(3,minmax(0,1fr))',
                    },
                    row
                ),
            ]);
            if (this.compareMenu && !state.comparing) {
                box.appendChild(
                    h(doc, 'div', { class: 'nexus-try-on-row nexus-try-on-chips' }, [
                        h(doc, 'button', {
                            type: 'button',
                            class: 'nexus-try-on-chip',
                            'data-key': 'compare-original',
                            text: 'Original ↔ Current',
                            onclick: function () {
                                self.compare('original');
                            },
                        }),
                        h(doc, 'button', {
                            type: 'button',
                            class: 'nexus-try-on-chip',
                            'data-key': 'compare-previous',
                            text: 'Previous ↔ Current',
                            onclick: function () {
                                self.compare('previous');
                            },
                        }),
                    ])
                );
            }
            return box;
        }

        _key(look) {
            // W11. `key` first: an imported look may share a built-in look's id on the same avatar.
            return (look && (look.key || look.id || look.vrmUrl)) || '';
        }

        _strip(state) {
            var doc = this.doc;
            var self = this;
            if (this.loading) return h(doc, 'p', { class: 'nexus-try-on-empty', text: 'Opening her wardrobe…' });
            var headKey = state.look ? this._key(state.look) : null;
            var goingKey = state.going && !state.going.original ? this._key(state.going) : null;
            var cards = state.looks.map(function (look) {
                return self._card(look, {
                    on: self._key(look) === headKey,
                    going: self._key(look) === goingKey && goingKey !== headKey,
                    favorite: state.favorites.indexOf(self._key(look)) !== -1,
                });
            });
            if (this.creating) {
                cards.push(
                    h(doc, 'div', { class: 'nexus-try-on-card is-new is-going', 'aria-hidden': 'true' }, [
                        h(doc, 'span', { class: 'nexus-try-on-thumb', text: '✨' }),
                        h(doc, 'span', {
                            class: 'nexus-try-on-name',
                            text: (this.progress && this.progress.stage && this.progress.stage.label) || 'DESIGNING',
                        }),
                    ])
                );
            }
            cards.push(
                h(
                    doc,
                    'button',
                    {
                        type: 'button',
                        class: 'nexus-try-on-card is-new',
                        'data-key': 'new',
                        'aria-label': 'New look',
                        onclick: function () {
                            self.notice = self._canCreate() || !self.Intent ? null : self.Intent.UNAVAILABLE;
                            self.render();
                            var input = self.root && self.root.querySelector('[data-key="prompt"]');
                            if (input) input.focus();
                        },
                    },
                    [
                        h(doc, 'span', { class: 'nexus-try-on-thumb', 'aria-hidden': 'true', text: '+' }),
                        h(doc, 'span', { class: 'nexus-try-on-name', text: 'New' }),
                    ]
                )
            );
            var strip = h(doc, 'div', { class: 'nexus-try-on-strip', role: 'group', 'aria-label': 'Her looks' }, cards);
            if (!state.looks.length && !this.creating) {
                return h(doc, 'div', {}, [
                    h(doc, 'p', { class: 'nexus-try-on-empty', text: 'No looks for her yet.' }),
                    strip,
                ]);
            }
            return strip;
        }

        _card(look, flags) {
            var doc = this.doc;
            var self = this;
            var key = this._key(look);
            var thumb = look.previewUrl
                ? h(doc, 'img', { class: 'nexus-try-on-thumb', src: look.previewUrl, alt: '', loading: 'lazy' })
                : h(doc, 'span', { class: 'nexus-try-on-thumb', 'aria-hidden': 'true', text: '👗' });
            return h(
                doc,
                'button',
                {
                    type: 'button',
                    class: 'nexus-try-on-card' + (flags.going ? ' is-going' : ''),
                    'aria-pressed': flags.on ? 'true' : 'false',
                    'data-key': 'look:' + key,
                    title: look.name || '',
                    onclick: function () {
                        self.wear(look);
                    },
                },
                [
                    thumb,
                    flags.favorite
                        ? h(doc, 'span', { class: 'nexus-try-on-heart', 'aria-label': 'Saved', text: '♥' })
                        : null,
                    h(doc, 'span', { class: 'nexus-try-on-name', text: look.name || 'Look' }),
                    look.fitPassed === false
                        ? h(doc, 'span', { class: 'nexus-try-on-fit is-bad', text: 'fit needs work' })
                        : null,
                ]
            );
        }

        _tabs() {
            if (!this._canCreate()) return null;
            var doc = this.doc;
            var self = this;
            var privateOn = this.privateState && this.privateState.mode !== 'off';
            var tabs = this.Intent.CATEGORIES.filter(function (category) {
                return !category.private || privateOn;
            });
            return h(
                doc,
                'div',
                { class: 'nexus-try-on-tabs', role: 'tablist', 'aria-label': 'Suggestions' },
                tabs.map(function (category) {
                    return h(doc, 'button', {
                        type: 'button',
                        role: 'tab',
                        class: 'nexus-try-on-tab' + (category.private ? ' is-private' : ''),
                        'aria-selected': self.category === category.id ? 'true' : 'false',
                        'data-key': 'tab:' + category.id,
                        text: category.label,
                        onclick: function () {
                            self.category = category.id;
                            self.render();
                        },
                    });
                })
            );
        }

        _composer() {
            var doc = this.doc;
            var self = this;
            var canCreate = this._canCreate();
            var input = h(doc, 'input', {
                type: 'text',
                maxlength: '300',
                'data-key': 'prompt',
                'aria-label': 'Tell me what to change',
                placeholder: this.session.state().look
                    ? 'Tell me what to change…'
                    : canCreate
                      ? 'or tell me: “Try a black evening dress…”'
                      : 'Say next, go back, compare…',
                disabled: this.creating,
            });
            input.value = this.draft;
            input.addEventListener('input', function () {
                self.draft = input.value;
            });
            var form = h(
                doc,
                'form',
                {
                    class: 'nexus-try-on-composer',
                    onsubmit: function (event) {
                        event.preventDefault();
                        self.say(input.value);
                    },
                },
                [
                    input,
                    this.creating
                        ? h(doc, 'button', {
                              type: 'button',
                              class: 'nexus-bd-together-option is-stop',
                              'data-key': 'cancel-create',
                              text: 'Cancel',
                              onclick: function () {
                                  if (self._abort) self._abort.abort();
                              },
                          })
                        : h(doc, 'button', {
                              type: 'submit',
                              class: 'nexus-bd-together-option',
                              'data-key': 'send',
                              'aria-label': 'Send',
                              text: '→',
                          }),
                ]
            );
            if (canCreate) return form;
            // No Forge: quiet, below the composer — her saved looks are the whole show.
            return h(doc, 'div', {}, [
                form,
                h(doc, 'p', {
                    class: 'nexus-try-on-note',
                    'data-key': 'unavailable',
                    text: 'Creating new looks unavailable',
                }),
            ]);
        }

        _ask() {
            var doc = this.doc;
            var self = this;
            return h(doc, 'div', { class: 'nexus-try-on-ask' }, [
                h(doc, 'p', { text: this.ask.question }),
                h(
                    doc,
                    'div',
                    { class: 'nexus-try-on-row' },
                    this.ask.options.map(function (option) {
                        return h(doc, 'button', {
                            type: 'button',
                            class: 'nexus-try-on-chip',
                            'data-key': 'ask:' + option,
                            disabled: self.creating,
                            text: option,
                            onclick: function () {
                                self.say(option);
                            },
                        });
                    })
                ),
            ]);
        }

        /** Quick chips: for a look she has on, change a part of it; before that, the category's picks. */
        _chips(state) {
            var doc = this.doc;
            var self = this;
            var canCreate = this._canCreate();
            var chips = [];
            var chip = function (key, text, run, extra) {
                return h(doc, 'button', {
                    type: 'button',
                    class: 'nexus-try-on-chip' + (extra || ''),
                    'data-key': key,
                    disabled: self.creating,
                    text: text,
                    onclick: run,
                });
            };
            if (canCreate && this.category === 'private') {
                if (this.privateState.mode === 'locked') {
                    return h(doc, 'p', { class: 'nexus-try-on-note', text: this.privateState.why || '' });
                }
                this.Intent.suggestions('private', { privatePicks: this.privateState.picks }).forEach(function (pick) {
                    chips.push(
                        chip(
                            'pick:' + pick.label,
                            pick.label,
                            function () {
                                self.create({
                                    prompt: pick.prompt,
                                    mode: 'fresh',
                                    baseLookId: null,
                                    label: pick.label,
                                });
                            },
                            ' is-private'
                        )
                    );
                });
            } else if (canCreate && state.look && this.category === 'for-you') {
                var seen = {};
                this.Intent.segments(this.Intent.promptOf(state.look)).forEach(function (part) {
                    var slot = self.Intent.slotOf(part);
                    if (!slot || seen[slot] || ['top', 'bottom', 'dress'].indexOf(slot) === -1) return;
                    seen[slot] = true;
                    var word = { top: 'top', bottom: 'bottoms', dress: 'dress' }[slot];
                    chips.push(
                        chip('change:' + slot, 'Change ' + word, function () {
                            self.say('change the ' + word);
                        })
                    );
                });
                chips.push(
                    chip('change:colour', 'Change colour', function () {
                        self.say('change colour');
                    })
                );
            } else if (canCreate) {
                this.Intent.suggestions(this.category).forEach(function (pick) {
                    chips.push(
                        chip('pick:' + pick.label, pick.label, function () {
                            self.create({ prompt: pick.prompt, mode: 'fresh', baseLookId: null, label: pick.label });
                        })
                    );
                });
            }
            chips.push(
                chip('surprise', 'Surprise me', function () {
                    self.surprise();
                })
            );
            return h(doc, 'div', { class: 'nexus-try-on-row nexus-try-on-chips' }, chips);
        }

        _foot(state) {
            var doc = this.doc;
            var self = this;
            var playable = this.session.playlist().length >= 2;
            return h(doc, 'div', { class: 'nexus-try-on-foot' }, [
                h(doc, 'button', {
                    type: 'button',
                    class: 'nexus-try-on-link',
                    'data-key': 'play',
                    disabled: !playable && !state.playing,
                    'aria-pressed': state.playing ? 'true' : 'false',
                    text: state.playing
                        ? '❚❚ Pause show'
                        : state.favorites.length >= 2
                          ? '▶ Play favourites'
                          : '▶ Play haul',
                    onclick: function () {
                        if (state.playing) self.session.pause();
                        else self.session.play();
                    },
                }),
                h(doc, 'button', {
                    type: 'button',
                    class: 'nexus-try-on-link',
                    'data-key': 'wardrobe',
                    'aria-expanded': this.menuOpen ? 'true' : 'false',
                    text: 'Wardrobe ···',
                    onclick: function () {
                        self.menuOpen = !self.menuOpen;
                        self.render();
                    },
                }),
            ]);
        }

        _progress() {
            var doc = this.doc;
            var self = this;
            var progress = this.progress || (this.Reasons ? this.Reasons.progress('queued') : null);
            var stage = (progress && progress.stage) || { index: 0, line: 'Designing your change…' };
            var stages = (this.Reasons && this.Reasons.STAGES) || [];
            var box = h(doc, 'div', { class: 'nexus-try-on-progress', role: 'status' }, [
                h(
                    doc,
                    'ol',
                    { class: 'nexus-try-on-stages', 'aria-label': 'Progress' },
                    stages.map(function (item, i) {
                        return h(doc, 'li', {
                            class: i < stage.index ? 'is-done' : i === stage.index ? 'is-active' : '',
                            text: item.label,
                        });
                    })
                ),
                h(doc, 'p', { class: 'nexus-try-on-progress-line', text: stage.line }),
                h(doc, 'button', {
                    type: 'button',
                    class: 'nexus-try-on-link',
                    'data-key': 'details',
                    'aria-expanded': this.details ? 'true' : 'false',
                    text: this.details ? 'Details ▴' : 'Details ▾',
                    onclick: function () {
                        self.details = !self.details;
                        self.render();
                    },
                }),
            ]);
            if (this.details && progress) {
                box.appendChild(
                    h(
                        doc,
                        'ul',
                        { class: 'nexus-try-on-steps', 'aria-label': 'Forge steps' },
                        progress.steps.map(function (step) {
                            return h(doc, 'li', { class: 'is-' + step.status, text: step.label });
                        })
                    )
                );
            }
            return box;
        }

        // ------------------------------------------------------------ Wardrobe ··· (W14)
        async _loadPacks() {
            if (!this.importer) return;
            try {
                this.packs = await this.importer.list();
            } catch (error) {
                console.warn('[Try-On] imported packs could not be listed', error);
                this.packs = [];
            }
            this.render();
        }

        async _chooseFile(file) {
            if (!file || !this.importer) return;
            // What the pack is must be read before it is kept, so the menu shows it whatever
            // opened the file picker.
            this.menuOpen = true;
            this.importState = { busy: true };
            this.render();
            var prepared = await this.importer.prepare(file);
            this.importState = prepared.ok ? { prepared: prepared } : { error: prepared.problems };
            this.render();
        }

        async _commit() {
            var prepared = this.importState && this.importState.prepared;
            if (!prepared) return;
            this.importState = { busy: true };
            this.render();
            try {
                await prepared.commit();
                this.importState = null;
                this.onImported();
                await this._loadPacks();
            } catch (error) {
                this.importState = { error: [error.message || String(error)] };
                this.render();
            }
        }

        async _remove(id) {
            if (!this.importer) return;
            await this.importer.remove(id);
            this.onImported();
            await this._loadPacks();
        }

        /** Library management: import a pack, the packs kept in this browser, the Studio. */
        _menu() {
            var doc = this.doc;
            var self = this;
            var box = h(doc, 'div', { class: 'nexus-try-on-menu', role: 'group', 'aria-label': 'Wardrobe' });
            var state = this.importState;
            if (this.importer && state && state.prepared) {
                var sum = state.prepared.summary;
                var lines = [
                    sum.looks + (sum.looks === 1 ? ' look' : ' looks') + ' · ' + sum.name,
                    'Made for ' + (sum.avatars.join(', ') || 'any avatar'),
                    sum.verified ? 'Every file verified' : 'An older pack without hashes — kept as it is now',
                    sum.licences.length ? 'Licence: ' + sum.licences.join(', ') : 'No licence stated',
                ];
                if (sum.private) lines.push(sum.gated + ' private — shown only when private outfits are open for her');
                box.appendChild(
                    h(
                        doc,
                        'ul',
                        { class: 'nexus-try-on-import-summary' },
                        lines.map(function (line) {
                            return h(doc, 'li', { text: line });
                        })
                    )
                );
                box.appendChild(
                    h(doc, 'div', { class: 'nexus-try-on-import-actions' }, [
                        h(doc, 'button', {
                            type: 'button',
                            class: 'nexus-try-on-step',
                            'data-key': 'import-confirm',
                            text: 'Import ' + sum.looks + (sum.looks === 1 ? ' look' : ' looks'),
                            onclick: function () {
                                self._commit();
                            },
                        }),
                        h(doc, 'button', {
                            type: 'button',
                            class: 'nexus-try-on-step',
                            'data-key': 'import-cancel',
                            text: 'Cancel',
                            onclick: function () {
                                self.importState = null;
                                self.render();
                            },
                        }),
                    ])
                );
                return box;
            }
            if (this.importer) {
                var input = h(doc, 'input', {
                    type: 'file',
                    accept: '.zip,application/zip',
                    class: 'nexus-try-on-file',
                    'aria-label': 'Wardrobe pack file',
                    onchange: function (event) {
                        self._chooseFile(event.target.files && event.target.files[0]);
                    },
                });
                box.appendChild(input);
                box.appendChild(
                    h(doc, 'button', {
                        type: 'button',
                        class: 'nexus-try-on-link',
                        'data-key': 'import',
                        disabled: Boolean(state && state.busy),
                        text: state && state.busy ? 'Checking the pack…' : '＋ Import pack',
                        onclick: function () {
                            input.click();
                        },
                    })
                );
                if (state && state.error) {
                    box.appendChild(h(doc, 'p', { class: 'nexus-try-on-error', role: 'alert', text: state.error[0] }));
                }
                if (this.packs.length) box.appendChild(h(doc, 'span', { text: 'Packs in this browser' }));
                this.packs.forEach(function (pack) {
                    box.appendChild(
                        h(doc, 'div', { class: 'nexus-try-on-pack' }, [
                            h(doc, 'span', {
                                text: pack.name + ' · ' + pack.looks + (pack.looks === 1 ? ' look' : ' looks'),
                            }),
                            h(doc, 'button', {
                                type: 'button',
                                class: 'nexus-try-on-link',
                                'data-key': 'remove:' + pack.id,
                                'aria-label': 'Remove ' + pack.name,
                                text: 'Remove',
                                onclick: function () {
                                    self._remove(pack.id);
                                },
                            }),
                        ])
                    );
                });
            }
            if (this.studioUrl) {
                box.appendChild(
                    h(doc, 'a', {
                        class: 'nexus-try-on-link nexus-try-on-studio',
                        href: this.studioUrl,
                        target: '_blank',
                        rel: 'noopener',
                        text: 'Open Wardrobe Studio ↗',
                    })
                );
            }
            if (!box.childNodes.length) box.appendChild(h(doc, 'span', { text: 'Nothing to manage here yet.' }));
            return box;
        }

        // ------------------------------------------------------------ actions
        wear(look) {
            this.notice = null;
            this.ask = null;
            this.compareMenu = false;
            return this.session.wear(look);
        }

        favorite() {
            this.session.favorite();
            this.render();
        }

        compare(which) {
            this.compareMenu = false;
            var move = which ? this.session.compare(which) : this.session.compareEnd();
            this.render();
            return move;
        }

        turn() {
            if (!this.turner) return false;
            var turned = this.turner.toggle();
            this.turned = Boolean(turned);
            this.render();
            return turned;
        }

        keep() {
            var self = this;
            return this.session.keep().then(function (kept) {
                if (kept) self.close('kept');
                else self.render();
                return kept;
            });
        }

        _step(delta) {
            var self = this;
            var move = delta > 0 ? this.session.next() : this.session.previous();
            this.render();
            return Promise.resolve(move).then(function () {
                self.render();
            });
        }

        /** Something typed or tapped: TryOnIntent decides what it is, and this does it. */
        say(text) {
            var state = this.session.state();
            var intent = this.Intent.parse(text, {
                looks: state.looks,
                current: state.look,
                canCreate: this._canCreate(),
                canBuildOn: this._canBuildOn(),
                category: this.category,
            });
            this.notice = null;
            this.ask = null;
            this.createError = null;
            if (intent.kind !== 'ask' && intent.kind !== 'none') this.draft = '';
            // An answer — a question back, a sentence, a look being made — has to be seen.
            if (intent.kind === 'ask' || intent.kind === 'none' || intent.kind === 'create') this.collapsed = false;
            switch (intent.kind) {
                case 'command':
                    return this._command(intent);
                case 'wear':
                    this.render();
                    return this.wear(intent.look);
                case 'create':
                    return this.create(intent);
                case 'surprise':
                    return this.surprise();
                case 'ask':
                    this.ask = { question: intent.question, options: intent.options };
                    this.draft = '';
                    this.render();
                    return null;
                default:
                    this.notice = intent.why || null;
                    this.render();
                    return null;
            }
        }

        _command(intent) {
            var session = this.session;
            this.render();
            switch (intent.command) {
                case 'next':
                    return this._step(1);
                case 'previous':
                    return this._step(-1);
                case 'undo':
                    return session.undo();
                case 'compare':
                    if (!session.canCompare(intent.which)) {
                        this.notice =
                            intent.which === 'original'
                                ? 'She is in her original outfit already.'
                                : 'Nothing to compare with yet.';
                        this.render();
                        return null;
                    }
                    return this.compare(intent.which);
                case 'keep':
                    return this.keep();
                case 'favorite':
                    return this.favorite();
                case 'play':
                    if (!session.play()) {
                        this.notice = 'Show mode needs at least two looks.';
                        this.render();
                    }
                    return null;
                case 'pause':
                    session.pause();
                    return null;
                case 'turn':
                    return this.turn();
                case 'end':
                    return this.close(session.state().began ? 'ended' : 'back');
                default:
                    return null;
            }
        }

        /** "Surprise me": a new look from the category with Forge, else one of her own. */
        surprise() {
            var state = this.session.state();
            if (this._canCreate()) {
                var pick = this.Intent.surprise(this.category, {
                    current: state.look,
                    privatePicks: this.privateState && this.privateState.picks,
                    random: this.random,
                });
                if (pick)
                    return this.create({ prompt: pick.prompt, mode: 'fresh', baseLookId: null, label: pick.label });
            }
            var currentKey = state.look ? this._key(state.look) : null;
            var others = state.looks.filter(
                function (look) {
                    return this._key(look) !== currentKey;
                }.bind(this)
            );
            if (!others.length) {
                this.notice = 'No other looks to try yet.';
                this.render();
                return null;
            }
            return this.wear(others[Math.min(others.length - 1, Math.floor(this.random() * others.length))]);
        }

        /**
         * Make a look and put it on. `request` is TryOnIntent's create answer (or a plain
         * prompt string): {prompt, baseLookId, mode, slot}.
         */
        async create(request) {
            if (typeof request === 'string') request = { prompt: request, baseLookId: null, mode: 'fresh' };
            if (this.creating || !this.generator) return null;
            this.creating = true;
            this.collapsed = false; // DESIGNING · FITTING · READY is the wait; then the reveal folds it
            this.createError = null;
            this.notice = null;
            this.ask = null;
            this.progress = this.Reasons ? this.Reasons.progress('queued') : null;
            this._abort = typeof AbortController !== 'undefined' ? new AbortController() : null;
            this.render();
            var look = null;
            try {
                look = await this.generator.create(request.prompt, {
                    baseLookId: request.baseLookId || undefined,
                    signal: this._abort ? this._abort.signal : undefined,
                    onProgress: function (progress) {
                        this.progress = progress;
                        this.render();
                    }.bind(this),
                });
            } catch (error) {
                this.createError =
                    error && error.name === 'AbortError'
                        ? 'Stopped. Her outfit is unchanged.'
                        : (error && error.message) || 'That look could not be made.';
            } finally {
                this.creating = false;
                this._abort = null;
            }
            if (!look) {
                this.render();
                return null;
            }
            this.draft = '';
            this.session.add(look);
            this._made = { key: this._key(look), change: request.mode === 'change' ? { slot: request.slot } : null };
            this.render();
            // The reveal: a made look is put on at once — waiting for another tap is a step
            // that exists to be got past.
            await this.session.wear(look);
            return look;
        }

        close(why) {
            this.onClose(why || 'closed');
        }

        _onKey(event) {
            var state = this.session.state();
            if (event.key === 'Escape') {
                event.preventDefault();
                if (state.comparing) this.compare(null);
                else if (this.menuOpen) {
                    this.menuOpen = false;
                    this.render();
                } else if (!state.began) this.close('back'); // never ends a haul by surprise
                return;
            }
            var typing = event.target && event.target.tagName === 'INPUT';
            if (!typing && (event.key === 'ArrowRight' || event.key === 'ArrowLeft') && state.looks.length) {
                event.preventDefault();
                this._step(event.key === 'ArrowRight' ? 1 : -1);
                return;
            }
            if (event.key === 'Tab') {
                var focusable = Array.prototype.slice.call(
                    this.root.querySelectorAll('button:not([disabled]), input:not([disabled]), [href]')
                );
                if (!focusable.length) return;
                var first = focusable[0];
                var last = focusable[focusable.length - 1];
                if (event.shiftKey && this.doc.activeElement === first) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && this.doc.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                }
            }
        }
    }

    var api = { TryOnView: TryOnView, ROOT_ID: ROOT_ID, REVEAL_MS: REVEAL_MS };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_TRY_ON_VIEW = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
