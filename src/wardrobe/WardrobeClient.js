(function (global) {
    'use strict';

    var TERMINAL = new Set(['completed', 'failed', 'rejected']);

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

    class WardrobeClient {
        constructor(options) {
            options = options || {};
            this.baseUrl = String(options.baseUrl || '').replace(/\/$/, '');
            this.token = options.token || '';
            this.fetchImpl = options.fetchImpl || global.fetch.bind(global);
            this.pollIntervalMs = options.pollIntervalMs || 700;
            this.timeoutMs = options.timeoutMs || 15 * 60 * 1000;
        }

        async request(path, options) {
            options = options || {};
            var headers = Object.assign({ Accept: 'application/json' }, options.headers || {});
            if (this.token) headers.Authorization = 'Bearer ' + this.token;
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
            if (options.conditionsOfUse || options.attestModificationAllowed) {
                body.avatar.license = {
                    conditionsOfUse: options.conditionsOfUse || null,
                    userAttestsModificationAllowed: Boolean(options.attestModificationAllowed),
                };
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

            while (Date.now() < deadline) {
                var job = await this.getJob(jobId);
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

        getWardrobe(avatarId) {
            return this.request('/v1/wardrobes/' + encodeURIComponent(avatarId));
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
