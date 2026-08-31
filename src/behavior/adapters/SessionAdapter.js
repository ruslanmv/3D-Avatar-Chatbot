/**
 * SessionAdapter — the realtime channel to HomePilot (spec v1.1 §6.9, batch B9).
 *
 * ## Server intents get no special powers
 *
 * This is the rule the adapter exists to enforce. An `intent` arriving over the socket is
 * treated exactly like one parsed out of a reply: it passes the same §6.2 whitelist and it
 * goes onto the same bus, so the ranker's gates in §6.5 apply unchanged. A server that asks
 * for an emote nobody whitelisted gets nothing — not an error state, not a special case,
 * just a dropped message and a counter.
 *
 * That matters more than it sounds. Curiosity (B16), vision (B15) and the MCP tools (B17)
 * all reach the avatar through this socket. If any of them could name a clip directly, the
 * single enforcement point of §6.5 would have a second door.
 *
 * ## Losing the network is not losing the engine
 *
 * Tier 1 runs locally. A dropped socket costs the *server's* contributions — curiosity, the
 * server's vision answers — and nothing else: local intents keep resolving, the mixer keeps
 * mixing, and reconnection is exponential with a 30 s ceiling (§6.9). `session:down` is a
 * fact to record, not a reason to stop.
 *
 * Exposes: window.NEXUS_BD_SESSION_ADAPTER
 */
const SessionAdapter = (() => {
    'use strict';

    const PROTOCOL_VERSION = 1;

    /** The server pings on this interval (§6.9). The client answers; it does not ping. */
    const HEARTBEAT_MS = 15000;

    /**
     * How long a silence has to last before the link counts as dead. This is the reason the
     * adapter has a `tick` at all: unplugging a network cable does not close a socket, it
     * strands it. `onclose` may never fire, so the only honest evidence of a live link is
     * that the server's heartbeat is still arriving. Two and a half intervals tolerates one
     * lost ping without declaring a healthy session dead.
     */
    const SILENCE_LIMIT_MS = HEARTBEAT_MS * 2.5;

    const BACKOFF_START_MS = 1000;
    const BACKOFF_CEILING_MS = 30000;

    /** Message types this client understands. Anything else is ignored, per §6.9. */
    const KNOWN = new Set([
        'intent',
        'say',
        'vision_insight',
        'scene',
        'error',
        'ping',
        'display',
        'adult_ack',
        // §6.10, batch B10 — the voice uplink's half of the negotiation.
        'voice_answer',
        'voice_ice',
        'voice_state',
    ]);

    /** What the server can say it is doing with the microphone. */
    const VOICE_STATES = new Set(['listening', 'thinking', 'idle']);

    class Adapter {
        /**
         * @param {object} deps
         * @param {object} deps.bus
         * @param {object} deps.config       behavior.config.json
         * @param {object} [deps.blackboard]
         * @param {function} [deps.socketFactory] (url) => WebSocket-like; injectable for tests
         * @param {function} [deps.say]      routes text through the normal TTS pipeline
         */
        constructor({ bus, config = {}, blackboard, socketFactory, say, now = () => Date.now() } = {}) {
            this.bus = bus;
            this.blackboard = blackboard;
            this.config = config;
            this.session = config.session || {};
            this.whitelist = new Set(config.emoteWhitelist || []);
            this.now = now;
            this.say = say || null;

            this.socketFactory =
                socketFactory || ((url) => (typeof WebSocket === 'function' ? new WebSocket(url) : null));

            this.socket = null;
            this.connected = false;
            this.attempts = 0;
            this._timer = null;
            this._stopped = false;

            this.dropped = { notWhitelisted: 0, unknownType: 0, badVersion: 0 };

            /** Set by `voice_answer` (B10). Null until the server accepts an offer. */
            this.voice = null;
            this.voiceState = 'idle';
            this.received = 0;
            this._lastMessageAt = 0;

            /**
             * Server attestation of adult verification (§16.1). Session-scoped by
             * construction: it lives here and on the blackboard, and neither is persisted,
             * so a reload or a reconnect re-asks. Nothing reads it yet — the gate is the
             * ranker's alone (§6.5) and B28 wires it there.
             */
            this.adultVerified = false;
        }

        /** Open the socket. A disabled session is a no-op, not an error. */
        connect() {
            if (this._stopped || !this.session.enabled || !this.session.url) return false;
            let socket;
            try {
                socket = this.socketFactory(this.session.url);
            } catch (error) {
                console.warn('[BD] session socket refused to open', error);
                this._scheduleReconnect();
                return false;
            }
            if (!socket) return false;

            this.socket = socket;
            socket.onopen = () => this._onOpen();
            socket.onmessage = (event) => this.receive(event && event.data);
            socket.onclose = () => this._onClose();
            socket.onerror = () => {
                /* onclose always follows; reconnecting here would double up */
            };
            return true;
        }

        _onOpen() {
            this.connected = true;
            this.attempts = 0;
            this._lastMessageAt = this.now();
            this.blackboard?.setFlag('sessionUp', true);
            this.send({
                v: PROTOCOL_VERSION,
                type: 'hello',
                client: '3dac',
                caps: this._caps(),
                auth: this.session.auth || '',
            });
            this.bus.emit('session:up', {});
        }

        _onClose() {
            const wasConnected = this.connected;
            this.connected = false;
            this.socket = null;
            // A negotiation does not survive the socket it was negotiated on. Forgetting it
            // is what makes `sendVoiceTranscript` refuse rather than post into the void, and
            // what makes the reconnect re-offer rather than assume.
            this.voice = null;
            this.voiceState = 'idle';
            this.blackboard?.setFlag('sessionUp', false);
            if (wasConnected) this.bus.emit('session:down', {});
            this._scheduleReconnect();
        }

        /** Exponential backoff to a 30 s ceiling (§6.9). */
        _scheduleReconnect() {
            if (this._stopped || !this.session.enabled) return;
            const delay = Math.min(BACKOFF_CEILING_MS, BACKOFF_START_MS * 2 ** this.attempts);
            this.attempts++;
            this.nextRetryMs = delay;
            if (typeof setTimeout === 'function') {
                this._timer = setTimeout(() => this.connect(), delay);
            }
        }

        /**
         * Called from the render loop (see boot.js). Does one thing: notices that the
         * server has gone quiet and gives up on a socket that will never close itself.
         *
         * Everything the engine does locally is untouched by this — the point of the
         * watchdog is to get the *reconnect* started, not to stop anything.
         */
        tick() {
            if (!this.connected || this._stopped) return;
            if (this.now() - this._lastMessageAt < SILENCE_LIMIT_MS) return;
            console.warn('[BD] session silent for ' + Math.round(SILENCE_LIMIT_MS / 1000) + 's — reconnecting');
            this._abandon();
        }

        /** Drop a socket we no longer trust, without letting its own `onclose` double up. */
        _abandon() {
            const socket = this.socket;
            if (socket) {
                socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
                try {
                    socket.close();
                } catch {
                    /* already gone */
                }
            }
            this._onClose();
        }

        _caps() {
            const caps = ['tier1local'];
            if (typeof navigator !== 'undefined' && navigator.xr) caps.push('xr');
            if (typeof navigator !== 'undefined' && navigator.mediaDevices) caps.push('capture');
            return caps;
        }

        // ── inbound ──────────────────────────────────────────────────────────

        /**
         * Handle one raw message. Exported rather than private: this is the whole contract,
         * and it should be testable without a socket.
         *
         * @returns {{action: string, why?: string}} what was done with it
         */
        receive(raw) {
            let message;
            try {
                message = typeof raw === 'string' ? JSON.parse(raw) : raw;
            } catch {
                return { action: 'dropped', why: 'not JSON' };
            }
            if (!message || typeof message !== 'object') return { action: 'dropped', why: 'not an object' };

            // Any well-formed frame is evidence the link is alive, heartbeat or not.
            this._lastMessageAt = this.now();
            this.received++;

            if (message.v !== PROTOCOL_VERSION) {
                this.dropped.badVersion++;
                return { action: 'dropped', why: 'wrong protocol version' };
            }
            if (!KNOWN.has(message.type)) {
                // §6.9 forward compatibility: a server that knows more than we do is not an
                // error. Ignore it and keep the session open.
                this.dropped.unknownType++;
                return { action: 'ignored', why: 'unknown type' };
            }

            return this[`_on_${message.type}`](message);
        }

        _on_intent(message) {
            // The rule. A server intent is an intent like any other, which means it has to
            // clear the same whitelist before it reaches the bus.
            if (!this.whitelist.has(message.name)) {
                this.dropped.notWhitelisted++;
                console.warn(`[BD] server intent "${message.name}" is not whitelisted — dropped`);
                return { action: 'dropped', why: 'not whitelisted' };
            }
            const intensity = Number.isFinite(message.intensity) ? message.intensity : 0.6;
            this.bus.emit('intent', { name: message.name, intensity, source: message.source || 'server' });
            return { action: 'emitted' };
        }

        _on_say(message) {
            // §6.9: `say` goes through the normal TTS pipeline, so tts:* and the Talk
            // behaviour fire exactly as they do for a locally generated reply.
            if (typeof message.text !== 'string' || !message.text.trim()) {
                return { action: 'dropped', why: 'empty' };
            }
            if (this.say) this.say(message.text, { source: message.source || 'server' });
            return { action: 'spoken' };
        }

        _on_vision_insight(message) {
            const intents = Array.isArray(message.intents) ? message.intents : [];
            const allowed = intents.filter((intent) => this.whitelist.has(intent && intent.name));
            this.dropped.notWhitelisted += intents.length - allowed.length;
            this.bus.emit('vision:insight', { text: message.text || '', intents: allowed });
            for (const intent of allowed) {
                this.bus.emit('intent', { ...intent, source: 'vision' });
            }
            return { action: 'emitted', why: `${allowed.length}/${intents.length} intents allowed` };
        }

        _on_scene(message) {
            if (typeof message.id !== 'string') return { action: 'dropped', why: 'no scene id' };
            this.bus.emit('scene:enter', { id: message.id });
            return { action: 'emitted' };
        }

        _on_display() {
            // B20 renders these. Until then it is ignored rather than mishandled.
            return { action: 'ignored', why: 'no panel renderer yet' };
        }

        _on_adult_ack(message) {
            // §16.1: server attestation is the only thing that sets this, it is never
            // written to storage, and — this is the part worth being explicit about — on its
            // own it unlocks nothing. It is one of three conditions the ranker's NSFW gate
            // needs, alongside the user's `nsfwAllowed` setting and a mode that permits it.
            // A server that says `verified: true` to a client whose owner never turned the
            // setting on has changed nothing at all.
            this.adultVerified = message.verified === true;
            if (this.blackboard) this.blackboard.adultVerified = this.adultVerified;
            return { action: 'applied' };
        }

        // ── the voice uplink (B10) ───────────────────────────────────────────

        _on_voice_answer(message) {
            // The mode the server *accepted*, which need not be the one offered: a server
            // with no media terminus answers transcript mode, and the client obliges by
            // sending text from the recogniser it already has.
            this.voice = { negotiated: true, mode: message.mode || 'transcript', sdp: message.sdp || '' };
            if (this.onVoiceAnswer) this.onVoiceAnswer(this.voice);
            return { action: 'applied', why: this.voice.mode };
        }

        _on_voice_ice(message) {
            if (this.onVoiceIce) this.onVoiceIce(message.candidate);
            return { action: 'applied' };
        }

        _on_voice_state(message) {
            if (!VOICE_STATES.has(message.state)) return { action: 'dropped', why: 'unknown voice state' };
            this.voiceState = message.state;
            // Not an event on the bus: this drives a mic indicator, it is not something
            // she reacts to, and putting it on the bus would invite exactly that.
            if (this.onVoiceState) this.onVoiceState(message.state);
            return { action: 'applied' };
        }

        /** Offer the uplink. `transcript` needs no SDP — the recogniser is already here. */
        offerVoice(mode = 'transcript', sdp = '') {
            return this.send({ v: PROTOCOL_VERSION, type: 'voice_offer', mode, sdp });
        }

        sendVoiceTranscript(text, { final = true, lang = 'en' } = {}) {
            if (!this.voice || !this.voice.negotiated) return false;
            return this.send({ v: PROTOCOL_VERSION, type: 'voice_transcript', text, final, lang });
        }

        endVoice(reason = 'user_stopped') {
            const sent = this.send({ v: PROTOCOL_VERSION, type: 'voice_end', reason });
            this.voice = null;
            this.voiceState = 'idle';
            return sent;
        }

        _on_error(message) {
            console.warn(`[BD] session error ${message.code}: ${message.msg}`);
            return { action: 'logged' };
        }

        _on_ping() {
            this.send({ v: PROTOCOL_VERSION, type: 'pong' });
            return { action: 'ponged' };
        }

        // ── outbound ─────────────────────────────────────────────────────────

        send(message) {
            if (!this.socket || !this.connected) return false;
            try {
                this.socket.send(JSON.stringify(message));
                return true;
            } catch (error) {
                console.warn('[BD] could not send on the session socket', error);
                return false;
            }
        }

        /** Tell the server what she is doing, so curiosity can pick its moment (§6.12). */
        sendContext(blackboard = this.blackboard) {
            if (!blackboard) return false;
            return this.send({
                v: PROTOCOL_VERSION,
                type: 'ctx',
                mode: blackboard.mode && blackboard.mode.id ? blackboard.mode.id : null,
                activity: blackboard.activity || null,
                attention: blackboard.attention || 0,
            });
        }

        sendUserEvent(name) {
            return this.send({ v: PROTOCOL_VERSION, type: 'user_event', name });
        }

        detach() {
            this._stopped = true;
            if (this._timer) clearTimeout(this._timer);
            this._timer = null;
            try {
                this.socket?.close();
            } catch {
                /* already gone */
            }
            this.socket = null;
            this.connected = false;
            this.blackboard?.setFlag('sessionUp', false);
        }

        get name() {
            return 'SessionAdapter';
        }

        get stats() {
            return {
                connected: this.connected,
                voice: this.voice ? this.voice.mode : null,
                voiceState: this.voiceState,
                attempts: this.attempts,
                nextRetryMs: this.nextRetryMs || 0,
                received: this.received,
                dropped: { ...this.dropped },
            };
        }
    }

    function attach(deps) {
        const adapter = new Adapter(deps);
        adapter.connect();
        return adapter;
    }

    return { attach, Adapter, HEARTBEAT_MS, SILENCE_LIMIT_MS, BACKOFF_CEILING_MS, PROTOCOL_VERSION };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_SESSION_ADAPTER = SessionAdapter;
if (typeof module !== 'undefined' && module.exports) module.exports = SessionAdapter;
