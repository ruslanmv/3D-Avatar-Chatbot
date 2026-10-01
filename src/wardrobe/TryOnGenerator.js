/**
 * W5. "Create a new look", for Try-On.
 *
 * One call — `create(prompt)` — and three decisions behind it that a Together screen
 * should never have to make:
 *
 * - **Which route.** A built-in avatar goes to Forge's library route by slug; anything
 *   else to the generic route with its URL and licence terms. `AvatarIdentity` decides,
 *   from the controller's snapshot of the original avatar — never from the look she may be
 *   wearing, which Forge does not know.
 * - **Whether the library still matches.** Forge publishes each library avatar's SHA-256.
 *   If a running Forge holds different bytes, a look made there would be fitted to a
 *   different model than the one on screen; that is refused with the reason, once per
 *   avatar, rather than discovered as a look that does not fit.
 * - **What to say.** Progress is Forge's real job states, labelled by `TryOnReasons`; a
 *   refusal is Forge's reason as a sentence.
 *
 * And one guarantee: **the avatar is never touched here.** `create` returns a look and
 * the caller decides whether to wear it; a failure, a refusal or a cancel leaves her
 * exactly as she was, because nothing on those paths calls the viewer.
 *
 * Exposes: window.NEXUS_TRY_ON_GENERATOR
 */
(function (global) {
    'use strict';

    var MAX_PROMPT = 300;
    var NO_FORGE = 'Creating new looks needs Wardrobe Forge. Your saved looks still work.';
    var MISMATCH =
        'This Forge holds a different version of her, so a look made there would not fit her. ' +
        'Your saved looks still work.';

    class TryOnError extends Error {
        constructor(message, options) {
            super(message);
            this.name = 'TryOnError';
            options = options || {};
            this.reason = options.reason || null;
            this.cause = options.cause || null;
        }
    }

    /** Forge's own "passed" (`FitReport.passed`), which it computes but does not serialise. */
    function fitPassed(report) {
        if (!report) return null;
        return Boolean(
            report.vrmValid &&
                report.humanoidValid &&
                report.weightsValid &&
                report.skeletonPreserved &&
                report.sourceRecoverable &&
                ['passed', 'clearance-only', 'warnings'].indexOf(report.clippingCheck) !== -1
        );
    }

    class TryOnGenerator {
        /**
         * options.service    the WardrobeService (its controller owns the snapshot)
         * options.library    a ForgeLibraryClient; built from the service's client when absent
         * options.identity, options.reasons, options.origin   injected for tests
         */
        constructor(options) {
            options = options || {};
            this.service = options.service || null;
            this.Identity = options.identity || global.NEXUS_AVATAR_IDENTITY;
            this.Reasons = options.reasons || global.NEXUS_TRY_ON_REASONS;
            this.origin = options.origin || (global.location && global.location.href) || '';
            this.library = options.library || this._libraryFromService();
            this._verified = new Map();
        }

        _libraryFromService() {
            var Library = global.NEXUS_FORGE_LIBRARY_CLIENT && global.NEXUS_FORGE_LIBRARY_CLIENT.ForgeLibraryClient;
            var service = this.service;
            if (!Library || !service || !service.remoteEnabled) return null;
            var forge = service.controller && service.controller.forge;
            return forge && typeof forge.request === 'function' ? new Library({ client: forge }) : null;
        }

        get controller() {
            return this.service && this.service.controller ? this.service.controller : null;
        }

        /** `{ok, why}` — whether a new look can be made at all, today. */
        availability() {
            if (!this.library || !this.library.available) return { ok: false, why: NO_FORGE };
            return { ok: true, why: '' };
        }

        /** Who Forge would be asked to dress: from the original avatar, not the current look. */
        identity() {
            var controller = this.controller;
            if (!controller) return { kind: 'unknown', why: 'The wardrobe is not ready yet.' };
            var original = controller.original || (controller.snapshot ? controller.snapshot() : null);
            var conditions = null;
            try {
                conditions = controller._conditionsForCurrentAvatar ? controller._conditionsForCurrentAvatar() : null;
            } catch (_) {
                conditions = null;
            }
            return this.Identity.resolve(original, { conditionsOfUse: conditions });
        }

        /** Whether Forge's library holds her bytes: true, false, or null when it cannot say. */
        _matches(identity) {
            if (!this._verified.has(identity.slug)) {
                var check = this.library.library().then(
                    function (published) {
                        return this.Identity.matchesPublished(identity, published);
                    }.bind(this),
                    function () {
                        this._verified.delete(identity.slug); // unknown now; ask again next time
                        return null;
                    }.bind(this)
                );
                this._verified.set(identity.slug, check);
            }
            return this._verified.get(identity.slug);
        }

        _absolute(url) {
            try {
                return new URL(url, this.origin || undefined).href;
            } catch (_) {
                return url;
            }
        }

        _progress(state, onProgress) {
            if (!onProgress) return;
            try {
                onProgress(this.Reasons.progress(state));
            } catch (error) {
                console.warn('[Wardrobe] a progress listener threw', error);
            }
        }

        /**
         * Make a look. Resolves to `{id, name, vrmUrl, previewUrl, prompt, fitPassed, source}`,
         * the shape `WardrobeController.applyLook` and the static bundle already use.
         *
         * options   {onProgress(progress), signal}
         * Rejects with a TryOnError whose message is a sentence, or an AbortError on cancel.
         */
        async create(prompt, options) {
            options = options || {};
            var text = String(prompt || '').trim();
            if (!text) throw new TryOnError('Describe the look first, like “black satin cocktail dress”.');
            if (text.length > MAX_PROMPT) throw new TryOnError('That description is too long. Keep it short.');
            var available = this.availability();
            if (!available.ok) throw new TryOnError(available.why);

            var identity = this.identity();
            if (identity.kind === 'unknown') throw new TryOnError(identity.why);

            this._progress('queued', options.onProgress);
            try {
                var jobId;
                if (identity.kind === 'library') {
                    if ((await this._matches(identity)) === false) {
                        throw new TryOnError(MISMATCH, { reason: 'library_mismatch' });
                    }
                    var accepted = await this.library.createJob(identity.slug, { prompt: text });
                    jobId = accepted && accepted.id;
                } else {
                    var controller = this.controller;
                    var started = await this.library.client.generate({
                        avatarUrl: this._absolute(identity.url),
                        avatarId: (controller && controller.avatarId) || identity.name,
                        prompt: text,
                        mode: 'auto',
                        renderPreview: true,
                        conditionsOfUse: identity.conditionsOfUse,
                    });
                    jobId = started && started.jobId;
                }
                if (!jobId) throw new TryOnError(this.Reasons.TRANSPORT.generic);

                var job = await this.library.wait(jobId, {
                    signal: options.signal,
                    onState: function (state) {
                        this._progress(state, options.onProgress);
                    }.bind(this),
                });
                return this._look(job, text, identity);
            } catch (error) {
                if (error && (error.name === 'AbortError' || error.name === 'TryOnError')) throw error;
                throw new TryOnError(this.Reasons.explain(error), {
                    reason: (error && (error.reason || (error.detail && error.detail.reason))) || null,
                    cause: error,
                });
            }
        }

        _look(job, prompt, identity) {
            var look = (job && job.look) || {};
            if (!look.vrmUrl) throw new TryOnError(this.Reasons.TRANSPORT.generic);
            return {
                id: look.id || job.id,
                name: look.name || prompt,
                vrmUrl: this.library.resolveUrl(look.vrmUrl),
                previewUrl: look.previewUrl ? this.library.resolveUrl(look.previewUrl) : null,
                prompt: prompt,
                fitPassed: fitPassed(job.fitReport),
                source: 'generated',
                avatar: identity.kind === 'library' ? identity.slug : identity.name,
            };
        }
    }

    var api = { TryOnGenerator: TryOnGenerator, TryOnError: TryOnError, fitPassed: fitPassed };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_TRY_ON_GENERATOR = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
