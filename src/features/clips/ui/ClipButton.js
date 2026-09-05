/**
 * ClipButton — one tap, and it never leaves the device (addendum v1.2 §15.2, batch B25).
 *
 * The first distribution loop. B24 has been buffering the last thirty seconds the whole
 * time; this is the button that keeps them, plus the small nudge that offers to.
 *
 * ## Saving never uploads, and that is checkable rather than promised
 *
 * A save is `URL.createObjectURL` on the blob B24 already holds, an anchor with a `download`
 * attribute, a click, and a revoke. There is no endpoint, no key, no "share to" and no
 * queue-for-later. The whole of `src/features/clips/` is audited for `fetch`,
 * `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `EventSource`, `import(` and a URL scheme, in
 * `scripts/audit-privacy.mjs` and again in the tests, and this file is inside that boundary.
 *
 * The object URL is revoked on the next tick. Leaving it live keeps the whole clip pinned in
 * memory for the life of the document, which for a thirty-second capture is tens of
 * megabytes that nothing will ever read again.
 *
 * ## The nudge is a nudge
 *
 * "Clip that?" appears at most once a minute and never blocks anything: it is a positioned
 * div with a timeout, it is not modal, it does not await, and it does not pause the moment
 * it is asking about. Its trigger is a **macro event** from B23 — a real win or loss from a
 * game hook, never the heuristic's `surge`, because a toast every time the screen flashes is
 * an advert.
 *
 * ## Both loops shut down in the adult tier
 *
 * Not "the button is hidden": the recorder is stopped and its buffer dropped, and the card
 * renderer refuses. A rolling thirty-second recording of an adult-tier session is the single
 * worst artefact this product could hold, and hiding the button would leave it running.
 * `teardown()` is called on the blackboard's own signal and is idempotent.
 *
 * Exposes: window.NEXUS_BD_CLIP_BUTTON
 */
const ClipButton = (() => {
    'use strict';

    /** The nudge appears at most this often, whatever happens in the game. */
    const SUGGEST_GAP_MS = 60000;

    /** And it goes away by itself. */
    const TOAST_MS = 6000;

    const DOM_ID = 'nexus-bd-clip-toast';

    /** How long an object URL stays alive. One tick: long enough to click, no longer. */
    const REVOKE_MS = 0;

    /**
     * The adult tier is *active* when a verified session also permits NSFW. Both, because
     * either alone is a setting rather than a state — and a named predicate so B29 can
     * tighten it in one place rather than in three consumers.
     */
    function adultActive(blackboard) {
        return Boolean(blackboard && blackboard.adultVerified === true && blackboard.nsfwAllowed === true);
    }

    class Button {
        constructor({ bus, blackboard, recorder, cards, config = {}, doc, now = () => Date.now() } = {}) {
            this.id = 'clipButton';
            this.label = 'Clip';

            this.bus = bus || null;
            this.blackboard = blackboard || null;
            this.recorder = recorder || null;
            this.cards = cards || null;
            this.now = now;
            this.doc = doc || (typeof document !== 'undefined' ? document : null);

            const clips = config.clips || {};
            this.suggestOnMacro = clips.suggestOnMacro !== false;
            this.bufferSec = clips.bufferSec || 30;

            /** Null, not 0 — a suggestion at timestamp zero is a real suggestion. */
            this.lastSuggestAt = null;
            this.saved = 0;
            this.suggested = 0;
            this.suppressed = 0;
            this.cardsMade = 0;
            this.tornDown = false;
            this.toast = null;
            this._unsubscribes = [];
        }

        get name() {
            return 'ClipButton';
        }

        attach() {
            if (this.bus) {
                this._unsubscribes.push(
                    this.bus.on('game:moment', (moment) => this.onMoment(moment)),
                    this.bus.on('mode:changed', () => this.checkTier())
                );
            }
            this.checkTier();
            return this;
        }

        detach() {
            for (const stop of this._unsubscribes.splice(0)) stop();
            this._hideToast();
        }

        // ── the adult tier ───────────────────────────────────────────────────

        /** Re-read the blackboard. Cheap enough to call on any signal that might matter. */
        checkTier() {
            if (adultActive(this.blackboard)) return this.teardown('adult tier');
            return false;
        }

        /**
         * Stop both loops for good. Idempotent, and it stops the *recorder*, not just the
         * button — hiding a button would leave thirty seconds of the session buffered.
         */
        teardown(why = 'user') {
            if (this.tornDown) return true;
            this.tornDown = true;
            this._hideToast();
            if (this.recorder && typeof this.recorder.stop === 'function') this.recorder.stop(why);
            this.cards = null;
            for (const stop of this._unsubscribes.splice(0)) stop();
            return true;
        }

        get available() {
            return !this.tornDown && Boolean(this.recorder && this.recorder.recording);
        }

        // ── one tap ──────────────────────────────────────────────────────────

        /**
         * Save the last thirty seconds to the user's disk.
         *
         * @returns {{ok: boolean, why: string, name?: string}} — a refusal names its reason,
         * because a button that does nothing is worse than one that says why.
         */
        save() {
            if (this.tornDown) return { ok: false, why: 'clips are off in this session' };
            if (!this.recorder) return { ok: false, why: 'nothing is recording' };
            const clip = this.recorder.save({ seconds: this.bufferSec });
            if (!clip || !clip.blob) return { ok: false, why: 'there is nothing buffered yet' };

            const name = this._filename(clip);
            const delivered = this._offer(clip.blob, name);
            if (!delivered) return { ok: false, why: 'this browser cannot save a file' };

            this.saved++;
            this._hideToast();
            return { ok: true, why: 'saved', name, source: clip.source, durationMs: clip.durationMs };
        }

        _filename(clip) {
            const when = new Date(clip.at || this.now()).toISOString().replace(/[:.]/g, '-').slice(0, 19);
            return `clip-${when}.webm`;
        }

        /**
         * Hand the blob to the user. An object URL and an anchor — the browser's own save,
         * with nothing in between.
         */
        _offer(blob, name) {
            const doc = this.doc;
            const urls = typeof URL !== 'undefined' ? URL : null;
            if (!doc || !urls || typeof urls.createObjectURL !== 'function') return false;

            const href = urls.createObjectURL(blob);
            const anchor = doc.createElement('a');
            anchor.href = href;
            anchor.download = name;
            anchor.rel = 'noopener';
            anchor.style.display = 'none';
            doc.body.appendChild(anchor);
            anchor.click();
            anchor.remove();

            // Revoked on the next tick. A live object URL pins the whole clip in memory for
            // the life of the document — tens of megabytes nothing will read again.
            if (typeof setTimeout === 'function') {
                setTimeout(() => {
                    try {
                        urls.revokeObjectURL(href);
                    } catch {
                        /* already gone */
                    }
                }, REVOKE_MS);
            }
            return true;
        }

        // ── the nudge ────────────────────────────────────────────────────────

        /**
         * A moment from B23. Only a **macro event** offers a clip — a real win or loss from
         * a game hook, never the heuristic's `surge`, because a toast every time the screen
         * flashes is an advert.
         */
        onMoment(moment) {
            if (!this.suggestOnMacro) return null;
            if (!moment || moment.macroEvent !== true) return null;
            return this.suggest(moment.kind);
        }

        /**
         * Offer to clip. Returns null when the gap has not elapsed — counted, not silent.
         * Never blocks: no await, no modal, and the moment it is asking about carries on.
         */
        suggest(why = 'moment', at = this.now()) {
            if (this.tornDown || !this.available) return null;
            if (this.lastSuggestAt !== null && at - this.lastSuggestAt < SUGGEST_GAP_MS) {
                this.suppressed++;
                return null;
            }
            this.lastSuggestAt = at;
            this.suggested++;
            this._showToast(why);
            if (this.bus) this.bus.emit('clip:suggested', { why, at });
            return { why, at };
        }

        _showToast(why) {
            const doc = this.doc;
            if (!doc || typeof doc.createElement !== 'function') return null;
            this._hideToast();

            const node = doc.createElement('div');
            node.id = DOM_ID;
            node.setAttribute('role', 'status');
            // `role="status"` and not `alert`: this is an offer, and a screen reader should
            // mention it between sentences rather than interrupt one.
            node.textContent = 'Clip that?';
            node.style.cssText =
                'position:fixed;right:18px;bottom:18px;z-index:2147483000;padding:10px 16px;' +
                'border-radius:999px;background:#0b1017;color:#f2f6ff;font:14px system-ui,sans-serif;' +
                'box-shadow:0 4px 18px rgba(0,0,0,.45);cursor:pointer;pointer-events:auto;';
            node.addEventListener('click', () => this.save());
            if (doc.body) doc.body.appendChild(node);
            this.toast = node;

            if (typeof setTimeout === 'function') {
                this._toastTimer = setTimeout(() => this._hideToast(), TOAST_MS);
            }
            return node;
        }

        _hideToast() {
            if (this._toastTimer && typeof clearTimeout === 'function') clearTimeout(this._toastTimer);
            this._toastTimer = null;
            if (this.toast && typeof this.toast.remove === 'function') this.toast.remove();
            this.toast = null;
        }

        // ── the second loop ──────────────────────────────────────────────────

        /**
         * A "she remembered" card from a real curiosity callback (B16). Refuses an invented
         * one — see `ShareCard`'s header for why that matters more than it sounds.
         */
        card(record, portrait = null) {
            if (this.tornDown || !this.cards) return { ok: false, why: 'cards are off in this session' };
            try {
                const rendered = this.cards.render(record, portrait);
                const url = this.cards.toDataURL();
                this.cardsMade++;
                return { ok: true, why: 'rendered', lines: rendered.lines, url };
            } catch (error) {
                return { ok: false, why: String((error && error.detail) || error.message || error) };
            }
        }

        get stats() {
            return {
                available: this.available,
                tornDown: this.tornDown,
                saved: this.saved,
                suggested: this.suggested,
                suppressed: this.suppressed,
                cards: this.cardsMade,
                toast: Boolean(this.toast),
            };
        }
    }

    function attach(deps) {
        return new Button(deps).attach();
    }

    return { attach, Button, adultActive, SUGGEST_GAP_MS, TOAST_MS, DOM_ID };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_CLIP_BUTTON = ClipButton;
if (typeof module !== 'undefined' && module.exports) module.exports = ClipButton;
