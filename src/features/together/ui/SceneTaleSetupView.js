/**
 * SceneTaleSetupView — polished Stage 1 presentation for Together / Scene Tale.
 *
 * Activity code owns behavior. This module owns presentation only. Configure, Preparing and
 * Ready temporarily own the mobile interaction surface; playback hands presentation to the
 * Conversation / mobile Scene Tale views.
 */
const SceneTaleSetupView = (() => {
    'use strict';

    const PANEL_ID = 'nexus-bd-together-panel';
    const STYLE_ID = 'nexus-scene-tale-setup-view-styles';
    const OPEN_CLASS = 'nexus-scene-tale-setup-open';
    const PANEL_CLASS = 'is-scene-tale-configure';
    const ROOT_CLASS = 'nexus-scene-tale-configure-active';

    const SCENE_THUMBNAILS = Object.freeze({
        'Ocean · Sunrise': 'assets/ambient/light/ocean-sunrise.webp',
        'Ocean · Moonlight': 'assets/ambient/dark/ocean-moonlight.webp',
        'Mountain Lake · Day': 'assets/ambient/light/mountain-lake-day.webp',
        'Mountain Lake · Night': 'assets/ambient/dark/mountain-lake-night.webp',
        'Meditation Garden · Day': 'assets/ambient/light/meditation-garden-day.webp',
        'Meditation Garden · Night': 'assets/ambient/dark/meditation-garden-night.webp',
        'Coastal Terrace · Day': 'assets/ambient/light/coastal-terrace-day.webp',
        'Coastal Terrace · Twilight': 'assets/ambient/dark/coastal-terrace-twilight.webp',
        'Open Sky · Day': 'assets/ambient/light/open-sky-day.webp',
        'Open Sky · Starlight': 'assets/ambient/dark/open-sky-starlight.webp',
    });

    const SCENE_LABELS_BY_ID = Object.freeze({
        'ambient:ocean:day': 'Ocean · Sunrise',
        'ambient:ocean:night': 'Ocean · Moonlight',
        'ambient:lake:day': 'Mountain Lake · Day',
        'ambient:lake:night': 'Mountain Lake · Night',
        'ambient:garden:day': 'Meditation Garden · Day',
        'ambient:garden:night': 'Meditation Garden · Night',
        'ambient:terrace:day': 'Coastal Terrace · Day',
        'ambient:terrace:night': 'Coastal Terrace · Twilight',
        'ambient:sky:day': 'Open Sky · Day',
        'ambient:sky:night': 'Open Sky · Starlight',
        'ocean-sunrise': 'Ocean · Sunrise',
        'ocean-moonlight': 'Ocean · Moonlight',
        'mountain-lake-day': 'Mountain Lake · Day',
        'mountain-lake-night': 'Mountain Lake · Night',
        'meditation-garden-day': 'Meditation Garden · Day',
        'meditation-garden-night': 'Meditation Garden · Night',
        'coastal-terrace-day': 'Coastal Terrace · Day',
        'coastal-terrace-twilight': 'Coastal Terrace · Twilight',
        'open-sky-day': 'Open Sky · Day',
        'open-sky-starlight': 'Open Sky · Starlight',
    });

    let observer = null;
    let currentDoc = null;
    let activePanel = null;
    let activeStage = null;

    const CSS = `
#${PANEL_ID}.${PANEL_CLASS}{
  top:50%;bottom:auto;left:50%;transform:translate(-50%,-50%);
  width:min(88%,54rem);max-height:min(90%,56rem);overflow-y:auto;
  padding:2rem 2.2rem 1.55rem;border-radius:24px;
  background:radial-gradient(120% 90% at 50% -10%,rgba(25,214,244,.095),transparent 50%),linear-gradient(180deg,rgba(8,20,31,.965),rgba(5,14,23,.95));
  border:1px solid rgba(24,218,255,.68);
  box-shadow:0 0 0 100vmax rgba(1,8,15,.44),0 32px 90px rgba(0,0,0,.62),0 0 42px rgba(11,203,235,.12),inset 0 1px 0 rgba(255,255,255,.045);
  backdrop-filter:blur(24px) saturate(120%);-webkit-backdrop-filter:blur(24px) saturate(120%);color:#eaf7ff;
}
.avatar-card.${OPEN_CLASS}>*:not(#${PANEL_ID}){filter:blur(3px) brightness(.52) saturate(.78);transition:filter .18s ease}
#${PANEL_ID}.${PANEL_CLASS} .nexus-bd-together-head{margin:0 auto .55rem;display:flex;align-items:center;justify-content:center;gap:1.15rem;color:#22e8ff;font-size:.76rem;line-height:1;font-weight:760;letter-spacing:.24em;text-align:center}
#${PANEL_ID}.${PANEL_CLASS} .nexus-bd-together-head::before,#${PANEL_ID}.${PANEL_CLASS} .nexus-bd-together-head::after{content:'';display:block;width:min(7.5rem,24%);height:1px;background:linear-gradient(90deg,transparent,rgba(34,232,255,.72))}
#${PANEL_ID}.${PANEL_CLASS} .nexus-bd-together-head::after{transform:scaleX(-1)}
#${PANEL_ID}.${PANEL_CLASS} .nexus-bd-together-subtitle.nexus-scene-tale-setup-title{margin:.1rem 0 .28rem;color:#f5fbff;font-size:clamp(2rem,4.1vw,2.7rem);line-height:1.04;font-weight:760;letter-spacing:.015em;text-align:center}
#${PANEL_ID}.${PANEL_CLASS} .nexus-bd-together-prompt{margin:0 0 1.65rem;color:#92aecd;font-size:1rem;line-height:1.4;text-align:center}
#${PANEL_ID}.${PANEL_CLASS} .nexus-scene-tale-setup-section{display:block;margin:0 0 1.25rem}
#${PANEL_ID}.${PANEL_CLASS} .nexus-story-setup-label.nexus-scene-tale-section-label{display:flex;align-items:center;gap:.72rem;margin:0 0 .58rem;opacity:1;color:#dff5ff;font-size:.95rem;line-height:1.2;font-weight:650}
#${PANEL_ID}.${PANEL_CLASS} .nexus-scene-tale-label-icon{width:1.15rem;height:1.15rem;flex:0 0 1.15rem;color:#9ceeff;stroke:currentColor}
#${PANEL_ID}.${PANEL_CLASS} .nexus-scene-tale-label-secondary{margin-left:.22rem;color:#7088a5;font-size:.82rem;font-weight:500}
#${PANEL_ID}.${PANEL_CLASS} .nexus-scene-tale-place-card{margin:0;min-height:4.55rem;display:flex;align-items:center;gap:1rem;padding:.62rem .78rem;border-radius:14px;border:1px solid rgba(121,174,214,.34);background:linear-gradient(180deg,rgba(25,43,60,.66),rgba(13,29,44,.66));color:#deeffc;font-size:1.02rem;font-weight:520}
#${PANEL_ID}.${PANEL_CLASS} .nexus-scene-tale-place-thumb{width:7.25rem;height:3.65rem;flex:0 0 7.25rem;object-fit:cover;border-radius:9px;border:1px solid rgba(255,255,255,.08);box-shadow:0 5px 16px rgba(0,0,0,.28)}
#${PANEL_ID}.${PANEL_CLASS} .nexus-scene-tale-place-name{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#${PANEL_ID}.${PANEL_CLASS} .nexus-story-setup-input{width:100%;min-height:4.15rem;resize:none;overflow:hidden;padding:1rem 1.1rem;border-radius:14px;border:1px solid rgba(25,223,249,.88);outline:none;background:linear-gradient(180deg,rgba(20,39,55,.74),rgba(10,26,40,.74));color:#eaf6ff;font:500 1rem/1.35 var(--font-sans,Inter,system-ui,sans-serif);caret-color:#20e4fb}
#${PANEL_ID}.${PANEL_CLASS} .nexus-story-setup-input::placeholder{color:#c7dbea;opacity:.92}
#${PANEL_ID}.${PANEL_CLASS} .nexus-story-setup-input:focus{border-color:#22e8ff;box-shadow:0 0 0 2px rgba(34,232,255,.12),0 0 24px rgba(34,232,255,.08)}
#${PANEL_ID}.${PANEL_CLASS} .nexus-scene-tale-sound-grid{display:grid;grid-template-columns:1fr 1fr;gap:.72rem}
#${PANEL_ID}.${PANEL_CLASS} .nexus-story-radio.nexus-scene-tale-sound-option{position:relative;display:flex;align-items:center;gap:.8rem;min-height:4rem;margin:0;padding:.85rem 1rem;border:1px solid rgba(120,164,201,.35);border-radius:14px;background:linear-gradient(180deg,rgba(20,39,55,.58),rgba(10,27,41,.58));color:#dcecf7;font-size:.94rem;font-weight:520;cursor:pointer;transition:border-color .15s ease,background .15s ease,box-shadow .15s ease}
#${PANEL_ID}.${PANEL_CLASS} .nexus-story-radio.nexus-scene-tale-sound-option:hover{border-color:rgba(34,232,255,.5);background:rgba(22,53,69,.72)}
#${PANEL_ID}.${PANEL_CLASS} .nexus-story-radio.nexus-scene-tale-sound-option.is-selected{border-color:#21e5fa;background:linear-gradient(180deg,rgba(17,83,99,.62),rgba(8,48,62,.62));box-shadow:0 0 24px rgba(30,224,246,.12),inset 0 0 0 1px rgba(31,230,250,.12)}
#${PANEL_ID}.${PANEL_CLASS} .nexus-story-radio input{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
#${PANEL_ID}.${PANEL_CLASS} .nexus-story-radio:focus-within{outline:2px solid rgba(34,232,255,.82);outline-offset:2px}
#${PANEL_ID}.${PANEL_CLASS} .nexus-scene-tale-radio-dot{width:1.05rem;height:1.05rem;flex:0 0 1.05rem;border-radius:50%;border:2px solid #57718a;box-shadow:inset 0 0 0 4px rgba(9,29,43,.95)}
#${PANEL_ID}.${PANEL_CLASS} .nexus-story-radio.is-selected .nexus-scene-tale-radio-dot{border-color:#20e9ff;background:#20e9ff;box-shadow:inset 0 0 0 4px rgba(7,45,58,.96),0 0 12px rgba(32,233,255,.42)}
#${PANEL_ID}.${PANEL_CLASS} .nexus-bd-together-options.nexus-scene-tale-primary-actions{display:block;margin-top:.18rem}
#${PANEL_ID}.${PANEL_CLASS} [data-action=create-story]{position:relative;width:100%;min-height:4.35rem;display:flex;align-items:center;justify-content:center;padding:1rem 4rem;border:1px solid rgba(69,241,255,.92);border-radius:999px;background:linear-gradient(102deg,#18bde9 0%,#31e3e5 50%,#19bfe8 100%);box-shadow:0 12px 32px rgba(0,176,220,.2),inset 0 1px 0 rgba(255,255,255,.34);color:#03121b;font:760 1.02rem/1 var(--font-sans,Inter,system-ui,sans-serif);cursor:pointer}
#${PANEL_ID}.${PANEL_CLASS} [data-action=create-story]:hover{filter:brightness(1.06)}
#${PANEL_ID}.${PANEL_CLASS} [data-action=create-story]:disabled{cursor:wait;filter:saturate(.7);opacity:.78}
#${PANEL_ID}.${PANEL_CLASS} .nexus-scene-tale-cta-arrow{position:absolute;right:1.65rem;width:1.25rem;height:1.25rem;color:#03121b;stroke:currentColor}
#${PANEL_ID}.${PANEL_CLASS} .nexus-bd-together-cancel{position:relative;margin:1.4rem auto 0;padding:.55rem 2rem;width:auto;min-width:8.5rem;color:#7f96ad;font-size:.88rem}
#${PANEL_ID}.${PANEL_CLASS} .nexus-bd-together-cancel::before,#${PANEL_ID}.${PANEL_CLASS} .nexus-bd-together-cancel::after{content:'';position:absolute;top:50%;width:6.2rem;height:1px;background:linear-gradient(90deg,transparent,rgba(103,140,168,.24))}
#${PANEL_ID}.${PANEL_CLASS} .nexus-bd-together-cancel::before{right:100%;margin-right:.8rem}#${PANEL_ID}.${PANEL_CLASS} .nexus-bd-together-cancel::after{left:100%;margin-left:.8rem;transform:scaleX(-1)}

@media(max-width:760px){
  html.${ROOT_CLASS},html.${ROOT_CLASS} body{height:100%;overflow:hidden!important}
  html.${ROOT_CLASS} .topbar{min-height:48px!important;padding:6px 10px!important}
  html.${ROOT_CLASS} .brand-inline-title{font-size:.82rem!important}
  html.${ROOT_CLASS} .brand-inline-sub{font-size:.62rem!important}
  html.${ROOT_CLASS} .content-layout{display:block!important;min-height:0!important;overflow:hidden!important}
  html.${ROOT_CLASS} .avatar-panel{height:100%!important;max-height:none!important;min-height:0!important;overflow:hidden!important}
  html.${ROOT_CLASS} .avatar-card{height:100%!important;min-height:0!important}
  html.${ROOT_CLASS} .avatar-preview-wrap{height:100%!important;min-height:0!important;max-height:none!important}
  html.${ROOT_CLASS} .avatar-viewport{height:100%!important;min-height:0!important}
  html.${ROOT_CLASS} .avatar-footer,html.${ROOT_CLASS} .chat-panel,html.${ROOT_CLASS} .chat-input-shell,html.${ROOT_CLASS} #chat-overlay-handle,html.${ROOT_CLASS} .pose-studio-root,html.${ROOT_CLASS} .avatar-picker-backdrop,html.${ROOT_CLASS} .avatar-picker-panel,html.${ROOT_CLASS} .xr-launch-bar{display:none!important}
  #${PANEL_ID}.${PANEL_CLASS}{position:fixed;top:calc(50% + 24px);bottom:auto;left:50%;right:auto;transform:translate(-50%,-50%);width:min(520px,calc(100vw - 28px));max-width:520px;max-height:calc(100vh - 84px);max-height:calc(100dvh - 84px - env(safe-area-inset-bottom,0px));padding:1rem 1rem .85rem;border-radius:22px;overflow-y:auto;overscroll-behavior:contain}
  #${PANEL_ID}.${PANEL_CLASS} .nexus-bd-together-head{margin-bottom:.38rem;font-size:.66rem;gap:.72rem}
  #${PANEL_ID}.${PANEL_CLASS} .nexus-bd-together-subtitle.nexus-scene-tale-setup-title{font-size:2rem;margin-bottom:.2rem}
  #${PANEL_ID}.${PANEL_CLASS} .nexus-bd-together-prompt{margin-bottom:.9rem;font-size:.86rem}
  #${PANEL_ID}.${PANEL_CLASS} .nexus-scene-tale-setup-section{margin-bottom:.78rem}
  #${PANEL_ID}.${PANEL_CLASS} .nexus-story-setup-label.nexus-scene-tale-section-label{gap:.5rem;margin-bottom:.38rem;font-size:.82rem}
  #${PANEL_ID}.${PANEL_CLASS} .nexus-scene-tale-label-icon{width:1rem;height:1rem;flex-basis:1rem}
  #${PANEL_ID}.${PANEL_CLASS} .nexus-scene-tale-label-secondary{font-size:.74rem}
  #${PANEL_ID}.${PANEL_CLASS} .nexus-scene-tale-place-card{min-height:4.25rem;padding:.45rem .55rem;gap:.7rem;font-size:.9rem}
  #${PANEL_ID}.${PANEL_CLASS} .nexus-scene-tale-place-thumb{width:5.25rem;flex-basis:5.25rem;height:3rem}
  #${PANEL_ID}.${PANEL_CLASS} .nexus-story-setup-input{min-height:3.5rem;height:3.5rem;padding:.72rem .85rem;font-size:.92rem}
  #${PANEL_ID}.${PANEL_CLASS} .nexus-scene-tale-sound-grid{grid-template-columns:1fr 1fr;gap:.55rem}
  #${PANEL_ID}.${PANEL_CLASS} .nexus-story-radio.nexus-scene-tale-sound-option{min-height:3.5rem;padding:.62rem .72rem;gap:.58rem;font-size:.84rem}
  #${PANEL_ID}.${PANEL_CLASS} [data-action=create-story]{min-height:3.65rem;padding:.8rem 3rem;font-size:.94rem}
  #${PANEL_ID}.${PANEL_CLASS} .nexus-scene-tale-cta-arrow{right:1.2rem;width:1.05rem;height:1.05rem}
  #${PANEL_ID}.${PANEL_CLASS} .nexus-bd-together-cancel{margin:.62rem auto 0;padding:.4rem 1.5rem;font-size:.8rem}
  #${PANEL_ID}.${PANEL_CLASS} .nexus-bd-together-cancel::before,#${PANEL_ID}.${PANEL_CLASS} .nexus-bd-together-cancel::after{width:2.5rem}
}
@media(max-width:389px){#${PANEL_ID}.${PANEL_CLASS} .nexus-scene-tale-sound-grid{grid-template-columns:1fr}#${PANEL_ID}.${PANEL_CLASS} .nexus-story-radio.nexus-scene-tale-sound-option{min-height:3.35rem}}
`;

    function svgIcon(doc, kind, className) {
        const ns = 'http://www.w3.org/2000/svg';
        const svg = doc.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '1.9');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.setAttribute('aria-hidden', 'true');
        svg.classList.add(className || 'nexus-scene-tale-label-icon');
        const path = (d) => { const node = doc.createElementNS(ns, 'path'); node.setAttribute('d', d); svg.appendChild(node); };
        if (kind === 'pin') {
            path('M12 21s6-5.1 6-11a6 6 0 1 0-12 0c0 5.9 6 11 6 11Z');
            const circle = doc.createElementNS(ns, 'circle');
            circle.setAttribute('cx', '12'); circle.setAttribute('cy', '10'); circle.setAttribute('r', '2'); svg.appendChild(circle);
        } else if (kind === 'edit') { path('M4 20l4.2-1 10.6-10.6a2.1 2.1 0 0 0-3-3L5.2 16 4 20Z'); path('M13.8 7.4l2.8 2.8'); }
        else if (kind === 'music') { path('M9 18V6l10-2v12'); path('M9 10l10-2'); path('M9 18a3 3 0 1 1-3-3h3'); path('M19 16a3 3 0 1 1-3-3h3'); }
        else if (kind === 'arrow') { path('M5 12h14'); path('M14 7l5 5-5 5'); }
        return svg;
    }

    function ensureStyles(doc) {
        if (!doc || doc.getElementById(STYLE_ID)) return;
        const style = doc.createElement('style'); style.id = STYLE_ID; style.textContent = CSS;
        (doc.head || doc.documentElement).appendChild(style);
    }

    function normalizeSceneLabel(value) {
        let label = String(value || '').trim();
        while (label.indexOf('  ') >= 0) label = label.split('  ').join(' ');
        if (!label || /^(current scene|current place)$/i.test(label)) return '';
        label = label.split(' — ').join(' · ');
        label = label.split(' – ').join(' · ');
        return label;
    }

    function sceneLabelForId(value) { return SCENE_LABELS_BY_ID[String(value || '').trim().toLowerCase()] || ''; }

    function catalogLabel(entry) {
        if (!entry || entry.type !== 'image') return '';
        const label = normalizeSceneLabel(entry.label);
        const variant = normalizeSceneLabel(entry.variantLabel);
        if (label && variant) return `${label} · ${variant}`;
        return label || variant;
    }

    function currentBackground(win) {
        try {
            const viewer = win && win.NEXUS_VIEWER;
            const state = viewer && typeof viewer.getVisualState === 'function' ? viewer.getVisualState() : null;
            return String((state && state.background) || '').trim();
        } catch (_) { return ''; }
    }

    function resolveCurrentScene(doc, fallbackText) {
        const win = (doc && doc.defaultView) || (typeof window !== 'undefined' ? window : null);
        const capability = win && win.NEXUS_SCENE_AMBIENCE_CAPABILITY;
        try {
            if (capability && typeof capability.currentSceneLabel === 'function') {
                const authoritative = normalizeSceneLabel(capability.currentSceneLabel());
                if (authoritative) return authoritative;
            }
        } catch (_) {}
        const background = currentBackground(win);
        const mapped = sceneLabelForId(background);
        if (mapped) return mapped;
        try {
            const catalog = win && win.NEXUS_VIEWPORT_BACKGROUND_CATALOG;
            const entry = background && catalog && typeof catalog.get === 'function' ? catalog.get(background) : null;
            const label = catalogLabel(entry);
            if (label) return label;
        } catch (_) {}
        try {
            const scene = win && win.NEXUS_BD && win.NEXUS_BD.blackboard && win.NEXUS_BD.blackboard.scene;
            if (scene && typeof scene === 'object') {
                const mappedScene = sceneLabelForId(scene.id || scene.sceneId);
                if (mappedScene) return mappedScene;
                const label = normalizeSceneLabel(scene.label || scene.title);
                if (label) return label;
            } else {
                const mappedScene = sceneLabelForId(scene);
                if (mappedScene) return mappedScene;
            }
        } catch (_) {}
        const fallback = normalizeSceneLabel(fallbackText);
        if (fallback) return sceneLabelForId(fallback) || fallback;
        return 'This place';
    }

    function sectionLabel(doc, node, kind, text, secondary) {
        if (!node) return;
        node.textContent = ''; node.classList.add('nexus-scene-tale-section-label');
        node.appendChild(svgIcon(doc, kind, 'nexus-scene-tale-label-icon'));
        const primary = doc.createElement('span'); primary.textContent = text; node.appendChild(primary);
        if (secondary) { const extra = doc.createElement('span'); extra.className = 'nexus-scene-tale-label-secondary'; extra.textContent = secondary; node.appendChild(extra); }
    }

    function sceneThumbnail(value) {
        const raw = String(value || '').trim();
        const label = sceneLabelForId(raw) || normalizeSceneLabel(raw);
        return SCENE_THUMBNAILS[label] || '';
    }

    function wrapSection(doc, panel, nodes) {
        const valid = nodes.filter(Boolean); if (!valid.length) return null;
        const section = doc.createElement('section'); section.className = 'nexus-scene-tale-setup-section'; panel.insertBefore(section, valid[0]);
        for (const node of valid) section.appendChild(node);
        return section;
    }

    function syncSoundOptions(options) {
        for (const option of options) {
            const input = option.querySelector('input[type=radio]');
            const selected = Boolean(input && input.checked);
            option.classList.toggle('is-selected', selected); option.setAttribute('aria-checked', selected ? 'true' : 'false');
        }
    }

    function setupLifecycleActive(panel) {
        if (!panel || !panel.querySelector) return false;
        return Boolean(panel.querySelector('[data-action=create-story],[data-action=cancel-story],[data-action=start-story],.nexus-story-progress,.nexus-story-ready-meta'));
    }

    function setLifecycle(doc, panel, active) {
        const root = doc && doc.documentElement;
        if (root) root.classList.toggle(ROOT_CLASS, Boolean(active));
        const stage = activeStage || (panel && panel.closest && panel.closest('.avatar-card'));
        if (panel) panel.classList.toggle(PANEL_CLASS, Boolean(active));
        if (stage) stage.classList.toggle(OPEN_CLASS, Boolean(active));
        if (active) { activePanel = panel; activeStage = stage || null; }
        else { if (activePanel === panel) activePanel = null; if (activeStage === stage) activeStage = null; }
    }

    function clearStage(panel) { setLifecycle((panel && panel.ownerDocument) || currentDoc, panel, false); }

    function decorate(doc) {
        if (!doc || !doc.getElementById) return null;
        ensureStyles(doc);
        const panel = doc.getElementById(PANEL_ID);
        if (!panel) { if (doc.documentElement) doc.documentElement.classList.remove(ROOT_CLASS); return null; }
        const lifecycle = setupLifecycleActive(panel);
        setLifecycle(doc, panel, lifecycle);
        if (!lifecycle) return null;
        const create = panel.querySelector('[data-action=create-story]');
        if (!create) return panel;
        if (create.dataset.sceneTaleSetupDecorated === '1') return panel;
        create.dataset.sceneTaleSetupDecorated = '1';

        const head = panel.querySelector('.nexus-bd-together-head'); if (head) head.textContent = 'TOGETHER';
        const title = panel.querySelector('.nexus-bd-together-subtitle'); if (title) { title.textContent = 'Scene Tale'; title.classList.add('nexus-scene-tale-setup-title'); }
        const prompt = panel.querySelector('.nexus-bd-together-prompt'); if (prompt) prompt.textContent = 'A little story inspired by this place.';

        const labels = [...panel.querySelectorAll('.nexus-story-setup-label')];
        const placeLabel = labels.find((node) => /^Current place/i.test(node.textContent || '')) || labels[0];
        const ideaLabel = labels.find((node) => /^Give me an idea/i.test(node.textContent || '')) || labels[1];
        const soundLabel = labels.find((node) => /^Soundtrack/i.test(node.textContent || '')) || labels[2];
        sectionLabel(doc, placeLabel, 'pin', 'Current place'); sectionLabel(doc, ideaLabel, 'edit', 'Give me an idea', 'Optional'); sectionLabel(doc, soundLabel, 'music', 'Soundtrack');

        const place = panel.querySelector('.nexus-bd-together-note');
        if (place) {
            const label = resolveCurrentScene(doc, place.textContent); place.textContent = ''; place.classList.add('nexus-scene-tale-place-card');
            const src = sceneThumbnail(label);
            if (src) { const img = doc.createElement('img'); img.className = 'nexus-scene-tale-place-thumb'; img.src = src; img.alt = label; img.loading = 'eager'; img.decoding = 'async'; place.appendChild(img); }
            const name = doc.createElement('span'); name.className = 'nexus-scene-tale-place-name'; name.textContent = label; place.appendChild(name);
        }

        const area = panel.querySelector('#nexus-scene-tale-idea');
        if (area) { area.placeholder = 'A letter somebody never delivered'; area.setAttribute('aria-label', 'Give me an idea'); area.rows = 1; }

        const soundOptions = [...panel.querySelectorAll('.nexus-story-radio')];
        for (const option of soundOptions) {
            option.classList.add('nexus-scene-tale-sound-option'); option.setAttribute('role', 'radio');
            const input = option.querySelector('input[type=radio]');
            if (input && !option.querySelector('.nexus-scene-tale-radio-dot')) { const dot = doc.createElement('span'); dot.className = 'nexus-scene-tale-radio-dot'; dot.setAttribute('aria-hidden', 'true'); input.insertAdjacentElement('afterend', dot); }
            if (input && input.dataset.sceneTaleSoundBound !== '1') { input.dataset.sceneTaleSoundBound = '1'; input.addEventListener('change', () => syncSoundOptions(soundOptions)); }
        }
        syncSoundOptions(soundOptions);

        if (placeLabel && place) wrapSection(doc, panel, [placeLabel, place]);
        if (ideaLabel && area) wrapSection(doc, panel, [ideaLabel, area]);
        if (soundLabel && soundOptions.length) { const grid = doc.createElement('div'); grid.className = 'nexus-scene-tale-sound-grid'; panel.insertBefore(grid, soundOptions[0]); for (const option of soundOptions) grid.appendChild(option); wrapSection(doc, panel, [soundLabel, grid]); }

        const actions = create.closest('.nexus-bd-together-options'); if (actions) actions.classList.add('nexus-scene-tale-primary-actions');
        create.setAttribute('aria-label', 'Create story'); create.appendChild(svgIcon(doc, 'arrow', 'nexus-scene-tale-cta-arrow'));
        return panel;
    }

    function install(doc) {
        const d = doc || (typeof document !== 'undefined' ? document : null); if (!d) return () => {};
        currentDoc = d; decorate(d);
        if (observer || typeof MutationObserver === 'undefined' || !d.body) return detach;
        observer = new MutationObserver(() => decorate(d)); observer.observe(d.body, { childList: true, subtree: true }); return detach;
    }

    function detach() {
        if (observer) observer.disconnect(); observer = null;
        if (activePanel) clearStage(activePanel);
        if (currentDoc) { currentDoc.documentElement.classList.remove(ROOT_CLASS); const style = currentDoc.getElementById(STYLE_ID); if (style && style.parentNode) style.parentNode.removeChild(style); }
        activePanel = null; activeStage = null; currentDoc = null;
    }

    const api = { PANEL_ID, STYLE_ID, OPEN_CLASS, PANEL_CLASS, ROOT_CLASS, CSS, SCENE_THUMBNAILS, SCENE_LABELS_BY_ID, normalizeSceneLabel, resolveCurrentScene, sceneThumbnail, setupLifecycleActive, decorate, install, detach, syncSoundOptions };
    if (typeof window !== 'undefined' && typeof document !== 'undefined' && !window.__NEXUS_SCENE_TALE_SETUP_VIEW_NOAUTO__) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => install(document), { once: true }); else install(document);
    }
    return api;
})();
if (typeof window !== 'undefined') window.NEXUS_SCENE_TALE_SETUP_VIEW = SceneTaleSetupView;
if (typeof module !== 'undefined' && module.exports) module.exports = SceneTaleSetupView;
