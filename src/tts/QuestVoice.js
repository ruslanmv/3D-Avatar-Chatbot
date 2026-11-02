/**
 * QuestVoice — one switch: "Natural voice on Meta Quest" (batch Q1).
 *
 * The Meta Quest Browser exposes one or two generic Android system voices to
 * `speechSynthesis`, and inside an immersive session that path goes quiet without
 * telling anyone: no `onend`, no `onerror`, just a companion whose mouth moves and
 * says nothing. Piper (src/tts/PiperWasmTTSProvider.js) runs the same neural voice
 * on every device, and on a Quest 3 the medium models synthesize in near real time.
 *
 * So why is this a switch and not the default? Because the built-in voice is what
 * people have today, it works for many of them, and Piper's first use downloads a
 * ~60 MB model. Changing what somebody hears in their headset — and spending their
 * bandwidth — is their decision. Off is exactly today's behaviour, byte for byte:
 * every function below answers "do nothing" unless the switch is on AND the page is
 * running in a Quest browser.
 *
 * When it is on:
 *
 *   - Piper speaks every reply, the VR panel's included. The person's own TTS ENGINE
 *     choice is not overwritten: the override lives in memory (TTSProvider), so turning
 *     the switch off hands back exactly the engine they had picked. A setting that
 *     rewrote `tts_engine` could never be undone by the switch that wrote it.
 *   - A language Piper has no voice for (Japanese, Korean) still uses the system
 *     voice. An English model reading kanji is worse than a robotic voice reading it.
 *   - If Piper cannot start — its runtime comes from a CDN, its model from Hugging
 *     Face, and a school or office network may block either — the reply is spoken by
 *     the system voice instead. Turning a voice on must never be how she goes silent.
 *   - The model is fetched in the background once the page is idle, so the first
 *     reply in the headset is not a 60 MB wait.
 *
 * This file holds the state and the decisions, and nothing else: no DOM, no audio,
 * no engine calls. TTSProvider asks it questions; QuestVoiceSettings draws the
 * toggle. That split is what lets every rule here be tested in jsdom.
 */
(function (global) {
    'use strict';

    const KEY = 'nexus_quest_voice';
    const ON = 'on';
    const OFF = 'off';

    const PIPER = 'piper-wasm';
    const REMOTE = 'sonicagent-stream';
    const BUILTIN = 'web-speech-api';

    /**
     * Same test DeviceDetector uses for `os === 'quest'`, kept in step deliberately: the
     * Settings toggle appearing on a device the rest of the app does not treat as a Quest
     * (or the reverse) would be a switch that does nothing where it is shown.
     */
    const QUEST_UA = /OculusBrowser|Quest/i;

    const listeners = new Set();

    /** Fallback when storage cannot be read or written. Lives for the life of the page. */
    let _memory = null;

    function storage() {
        try {
            return global && global.localStorage ? global.localStorage : null;
        } catch (_) {
            // Private mode, an embedded webview, a browser with site data blocked.
            return null;
        }
    }

    /** `'on'`, `'off'`, or `null` for a profile that has never touched it. */
    function state() {
        const store = storage();
        if (!store) {
            return _memory;
        }
        try {
            const raw = store.getItem(KEY);
            return raw === ON || raw === OFF ? raw : null;
        } catch (_) {
            return _memory;
        }
    }

    function write(value) {
        _memory = value;
        const store = storage();
        if (store) {
            try {
                store.setItem(KEY, value);
            } catch (_) {
                // Quota, or a browser refusing to persist. The in-memory value still applies,
                // which is the difference between "works until you reload" and "does not work".
            }
        }
        for (const listener of Array.from(listeners)) {
            try {
                listener(value);
            } catch (err) {
                // One bad listener must not stop the others being told.
                if (global && global.console) {
                    global.console.warn('[QuestVoice] listener failed:', err);
                }
            }
        }
        return value;
    }

    /** Off unless somebody turned it on. A profile that never touched it hears what it always heard. */
    function isOn() {
        return state() === ON;
    }

    /** Returns true when the state changed, so a caller can tell a no-op from a switch. */
    function set(on) {
        const next = on ? ON : OFF;
        if (state() === next) {
            return false;
        }
        write(next);
        return true;
    }

    /** Subscribe. Returns an unsubscribe, and never fires for a write that changed nothing. */
    function onChange(listener) {
        if (typeof listener !== 'function') {
            return () => {};
        }
        listeners.add(listener);
        return () => listeners.delete(listener);
    }

    /** For tests, and for a Settings panel that wants to start from a known state. */
    function reset() {
        // Listeners stay: TTSProvider subscribes once at load, and a reset that dropped it
        // would leave the engine deaf to every later flip of the switch.
        _memory = null;
        const store = storage();
        if (store) {
            try {
                store.removeItem(KEY);
            } catch (_) {
                /* nothing to undo */
            }
        }
    }

    /* ------------------------------------------------------------------ */
    /* Device                                                              */
    /* ------------------------------------------------------------------ */

    /** Pure: is this user-agent string a Meta Quest browser? */
    function isQuestUA(ua) {
        return QUEST_UA.test(String(ua || ''));
    }

    /**
     * Is the page running on a Quest right now? `?questVoice=1` answers yes on any device,
     * so the toggle and every path behind it can be exercised from a desktop browser —
     * the only other way to test this is to put a headset on.
     */
    function detect(env) {
        const nav = env && 'navigator' in env ? env.navigator : global && global.navigator;
        const loc = env && 'location' in env ? env.location : global && global.location;
        if (isQuestUA(nav && nav.userAgent)) {
            return true;
        }
        try {
            return /[?&]questVoice=1(?:&|$)/.test(String((loc && loc.search) || ''));
        } catch (_) {
            return false;
        }
    }

    /* ------------------------------------------------------------------ */
    /* Decisions — pure, every input passed in                             */
    /* ------------------------------------------------------------------ */

    /** The one condition every rule below starts from: on a Quest, with the switch on. */
    function applies(ctx) {
        return !!(ctx && ctx.isQuest && ctx.on);
    }

    /**
     * Does Piper have a voice for this language? Base match ("es-MX" counts for "es-ES"),
     * because that is how Settings lists Piper voices for a language. `voices` is the
     * provider's own catalogue, passed in so this stays pure.
     */
    function piperCovers(lang, voices) {
        const base = String(lang || '')
            .slice(0, 2)
            .toLowerCase();
        if (!base || !Array.isArray(voices)) {
            return false;
        }
        return voices.some((v) =>
            String((v && v.lang) || '')
                .toLowerCase()
                .startsWith(base)
        );
    }

    /**
     * Which engine should speak, given what the person stored in TTS ENGINE.
     *
     * Only ever moves a Quest with the switch on to Piper, and only when Piper is
     * registered — a page that failed to load the provider keeps the voice it has.
     * Everything else gets `stored` back unchanged, which is what makes "off" mean
     * "today's behaviour" rather than "today's behaviour, mostly".
     */
    function effectiveEngine(ctx) {
        const stored = (ctx && ctx.stored) || BUILTIN;
        // HV-FIX 9. SonicAgent is already the natural voice this switch exists to give a Quest,
        // and the person chose it. Moving it to on-device Piper swapped her Kristin for a
        // different voice synthesized on the headset's CPU — the opposite of what was asked.
        if (stored === REMOTE) {
            return stored;
        }
        if (applies(ctx) && ctx.piperAvailable) {
            return PIPER;
        }
        return stored;
    }

    /**
     * An engine failed before it made a sound. Which engine, if any, should try the same
     * reply? Answers null — "fail the way you always did" — unless the switch applies.
     *
     * Only one direction exists, Piper → system voice, because that is the only failure
     * the switch can cause: with it on, the system voice runs only for languages Piper
     * cannot speak, so there is nothing to fall forward to. `alreadyFellBack` is the loop
     * guard; a fallback never falls back again.
     */
    function fallbackFor(ctx) {
        if (!applies(ctx) || ctx.alreadyFellBack) {
            return null;
        }
        if (ctx.failed === PIPER && ctx.webSpeechAvailable) {
            return BUILTIN;
        }
        return null;
    }

    const api = {
        KEY,
        ON,
        OFF,
        PIPER,
        BUILTIN,
        state,
        isOn,
        set,
        onChange,
        reset,
        isQuestUA,
        detect,
        applies,
        piperCovers,
        effectiveEngine,
        fallbackFor,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (global) {
        global.NEXUS_QUEST_VOICE = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
