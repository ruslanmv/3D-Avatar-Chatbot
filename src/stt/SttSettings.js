/**
 * SttSettings — ST6. What on-device speech recognition is doing, under Settings ▸ STT PROVIDER.
 *
 * The switch itself is the existing STT PROVIDER select: its "On-device Whisper" option (value
 * 'wasm', saved by SAVE into `stt_config.provider`) is what SttRouter reads. This module adds
 * the part a person needs to trust it: whether the model is downloaded, a progress bar while it
 * downloads (~41 MB the first time — on a headset that is long enough to look broken without
 * one), "Download now" so the first sentence is not the one that waits, "Remove downloaded
 * model", a link to the speech check page, and — in Meta Quest Browser with the browser's own
 * recognizer chosen — the sentence saying that recognizer cannot work there.
 *
 * Drawn from JS rather than written into index.html, like QuestVoiceSettings and the Forge
 * section: markup added above the parity harness's frozen lines shifts every one below it.
 * Status and copy are pure (`statusText`, `advice`) and tested; the DOM half is thin.
 */
(function (global) {
    'use strict';

    const GROUP_ID = 'stt-local-group';

    const COPY = Object.freeze({
        quest:
            'Meta Quest Browser cannot turn speech into text by itself — choose On-device Whisper to ' +
            'talk to her here. It runs on the headset; your voice is not uploaded.',
        about:
            'Whisper runs on this device: your voice never leaves it. The model downloads once and is ' +
            'kept by the browser. Text appears when you finish speaking (it does not type as you talk).',
        italian: 'For Italian, Base is more accurate than Tiny (about twice the download and the wait).',
        apply: 'Press SAVE to switch to on-device recognition.',
    });

    function api() {
        return (global && global.NEXUS_STT) || null;
    }

    /** The status sentence for a model state. Pure. */
    function statusText(s) {
        const st = s || {};
        const p = st.progress || {};
        const mb = (n) => (n / 1e6).toFixed(1);
        switch (st.model) {
            case 'downloading':
                return p.total
                    ? `Downloading the speech model… ${mb(p.loaded)} of ${mb(p.total)} MB`
                    : 'Downloading the speech model…';
            case 'loading':
                return 'Preparing the speech model…';
            case 'ready':
                return 'Ready — speech is turned into text on this device.';
            case 'error':
                return `The speech model could not load: ${st.error || 'unknown error'}. Check the connection and try again.`;
            default:
                return `Not downloaded yet (about ${(st.config && st.config.downloadMB) || 41} MB). It downloads the first time you speak, or now:`;
        }
    }

    /**
     * Extra lines for the person's situation. Pure.
     * { isQuest, selected: provider in the select, saved: provider in force, size, lang }
     */
    function advice(ctx) {
        const c = ctx || {};
        const out = [];
        if (c.selected === 'wasm' && c.saved !== 'wasm') out.push(COPY.apply);
        if (c.isQuest && c.selected !== 'wasm') out.push(COPY.quest);
        if (c.selected === 'wasm' && c.size === 'tiny' && /^it/i.test(c.lang || '')) out.push(COPY.italian);
        return out;
    }

    function render(doc) {
        const d = doc;
        const group = d.getElementById(GROUP_ID);
        const stt = api();
        if (!group || !stt) return;
        const select = d.getElementById('stt-provider');
        const selected = select ? select.value : null;
        const saved = stt.readSttConfig().provider || 'webspeech';
        const status = stt.status();
        const sizeSel = d.getElementById('wasm-model-size');
        const langSel = d.getElementById('stt-language') || d.getElementById('speech-lang');
        const lines = advice({
            isQuest: /OculusBrowser|Quest/i.test((global.navigator && global.navigator.userAgent) || ''),
            selected,
            saved,
            size: sizeSel ? sizeSel.value : status.config.model,
            lang: langSel ? langSel.value : '',
        });
        const local = selected === 'wasm';
        group.querySelector('[data-stt="local"]').hidden = !local;
        group.querySelector('[data-stt="status"]').textContent = statusText(status);
        const p = status.progress;
        const bar = group.querySelector('[data-stt="bar"]');
        const fraction = status.model === 'ready' ? 1 : p && p.fraction != null ? p.fraction : 0;
        bar.style.width = Math.round(fraction * 100) + '%';
        bar.parentNode.hidden = !(status.model === 'downloading' || status.model === 'loading');
        group.querySelector('[data-stt="download"]').hidden =
            status.model === 'ready' || status.model === 'downloading';
        group.querySelector('[data-stt="remove"]').hidden = status.model !== 'ready';
        const adv = group.querySelector('[data-stt="advice"]');
        adv.textContent = lines.join(' ');
        adv.hidden = !lines.length;
    }

    function el(d, tag, props) {
        const e = d.createElement(tag);
        Object.assign(e, props || {});
        return e;
    }

    function mount(doc) {
        const d = doc || (global && global.document);
        if (!d || !api()) return false;
        if (d.getElementById(GROUP_ID)) {
            render(d);
            return true;
        }
        const select = d.getElementById('stt-provider');
        const anchor = select && select.closest ? select.closest('.input-group') : null;
        if (!anchor || !anchor.parentNode) return false;

        const group = el(d, 'div', { id: GROUP_ID, className: 'input-group' });
        const advice = el(d, 'p', { className: 'voice-status' });
        advice.setAttribute('data-stt', 'advice');
        advice.setAttribute('aria-live', 'polite');
        advice.style.marginTop = '4px';

        const local = el(d, 'div');
        local.setAttribute('data-stt', 'local');
        const about = el(d, 'p', { className: 'voice-status', textContent: COPY.about });
        about.style.opacity = '0.8';
        const status = el(d, 'p', { className: 'voice-status' });
        status.setAttribute('data-stt', 'status');
        status.setAttribute('aria-live', 'polite');
        const track = el(d, 'div');
        track.style.cssText =
            'height:6px;border-radius:3px;background:rgba(255,255,255,0.12);overflow:hidden;margin:6px 0';
        const bar = el(d, 'div');
        bar.setAttribute('data-stt', 'bar');
        bar.style.cssText = 'height:100%;width:0;background:#22d3ee;transition:width 120ms linear';
        track.appendChild(bar);
        const row = el(d, 'div');
        row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:6px';
        const download = el(d, 'button', { type: 'button', className: 'btn-secondary', textContent: 'Download now' });
        download.setAttribute('data-stt', 'download');
        const remove = el(d, 'button', {
            type: 'button',
            className: 'btn-secondary',
            textContent: 'Remove downloaded model',
        });
        remove.setAttribute('data-stt', 'remove');
        const check = el(d, 'a', {
            href: 'stt-check.html',
            target: '_blank',
            rel: 'noopener',
            textContent: 'Speech check ↗',
        });
        check.style.alignSelf = 'center';
        row.appendChild(download);
        row.appendChild(remove);
        row.appendChild(check);
        local.appendChild(about);
        local.appendChild(status);
        local.appendChild(track);
        local.appendChild(row);
        group.appendChild(advice);
        group.appendChild(local);
        anchor.parentNode.insertBefore(group, anchor.nextSibling);

        download.addEventListener('click', () => {
            api()
                .preload()
                .catch(() => {})
                .then(() => render(d));
            render(d);
        });
        remove.addEventListener('click', () => {
            api()
                .clearCache()
                .catch(() => {})
                .then(() => render(d));
        });
        const rerender = () => render(d);
        select.addEventListener('change', rerender);
        for (const id of ['wasm-model-size', 'stt-language']) {
            const s = d.getElementById(id);
            if (s) s.addEventListener('change', rerender);
        }
        try {
            global.addEventListener('nexus-stt', (e) => {
                const t = e.detail && e.detail.type;
                if (t === 'model-state' || t === 'model-progress' || t === 'config') rerender();
            });
        } catch (_) {}
        render(d);
        return true;
    }

    const out = { GROUP_ID, COPY, statusText, advice, mount, render };

    if (typeof module !== 'undefined' && module.exports) module.exports = out;
    if (global) {
        global.NEXUS_STT_SETTINGS = out;
        const d = global.document;
        if (d && typeof module === 'undefined') {
            if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', () => mount(d));
            else mount(d);
        }
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
