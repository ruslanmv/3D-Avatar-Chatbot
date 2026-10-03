/**
 * WF1. Settings ▸ Wardrobe Forge: which Forge makes new looks, and whether it is answering.
 *
 * The default is the project's public Space (WardrobeConfig.DEFAULT_FORGE_URL), so a visitor
 * meets Try-On able to create looks without configuring anything. This section is how a
 * person changes that — their own endpoint (a local Forge, a private Space) or off — and how
 * they find out that it works before they need it: a Space that has been idle sleeps, and
 * the first request after that waits for it to wake, which reads as "broken" if nothing says
 * so.
 *
 * Three rules this file keeps:
 *
 * - **A change applies at once, without reloading the page.** It is stored, the config is
 *   resolved again, and the running service is re-pointed with `setForge`, which keeps the
 *   controller — and with it the snapshot that puts her back — rather than rebuilding it.
 * - **The page's own configuration wins.** A deployment that names a Forge in
 *   `NEXUS_WARDROBE_CONFIG` (or turns it off) has decided; the section shows that endpoint,
 *   says it is set by this site, and offers no control that would silently do nothing.
 * - **Owned here, not by main.js.** Like the YouTube and web-search fields, the section is
 *   added by this module (before DEVELOPER), so `saveSettings()` knows nothing about it and
 *   the feature stays deletable in one move. Nothing is drawn if the modal is not there.
 *
 * The connection check reads `GET /v1/capabilities` (public, no key) and, when it can,
 * `GET /v1/library` to say whether the Forge holds the same five avatars this site pins —
 * the check TryOnGenerator makes before a job, shown here so a mismatch is found in
 * Settings rather than mid-haul.
 *
 * Exposes: window.NEXUS_WARDROBE_FORGE_SETTINGS
 */
(function (global) {
    'use strict';

    var SECTION_ID = 'wardrobe-forge-section';
    var TIMEOUT_MS = 90000; // a sleeping Space can take most of a minute to wake

    function configApi() {
        return global.NEXUS_WARDROBE_CONFIG_API || null;
    }

    function host(url) {
        try {
            return new URL(url).host;
        } catch (_) {
            return url;
        }
    }

    /**
     * Ask a Forge whether it is there. Resolves {ok, line, templates?, matches?}; never rejects.
     * `fetchImpl` and `identity` are injected for tests.
     */
    async function check(url, options) {
        options = options || {};
        var fetchImpl = options.fetch || (global.fetch && global.fetch.bind(global));
        if (!url) return { ok: false, line: 'Off — Try-On shows saved looks only.' };
        if (!fetchImpl) return { ok: false, line: 'This browser cannot check the connection.' };
        var abort = typeof AbortController !== 'undefined' ? new AbortController() : null;
        var timer = abort ? setTimeout(() => abort.abort(), options.timeoutMs || TIMEOUT_MS) : null;
        try {
            var response = await fetchImpl(url + '/v1/capabilities', {
                signal: abort ? abort.signal : undefined,
                headers: { Accept: 'application/json' },
            });
            if (!response.ok) {
                return { ok: false, line: 'The Forge answered ' + response.status + '. Check the address.' };
            }
            var caps = await response.json();
            var auth = caps && caps.auth;
            if (auth && auth.keyRequired) {
                return { ok: false, line: 'Connected, but this Forge needs a key, which a public page cannot hold.' };
            }
            var templates = (caps && caps.templates) || 0;
            var result = {
                ok: true,
                templates: templates,
                line: 'Connected · ' + templates + ' garment templates · ' + host(url),
            };
            var Identity = options.identity || global.NEXUS_AVATAR_IDENTITY;
            if (Identity && Identity.LIBRARY) {
                try {
                    var library = await (
                        await fetchImpl(url + '/v1/library', { signal: abort && abort.signal })
                    ).json();
                    var published = (library && library.avatars) || [];
                    var pinned = Array.prototype.slice.call(Identity.LIBRARY);
                    var same = pinned.filter((avatar) =>
                        published.some((p) => p && p.slug === avatar.slug && p.sha256 === avatar.sha256)
                    ).length;
                    result.matches = same;
                    if (same < pinned.length) {
                        result.line +=
                            ' · ' +
                            same +
                            ' of ' +
                            pinned.length +
                            ' built-in avatars match — the others cannot get new looks here';
                    }
                } catch (_) {
                    /* the library is a bonus; capabilities answered, so it is connected */
                }
            }
            return result;
        } catch (error) {
            if (error && error.name === 'AbortError') {
                return {
                    ok: false,
                    line: 'No answer after ' + Math.round(TIMEOUT_MS / 1000) + ' s. Is the Space running?',
                };
            }
            return {
                ok: false,
                line: 'Could not reach ' + host(url) + '. Check the address, or that it allows this site (CORS).',
            };
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    /** Store a choice and re-point the running wardrobe. Answers {ok, why, config}. */
    function apply(choice, options) {
        options = options || {};
        var Config = options.config || configApi();
        if (!Config) return { ok: false, why: 'The wardrobe is not loaded.' };
        var saved = Config.saveForgeChoice(choice, options.storage);
        if (!saved.ok) return saved;
        var config = Config.resolveWardrobeConfig();
        var wardrobe = options.wardrobe || global.NEXUS_WARDROBE;
        if (wardrobe && wardrobe.service && typeof wardrobe.service.setForge === 'function') {
            try {
                wardrobe.service.setForge(config.apiUrl);
                // Same object, updated in place: Try-On's activity holds a reference to it.
                if (wardrobe.config) Object.assign(wardrobe.config, config);
                // W15. The outfit dictionary is the new Forge's now.
                var Dictionary = global.NEXUS_OUTFIT_DICTIONARY;
                if (Dictionary && typeof Dictionary.forPage === 'function') Dictionary.forPage().refresh();
            } catch (error) {
                console.warn('[Wardrobe] could not switch Forge', error);
                return { ok: false, why: 'The new endpoint could not be applied. Reload the page to use it.' };
            }
        }
        return { ok: true, why: '', config: config };
    }

    var STYLE_HINT = 'font-size: 0.68rem; color: rgba(255, 255, 255, 0.45); margin: 6px 2px 0';

    function build(doc) {
        var section = doc.createElement('div');
        section.className = 'config-section';
        section.id = SECTION_ID;
        section.innerHTML =
            '<h3 class="config-title">WARDROBE FORGE</h3>' +
            '<div class="input-group">' +
            '<label class="input-label" for="wardrobe-forge-mode">👗 WHERE NEW LOOKS ARE MADE</label>' +
            '<select id="wardrobe-forge-mode" class="select-input">' +
            '<option value="default">Hugging Face — Wardrobe Forge (default)</option>' +
            '<option value="custom">My own Forge endpoint</option>' +
            '<option value="off">Off — saved looks only</option>' +
            '</select>' +
            '<input type="url" id="wardrobe-forge-url" class="text-input" autocomplete="off" spellcheck="false"' +
            ' placeholder="https://my-forge.hf.space" style="margin-top: 8px; display: none" />' +
            '<div style="display: flex; gap: 8px; align-items: center; margin-top: 8px; flex-wrap: wrap">' +
            '<button type="button" id="wardrobe-forge-test" class="secondary-btn"' +
            ' style="padding: 6px 12px; font-size: 0.72rem">Test connection</button>' +
            '<a id="wardrobe-forge-studio" target="_blank" rel="noopener"' +
            ' style="font-size: 0.72rem; color: #7fb7c9; display: none">Open Wardrobe Studio ↗</a>' +
            '</div>' +
            '<p id="wardrobe-forge-status" role="status" aria-live="polite"' +
            ' style="font-size: 0.72rem; color: rgba(255, 255, 255, 0.7); margin: 8px 2px 0"></p>' +
            '<label style="display: flex; align-items: center; gap: 8px; margin-top: 10px; cursor: pointer;' +
            ' font-size: 0.78rem">' +
            '<input type="checkbox" id="wardrobe-ai-enabled" /> Let her change her outfit when you ask in the chat' +
            '</label>' +
            '<p id="wardrobe-forge-hint" style="' +
            STYLE_HINT +
            '">Try-On uses this to create new looks and change the one she has on. Her saved looks work' +
            ' without it. A Hugging Face Space that has been idle takes up to a minute to wake on first use.</p>' +
            '</div>';
        return section;
    }

    /** Draw the section into the Settings modal and wire it. Returns the controller, or null. */
    function attach(options) {
        options = options || {};
        var doc = options.doc || global.document;
        var Config = options.config || configApi();
        if (!doc || !Config) return null;
        var modal = doc.getElementById('settings-modal');
        var content = modal && modal.querySelector('.modal-content');
        if (!content) return null;
        var section = doc.getElementById(SECTION_ID);
        if (!section) {
            section = build(doc);
            var developer = Array.prototype.slice
                .call(content.querySelectorAll('.config-section'))
                .find((node) => /DEVELOPER/.test((node.querySelector('.config-title') || {}).textContent || ''));
            content.insertBefore(section, developer || null);
        }
        var mode = section.querySelector('#wardrobe-forge-mode');
        var input = section.querySelector('#wardrobe-forge-url');
        var status = section.querySelector('#wardrobe-forge-status');
        var test = section.querySelector('#wardrobe-forge-test');
        var studio = section.querySelector('#wardrobe-forge-studio');
        var checking = 0;

        function current() {
            return Config.resolveWardrobeConfig();
        }

        function say(line, ok) {
            status.textContent = line;
            status.style.color = ok === true ? '#7fd6a2' : ok === false ? '#f0a38f' : 'rgba(255, 255, 255, 0.7)';
        }

        async function refresh() {
            var config = current();
            var url = config.apiUrl;
            studio.style.display = url ? '' : 'none';
            if (url) studio.href = url + '/studio/';
            var mine = ++checking;
            if (!url) return say('Off — Try-On shows saved looks only.', null);
            say('Checking ' + host(url) + '… (a sleeping Space can take a minute)', null);
            var result = await check(url, { fetch: options.fetch });
            if (mine === checking) say(result.line, result.ok);
            return result;
        }

        function render() {
            var config = current();
            var site = config.forgeSource === 'site';
            var choice = Config.storedForgeChoice(options.storage);
            mode.value = site ? (config.apiUrl ? 'custom' : 'off') : choice.mode;
            input.value = site ? config.apiUrl : choice.url || '';
            input.style.display = mode.value === 'custom' ? '' : 'none';
            mode.disabled = site;
            input.disabled = site;
            if (site) {
                section.querySelector('#wardrobe-forge-hint').textContent =
                    'Set by this site' + (config.apiUrl ? ' (' + host(config.apiUrl) + ')' : ' (off)') + '.';
            }
        }

        function commit() {
            if (mode.value === 'custom' && !input.value.trim()) {
                input.style.display = '';
                input.focus();
                return say('Type the address of your Forge, then press Enter.', null);
            }
            var result = apply({ mode: mode.value, url: input.value }, options);
            if (!result.ok) return say(result.why, false);
            render();
            return refresh();
        }

        mode.addEventListener('change', function () {
            input.style.display = mode.value === 'custom' ? '' : 'none';
            commit();
        });
        input.addEventListener('change', commit);
        input.addEventListener('keydown', function (event) {
            if (event.key === 'Enter') {
                event.preventDefault();
                commit();
            }
        });
        test.addEventListener('click', refresh);
        // W16. The wardrobe tool's switch (WardrobeTool): on by default — asking her to put
        // something on is the request — and off here for anyone who would rather she did not.
        var aiToggle = section.querySelector('#wardrobe-ai-enabled');
        var Tool = options.tool || global.NEXUS_WARDROBE_TOOL || null;
        if (aiToggle && Tool) {
            aiToggle.checked = Tool.isEnabled();
            aiToggle.addEventListener('change', function () {
                Tool.setEnabled(aiToggle.checked);
            });
        } else if (aiToggle) {
            aiToggle.parentNode.style.display = 'none';
        }
        // Checked whenever Settings opens, so the line is about now, not about page load.
        var opener = doc.getElementById('settings-btn');
        if (opener) opener.addEventListener('click', refresh);
        render();
        return { refresh: refresh, render: render, commit: commit, section: section };
    }

    var api = { SECTION_ID: SECTION_ID, check: check, apply: apply, attach: attach };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_WARDROBE_FORGE_SETTINGS = api;

    if (global && global.document && !(typeof module !== 'undefined' && module.exports)) {
        if (global.document.readyState === 'loading') {
            global.document.addEventListener('DOMContentLoaded', function () {
                attach();
            });
        } else {
            attach();
        }
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
