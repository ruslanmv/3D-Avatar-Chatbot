/**
 * CompanionMode.js — Additive, non-destructive "Desktop Companion" mode
 * for ruslanmv/3D-Avatar-Chatbot (yourfriend.online).
 *
 * Goal: open the site, click one button, and the live 3D avatar pops out into
 * a small ALWAYS-ON-TOP window that floats over every other application
 * (VS Code, a terminal, a browser) on any monitor — like the "Your Mother"
 * Steam desktop companion, but with ZERO installation.
 *
 * ── How it stays on top without Electron ──────────────────────────────────
 *   Browsers cannot keep a normal tab above other apps, but Picture-in-Picture
 *   windows ARE always-on-top by design. Two strategies, best-first:
 *
 *   A) Document Picture-in-Picture (Chrome / Edge 116+):
 *      The REAL WebGL canvas is moved into the PiP window. Fully live and
 *      interactive — the avatar keeps animating, lip-syncing and orbit/zoom
 *      still work. The canvas is moved back intact when the window closes.
 *
 *   B) Video PiP fallback (Chrome, Edge, Safari, Firefox*):
 *      canvas.captureStream(30) -> <video> -> requestPictureInPicture().
 *      A live always-on-top mirror of the avatar (not interactive).
 *      (*Firefox: the user triggers PiP from the video's context menu.)
 *
 * ── Non-destructive contract ──────────────────────────────────────────────
 *   Nothing in the existing codebase is mutated permanently. On activate() the
 *   module snapshots the canvas DOM slot + inline style, the renderer size, the
 *   scene background and the renderer clear color/alpha; on deactivate() every
 *   one of those is restored byte-for-byte. Chat / TTS / AI providers keep
 *   running in the main tab — only the *viewport* moves.
 *
 * ── Wiring (classic global script, same pattern as AvatarPicker etc.) ──────
 *   In index.html, after src/main.js:
 *       <script defer src="src/CompanionMode.js"></script>
 *   The file auto-wires itself to window.NEXUS_VIEWER when ready and injects a
 *   "Companion" button into the avatar toolbar. You can also drive it manually:
 *       window.companionMode.toggle();          // pop out / bring back
 *       window.companionMode.activate();
 *       window.companionMode.deactivate();
 *   Auto-start:  index.html?mode=companion
 *   Shortcut:    Alt + C
 *
 * Exposes: window.CompanionMode (class), window.companionMode (instance).
 */
(function () {
    'use strict';

    class CompanionMode {
        /**
         * @param {object} [opts]
         * @param {THREE.WebGLRenderer} [opts.renderer]  Live renderer (auto-detected if omitted).
         * @param {THREE.Scene}         [opts.scene]     Scene, for transparent-float background.
         * @param {(w:number,h:number)=>void} [opts.onResize] Called on PiP resize (update camera aspect).
         * @param {boolean} [opts.transparentBackground=true]  Float the avatar on a transparent PiP window.
         * @param {number}  [opts.width=340]  Initial PiP width.
         * @param {number}  [opts.height=460] Initial PiP height.
         */
        constructor({
            renderer,
            scene,
            onResize,
            transparentBackground = true,
            width = 340,
            height = 460,
            interactive = true, // inject mic + text + subtitle into the companion window
            onSend, // optional override: (text) => void; defaults to window.handleUserMessage
            onToggleMic, // optional override for the app's own voice input
        } = {}) {
            this._renderer = renderer || null;
            this._scene = scene || null;
            this.onResize = onResize || null;
            this.transparentBackground = transparentBackground;
            this.width = width;
            this.height = height;
            this.interactive = interactive;
            this._onSend = onSend || null;
            this._onToggleMic = onToggleMic || null;

            this.active = false;
            this.strategy = null; // 'document-pip' | 'video-pip'

            this._pipWindow = null;
            this._placeholder = null;
            this._savedCanvasStyle = null;
            this._savedSize = null;
            this._savedBackground = undefined;
            this._savedClearColor = null;
            this._savedClearAlpha = null;

            this._video = null;
            this._stream = null;
            this._button = null;
            this._fit = null; // bound resize handler for the PiP window

            // Interaction (voice + text + subtitle) state.
            this._ui = null; // { mic, input, caption, log } inside the current surface
            this._root = null; // .cm-root container (PiP body child or the overlay)
            this._sr = null; // dedicated SpeechRecognition for the companion
            this._recognizing = false;
            this._replyObserver = null; // mirrors avatar replies into the caption/log
            this._captionTimer = null;
            this._lastCaptionText = ''; // dedupe: only re-show caption on a NEW reply
            this._capFullText = ''; // full reply being played as chunk subtitles
            this._capConsumed = 0; // characters already shown as chunks
            this._chunkPlaying = false; // chunk playback in progress
            this._savedCam = null; // desktop camera framing, restored on close

            // In-page overlay + video-PiP source-hiding state.
            this._overlayEl = null;
            this._overlayRO = null; // ResizeObserver for the overlay
            this._sourceNote = null; // "avatar is floating" note shown over the hidden source

            // Live (hands-free) conversation state.
            this._live = false;
            this._convState = 'idle'; // 'idle' | 'listening' | 'thinking' | 'speaking'
            this._heardSpeaking = false;
            this._speakObserver = null; // watches #status-indicator for TTS start/end
            this._liveRestartTimer = null;
            this._replyTimeout = null;
            this._echoGuardUntil = 0; // ignore mic input until this time (skip TTS tail)
            this._srOwner = null; // 'live' | 'ptt' — who owns the current SR session
            this._muted = false; // phone mode: mic muted by the user (call stays open)

            // Ambient (Alexa-style) bubble HUD state.
            this._compCanvas = null; // composite canvas streamed into the PiP bubble
            this._compTimer = null; // HUD repaint interval
            this._compRAF = null; // rAF that copies the live WebGL frame into the cache
            this._bubbleCaption = ''; // latest heard phrase / reply, painted as caption
            this._bubbleCaptionTimer = null;
            this._bubbleObserver = null; // mirrors chat history into the bubble caption
            this._visHandler = null; // visibility gate: keep-alive vs SpeechRecognition
            this._srFails = 0; // consecutive fruitless recognition attempts
            this._lastSrError = null; // last SpeechRecognition error type

            // Wake word ("Hey Ava") standby state.
            this._standby = false;
            this._standbySr = null;
            this._standbyRestartTimer = null;
            this._standbyFails = 0;
            this._lastStandbyError = null;
            this._wakeIdleTimer = null; // returns a quiet conversation to standby
            this._preMaxRect = null; // widget rect before expand-to-fullscreen
            this._kbHandler = null; // visualViewport keyboard-avoidance listener
            this._preKbTransform = undefined; // widget transform before keyboard lift

            // Silent standby front-end (VAD) + earcons.
            this._vadStream = null; // silent getUserMedia stream for energy monitoring
            this._vadCtx = null; // AudioContext used by the analyser
            this._vadTimer = null; // RMS polling interval
            this._earconCtx = null; // shared AudioContext for wake/sleep chimes

            // Utterance endpointing (assistant-style): accumulate recognition
            // segments and commit only after a short silence, so multi-word
            // sentences are never cut at the first finalized chunk.
            this._turnStartIndex = 0; // first result index of the current turn
            this._lastResultsLen = 0; // latest event.results.length seen
            this._endpointTimer = null; // silence timer that commits the turn
            this._turnText = ''; // accumulated transcript of the current turn
            this._audioEndTimer = null; // polls real audio to hand the mic back naturally
            this._sawReplyAudio = false; // reply audio actually started
            this._ttsBusy = false; // true while a pluggable TTS engine (Piper) is speaking
            this._ttsHooked = false; // TTSProvider.speak wrapper installed once
            this._micKeepAlive = null; // getUserMedia track that keeps the mic alive backgrounded
        }

        /* ---- live handles, resolved lazily so wiring order never matters ---- */

        get renderer() {
            return this._renderer || window.NEXUS_VIEWER?.renderer || window.renderer || null;
        }

        get scene() {
            return this._scene || window.NEXUS_VIEWER?.scene || window.scene || null;
        }

        get camera() {
            return window.NEXUS_VIEWER?.camera || window.camera || null;
        }

        get canvas() {
            return (
                this.renderer?.domElement ||
                document.querySelector('#avatar-viewport canvas') ||
                document.querySelector('canvas')
            );
        }

        /**
         * The companion is universally available: even without any Picture-in-
         * Picture support, the in-page transparent overlay works with just DOM +
         * canvas. (Kept as a method so hosts can still branch on it.)
         */
        static isSupported() {
            return true;
        }

        /** True where an OS-level always-on-top PiP path exists (over other apps). */
        static hasPiP() {
            if ('documentPictureInPicture' in window) return true;
            if (typeof document !== 'undefined' && document.pictureInPictureEnabled) return true;
            try {
                const v = document.createElement('video');
                if (typeof v.webkitSetPresentationMode === 'function') return true;
            } catch (_) {}
            return false;
        }

        /** iPhone / iPad / iPod (incl. iPadOS reporting as desktop Safari). */
        static isIOS() {
            const ua = navigator.userAgent || '';
            return /iPhone|iPad|iPod/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
        }

        /** Any handset / tablet — used to pick mobile-appropriate wording. */
        static isMobile() {
            return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '') || CompanionMode.isIOS();
        }

        /**
         * Overlay settings, backed by localStorage (Settings ▸ Overlay).
         * Additive: absent keys fall back to sensible defaults, so the mode
         * works with zero configuration. Conversation window is OFF by default.
         */
        static getSettings() {
            const read = (key, def) => {
                try {
                    const v = localStorage.getItem('overlay_' + key);
                    return v === null ? def : v;
                } catch (_) {
                    return def;
                }
            };
            return {
                controls: read('controls', 'on') !== 'off', // mic + text bar
                subtitle: read('subtitle', 'on') !== 'off', // latest-reply caption
                chunkSubs: read('chunksubs', 'on') !== 'off', // movie-style chunked captions
                chatwindow: read('chatwindow', 'off') === 'on', // full transcript (default off)
                transparent: read('transparent', 'on') !== 'off', // float on transparent bg
                floatOverApps: read('floatoverapps', 'off') === 'on', // mobile: opaque PiP over other apps
                wakeWord: read('wakeword', 'off') === 'on', // standby listener ("Hey Ava")
                wakePhrase: (read('wakephrase', 'nexus') || 'nexus').toLowerCase().trim(),
            };
        }

        /**
         * Shared, class-based stylesheet for the companion UI. Works in both a
         * Document-PiP window and an in-page overlay because everything is
         * positioned relative to `.cm-root` (which fills its container).
         */
        static baseCSS() {
            return (
                '.cm-root{position:relative;width:100%;height:100%;overflow:hidden}' +
                '.cm-root>canvas{width:100%!important;height:100%!important;display:block;touch-action:none}' +
                // subtitle
                // Subtitles sit ABOVE the input bar and out of the phone's unsafe
                // zones. Without the bottom inset the last line lands under the
                // Android gesture bar (and behind the iOS home indicator) and is
                // visibly clipped — worst in fullscreen, where 100dvh includes
                // the area those overlay.
                '.cm-cap{position:absolute;' +
                'left:calc(env(safe-area-inset-left,0px) + 10px);' +
                'right:calc(env(safe-area-inset-right,0px) + 10px);' +
                'bottom:calc(env(safe-area-inset-bottom,0px) + 56px);overflow:hidden;' +
                'display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;' +
                'text-align:center;font:13px/1.4 system-ui,sans-serif;color:#eef1f8;text-shadow:0 1px 3px #000;' +
                'background:linear-gradient(0deg,rgba(8,12,22,.55),rgba(8,12,22,0));border-radius:10px;padding:4px 6px;' +
                'opacity:0;transition:opacity .25s;pointer-events:none}' +
                '.cm-cap.show{opacity:1}' +
                // chunk subtitles OFF → the whole reply at once, up to 6 lines
                '.cm-cap.full{-webkit-line-clamp:6}' +
                // chat bar (baseline slightly visible so touch devices see it)
                '.cm-bar{position:absolute;left:0;right:0;bottom:0;display:flex;gap:6px;align-items:center;' +
                'padding:6px;background:linear-gradient(transparent,rgba(10,12,20,.72));' +
                'opacity:.4;transition:opacity .2s}' +
                '.cm-root:hover .cm-bar,.cm-bar:focus-within,.cm-bar.touched{opacity:1}' +
                '.cm-mic{flex:0 0 auto;width:32px;height:32px;border:0;border-radius:50%;cursor:pointer;' +
                'font-size:15px;line-height:32px;background:#4f7cff;color:#fff;box-shadow:0 2px 8px rgba(0,0,0,.4)}' +
                '.cm-mic.listening{background:#e5484d;animation:cmpulse 1s infinite}' +
                '.cm-mic.muted{background:#6b7280;animation:none}' +
                '@keyframes cmpulse{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}' +
                // live (hands-free) conversation toggle + status pill
                '.cm-live{flex:0 0 auto;width:32px;height:32px;border:0;border-radius:50%;cursor:pointer;' +
                'font-size:15px;line-height:32px;background:rgba(255,255,255,.16);color:#fff}' +
                '.cm-live.on{background:#2ec36b;animation:cmpulse 1.4s infinite}' +
                '.cm-state{position:absolute;top:8px;left:50%;transform:translateX(-50%);padding:4px 12px;' +
                'border-radius:999px;font:12px system-ui,sans-serif;color:#fff;background:rgba(12,14,22,.72);' +
                'opacity:0;transition:opacity .2s;pointer-events:none;white-space:nowrap;z-index:3}' +
                '.cm-state.show{opacity:1}' +
                '.cm-input{flex:1 1 auto;min-width:0;height:30px;border:0;border-radius:15px;padding:0 12px;' +
                'font:13px system-ui,sans-serif;background:rgba(255,255,255,.14);color:#fff;outline:none}' +
                '.cm-input::placeholder{color:rgba(255,255,255,.55)}' +
                // type="search" opts out of Chrome's payment/address autofill;
                // reset the control (iOS imposes searchfield metrics) and hide
                // the UA's cancel decoration so it still reads as a chat input.
                '.cm-input{-webkit-appearance:none;appearance:none}' +
                '.cm-input::-webkit-search-cancel-button,.cm-input::-webkit-search-decoration{-webkit-appearance:none;appearance:none;display:none}' +
                '.cm-send{flex:0 0 auto;width:30px;height:30px;border:0;border-radius:50%;cursor:pointer;' +
                'font-size:14px;background:rgba(255,255,255,.16);color:#fff}' +
                // transcript panel — a SHORT bottom sheet so the avatar stays
                // visible above it (no full-cover, no blur over the character)
                '.cm-log{position:absolute;left:8px;right:8px;bottom:46px;max-height:38%;overflow-y:auto;' +
                'display:flex;flex-direction:column;gap:5px;padding:8px;border-radius:12px;' +
                'background:linear-gradient(rgba(12,14,22,.15),rgba(12,14,22,.72));scrollbar-width:thin;' +
                '-webkit-mask-image:linear-gradient(transparent,#000 18px);mask-image:linear-gradient(transparent,#000 18px)}' +
                '.cm-log::-webkit-scrollbar{width:6px}' +
                '.cm-log::-webkit-scrollbar-thumb{background:rgba(255,255,255,.18);border-radius:3px}' +
                '.cm-msg{max-width:82%;padding:6px 10px;border-radius:12px;font-size:12px;line-height:1.4;' +
                'word-wrap:break-word;white-space:pre-wrap}' +
                '.cm-msg.user{align-self:flex-end;background:#4f7cff;color:#fff;border-bottom-right-radius:4px}' +
                '.cm-msg.bot{align-self:flex-start;background:rgba(255,255,255,.14);color:#eef1f8;' +
                'border-bottom-left-radius:4px}' +
                // in-page overlay shell + drag handle + close
                // subtle vignette so the character reads against any background,
                // while the edges stay transparent (you still see what's behind)
                // Opens CENTERED; the transform is cleared as soon as the user
                // drags/resizes/maximizes (those anchor to left/top in px).
                '.cm-overlay{position:fixed;z-index:2147483000;left:50%;top:50%;' +
                'transform:translate(-50%,-50%);width:46vw;' +
                'height:62vh;min-width:160px;min-height:220px;max-width:97vw;max-height:92vh;' +
                'border-radius:18px;overflow:hidden;' +
                'background:radial-gradient(120% 85% at 50% 34%,rgba(10,16,30,.5),rgba(10,16,30,.12) 62%,rgba(10,16,30,0) 100%);' +
                'box-shadow:0 10px 34px rgba(0,0,0,.4);touch-action:none}' +
                'html.is-mobile .cm-overlay{width:64vw;height:66vh}' +
                // maximized = a MODAL immersive state, not a bigger widget:
                // true edge-to-edge (100dvw/100dvh respects mobile browser bars),
                // opaque backdrop so the page never bleeds through or receives
                // touches, square corners, smooth 200ms transition both ways.
                '.cm-overlay{transition:left .2s ease,top .2s ease,width .2s ease,height .2s ease,border-radius .2s ease}' +
                // vw/vh first as the fallback: a browser without dvh support
                // drops the whole declaration, which would leave the widget at
                // its inline size and make ⛶ look broken. dvh wins where known.
                '.cm-overlay.cm-max{left:0!important;top:0!important;right:auto!important;bottom:auto!important;' +
                'transform:none!important;width:100vw!important;height:100vh!important;' +
                'width:100dvw!important;height:100dvh!important;' +
                // The widget rule caps size at 97vw/92vh, and a max-* always
                // clamps width/height no matter how !important they are — so
                // without this "fullscreen" stopped 12px short horizontally and
                // 73px short vertically, leaving exactly the visible, tappable
                // page edges this state exists to remove.
                'max-width:none!important;max-height:none!important;border-radius:0;' +
                'background:radial-gradient(120% 85% at 50% 34%,#141b2e 0%,#0b101d 62%,#070b14 100%);' +
                'box-shadow:none;z-index:2147483400}' +
                // fullscreen hides everything non-essential: drag grip/label
                // (nothing is draggable) — one control cluster remains, padded
                // into the safe areas (notch / gesture bar).
                '.cm-overlay.cm-max .cm-drag{background:none;justify-content:flex-end;' +
                'padding-top:env(safe-area-inset-top,0px);padding-right:calc(env(safe-area-inset-right,0px) + 6px);height:auto}' +
                '.cm-overlay.cm-max .cm-grip{display:none}' +
                '.cm-overlay.cm-max .cm-bar{padding-bottom:calc(env(safe-area-inset-bottom,0px) + 8px)}' +
                // …and the caption clears that taller bar in fullscreen.
                '.cm-overlay.cm-max .cm-cap{bottom:calc(env(safe-area-inset-bottom,0px) + 68px)}' +
                // corner resize grip (bottom-right), always visible on touch devices
                '.cm-resize{position:absolute;right:0;bottom:0;width:34px;height:34px;cursor:nwse-resize;' +
                'touch-action:none;z-index:3;display:flex;align-items:flex-end;justify-content:flex-end;padding:5px;' +
                'color:rgba(255,255,255,.55);font-size:13px;user-select:none}' +
                '.cm-overlay.cm-max .cm-resize{display:none}' +
                '.cm-expand{width:22px;height:22px;border:0;border-radius:6px;background:rgba(0,0,0,.45);' +
                'color:#fff;font-size:12px;line-height:22px;cursor:pointer;padding:0;margin-right:6px}' +
                // touch devices have no hover — keep controls visible
                '@media (hover:none){.cm-bar{opacity:1}.cm-drag{opacity:.85}}' +
                // SINGLE INPUT: while the in-page companion is open, it owns the
                // conversation — hide the page's own chat footer so there is only
                // one place to talk (no confusing duplicate input).
                'html.companion-active .chat-input-shell{display:none!important}' +
                '.cm-drag{position:absolute;top:0;left:0;right:0;height:30px;display:flex;align-items:center;' +
                'justify-content:space-between;padding:0 8px;cursor:grab;color:#cdd3e0;font-size:12px;' +
                'background:linear-gradient(rgba(10,12,20,.6),transparent);opacity:.45;transition:opacity .2s;' +
                'touch-action:none;user-select:none}' +
                '.cm-root:hover .cm-drag,.cm-drag.touched{opacity:1}' +
                '.cm-close{width:22px;height:22px;border:0;border-radius:50%;background:rgba(0,0,0,.45);' +
                'color:#fff;font-size:12px;line-height:22px;cursor:pointer;padding:0}'
            );
        }

        /** Inject baseCSS into a document once (id="cm-style"). */
        _ensureStyle(doc) {
            if (doc.getElementById('cm-style')) return;
            const s = doc.createElement('style');
            s.id = 'cm-style';
            s.textContent = CompanionMode.baseCSS();
            doc.head.appendChild(s);
        }

        /* ------------------------------------------------------------------ */
        /* Public API                                                          */
        /* ------------------------------------------------------------------ */

        async toggle(mode) {
            return this.active ? this.deactivate() : this.activate(mode);
        }

        /**
         * Pick the best surface:
         *  - explicit mode wins ('document' | 'video' | 'inpage')
         *  - desktop: Document PiP (real canvas, floats over other windows)
         *  - mobile: an in-page transparent overlay by default (no duplicate,
         *    shows the real app behind, hosts chat). Video PiP is opt-in via the
         *    "float over other apps" setting — it's an opaque OS bubble.
         */
        _chooseStrategy(mode) {
            if (mode === 'document' || mode === 'video' || mode === 'inpage') return mode;
            const s = CompanionMode.getSettings();
            if (CompanionMode.isMobile()) return s.floatOverApps ? 'video' : 'inpage';
            if ('documentPictureInPicture' in window) return 'document';
            return s.floatOverApps ? 'video' : 'inpage';
        }

        async activate(mode) {
            if (this.active) return;
            const strategy = this._chooseStrategy(mode);
            try {
                if (strategy === 'document') await this._activateDocumentPiP();
                else if (strategy === 'video') await this._activateVideoPiP();
                else await this._activateInPageOverlay();
            } catch (err) {
                // A rejection here (e.g. user gesture required, or PiP blocked)
                // leaves the app exactly as it was — restore defensively.
                console.warn('[CompanionMode] activate failed:', err);
                if (this.strategy === 'document-pip') this._restore();
                else if (this.strategy === 'inpage-overlay') this._restoreInPage();
                else this._teardownVideoPiP();
                throw err;
            }
        }

        async deactivate() {
            if (!this.active) return;
            this.stopStandby(); // wake word lives and dies with the companion
            if (this.strategy === 'document-pip') this._pipWindow?.close();
            else if (this.strategy === 'inpage-overlay') this._restoreInPage();
            else this._teardownVideoPiP();
            // For Document PiP, close() triggers 'pagehide' which invokes _restore().
        }

        /**
         * One-tap "call": open the companion on an interactive surface and start
         * hands-free live conversation immediately. Powers the 📞 button, the
         * ?mode=call deep link and the PWA "Call companion" shortcut.
         */
        async callNow(mode) {
            if (!this.active) {
                // Never open the opaque over-apps bubble for a call — it can't host voice UI.
                await this.activate(mode || (CompanionMode.isMobile() ? 'inpage' : undefined));
            }
            // video-pip is fine too: the bubble is only the face — the mic,
            // STT and TTS all run here in the page underneath.
            if (!this._live) this._startLive();
        }

        /** Is an AI provider configured? (companion chat needs one to reply) */
        _providerReady() {
            try {
                const p = localStorage.getItem('ai_provider');
                return !!p && p !== 'none';
            } catch (_) {
                return true; // don't nag if storage is unavailable
            }
        }

        /** One-time nudge if the companion can't actually reply yet. */
        _maybeWarnProvider() {
            if (this._providerReady()) return;
            this._toast('Connect an AI provider in Settings ▸ AI Provider so I can reply.');
        }

        /* ------------------------------------------------------------------ */
        /* Strategy A — Document Picture-in-Picture (live, interactive)        */
        /* ------------------------------------------------------------------ */

        async _activateDocumentPiP() {
            const canvas = this.canvas;
            if (!canvas) throw new Error('CompanionMode: no renderer canvas found');

            // Snapshot original placement + size for a lossless restore.
            this._placeholder = document.createComment('companion-mode-canvas-slot');
            this._savedCanvasStyle = canvas.getAttribute('style');
            this._savedSize = {
                w: canvas.clientWidth || canvas.parentElement?.clientWidth || window.innerWidth,
                h: canvas.clientHeight || canvas.parentElement?.clientHeight || window.innerHeight,
            };

            const pip = await window.documentPictureInPicture.requestWindow({
                width: this.width,
                height: this.height,
            });
            this._pipWindow = pip;

            // Read Overlay settings (Settings ▸ Overlay) for this session.
            this._cfg = CompanionMode.getSettings();
            this.transparentBackground = this._cfg.transparent;

            // Signal to the host app (e.g. ViewerEngine.resize guard) that the
            // viewport is detached, so nothing resizes it back underneath us.
            window.__COMPANION_ACTIVE__ = true;

            // Body reset for the PiP window + the shared companion stylesheet.
            // NOTE: `background:transparent` on a top-level context paints the
            // UA default (WHITE) — a browser window can never be see-through
            // to the OS desktop. So we paint the same designed dark vignette
            // the in-page overlay uses; true per-pixel transparency over
            // Windows lives in desktop-shell/ (Electron), not in the browser.
            const reset = pip.document.createElement('style');
            reset.textContent =
                'html,body{margin:0;height:100%;overflow:hidden;' +
                'background:radial-gradient(120% 85% at 50% 34%,#141b2e 0%,#0b101d 62%,#070b14 100%);' +
                '-webkit-user-select:none;user-select:none}';
            pip.document.head.appendChild(reset);
            this._ensureStyle(pip.document);
            pip.document.title = 'Companion';

            // One-time honest hint: a browser window can't be transparent over
            // the OS — the repo's Electron shell (desktop-shell/) can.
            try {
                if (localStorage.getItem('overlay_shellhint') !== '1') {
                    localStorage.setItem('overlay_shellhint', '1');
                    this._toast(
                        '\ud83d\udda5\ufe0f Want the avatar truly transparent over your desktop? ' +
                            'Run the desktop shell: desktop-shell/ \u2192 npm install && npm start'
                    );
                }
            } catch (_) {}

            // Turn the scene transparent so the character floats (desktop-pet look).
            this._enableTransparentBackground();

            // A .cm-root fills the window and hosts the moved canvas + chat UI.
            const root = pip.document.createElement('div');
            root.className = 'cm-root';
            pip.document.body.appendChild(root);
            this._root = root;

            // Move the LIVE canvas — the WebGL context survives a same-agent move.
            canvas.parentNode.insertBefore(this._placeholder, canvas);
            root.appendChild(canvas);

            // Voice + text + subtitle, so you can actually talk to the avatar here.
            if (this.interactive) this._buildCompanionUI(root, pip.document);

            const win = pip.window ?? pip;
            this._fit = () => {
                const w = win.innerWidth;
                const h = win.innerHeight;
                this.renderer?.setSize(w, h, false);
                this.onResize?.(w, h);
            };
            this._fit();
            win.addEventListener('resize', this._fit);
            win.addEventListener('pagehide', () => this._restore(), { once: true });

            this.strategy = 'document-pip';
            this.active = true;
            this._setButtonState(true);
            this._maybeWarnProvider();
        }

        _restore() {
            this.stopStandby(); // native close (pagehide) bypasses deactivate()
            const canvas = this.canvas;
            if (this._placeholder && canvas && this._placeholder.parentNode) {
                this._placeholder.parentNode.insertBefore(canvas, this._placeholder);
                this._placeholder.remove();
                if (this._savedCanvasStyle === null) canvas.removeAttribute('style');
                else canvas.setAttribute('style', this._savedCanvasStyle);
                if (this._savedSize) {
                    this.renderer?.setSize(this._savedSize.w, this._savedSize.h, false);
                    this.onResize?.(this._savedSize.w, this._savedSize.h);
                }
            }
            this._disableTransparentBackground();

            // Tear down the interaction layer (voice + subtitle mirror).
            this._teardownInteraction();

            this._placeholder = null;
            this._pipWindow = null;
            this._root = null;
            this._fit = null;
            this.strategy = null;
            this.active = false;
            window.__COMPANION_ACTIVE__ = false;
            this._setButtonState(false);
        }

        /* ------------------------------------------------------------------ */
        /* Strategy C — In-page transparent overlay (mobile default)           */
        /*                                                                     */
        /* Moves (not mirrors) the canvas into a small draggable widget that   */
        /* floats over the app. Transparent, so the real page shows behind —   */
        /* no duplicate, no black box — and it hosts the full chat UI.         */
        /* ------------------------------------------------------------------ */

        _activateInPageOverlay() {
            const canvas = this.canvas;
            if (!canvas) throw new Error('CompanionMode: no renderer canvas found');

            this._cfg = CompanionMode.getSettings();
            this.transparentBackground = this._cfg.transparent;

            // Snapshot for a lossless restore.
            this._placeholder = document.createComment('companion-mode-canvas-slot');
            this._savedCanvasStyle = canvas.getAttribute('style');
            this._savedSize = {
                w: canvas.clientWidth || canvas.parentElement?.clientWidth || window.innerWidth,
                h: canvas.clientHeight || canvas.parentElement?.clientHeight || window.innerHeight,
            };

            this._ensureStyle(document);
            this._enableTransparentBackground();

            // Single-input mental model: the companion owns the conversation, so
            // hide the page's own chat footer while it's open.
            document.documentElement.classList.add('companion-active');

            // Floating widget shell.
            const overlay = document.createElement('div');
            overlay.className = 'cm-root cm-overlay';
            this._overlayEl = overlay;
            this._root = overlay;

            // Drag handle + close.
            const drag = document.createElement('div');
            drag.className = 'cm-drag';
            const grip = document.createElement('span');
            grip.className = 'cm-grip';
            grip.textContent = '⠿ drag';
            const expand = document.createElement('button');
            expand.type = 'button';
            expand.className = 'cm-expand';
            expand.textContent = '\u26f6';
            expand.title = 'Expand / restore';
            expand.addEventListener('click', () => this._toggleMaximize());
            const close = document.createElement('button');
            close.type = 'button';
            close.className = 'cm-close';
            close.textContent = '\u2715';
            close.title = 'Bring the avatar back';
            close.addEventListener('click', () => this.deactivate());
            const right = document.createElement('span');
            right.style.display = 'flex';
            right.append(expand, close);
            drag.append(grip, right);
            overlay.appendChild(drag);

            // Remembered size (user resized it before) — clamped to the viewport.
            try {
                const w = parseInt(localStorage.getItem('overlay_w'), 10);
                const h = parseInt(localStorage.getItem('overlay_h'), 10);
                if (w > 0) overlay.style.width = Math.min(w, window.innerWidth * 0.97) + 'px';
                if (h > 0) overlay.style.height = Math.min(h, window.innerHeight * 0.92) + 'px';
            } catch (_) {}

            // Corner resize grip.
            const rgrip = document.createElement('div');
            rgrip.className = 'cm-resize';
            rgrip.textContent = '\u25e2';
            rgrip.title = 'Resize';
            overlay.appendChild(rgrip);

            document.body.appendChild(overlay);

            // Move the LIVE canvas into the widget (no mirror → no duplicate).
            canvas.parentNode.insertBefore(this._placeholder, canvas);
            overlay.appendChild(canvas);

            // Own the sizing while detached.
            window.__COMPANION_ACTIVE__ = true;

            const fit = () => {
                const w = overlay.clientWidth || 260;
                const h = overlay.clientHeight || 360;
                this.renderer?.setSize(w, h, false);
                this.onResize?.(w, h);
            };
            this._fit = fit;
            fit();
            if (window.ResizeObserver) {
                this._overlayRO = new ResizeObserver(fit);
                this._overlayRO.observe(overlay);
            }

            if (this.interactive) this._buildCompanionUI(overlay, document);
            this._makeDraggable(overlay, drag);
            this._makeResizable(overlay, rgrip);
            if (CompanionMode.isMobile()) this._bindKeyboardAvoidance();
            this._fitAvatarToWidget(); // zoom the avatar to fill the widget
            // Open facing the user. On touch devices the head follows the last
            // touch, which was almost certainly the button that opened this —
            // without a reset she greets you looking at the screen edge.
            window.NEXUS_PROCEDURAL_ANIMATOR?.recenterGaze?.();

            this.strategy = 'inpage-overlay';
            this.active = true;
            this._setButtonState(true);
            this._maybeWarnProvider();
            this._saveResume();
            // Companion is open: arm the wake word (no-op if disabled).
            setTimeout(() => this.startStandby(), 400);
        }

        /* ------------------------------------------------------------------ */
        /* Cross-page continuity                                                */
        /*                                                                     */
        /* A page navigation destroys the document, its DOM and the WebGL      */
        /* context, so the overlay can't literally survive it. Instead we      */
        /* remember (per browser tab) that the in-page companion was open and  */
        /* re-open it on the next page that has the avatar engine — restoring  */
        /* its position. The conversation itself already persists via the      */
        /* app's own chat history. (PiP/video need a user gesture, so they     */
        /* can't silently auto-resume — only the in-page overlay can.)         */
        /* ------------------------------------------------------------------ */

        _saveResume() {
            try {
                if (this.strategy !== 'inpage-overlay') return;
                const el = this._overlayEl;
                sessionStorage.setItem(
                    'companion_resume',
                    JSON.stringify({
                        strategy: 'inpage-overlay',
                        live: this._live,
                        pos: el ? { left: el.style.left, top: el.style.top } : null,
                        size: el ? { w: el.offsetWidth, h: el.offsetHeight } : null,
                        max: !!el?.classList.contains('cm-max'),
                    })
                );
            } catch (_) {}
        }

        _clearResume() {
            try {
                sessionStorage.removeItem('companion_resume');
            } catch (_) {}
        }

        static readResume() {
            try {
                return JSON.parse(sessionStorage.getItem('companion_resume') || 'null');
            } catch (_) {
                return null;
            }
        }

        _restoreInPage() {
            this.stopStandby(); // defensive-restore path can bypass deactivate()
            this._unbindKeyboardAvoidance();
            this._restoreCameraFraming(); // undo the widget zoom — desktop framing back
            this._lastCaptionText = '';
            this._capFullText = '';
            this._capConsumed = 0;
            this._chunkPlaying = false;
            const canvas = this.canvas;
            if (this._placeholder && canvas && this._placeholder.parentNode) {
                this._placeholder.parentNode.insertBefore(canvas, this._placeholder);
                this._placeholder.remove();
                if (this._savedCanvasStyle === null) canvas.removeAttribute('style');
                else canvas.setAttribute('style', this._savedCanvasStyle);
            }
            this._disableTransparentBackground();
            this._teardownInteraction();

            // Closing FROM the maximized state must undo everything maximizing
            // did, or the app's own ⛶ stays hidden for the rest of the session
            // and the browser stays in fullscreen with no companion to exit it.
            this._syncMaxChrome(false);
            this._exitNativeFullscreen();
            this._unbindFullscreenSync();

            // Restore the page's own chat footer (single-input model) and forget
            // the resume flag — an explicit close means "don't reopen next page".
            document.documentElement.classList.remove('companion-active');
            this._clearResume();

            if (this._overlayRO) {
                try {
                    this._overlayRO.disconnect();
                } catch (_) {}
                this._overlayRO = null;
            }
            this._overlayEl?.remove();
            this._overlayEl = null;
            this._root = null;
            this._placeholder = null;
            this._fit = null;
            this.strategy = null;
            this.active = false;
            window.__COMPANION_ACTIVE__ = false;

            // Restore the in-page canvas to its normal size.
            if (this._savedSize) {
                this.renderer?.setSize(this._savedSize.w, this._savedSize.h, false);
                this.onResize?.(this._savedSize.w, this._savedSize.h);
            }
            // Nudge the app to re-fit to the viewport now the flag is clear.
            try {
                window.NEXUS_VIEWER?.resize?.();
            } catch (_) {}
            this._setButtonState(false);
        }

        /** Pointer-drag the overlay by its handle, clamped to the viewport. */
        _makeDraggable(overlay, handle) {
            let sx = 0,
                sy = 0,
                ox = 0,
                oy = 0,
                dragging = false;
            const onDown = (e) => {
                dragging = true;
                handle.classList.add('touched');
                const r = overlay.getBoundingClientRect();
                // Switch to top/left positioning for free movement (and drop the
                // centering transform, or the widget would jump by half its size).
                overlay.style.transform = 'none';
                overlay.style.right = 'auto';
                overlay.style.bottom = 'auto';
                overlay.style.left = r.left + 'px';
                overlay.style.top = r.top + 'px';
                ox = r.left;
                oy = r.top;
                sx = e.clientX;
                sy = e.clientY;
                handle.setPointerCapture?.(e.pointerId);
                e.preventDefault();
            };
            const onMove = (e) => {
                if (!dragging) return;
                const w = overlay.offsetWidth;
                const h = overlay.offsetHeight;
                let nx = ox + (e.clientX - sx);
                let ny = oy + (e.clientY - sy);
                nx = Math.max(4, Math.min(nx, window.innerWidth - w - 4));
                ny = Math.max(4, Math.min(ny, window.innerHeight - h - 4));
                overlay.style.left = nx + 'px';
                overlay.style.top = ny + 'px';
            };
            const onUp = (e) => {
                dragging = false;
                handle.classList.remove('touched');
                handle.releasePointerCapture?.(e.pointerId);
                this._saveResume(); // remember where the user parked it
            };
            handle.addEventListener('pointerdown', onDown);
            handle.addEventListener('pointermove', onMove);
            handle.addEventListener('pointerup', onUp);
            handle.addEventListener('pointercancel', onUp);
        }

        /** Corner-grip resize: drag the bottom-right handle to any size. */
        /* ------------------------------------------------------------------ */
        /* Android keyboard avoidance.                                          */
        /* Since Chrome 108, the virtual keyboard only shrinks the VISUAL      */
        /* viewport — the layout viewport (and 100dvh) stay full height, and   */
        /* the browser cannot scroll a position:fixed overlay to reveal the    */
        /* focused input. Result: the companion's input bar hides UNDER the    */
        /* keyboard. Fix: track visualViewport and (a) in fullscreen, pin the  */
        /* overlay to the visible area; (b) in widget mode, lift the overlay   */
        /* just enough to clear the keyboard. Everything restores on close.    */
        /* ------------------------------------------------------------------ */
        _bindKeyboardAvoidance() {
            const vv = window.visualViewport;
            if (!vv || this._kbHandler) return;
            const KB_MIN = 40; // ignore URL-bar jitter
            this._kbHandler = () => {
                const el = this._overlayEl;
                if (!el) return;
                const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
                if (el.classList.contains('cm-max')) {
                    // Fullscreen: the companion IS the screen — fit it to the
                    // visible viewport so the bar sits right above the keys.
                    //
                    // setProperty(..., 'important') is REQUIRED: the .cm-max rule
                    // declares top/height with !important (it has to, to beat the
                    // widget rule), and a stylesheet !important beats a NORMAL
                    // inline style. Assigning el.style.top here would be silently
                    // ignored and the input would stay under the keyboard.
                    if (kb > KB_MIN) {
                        el.style.setProperty('top', vv.offsetTop + 'px', 'important');
                        el.style.setProperty('height', vv.height + 'px', 'important');
                    } else {
                        el.style.removeProperty('top');
                        el.style.removeProperty('height'); // back to the 100dvh class rule
                    }
                    // ViewerEngine listens to visualViewport and refits the
                    // canvas on its own (debounced), so no manual resize here.
                } else {
                    // Widget: lift only by the actual overlap with the keys.
                    if (kb > KB_MIN) {
                        if (this._preKbTransform === undefined) this._preKbTransform = el.style.transform || '';
                        // Measure from the RESTING position, not the lifted one:
                        // the keyboard can change height (emoji panel, autocorrect
                        // strip), and measuring the already-shifted rect could only
                        // ever add more lift, never reduce it.
                        el.style.transform = this._preKbTransform;
                        const r = el.getBoundingClientRect();
                        const overlap = r.bottom - (vv.offsetTop + vv.height) + 8;
                        if (overlap > 0) {
                            // 'none' is NOT composable: "none translateY(-8px)" is
                            // invalid CSS, so the whole declaration is dropped and
                            // the widget silently does not move. Dragging the widget
                            // sets transform:'none' — precisely the parked-at-the-
                            // bottom case this exists for.
                            const base =
                                this._preKbTransform && this._preKbTransform !== 'none'
                                    ? this._preKbTransform + ' '
                                    : '';
                            el.style.transform = base + 'translateY(' + -Math.round(overlap) + 'px)';
                        }
                    } else if (this._preKbTransform !== undefined) {
                        el.style.transform = this._preKbTransform;
                        this._preKbTransform = undefined;
                    }
                }
            };
            vv.addEventListener('resize', this._kbHandler);
            vv.addEventListener('scroll', this._kbHandler);
        }

        _unbindKeyboardAvoidance() {
            const vv = window.visualViewport;
            if (vv && this._kbHandler) {
                vv.removeEventListener('resize', this._kbHandler);
                vv.removeEventListener('scroll', this._kbHandler);
            }
            this._kbHandler = null;
            this._preKbTransform = undefined;
        }

        _makeResizable(overlay, grip) {
            let sx = 0,
                sy = 0,
                sw = 0,
                sh = 0,
                resizing = false;
            const onDown = (e) => {
                if (overlay.classList.contains('cm-max')) return;
                resizing = true;
                const r = overlay.getBoundingClientRect();
                // Anchor top-left so growth pulls right/down under the finger
                // (clearing the centering transform first).
                overlay.style.transform = 'none';
                overlay.style.right = 'auto';
                overlay.style.bottom = 'auto';
                overlay.style.left = r.left + 'px';
                overlay.style.top = r.top + 'px';
                sw = r.width;
                sh = r.height;
                sx = e.clientX;
                sy = e.clientY;
                grip.setPointerCapture?.(e.pointerId);
                e.preventDefault();
                e.stopPropagation();
            };
            const onMove = (e) => {
                if (!resizing) return;
                const r = overlay.getBoundingClientRect();
                const maxW = window.innerWidth - r.left - 4;
                const maxH = window.innerHeight - r.top - 4;
                const w = Math.max(160, Math.min(sw + (e.clientX - sx), maxW));
                const h = Math.max(220, Math.min(sh + (e.clientY - sy), maxH));
                overlay.style.width = w + 'px';
                overlay.style.height = h + 'px';
            };
            const onUp = (e) => {
                if (!resizing) return;
                resizing = false;
                grip.releasePointerCapture?.(e.pointerId);
                // Remember the chosen size for this and future sessions.
                try {
                    localStorage.setItem('overlay_w', String(overlay.offsetWidth));
                    localStorage.setItem('overlay_h', String(overlay.offsetHeight));
                } catch (_) {}
                this._fitAvatarToWidget(); // keep the avatar filling the new size
                this._saveResume();
            };
            grip.addEventListener('pointerdown', onDown);
            grip.addEventListener('pointermove', onMove);
            grip.addEventListener('pointerup', onUp);
            grip.addEventListener('pointercancel', onUp);
        }

        /** Toggle between the floating widget and a near-fullscreen companion. */
        /**
         * Auto-zoom the camera so the avatar FILLS the companion widget
         * instead of keeping the (wide) desktop framing that leaves it tiny.
         * Uses the engine's own frameObject(); the original camera is saved
         * once and restored exactly on close — non-destructive.
         */
        _fitAvatarToWidget() {
            const engine = window.NEXUS_VIEWER;
            const cam = engine?.camera;
            const root = engine?.avatarManager?.currentRoot;
            if (!engine?.frameObject || !cam || !root) return;
            if (!this._savedCam) {
                this._savedCam = {
                    pos: cam.position.clone(),
                    quat: cam.quaternion.clone(),
                    target: engine.controls?.target?.clone?.() || null,
                };
            }
            // Next frame: the renderer/aspect resize must land first.
            requestAnimationFrame(() => {
                try {
                    engine.frameObject(root, 1.12); // tighter than desktop's 1.35
                } catch (_) {}
            });
        }

        _restoreCameraFraming() {
            const engine = window.NEXUS_VIEWER;
            const cam = engine?.camera;
            const saved = this._savedCam;
            this._savedCam = null;
            if (!cam || !saved) return;
            try {
                cam.position.copy(saved.pos);
                cam.quaternion.copy(saved.quat);
                if (saved.target && engine.controls?.target) {
                    engine.controls.target.copy(saved.target);
                    engine.controls.update?.();
                }
                cam.updateProjectionMatrix();
            } catch (_) {}
        }

        /** The app's own floating ⛶ (MobileSupport), by either access path. */
        _appFullscreenBtn() {
            return window.NEXUS_VIEWER?.mobileSupport?._fullscreenBtn || document.getElementById('fullscreen-btn');
        }

        /**
         * Everything true of the maximized state EXCEPT the class and the rect:
         * the button's icon/label, and hiding the app's own fullscreen control
         * so only one exists. Factored out because three paths need it — the
         * toggle, the cross-page resume (which re-adds cm-max and would
         * otherwise show two ⛶ again), and teardown.
         */
        _syncMaxChrome(on) {
            const expandBtn = this._overlayEl?.querySelector('.cm-expand');
            if (expandBtn) {
                expandBtn.textContent = on ? '\ud83d\uddd7' : '\u26f6';
                expandBtn.title = on ? 'Restore widget' : 'Fullscreen';
            }
            const appFsBtn = this._appFullscreenBtn();
            if (appFsBtn) appFsBtn.style.visibility = on ? 'hidden' : '';
        }

        /**
         * The user can leave browser fullscreen without touching our button —
         * Android back gesture, the system "exit fullscreen" affordance, Esc.
         * Without this the companion stays stretched to 100dvh behind a browser
         * bar, still showing 🗗 and still hiding the app's own ⛶. Sync back to
         * the widget so the state can never lie.
         */
        _bindFullscreenSync() {
            if (this._fsSyncHandler) return;
            this._fsSyncHandler = () => {
                if (!this._nativeFs || document.fullscreenElement) return;
                this._nativeFs = false; // left it externally
                if (this._overlayEl?.classList.contains('cm-max')) this._toggleMaximize();
            };
            document.addEventListener('fullscreenchange', this._fsSyncHandler);
        }

        _unbindFullscreenSync() {
            if (!this._fsSyncHandler) return;
            document.removeEventListener('fullscreenchange', this._fsSyncHandler);
            this._fsSyncHandler = null;
        }

        /** Leave real browser fullscreen if (and only if) we asked for it. */
        _exitNativeFullscreen() {
            if (!this._nativeFs) return;
            this._nativeFs = false;
            try {
                if (document.fullscreenElement) document.exitFullscreen?.()?.catch?.(() => {});
            } catch (_) {}
        }

        _toggleMaximize() {
            const el = this._overlayEl;
            if (!el) return;
            if (el.classList.contains('cm-max')) {
                el.classList.remove('cm-max');
                this._exitNativeFullscreen();
                this._syncMaxChrome(false);
                // Return to the pre-maximize rect.
                const r = this._preMaxRect;
                if (r) {
                    el.style.left = r.left;
                    el.style.top = r.top;
                    el.style.right = r.right;
                    el.style.bottom = r.bottom;
                    el.style.width = r.width;
                    el.style.height = r.height;
                    el.style.transform = r.transform; // keep centering if never moved
                }
            } else {
                this._preMaxRect = {
                    left: el.style.left,
                    top: el.style.top,
                    right: el.style.right,
                    bottom: el.style.bottom,
                    width: el.style.width,
                    height: el.style.height,
                    transform: el.style.transform,
                };
                el.classList.add('cm-max');
                // Fullscreen means FULLSCREEN on a phone: hide the browser
                // chrome too (silently skipped where unsupported).
                if (CompanionMode.isMobile() && document.documentElement.requestFullscreen) {
                    this._nativeFs = true;
                    document.documentElement.requestFullscreen().catch(() => {
                        this._nativeFs = false;
                    });
                }
                this._syncMaxChrome(true);
                this._bindFullscreenSync();
            }
            // Re-frame AFTER the 200ms transition, not during (avoids squash).
            setTimeout(() => this._fitAvatarToWidget(), 230);
            this._saveResume();
        }

        /* ------------------------------------------------------------------ */
        /* Interaction — voice-to-text + text, subtitle of avatar replies      */
        /*                                                                     */
        /* Everything routes through the app's existing pipeline               */
        /* (window.handleUserMessage), which already runs the LLM, plays TTS   */
        /* and drives lip-sync on the avatar — which is rendering right here in */
        /* the companion window. So talking here = talking to the real bot.    */
        /* ------------------------------------------------------------------ */

        _buildCompanionUI(root, doc) {
            doc = doc || root.ownerDocument;
            const cfg = this._cfg || CompanionMode.getSettings();
            const mk = (tag, cls) => {
                const el = doc.createElement(tag);
                if (cls) el.className = cls;
                return el;
            };
            this._ui = {};

            // Conversation transcript panel (opt-in, default off).
            if (cfg.chatwindow) {
                const log = mk('div', 'cm-log');
                if (!cfg.controls) log.style.bottom = '8px'; // no bar → sit at the bottom
                root.appendChild(log);
                this._ui.log = log;
            }

            // Subtitle of the latest reply — skip if the full transcript is shown.
            if (cfg.subtitle && !cfg.chatwindow) {
                const caption = mk('div', 'cm-cap');
                root.appendChild(caption);
                this._ui.caption = caption;
            }

            // Live-conversation status pill (top center).
            const state = mk('div', 'cm-state');
            root.appendChild(state);
            this._ui.state = state;

            // Voice + text bar.
            if (cfg.controls) {
                const bar = mk('div', 'cm-bar');
                const live = mk('button', 'cm-live');
                live.type = 'button';
                live.textContent = '📞';
                live.title = 'Live conversation — just talk, hands-free';
                const mic = mk('button', 'cm-mic');
                mic.type = 'button';
                mic.textContent = '🎤';
                mic.title = 'Push to talk (during a call: mute / unmute)';
                const input = mk('input', 'cm-input');
                // type="search" is the classification Chrome Android actually
                // respects — plain text fields can still get the payments/
                // address autofill bar even with autocomplete="off". The CSS
                // strips the UA's search decorations so it still looks like a
                // chat input.
                input.type = 'search';
                input.placeholder = 'Talk or type…';
                input.autocomplete = 'off';
                input.setAttribute('data-form-type', 'other');
                input.setAttribute('data-lpignore', 'true');
                const send = mk('button', 'cm-send');
                send.type = 'button';
                send.textContent = '➤';
                send.title = 'Send';

                bar.append(live, mic, input, send);
                root.appendChild(bar);
                this._ui.bar = bar;
                this._ui.live = live;
                this._ui.mic = mic;
                this._ui.input = input;

                live.addEventListener('click', () => this._toggleLive());

                const submit = () => {
                    const text = input.value.trim();
                    if (!text) return;
                    input.value = '';
                    this._sendText(text);
                };
                send.addEventListener('click', submit);
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        submit();
                    }
                });
                mic.addEventListener('click', () => this._toggleVoice());
                // Reveal on touch (no hover on mobile); don't let taps drag the widget.
                bar.addEventListener('pointerdown', (e) => {
                    e.stopPropagation();
                    bar.classList.add('touched');
                });
            }

            // Mirror the conversation into whichever surface(s) are enabled.
            if (this._ui.caption || this._ui.log) this._watchConversation();
        }

        /** Send text through the app's chat pipeline (LLM → TTS → lip-sync). */
        _sendText(text) {
            try {
                if (this._onSend) this._onSend(text);
                else if (typeof window.handleUserMessage === 'function') window.handleUserMessage(text);
                else this._toast('Chat pipeline not available.');
            } catch (err) {
                console.warn('[CompanionMode] send failed:', err);
            }
        }

        _toggleVoice() {
            if (this._live) {
                // Phone metaphor: 🎤 mutes/unmutes the call (it does NOT hang up —
                // that's 📞). The session stays hot so unmuting is instant.
                this._muted = !this._muted;
                this._ui?.mic?.classList.toggle('muted', this._muted);
                if (this._ui?.mic) this._ui.mic.textContent = this._muted ? '🔇' : '🎤';
                if (this._muted) {
                    this._stopStandbyVAD(); // release the silent listener too
                    this._setConvState('muted');
                } else {
                    this._echoGuardUntil = Date.now() + 150;
                    this._setConvState('listening');
                    if (!this._sr) this._liveVadWait();
                }
                return;
            }
            if (this._recognizing) this._stopVoice();
            else this._startVoice();
        }

        /* ------------------------------------------------------------------ */
        /* Live (hands-free) conversation — talk, it replies, it listens again */
        /* ------------------------------------------------------------------ */

        _toggleLive() {
            if (this._live) this._stopLive();
            else this._startLive();
        }

        _startLive() {
            if (this._live) return;
            this.stopStandby(); // one SpeechRecognition owner at a time
            const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SR) {
                this._toast('Voice input isn’t supported in this browser — type instead.');
                return;
            }
            if (this._onToggleMic) {
                // Host prefers to own voice — just start it and let the app drive.
                this._onToggleMic();
                return;
            }
            this._live = true;
            this._muted = false; // a new call always starts unmuted
            this._ui?.mic?.classList.remove('muted');
            if (this._ui?.mic) this._ui.mic.textContent = '🎤';
            this._stopVoice(); // release any push-to-talk session; the call owns the mic
            this._ui?.live?.classList.add('on');
            if (this._ui?.live) this._ui.live.title = 'End live conversation';
            this._watchSpeaking();
            this._setConvState('listening');
            this._liveListen();
            this._saveResume();
        }

        _stopLive() {
            this._live = false;
            this._muted = false;
            this._ui?.mic?.classList.remove('muted');
            if (this._ui?.mic) this._ui.mic.textContent = '🎤';
            this._ui?.live?.classList.remove('on');
            if (this._ui?.live) this._ui.live.title = 'Live conversation — just talk, hands-free';
            clearTimeout(this._liveRestartTimer);
            clearTimeout(this._replyTimeout);
            clearTimeout(this._endpointTimer);
            clearInterval(this._audioEndTimer);
            this._audioEndTimer = null;
            this._turnText = '';
            this._stopStandbyVAD(); // release the call's silent listener
            this._unbindKeepAliveVisibility();
            this._stopMicKeepAlive();
            this._srFails = 0;
            this._lastSrError = null;
            if (this._speakObserver) {
                try {
                    this._speakObserver.disconnect();
                } catch (_) {}
                this._speakObserver = null;
            }
            this._stopVoice();
            this._setConvState('idle');
            clearTimeout(this._wakeIdleTimer);
            // Wake-word mode: ending a conversation returns to standby.
            if (CompanionMode.getSettings().wakeWord) {
                setTimeout(() => this.startStandby(), 300);
            }
        }

        /* ------------------------------------------------------------------ */
        /* Wake word ("Hey Ava") — Alexa-style standby.                        */
        /* A continuous background listener that ONLY reacts to the wake       */
        /* phrase. On a match it opens the companion (if closed) and starts    */
        /* the hands-free live conversation; when the conversation goes quiet  */
        /* it returns to standby. Mutually exclusive with live/push-to-talk    */
        /* (one SpeechRecognition owner at a time — same mic rule as the       */
        /* keep-alive fix).                                                    */
        /* ------------------------------------------------------------------ */

        startStandby() {
            const cfg = CompanionMode.getSettings();
            // COMPANION-ONLY: the wake word is a companion feature. In the
            // default chat the mic belongs to the app's own controls.
            if (!this.active) return;
            if (!cfg.wakeWord || this._standby || this._live) return;
            const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SR) return;
            this._standby = true;
            this._standbyFails = 0;
            this._standbyVAD();
            this._setConvState('standby');
        }

        stopStandby() {
            this._standby = false;
            this._stopStandbyVAD();
            clearTimeout(this._standbyRestartTimer);
            if (this._standbySr) {
                try {
                    this._standbySr.onend = null;
                    this._standbySr.stop();
                } catch (_) {}
                this._standbySr = null;
            }
            if (this._convState === 'standby') this._setConvState('idle');
        }

        /* Silent standby front-end (industry pattern, like Alexa/Google):
         * SpeechRecognition plays the OS recording sound on EVERY session, so a
         * looping SR standby rings endlessly. Instead we hold a silent
         * getUserMedia stream and watch the audio energy (VAD). Only when real
         * speech is detected do we hand the mic to ONE short recognition pass
         * to check for the wake phrase. Silence = zero sounds, zero SR.
         * The mic-exclusivity rule holds: the VAD stream is fully stopped
         * BEFORE recognition starts, and vice versa. */
        async _standbyVAD() {
            if (!this._standby || this._live || !this.active) return;
            // Don't listen to the avatar's own voice.
            const ind = document.getElementById('status-indicator');
            if (ind?.classList.contains('speaking')) {
                this._standbyRestartTimer = setTimeout(() => this._standbyVAD(), 800);
                return;
            }
            if (!navigator.mediaDevices?.getUserMedia) {
                this._standbyListen(); // ancient browser: fall back to SR-only
                return;
            }
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                if (!this._standby || this._live || !this.active) {
                    stream.getTracks().forEach((t) => t.stop());
                    return;
                }
                this._vadStream = stream;
                const AC = window.AudioContext || window.webkitAudioContext;
                this._vadCtx = new AC();
                const srcNode = this._vadCtx.createMediaStreamSource(stream);
                const analyser = this._vadCtx.createAnalyser();
                analyser.fftSize = 512;
                srcNode.connect(analyser); // analysis only — nothing to speakers
                const buf = new Uint8Array(analyser.fftSize);
                let hot = 0; // consecutive loud frames
                let calibration = []; // ambient noise floor, first ~1s
                this._vadTimer = setInterval(() => {
                    if (!this._standby || this._live) return this._stopStandbyVAD();
                    // Self-mute while the avatar speaks.
                    if (ind?.classList.contains('speaking')) {
                        hot = 0;
                        return;
                    }
                    analyser.getByteTimeDomainData(buf);
                    let sum = 0;
                    for (let i = 0; i < buf.length; i++) {
                        const d = (buf[i] - 128) / 128;
                        sum += d * d;
                    }
                    const rms = Math.sqrt(sum / buf.length);
                    if (calibration.length < 12) {
                        calibration.push(rms);
                        return;
                    }
                    const floor = calibration.reduce((a, b) => a + b, 0) / calibration.length;
                    const threshold = Math.max(0.02, floor * 3);
                    if (rms > threshold) hot++;
                    else hot = Math.max(0, hot - 1);
                    // ~250ms of sustained voice → someone is talking: verify it.
                    if (hot >= 3) {
                        this._stopStandbyVAD();
                        this._standbyListen(); // one recognition pass
                    }
                }, 80);
            } catch (err) {
                // Mic denied/busy — same bail-out discipline as everywhere else.
                this._standbyFails = (this._standbyFails || 0) + 1;
                if (this._standbyFails >= 5 || String(err?.name).includes('NotAllowed')) {
                    this.stopStandby();
                    this._toast('Wake word paused — microphone unavailable.');
                    return;
                }
                this._standbyRestartTimer = setTimeout(
                    () => this._standbyVAD(),
                    Math.min(1000 * Math.pow(2, this._standbyFails), 8000)
                );
            }
        }

        _stopStandbyVAD() {
            clearInterval(this._vadTimer);
            this._vadTimer = null;
            if (this._vadStream) {
                try {
                    this._vadStream.getTracks().forEach((t) => t.stop());
                } catch (_) {}
                this._vadStream = null;
            }
            if (this._vadCtx) {
                try {
                    this._vadCtx.close();
                } catch (_) {}
                this._vadCtx = null;
            }
        }

        /**
         * Alexa-style earcons, synthesized (no copyrighted audio): a soft
         * two-note ascending chime on wake, descending on return to standby.
         */
        _earcon(kind) {
            try {
                const AC = window.AudioContext || window.webkitAudioContext;
                this._earconCtx = this._earconCtx || new AC();
                const ctx = this._earconCtx;
                if (ctx.state === 'suspended') ctx.resume?.().catch?.(() => {});
                const notes = kind === 'sleep' ? [740, 494] : [587, 880];
                notes.forEach((f, i) => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = 'sine';
                    osc.frequency.value = f;
                    const t0 = ctx.currentTime + i * 0.14;
                    gain.gain.setValueAtTime(0.0001, t0);
                    gain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.03);
                    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.24);
                    osc.connect(gain).connect(ctx.destination);
                    osc.start(t0);
                    osc.stop(t0 + 0.26);
                });
            } catch (_) {}
        }

        /**
         * Google-style tolerant wake-phrase match: checks every alternative,
         * slides over the words, and accepts small mishearings via edit
         * distance ("hey ava" ≈ "hey aver" / "hey. Eva").
         */
        static _matchesWake(heardNorm, phraseNorm) {
            if (!heardNorm || !phraseNorm) return -1;
            // NOTE: no raw substring shortcut — "hey ava" must not fire inside
            // "hey avatar". Matching is word-by-word below.
            const dist = (a, b) => {
                const m = a.length,
                    n = b.length;
                if (Math.abs(m - n) > 3) return 99;
                const row = Array.from({ length: n + 1 }, (_, j) => j);
                for (let i = 1; i <= m; i++) {
                    let prev = row[0];
                    row[0] = i;
                    for (let j = 1; j <= n; j++) {
                        const tmp = row[j];
                        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
                        prev = tmp;
                    }
                }
                return row[n];
            };
            const prefixLen = (a, b) => {
                let i = 0;
                while (i < a.length && i < b.length && a[i] === b[i]) i++;
                return i;
            };
            // Per-word rule: a word counts as the same word if it's exact, one
            // edit away ("eva"≈"ava"), or two edits away while sharing a 2+
            // letter prefix ("aver"≈"ava" yes, "nova"≈"ava" no).
            const wordOk = (a, b) => {
                if (a === b) return true;
                const d = dist(a, b);
                if (d <= 1) return true;
                return d <= 2 && prefixLen(a, b) >= 2;
            };
            const heardWords = heardNorm.split(' ');
            const phraseWords = phraseNorm.split(' ');
            const span = phraseWords.length;
            for (let i = 0; i + span <= heardWords.length; i++) {
                let all = true;
                for (let k = 0; k < span; k++) {
                    if (!wordOk(heardWords[i + k], phraseWords[k])) {
                        all = false;
                        break;
                    }
                }
                if (all) return heardWords.slice(0, i + span).join(' ').length;
            }
            return -1;
        }

        _standbyListen() {
            if (!this._standby || this._live) return;
            const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
            try {
                const sr = new SR();
                this._standbySr = sr;
                sr.lang = this._srLang();
                sr.interimResults = true;
                sr.continuous = false; // ONE short verification pass, then back to silent VAD
                sr.maxAlternatives = 3; // check mishearings too

                const norm = (s) =>
                    String(s || '')
                        .toLowerCase()
                        .replace(/[^\p{L}\p{N}\s]/gu, '')
                        .replace(/\s+/g, ' ')
                        .trim();
                const phrase = norm(CompanionMode.getSettings().wakePhrase);

                sr.onresult = (event) => {
                    this._standbyFails = 0;
                    const result = event.results[event.results.length - 1];
                    if (!phrase) return;
                    // Check every alternative — tolerant matching, like Google.
                    for (let a = 0; a < result.length; a++) {
                        const heard = norm(result[a]?.transcript);
                        const end = CompanionMode._matchesWake(heard, phrase);
                        if (end === -1) continue;
                        const command = heard.slice(end).trim();
                        this._onWake(command);
                        return;
                    }
                };
                sr.onerror = (e) => {
                    this._lastStandbyError = e?.error || 'unknown';
                };
                sr.onend = () => {
                    this._standbySr = null;
                    if (!this._standby || this._live) return;
                    const err = this._lastStandbyError;
                    this._lastStandbyError = null;
                    if (err === 'not-allowed' || err === 'service-not-allowed') {
                        this.stopStandby();
                        this._toast('Wake word paused — microphone access is blocked.');
                        return;
                    }
                    if (err === 'audio-capture' || err === 'aborted' || err === 'network') {
                        this._standbyFails = (this._standbyFails || 0) + 1;
                        if (this._standbyFails >= 5) {
                            this.stopStandby();
                            this._toast('Wake word paused — the microphone seems busy.');
                            return;
                        }
                    }
                    const delay = err ? Math.min(1000 * Math.pow(2, this._standbyFails || 0), 8000) : 250;
                    // Not the wake word (or silence) → back to the SILENT front-end.
                    this._standbyRestartTimer = setTimeout(() => this._standbyVAD(), delay);
                };
                sr.start();
            } catch (_) {
                if (this._standby) this._standbyRestartTimer = setTimeout(() => this._standbyVAD(), 1500);
            }
        }

        /** Wake phrase heard: open the companion, start live, run any command. */
        async _onWake(command) {
            this._earcon('wake'); // Alexa-style acknowledgment chime
            // Hand the mic from standby to the live loop.
            this.stopStandby();
            try {
                if (!this.active) await this.activate('inpage');
            } catch (_) {
                /* PiP surfaces may need a gesture; in-page never does */
            }
            this._toast(window.AppLanguage?.t?.('imListening') || '👋 I\u2019m listening');
            // Immediate "wake heard" feedback: flip the app's own status
            // indicator to LISTENING so it's obvious the wake registered.
            try {
                window.setStatus?.('listening', 'LISTENING…');
            } catch (_) {}
            this._startLive(); // wake goes straight into phone / live conversation
            this._setConvState('listening'); // pill shows 🎙️ Listening… right away
            this._armWakeIdle();
            if (command) this._onUserUtterance(command);
        }

        /**
         * In wake-word mode a conversation should end itself: if nothing is
         * said for a while after the last exchange, drop back to standby.
         */
        _armWakeIdle() {
            if (!CompanionMode.getSettings().wakeWord) return;
            clearTimeout(this._wakeIdleTimer);
            this._wakeIdleTimer = setTimeout(() => {
                if (!this._live) return;
                if (this._convState === 'thinking' || this._convState === 'speaking') {
                    this._armWakeIdle(); // mid-exchange — check again later
                    return;
                }
                this._stopLive();
                this._earcon('sleep');
                this._toast(window.AppLanguage?.t?.('standingBy') || '💤 Standing by — say the wake word to talk');
            }, 20000);
        }

        /** Start one listen turn; on a final phrase, send and pause for the reply. */
        /**
         * The live conversation keeps ONE SpeechRecognition session hot for the
         * whole call. We never stop/restart it between turns — that restart is
         * what caused the long "mic is cold" gap after the avatar spoke. Instead,
         * the avatar's own voice is muted purely by conversation state: onresult
         * is ignored unless we're in the 'listening' state and past a short echo
         * guard. So the moment the avatar finishes, the (already running) mic
         * hears you — no startup lag, natural back-and-forth.
         */
        _liveListen() {
            if (!this._live) return;
            if (this._sr && this._srOwner === 'live') return; // ours and already hot
            // A leftover push-to-talk session must not be mistaken for the call's
            // session — it's one-shot with different handlers, so the call would
            // go deaf after one turn. Release it and open our own.
            if (this._sr) this._stopVoice();
            const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
            try {
                const sr = new SR();
                this._sr = sr;
                this._srOwner = 'live';
                sr.lang = this._srLang();
                sr.interimResults = true;
                sr.continuous = true; // one long session; stays hot across turns
                sr.maxAlternatives = 1;

                sr.onstart = () => {
                    this._recognizing = true;
                    // New session = new results array.
                    this._turnStartIndex = 0;
                    this._lastResultsLen = 0;
                    this._turnText = '';
                };
                sr.onresult = (event) => {
                    this._srFails = 0; // any result proves the mic works
                    // Mute the avatar's own voice: only accept while listening,
                    // not muted, and once the post-speech echo guard has elapsed.
                    // Gated results still advance the index bookkeeping so the
                    // next turn starts AFTER anything heard during the reply.
                    this._lastResultsLen = event.results.length;
                    if (this._muted) return;
                    if (this._convState !== 'listening' || Date.now() < this._echoGuardUntil) return;
                    // ── Endpointing: rebuild the WHOLE current turn every event.
                    // Android finalizes speech in small chunks ("how" · "are you"),
                    // so sending on the first isFinal cuts the sentence. Instead,
                    // accumulate finals + trailing interim and commit only after
                    // ~1s of silence (or session end) — like Google/Alexa.
                    let finals = '';
                    let interim = '';
                    for (let i = this._turnStartIndex; i < event.results.length; i++) {
                        const r = event.results[i];
                        const t = r[0]?.transcript || '';
                        // Overlap-merge: Android's finals are cumulative
                        // snapshots, desktop's are true segments — the merge
                        // handles both without duplication.
                        if (r.isFinal) finals = CompanionMode._mergeTranscripts(finals, t);
                        else interim = t;
                    }
                    const transcript = CompanionMode._mergeTranscripts(finals, interim).replace(/\s+/g, ' ').trim();
                    if (!transcript) return;
                    this._turnText = transcript;
                    this._armWakeIdle(); // still talking — never cut a slow speaker
                    if (this._ui?.input) this._ui.input.value = transcript;
                    if (this._compCanvas) {
                        this._bubbleCaption = transcript;
                        clearTimeout(this._bubbleCaptionTimer);
                    }
                    clearTimeout(this._endpointTimer);
                    this._endpointTimer = setTimeout(() => this._commitUtterance(), 1000);
                };
                sr.onerror = (e) => {
                    this._recognizing = false;
                    this._lastSrError = e?.error || 'unknown';
                };
                sr.onend = () => {
                    this._recognizing = false;
                    this._sr = null;
                    if (!this._live) return;
                    // Session closed while a turn was pending → that IS the
                    // endpoint: commit what we heard instead of losing it.
                    if (this._convState === 'listening' && this._turnText) {
                        this._commitUtterance();
                        return;
                    }
                    const err = this._lastSrError;
                    this._lastSrError = null;
                    // Permission revoked → retrying would just beep forever.
                    if (err === 'not-allowed' || err === 'service-not-allowed') {
                        this._stopLive();
                        this._toast('Microphone access is blocked — allow the mic to talk hands-free.');
                        return;
                    }
                    // Mic busy/unavailable: back off, give up after a few tries.
                    if (err === 'audio-capture' || err === 'aborted' || err === 'network') {
                        this._srFails = (this._srFails || 0) + 1;
                        if (this._srFails >= 4) {
                            this._stopLive();
                            this._toast('The microphone seems busy — hands-free paused. Tap 📞 to retry.');
                            return;
                        }
                    }
                    // Errors: back off and retry.
                    if (err) {
                        const delay = Math.min(700 * Math.pow(2, this._srFails || 0), 4000);
                        this._liveRestartTimer = setTimeout(() => this._liveListen(), delay);
                        return;
                    }
                    // Clean end (OS silence timeout). Do NOT reopen immediately —
                    // every SR session start plays the OS recording ping, so
                    // restarting on every pause produces a loop of pings. Like
                    // Alexa/Google, go SILENT and only reopen the recognizer when
                    // we actually hear speech. If the avatar is mid-reply (or the
                    // call is muted), the resume path reopens it instead.
                    if (this._muted || this._convState === 'thinking' || this._convState === 'speaking') return;
                    this._liveVadWait();
                };
                sr.start();
            } catch (err) {
                if (this._live) this._liveRestartTimer = setTimeout(() => this._liveListen(), 400);
            }
        }

        /**
         * Silent gap between turns (the Alexa/Google pattern). Instead of
         * reopening SpeechRecognition on every pause — which plays the OS
         * recording ping each time — we hold a silent getUserMedia stream and
         * watch the audio energy. The recognizer opens ONCE, when you actually
         * start speaking, so a call has no ping loop. Mic exclusivity holds:
         * the VAD stream is stopped before SR starts.
         */
        async _liveVadWait() {
            if (!this._live || this._sr || this._muted) return;
            if (!navigator.mediaDevices?.getUserMedia || !(window.AudioContext || window.webkitAudioContext)) {
                this._liveListen(); // no VAD available — fall back to direct SR
                return;
            }
            this._stopStandbyVAD(); // never stack VAD streams
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                if (!this._live || this._sr || this._muted) {
                    stream.getTracks().forEach((t) => t.stop());
                    return;
                }
                this._vadStream = stream;
                const AC = window.AudioContext || window.webkitAudioContext;
                this._vadCtx = new AC();
                const analyser = this._vadCtx.createAnalyser();
                analyser.fftSize = 512;
                this._vadCtx.createMediaStreamSource(stream).connect(analyser);
                const buf = new Uint8Array(analyser.fftSize);
                const ind = document.getElementById('status-indicator');
                let hot = 0;
                const calib = [];
                this._vadTimer = setInterval(() => {
                    if (!this._live || this._muted) return this._stopStandbyVAD();
                    // Never trigger on the avatar's own voice.
                    if (ind?.classList.contains('speaking') || this._convState !== 'listening') {
                        hot = 0;
                        return;
                    }
                    analyser.getByteTimeDomainData(buf);
                    let sum = 0;
                    for (let i = 0; i < buf.length; i++) {
                        const d = (buf[i] - 128) / 128;
                        sum += d * d;
                    }
                    const rms = Math.sqrt(sum / buf.length);
                    // Short calibration (~240ms) so speech right after the reply
                    // isn't missed; keep refining the noise floor afterwards.
                    if (calib.length < 3) {
                        calib.push(rms);
                        return;
                    }
                    const floor = calib.reduce((a, b) => a + b, 0) / calib.length;
                    const threshold = Math.max(0.02, floor * 3);
                    if (rms > threshold) {
                        hot++;
                    } else {
                        hot = Math.max(0, hot - 1);
                        // Refine the noise floor with QUIET frames only — feeding
                        // speech back in would raise the threshold above your voice.
                        if (calib.length < 12) calib.push(rms);
                    }
                    if (hot >= 2) {
                        // ~160ms of real speech → open the recognizer once.
                        this._stopStandbyVAD();
                        this._liveListen();
                    }
                }, 80);
            } catch (_) {
                this._liveListen(); // mic busy/denied — let the SR path handle it
            }
        }

        /**
         * Stitch two transcript chunks without duplication.
         * Desktop Chrome delivers finals as true NEW segments ("how" · "are
         * you") → plain concatenation. Android Chrome (continuous mode)
         * delivers CUMULATIVE snapshots as separate finals ("I" · "I am" ·
         * "I am very happy") → naive concatenation yields "I I am I am very…".
         * The merge finds the largest word-overlap between the tail of what we
         * have and the head of the new chunk, and appends only the new suffix:
         *   merge("I am very", "I am very happy") = "I am very happy"
         *   merge("how", "are you")               = "how are you"
         *   merge("thank you", "thank you")       = "thank you"
         */
        static _mergeTranscripts(base, add) {
            const b = String(base || '').trim();
            const a = String(add || '').trim();
            if (!b) return a;
            if (!a) return b;
            const wb = b.split(/\s+/);
            const wa = a.split(/\s+/);
            // Compare words ignoring case AND punctuation: the last chunk often
            // arrives punctuated ("thank you" → "thank you."), which would
            // otherwise break the overlap and duplicate the whole sentence.
            const norm = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
            const lb = wb.map(norm);
            const la = wa.map(norm);
            const max = Math.min(lb.length, la.length);
            let overlap = 0;
            for (let k = max; k > 0; k--) {
                let match = true;
                for (let i = 0; i < k; i++) {
                    if (lb[lb.length - k + i] !== la[i]) {
                        match = false;
                        break;
                    }
                }
                if (match) {
                    overlap = k;
                    break;
                }
            }
            // Keep the NEW chunk's text for the overlapped region — later
            // recognition is the refined one (adds punctuation/capitalisation),
            // e.g. "…thank you" + "…thank you." → "…thank you." (not duplicated).
            return wb
                .slice(0, wb.length - overlap)
                .concat(wa)
                .join(' ');
        }

        /** Silence endpoint reached: send the accumulated turn as one message. */
        _commitUtterance() {
            clearTimeout(this._endpointTimer);
            const text = (this._turnText || '').trim();
            this._turnText = '';
            this._turnStartIndex = this._lastResultsLen; // next turn starts after this one
            if (text) this._onUserUtterance(text);
        }

        _onUserUtterance(text) {
            this._armWakeIdle();
            if (this._ui?.input) this._ui.input.value = '';
            // 'thinking' mutes onresult — the mic keeps running but its input is
            // ignored while the LLM answers and the avatar speaks. No stop/restart.
            this._setConvState('thinking');
            this._heardSpeaking = false;
            this._sendText(text);
            this._startAudioEndWatch(); // resume synced to real audio, not the icon
            // Fallback: if no TTS ever starts (text-only reply), resume anyway.
            clearTimeout(this._replyTimeout);
            this._replyTimeout = setTimeout(() => {
                if (this._live && this._convState === 'thinking') this._resumeAfterReply();
            }, 9000);
        }

        /** Watch the app's status indicator so we resume listening after TTS ends. */
        _watchSpeaking() {
            const ind = document.getElementById('status-indicator');
            if (!ind || typeof MutationObserver === 'undefined') return;
            const check = () => {
                if (!this._live) return;
                const speaking = ind.classList.contains('speaking');
                if (speaking) {
                    this._heardSpeaking = true;
                    clearTimeout(this._replyTimeout);
                    this._setConvState('speaking');
                } else if (this._heardSpeaking && this._convState === 'speaking') {
                    this._resumeAfterReply();
                }
            };
            this._speakObserver = new MutationObserver(check);
            this._speakObserver.observe(ind, { attributes: true, attributeFilter: ['class'] });
        }

        /**
         * Human-turn-taking watcher: polls the REAL audio signals every 100ms
         * (SpeechService.isSpeaking, speechSynthesis, playing <audio> tags)
         * and hands the mic back ~300ms after the reply's sound truly ends —
         * without waiting for the UI icon, which updates late. Races the
         * status-indicator observer; whichever detects the end first wins.
         */
        /**
         * Piper/WASM TTS plays through AudioContext.createBufferSource(), which
         * is invisible to speechSynthesis and to <audio>/<video> scanning — so
         * without this the watcher would never see that engine speaking and the
         * mic hand-back would fall back to the slow icon path. Wrap
         * TTSProvider.speak once (additive; the original is preserved and its
         * callbacks still fire) to get a truthful busy flag.
         */
        _installTTSHook() {
            if (this._ttsHooked) return;
            const tp = window.TTSProvider;
            if (!tp || typeof tp.speak !== 'function') return;
            this._ttsHooked = true;
            const orig = tp.speak.bind(tp);
            tp.speak = (text, opts) => {
                const o = opts || {};
                this._ttsBusy = true;
                const done = () => {
                    this._ttsBusy = false;
                };
                return orig(text, {
                    ...o,
                    onEnd: () => {
                        done();
                        o.onEnd?.();
                    },
                    onError: (e) => {
                        done();
                        o.onError?.(e);
                    },
                });
            };
        }

        _startAudioEndWatch() {
            this._installTTSHook();
            clearInterval(this._audioEndTimer);
            this._sawReplyAudio = false;
            let silentTicks = 0;
            this._audioEndTimer = setInterval(() => {
                if (!this._live || this._convState === 'listening') {
                    clearInterval(this._audioEndTimer);
                    this._audioEndTimer = null;
                    return;
                }
                const busy = this._replyAudioBusy();
                if (busy) {
                    this._sawReplyAudio = true;
                    silentTicks = 0;
                    clearTimeout(this._replyTimeout); // audio is here — cancel the text-only fallback
                    if (this._convState !== 'speaking') this._setConvState('speaking');
                    return;
                }
                if (!this._sawReplyAudio) return; // still thinking — audio hasn't started yet
                silentTicks++;
                if (silentTicks >= 3) {
                    // ~300ms of true silence: the natural human gap. Mic ON.
                    clearInterval(this._audioEndTimer);
                    this._audioEndTimer = null;
                    this._resumeAfterReply();
                }
            }, 100);
        }

        /* ------------------------------------------------------------------ */
        /* Chunk Subtitles — movie-style playback of long replies.             */
        /* The paragraph is split at sentence/clause boundaries into ≤2-line   */
        /* chunks that advance while the avatar is speaking, paced at natural  */
        /* speech rate and HELD in sync with the real audio: if the voice is   */
        /* still talking when chunks run out, the last chunk stays; when the   */
        /* voice ends, a short linger, then hide.                              */
        /* ------------------------------------------------------------------ */

        /** Take the next subtitle-sized chunk (~90 chars, boundary-aware). */
        static _nextChunk(rest) {
            const MAX = 90;
            const t = rest.replace(/^\s+/, '');
            const lead = rest.length - t.length;
            if (t.length <= MAX) return { text: t, rawLen: rest.length };
            const win = t.slice(0, MAX + 1);
            // Prefer a sentence end, then clause break, then last space.
            const senten = Math.max(
                win.lastIndexOf('. '),
                win.lastIndexOf('! '),
                win.lastIndexOf('? '),
                win.lastIndexOf('… '),
                win.lastIndexOf('。'),
                win.lastIndexOf('！'),
                win.lastIndexOf('？')
            );
            const clause = Math.max(win.lastIndexOf(', '), win.lastIndexOf('; '), win.lastIndexOf('، '));
            const space = win.lastIndexOf(' ');
            let cut = senten >= 25 ? senten + 1 : clause >= 25 ? clause + 1 : space > 0 ? space : MAX;
            return { text: t.slice(0, cut).trim(), rawLen: lead + cut };
        }

        /**
         * Could this media element be the avatar's REPLY being played aloud?
         *
         * The rule is capture-vs-playback, not a list of known elements. A
         * `srcObject` holding a MediaStream is by definition a LIVE FEED — a
         * camera or a canvas capture — and a live feed is never text-to-speech.
         * That covers both always-on elements this app creates without either
         * of them having to know about the other:
         *
         *   • the ambient PiP bubble  (CompanionMode: canvas captureStream)
         *   • the face-tracking webcam (FaceTracker: getUserMedia)
         *
         * Face/hand tracking keep working exactly as before — this only stops
         * the turn-taking watcher from mistaking their video for a voice.
         *
         * Inaudible media (muted, or volume 0) is likewise not speech. Both
         * checks stay: a future capture element could be unmuted, and a future
         * TTS element could be silenced by the user.
         */
        static _couldBeReplyAudio(el) {
            if (!el) return false;
            if (el.srcObject) return false; // live capture feed, never TTS
            if (el.muted || el.volume === 0) return false; // inaudible
            if (el.dataset?.companionSilent === 'true') return false; // opt-out marker
            return !el.paused && !el.ended && el.currentTime > 0;
        }

        /**
         * Is the reply's voice actually playing right now?
         *
         * SINGLE SOURCE OF TRUTH — the turn-taking watcher and the chunk
         * subtitle pacer both call this. The predicate used to be copy-pasted
         * into both, which is exactly why one wrong assumption ("any playing
         * media element is the avatar speaking") produced two separate freezes.
         * Keep it in one place.
         */
        _replyAudioBusy() {
            try {
                // Pluggable engines (Piper WASM via WebAudio) — see _installTTSHook.
                if (this._ttsBusy) return true;
                if (window.SpeechService?.isSpeaking) return true;
                if (window.speechSynthesis && (speechSynthesis.speaking || speechSynthesis.pending)) return true;
                for (const a of document.querySelectorAll('audio,video')) {
                    if (a === this._video) continue; // our own bubble, belt and braces
                    if (CompanionMode._couldBeReplyAudio(a)) return true;
                }
            } catch (_) {}
            return false;
        }

        /** Show the next chunk; pace at speaking rate; stay in audio sync. */
        _advanceChunk() {
            const cap = this._ui?.caption;
            if (!cap) return;
            const rest = (this._capFullText || '').slice(this._capConsumed);
            if (!rest.trim()) {
                // Queue exhausted. If the voice is still speaking, more text is
                // probably streaming in — hold and re-check. Otherwise linger
                // briefly (reading tail) and hide.
                this._chunkPlaying = false;
                clearTimeout(this._captionTimer);
                const busy = this._replyAudioBusy();
                this._captionTimer = setTimeout(
                    () => {
                        const more = (this._capFullText || '').slice(this._capConsumed).trim();
                        if (more || this._replyAudioBusy()) {
                            // More text streamed in, or the voice is still talking:
                            // keep the subtitle alive and re-evaluate.
                            this._advanceChunk();
                            return;
                        }
                        cap.classList.remove('show');
                    },
                    busy ? 600 : 2200
                );
                return;
            }
            const chunk = CompanionMode._nextChunk(rest);
            this._capConsumed += chunk.rawLen;
            this._chunkPlaying = true;
            cap.textContent = chunk.text;
            cap.classList.add('show');
            // The PiP bubble HUD mirrors the SAME chunk — one subtitle system.
            this._bubbleCaption = chunk.text;
            clearTimeout(this._bubbleCaptionTimer);
            clearTimeout(this._captionTimer);
            // Natural speaking pace ≈ 13 chars/second → ~75ms per character,
            // floor 1.5s so short chunks are readable.
            const ms = Math.max(1500, chunk.text.length * 75);
            this._captionTimer = setTimeout(() => this._advanceChunk(), ms);
        }

        _resumeAfterReply() {
            if (!this._live) return;
            if (this._convState === 'listening') return; // already resumed (watcher/observer race)
            clearInterval(this._audioEndTimer);
            this._audioEndTimer = null;
            this._armWakeIdle();
            this._heardSpeaking = false;
            clearTimeout(this._replyTimeout);
            // A short echo guard skips the reply's audio tail; then we accept
            // speech immediately. The mic never stopped, so there is NO restart
            // lag — the avatar finishes and it's already hearing you.
            this._echoGuardUntil = Date.now() + 250;
            // Anything recognized while the avatar was replying belongs to the
            // avatar's own audio — the next turn starts strictly after it.
            this._turnStartIndex = this._lastResultsLen;
            this._turnText = '';
            clearTimeout(this._endpointTimer);
            this._setConvState('listening');
            // Reply finished → the mic must be HOT right now, so the user can
            // answer instantly without the wake word. If the OS closed the
            // session during the reply, reopen immediately (one natural
            // ready-ping right after the avatar stops — assistant standard).
            if (!this._sr) this._liveListen();
        }

        _setConvState(state) {
            this._convState = state;
            const T = (k, fb) => window.AppLanguage?.t?.(k) || fb;
            const labels = {
                listening: T('listening', '🎙️ Listening…'),
                thinking: T('thinking', '💭 Thinking…'),
                speaking: T('speaking', '🗣️ Speaking…'),
                standby: T('standby', '💤 Say the wake word'),
                muted: '🔇 Muted — tap 🎤 to talk',
                idle: '',
            };
            const pill = this._ui?.state;
            if (pill) {
                const label = labels[state] || '';
                pill.textContent = label;
                pill.classList.toggle('show', !!label && (this._live || state === 'standby' || state === 'muted'));
            }
            const mic = this._ui?.mic;
            if (mic) mic.classList.toggle('listening', state === 'listening' && this._live);
        }

        /**
         * Dedicated SpeechRecognition for the companion. We use our own instance
         * (rather than the app's mic button) so a final transcript is ALWAYS
         * sent — the app's mic only auto-sends above 80% confidence.
         */
        _startVoice() {
            // Let a host override drive the app's own voice input if it prefers.
            if (this._onToggleMic) {
                this._onToggleMic();
                return;
            }
            const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SR) {
                this._toast('Voice input isn’t supported in this browser — type instead.');
                return;
            }
            try {
                const sr = new SR();
                this._sr = sr;
                this._srOwner = 'ptt';
                sr.lang = this._srLang();
                sr.interimResults = true;
                sr.continuous = false;
                sr.maxAlternatives = 1;

                sr.onstart = () => {
                    this._recognizing = true;
                    this._ui?.mic?.classList.add('listening');
                    if (this._ui?.input) this._ui.input.placeholder = 'Listening…';
                };
                sr.onresult = (event) => {
                    const result = event.results[event.results.length - 1];
                    const transcript = (result[0]?.transcript || '').trim();
                    if (this._ui?.input) this._ui.input.value = transcript;
                    // Ambient bubble: show what we're hearing in real time.
                    if (this._compCanvas && transcript) {
                        this._bubbleCaption = transcript;
                        clearTimeout(this._bubbleCaptionTimer);
                    }
                    if (result.isFinal && transcript) {
                        if (this._ui?.input) this._ui.input.value = '';
                        this._sendText(transcript);
                    }
                };
                sr.onerror = () => this._stopVoice();
                sr.onend = () => this._stopVoice();
                sr.start();
            } catch (err) {
                console.warn('[CompanionMode] voice start failed:', err);
                this._stopVoice();
            }
        }

        /**
         * Recognition language for every companion recognizer.
         *
         * NOTE: `SpeechSettings` is declared with `const` at the top level of
         * src/main.js — a classic script — so it lives in the global LEXICAL
         * environment and is NOT reachable as `window.SpeechSettings`
         * (verified). Reading it that way always fell back to the browser
         * locale, which meant the app's configured language never reached the
         * mic. Resolve through the master language and the persisted setting
         * first, keeping the old lookups as last-resort fallbacks.
         */
        _srLang() {
            return (
                window.AppLanguage?.code ||
                (() => {
                    try {
                        return localStorage.getItem('speech_lang');
                    } catch (_) {
                        return null;
                    }
                })() ||
                window.SpeechSettings?.lang ||
                navigator.language ||
                'en-US'
            );
        }

        _stopVoice() {
            this._recognizing = false;
            this._ui?.mic?.classList.remove('listening');
            if (this._ui?.input) this._ui.input.placeholder = 'Talk or type…';
            if (this._sr) {
                try {
                    this._sr.onend = null;
                    this._sr.stop();
                } catch (_) {}
                this._sr = null;
            }
            this._srOwner = null;
        }

        /**
         * Mirror the main chat history into the companion window — the caption
         * (latest reply) and/or the full transcript panel, whichever are on.
         * Read-only: it observes the existing #chat-history, never mutates it.
         */
        _watchConversation() {
            const history = document.getElementById('chat-history');
            if (!history || typeof MutationObserver === 'undefined') return;

            const render = () => {
                const messages = history.querySelectorAll('.chat-message');

                // Latest-reply caption.
                const cap = this._ui?.caption;
                if (cap) {
                    const bubbles = history.querySelectorAll('.chat-message.avatar .message-text');
                    const text = bubbles[bubbles.length - 1]?.textContent?.trim();
                    // Only (re)show when the reply text actually CHANGED.
                    // Mutations caused by the USER's message must not resurrect
                    // the previous answer — that's the "old reply pops back"
                    // confusion. Streaming growth of the same reply updates it.
                    if (text && text !== this._lastCaptionText) {
                        const prev = this._lastCaptionText;
                        this._lastCaptionText = text;
                        if ((this._cfg || CompanionMode.getSettings()).chunkSubs) {
                            // CHUNK SUBTITLES: the reply is played as a sequence
                            // of short movie-style chunks instead of one wall of
                            // text. Non-destructive — the full reply stays in the
                            // chat and transcript; this is only the playback layer.
                            cap.classList.remove('full');
                            const growing = !!prev && text.startsWith(prev);
                            if (!growing) this._capConsumed = 0; // brand-new reply
                            this._capFullText = text;
                            if (!this._chunkPlaying) this._advanceChunk();
                        } else {
                            // Toggle off → the original single-caption behaviour.
                            this._chunkPlaying = false;
                            cap.classList.add('full');
                            cap.textContent = text;
                            cap.classList.add('show');
                            clearTimeout(this._captionTimer);
                            // Cinema subtitle pacing (Netflix-style CPS): a short
                            // lead-in plus ~20 characters/second of reading time.
                            // Floor 3s so one-liners register; cap 22s so long
                            // replies don't overstay (the clamped 6 lines are the
                            // gist — the full text lives in the chat).
                            const ms = Math.max(3000, Math.min(1800 + (text.length / 20) * 1000, 22000));
                            this._captionTimer = setTimeout(() => cap.classList.remove('show'), ms);
                        }
                    }
                }

                // Full transcript panel.
                const log = this._ui?.log;
                if (log) {
                    const doc = log.ownerDocument;
                    const frag = doc.createDocumentFragment();
                    messages.forEach((m) => {
                        const text = m.querySelector('.message-text')?.textContent?.trim();
                        if (!text) return;
                        const who = m.classList.contains('user') ? 'user' : 'bot';
                        const row = doc.createElement('div');
                        row.className = 'cm-msg ' + who;
                        row.textContent = text;
                        frag.appendChild(row);
                    });
                    log.replaceChildren(frag);
                    log.scrollTop = log.scrollHeight;
                }
            };

            // Baseline BEFORE observing: whatever reply already exists in the
            // chat is history, not a live event — (re)opening the companion
            // must never replay the previous subtitle. Only replies that
            // arrive from now on are captioned.
            const seed = history.querySelectorAll('.chat-message.avatar .message-text');
            this._lastCaptionText = seed[seed.length - 1]?.textContent?.trim() || '';

            this._replyObserver = new MutationObserver(render);
            this._replyObserver.observe(history, { childList: true, subtree: true, characterData: true });
            render(); // still paints the transcript panel; caption stays quiet
        }

        _teardownInteraction() {
            if (this._live) this._stopLive();
            this._stopVoice();
            if (this._replyObserver) {
                try {
                    this._replyObserver.disconnect();
                } catch (_) {}
                this._replyObserver = null;
            }
            clearTimeout(this._captionTimer);
            this._captionTimer = null;
            this._lastCaptionText = ''; // dedupe: only re-show caption on a NEW reply
            this._capFullText = ''; // full reply being played as chunk subtitles
            this._capConsumed = 0; // characters already shown as chunks
            this._chunkPlaying = false; // chunk playback in progress
            this._savedCam = null; // desktop camera framing, restored on close
            this._ui = null;
        }

        /**
         * Re-read Overlay settings and apply them live to an open companion
         * window (Document PiP). Called when a Settings ▸ Overlay toggle
         * changes so the user sees the effect immediately. No-op otherwise.
         */
        applySettings() {
            // Live-apply only for surfaces that live in this document / a PiP we
            // control (Document PiP + in-page overlay). Video PiP has no UI layer.
            if (!this.active || !this._root || (this.strategy !== 'document-pip' && this.strategy !== 'inpage-overlay'))
                return;
            this._cfg = CompanionMode.getSettings();

            this.transparentBackground = this._cfg.transparent;
            if (this._cfg.transparent) this._enableTransparentBackground();
            else this._disableTransparentBackground();

            // Rebuild the injected UI (within .cm-root) to match the new settings.
            this._teardownInteraction();
            this._root.querySelectorAll('.cm-bar,.cm-cap,.cm-log').forEach((el) => el.remove());
            const doc = this._root.ownerDocument;
            this._buildCompanionUI(this._root, doc);
        }

        /* ------------------------------------------------------------------ */
        /* Strategy B — Video PiP fallback (mirror, always-on-top)             */
        /* ------------------------------------------------------------------ */

        async _activateVideoPiP() {
            const canvas = this.canvas;
            if (!canvas) throw new Error('CompanionMode: no renderer canvas found');
            if (typeof canvas.captureStream !== 'function') {
                this._toast('This browser can’t stream the avatar into a floating window.');
                throw new Error('CompanionMode: canvas.captureStream not supported');
            }

            // Mobile PiP surfaces are opaque, so a transparent scene would just
            // read as black. Give it a designed backdrop instead of the app's
            // default black, so the bubble looks intentional.
            this._applyBackdrop(0x141b2e);

            // ── Ambient (Alexa-style) surface ─────────────────────────────
            // The bubble can't host DOM, so we stream a COMPOSITE canvas:
            // the live avatar frame + a status ring (listening / thinking /
            // speaking) + live captions painted straight into the video.
            const comp = document.createElement('canvas');
            comp.width = Math.max(2, canvas.width);
            comp.height = Math.max(2, canvas.height);
            const cx = comp.getContext('2d');
            this._compCanvas = comp;

            // The app's WebGL canvas has preserveDrawingBuffer:false, so it reads
            // back BLANK unless copied inside a render frame. We copy the live
            // avatar into a 2D cache on rAF (valid, in-frame); the HUD then
            // composites from that cache. When the page is backgrounded rAF
            // pauses, the cache keeps the last frame, and the interval below
            // keeps compositing cache + HUD into the stream — so the face never
            // goes blank and the HUD still updates over other apps.
            const cache = document.createElement('canvas');
            cache.width = comp.width;
            cache.height = comp.height;
            const cacheCtx = cache.getContext('2d');
            const capture = () => {
                if (!this._compCanvas) return; // torn down
                try {
                    cacheCtx.drawImage(canvas, 0, 0, cache.width, cache.height);
                } catch (_) {}
                this._compRAF = requestAnimationFrame(capture);
            };
            this._compRAF = requestAnimationFrame(capture);

            let pulse = 0;
            const STATE_COLORS = {
                listening: '#22d3ee',
                thinking: '#f59e0b',
                speaking: '#34d399',
                idle: 'rgba(255,255,255,.25)',
            };
            const TB = (k, fb) => window.AppLanguage?.t?.(k) || fb;
            const STATE_LABELS = {
                listening: TB('listening', '🎙️ Listening…'),
                thinking: TB('thinking', '💭 Thinking…'),
                speaking: TB('speaking', '🗣️ Speaking…'),
                idle: '',
            };
            const paint = () => {
                const w = comp.width;
                const h = comp.height;
                cx.drawImage(cache, 0, 0, w, h); // live avatar frame (from the cache)
                const state = this._convState || 'idle';
                const showHud = this._live || this._bubbleCaption;
                if (!showHud) return;
                // Bottom scrim so text stays readable over any avatar pose.
                const scrimH = Math.min(h * 0.34, 150);
                const g = cx.createLinearGradient(0, h - scrimH, 0, h);
                g.addColorStop(0, 'rgba(10,14,26,0)');
                g.addColorStop(1, 'rgba(10,14,26,.82)');
                cx.fillStyle = g;
                cx.fillRect(0, h - scrimH, w, scrimH);
                // Pulsing status ring (the "Alexa light").
                pulse = (pulse + 0.08) % (Math.PI * 2);
                const r = 9 + (state === 'listening' ? Math.sin(pulse) * 2.5 : 0);
                const ringY = h - scrimH * 0.62;
                cx.beginPath();
                cx.arc(22, ringY, r, 0, Math.PI * 2);
                cx.strokeStyle = STATE_COLORS[state] || STATE_COLORS.idle;
                cx.lineWidth = 3;
                cx.stroke();
                // Status label next to the ring.
                cx.font = '600 15px system-ui, sans-serif';
                cx.fillStyle = 'rgba(255,255,255,.92)';
                cx.textBaseline = 'middle';
                cx.fillText(STATE_LABELS[state] || '', 40, ringY);
                // Live caption (what was heard / the reply), wrapped to 2 lines.
                const cap = this._bubbleCaption;
                if (cap) {
                    cx.font = '400 14px system-ui, sans-serif';
                    cx.fillStyle = 'rgba(255,255,255,.85)';
                    const maxW = w - 28;
                    const words = String(cap).split(/\s+/);
                    const lines = [];
                    let line = '';
                    for (const word of words) {
                        const test = line ? line + ' ' + word : word;
                        if (cx.measureText(test).width > maxW && line) {
                            lines.push(line);
                            line = word;
                            if (lines.length === 2) break;
                        } else line = test;
                    }
                    if (lines.length < 2 && line) lines.push(line);
                    else if (lines.length === 2) lines[1] = lines[1].replace(/\s*\S*$/, ' …');
                    lines.forEach((l, i) => cx.fillText(l, 14, h - scrimH * 0.32 + i * 19));
                }
            };
            paint();
            this._compTimer = setInterval(paint, 66); // ~15 fps HUD; smooth enough, battery-friendly

            this._stream = comp.captureStream(30);
            const video = document.createElement('video');
            video.srcObject = this._stream;
            video.muted = true;
            // Self-declare as silent infrastructure: this element is a canvas
            // capture, never a voice. Anything probing "is audio playing?" must
            // skip it — counting it froze the conversation in "speaking".
            video.dataset.companionSilent = 'true';
            video.autoplay = true;
            video.playsInline = true;
            video.setAttribute('playsinline', ''); // iOS honors the attribute, not just the prop
            video.style.cssText =
                'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-10px;top:-10px;';
            document.body.appendChild(video);
            this._video = video;

            try {
                await video.play();

                if (typeof video.requestPictureInPicture === 'function' && document.pictureInPictureEnabled) {
                    // Standard path — desktop Safari/Firefox, and Android Chrome
                    // (Android renders this as a system bubble that floats over other apps).
                    await video.requestPictureInPicture();
                    video.addEventListener('leavepictureinpicture', () => this._teardownVideoPiP(), { once: true });
                } else if (typeof video.webkitSetPresentationMode === 'function') {
                    // iOS Safari path
                    video.webkitSetPresentationMode('picture-in-picture');
                    video.addEventListener('webkitpresentationmodechanged', () => {
                        if (video.webkitPresentationMode !== 'picture-in-picture') this._teardownVideoPiP();
                    });
                } else {
                    throw new Error('Picture-in-Picture not available');
                }
            } catch (err) {
                // Blocked (common on iPhone without a direct control tap) — fail softly.
                this._toast(
                    CompanionMode.isIOS()
                        ? 'iOS blocked auto Picture-in-Picture. Tap the ⤢ PiP control on the little video to float the avatar.'
                        : 'Picture-in-Picture was blocked by the browser.'
                );
                this._teardownVideoPiP();
                throw err;
            }

            // Hide the in-page source so you don't see a duplicate avatar behind
            // the floating bubble. Capture keeps running from the drawing buffer.
            this._hideSource();

            this.strategy = 'video-pip';
            this.active = true;
            this._setButtonState(true);

            // ── Ambient mode: the bubble is the face, the page is the ears ──
            // Mirror conversation into the painted caption, then auto-start the
            // hands-free live loop (listen → reply aloud → listen again).
            // The user gesture that opened PiP also satisfies mic activation.
            this._watchConversationForBubble();
            const cfg = CompanionMode.getSettings();
            if (cfg.floatOverApps) {
                // IMPORTANT: do NOT hold a getUserMedia track while listening —
                // on Android it starves SpeechRecognition of the mic (endless
                // start-beep, hears nothing). The keep-alive is only taken while
                // the page is hidden, and released before listening resumes.
                this._bindKeepAliveVisibility();
                try {
                    this._startLive();
                } catch (err) {
                    console.warn('[CompanionMode] ambient voice failed to start:', err);
                }
            }
        }

        /**
         * SpeechRecognition and a held getUserMedia stream fight over the mic
         * on Android — they must never run at the same time. So: while the
         * page is VISIBLE, SR owns the mic (no keep-alive). When the page goes
         * HIDDEN behind other apps, SR is throttled anyway — stop it and hold
         * the keep-alive track so Chrome keeps the tab (avatar + TTS) alive.
         * On return, release the mic first, then resume listening.
         */
        _bindKeepAliveVisibility() {
            if (this._visHandler) return;
            this._visHandler = () => {
                if (!this._live) return;
                if (document.hidden) {
                    clearTimeout(this._liveRestartTimer);
                    if (this._sr) {
                        try {
                            this._sr.onend = null;
                            this._sr.stop();
                        } catch (_) {}
                        this._sr = null;
                    }
                    this._recognizing = false;
                    this._startMicKeepAlive();
                } else {
                    this._stopMicKeepAlive();
                    this._srFails = 0;
                    if (this._convState === 'listening' || this._convState === 'idle') {
                        this._setConvState('listening');
                        this._liveRestartTimer = setTimeout(() => this._liveListen(), 250);
                    }
                }
            };
            document.addEventListener('visibilitychange', this._visHandler);
        }

        _unbindKeepAliveVisibility() {
            if (this._visHandler) {
                document.removeEventListener('visibilitychange', this._visHandler);
                this._visHandler = null;
            }
        }

        /**
         * Silent mic keep-alive for backgrounded Android. Holding an active
         * getUserMedia audio track keeps the page in an active media-capture
         * state, so Chrome is far less likely to suspend the tab / throttle
         * SpeechRecognition when the ambient bubble floats over other apps.
         * Best-effort: if the mic isn't granted, ambient voice still tries.
         */
        async _startMicKeepAlive() {
            if (this._micKeepAlive) return;
            if (!navigator.mediaDevices?.getUserMedia) return;
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                if (!this.active) {
                    // Torn down while the prompt was open — don't leak the track.
                    stream.getTracks().forEach((t) => t.stop());
                    return;
                }
                this._micKeepAlive = stream;
            } catch (err) {
                console.warn('[CompanionMode] mic keep-alive not granted:', err);
            }
        }

        _stopMicKeepAlive() {
            if (this._micKeepAlive) {
                try {
                    this._micKeepAlive.getTracks().forEach((t) => t.stop());
                } catch (_) {}
                this._micKeepAlive = null;
            }
        }

        /** Mirror the latest heard phrase / avatar reply into the bubble HUD. */
        _watchConversationForBubble() {
            const history = document.getElementById('chat-history');
            if (!history || typeof MutationObserver === 'undefined') return;
            const render = () => {
                const bubbles = history.querySelectorAll('.chat-message .message-text');
                const text = bubbles[bubbles.length - 1]?.textContent?.trim();
                if (!text) return;
                this._bubbleCaption = text;
                clearTimeout(this._bubbleCaptionTimer);
                this._bubbleCaptionTimer = setTimeout(() => {
                    this._bubbleCaption = '';
                }, 8000);
            };
            this._bubbleObserver = new MutationObserver(render);
            this._bubbleObserver.observe(history, { childList: true, subtree: true, characterData: true });
        }

        /** Hide the source avatar (kept rendering) and show a small note. */
        _hideSource() {
            const canvas = this.canvas;
            if (canvas) canvas.style.visibility = 'hidden';
            const vp = document.getElementById('avatar-viewport') || canvas?.parentElement;
            if (!vp || this._sourceNote) return;
            const note = document.createElement('div');
            note.id = 'cm-source-note';
            note.textContent = '🪟 Avatar is floating in a Picture-in-Picture bubble';
            note.style.cssText =
                'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
                'text-align:center;padding:24px;color:#8891a5;font:13px/1.5 system-ui,sans-serif;pointer-events:none';
            if (getComputedStyle(vp).position === 'static') vp.style.position = 'relative';
            vp.appendChild(note);
            this._sourceNote = note;
        }

        _showSource() {
            const canvas = this.canvas;
            if (canvas) canvas.style.visibility = '';
            this._sourceNote?.remove();
            this._sourceNote = null;
        }

        _teardownVideoPiP() {
            this.stopStandby(); // native close (swipe bubble away) bypasses deactivate()
            const v = this._video;
            // Ambient mode: closing the bubble ends the conversation too —
            // one gesture, one mental model.
            if (this._live) this._stopLive();
            this._stopMicKeepAlive();
            clearInterval(this._compTimer);
            this._compTimer = null;
            if (this._compRAF) cancelAnimationFrame(this._compRAF);
            this._compRAF = null;
            this._compCanvas = null; // stops the capture loop on its next tick
            this._bubbleCaption = '';
            clearTimeout(this._bubbleCaptionTimer);
            if (this._bubbleObserver) {
                try {
                    this._bubbleObserver.disconnect();
                } catch (_) {}
                this._bubbleObserver = null;
            }
            this._showSource();
            this._disableTransparentBackground(); // restore scene bg + clear color
            if (document.pictureInPictureElement) {
                document.exitPictureInPicture().catch(() => {});
            }
            // iOS: leave webkit PiP if still presenting.
            try {
                if (
                    v &&
                    typeof v.webkitSetPresentationMode === 'function' &&
                    v.webkitPresentationMode === 'picture-in-picture'
                ) {
                    v.webkitSetPresentationMode('inline');
                }
            } catch (_) {}
            this._stream?.getTracks().forEach((t) => t.stop());
            this._stream = null;
            v?.remove();
            this._video = null;
            this.strategy = null;
            this.active = false;
            this._setButtonState(false);
        }

        /** Small transient toast for user feedback (mobile fallbacks especially). */
        _toast(msg) {
            try {
                const t = document.createElement('div');
                t.textContent = msg;
                t.style.cssText =
                    'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:100000;' +
                    'max-width:88vw;padding:10px 16px;border-radius:12px;background:rgba(20,22,32,.96);' +
                    'color:#eef1f8;font:13px/1.45 system-ui,sans-serif;text-align:center;' +
                    'box-shadow:0 6px 24px rgba(0,0,0,.4);';
                document.body.appendChild(t);
                setTimeout(() => {
                    t.style.transition = 'opacity .4s';
                    t.style.opacity = '0';
                    setTimeout(() => t.remove(), 400);
                }, 4000);
            } catch (_) {}
        }

        /* ------------------------------------------------------------------ */
        /* Transparent-float background (snapshot + restore)                   */
        /* ------------------------------------------------------------------ */

        _enableTransparentBackground() {
            if (!this.transparentBackground) return;
            if (this._savedBackground !== undefined) return; // already enabled — don't re-snapshot
            const scene = this.scene;
            const renderer = this.renderer;
            if (scene) {
                this._savedBackground = scene.background; // may be Color, Texture or null
                scene.background = null;
            }
            if (renderer?.getClearColor) {
                try {
                    const c = new (window.THREE?.Color || Object)();
                    if (c.getHex) {
                        renderer.getClearColor(c);
                        this._savedClearColor = c.getHex();
                    }
                } catch (_) {}
                this._savedClearAlpha = renderer.getClearAlpha?.();
                renderer.setClearColor?.(0x000000, 0);
            }
        }

        /**
         * Opaque designed backdrop for video PiP (which can't be transparent).
         * Snapshots into the same fields _disableTransparentBackground restores.
         */
        _applyBackdrop(hex) {
            if (this._savedBackground !== undefined) return; // already snapshotted
            const scene = this.scene;
            const renderer = this.renderer;
            if (scene) {
                this._savedBackground = scene.background;
                scene.background = null;
            }
            if (renderer?.getClearColor) {
                try {
                    const c = new (window.THREE?.Color || Object)();
                    if (c.getHex) {
                        renderer.getClearColor(c);
                        this._savedClearColor = c.getHex();
                    }
                } catch (_) {}
                this._savedClearAlpha = renderer.getClearAlpha?.();
                renderer.setClearColor?.(hex, 1);
            }
        }

        _disableTransparentBackground() {
            if (this._savedBackground === undefined && this._savedClearAlpha === null) return;
            const scene = this.scene;
            const renderer = this.renderer;
            if (scene && this._savedBackground !== undefined) {
                scene.background = this._savedBackground;
            }
            if (renderer && this._savedClearAlpha !== null) {
                renderer.setClearColor?.(this._savedClearColor ?? 0x000000, this._savedClearAlpha);
            }
            this._savedBackground = undefined;
            this._savedClearColor = null;
            this._savedClearAlpha = null;
        }

        /* ------------------------------------------------------------------ */
        /* Toolbar button (native look) with a floating-pill fallback          */
        /* ------------------------------------------------------------------ */

        /** Create the Companion button. Mounts into the avatar toolbar if present. */
        showButton() {
            if (this._button) return this._button;

            const toolbar = document.querySelector('.avatar-footer-actions');
            const b = document.createElement('button');
            b.id = 'companion-mode-btn';
            b.type = 'button';
            b.title = CompanionMode.isMobile()
                ? 'Companion — float the avatar in a corner and chat with it'
                : 'Companion — pop the avatar into a small always-on-top window';
            b.setAttribute('aria-label', b.title);
            b.onclick = () =>
                this.toggle().catch((err) => {
                    console.warn('[CompanionMode]', err);
                });

            if (toolbar) {
                // Match the existing toolbar buttons (🎯 🎭 👤).
                b.className = 'emotion-trigger';
                b.style.fontSize = '1.1rem';
                b.innerHTML = '<span>🪟</span>';
                const right = toolbar.querySelector('.avatar-footer-right');

                // One-tap Call button next to it.
                const call = document.createElement('button');
                call.id = 'companion-call-btn';
                call.type = 'button';
                call.className = 'emotion-trigger';
                call.style.fontSize = '1.1rem';
                call.title = 'Call your companion — talk hands-free';
                call.setAttribute('aria-label', call.title);
                call.innerHTML = '<span>📞</span>';
                call.onclick = () => this.callNow().catch((err) => console.warn('[CompanionMode]', err));
                this._callButton = call;

                // Place both right before the select group.
                if (right) {
                    toolbar.insertBefore(b, right);
                    toolbar.insertBefore(call, right);
                } else {
                    toolbar.appendChild(b);
                    toolbar.appendChild(call);
                }
                // Gently point new users at the companion, once.
                this._maybeCoachmark(call);
            } else {
                // Standalone / demo pages: a self-contained floating pill.
                b.textContent = '🪟 Companion';
                b.style.cssText =
                    'position:fixed;bottom:14px;right:14px;z-index:99999;padding:8px 14px;' +
                    'border:0;border-radius:999px;cursor:pointer;font:13px system-ui;' +
                    'background:#4f7cff;color:#fff;box-shadow:0 2px 10px rgba(0,0,0,.35);';
                document.body.appendChild(b);
            }

            this._button = b;
            return b;
        }

        /** Show a one-time coach-mark pointing at the companion/call controls. */
        _maybeCoachmark(target) {
            try {
                if (localStorage.getItem('overlay_seen') === '1') return;
            } catch (_) {}
            if (!target) return;
            const tip = document.createElement('div');
            tip.textContent = '👋 Meet your companion — tap 📞 to call, or 🪟 to float it in a corner';
            tip.style.cssText =
                'position:fixed;z-index:2147483001;max-width:240px;padding:10px 14px;border-radius:12px;' +
                'background:#4f7cff;color:#fff;font:12.5px/1.4 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.4);' +
                'opacity:0;transition:opacity .3s;pointer-events:none';
            document.body.appendChild(tip);
            const place = () => {
                const r = target.getBoundingClientRect();
                tip.style.left = Math.max(8, Math.min(r.left + r.width / 2 - 120, window.innerWidth - 248)) + 'px';
                const top = r.top - tip.offsetHeight - 10;
                tip.style.top = (top > 8 ? top : r.bottom + 10) + 'px';
            };
            requestAnimationFrame(() => {
                place();
                tip.style.opacity = '1';
            });
            const dismiss = () => {
                try {
                    localStorage.setItem('overlay_seen', '1');
                } catch (_) {}
                tip.style.opacity = '0';
                setTimeout(() => tip.remove(), 300);
                window.removeEventListener('pointerdown', dismiss, true);
            };
            // Dismiss on first interaction or after a while.
            window.addEventListener('pointerdown', dismiss, true);
            setTimeout(dismiss, 9000);
        }

        _setButtonState(on) {
            const b = this._button;
            if (!b) return;
            if (b.classList.contains('emotion-trigger')) {
                b.innerHTML = on ? '<span>⏏</span>' : '<span>🪟</span>';
                b.title = on
                    ? 'Bring the avatar back into the page'
                    : CompanionMode.isMobile()
                      ? 'Companion — float the avatar in a corner and chat with it'
                      : 'Companion — pop the avatar into a floating window';
                b.classList.toggle('is-active', on);
            } else {
                b.textContent = on ? '⏏ Bring avatar back' : '🪟 Companion';
                b.style.background = on ? '#3b3f4a' : '#4f7cff';
            }
        }
    }

    // Expose the class globally (repo convention — see AvatarPicker, etc.).
    window.CompanionMode = CompanionMode;

    /* ====================================================================== */
    /* Auto-wire: build an instance once the viewer engine is ready, add the   */
    /* button, and honor ?mode=companion + the Alt+C shortcut. The button is   */
    /* shown wherever PiP is actually usable — desktop (Document PiP), Android  */
    /* (video PiP floats a bubble over other apps) and iOS (best-effort webkit  */
    /* PiP). It stays hidden only when no PiP path exists at all.              */
    /* ====================================================================== */
    function autoWire() {
        if (window.companionMode) return; // already wired (e.g. by a host page)
        if (!CompanionMode.isSupported()) return; // no PiP path on this device — stay hidden

        const startMode = new URLSearchParams(location.search).get('mode');
        const forced = startMode === 'companion' || startMode === 'call';

        const engine = window.NEXUS_VIEWER;

        const instance = new CompanionMode({
            renderer: engine?.renderer,
            scene: engine?.scene,
            onResize: (w, h) => {
                const cam = window.NEXUS_VIEWER?.camera;
                if (cam) {
                    cam.aspect = Math.max(0.4, Math.min(w / h, 3.0));
                    cam.updateProjectionMatrix();
                }
                window.NEXUS_VIEWER?.postProcessing?.setSize?.(w, h);
            },
        });
        window.companionMode = instance;
        instance.showButton();
        wireOverlaySettings(instance);

        // Keyboard shortcut: Alt+C toggles companion mode.
        window.addEventListener('keydown', (e) => {
            if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'c' || e.key === 'C')) {
                e.preventDefault();
                instance.toggle().catch(() => {});
            }
        });

        // ?mode=companion / ?mode=call auto-start on the first gesture (PiP + mic
        // both require a user gesture). ?mode=call also starts live conversation.
        if (forced) {
            const start = () => {
                if (startMode === 'call') instance.callNow().catch(() => {});
                else instance.activate().catch(() => {});
                window.removeEventListener('pointerdown', start);
                window.removeEventListener('keydown', start);
            };
            window.addEventListener('pointerdown', start, { once: true });
            window.addEventListener('keydown', start, { once: true });
            return;
        }

        // Cross-page continuity: if the in-page companion was open before a
        // same-tab navigation, bring it back where the user left it. The overlay
        // is pure DOM (no PiP/mic), so it can reopen without a user gesture.
        const resume = CompanionMode.readResume();
        if (resume && resume.strategy === 'inpage-overlay') {
            instance
                .activate('inpage')
                .then(() => {
                    const el = instance._overlayEl;
                    if (el && resume.pos && resume.pos.left && resume.pos.left !== 'auto') {
                        el.style.transform = 'none'; // explicit position replaces centering
                        el.style.right = 'auto';
                        el.style.bottom = 'auto';
                        const w = el.offsetWidth;
                        const h = el.offsetHeight;
                        const L = Math.max(4, Math.min(parseInt(resume.pos.left, 10) || 0, window.innerWidth - w - 4));
                        const T = Math.max(4, Math.min(parseInt(resume.pos.top, 10) || 0, window.innerHeight - h - 4));
                        el.style.left = L + 'px';
                        el.style.top = T + 'px';
                    }
                    if (el && resume.size && resume.size.w) {
                        el.style.width = Math.min(resume.size.w, window.innerWidth * 0.97) + 'px';
                        el.style.height = Math.min(resume.size.h || 0, window.innerHeight * 0.92) + 'px';
                    }
                    if (el && resume.max) {
                        el.classList.add('cm-max');
                        // The class alone is not the state: without this the
                        // restored companion shows ⛶ while maximized and the
                        // app's own ⛶ reappears next to it — two fullscreen
                        // controls, the exact defect maximizing removes.
                        // (Real browser fullscreen can't be re-entered here:
                        // it needs a user gesture, so _nativeFs stays false and
                        // 🗗 simply returns to the widget.)
                        instance._syncMaxChrome(true);
                    }
                    if (resume.live) instance._toast('Welcome back — tap 📞 to resume the conversation.');
                })
                .catch(() => {});
        }
    }

    /**
     * Bind the Settings ▸ Overlay checkboxes to localStorage and live-apply.
     * Purely additive — reads/writes only 'overlay_*' keys and never touches
     * the app's own settings wiring. Safe to call when the section is absent.
     */
    function wireOverlaySettings(instance) {
        const map = [
            ['overlay-controls', 'controls', 'on'],
            ['overlay-subtitle', 'subtitle', 'on'],
            ['overlay-chunksubs', 'chunksubs', 'on'],
            ['overlay-chatwindow', 'chatwindow', 'off'],
            ['overlay-transparent', 'transparent', 'on'],
            ['overlay-floatoverapps', 'floatoverapps', 'off'],
            ['overlay-wakeword', 'wakeword', 'off'],
            ['ar-followme', 'arfollow', 'on'],
        ];
        for (const [id, key, def] of map) {
            const el = document.getElementById(id);
            if (!el) continue;
            let stored = null;
            try {
                stored = localStorage.getItem('overlay_' + key);
            } catch (_) {}
            el.checked = (stored === null ? def : stored) === 'on';
            el.addEventListener('change', () => {
                try {
                    localStorage.setItem('overlay_' + key, el.checked ? 'on' : 'off');
                } catch (_) {}
                instance.applySettings(); // live-update if the companion is open
            });
        }

        // Wake phrase text input + live start/stop of the standby listener.
        const phraseEl = document.getElementById('overlay-wakephrase');
        if (phraseEl) {
            try {
                phraseEl.value = localStorage.getItem('overlay_wakephrase') || '';
            } catch (_) {}
            phraseEl.addEventListener('change', () => {
                try {
                    const v = phraseEl.value.trim().toLowerCase();
                    if (v) localStorage.setItem('overlay_wakephrase', v);
                    else localStorage.removeItem('overlay_wakephrase');
                } catch (_) {}
                // Restart standby so the new phrase takes effect immediately.
                if (instance._standby) {
                    instance.stopStandby();
                    instance.startStandby();
                }
            });
        }
        const wakeEl = document.getElementById('overlay-wakeword');
        if (wakeEl) {
            wakeEl.addEventListener('change', () => {
                if (wakeEl.checked) instance.startStandby();
                else instance.stopStandby();
            });
        }

        // NOTE: standby is intentionally NOT started on page load — the wake
        // word is exclusive to companion mode and arms when the companion opens.

        // Reset the whole Overlay section back to its defaults.
        const reset = document.getElementById('overlay-reset-btn');
        if (reset) {
            reset.addEventListener('click', () => {
                for (const [id, key, def] of map) {
                    try {
                        localStorage.removeItem('overlay_' + key);
                    } catch (_) {}
                    const el = document.getElementById(id);
                    if (el) el.checked = def === 'on';
                }
                instance.applySettings(); // live-apply if the companion is open
                instance._toast('Companion settings reset to defaults.');
            });
        }

        // Primary mobile entry point: the "Companion" item in the ☰ drawer menu
        // (Experience group, after VR / AR Mode). Closes the drawer, then opens.
        const drawerBtn = document.getElementById('drawer-companion-btn');
        if (drawerBtn) {
            drawerBtn.addEventListener('click', () => {
                // Reuse the app's own drawer-close so it animates/cleans up properly.
                document.getElementById('mobile-drawer-close')?.click();
                document.getElementById('mobile-drawer')?.classList.remove('open', 'active', 'show');
                document.getElementById('mobile-drawer-overlay')?.classList.remove('open', 'active', 'show');
                // Let the drawer begin closing before we grab the canvas.
                setTimeout(() => instance.toggle().catch((err) => console.warn('[CompanionMode]', err)), 60);
            });
        }
    }

    /**
     * Wait for the viewer engine (canvas) to exist, then wire up. The engine
     * resolves window.__NEXUS_VIEWER_READY__ when ready; fall back to a short
     * poll for pages (like the demo) that don't use that promise.
     */
    function boot() {
        if (window.__NEXUS_VIEWER_READY__?.then) {
            window.__NEXUS_VIEWER_READY__.then(() => autoWire()).catch(() => autoWire());
            // Safety net if the promise never resolves but a canvas exists.
            setTimeout(autoWire, 4000);
        } else {
            let tries = 0;
            const t = setInterval(() => {
                if (document.querySelector('canvas') || ++tries > 40) {
                    clearInterval(t);
                    autoWire();
                }
            }, 150);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
