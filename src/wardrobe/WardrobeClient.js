(function (global) {
    'use strict';

    var TERMINAL = new Set(['completed', 'failed', 'rejected']);

    /**
     * A conditions-of-use map Forge will accept, or null when there is nothing to say.
     *
     * VRM Manager writes eight VRoid Hub licence fields as strings, but its values come
     * straight off the Hub API and a future field could arrive as a boolean. Forge types the
     * map as `dict[str, str]`, so one non-string value rejects the whole request.
     */
    function stringValues(value) {
        if (!value || typeof value !== 'object') return null;
        var out = {};
        Object.keys(value).forEach(function (key) {
            var entry = value[key];
            if (entry === null || entry === undefined || entry === '') return;
            out[key] = String(entry);
        });
        return Object.keys(out).length ? out : null;
    }

    class WardrobeForgeError extends Error {
        constructor(message, options) {
            super(message);
            this.name = 'WardrobeForgeError';
            options = options || {};
            this.status = options.status || 0;
            this.reason = options.reason || null;
            this.detail = options.detail || null;
        }

        get needsLicenseAttestation() {
            return this.reason === 'requires_user_license_attestation';
        }

        get modificationForbidden() {
            return this.reason === 'source_model_modification_not_permitted';
        }
    }

    /** BI5. A capability is renewed this long before it expires: a 15 MB look takes a while to arrive. */
    var CAPABILITY_MARGIN_MS = 60 * 1000;

    class WardrobeClient {
        constructor(options) {
            options = options || {};
            this.baseUrl = String(options.baseUrl || '').replace(/\/$/, '');
            this.token = options.token || '';
            this.grant = options.grant || '';
            this.fetchImpl = options.fetchImpl || global.fetch.bind(global);
            /**
             * BI5. A signed-in person's capability instead of a stored grant: short-lived (Forge
             * issues at most fifteen minutes), bound to their account and the avatar asked for,
             * fetched from the site's own server and kept only in memory. `capabilityUrl` is that
             * server's endpoint; `capabilityFor()` says which avatar is on stage. With neither,
             * `this.grant` (the device's own, from Settings) is used exactly as before.
             */
            this.capabilityUrl = options.capabilityUrl || '';
            this.capabilityFor = options.capabilityFor || null;
            this.now = options.now || Date.now;
            this._capability = null; // {slug, token, expiresAt}
            this._capabilityPending = null;
            this.pollIntervalMs = options.pollIntervalMs || 700;
            this.timeoutMs = options.timeoutMs || 15 * 60 * 1000;
        }

        /**
         * BI5. The grant to send right now: a live capability for the avatar on stage when the
         * site offers them, else the device's stored grant, else ''. Never throws: a capability
         * that cannot be had means her private looks are not listed, not that the wardrobe breaks.
         * The capability is asked for with the page's own cookies (`same-origin`), so the site's
         * server decides who is signed in; this page sends no identity of its own.
         */
        async currentGrant() {
            if (!this.capabilityUrl) return this.grant || '';
            var slug = '';
            try {
                slug = (this.capabilityFor && this.capabilityFor()) || '';
            } catch (_) {
                slug = '';
            }
            if (!slug) return this.grant || '';
            var held = this._capability;
            if (held && held.slug === slug && held.expiresAt - CAPABILITY_MARGIN_MS > this.now()) return held.token;
            if (this._capabilityPending && this._capabilityPending.slug === slug)
                return this._capabilityPending.promise;
            var self = this;
            var promise = (async function () {
                try {
                    var response = await self.fetchImpl(self.capabilityUrl, {
                        method: 'POST',
                        credentials: 'same-origin',
                        cache: 'no-store',
                        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
                        body: JSON.stringify({ avatars: [slug] }),
                    });
                    if (!response.ok) throw new Error('capability refused (' + response.status + ')');
                    var body = await response.json();
                    var token = body && typeof body.token === 'string' ? body.token : '';
                    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error('not a capability');
                    var seconds = Number(body.expiresIn);
                    var expiresAt =
                        isFinite(seconds) && seconds > 0 ? self.now() + seconds * 1000 : Number(body.expires) * 1000;
                    if (!isFinite(expiresAt) || expiresAt <= self.now()) throw new Error('capability already expired');
                    self._capability = { slug: slug, token: token, expiresAt: expiresAt };
                    return token;
                } catch (error) {
                    self._capability = null;
                    if (!self._capabilityWarned && global.console && global.console.warn) {
                        self._capabilityWarned = true;
                        global.console.warn(
                            '[Wardrobe] no account capability; private looks stay unlisted:',
                            error.message
                        );
                    }
                    // The device's own grant, if the person set one, still stands.
                    return self.grant || '';
                } finally {
                    self._capabilityPending = null;
                }
            })();
            this._capabilityPending = { slug: slug, promise: promise };
            return promise;
        }

        async request(path, options) {
            options = options || {};
            var headers = Object.assign({ Accept: 'application/json' }, options.headers || {});
            if (this.token) headers.Authorization = 'Bearer ' + this.token;
            // BI2. The read grant goes only to this client's own Forge (the path is relative to it).
            var grant = await this.currentGrant();
            if (grant) headers['X-Wardrobe-Grant'] = grant;
            if (options.body && !(options.body instanceof FormData) && !headers['Content-Type']) {
                headers['Content-Type'] = 'application/json';
            }

            var response = await this.fetchImpl(this.baseUrl + path, Object.assign({}, options, { headers: headers }));
            if (!response.ok) {
                var payload = null;
                try {
                    payload = await response.json();
                } catch (_) {
                    payload = null;
                }
                var detail = payload && payload.detail ? payload.detail : payload;
                throw new WardrobeForgeError(
                    (detail && detail.message) || 'Wardrobe Forge request failed (' + response.status + ')',
                    {
                        status: response.status,
                        reason: detail && detail.reason,
                        detail: detail,
                    }
                );
            }
            if (response.status === 204) return null;
            return response.json();
        }

        /**
         * BI2. Headers for downloading `url` itself (a look's VRM): the grant, but only when the
         * URL is on this Forge. A look from a pack or another host never sees it.
         */
        downloadHeaders(url, grant) {
            grant = grant === undefined ? this.grant : grant;
            if (!grant || !this.baseUrl || !url) return {};
            try {
                var base = new URL(this.baseUrl);
                var target = new URL(url, base);
                if (target.origin !== base.origin) return {};
            } catch (_) {
                return {};
            }
            return { 'X-Wardrobe-Grant': grant };
        }

        /** BI5. `downloadHeaders` with the grant that is current now (a capability, when there is one). */
        async downloadHeadersNow(url) {
            return this.downloadHeaders(url, await this.currentGrant());
        }

        async generate(options) {
            options = options || {};
            var avatar = options.storageKey
                ? { storageKey: options.storageKey, avatarId: options.avatarId || 'avatar' }
                : { url: options.avatarUrl, avatarId: options.avatarId || 'avatar' };

            var body = {
                avatar: avatar,
                prompt: options.prompt,
                mode: options.mode || 'auto',
                templateId: options.templateId || null,
                options: {
                    renderPreview: options.renderPreview !== false,
                    engine: options.engine || 'auto',
                    wardrobeId: options.avatarId || 'avatar',
                },
            };
            // MG3. Auto Foundation, as on the library route: only when the caller asks.
            if (options.ensureFoundation) body.options.ensureFoundation = true;
            // FC1. The colour of that foundation, only with it and only when one was chosen.
            if (options.ensureFoundation && options.foundationColor) {
                body.options.foundationColor = String(options.foundationColor);
            }
            if (options.conditionsOfUse || options.attestModificationAllowed) {
                // W1. The key is omitted rather than sent as null, and the values are strings.
                // Forge types this as `dict[str, str]` with a default factory, not as optional:
                // `conditionsOfUse: null` is a 422, and a boolean value is a 422 too. The old
                // code sent exactly that null on the one path this block exists for — the user
                // answering "yes, I have permission" for an avatar whose terms are unknown, so
                // there are no conditions to send. The attestation always failed.
                var license = {
                    userAttestsModificationAllowed: Boolean(options.attestModificationAllowed),
                };
                var conditions = stringValues(options.conditionsOfUse);
                if (conditions) license.conditionsOfUse = conditions;
                body.avatar.license = license;
            }

            return this.request('/v1/generate', { method: 'POST', body: JSON.stringify(body) });
        }

        getJob(jobId) {
            return this.request('/v1/jobs/' + encodeURIComponent(jobId));
        }

        async waitForJob(jobId, options) {
            options = options || {};
            var deadline = Date.now() + (options.timeoutMs || this.timeoutMs);
            var lastState = null;
            var misses = 0;

            while (Date.now() < deadline) {
                // LT8. One failed poll is not a failed job. Measured on the public Space: a look
                // finished on Forge in 32 s, but one poll in between came back as a proxy error
                // without CORS headers (the browser reports a network TypeError) and this loop
                // threw — the haul never wore the look it had asked for. Network errors, 5xx and
                // 429 are retried with backoff; a real answer (404, a failed job) still ends it.
                var job;
                try {
                    job = await this.getJob(jobId);
                    misses = 0;
                } catch (error) {
                    var status = error && error.status;
                    var transient = !status || status >= 500 || status === 429;
                    if (!transient || ++misses > 8) throw error;
                    await new Promise(
                        function (resolve) {
                            global.setTimeout(resolve, Math.min(8000, this.pollIntervalMs * Math.pow(2, misses)));
                        }.bind(this)
                    );
                    continue;
                }
                if (job.state !== lastState) {
                    lastState = job.state;
                    if (options.onState) {
                        var events = job.events || [];
                        options.onState(job.state, events[events.length - 1] || {});
                    }
                }
                if (TERMINAL.has(job.state)) {
                    if (job.state === 'completed') return job;
                    throw new WardrobeForgeError(job.error || 'Wardrobe generation failed', {
                        reason: job.reason,
                        detail: job.fitReport || job,
                    });
                }
                await new Promise(
                    function (resolve) {
                        global.setTimeout(resolve, this.pollIntervalMs);
                    }.bind(this)
                );
            }
            throw new WardrobeForgeError('Wardrobe generation timed out');
        }

        async generateAndWait(options, waitOptions) {
            var accepted = await this.generate(options);
            return this.waitForJob(accepted.jobId, waitOptions);
        }

        /** Browsing only: returns the Forge catalog without running expensive jobs. */
        getGarmentCatalog(category) {
            var query = category ? '?category=' + encodeURIComponent(category) : '';
            return this.request('/v1/catalog/garments' + query);
        }

        /** Queue Forge's customization facade; do not apply until the job succeeds. */
        customizeGarment(options) {
            options = options || {};
            return this.request('/v1/catalog/customize', {
                method: 'POST',
                body: JSON.stringify({
                    avatar: options.avatar,
                    prompt: options.prompt,
                    templateId: options.templateId || null,
                    color: options.color || null,
                    options: Object.assign({ renderPreview: true, engine: 'auto' }, options.options || {}),
                }),
            });
        }

        getWardrobe(avatarId) {
            return this.request('/v1/wardrobes/' + encodeURIComponent(avatarId));
        }

        /**
         * WM3. Her looks ranked by Forge for the scene the app has set up (room, persona, pace,
         * the person's words, what she wears): a few numbered lines for a small model's prompt.
         * Gated by Forge exactly as her list (the grant travels in `request`).
         */
        suggestLooks(avatarId, body) {
            return this.request('/v1/wardrobes/' + encodeURIComponent(avatarId) + '/suggest', {
                method: 'POST',
                body: JSON.stringify(body || {}),
            });
        }

        resolveUrl(url) {
            if (!url) return null;
            if (/^https?:\/\//i.test(url)) return url;
            return this.baseUrl + (url.charAt(0) === '/' ? '' : '/') + url;
        }
    }

    var api = { WardrobeClient: WardrobeClient, WardrobeForgeError: WardrobeForgeError };
    global.NEXUS_WARDROBE_CLIENT = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
