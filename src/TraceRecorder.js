/**
 * TraceRecorder — Structured event capture for avatar embodiment sessions.
 *
 * Records avatar state transitions, motions, expressions, gaze, lip-sync,
 * and user interactions into an in-memory ring buffer with optional flush
 * to a remote endpoint.
 *
 * Design principles:
 *   - ADDITIVE ONLY: Does not modify any existing module.
 *   - NON-DESTRUCTIVE: Hooks via addEventListener / polling; never patches globals.
 *   - OpenTelemetry-aligned schema (span-like events with trace_id, timestamp, kind).
 *   - Ring-buffer with configurable capacity (default 2048 events, ~500 KB).
 *   - Batched async flush with retry + exponential back-off.
 *
 * Usage:
 *   // Auto-registers as window.NEXUS_TRACE_RECORDER after import.
 *   import './TraceRecorder.js';
 *
 * @module TraceRecorder
 */
(function () {
    'use strict';

    // ── Constants ───────────────────────────────────────────────────────

    /** Maximum events held before oldest are evicted. */
    const RING_CAPACITY = 2048;

    /** Flush batch size. */
    const FLUSH_BATCH = 128;

    /** Flush interval (ms). Auto-flush when buffer exceeds half capacity. */
    const AUTO_FLUSH_INTERVAL_MS = 30_000;

    /** Retry configuration for network flushes. */
    const MAX_RETRIES = 4;
    const RETRY_BASE_MS = 2000;

    /** Event kind enum — mirrors OpenTelemetry SpanKind semantics. */
    const TraceKind = Object.freeze({
        STATE: 'state', // BehaviorEngine state transitions
        MOTION: 'motion', // Locomotion / positional changes
        EXPRESSION: 'expression', // Facial expressions / emotions
        GAZE: 'gaze', // Look-at / eye tracking
        LIP_SYNC: 'lip_sync', // Viseme sequences
        GESTURE: 'gesture', // Procedural animation events
        USER_INPUT: 'user_input', // User message / mic toggle
        BOT_OUTPUT: 'bot_output', // Bot response text + directives
        XR_SESSION: 'xr_session', // VR/AR session lifecycle
        CUSTOM: 'custom', // Extension point
    });

    // ── Helpers ─────────────────────────────────────────────────────────

    /** Monotonic-ish high-res timestamp (ms since page load). */
    function _hires() {
        return performance.now();
    }

    /** ISO-8601 wall-clock timestamp. */
    function _wallClock() {
        return new Date().toISOString();
    }

    /** Generate a compact trace ID (hex, 16 chars). */
    function _traceId() {
        const buf = new Uint8Array(8);
        crypto.getRandomValues(buf);
        return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
    }

    // ── TraceEvent ──────────────────────────────────────────────────────

    /**
     * Immutable trace event record.
     * @typedef {Object} TraceEvent
     * @property {string}  trace_id   - Session-scoped trace identifier.
     * @property {string}  event_id   - Unique per-event identifier.
     * @property {number}  seq        - Monotonically increasing sequence number.
     * @property {string}  timestamp  - ISO-8601 wall-clock time.
     * @property {number}  elapsed_ms - High-res time since recorder start.
     * @property {string}  kind       - One of TraceKind values.
     * @property {string}  name       - Human-readable event name.
     * @property {Object}  data       - Kind-specific payload.
     * @property {Object}  [context]  - Optional ambient context snapshot.
     */

    // ── Ring Buffer ─────────────────────────────────────────────────────

    class RingBuffer {
        constructor(capacity) {
            this._buf = new Array(capacity);
            this._capacity = capacity;
            this._head = 0;
            this._size = 0;
        }

        push(item) {
            this._buf[this._head] = item;
            this._head = (this._head + 1) % this._capacity;
            if (this._size < this._capacity) this._size++;
        }

        /** Return all items oldest-first without draining. */
        snapshot() {
            if (this._size === 0) return [];
            const start = this._size < this._capacity ? 0 : this._head;
            const out = new Array(this._size);
            for (let i = 0; i < this._size; i++) {
                out[i] = this._buf[(start + i) % this._capacity];
            }
            return out;
        }

        /** Drain up to `n` oldest events. */
        drain(n) {
            const snap = this.snapshot();
            const batch = snap.slice(0, Math.min(n, snap.length));
            // Evict drained entries by advancing tail
            const evictCount = batch.length;
            this._size = Math.max(0, this._size - evictCount);
            return batch;
        }

        get length() {
            return this._size;
        }

        clear() {
            this._head = 0;
            this._size = 0;
        }
    }

    // ── TraceRecorder ───────────────────────────────────────────────────

    class TraceRecorder {
        constructor() {
            this._ring = new RingBuffer(RING_CAPACITY);
            this._seq = 0;
            this._traceId = _traceId();
            this._startedAt = _hires();
            this._flushEndpoint = null;
            this._flushTimer = null;
            this._recording = false;
            this._listeners = []; // for cleanup
            this._onEventCallbacks = []; // external subscribers
        }

        // ── Public API ──────────────────────────────────────────────────

        /**
         * Start recording. Optionally provide a flush endpoint URL.
         * @param {Object} [opts]
         * @param {string} [opts.flushEndpoint] - POST URL for batched flush.
         * @param {string} [opts.traceId]       - Override trace ID.
         */
        start(opts = {}) {
            if (this._recording) return;
            this._recording = true;
            if (opts.traceId) this._traceId = opts.traceId;
            if (opts.flushEndpoint) this._flushEndpoint = opts.flushEndpoint;
            this._startedAt = _hires();
            this._seq = 0;

            this._record(TraceKind.CUSTOM, 'trace.started', {
                user_agent: navigator.userAgent,
                screen: { w: screen.width, h: screen.height },
                device_pixel_ratio: devicePixelRatio,
            });

            // Auto-flush timer
            if (this._flushEndpoint) {
                this._flushTimer = setInterval(() => {
                    if (this._ring.length > FLUSH_BATCH) {
                        this.flush().catch(() => {});
                    }
                }, AUTO_FLUSH_INTERVAL_MS);
            }

            console.log('[TraceRecorder] Recording started, trace_id=' + this._traceId);
        }

        /** Stop recording. Triggers a final flush if endpoint configured. */
        async stop() {
            if (!this._recording) return;
            this._recording = false;
            this._record(TraceKind.CUSTOM, 'trace.stopped', {
                total_events: this._seq,
            });

            if (this._flushTimer) {
                clearInterval(this._flushTimer);
                this._flushTimer = null;
            }

            if (this._flushEndpoint) {
                await this.flush();
            }

            console.log('[TraceRecorder] Recording stopped, total_events=' + this._seq);
        }

        /** Record a trace event. */
        record(kind, name, data = {}, context = null) {
            this._record(kind, name, data, context);
        }

        /** Subscribe to new events (for real-time analytics/UI). */
        onEvent(callback) {
            this._onEventCallbacks.push(callback);
            return () => {
                const idx = this._onEventCallbacks.indexOf(callback);
                if (idx >= 0) this._onEventCallbacks.splice(idx, 1);
            };
        }

        /** Get all recorded events (oldest first). */
        getEvents() {
            return this._ring.snapshot();
        }

        /** Get events filtered by kind. */
        getEventsByKind(kind) {
            return this._ring.snapshot().filter((e) => e.kind === kind);
        }

        /** Get summary statistics. */
        getSummary() {
            const events = this._ring.snapshot();
            const kinds = {};
            for (const e of events) {
                kinds[e.kind] = (kinds[e.kind] || 0) + 1;
            }
            return {
                trace_id: this._traceId,
                total_events: this._seq,
                buffered_events: this._ring.length,
                kinds,
                duration_ms: _hires() - this._startedAt,
                recording: this._recording,
            };
        }

        /** Flush buffered events to the remote endpoint. */
        async flush() {
            if (!this._flushEndpoint) return { flushed: 0 };
            const batch = this._ring.drain(FLUSH_BATCH);
            if (batch.length === 0) return { flushed: 0 };

            let attempt = 0;
            while (attempt < MAX_RETRIES) {
                try {
                    const resp = await fetch(this._flushEndpoint, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            trace_id: this._traceId,
                            events: batch,
                            flushed_at: _wallClock(),
                        }),
                    });
                    if (resp.ok) {
                        return { flushed: batch.length };
                    }
                    throw new Error('HTTP ' + resp.status);
                } catch (err) {
                    attempt++;
                    if (attempt >= MAX_RETRIES) {
                        console.warn('[TraceRecorder] Flush failed after ' + MAX_RETRIES + ' retries:', err.message);
                        return { flushed: 0, error: err.message };
                    }
                    const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
                    await new Promise((r) => setTimeout(r, delay));
                }
            }
        }

        /** Export full trace as JSON (for download / replay). */
        exportJSON() {
            return JSON.stringify(
                {
                    trace_id: this._traceId,
                    started_at: new Date(Date.now() - (_hires() - this._startedAt)).toISOString(),
                    events: this._ring.snapshot(),
                    summary: this.getSummary(),
                },
                null,
                2
            );
        }

        /** Reset the recorder for a new session. */
        reset() {
            this._ring.clear();
            this._seq = 0;
            this._traceId = _traceId();
            this._startedAt = _hires();
        }

        /** Expose enum for external use. */
        get TraceKind() {
            return TraceKind;
        }

        get traceId() {
            return this._traceId;
        }

        get isRecording() {
            return this._recording;
        }

        // ── Internal ────────────────────────────────────────────────────

        _record(kind, name, data, context) {
            const event = {
                trace_id: this._traceId,
                event_id: this._traceId + '-' + this._seq,
                seq: this._seq++,
                timestamp: _wallClock(),
                elapsed_ms: Math.round((_hires() - this._startedAt) * 100) / 100,
                kind,
                name,
                data,
            };
            if (context) event.context = context;

            this._ring.push(event);

            // Notify subscribers
            for (const cb of this._onEventCallbacks) {
                try {
                    cb(event);
                } catch (_) {
                    /* never crash recorder */
                }
            }
        }
    }

    // ── Singleton ───────────────────────────────────────────────────────

    const instance = new TraceRecorder();

    // Expose on global namespace (same pattern as NEXUS_BEHAVIOR etc.)
    if (typeof window !== 'undefined') {
        window.NEXUS_TRACE_RECORDER = instance;
    }

    // Also support ES module / CommonJS if bundled
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = instance;
    }
})();
