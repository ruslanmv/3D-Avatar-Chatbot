/**
 * FC2. "Would black look better underneath?" — the chooser that answers it on her.
 *
 * The stylist (NEXUS) can only suggest; this card is where the person chooses. It opens from the
 * companion's `<wardrobe action="underneath"/>` once the person has agreed, or from the
 * "Underneath" chip on the current look (W18), and shows what she wears under the look she has
 * on as product cards — the colour, the pieces Forge made, and whether each colour is on,
 * suggested or already made — never a picture of her body: the avatar is the fully clothed view.
 *
 * W18. It is a pop-up: a bottom sheet on a phone, a centred card elsewhere, over a dimmed
 * stage. Mounted inline under the chat summary it scrolled out of a phone's view, read as part
 * of the conversation, and was reachable only by asking the companion; now it is a dialog
 * (focus moves in and back, Escape and the backdrop close it, never while Forge is working).
 *
 * What it promises, each a failure it prevents:
 *
 * - **Nothing is claimed early.** "Black is on" is written only when `TryOnView.underneath`
 *   answers ok, which it does only after the recoloured VRM has loaded and is the one she has
 *   on. Until then the card says what Forge is doing, in Forge's own job states.
 * - **Only the colour changes.** The request is Forge's recolour (FC2): the dress, the boots and
 *   every other garment are the look's own, byte for byte, and the pose is the viewer's.
 * - **Switching back is free.** The white version is still in the haul, so choosing white again
 *   wears it; Forge is asked only for a colour this outfit has not had yet.
 * - **A failure keeps her look.** The reason is shown, with Try again; the look she has on is
 *   the one she had.
 *
 * Exposes: window.NEXUS_TRY_ON_UNDERNEATH
 */
(function (global) {
    'use strict';

    var STYLE_ID = 'nexus-try-on-underneath-style';
    var CSS = [
        '.nexus-under-overlay{position:fixed;inset:0;z-index:2400;display:flex;align-items:flex-end;',
        'justify-content:center;background:rgba(2,10,16,.55);backdrop-filter:blur(6px);',
        '-webkit-backdrop-filter:blur(6px);animation:nexus-under-fade .18s ease-out}',
        '.nexus-under{position:relative;box-sizing:border-box;width:min(440px,100vw);max-height:min(78vh,620px);',
        'overflow:auto;margin:0;padding:10px 18px calc(18px + env(safe-area-inset-bottom,0px));',
        'border:1px solid rgba(18,217,236,.28);border-bottom:0;border-radius:22px 22px 0 0;',
        'background:linear-gradient(180deg,rgba(9,40,54,.98),rgba(3,18,28,.99));color:#e6f5f9;',
        'box-shadow:0 -18px 60px rgba(0,0,0,.55);font:500 13px/1.45 system-ui;animation:nexus-under-rise .22s ease-out}',
        '.nexus-under-grab{display:block;width:42px;height:4px;margin:0 auto 10px;border-radius:4px;background:#2b6576}',
        '.nexus-under-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}',
        '.nexus-under-x{flex:none;width:36px;height:36px;border-radius:999px;border:1px solid #1d5263;',
        'background:#0b2938;color:#d9f5f8;font:400 20px/1 system-ui;cursor:pointer}',
        '.nexus-under-x:disabled{opacity:.5;cursor:default}',
        '@media (min-width:700px){.nexus-under-overlay{align-items:center}',
        '.nexus-under{border-bottom:1px solid rgba(18,217,236,.28);border-radius:22px;padding-bottom:18px}',
        '.nexus-under-grab{display:none}}',
        '@keyframes nexus-under-rise{from{transform:translateY(24px);opacity:0}to{transform:none;opacity:1}}',
        '@keyframes nexus-under-fade{from{opacity:0}to{opacity:1}}',
        '@media (prefers-reduced-motion:reduce){.nexus-under,.nexus-under-overlay{animation:none}}',
        '.nexus-under-kicker{margin:0;color:#7fe7f2;font:700 11px/1.2 system-ui;letter-spacing:.12em}',
        '.nexus-under-title{margin:4px 0 12px;font:600 16px/1.3 system-ui}',
        '.nexus-under-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}',
        '.nexus-under-card{display:grid;grid-template-columns:52px 1fr;gap:10px;align-items:center;text-align:left;',
        'padding:10px;border-radius:14px;border:1px solid #1d5263;background:#0b2938;color:inherit;cursor:pointer;',
        'min-height:76px;font:inherit;transition:border-color .15s,box-shadow .15s}',
        '.nexus-under-card[aria-pressed="true"]{border-color:#12d9ec;box-shadow:0 0 0 1px #12d9ec inset}',
        '.nexus-under-card:disabled{cursor:default;opacity:.7}',
        '.nexus-under-fabric{width:52px;height:52px;border-radius:10px;background:',
        'linear-gradient(135deg,rgba(255,255,255,.28),rgba(255,255,255,0) 42%,rgba(0,0,0,.18) 75%),var(--fabric);',
        'border:1px solid rgba(255,255,255,.18)}',
        '.nexus-under-name{display:block;font:700 14px/1.2 system-ui}',
        '.nexus-under-pieces{display:block;color:#9ab5c0;font-size:12px}',
        '.nexus-under-state{display:inline-block;margin-top:4px;padding:1px 8px;border-radius:999px;',
        'background:#0e3a4c;color:#bff6fb;font-size:11px}',
        '.nexus-under-more{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;align-items:center}',
        '.nexus-under-chip{min-height:30px;padding:3px 10px;border-radius:999px;border:1px solid #1d5263;',
        'background:#0b2938;color:#d9f5f8;font:500 12px system-ui;cursor:pointer}',
        '.nexus-under-chip[aria-pressed="true"]{border-color:#12d9ec;background:#075669}',
        '.nexus-under-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}',
        '.nexus-under-actions .nexus-under-primary{flex:1 1 auto}',
        '.nexus-under-button{min-height:44px;padding:8px 16px;border-radius:999px;border:1px solid #1d5263;',
        'background:#0b2938;color:#d9f5f8;font:600 13px system-ui;cursor:pointer}',
        '.nexus-under-primary{background:#0fd6e9;color:#032231;border-color:#08ddea}',
        '.nexus-under-button:disabled{opacity:.55;cursor:default}',
        '.nexus-under-status{margin:10px 0 0;color:#bfe9ef}',
        '.nexus-under-error{margin:10px 0 0;color:#ffd5b9}',
        '.nexus-under-done{margin:10px 0 0;color:#a9f5c3}',
    ].join('');

    /** The two colours a lingerie conversation is usually about, shown as product cards. */
    var FEATURED = ['white', 'black'];

    function el(doc, tag, klass, text) {
        var node = doc.createElement(tag);
        if (klass) node.className = klass;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function cap(word) {
        return word ? word.charAt(0).toUpperCase() + word.slice(1) : '';
    }

    /** "Tailored Full-Cup Bra", "Tailored Briefs" → "Tailored full-cup bra · tailored briefs". */
    function piecesLine(look) {
        var pieces = (look && look.underneath && look.underneath.pieces) || [];
        if (!pieces.length) return 'Her foundation';
        return pieces
            .map(function (p, i) {
                var lower = String(p).toLowerCase();
                return i === 0 ? cap(lower) : lower;
            })
            .join(' · ');
    }

    /**
     * Pure: what each colour card says. `looks` is the haul's looks; a colour already made for
     * this outfit (the same family) is "Ready", the one on her is "Wearing now".
     */
    function cardsFor(look, looks, suggested, colors) {
        // A look from her saved wardrobe may not say: then no colour is claimed to be on.
        var current = look && look.underneath ? look.underneath.color || 'beige' : null;
        var family = look ? look.family || null : null;
        return colors.map(function (c) {
            var made =
                c.value === current ||
                (family !== null &&
                    (looks || []).some(function (other) {
                        return (
                            other.family === family &&
                            other.underneath &&
                            (other.underneath.color || 'beige') === c.value
                        );
                    }));
            var state =
                c.value === current ? 'Wearing now' : c.value === suggested ? 'Stylist’s pick' : made ? 'Ready' : '';
            return {
                value: c.value,
                label: c.label,
                hex: c.hex,
                current: c.value === current,
                made: made,
                state: state,
            };
        });
    }

    class TryOnUnderneath {
        constructor(options) {
            options = options || {};
            this.doc = options.doc || global.document;
            this.view = options.view;
            this.Generator = options.generatorApi || global.NEXUS_TRY_ON_GENERATOR || {};
            this.node = null;
            this.phase = 'choose'; // choose | working | done | failed
            this.selected = null;
            this.suggested = null;
            this.message = '';
            this.comparing = false;
            this._timer = null;
        }

        colors() {
            return this.Generator.FOUNDATION_COLORS || [];
        }

        look() {
            var state = this.view && this.view.session ? this.view.session.state() : null;
            return state ? state.look : null;
        }

        /** Open the chooser on the look she has on, with the stylist's colour highlighted. */
        show(offer) {
            offer = offer || {};
            var look = this.look();
            // A look from her saved wardrobe may not say: then no colour is claimed to be on.
            var current = look && look.underneath ? look.underneath.color || 'beige' : null;
            this.suggested = offer.suggested || null;
            this.selected = this.suggested && this.suggested !== current ? this.suggested : null;
            this.phase = 'choose';
            this.message = '';
            this.comparing = false;
            this._mount();
            this.render();
            return true;
        }

        hide() {
            this._stopTimer();
            var overlay = this.overlay;
            if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
            else if (this.node && this.node.parentNode) this.node.parentNode.removeChild(this.node);
            if (this._onKey && this.doc) this.doc.removeEventListener('keydown', this._onKey, true);
            this._onKey = null;
            this.overlay = null;
            this.node = null;
            // Back to where the person was: the chip that opened it, or whatever had focus.
            var back = this._returnFocus;
            this._returnFocus = null;
            if (back && back.isConnected && typeof back.focus === 'function') back.focus();
        }

        destroy() {
            this.hide();
            this.view = null;
        }

        _mount() {
            var doc = this.doc;
            if (!doc) return;
            if (!doc.getElementById(STYLE_ID)) {
                var style = el(doc, 'style');
                style.id = STYLE_ID;
                style.textContent = CSS;
                (doc.head || doc.documentElement).appendChild(style);
            }
            if (this.node && this.node.isConnected) return;
            var self = this;
            this._returnFocus = doc.activeElement || null;
            this.overlay = el(doc, 'div', 'nexus-under-overlay');
            this.node = el(doc, 'section', 'nexus-under');
            this.node.setAttribute('role', 'dialog');
            this.node.setAttribute('aria-modal', 'true');
            this.node.setAttribute('aria-labelledby', 'nexus-under-kicker');
            this.overlay.appendChild(this.node);
            // The backdrop closes it; a tap inside the sheet does not reach it.
            this.overlay.addEventListener('click', function (event) {
                if (event.target === self.overlay && self.phase !== 'working') self.hide();
            });
            this._onKey = function (event) {
                if (event.key === 'Escape' && self.phase !== 'working') {
                    event.stopPropagation();
                    self.hide();
                }
            };
            doc.addEventListener('keydown', this._onKey, true);
            doc.body.appendChild(this.overlay);
        }

        _stopTimer() {
            if (this._timer) {
                clearInterval(this._timer);
                this._timer = null;
            }
        }

        async choose(color) {
            if (this.phase === 'working' || !this.view) return null;
            var look = this.look();
            var before = look;
            this.selected = color;
            this.phase = 'working';
            this.message = 'Asking Forge for ' + color + '…';
            this.render();
            var self = this;
            var win = this.doc && this.doc.defaultView;
            if (win && win.setInterval) {
                this._timer = win.setInterval(function () {
                    var progress = self.view && self.view.progress;
                    var label = progress && (progress.label || progress.text);
                    if (label && self.phase === 'working') {
                        self.message = label;
                        self.render();
                    }
                }, 400);
            }
            var result;
            try {
                result = await this.view.underneath(color);
            } catch (error) {
                result = { ok: false, why: (error && error.message) || 'Forge could not change the colour.' };
            }
            this._stopTimer();
            if (result && result.ok) {
                this.phase = 'done';
                this.comparing = false;
                this.previous = before;
                this.message = result.already
                    ? cap(color) + ' is what she has on underneath.'
                    : cap(color) +
                      ' is on — same dress, same boots, same pose. Only what is underneath changed colour.';
            } else {
                this.phase = 'failed';
                this.message =
                    'That did not work: ' +
                    ((result && result.why) || 'Forge could not change the colour.') +
                    ' Her look is unchanged.';
            }
            this.render();
            return result;
        }

        compare() {
            if (!this.view || this.phase !== 'done') return;
            if (this.comparing) this.view.compare(null);
            else this.view.compare('previous');
            this.comparing = !this.comparing;
            this.render();
        }

        render() {
            if (!this.node) return;
            var doc = this.doc;
            var self = this;
            var look = this.look();
            var state = this.view && this.view.session ? this.view.session.state() : { looks: [] };
            var colors = this.colors();
            var cards = cardsFor(look, state.looks, this.suggested, colors);
            // A look from her saved wardrobe may not say: then no colour is claimed to be on.
            var current = look && look.underneath ? look.underneath.color || 'beige' : null;
            var working = this.phase === 'working';
            var parts = [];
            var grab = el(doc, 'span', 'nexus-under-grab');
            grab.setAttribute('aria-hidden', 'true');
            parts.push(grab);
            var head = el(doc, 'div', 'nexus-under-head');
            var heading = el(doc, 'div');
            var kicker = el(doc, 'p', 'nexus-under-kicker', 'WHAT’S UNDERNEATH');
            kicker.id = 'nexus-under-kicker';
            heading.appendChild(kicker);
            heading.appendChild(
                el(doc, 'p', 'nexus-under-title', (look ? look.name : 'Her look') + ' · ' + piecesLine(look))
            );
            var x = el(doc, 'button', 'nexus-under-x', '×');
            x.type = 'button';
            x.setAttribute('aria-label', 'Close');
            x.disabled = working;
            x.addEventListener('click', function () {
                self.hide();
            });
            head.appendChild(heading);
            head.appendChild(x);
            parts.push(head);

            var grid = el(doc, 'div', 'nexus-under-cards');
            cards
                .filter(function (c) {
                    return FEATURED.indexOf(c.value) !== -1;
                })
                .forEach(function (c) {
                    var button = el(doc, 'button', 'nexus-under-card');
                    button.type = 'button';
                    button.dataset.color = c.value;
                    var picked = (self.selected || current) === c.value;
                    button.setAttribute('aria-pressed', String(picked));
                    button.setAttribute('aria-label', c.label + ' underneath' + (c.state ? ', ' + c.state : ''));
                    button.disabled = working;
                    var fabric = el(doc, 'span', 'nexus-under-fabric');
                    fabric.style.setProperty('--fabric', c.hex);
                    fabric.setAttribute('aria-hidden', 'true');
                    var text = el(doc, 'span');
                    text.appendChild(el(doc, 'span', 'nexus-under-name', c.label));
                    text.appendChild(el(doc, 'span', 'nexus-under-pieces', piecesLine(look)));
                    if (c.state) text.appendChild(el(doc, 'span', 'nexus-under-state', c.state));
                    button.appendChild(fabric);
                    button.appendChild(text);
                    button.addEventListener('click', function () {
                        self.selected = c.value;
                        if (self.phase !== 'working') self.phase = 'choose';
                        self.render();
                    });
                    grid.appendChild(button);
                });
            parts.push(grid);

            var more = el(doc, 'div', 'nexus-under-more');
            more.appendChild(el(doc, 'span', 'nexus-under-pieces', 'More colours:'));
            cards
                .filter(function (c) {
                    return FEATURED.indexOf(c.value) === -1;
                })
                .forEach(function (c) {
                    var chip = el(doc, 'button', 'nexus-under-chip', c.label);
                    chip.type = 'button';
                    chip.setAttribute('aria-pressed', String((self.selected || current) === c.value));
                    chip.disabled = working;
                    chip.addEventListener('click', function () {
                        self.selected = c.value;
                        if (self.phase !== 'working') self.phase = 'choose';
                        self.render();
                    });
                    more.appendChild(chip);
                });
            parts.push(more);

            if (this.phase === 'working') {
                var status = el(doc, 'p', 'nexus-under-status', this.message);
                status.setAttribute('role', 'status');
                parts.push(status);
            } else if (this.phase === 'done') {
                var done = el(doc, 'p', 'nexus-under-done', this.message);
                done.setAttribute('role', 'status');
                parts.push(done);
            } else if (this.phase === 'failed') {
                var failed = el(doc, 'p', 'nexus-under-error', this.message);
                failed.setAttribute('role', 'alert');
                parts.push(failed);
            }

            var actions = el(doc, 'div', 'nexus-under-actions');
            var target = this.selected || current;
            if (this.phase === 'done' && target === current) {
                if (this.previous) {
                    var other = (this.previous.underneath && this.previous.underneath.color) || 'beige';
                    actions.appendChild(
                        this._button(this.comparing ? 'Back to ' + current : 'Compare with ' + other, function () {
                            self.compare();
                        })
                    );
                }
                actions.appendChild(
                    this._button('Save look', function () {
                        if (self.view && typeof self.view.favorite === 'function') self.view.favorite();
                        self.message = 'Saved to her looks.';
                        self.render();
                    })
                );
            } else {
                var apply = this._button(
                    working
                        ? 'Making it ' + target + '…'
                        : !target
                          ? 'Choose a colour'
                          : target === current
                            ? cap(current) + ' is on'
                            : 'Try it in ' + target,
                    function () {
                        self.choose(target);
                    },
                    true
                );
                apply.disabled = working || !target || target === current;
                actions.appendChild(apply);
                if (this.phase === 'failed') {
                    actions.appendChild(
                        this._button('Try again', function () {
                            self.choose(target);
                        })
                    );
                }
            }
            parts.push(actions);
            var focused = doc.activeElement && this.node.contains(doc.activeElement);
            this.node.replaceChildren.apply(this.node, parts);
            // Into the dialog when it opens; a re-render keeps the person where they were.
            if (!focused) {
                var first = this.node.querySelector('.nexus-under-card[aria-pressed="true"]') || x;
                if (first && typeof first.focus === 'function') first.focus();
            }
        }

        _button(label, onClick, primary) {
            var button = el(this.doc, 'button', 'nexus-under-button' + (primary ? ' nexus-under-primary' : ''), label);
            button.type = 'button';
            button.addEventListener('click', onClick);
            return button;
        }
    }

    var api = { TryOnUnderneath: TryOnUnderneath, cardsFor: cardsFor, piecesLine: piecesLine, FEATURED: FEATURED };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_TRY_ON_UNDERNEATH = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
