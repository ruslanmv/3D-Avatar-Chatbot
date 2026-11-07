/**
 * Playground interaction router (PG1) — the "things to do here" chips.
 *
 * A place by name (Experiences ▸ Visit a place, or Private's room) used to be scenery: the pub
 * came up around her and there was nothing to do in it that the chat box did not already offer.
 * This draws one row of chips — Cheers, Dance, Light, Study 25 min — while a world with a template
 * (`PlaygroundTemplateCatalog`) is up, and takes them down when it goes. It never decides which
 * world is up: it listens to the engine's `nexus-world-shown`, and a private template answers only
 * when the engine reports a private room the Private experience asked for (`forShown`).
 *
 * Where the row lives, and why. On a desktop it is a row in the composer area under the status
 * bar (DX1: in normal flow, so it covers no message, no microphone and no input). On a phone held
 * upright the composer is a sheet whose height is fixed, so — like the status bar's mini-player
 * (DX2) — the row lives in <body> and docks just above whichever is higher, the status bar or the
 * chat sheet, re-measured on resize. One row, scrolling sideways when it is wider than the
 * screen: four chips at 44 px fit an iPhone SE's 320 px with the rest a swipe away, and a second
 * row would push her face out of view.
 *
 * What a chip does is an existing system (see the catalogue's header): a line through the
 * conversation surface, a shipped clip through the clip loader, a light through the engine's
 * `nexus-world-mood`, or a timer drawn in the chip. The stream studio's "Pretend show" draws a
 * badge that says, in words, that nothing is recorded or sent — and this file names no capture
 * API at all; `tests/playgrounds.test.js` reads it to keep that true.
 *
 * Reduced motion: the mood change is a cut instead of a blend, and nothing here animates. The
 * badge does not pulse — a pulsing red dot is the usual "live" sign, and it is a flash.
 *
 * Exposes: window.NEXUS_PLAYGROUND_ROUTER
 */
(function (global) {
    'use strict';

    const BAR_ID = 'nexus-playground-bar';
    const BADGE_ID = 'nexus-playground-badge';
    const STYLE_ID = 'nexus-playground-styles';

    const CSS = `
#${BAR_ID} {
  --mark: #F2C94C;
  display: flex; gap: .4rem; align-items: center; margin: 0 0 .5rem; padding: .1rem 0 .15rem;
  overflow-x: auto; overscroll-behavior-x: contain; scrollbar-width: none; -webkit-overflow-scrolling: touch;
}
#${BAR_ID}::-webkit-scrollbar { display: none; }
#${BAR_ID}[hidden] { display: none; }
#${BAR_ID}[data-rating="private"] { --mark: #f08fb6; }
#${BAR_ID} button {
  flex: 0 0 auto; min-height: 32px; padding: .3rem .75rem; border-radius: 999px; white-space: nowrap;
  border: 1px solid color-mix(in srgb, var(--mark) 45%, transparent);
  background: color-mix(in srgb, var(--mark) 10%, #0b1620); color: #eef3f8;
  font: 600 .74rem/1.2 system-ui, sans-serif; cursor: pointer;
}
#${BAR_ID} button:hover { background: color-mix(in srgb, var(--mark) 22%, #0b1620); }
#${BAR_ID} button:focus-visible { outline: 2px solid var(--mark); outline-offset: 2px; }
#${BAR_ID} button[aria-pressed="true"] { background: color-mix(in srgb, var(--mark) 32%, #0b1620); border-color: var(--mark); }
body.nexus-mobile.nexus-portrait #${BAR_ID} {
  position: fixed; left: 10px; right: 10px; bottom: var(--nexus-playground-dock, 170px); margin: 0; z-index: 39;
  padding: 4px; border-radius: 14px; background: rgba(8, 16, 24, .72);
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
}
@media (pointer: coarse) {
  #${BAR_ID} button { min-height: 44px; padding: .5rem .9rem; }
}
/* DX5. In the End row: the chips take the space to the left of the X and scroll sideways. */
#nexus-activity-pill.has-actions { justify-content: space-between; align-items: center; gap: 6px; }
#nexus-activity-pill > #${BAR_ID} { flex: 1 1 auto; min-width: 0; margin: 0; }
body.nexus-mobile.nexus-portrait #nexus-activity-pill.has-actions { left: calc(10px + env(safe-area-inset-left, 0px)); }
body.nexus-mobile.nexus-portrait #nexus-activity-pill > #${BAR_ID} {
  position: static; padding: 0; background: none; -webkit-backdrop-filter: none; backdrop-filter: none;
}
#${BADGE_ID} {
  position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 30; pointer-events: none;
  display: flex; align-items: center; gap: .45rem; padding: .35rem .75rem; border-radius: 999px; max-width: calc(100% - 24px);
  background: rgba(10, 10, 16, .82); color: #fff; font: 600 .72rem/1.25 system-ui, sans-serif; text-align: center;
  border: 1px solid rgba(255, 255, 255, .18);
}
#${BADGE_ID} .dot { width: .55rem; height: .55rem; border-radius: 50%; background: #e5484d; flex: 0 0 auto; }
#${BADGE_ID} small { display: block; font-weight: 500; opacity: .75; }
`;

    /** "24:13". Pure. */
    function formatRemaining(ms) {
        const s = Math.max(0, Math.ceil(Number(ms) / 1000) || 0);
        const m = Math.floor(s / 60);
        return `${m}:${String(s % 60).padStart(2, '0')}`;
    }

    /**
     * The chips to draw for a template in a state, as plain data: { id, label, pressed, title }.
     * `state`: { playing (clip action id), live, timerEndsAt, now, mood (index), moodLabel }.
     * Pure — the DOM half below only copies this onto buttons.
     */
    function chips(template, state) {
        const s = state || {};
        const out = [];
        for (const a of (template && template.actions) || []) {
            const chip = { id: a.id, kind: a.kind, label: a.label, pressed: null, title: a.label };
            if (a.kind === 'clip' && a.stopLabel) {
                chip.pressed = s.playing === a.id;
                if (chip.pressed) chip.label = a.stopLabel;
            }
            if (a.kind === 'pretend-live') {
                chip.pressed = !!s.live;
                if (s.live) chip.label = a.stopLabel || a.label;
                chip.title = 'Pretend only: nothing is recorded or sent';
            }
            if (a.kind === 'timer') {
                const running = s.timerEndsAt && s.now != null && s.timerEndsAt > s.now;
                chip.pressed = !!running;
                if (running) chip.label = `⏱️ ${formatRemaining(s.timerEndsAt - s.now)} · ${a.stopLabel || 'Stop'}`;
                else if (s.timerDone) chip.label = `✅ ${a.minutes} min done`;
            }
            if (a.kind === 'mood' && s.moodLabel) {
                chip.label = `💡 ${s.moodLabel}`;
                chip.title = 'Change the light';
            }
            out.push(chip);
        }
        return out;
    }

    /** The mood after `index` in a template's list, wrapping. Pure. */
    function nextMood(template, index) {
        const moods = (template && template.moods) || [];
        if (!moods.length) return null;
        const i = Number.isInteger(index) ? (index + 1) % moods.length : 0;
        return { index: i, id: moods[i] };
    }

    function attach(options) {
        const o = options || {};
        const doc = o.doc || global.document;
        const win = o.win || (doc && doc.defaultView) || global;
        if (!doc || !win || typeof win.addEventListener !== 'function') return null;
        const catalogue = o.templates || global.NEXUS_PLAYGROUND_TEMPLATES;
        const moods = o.moods || global.NEXUS_PLAYGROUND_MOODS;
        if (!catalogue || !moods) return null;

        let template = null;
        let shown = null;
        let state = {};
        let ticker = null;
        let doneTimer = null;
        let bar = null;

        const reducedMotion = () => {
            try {
                return !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
            } catch (_) {
                return false;
            }
        };
        const clips = () => o.clipLoader || global.NEXUS_CLIP_LOADER || null;

        function styles() {
            if (doc.getElementById(STYLE_ID)) return;
            const style = doc.createElement('style');
            style.id = STYLE_ID;
            style.textContent = CSS;
            (doc.head || doc.documentElement).appendChild(style);
        }

        function pillId() {
            const marks = global.NEXUS_COMPANION_MARKS;
            return (marks && marks.PILL_ID) || 'nexus-activity-pill';
        }

        /** Desktop: under the status bar in the composer. Phone portrait: docked in <body>. */
        function place() {
            if (!bar) return;
            try {
                const cls = doc.body ? doc.body.classList : null;
                const mobile = !!(cls && cls.contains('nexus-mobile') && cls.contains('nexus-portrait'));
                const shell = doc.querySelector('.chat-input-shell');
                const pill = doc.getElementById(pillId());
                // A Private venue uses the SAME verified template chips, but its conversation
                // owns a compact action slot. Never dock them across the avatar's face.
                // Without an active Private conversation no Private chips are visible; this
                // is UI containment, not an authorization shortcut.
                if (template && template.rating === 'private') {
                    if (pill) pill.classList.remove('has-actions');
                    const slot = doc.querySelector('#nexus-private-conversation-row .nexus-private-action-slot');
                    if (!slot) {
                        bar.hidden = true;
                    } else {
                        if (bar.parentNode !== slot) slot.appendChild(bar);
                        bar.hidden = false;
                        bar.style.removeProperty('--nexus-playground-dock');
                    }
                    return;
                }
                // DX5. One row: the chips, then the End X at its right — inside the End control's
                // row wherever that row is (the composer on a desktop, docked above the chat
                // sheet on a phone). A private room has no End row (Private draws its own), so
                // there the chips keep their own place below.
                if (pill && !pill.hidden) {
                    if (bar.parentNode !== pill) pill.insertBefore(bar, pill.firstChild);
                    pill.classList.add('has-actions');
                    return;
                }
                if (pill) pill.classList.remove('has-actions');
                if (mobile) {
                    if (bar.parentNode !== doc.body) doc.body.appendChild(bar);
                    const h = win.innerHeight;
                    const pillUp = pill && !pill.hidden && pill.parentNode === doc.body;
                    const chat = doc.querySelector('.chat-card');
                    const top = pillUp
                        ? pill.getBoundingClientRect().top
                        : chat
                          ? chat.getBoundingClientRect().top
                          : null;
                    if (h > 0 && top > 0 && top < h)
                        bar.style.setProperty('--nexus-playground-dock', Math.round(h - top + 6) + 'px');
                } else if (shell) {
                    // Straight under the status bar when it is in the composer, else first.
                    const pillHere = pill && pill.parentNode === shell ? pill : null;
                    if (pillHere && bar.previousSibling !== pillHere) shell.insertBefore(bar, pillHere.nextSibling);
                    else if (!pillHere && (bar.parentNode !== shell || bar !== shell.firstChild))
                        shell.insertBefore(bar, shell.firstChild);
                } else if (bar.parentNode !== doc.body) doc.body.appendChild(bar);
            } catch (_) {
                /* the CSS default stands */
            }
        }

        function paint() {
            if (!template) {
                if (bar) bar.hidden = true;
                const pill = doc.getElementById(pillId());
                if (pill) pill.classList.remove('has-actions');
                return;
            }
            styles();
            if (!bar) {
                bar = doc.createElement('div');
                bar.id = BAR_ID;
                bar.setAttribute('role', 'toolbar');
            }
            bar.hidden = false;
            bar.dataset.rating = template.rating;
            bar.dataset.template = template.id;
            bar.setAttribute('aria-label', `Things to do in the ${template.title}`);
            const list = chips(template, { ...state, now: Date.now() });
            // Rebuild only when the set of chips changes; otherwise update in place, so a timer
            // ticking every second does not steal focus from the chip the person is on.
            if (
                bar.children.length !== list.length ||
                [...bar.children].some((b, i) => b.dataset.chip !== list[i].id)
            ) {
                bar.textContent = '';
                for (const chip of list) {
                    const b = doc.createElement('button');
                    b.type = 'button';
                    b.dataset.chip = chip.id;
                    b.addEventListener('click', () => act(chip.id));
                    bar.appendChild(b);
                }
            }
            list.forEach((chip, i) => {
                const b = bar.children[i];
                if (b.textContent !== chip.label) b.textContent = chip.label;
                b.title = chip.title;
                if (chip.pressed === null) b.removeAttribute('aria-pressed');
                else b.setAttribute('aria-pressed', chip.pressed ? 'true' : 'false');
            });
            place();
        }

        function say(text) {
            const surface = global.NEXUS_CONVERSATION_SURFACE;
            try {
                if (surface && typeof surface.send === 'function' && surface.send(text) !== false) return true;
                const hooks = global.NEXUS_CONVERSATION_SURFACE_HOOKS;
                if (hooks && typeof hooks.send === 'function') {
                    hooks.send(text);
                    return true;
                }
            } catch (error) {
                console.warn('[Playground] the line was not sent', error);
            }
            return false;
        }

        /**
         * PG3. Say what happened, for PlaygroundReactiveContext, after this file has done it.
         * A report and nothing more: this router stays the one owner of every chip's effect,
         * and the listener checks the report against the verified world before using it.
         */
        function report(actionId, phase) {
            try {
                win.dispatchEvent(
                    new win.CustomEvent('nexus-playground-action', {
                        detail: { actionId: String(actionId), phase: phase, world: shown },
                    })
                );
            } catch (_) {
                /* nobody is listening */
            }
        }

        function stopClip() {
            if (!state.playing) return;
            const was = state.playing;
            state.playing = null;
            report(was, 'stopped');
            try {
                const loader = clips();
                if (loader && typeof loader.stopClip === 'function') loader.stopClip({ fadeOut: 0.3 });
            } catch (_) {
                /* she settles on her own */
            }
        }

        function playClip(action) {
            const clip = catalogue.CLIPS[action.clip];
            const loader = clips();
            if (!clip || !loader || typeof loader.playClip !== 'function') return;
            if (clip.loop && state.playing === action.id) {
                stopClip();
                return;
            }
            try {
                const world = shown;
                Promise.resolve(loader.playClip(clip.file, { loop: clip.loop }))
                    .then((played) => {
                        // Only a clip that really started is reported as started; a late
                        // answer from a place already left is not reported at all.
                        if (shown !== world) return;
                        if (played === false) {
                            if (state.playing === action.id) state.playing = null;
                            report(action.id, 'failed');
                        } else if (clip.loop && state.playing === action.id) report(action.id, 'started');
                    })
                    .catch(() => report(action.id, 'failed'));
                state.playing = clip.loop ? action.id : null;
            } catch (error) {
                console.warn('[Playground] clip not played', error);
            }
        }

        function setMood(index) {
            const next = nextMood(template, index);
            if (!next) return;
            const preset = moods.get(next.id);
            if (!preset) return;
            state.mood = next.index;
            state.moodLabel = preset.label;
            win.dispatchEvent(
                new win.CustomEvent('nexus-world-mood', { detail: { light: preset.light, instant: reducedMotion() } })
            );
        }

        function badge(on) {
            let node = doc.getElementById(BADGE_ID);
            if (!on) {
                if (node) node.remove();
                return;
            }
            if (node) return;
            node = doc.createElement('div');
            node.id = BADGE_ID;
            node.setAttribute('role', 'status');
            const dot = doc.createElement('span');
            dot.className = 'dot';
            dot.setAttribute('aria-hidden', 'true');
            const words = doc.createElement('span');
            words.textContent = 'Pretend show';
            const small = doc.createElement('small');
            small.textContent = 'Not recording · nothing leaves this device';
            words.appendChild(small);
            node.append(dot, words);
            const host = doc.querySelector('.avatar-viewport') || doc.body;
            host.appendChild(node);
        }

        function stopTimer(phase) {
            if (ticker) win.clearInterval(ticker);
            const was = Boolean(ticker);
            ticker = null;
            state.timerEndsAt = null;
            if (was && template) {
                const timer = template.actions.find((a) => a.kind === 'timer');
                if (timer) report(timer.id, phase || 'stopped');
            }
        }

        function act(id) {
            const action = template && template.actions.find((a) => a.id === id);
            if (!action) return;
            report(action.id, 'selected');
            if (action.kind === 'say') say(action.text);
            else if (action.kind === 'clip') playClip(action);
            else if (action.kind === 'mood') setMood(state.mood);
            else if (action.kind === 'pretend-live') {
                state.live = !state.live;
                badge(state.live);
                report(action.id, state.live ? 'started' : 'stopped');
            } else if (action.kind === 'timer') {
                if (state.timerEndsAt && state.timerEndsAt > Date.now()) stopTimer();
                else {
                    state.timerDone = false;
                    state.timerEndsAt = Date.now() + action.minutes * 60000;
                    ticker = win.setInterval(() => {
                        if (state.timerEndsAt && Date.now() >= state.timerEndsAt) {
                            stopTimer('completed');
                            state.timerDone = true;
                            if (doneTimer) win.clearTimeout(doneTimer);
                            doneTimer = win.setTimeout(() => {
                                state.timerDone = false;
                                paint();
                            }, 8000);
                        }
                        paint();
                    }, 1000);
                    report(action.id, 'started');
                    if (action.text) say(action.text);
                }
            }
            paint();
        }

        /** Everything a template started ends with its place. */
        function clear() {
            stopClip();
            stopTimer();
            if (doneTimer) win.clearTimeout(doneTimer);
            doneTimer = null;
            badge(false);
            state = {};
            template = null;
            paint();
        }

        function onShown(event) {
            const detail = (event && event.detail) || {};
            const next = catalogue.forShown(detail);
            if (next && template && next.id === template.id && shown === detail.id) return;
            clear();
            shown = detail.id || null;
            if (!next) return;
            template = next;
            const first = moods.get((next.moods || [])[0]);
            state = { mood: 0, moodLabel: first ? first.label : null };
            paint();
        }

        win.addEventListener('nexus-world-shown', onShown);
        win.addEventListener('nexus-private-view-layout', place);
        win.addEventListener('resize', place);
        win.addEventListener('orientationchange', place);

        return {
            get template() {
                return template;
            },
            get bar() {
                return bar;
            },
            act,
            refresh: paint,
            detach() {
                clear();
                win.removeEventListener('nexus-world-shown', onShown);
                win.removeEventListener('nexus-private-view-layout', place);
                win.removeEventListener('resize', place);
                win.removeEventListener('orientationchange', place);
                if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
            },
        };
    }

    const api = { attach, chips, nextMood, formatRemaining, BAR_ID, BADGE_ID, CSS };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) {
        global.NEXUS_PLAYGROUND_ROUTER = api;
        // Attach once per page. Boot loads this after the catalogue and the presets.
        if (global.document && !global.__NEXUS_PLAYGROUND_LIVE) {
            try {
                global.__NEXUS_PLAYGROUND_LIVE = attach({});
            } catch (error) {
                console.warn('[Playground] not attached', error);
            }
        }
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
