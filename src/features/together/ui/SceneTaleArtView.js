/**
 * SceneTaleArtView — one canonical image for setup thumbnails and story hero art.
 *
 * The visual source of truth is assets/ambient/scene-tale-art.json. Scene Tale deliberately
 * reuses the current ambience artwork instead of inventing a second library that can drift
 * away from the place the user is actually seeing.
 *
 * This view owns no story state. It watches the Conversation-owned Scene Tale surface and
 * inserts the current scene artwork between the story heading and the live narration card.
 * Failure to load the catalogue is presentation-only and never blocks StoryPlayer.
 *
 * Exposes: window.NEXUS_SCENE_TALE_ART_VIEW
 */
const SceneTaleArtView = (() => {
    'use strict';

    const MANIFEST = 'assets/ambient/scene-tale-art.json';
    const HUD_ID = 'nexus-scene-tale-hud';
    const HERO_CLASS = 'nexus-scene-tale-hero';
    const STYLE_ID = 'nexus-scene-tale-art-view-styles';

    let currentWin = null;
    let observer = null;
    let catalogPromise = null;

    const CSS = `
.${HERO_CLASS}{position:relative;margin:0 12px 2px;aspect-ratio:16/5.7;min-height:118px;max-height:260px;overflow:hidden;border-radius:13px;border:1px solid rgba(24,218,255,.2);background:linear-gradient(135deg,rgba(14,36,51,.9),rgba(5,17,28,.95));box-shadow:inset 0 1px 0 rgba(255,255,255,.025)}
.${HERO_CLASS} img{display:block;width:100%;height:100%;object-fit:cover;object-position:center;filter:saturate(.96) contrast(1.02)}
.${HERO_CLASS}::after{content:'';position:absolute;inset:0;pointer-events:none;background:linear-gradient(180deg,rgba(3,10,18,.02),rgba(3,10,18,.18));box-shadow:inset 0 -32px 52px rgba(1,8,14,.12)}
@media(max-width:700px){.${HERO_CLASS}{margin:0 10px 2px;aspect-ratio:16/7;min-height:104px}}
@media(max-width:480px){.${HERO_CLASS}{aspect-ratio:16/8;min-height:96px;border-radius:11px}}
`;

    function ensureStyles(doc) {
        if (!doc || doc.getElementById(STYLE_ID)) return;
        const style = doc.createElement('style');
        style.id = STYLE_ID;
        style.textContent = CSS;
        (doc.head || doc.documentElement).appendChild(style);
    }

    function loadCatalog(win) {
        if (catalogPromise) return catalogPromise;
        const w = win || currentWin || (typeof window !== 'undefined' ? window : null);
        const fetcher =
            w && typeof w.fetch === 'function' ? w.fetch.bind(w) : typeof fetch === 'function' ? fetch : null;
        if (!fetcher) return Promise.resolve([]);
        catalogPromise = fetcher(MANIFEST, { cache: 'force-cache' })
            .then((response) => (response && response.ok ? response.json() : null))
            .then((payload) => (payload && Array.isArray(payload.scenes) ? payload.scenes : []))
            .catch(() => []);
        return catalogPromise;
    }

    function activePlan(win) {
        const w = win || currentWin || (typeof window !== 'undefined' ? window : null);
        const director = w && w.NEXUS_BD;
        const panel = director && director.togetherPanel;
        const activities = panel && panel.activities;
        const playground = activities && typeof activities.get === 'function' ? activities.get('playground') : null;
        return playground && playground.player && playground.player.plan
            ? playground.player.plan
            : playground && playground.preparedPlan
              ? playground.preparedPlan
              : null;
    }

    function normalize(value) {
        return String(value || '')
            .trim()
            .toLowerCase();
    }

    function findArt(catalog, plan) {
        if (!Array.isArray(catalog) || !catalog.length || !plan) return null;
        const id = normalize(plan.sceneId);
        const label = normalize(plan.sceneLabel);
        return (
            catalog.find((entry) => normalize(entry && entry.id) === id) ||
            catalog.find((entry) => normalize(entry && entry.label) === label) ||
            null
        );
    }

    function insertHero(hud, art) {
        if (!hud || !art || !art.hero) return false;
        const doc = hud.ownerDocument;
        const shell = hud.querySelector('.nexus-story-shell');
        if (!doc || !shell) return false;

        let hero = shell.querySelector(`.${HERO_CLASS}`);
        let image = hero && hero.querySelector('img');
        if (!hero) {
            hero = doc.createElement('div');
            hero.className = HERO_CLASS;
            image = doc.createElement('img');
            image.loading = 'eager';
            image.decoding = 'async';
            hero.appendChild(image);
            const heading = shell.querySelector('.nexus-story-heading');
            if (heading && heading.nextSibling) shell.insertBefore(hero, heading.nextSibling);
            else if (heading) shell.appendChild(hero);
            else shell.insertBefore(hero, shell.firstChild);
        }
        const source = String(art.hero || '');
        if (image && image.getAttribute('src') !== source) image.setAttribute('src', source);
        if (image) image.setAttribute('alt', `${String(art.label || 'Current scene')} — Scene Tale setting`);
        hero.dataset.sceneId = String(art.id || '');
        return true;
    }

    function decorate(hud, win) {
        if (!hud) return Promise.resolve(false);
        const w = win || currentWin || (hud.ownerDocument && hud.ownerDocument.defaultView) || null;
        ensureStyles(hud.ownerDocument);
        const plan = activePlan(w);
        if (!plan) return Promise.resolve(false);
        return loadCatalog(w).then((catalog) => insertHero(hud, findArt(catalog, plan)));
    }

    function scan(doc, win) {
        if (!doc || !doc.getElementById) return;
        const hud = doc.getElementById(HUD_ID);
        if (hud) decorate(hud, win);
    }

    function attach(win, doc) {
        const w = win || (typeof window !== 'undefined' ? window : null);
        const d = doc || (w && w.document) || (typeof document !== 'undefined' ? document : null);
        if (!w || !d) return false;
        currentWin = w;
        ensureStyles(d);
        loadCatalog(w);
        scan(d, w);
        if (observer) return true;
        const root = d.body || d.documentElement;
        if (!root || typeof MutationObserver === 'undefined') return true;
        observer = new MutationObserver(() => scan(d, w));
        observer.observe(root, { childList: true, subtree: true });
        return true;
    }

    function detach() {
        if (observer) observer.disconnect();
        observer = null;
        currentWin = null;
    }

    const api = { attach, detach, decorate, loadCatalog, findArt, MANIFEST, HERO_CLASS };
    if (typeof window !== 'undefined' && typeof document !== 'undefined') attach(window, document);
    return api;
})();

if (typeof window !== 'undefined') window.NEXUS_SCENE_TALE_ART_VIEW = SceneTaleArtView;
if (typeof module !== 'undefined' && module.exports) module.exports = SceneTaleArtView;
