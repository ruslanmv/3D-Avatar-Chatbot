/**
 * W5. Forge's library routes, beside the client that already talks to Forge.
 *
 * `WardrobeClient` speaks the generic route: `POST /v1/generate` with an avatar URL the
 * server must fetch and a licence the caller vouches for. That is right for an avatar the
 * user brought, and wrong for the five this site ships: Forge already holds those, pinned
 * by hash, with the CC0 terms their provenance grants. For them it has
 * `POST /v1/library/{slug}/jobs`, where the body names only the outfit and the server
 * supplies the avatar — so the browser uploads nothing and claims nothing.
 *
 * This file adds that route without changing `WardrobeClient`: every request goes through
 * the existing client's `request()`, so the base URL, the key and the `WardrobeForgeError`
 * a failure turns into are exactly the ones the rest of the wardrobe already handles.
 *
 * It also adds the one thing a person waiting needs and `waitForJob` cannot do: stop. A
 * haul's "Cancel" must end the wait at once rather than poll on for a look nobody wants.
 * The server-side job still finishes; its look simply is not worn.
 *
 * Exposes: window.NEXUS_FORGE_LIBRARY_CLIENT
 */
(function (global) {
    'use strict';

    var TERMINAL = ['completed', 'failed', 'rejected'];

    function cancelled() {
        var error = new Error('Cancelled');
        error.name = 'AbortError';
        return error;
    }

    class ForgeLibraryClient {
        /**
         * options.client   a WardrobeClient (it owns base URL, key and errors)
         * options.pollIntervalMs, options.timeoutMs, options.sleep (tests)
         */
        constructor(options) {
            options = options || {};
            this.client = options.client || null;
            this.pollIntervalMs = options.pollIntervalMs || 700;
            this.timeoutMs = options.timeoutMs || 15 * 60 * 1000;
            this.sleep =
                options.sleep ||
                function (ms) {
                    return new Promise(function (resolve) {
                        global.setTimeout(resolve, ms);
                    });
                };
            this._library = null;
        }

        get available() {
            return Boolean(this.client && typeof this.client.request === 'function');
        }

        _require() {
            if (!this.available) throw new Error('Wardrobe Forge is not configured');
            return this.client;
        }

        /** `GET /v1/library`, fetched once and kept: the pins do not change while the page is open. */
        async library() {
            if (!this._library) {
                var client = this._require();
                this._library = client.request('/v1/library').then(
                    function (listing) {
                        return (listing && listing.avatars) || [];
                    },
                    function (error) {
                        this._library = null; // a failed fetch is retried next time, not remembered
                        throw error;
                    }.bind(this)
                );
            }
            return this._library;
        }

        /**
         * Start a job on a library avatar. Resolves to the accepted job (`{id, state, ...}`).
         *
         * outfit    {prompt, mode?, color?, ...}  an OutfitRequest
         * options   {renderPreview?, engine?, baseLookId?}
         */
        createJob(slug, outfit, options) {
            options = options || {};
            var client = this._require();
            var body = {
                outfit: Object.assign({ mode: 'auto' }, outfit || {}),
                options: { renderPreview: options.renderPreview !== false, engine: options.engine || 'auto' },
            };
            if (options.baseLookId) body.baseLookId = options.baseLookId;
            return client.request('/v1/library/' + encodeURIComponent(slug) + '/jobs', {
                method: 'POST',
                body: JSON.stringify(body),
            });
        }

        job(jobId) {
            return this._require().request('/v1/jobs/' + encodeURIComponent(jobId));
        }

        /**
         * Poll a job to its end. `onState(state, job)` fires once per state change; a
         * `signal` that aborts ends the wait with an AbortError straight away.
         * Resolves to the completed job; a failed or rejected job is thrown as it came.
         */
        async wait(jobId, options) {
            options = options || {};
            var signal = options.signal || null;
            var deadline = Date.now() + (options.timeoutMs || this.timeoutMs);
            var last = null;
            while (Date.now() < deadline) {
                if (signal && signal.aborted) throw cancelled();
                var job = await this.job(jobId);
                if (signal && signal.aborted) throw cancelled();
                if (job.state !== last) {
                    last = job.state;
                    if (options.onState) {
                        try {
                            options.onState(job.state, job);
                        } catch (error) {
                            console.warn('[Wardrobe] a progress listener threw', error);
                        }
                    }
                }
                if (TERMINAL.indexOf(job.state) !== -1) {
                    if (job.state === 'completed') return job;
                    var failure = new Error(job.error || 'Wardrobe generation failed');
                    failure.reason = job.reason || null;
                    failure.job = job;
                    throw failure;
                }
                await this.sleep(this.pollIntervalMs);
            }
            throw new Error('Wardrobe generation timed out');
        }

        resolveUrl(url) {
            return this.client && this.client.resolveUrl ? this.client.resolveUrl(url) : url || null;
        }
    }

    var api = { ForgeLibraryClient: ForgeLibraryClient };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_FORGE_LIBRARY_CLIENT = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
