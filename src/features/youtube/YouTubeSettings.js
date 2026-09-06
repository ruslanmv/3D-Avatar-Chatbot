/**
 * Where the YouTube key lives now (batch D1).
 *
 * Before this, the only way to connect search was to open a console and run
 * `localStorage.setItem('nexus.yt.apiKey', …)` — and the app said so, to everybody, in the
 * chat. That is a developer instruction printed in a consumer surface: it tells a person who
 * just asked for a song that the fix is to write JavaScript.
 *
 * So the key gets a home in Settings, and the message that used to teach `setItem` becomes a
 * button that opens it.
 *
 * ## Three sources, in order
 *
 *   1. `nexus_discovery_settings` — what Settings writes. New, and the one users touch.
 *   2. `window.NEXUS_YT_CONFIG.apiKey` — a host page that ships its own key.
 *   3. `localStorage['nexus.yt.apiKey']` — the legacy key.
 *
 * The legacy key is read last and never written. Somebody who set it a year ago keeps
 * working and never has to know this file exists; the day they type a key into Settings,
 * that one wins. Deleting the legacy path is a later decision, not this batch's.
 *
 * ## Why this owns its own Settings row
 *
 * `saveSettings()` in `main.js` reads a fixed list of fields. Adding to it would mean editing
 * the one function every other setting flows through, for a feature that is meant to be
 * removable by deleting a folder. Instead this module fills its own field when the modal
 * opens and writes on the same SAVE press, which is additive on both sides.
 *
 * Exposes: window.NEXUS_YT_SETTINGS
 */
const YouTubeSettings = (() => {
    'use strict';

    /** One object for every discovery provider, so D6 can add music and web beside it. */
    const STORAGE_KEY = 'nexus_discovery_settings';
    /** The key ScreenSense-era installs already have. Read, never written. */
    const LEGACY_KEY = 'nexus.yt.apiKey';

    const FIELD_ID = 'yt-api-key';
    const SAVE_ID = 'save-settings';
    const OPEN_ID = 'settings-btn';

    function store(injected) {
        if (injected !== undefined) {
            return injected;
        }
        try {
            return typeof localStorage !== 'undefined' ? localStorage : null;
        } catch (_) {
            return null;
        }
    }

    /** The whole settings object. `{}` when there is none, so callers need no guards. */
    function read(storage) {
        const s = store(storage);
        if (!s) {
            return {};
        }
        try {
            const parsed = JSON.parse(s.getItem(STORAGE_KEY) || 'null');
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (_) {
            return {}; // a corrupt blob is not settings
        }
    }

    /** Merge one provider's settings in. Returns what is now stored. */
    function write(patch, storage) {
        const s = store(storage);
        const next = Object.assign({}, read(storage), patch || {});
        if (s) {
            try {
                s.setItem(STORAGE_KEY, JSON.stringify(next));
            } catch (_) {
                // Storage full or disabled. The key is still live for this session, because
                // `apiKey()` reads through the same object the caller just handed us.
            }
        }
        return next;
    }

    /**
     * The key, from whichever source has one. `''` when none does.
     *
     * Empty strings do not count as configured — a settings field somebody opened and left
     * blank must fall through to the legacy key rather than shadow it with nothing.
     */
    function apiKey(storage) {
        const settings = read(storage);
        const fromSettings = String((settings.youtube && settings.youtube.apiKey) || '').trim();
        if (fromSettings) {
            return fromSettings;
        }
        const cfg = (typeof window !== 'undefined' && window.NEXUS_YT_CONFIG) || {};
        const fromHost = String(cfg.apiKey || '').trim();
        if (fromHost) {
            return fromHost;
        }
        const s = store(storage);
        if (!s) {
            return '';
        }
        try {
            return String(s.getItem(LEGACY_KEY) || '').trim();
        } catch (_) {
            return '';
        }
    }

    /** Is video search connected? The one question every caller actually asks. */
    function ready(storage) {
        return Boolean(apiKey(storage));
    }

    // ── the Settings row ────────────────────────────────────────────────────

    /**
     * Fill the field when Settings opens, and store it when SAVE is pressed.
     *
     * Bound once. The modal is markup that already exists in the page, not something this
     * builds — so on a page without the field this is inert, which is what lets the feature
     * be deleted by removing its folder and its script tags.
     */
    function mount(doc) {
        const d = doc || (typeof document !== 'undefined' ? document : null);
        if (!d) {
            return () => {};
        }
        const field = d.getElementById(FIELD_ID);
        if (!field || field.__nexusYtSettings) {
            return () => {};
        }
        field.__nexusYtSettings = true;

        const fill = () => {
            const settings = read();
            const own = String((settings.youtube && settings.youtube.apiKey) || '');
            // Only ever shows what Settings itself holds. A legacy or host key stays where it
            // is rather than being copied into a box the next SAVE would write back — that
            // would silently migrate a key the user never touched.
            field.value = own;
        };

        const onSave = () => {
            write({ youtube: Object.assign({}, read().youtube, { apiKey: String(field.value || '').trim() }) });
        };

        const opener = d.getElementById(OPEN_ID);
        const save = d.getElementById(SAVE_ID);
        if (opener) {
            opener.addEventListener('click', fill);
        }
        if (save) {
            save.addEventListener('click', onSave);
        }
        fill();

        return () => {
            if (opener) {
                opener.removeEventListener('click', fill);
            }
            if (save) {
                save.removeEventListener('click', onSave);
            }
            delete field.__nexusYtSettings;
        };
    }

    /**
     * Open Settings on the field, from a "Set up YouTube" button in the chat.
     *
     * Presses the toolbar button rather than reaching into the modal, the same way the
     * Together panel does: one thing owns opening Settings, and whatever else it does on the
     * way — filling fields, syncing language — still happens.
     */
    function openSettings(doc) {
        const d = doc || (typeof document !== 'undefined' ? document : null);
        if (!d) {
            return false;
        }
        const btn = d.getElementById(OPEN_ID);
        if (!btn || typeof btn.click !== 'function') {
            return false;
        }
        btn.click();
        const field = d.getElementById(FIELD_ID);
        if (field) {
            try {
                field.focus();
                if (typeof field.scrollIntoView === 'function') {
                    field.scrollIntoView({ block: 'center' });
                }
            } catch (_) {
                // Focusing is a courtesy, not the job.
            }
        }
        return true;
    }

    if (typeof window !== 'undefined' && typeof document !== 'undefined' && !window.__NEXUS_YT_SETTINGS_NOAUTO__) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => mount());
        } else {
            mount();
        }
    }

    return { STORAGE_KEY, LEGACY_KEY, FIELD_ID, read, write, apiKey, ready, mount, openSettings };
})();

if (typeof window !== 'undefined') {
    window.NEXUS_YT_SETTINGS = YouTubeSettings;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = YouTubeSettings;
}
