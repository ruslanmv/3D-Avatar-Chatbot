/**
 * Settings ▸ Discovery & Media (batch D6).
 *
 * Two questions, answered honestly:
 *
 *   * **which engine powers search** — `Auto` by default, and `Auto` is the answer for almost
 *     everybody. A person who has never heard the word "provider" should never have to.
 *   * **is it actually working** — a row per provider with its real state, read live from the
 *     registry rather than from what somebody typed. A provider shown as available when it is
 *     not is the failure this whole section exists to prevent: it turns "I picked that one"
 *     into "search is broken", with nothing on screen to connect the two.
 *
 * Rendered into markup `index.html` already has, filled when Settings opens. On a page without
 * that container this is inert — which is what keeps the feature deletable.
 *
 * Exposes: window.NEXUS_DISCOVERY_SETTINGS
 */
const DiscoverySettings = (() => {
    'use strict';

    const HOST_ID = 'discovery-providers';
    const OPEN_ID = 'settings-btn';

    /** The capability groups a person actually chooses between, and what to call them. */
    const GROUPS = [
        { id: 'video', label: 'Video search', capability: 'video.search' },
        { id: 'music', label: 'Music search', capability: 'music.search' },
    ];

    /** A reason code from a provider → what to show beside its name. */
    const STATE = {
        ok: 'Ready',
        'no-key': 'API key required',
        'not-loaded': 'Not available on this page',
        unreachable: 'Not responding',
    };

    function registry() {
        return (typeof window !== 'undefined' && window.NEXUS_DISCOVERY) || null;
    }

    function el(doc, tag, className, text) {
        const node = doc.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = text;
        return node;
    }

    /** What a provider's status reads as. Unknown reasons say so rather than guessing. */
    function stateLabel(status) {
        if (status.available) {
            return STATE.ok;
        }
        return STATE[status.reason] || 'Unavailable';
    }

    /**
     * Draw the section. Called on every Settings open, so a key added on one visit shows as
     * Ready on the next without a reload.
     */
    function render(doc) {
        const d = doc || (typeof document !== 'undefined' ? document : null);
        const host = d && d.getElementById(HOST_ID);
        const reg = registry();
        if (!host || !reg) {
            return null;
        }
        host.textContent = '';

        const providers = reg.all();
        if (!providers.length) {
            host.appendChild(el(d, 'p', 'nexus-discovery-empty', 'No search providers are loaded.'));
            return host;
        }

        const prefs = reg.preferences();
        for (const group of GROUPS) {
            const able = providers.filter((p) => p.capabilities.includes(group.capability));
            if (!able.length) {
                continue;
            }
            const row = el(d, 'div', 'nexus-discovery-row');
            const label = el(d, 'label', 'nexus-discovery-label', group.label);
            const select = d.createElement('select');
            select.className = 'select-input nexus-discovery-select';
            select.id = `discovery-${group.id}`;
            label.htmlFor = select.id;

            // Auto first and selected unless the user has said otherwise. The named options
            // are every provider that *can* do this, ready or not — hiding an unconfigured
            // one would make "why can I not pick YouTube?" unanswerable.
            const auto = d.createElement('option');
            auto.value = 'auto';
            auto.textContent = 'Auto — recommended';
            select.appendChild(auto);
            for (const p of able) {
                const option = d.createElement('option');
                option.value = p.id;
                option.textContent = p.available ? p.id : `${p.id} — ${stateLabel(p)}`;
                option.disabled = !p.available;
                select.appendChild(option);
            }
            select.value = prefs[group.id] || 'auto';
            select.addEventListener('change', () => reg.setPreference(group.id, select.value));

            row.appendChild(label);
            row.appendChild(select);
            host.appendChild(row);
        }

        const list = el(d, 'div', 'nexus-discovery-states');
        for (const p of providers) {
            const line = el(d, 'div', 'nexus-discovery-state');
            line.appendChild(el(d, 'span', 'nexus-discovery-name', p.id));
            const state = el(d, 'span', 'nexus-discovery-status', stateLabel(p));
            state.dataset.ready = p.available ? 'yes' : 'no';
            line.appendChild(state);
            list.appendChild(line);
        }
        host.appendChild(list);
        return host;
    }

    /** Fill the section whenever Settings is opened, the same way the key field does. */
    function mount(doc) {
        const d = doc || (typeof document !== 'undefined' ? document : null);
        const host = d && d.getElementById(HOST_ID);
        if (!host || host.__nexusDiscoverySettings) {
            return () => {};
        }
        host.__nexusDiscoverySettings = true;
        const opener = d.getElementById(OPEN_ID);
        const paint = () => render(d);
        if (opener) {
            opener.addEventListener('click', paint);
        }
        paint();
        return () => {
            if (opener) {
                opener.removeEventListener('click', paint);
            }
            delete host.__nexusDiscoverySettings;
        };
    }

    if (
        typeof window !== 'undefined' &&
        typeof document !== 'undefined' &&
        !window.__NEXUS_DISCOVERY_SETTINGS_NOAUTO__
    ) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => mount());
        } else {
            mount();
        }
    }

    return { HOST_ID, GROUPS, STATE, stateLabel, render, mount };
})();

if (typeof window !== 'undefined') {
    window.NEXUS_DISCOVERY_SETTINGS = DiscoverySettings;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DiscoverySettings;
}
