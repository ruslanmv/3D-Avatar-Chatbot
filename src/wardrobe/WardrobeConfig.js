(function (global) {
    'use strict';

    /**
     * WF1. Which Wardrobe Forge the page talks to, by default and by choice.
     *
     * Until WF1 a Forge was opt-in: nothing was configured, so the deployment that ships
     * offered the bundled looks and a line saying new ones "need Wardrobe Forge" — while the
     * project's own Forge was running on Hugging Face the whole time, its five library avatars
     * byte-identical to the five this site pins (AvatarIdentity), CORS open to any page and
     * no key required. Every visitor met the feature switched off.
     *
     * So the public Space is now the default, and Settings ▸ Wardrobe Forge lets a person
     * point at their own (a local Forge while developing one, a private Space) or turn it off.
     * The order of authority is deliberate:
     *
     *   1. the page's own `NEXUS_WARDROBE_CONFIG` — a deployment that names a Forge (or says
     *      `forge.enabled: false`) has decided, and Settings shows that rather than override it;
     *   2. the person's stored choice — `wardrobe_forge_mode` of `default`, `custom` or `off`,
     *      with the custom URL in `wardrobe_forge_url` (a URL stored there before WF1, with no
     *      mode beside it, still counts as custom: nobody's endpoint is silently replaced);
     *   3. the default Space.
     *
     * Nothing here fetches anything; Settings tests a connection, this only says where.
     */
    var DEFAULT_FORGE_URL = 'https://ruslanmv-3d-wardrobe-forge.hf.space';
    var MODE_KEY = 'wardrobe_forge_mode';
    var URL_KEY = 'wardrobe_forge_url';
    var GRANT_KEY = 'wardrobe_forge_grant';
    /** BI5. The longest-lived grant a page's public configuration may carry (Forge's AC1 ceiling). */
    var SITE_GRANT_MAX_S = 15 * 60;
    var MODES = ['default', 'custom', 'off'];

    function read(storage, key) {
        try {
            return storage ? storage.getItem(key) : null;
        } catch (_) {
            return null; // a browser that blocks storage still gets the default
        }
    }

    /**
     * A Forge base URL from what a person typed, or null. http(s) only; the paths people
     * copy from the Forge itself (`/studio/`, `/v1/...`, `/docs`) are taken back to its root.
     */
    function normalizeForgeUrl(text) {
        var raw = String(text || '').trim();
        if (!raw) return null;
        if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = 'https://' + raw;
        var url;
        try {
            url = new URL(raw);
        } catch (_) {
            return null;
        }
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
        if (url.username || url.password) return null; // never a credential in a URL we store
        var path = url.pathname.replace(/\/(studio|docs|v1)(\/.*)?$/i, '').replace(/\/+$/, '');
        return url.origin + path;
    }

    /** The person's choice as stored: {mode, url}. Never throws. */
    function storedForgeChoice(storage) {
        storage = storage === undefined ? global.localStorage : storage;
        var mode = read(storage, MODE_KEY);
        var url = normalizeForgeUrl(read(storage, URL_KEY));
        if (MODES.indexOf(mode) === -1) mode = url ? 'custom' : 'default';
        if (mode === 'custom' && !url) mode = 'default';
        return { mode: mode, url: url };
    }

    /** Store a choice from Settings. `{mode, url}`; answers {ok, why}. */
    function saveForgeChoice(choice, storage) {
        storage = storage === undefined ? global.localStorage : storage;
        choice = choice || {};
        var mode = MODES.indexOf(choice.mode) === -1 ? 'default' : choice.mode;
        var url = null;
        if (mode === 'custom') {
            url = normalizeForgeUrl(choice.url);
            if (!url) return { ok: false, why: 'That is not a web address. Use one like https://my-forge.hf.space' };
        }
        try {
            storage.setItem(MODE_KEY, mode);
            if (url) storage.setItem(URL_KEY, url);
            else if (mode === 'default') storage.removeItem(URL_KEY);
        } catch (error) {
            console.warn('[Wardrobe] the Forge choice could not be stored', error);
            return { ok: false, why: 'This browser would not save the setting.' };
        }
        return { ok: true, why: '' };
    }

    /**
     * Where the Forge comes from: {source: 'site' | 'default' | 'custom' | 'off', url}.
     * `site` means the page's configuration decided and Settings cannot change it.
     */
    function resolveForge(supplied, storage) {
        supplied = supplied || {};
        var forge = supplied.forge && typeof supplied.forge === 'object' ? supplied.forge : null;
        // W11. `forge: {enabled, baseUrl}` names a Forge by URL, not by host: a Hugging Face
        // Space, Cloud Run or localhost all read the same. `forge.enabled: false` means no
        // Forge at all, whatever an older `apiUrl` or a stored URL says. `apiUrl` still works.
        if (forge && forge.enabled === false) return { source: 'site', url: '' };
        var pinned = (forge && forge.baseUrl) || supplied.apiUrl;
        if (pinned) return { source: 'site', url: String(pinned).replace(/\/$/, '') };
        var choice = storedForgeChoice(storage);
        if (choice.mode === 'off') return { source: 'off', url: '' };
        if (choice.mode === 'custom') return { source: 'custom', url: choice.url };
        return { source: 'default', url: DEFAULT_FORGE_URL };
    }

    /**
     * BI2. Keep (or, with an empty value, forget) this device's Forge read grant. Only the
     * shape is checked here (`<claims>.<signature>`, base64url); Forge decides whether it is
     * valid, unexpired and for her.
     */
    function saveGrant(value, storage) {
        var store = storage || (typeof global.localStorage !== 'undefined' ? global.localStorage : null);
        var grant = String(value || '').trim();
        if (grant && !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(grant)) {
            return { ok: false, why: 'That is not a Forge read grant (it looks like two parts joined by a dot).' };
        }
        try {
            if (grant) store.setItem(GRANT_KEY, grant);
            else store.removeItem(GRANT_KEY);
        } catch (_) {
            return { ok: false, why: 'This browser would not store it.' };
        }
        return { ok: true, why: '', grant: grant };
    }

    /**
     * BI5. What a grant says about itself: `{sub, exp, iat, lifetime}` from its claims, or null
     * when it cannot be read. Nothing here is trusted (Forge checks the signature); it only
     * tells a short-lived account capability from a long-lived operator grant.
     */
    function describeGrant(grant) {
        try {
            var body = String(grant || '').split('.')[0];
            if (!body) return null;
            var padded = body.replace(/-/g, '+').replace(/_/g, '/');
            while (padded.length % 4) padded += '=';
            var claims = JSON.parse(global.atob ? global.atob(padded) : Buffer.from(padded, 'base64').toString('utf8'));
            var exp = Number(claims.exp);
            var iat = Number(claims.iat);
            if (!isFinite(exp) || !isFinite(iat)) return null;
            return { sub: typeof claims.sub === 'string' ? claims.sub : null, exp: exp, iat: iat, lifetime: exp - iat };
        } catch (_) {
            return null;
        }
    }

    /**
     * BI5. The grant a *page's own configuration* may carry, or '' with the reason.
     *
     * `NEXUS_WARDROBE_CONFIG.forge.grant` is served to every visitor: whatever is put there is
     * a shared credential. An operator grant lasts up to thirty days and names no one, so one
     * in the page hands every visitor a month of every listed avatar's private looks, and
     * taking it back means a redeploy. Only a short-lived grant is honoured from there
     * (`SITE_GRANT_MAX_S`, Forge's ceiling for an account capability); a longer one, or one
     * that cannot be read, is refused and said so once in the console. The grant a person
     * pastes into Settings on their own device is theirs and is not judged here, and a signed-in
     * person's capability comes from `forge.capabilityUrl`, the site's own server.
     */
    function siteGrant(value) {
        var grant = String(value || '').trim();
        if (!grant) return { grant: '', refused: '' };
        var about = describeGrant(grant);
        if (!about || about.lifetime > SITE_GRANT_MAX_S) {
            var why = about ? 'long-lived' : 'unreadable';
            if (!siteGrant.warned && global.console && global.console.warn) {
                siteGrant.warned = true;
                global.console.warn(
                    '[Wardrobe] forge.grant in the page configuration was ignored (' +
                        why +
                        '): a grant in public configuration is shared by every visitor. Use forge.capabilityUrl ' +
                        '(short-lived, per signed-in account) or Settings ▸ Wardrobe Forge on one device.'
                );
            }
            return { grant: '', refused: why };
        }
        return { grant: grant, refused: '' };
    }

    function readBool(value, fallback) {
        if (value === undefined || value === null || value === '') return fallback;
        if (typeof value === 'boolean') return value;
        return String(value).toLowerCase() === 'true' || String(value) === '1';
    }

    function resolveWardrobeConfig() {
        var supplied = global.NEXUS_WARDROBE_CONFIG || {};
        var storage = null;
        try {
            storage = global.localStorage;
        } catch (_) {
            storage = null; // storage blocked: the page's settings and the default still apply
        }
        var forge = resolveForge(supplied, storage);
        var apiUrl = forge.url;
        var fromSite = siteGrant(supplied.forge && supplied.forge.grant);

        return {
            enabled: readBool(
                supplied.enabled !== undefined ? supplied.enabled : read(storage, 'wardrobe_enabled'),
                true
            ),
            staticManifest:
                supplied.staticManifest ||
                read(storage, 'wardrobe_static_manifest') ||
                '/vendor/wardrobe/wardrobe.json',
            apiUrl: String(apiUrl || '').replace(/\/$/, ''),
            // WF1. Where that came from, for Settings: site | default | custom | off.
            forgeSource: forge.source,
            remoteGeneration: readBool(supplied.remoteGeneration, Boolean(apiUrl)),
            // For development against a keyed Forge only. A public page never holds a key: a
            // hosted Forge trusts its pages by origin (Forge F5) or sits behind a proxy (F4).
            token: supplied.token || '',
            // BI2. A Forge read grant (`X-Wardrobe-Grant`): read-only, expiring, scoped to named
            // library avatars, minted by the operator in Forge's admin session. It is what lets
            // this page list and download her private looks without ever holding the admin
            // token, which can declare, import and delete. The site's own config wins; otherwise
            // the one pasted into Settings on this device (`wardrobe_forge_grant`).
            // BI5. From the page's configuration only when it is short-lived (`siteGrant`).
            grant: String(fromSite.grant || read(storage, GRANT_KEY) || '').trim(),
            grantRefused: fromSite.refused,
            // BI5. Where a signed-in person's short-lived capability comes from: an endpoint of
            // this site's own server (it knows who is signed in; this page does not hold their
            // identity secret). Answers `{token, expiresIn | expires}` to
            // `POST {avatars: [slug]}`. Empty: no account capabilities, as before.
            capabilityUrl: String((supplied.forge && supplied.forge.capabilityUrl) || '').trim(),
            // W11. Check a look against its pack's SHA-256 before wearing it.
            verifyLooks: readBool(supplied.verifyLooks, true),
            // W14. Importing wardrobe packs into this browser.
            imports: readBool(supplied.imports, true),
        };
    }

    var api = {
        DEFAULT_FORGE_URL: DEFAULT_FORGE_URL,
        resolveWardrobeConfig: resolveWardrobeConfig,
        resolveForge: resolveForge,
        GRANT_KEY: GRANT_KEY,
        SITE_GRANT_MAX_S: SITE_GRANT_MAX_S,
        describeGrant: describeGrant,
        siteGrant: siteGrant,
        saveGrant: saveGrant,
        normalizeForgeUrl: normalizeForgeUrl,
        storedForgeChoice: storedForgeChoice,
        saveForgeChoice: saveForgeChoice,
    };
    global.NEXUS_WARDROBE_CONFIG_API = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
