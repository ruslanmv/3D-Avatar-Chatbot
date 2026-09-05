/**
 * screen-insight — "what do you think of this?" (spec v1.1 §6.13, batch B15).
 *
 * The second-screen activity. You share a screen, you ask, she answers with a sentence and
 * a gesture. Almost all of it already exists: B11 owns the consent and the caps, B12 owns
 * the shared-tab capture, B9 owns the socket, and Tier 1 owns turning an intent into a
 * clip. What this adds is the ask.
 *
 * ## On demand by default
 *
 * §6.13 allows ≤1 fps while explicitly enabled, and this ships with that off. A companion
 * who is *reading your screen once a second* is a different product from one who looks when
 * you ask her to, and the difference is a boolean nobody flipped. `startWatching()` exists
 * and is tested; nothing calls it by default.
 *
 * ## It cannot obtain a frame
 *
 * The same structural guarantee B11 built: there is no `navigator` here, no
 * `getDisplayMedia`, and no canvas. A frame comes from a `CapturePipeline`, a pipeline comes
 * from a grant, and a grant comes from the consent machine. Revoking consent mid-flight is
 * therefore not a case this file has to handle carefully — the pipeline returns null and
 * the ask is abandoned, because the grant it was built on is dead.
 *
 * That said, the *ask* can outlive the frame: the network round trip takes seconds, and
 * consent can go during it. So the answer is dropped on arrival if the grant that produced
 * the frame is no longer live. An insight about a screen you have stopped sharing is not
 * one you agreed to.
 *
 * Exposes: window.NEXUS_BD_SCREEN_INSIGHT
 */
const ScreenInsight = (() => {
    'use strict';

    /** §6.13's ceiling for the enabled-continuously mode. The pipeline enforces it too. */
    const WATCH_INTERVAL_MS = 1000;

    /** Give up on an ask after this. A model that has stopped answering is not answering. */
    const ASK_TIMEOUT_MS = 12000;

    /** Do not queue asks; one at a time is what a person means by asking. */
    const MIN_ASK_GAP_MS = 1500;

    class Activity {
        constructor({
            bus,
            blackboard,
            consent,
            capture,
            session,
            config = {},
            endpoint,
            now = () => Date.now(),
        } = {}) {
            this.id = 'screen-insight';
            this.label = 'Look at my screen';

            this.bus = bus;
            this.blackboard = blackboard;
            this.consent = consent;
            this.capture = capture || (typeof window !== 'undefined' ? window.NEXUS_BD_CAPTURE : null);
            this.session = session || null;
            this.config = config;
            this.now = now;

            /** Injected so a test needs no server, and so a deployment can move the route. */
            this.endpoint = endpoint || null;

            this.pipeline = null;
            this.grant = null;
            this.watching = null;
            this.inFlight = null;
            this.lastAskAt = null;
            this.asks = 0;
            this.answers = 0;
            this.dropped = { noConsent: 0, revokedMidFlight: 0, tooSoon: 0, failed: 0, notWhitelisted: 0 };
            this._unsubscribes = [];
            if (consent) this._unsubscribes.push(consent.onChange((state) => this._onConsent(state)));
        }

        get name() {
            return 'ScreenInsight';
        }

        get sharing() {
            return Boolean(this.grant && this.grant.live);
        }

        /** Start sharing. One grant, one pipeline; the caps come from B11, not from here. */
        async start(source = 'screen') {
            if (!this.consent || !this.capture) return null;
            const grant = await this.consent.request(source);
            if (!grant) return null;

            this.grant = grant;
            this.pipeline = this.capture.fromGrant(grant, { config: this.config });
            // The server needs to know consent is live before it will answer an ask (§6.14),
            // and `user_event` already means "something happened on the client".
            if (this.session) this.session.sendUserEvent('capture:start');
            return this.pipeline;
        }

        stop(why = 'user') {
            this.stopWatching();
            if (this.pipeline) this.pipeline.stop();
            this.pipeline = null;
            if (this.session && this.grant) this.session.sendUserEvent('capture:stop');
            if (this.consent && this.grant && this.grant.live) this.consent.revoke(why);
            this.grant = null;
            return true;
        }

        /** A revoke from anywhere — the browser bar, another batch, the panel — lands here. */
        _onConsent(state) {
            if (state.state === 'active') return;
            if (this.pipeline) this.pipeline.stop();
            this.pipeline = null;
            this.stopWatching();
            this.grant = null;
        }

        // ── the ask ──────────────────────────────────────────────────────────

        /**
         * One snapshot, one question, one answer.
         *
         * @returns {Promise<{text, intents}|null>} null for every refusal; `dropped` says
         * which one, because "she said nothing" has several very different causes.
         */
        async ask(prompt = '') {
            if (!this.pipeline || !this.grant || !this.grant.live) {
                this.dropped.noConsent++;
                return null;
            }
            const at = this.now();
            if (this.lastAskAt !== null && at - this.lastAskAt < MIN_ASK_GAP_MS) {
                this.dropped.tooSoon++;
                return null;
            }
            if (this.inFlight) {
                this.dropped.tooSoon++;
                return null;
            }

            const frame = await this.pipeline.sample({ force: true });
            if (!frame) {
                // The pipeline refused: consent went, or the frame was too soon. Either way
                // it already counted it, and there is nothing to send.
                this.dropped.noConsent++;
                return null;
            }

            this.lastAskAt = at;
            this.asks++;
            const grant = this.grant;
            this.inFlight = this._send(frame, prompt);

            let answer;
            try {
                answer = await this.inFlight;
            } catch (error) {
                this.dropped.failed++;
                console.warn('[BD] the insight ask failed', error);
                return null;
            } finally {
                this.inFlight = null;
            }

            // Consent can go while the model is thinking. An insight about a screen you have
            // stopped sharing is not one you agreed to, however far along it was.
            if (!grant.live) {
                this.dropped.revokedMidFlight++;
                return null;
            }
            return this._deliver(answer);
        }

        async _send(frame, prompt) {
            if (!this.endpoint) throw new Error('no vision endpoint configured');
            const ctx = {
                activity: (this.blackboard && this.blackboard.activity) || null,
                scene: (this.blackboard && this.blackboard.scene) || null,
                lastUserMsg: prompt || null,
            };
            // The pipeline hands back a data URL; the endpoint wants the base64 payload.
            const image_b64 = String(frame.dataUrl).split(',')[1] || '';
            return this.endpoint({ image_b64, prompt, ctx }, { timeoutMs: ASK_TIMEOUT_MS });
        }

        /**
         * Put the answer where it belongs: the sentence to speech, the gesture to the bus
         * where the ranker and the §6.5 gates get their say. The server whitelist-checked
         * these already (§6.13); this is the second check, on principle.
         */
        _deliver(answer) {
            if (!answer || typeof answer.text !== 'string') {
                this.dropped.failed++;
                return null;
            }
            const whitelist = new Set(this.config.emoteWhitelist || []);
            const intents = (answer.intents || []).filter((intent) => {
                if (whitelist.has(intent.name)) return true;
                this.dropped.notWhitelisted++;
                return false;
            });

            for (const intent of intents) {
                this.bus.emit('intent', {
                    name: intent.name,
                    intensity: Number.isFinite(intent.intensity) ? intent.intensity : 0.5,
                    source: 'vision',
                });
            }
            if (answer.text) this._say(answer.text);
            this.answers++;
            this.bus.emit('vision:insight', { text: answer.text, intents });
            return { text: answer.text, intents };
        }

        _say(text) {
            try {
                const say = typeof window !== 'undefined' ? window.NEXUS_BD_SAY : null;
                if (typeof say === 'function') say(text);
            } catch (error) {
                console.warn('[BD] an insight could not be spoken', error);
            }
        }

        // ── the continuous mode nobody turns on by default ───────────────────

        /**
         * §6.13's ≤1 fps mode. It exists, it is capped by the pipeline rather than by this
         * interval, and it is off unless someone deliberately starts it.
         */
        startWatching(onInsight, { intervalMs = WATCH_INTERVAL_MS } = {}) {
            if (this.watching || !this.pipeline) return null;
            const period = Math.max(WATCH_INTERVAL_MS, intervalMs);
            const tick = async () => {
                const result = await this.ask('');
                if (result && onInsight) onInsight(result);
            };
            this.watching = typeof setInterval === 'function' ? setInterval(tick, period) : null;
            return this.watching;
        }

        stopWatching() {
            if (this.watching) clearInterval(this.watching);
            this.watching = null;
        }

        detach() {
            this.stop('detached');
            for (const off of this._unsubscribes.splice(0)) off();
        }

        get stats() {
            return {
                sharing: this.sharing,
                watching: Boolean(this.watching),
                asks: this.asks,
                answers: this.answers,
                dropped: { ...this.dropped },
                inFlight: Boolean(this.inFlight),
            };
        }
    }

    /**
     * The default transport: one POST, with a deadline. Built here rather than in the
     * activity so the activity can be tested with no network at all.
     */
    function httpEndpoint(url) {
        return async (body, { timeoutMs = ASK_TIMEOUT_MS } = {}) => {
            const controller = typeof AbortController === 'function' ? new AbortController() : null;
            const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                    signal: controller ? controller.signal : undefined,
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return await response.json();
            } finally {
                if (timer) clearTimeout(timer);
            }
        };
    }

    function attach(deps) {
        return new Activity(deps);
    }

    return { attach, Activity, httpEndpoint, WATCH_INTERVAL_MS, ASK_TIMEOUT_MS, MIN_ASK_GAP_MS };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_SCREEN_INSIGHT = ScreenInsight;
if (typeof module !== 'undefined' && module.exports) module.exports = ScreenInsight;
