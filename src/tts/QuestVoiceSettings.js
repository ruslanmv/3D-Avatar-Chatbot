/**
 * QuestVoiceSettings — the "Natural voice on Meta Quest" toggle in Settings ▸ Speech (Q6).
 *
 * One checkbox, placed directly under TTS ENGINE, drawn only when the page is running in a
 * Quest browser (or with `?questVoice=1`, for testing from a desk). Everywhere else nothing
 * is added, so the Settings panel desktop and phone users know is unchanged.
 *
 * Built from JS rather than written into index.html for the same reason the Wardrobe Forge
 * section is: markup added near the top of index.html shifts every line the behaviour
 * parity harness has frozen below it.
 *
 * It owns the toggle and the sentence beneath it, nothing more. The state lives in
 * QuestVoice; what that state does to the engines is TTSProvider's business. A change
 * applies at once — the next reply uses it — because a voice switch that needs a Save and
 * a reload is one most people would conclude did not work.
 */
(function (global) {
    'use strict';

    const GROUP_ID = 'quest-voice-group';
    const TOGGLE_ID = 'quest-voice-toggle';

    const COPY = Object.freeze({
        label: 'Natural voice on Meta Quest',
        about:
            'Quest’s built-in voice is basic and can go silent inside VR. Turn this on to use Piper, a ' +
            'natural voice that runs on the headset — in VR too. It downloads once (~60 MB) and is cached.',
        on: 'On · Piper speaks every reply, in VR too.',
        failed:
            'Piper couldn’t load (check the connection) — the built-in voice is speaking for now. ' +
            'It tries again the next time the app opens.',
        noLang: (name) => 'Piper has no ' + name + ' voice, so the built-in voice speaks this language.',
    });

    function quest() {
        return (global && global.NEXUS_QUEST_VOICE) || null;
    }

    function provider() {
        return (global && global.TTSProvider) || null;
    }

    function currentLang(doc) {
        const sel = doc.getElementById('speech-lang');
        return (sel && sel.value) || (global && global.SpeechSettings && global.SpeechSettings.lang) || 'en-US';
    }

    function langName(doc, code) {
        const sel = doc.getElementById('speech-lang');
        const opt = sel ? Array.from(sel.options || []).find((o) => o.value === code) : null;
        return opt ? opt.textContent.trim() : code;
    }

    /**
     * The sentence under the toggle. Pure apart from the reads it is handed, so the three
     * things it can say — on, failed to load, no voice for this language — are testable.
     */
    function statusText(ctx) {
        if (!ctx.on) return '';
        if (ctx.failed === 'piper-wasm') return COPY.failed;
        if (ctx.covers === false) return COPY.noLang(ctx.langName);
        return COPY.on;
    }

    function render(doc) {
        const group = doc.getElementById(GROUP_ID);
        const q = quest();
        if (!group || !q) return;
        const toggle = doc.getElementById(TOGGLE_ID);
        const on = q.isOn();
        if (toggle) toggle.checked = on;

        const tp = provider();
        const piper = global && global.PiperWasmTTSProvider;
        const lang = currentLang(doc);
        let covers = true;
        try {
            if (piper && typeof piper.getVoices === 'function') covers = q.piperCovers(lang, piper.getVoices());
        } catch (_) {}

        const status = group.querySelector('[data-qv="status"]');
        if (status) {
            const text = statusText({
                on,
                failed: tp && typeof tp.lastFailure === 'function' ? tp.lastFailure() : null,
                covers,
                langName: langName(doc, lang),
            });
            status.textContent = text;
            status.hidden = !text;
        }
    }

    /**
     * Insert the toggle under TTS ENGINE. Returns true when it was drawn. Idempotent — a
     * second call finds the group already there and only re-renders it.
     */
    function mount(doc) {
        const d = doc || (global && global.document);
        const q = quest();
        if (!d || !q || !q.detect()) return false;
        if (d.getElementById(GROUP_ID)) {
            render(d);
            return true;
        }
        const engine = d.getElementById('tts-engine');
        const anchor = engine && engine.closest ? engine.closest('.input-group') : null;
        if (!anchor || !anchor.parentNode) return false;

        const group = d.createElement('div');
        group.className = 'input-group';
        group.id = GROUP_ID;

        const label = d.createElement('label');
        label.className = 'input-label';
        const box = d.createElement('input');
        box.type = 'checkbox';
        box.id = TOGGLE_ID;
        const span = d.createElement('span');
        span.style.marginLeft = '8px';
        span.textContent = COPY.label;
        label.appendChild(box);
        label.appendChild(span);

        const about = d.createElement('p');
        about.className = 'voice-status';
        about.style.marginTop = '8px';
        about.style.opacity = '0.8';
        about.textContent = COPY.about;

        const status = d.createElement('p');
        status.className = 'voice-status';
        status.style.marginTop = '6px';
        status.setAttribute('data-qv', 'status');
        status.setAttribute('aria-live', 'polite');
        status.hidden = true;

        group.appendChild(label);
        group.appendChild(about);
        group.appendChild(status);
        anchor.parentNode.insertBefore(group, anchor.nextSibling);

        box.addEventListener('change', () => {
            try {
                q.set(box.checked);
            } catch (err) {
                if (global && global.console) global.console.warn('[QuestVoiceSettings] toggle failed:', err);
            }
            render(d);
        });

        const rerender = () => render(d);
        try {
            global.addEventListener('nexus-tts-engine', rerender);
        } catch (_) {}
        const langSel = d.getElementById('speech-lang');
        if (langSel) langSel.addEventListener('change', rerender);

        render(d);
        return true;
    }

    const api = { GROUP_ID, TOGGLE_ID, COPY, statusText, mount, render };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) {
        global.NEXUS_QUEST_VOICE_SETTINGS = api;
        const d = global.document;
        if (d && typeof module === 'undefined') {
            if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', () => mount(d));
            else mount(d);
        }
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
