/**
 * Settings ▸ Discovery & Media.
 *
 * Consumer-facing rule:
 *
 *   capability → preference → resolved provider → credentials only when necessary
 *
 * The provider registry remains the source of truth for readiness. This renderer deliberately
 * keeps infrastructure language (environment variables, proxies, serverless routes) out of the
 * normal settings hierarchy and reveals a personal API-key field only after somebody explicitly
 * chooses a provider that supports one.
 *
 * Exposes: window.NEXUS_DISCOVERY_SETTINGS
 */
const DiscoverySettings = (() => {
    'use strict';

    const HOST_ID = 'discovery-providers';
    const OPEN_ID = 'settings-btn';

    /** ImagePlugin appends image/imageGenerator to this mutable list when it loads. */
    const GROUPS = [
        { id: 'video', label: 'Video search', capability: 'video.search' },
        { id: 'music', label: 'Music search', capability: 'music.search' },
    ];

    const META = {
        web: {
            icon: '🌐',
            label: 'Web search',
            description: 'Search the live web, news and current information.',
            section: 'SEARCH & DISCOVERY',
        },
        image: {
            icon: '🖼',
            label: 'Image search',
            description: 'Find existing images for image and media requests.',
            section: 'SEARCH & DISCOVERY',
        },
        video: {
            icon: '🎬',
            label: 'Video search',
            description: 'Find videos when video results are requested.',
            section: 'SEARCH & DISCOVERY',
        },
        music: {
            icon: '🎵',
            label: 'Music search',
            description: 'Find music and related media.',
            section: 'SEARCH & DISCOVERY',
        },
        imageGenerator: {
            icon: '✨',
            label: 'Image generation',
            description: 'Create new images when the assistant is asked to generate, draw or illustrate something.',
            section: 'CREATION',
        },
    };

    const PROVIDER_LABEL = {
        youtube: 'YouTube',
        pexels: 'Pexels',
        pollinations: 'Pollinations',
        'homepilot-remote': 'HomePilot Remote',
        brave: 'Brave Search',
        serper: 'Serper',
    };

    /** A provider reason code → concise consumer-facing state. */
    const STATE = {
        ok: 'Ready',
        deployment: 'Ready · provided by this site',
        'own-key': 'Ready · using your key',
        checking: 'Checking…',
        'no-key': 'API key required',
        'not-loaded': 'Not available on this page',
        protected: 'Setup required',
        'no-route': 'Setup required',
        'no-bridge': 'Setup required',
        unsupported: 'Setup required',
        unauthorized: 'Setup required',
        unreachable: 'Not responding',
        disabled: 'Disabled',
        broken: 'Unavailable',
    };

    function registry() {
        return (typeof window !== 'undefined' && window.NEXUS_DISCOVERY) || null;
    }

    function webSettings() {
        return (typeof window !== 'undefined' && window.NEXUS_WEB_SEARCH_SETTINGS) || null;
    }

    function webProvider() {
        return (typeof window !== 'undefined' && window.NEXUS_RESEARCH_WEB) || null;
    }

    function imageSettings() {
        return (typeof window !== 'undefined' && window.NEXUS_IMAGE_MEDIA) || null;
    }

    function youtubeSettings() {
        return (typeof window !== 'undefined' && window.NEXUS_YT_SETTINGS) || null;
    }

    function el(doc, tag, className, text) {
        const node = doc.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = text;
        return node;
    }

    function providerLabel(id) {
        if (PROVIDER_LABEL[id]) return PROVIDER_LABEL[id];
        return String(id || '')
            .replace(/[-_]+/g, ' ')
            .replace(/\b\w/g, (c) => c.toUpperCase());
    }

    function stateLabel(status) {
        const named = STATE[status && status.reason];
        if (named) return named;
        return status && status.available ? STATE.ok : 'Unavailable';
    }

    function injectStyle(doc) {
        if (!doc || doc.getElementById('nexus-capability-settings-style')) return;
        const style = doc.createElement('style');
        style.id = 'nexus-capability-settings-style';
        style.textContent = `
            #${HOST_ID}{display:flex;flex-direction:column;gap:10px}
            .nexus-capability-section{margin:10px 0 2px;font-size:.64rem;font-weight:700;letter-spacing:.12em;color:rgba(255,255,255,.42)}
            .nexus-discovery-row{display:block;padding:12px;border:1px solid rgba(255,255,255,.10);border-radius:12px;background:rgba(255,255,255,.025)}
            .nexus-capability-head{display:flex;gap:9px;align-items:flex-start;margin-bottom:8px}
            .nexus-capability-icon{font-size:1rem;line-height:1.25}
            .nexus-capability-copy{min-width:0;flex:1}
            .nexus-discovery-label{display:block!important;flex:none!important;width:auto!important;margin:0!important;font-size:.76rem!important;font-weight:700;color:rgba(255,255,255,.9)}
            .nexus-capability-description{margin:3px 0 0;font-size:.67rem;line-height:1.4;color:rgba(255,255,255,.48)}
            .nexus-discovery-select{width:100%;margin:0}
            .nexus-discovery-status{display:block;margin-top:7px;font-size:.67rem;line-height:1.35;color:rgba(255,255,255,.56)}
            .nexus-discovery-status[data-ready="yes"]{color:#78d9a5}
            .nexus-capability-key{margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.08)}
            .nexus-capability-key-label{display:block;margin-bottom:6px;font-size:.68rem;font-weight:600;color:rgba(255,255,255,.72)}
            .nexus-capability-key-row{display:flex;gap:7px;align-items:center}
            .nexus-capability-key-row .text-input{min-width:0;flex:1}
            .nexus-capability-eye{flex:0 0 auto;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:rgba(255,255,255,.75);border-radius:8px;padding:8px 10px;cursor:pointer}
            .nexus-capability-key-note{margin:6px 0 0;font-size:.64rem;line-height:1.4;color:rgba(255,255,255,.42)}
            .nexus-capability-key-saved{margin:5px 0 0;font-size:.64rem;color:#78d9a5}
            .nexus-discovery-empty{margin:2px 0;font-size:.7rem;color:rgba(255,255,255,.5)}
            #nexus-image-settings{display:none!important}
        `;
        (doc.head || doc.documentElement).appendChild(style);
    }

    function hideLegacyRow(doc, id) {
        const node = doc && doc.getElementById(id);
        if (!node || !node.closest) return;
        const group = node.closest('.input-group');
        if (group && !group.contains(doc.getElementById(HOST_ID))) group.style.display = 'none';
    }

    function hideLegacyControls(doc) {
        // The controls remain in the DOM for backward-compatible modules that own their storage,
        // but the capability cards become the one visible consumer surface.
        hideLegacyRow(doc, 'yt-api-key');
        if (webSettings()) {
            hideLegacyRow(doc, 'web-search-provider');
            hideLegacyRow(doc, 'web-search-key');
        }
        const oldImage = doc && doc.getElementById('nexus-image-settings');
        if (oldImage) oldImage.style.display = 'none';
    }

    function credentialAdapter(providerId, doc) {
        if (providerId === 'youtube') {
            const settings = youtubeSettings();
            if (!settings || typeof settings.read !== 'function' || typeof settings.write !== 'function') return null;
            return {
                label: 'YouTube API key',
                help: 'Stored only in this browser. Uses your own YouTube API quota instead of the site’s.',
                value() {
                    const saved = settings.read();
                    return String((saved.youtube && saved.youtube.apiKey) || '');
                },
                save(value) {
                    const saved = settings.read();
                    settings.write({
                        youtube: Object.assign({}, saved.youtube, { apiKey: String(value || '').trim() }),
                    });
                    // Keep the legacy hidden field in sync so its SAVE listener cannot overwrite
                    // the value this component just stored.
                    const old = doc && doc.getElementById('yt-api-key');
                    if (old) old.value = String(value || '').trim();
                },
            };
        }

        const images = imageSettings();
        if (providerId === 'pexels' && images && typeof images.setPexelsKey === 'function') {
            return {
                label: 'Pexels API key',
                help: 'Stored only in this browser. Uses your own Pexels quota instead of the site’s.',
                value: () => (typeof images.pexelsKey === 'function' ? images.pexelsKey() : ''),
                save: (value) => images.setPexelsKey(value),
            };
        }
        if (providerId === 'pollinations' && images && typeof images.setPollinationsKey === 'function') {
            return {
                label: 'Pollinations API key',
                help: 'Stored only in this browser and sent only to this site’s image-generation gateway.',
                value: () => (typeof images.pollinationsKey === 'function' ? images.pollinationsKey() : ''),
                save: (value) => images.setPollinationsKey(value),
            };
        }
        return null;
    }

    function providerCredentialState(row) {
        if (!row || !row.provider || typeof row.provider.credentialStatus !== 'function') return null;
        try {
            return row.provider.credentialStatus() || null;
        } catch (_) {
            return { supportsOwnKey: true, hasOwnKey: false };
        }
    }

    function statusText(row, explicit, doc) {
        if (!row) return 'Unavailable';
        const name = providerLabel(row.id);
        const credential = providerCredentialState(row);
        if (explicit && credential && credential.supportsOwnKey && !credential.hasOwnKey) {
            return `Setup required · add your ${name} key below`;
        }
        if (!row.available) return stateLabel(row);
        if (row.reason === 'deployment') return `Ready · ${name} · provided by this site`;
        if (row.reason === 'own-key') return `Ready · ${name} · using your key`;
        if (row.reason === 'ok') {
            const adapter = credentialAdapter(row.id, doc);
            if (adapter && String(adapter.value() || '').trim()) return `Ready · ${name} · using your key`;
            return `Ready · ${name}`;
        }
        return `Ready · ${name}`;
    }

    function addCredentialPanel(doc, row, select, container) {
        if (!row || !select || select.value === 'auto' || select.value === 'disabled') return;
        const adapter = credentialAdapter(row.id, doc);
        if (!adapter) return;

        const panel = el(doc, 'div', 'nexus-capability-key');
        const label = el(doc, 'label', 'nexus-capability-key-label', adapter.label);
        const inputId = `discovery-${select.id.replace('discovery-', '')}-${row.id}-key`;
        label.htmlFor = inputId;
        const inputRow = el(doc, 'div', 'nexus-capability-key-row');
        const input = doc.createElement('input');
        input.id = inputId;
        input.className = 'text-input';
        input.type = 'password';
        input.autocomplete = 'off';
        input.placeholder = `Your ${providerLabel(row.id)} API key`;
        input.value = adapter.value();
        const eye = el(doc, 'button', 'nexus-capability-eye', 'Show');
        eye.type = 'button';
        eye.setAttribute('aria-label', `Show or hide ${adapter.label}`);
        eye.addEventListener('click', () => {
            const showing = input.type === 'text';
            input.type = showing ? 'password' : 'text';
            eye.textContent = showing ? 'Show' : 'Hide';
        });
        input.addEventListener('change', () => {
            adapter.save(input.value);
            const provider = row.provider;
            const repaint = () => render(doc, { warm: false });
            if (provider && typeof provider.ready === 'function') {
                Promise.resolve(provider.ready({ force: true }))
                    .catch(() => null)
                    .then(repaint);
            } else {
                repaint();
            }
        });
        inputRow.appendChild(input);
        inputRow.appendChild(eye);
        panel.appendChild(label);
        panel.appendChild(inputRow);
        panel.appendChild(el(doc, 'p', 'nexus-capability-key-note', adapter.help));
        if (String(adapter.value() || '').trim()) {
            panel.appendChild(el(doc, 'p', 'nexus-capability-key-saved', '✓ Key saved in this browser'));
        }
        container.appendChild(panel);
    }

    function cardHeading(doc, group, row) {
        const meta = META[group.id] || {
            icon: '•',
            label: group.label,
            description: '',
            section: 'SEARCH & DISCOVERY',
        };
        const head = el(doc, 'div', 'nexus-capability-head');
        head.appendChild(el(doc, 'span', 'nexus-capability-icon', meta.icon));
        const copy = el(doc, 'div', 'nexus-capability-copy');
        const label = el(doc, 'label', 'nexus-discovery-label', meta.label || group.label);
        if (row) label.htmlFor = row.id;
        copy.appendChild(label);
        if (meta.description) copy.appendChild(el(doc, 'p', 'nexus-capability-description', meta.description));
        head.appendChild(copy);
        return head;
    }

    function drawRegistryCard(doc, host, group, providers, prefs) {
        const able = providers.filter(
            (p) => Array.isArray(p.capabilities) && p.capabilities.includes(group.capability)
        );
        if (!able.length) return false;

        const row = el(doc, 'div', 'nexus-discovery-row');
        const select = doc.createElement('select');
        select.className = 'select-input nexus-discovery-select';
        select.id = `discovery-${group.id}`;
        row.appendChild(cardHeading(doc, group, select));

        const auto = doc.createElement('option');
        auto.value = 'auto';
        auto.textContent = 'Auto — recommended';
        select.appendChild(auto);

        for (const p of able) {
            const option = doc.createElement('option');
            option.value = p.id;
            const credential = credentialAdapter(p.id, doc);
            option.textContent = credential ? `${providerLabel(p.id)} — my own key` : providerLabel(p.id);
            // A personal-key provider must remain selectable while it is unconfigured — that
            // is exactly how the user reveals the key field. HomePilot likewise stays visible
            // for actionable bridge states. Truly broken/unloaded providers stay unselectable.
            option.disabled =
                !p.available &&
                !credential &&
                !['no-bridge', 'unsupported', 'unauthorized', 'unreachable'].includes(String(p.reason || ''));
            select.appendChild(option);
        }

        const disabled = doc.createElement('option');
        disabled.value = 'disabled';
        disabled.textContent = 'Disabled';
        select.appendChild(disabled);

        const wanted = prefs[group.id] || 'auto';
        select.value = [...select.options].some((option) => option.value === wanted) ? wanted : 'auto';
        select.addEventListener('change', () => {
            const reg = registry();
            if (reg && typeof reg.setPreference === 'function') reg.setPreference(group.id, select.value);
            render(doc, { warm: false });
        });
        row.appendChild(select);

        let selected = null;
        if (select.value === 'auto') selected = able.find((p) => p.available) || able[0] || null;
        else if (select.value !== 'disabled') selected = able.find((p) => p.id === select.value) || null;

        const status = el(
            doc,
            'span',
            'nexus-discovery-status',
            select.value === 'disabled' ? 'Disabled' : statusText(selected, select.value !== 'auto', doc)
        );
        const ready = select.value !== 'disabled' && selected && selected.available;
        const credential = selected && providerCredentialState(selected);
        status.dataset.ready =
            ready && !(select.value !== 'auto' && credential && credential.supportsOwnKey && !credential.hasOwnKey)
                ? 'yes'
                : 'no';
        row.appendChild(status);
        addCredentialPanel(doc, selected, select, row);
        host.appendChild(row);
        return true;
    }

    function drawWebCard(doc, host) {
        const settings = webSettings();
        const provider = webProvider();
        if (!settings || !provider || !settings.PROVIDERS) return false;

        const group = { id: 'web', label: META.web.label, capability: 'topic.search' };
        const row = el(doc, 'div', 'nexus-discovery-row');
        const select = doc.createElement('select');
        select.className = 'select-input nexus-discovery-select';
        select.id = 'discovery-web';
        row.appendChild(cardHeading(doc, group, select));

        const auto = doc.createElement('option');
        auto.value = 'auto';
        auto.textContent = 'Auto — recommended';
        select.appendChild(auto);
        for (const [id, spec] of Object.entries(settings.PROVIDERS)) {
            const option = doc.createElement('option');
            option.value = id;
            option.textContent = `${(spec && spec.label) || providerLabel(id)} — my own key`;
            select.appendChild(option);
        }
        const disabled = doc.createElement('option');
        disabled.value = 'disabled';
        disabled.textContent = 'Disabled';
        select.appendChild(disabled);

        const stored = typeof settings.provider === 'function' ? settings.provider() : '';
        select.value = stored === 'disabled' ? 'disabled' : stored || 'auto';
        select.addEventListener('change', () => {
            const value = select.value === 'auto' ? '' : select.value;
            settings.save({ provider: value, key: settings.apiKey() });
            const old = doc.getElementById('web-search-provider');
            if (old && select.value !== 'disabled') old.value = value;
            render(doc, { warm: false });
        });
        row.appendChild(select);

        let statusTextValue = 'Unavailable';
        let ready = false;
        if (select.value === 'disabled') {
            statusTextValue = 'Disabled';
        } else if (select.value !== 'auto') {
            const key = String(settings.apiKey() || '').trim();
            if (key) {
                statusTextValue = `Ready · ${providerLabel(select.value)} · using your key`;
                ready = true;
            } else {
                statusTextValue = `Setup required · add your ${providerLabel(select.value)} key below`;
            }
        } else {
            let state = {};
            try {
                state = provider.status() || {};
            } catch (_) {}
            ready = Boolean(state.available);
            if (ready) {
                const resolved = state.provider ? providerLabel(state.provider) : '';
                statusTextValue = resolved
                    ? `Ready · ${resolved} · provided by this site`
                    : 'Ready · provided by this site';
            } else {
                statusTextValue = stateLabel(state);
            }
        }

        const status = el(doc, 'span', 'nexus-discovery-status', statusTextValue);
        status.dataset.ready = ready ? 'yes' : 'no';
        row.appendChild(status);

        if (select.value !== 'auto' && select.value !== 'disabled') {
            const spec = settings.PROVIDERS[select.value];
            const panel = el(doc, 'div', 'nexus-capability-key');
            const label = el(
                doc,
                'label',
                'nexus-capability-key-label',
                `${(spec && spec.label) || providerLabel(select.value)} API key`
            );
            const input = doc.createElement('input');
            input.id = `discovery-web-${select.value}-key`;
            input.className = 'text-input';
            input.type = 'password';
            input.autocomplete = 'off';
            input.value = settings.apiKey();
            input.placeholder = `Your ${(spec && spec.label) || providerLabel(select.value)} API key`;
            label.htmlFor = input.id;
            const keyRow = el(doc, 'div', 'nexus-capability-key-row');
            const eye = el(doc, 'button', 'nexus-capability-eye', 'Show');
            eye.type = 'button';
            eye.addEventListener('click', () => {
                const showing = input.type === 'text';
                input.type = showing ? 'password' : 'text';
                eye.textContent = showing ? 'Show' : 'Hide';
            });
            input.addEventListener('change', () => {
                settings.save({ provider: select.value, key: input.value });
                const old = doc.getElementById('web-search-key');
                if (old) old.value = String(input.value || '').trim();
                render(doc, { warm: false });
            });
            keyRow.appendChild(input);
            keyRow.appendChild(eye);
            panel.appendChild(label);
            panel.appendChild(keyRow);
            panel.appendChild(
                el(
                    doc,
                    'p',
                    'nexus-capability-key-note',
                    'Stored only in this browser. Uses your own search quota instead of the site’s.'
                )
            );
            if (String(settings.apiKey() || '').trim()) {
                panel.appendChild(el(doc, 'p', 'nexus-capability-key-saved', '✓ Key saved in this browser'));
            }
            row.appendChild(panel);
        }

        host.appendChild(row);
        return true;
    }

    function render(doc, options) {
        const d = doc || (typeof document !== 'undefined' ? document : null);
        const shouldWarm = !options || options.warm !== false;
        const host = d && d.getElementById(HOST_ID);
        const reg = registry();
        if (!host || !reg) return null;

        injectStyle(d);
        hideLegacyControls(d);
        host.textContent = '';

        if (shouldWarm) {
            const tasks = [];
            if (typeof reg.warm === 'function') tasks.push(Promise.resolve(reg.warm()));
            const web = webProvider();
            if (web && typeof web.ready === 'function') tasks.push(Promise.resolve(web.ready()));
            if (tasks.length) {
                Promise.allSettled(tasks).then(() => {
                    if (d.getElementById(HOST_ID)) render(d, { warm: false });
                });
            }
        }

        const providers = reg.all();
        const prefs = reg.preferences();
        let drawn = false;
        let currentSection = '';

        const cards = [];
        if (webSettings() && webProvider()) cards.push({ type: 'web', group: { id: 'web' } });
        for (const group of GROUPS) cards.push({ type: 'registry', group });

        for (const item of cards) {
            const meta = META[item.group.id] || {};
            const section = meta.section || 'SEARCH & DISCOVERY';
            if (section !== currentSection) {
                currentSection = section;
                host.appendChild(el(d, 'div', 'nexus-capability-section', section));
            }
            const before = host.children.length;
            const made =
                item.type === 'web' ? drawWebCard(d, host) : drawRegistryCard(d, host, item.group, providers, prefs);
            if (
                !made &&
                host.children.length === before &&
                host.lastElementChild?.className === 'nexus-capability-section'
            ) {
                // Remove an empty section heading when no capability under it is loaded.
                host.lastElementChild.remove();
                currentSection = '';
            }
            drawn = drawn || made;
        }

        if (!drawn) {
            host.textContent = '';
            host.appendChild(el(d, 'p', 'nexus-discovery-empty', 'No discovery providers are loaded.'));
        }
        return host;
    }

    function mount(doc) {
        const d = doc || (typeof document !== 'undefined' ? document : null);
        const host = d && d.getElementById(HOST_ID);
        if (!host || host.__nexusDiscoverySettings) return () => {};
        host.__nexusDiscoverySettings = true;
        const opener = d.getElementById(OPEN_ID);
        const paint = () => render(d);
        if (opener) opener.addEventListener('click', paint);
        paint();
        return () => {
            if (opener) opener.removeEventListener('click', paint);
            delete host.__nexusDiscoverySettings;
        };
    }

    if (
        typeof window !== 'undefined' &&
        typeof document !== 'undefined' &&
        !window.__NEXUS_DISCOVERY_SETTINGS_NOAUTO__
    ) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mount());
        else mount();
    }

    return { HOST_ID, GROUPS, META, STATE, stateLabel, providerLabel, render, mount };
})();

if (typeof window !== 'undefined') window.NEXUS_DISCOVERY_SETTINGS = DiscoverySettings;
if (typeof module !== 'undefined' && module.exports) module.exports = DiscoverySettings;

// Image media remains optional. Load transport first, then the small credential adapter, then
// the richer image experience. Any missing file leaves existing video/music discovery intact.
if (typeof window !== 'undefined' && typeof document !== 'undefined' && !window.__NEXUS_IMAGE_PLUGIN_NOLOAD__) {
    const loadImageExperience = () => {
        if (window.NEXUS_IMAGE_EXPERIENCE || document.querySelector('script[data-nexus-image-experience]')) return;
        const experience = document.createElement('script');
        experience.src = 'src/features/images/ImageExperience.js';
        experience.defer = true;
        experience.dataset.nexusImageExperience = '1';
        experience.onerror = () => console.warn('[DiscoverySettings] Optional image experience did not load.');
        (document.head || document.documentElement).appendChild(experience);
    };

    const loadImageProviderSettings = () => {
        if (window.NEXUS_IMAGE_MEDIA && typeof window.NEXUS_IMAGE_MEDIA.pollinationsKey === 'function') {
            loadImageExperience();
            return;
        }
        if (document.querySelector('script[data-nexus-image-provider-settings]')) return;
        const settings = document.createElement('script');
        settings.src = 'src/features/images/ImageProviderSettings.js';
        settings.defer = true;
        settings.dataset.nexusImageProviderSettings = '1';
        settings.onload = loadImageExperience;
        settings.onerror = () => {
            console.warn('[DiscoverySettings] Optional image provider settings did not load.');
            loadImageExperience();
        };
        (document.head || document.documentElement).appendChild(settings);
    };

    const loadImagePlugin = () => {
        if (window.NEXUS_IMAGE_MEDIA) {
            loadImageProviderSettings();
            return;
        }
        if (document.querySelector('script[data-nexus-image-plugin]')) return;
        const script = document.createElement('script');
        script.src = 'src/features/images/ImagePlugin.js';
        script.defer = true;
        script.dataset.nexusImagePlugin = '1';
        script.onload = loadImageProviderSettings;
        script.onerror = () => console.warn('[DiscoverySettings] Optional image plugin did not load.');
        (document.head || document.documentElement).appendChild(script);
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadImagePlugin, { once: true });
    } else {
        loadImagePlugin();
    }
}
