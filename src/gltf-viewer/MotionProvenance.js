/**
 * MP1. Every motion Claude created for her body, tagged with HOW it was made, and a switch per
 * method — so any of it can be turned off at once, or removed for good with the steps written
 * here, without touching what was there before.
 *
 * ## Why one registry
 *
 * Motion was added over several batches and in five different ways: joint angles written by hand
 * into Pose Studio's presets, a procedural blend between presets, third-party CC0 dances converted
 * by a script, shows composed from those, and a procedural layer computed every frame. Each lives
 * in a different file and reaches her through a different path (Pose Studio's list, Private's
 * positions, the shows, the frame loop). Asked "which animations did Claude make, and how?", the
 * answer was spread across git history. Now it is this list — and a test fails if a created asset
 * is not in it, or if it names a file that no longer exists.
 *
 * ## What a switch does
 *
 * Off is read at the moment of use and removes nothing (the files, the code, the tests stay):
 *
 *   hand-authored-preset   the presets leave Pose Studio's list and its catalogue — and so
 *                          Private's positions, which only offer what Pose Studio lists — and any
 *                          show that uses one is not offered
 *   procedural-transition  a preset change goes back to the single blend curve it had before
 *   converted-cc0-clip     the shows that dance these clips are not offered
 *   composed-show          no shows are offered
 *   procedural-layer       the living layer draws nothing (it also has its own switch, LM3)
 *
 * Kept on this device (`nexus_motion_methods_off`, the methods that are off). A setting, not
 * conversation: CLEAR leaves it.
 *
 * ## Removing one for good
 *
 * Each item's `remove` says exactly what to delete; then delete its entry here (the provenance
 * test then checks nothing still points at it). Anything not listed here was not made by Claude.
 *
 * Exposes: window.NEXUS_MOTION_PROVENANCE
 */
(function (global) {
    'use strict';

    const METHODS = Object.freeze({
        'hand-authored-preset': Object.freeze({
            label: 'Hand-authored poses',
            how: 'Joint angles written by hand into Pose Studio presets, tuned against renders and measured skeletons (tools/qa/pose-sweep.mjs, pose-shots.mjs).',
        }),
        'procedural-transition': Object.freeze({
            label: 'Procedural pose blending',
            how: 'Computed at run time: each bone of a preset change eases on its own window, longer for bigger changes (no animation data).',
        }),
        'converted-cc0-clip': Object.freeze({
            label: 'Converted CC0 dances',
            how: 'Third-party CC0 motion (GLB), retargeted to the VRM humanoid and written as VRMA by tools/anim/glb2vrma.py. Sources and hashes in addons/vrma-cc0/README.md.',
        }),
        'composed-show': Object.freeze({
            label: 'Composed shows',
            how: 'Sequences of existing presets and clips with timings and lines for the model (no new motion data of their own).',
        }),
        'procedural-layer': Object.freeze({
            label: 'Living motion layer',
            how: 'Computed every frame over a held pose: breathing, rocking, arching, finish, face, hands on her body (no animation data).',
        }),
    });

    const POSES = 'src/gltf-viewer/VRPoseSystem.js';
    const PANEL = 'src/PoseStudioPanel.js';
    const preset = (name, batch, what, extra) =>
        Object.freeze({
            id: `preset:${name}`,
            name,
            method: 'hand-authored-preset',
            batch,
            what,
            files: [POSES, PANEL],
            remove: `Delete POSE_PRESETS.${name} and its PRESET_ORDER entry in ${POSES}, its NAV_PRESETS row in ${PANEL}${extra || ''}; then any show step or Private position that names it.`,
        });
    const show = (id, batch, what) =>
        Object.freeze({
            id: `show:${id}`,
            name: id,
            method: 'composed-show',
            batch,
            what,
            files: ['src/experiences/private/PrivateRoutines.js'],
            remove: `Delete ROUTINES.${id} and its ORDER entry in PrivateRoutines.js, its words in PrivateActionIntent.js (routineFrom), its chip label in PrivateLocale.js (routine.${id}) and ROUTINE_KEYS in PrivateConversationView.js.`,
        });

    const ITEMS = Object.freeze([
        preset(
            'sittingOpen',
            'OL1',
            'Seated on the floor, legs open in a wide V, leaning back a little (was a chair seat, UN24)'
        ),
        preset('kneelingWide', 'UN24', 'Kneeling, knees wide, sitting back towards the heels, back arched'),
        preset(
            'floorOpen',
            'UN24',
            'Seated on the floor, knees apart — kept out of every menu until it rests on the floor (develop/NEEDS_FIX.md)'
        ),
        preset('lyingKneesUp', 'UN26', 'On her back, knees raised and apart, feet on the floor'),
        preset('straddle', 'UN26', 'Kneeling up astride, knees wide, back arched, hands forward'),
        preset('faceDownArched', 'UN38', 'Face down, chest and forearms on the floor, hips raised over the knees'),
        preset('legsOverShoulders', 'UN38', 'On her back, legs raised high and almost straight'),
        preset('bentOverWide', 'UN38', 'Standing, bent deep from the hips, feet apart, hands by her knees'),
        preset('spoonArched', 'UN38', 'On her side, back arched, top knee up, looking over her shoulder'),
        preset('reverseStraddle', 'UN38', 'Kneeling astride, turned away, leaning forward, looking back'),
        preset('kneelingOffer', 'UN38', 'Kneeling tall, knees a little apart, hands on thighs, face lifted'),
        Object.freeze({
            id: 'transition:stagger',
            name: 'stagger',
            method: 'procedural-transition',
            batch: 'UN23',
            what: 'Preset changes stagger: the trunk leads, hands and feet arrive last; duration from how far she moves',
            files: ['src/gltf-viewer/PoseTransition.js', 'tests/pose-transition.test.js'],
            remove: 'Delete PoseTransition.js and its test, and its import at the top of VRPoseSystem.js (the blend falls back to one curve).',
        }),
        Object.freeze({
            id: 'clip:slow_body_roll',
            name: 'addons/vrma-cc0/slow_body_roll.vrma',
            method: 'converted-cc0-clip',
            batch: 'VA2',
            what: 'Slow body roll, looped (Innerscene, CC0)',
            files: ['addons/vrma-cc0/slow_body_roll.vrma', 'addons/vrma-cc0/README.md', 'tools/anim/glb2vrma.py'],
            remove: 'Delete the .vrma and its README row; the shows that use it (striptease, table-dance) must go or change first.',
        }),
        Object.freeze({
            id: 'clip:club_phrase',
            name: 'addons/vrma-cc0/club_phrase.vrma',
            method: 'converted-cc0-clip',
            batch: 'VA2',
            what: 'Four-bar club dance phrase, looped (Innerscene, CC0)',
            files: ['addons/vrma-cc0/club_phrase.vrma', 'addons/vrma-cc0/README.md', 'tools/anim/glb2vrma.py'],
            remove: 'Delete the .vrma and its README row; the shows that use it (striptease, table-dance) must go or change first.',
        }),
        Object.freeze({
            id: 'transition:chest-reach',
            name: 'chest-reach',
            method: 'procedural-transition',
            batch: 'VS1',
            what: 'Arms too short for a hands-down pose: the chest pitches forward (at most 20°) until both palms reach the floor',
            files: ['src/gltf-viewer/VRPoseSystem.js'],
            remove: 'Delete the VS1 block (chest pitch) in _placeSupportHands in VRPoseSystem.js; the arms alone reach, and a body they cannot reach the floor on is refused the position.',
        }),
        show('tease', 'UN36', 'Turns away, bends forward, turns back, kneels, kneels wide'),
        show('ride', 'UN36', 'Kneels up, then straddles them'),
        show('open-for-you', 'UN36', 'Kneels wide, sits open, then on her back with knees up'),
        show('from-behind', 'UN36', 'Kneels wide, then on all fours, turned away'),
        show('everything', 'UN36', 'Sits open, on her back with knees up, on all fours turned away'),
        show('striptease', 'VA3', 'Dances the two CC0 clips, a layer off at each cue, ends kneeling'),
        show(
            'window-evening',
            'WR1',
            'The Window Room evening: dances at the window, sits on the bed, undresses, three positions, asks where to finish'
        ),
        show('table-dance', 'VA3', 'Dances, turns, ends astride their lap'),
        // UR1. Unrestrained shows: existing positions and clips in a row, each with a skin state.
        show('used-marked', 'UR1', 'Kneels wide, knees up, all fours, astride, lies back'),
        show('full-service', 'L5', 'On her knees, bent over, face down, astride facing away, legs up'),
        show('like-last-time', 'L5', 'Spooning, astride, legs up, knees up, curled on her side'),
        show('edging', 'UR1', 'Kneels wide, sits open, astride, knees up — each held on the edge'),
        show('dom-sub', 'UR1', 'Kneels, kneels wide, all fours, astride'),
        show('oil-everything', 'UR1', 'On her front, lounging, knees up, all fours'),
        show('tied', 'UR1', 'Kneels, knees up, lies back'),
        show('rounds', 'UR1', 'All fours, astride, knees up, lies back'),
        show('window-show', 'UR1', 'Dances the club clip, arches back, bends forward, sits open'),
        Object.freeze({
            id: 'layer:living',
            name: 'living',
            method: 'procedural-layer',
            batch: 'LM1–LM4',
            what: 'Breathing, pelvis rocking, arch, head back at the finish, face, hands on breast and belly',
            files: [
                'src/experiences/private/PrivateLivingMotion.js',
                'tests/private-living-motion.test.js',
                'tools/qa/living-motion-live.mjs',
                'tools/qa/living-motion-compare.mjs',
            ],
            remove: 'Delete PrivateLivingMotion.js (and its boot.js / index.html lines), startLiving in PrivateActionBridge.js, and setLayer/_layerApply/_layerUndo in VRPoseSystem.js.',
        }),
        Object.freeze({
            id: 'layer:hair-aside',
            name: 'hair-aside',
            method: 'procedural-layer',
            batch: 'HA1',
            what: 'Her spring-bone hair falls along her forward instead of over her back, when the person asks (⋯ chip or words); released exactly as it was',
            files: ['src/gltf-viewer/HairAside.js', 'tests/hair-aside.test.js', 'tools/qa/private-positions-live.mjs'],
            remove: 'Delete HairAside.js (and its boot.js line), avatar.hair in PrivateActionPolicy.js, hairFrom in PrivateActionIntent.js, hair/releaseHair in PrivateActionBridge.js, and the hair chip in PrivateConversationView.js.',
        }),
    ]);

    const STORAGE_KEY = 'nexus_motion_methods_off';
    const listeners = new Set();

    function store() {
        try {
            return global && global.localStorage ? global.localStorage : null;
        } catch (_) {
            return null;
        }
    }

    /** The methods switched off on this device. Unreadable storage: none (the shipped default). */
    function off() {
        try {
            const st = store();
            const raw = st ? st.getItem(STORAGE_KEY) : null;
            const list = raw ? JSON.parse(raw) : [];
            return new Set(Array.isArray(list) ? list.filter((m) => METHODS[m]) : []);
        } catch (_) {
            return new Set();
        }
    }

    function isMethodOn(method) {
        return !off().has(method);
    }

    function setMethodOn(method, on) {
        if (!METHODS[method]) return false;
        const now = off();
        const was = !now.has(method);
        if (on) now.delete(method);
        else now.add(method);
        try {
            const st = store();
            if (st) st.setItem(STORAGE_KEY, JSON.stringify([...now]));
        } catch (_) {
            /* private browsing: it stays as it was for this page */
        }
        const is = isMethodOn(method);
        if (is !== was)
            for (const fn of [...listeners]) {
                try {
                    fn(method, is);
                } catch (_) {
                    /* one listener must not stop the others */
                }
            }
        return is;
    }

    function onChange(fn) {
        if (typeof fn !== 'function') return () => {};
        listeners.add(fn);
        return () => listeners.delete(fn);
    }

    const byId = new Map(ITEMS.map((i) => [i.id, i]));
    const byName = new Map(ITEMS.map((i) => [`${i.method}|${i.name}`, i]));

    /** The registry entry for an id (`preset:straddle`, `clip:club_phrase`, `show:tease`…), or null. */
    function find(id) {
        return byId.get(id) || null;
    }

    /** May this be used now? Anything not in the registry was not made by Claude: always yes. */
    function allowed(id) {
        const item = byId.get(id);
        return !item || isMethodOn(item.method);
    }
    const presetAllowed = (name) => allowed(`preset:${name}`);
    const showAllowed = (id) => allowed(`show:${id}`);
    function clipAllowed(path) {
        const item = byName.get(`converted-cc0-clip|${String(path || '').replace(/^\/+/, '')}`);
        return !item || isMethodOn(item.method);
    }

    /** What Claude made, grouped by method, for Settings and for reports. */
    function summary() {
        return Object.keys(METHODS).map((m) => ({
            method: m,
            label: METHODS[m].label,
            how: METHODS[m].how,
            on: isMethodOn(m),
            items: ITEMS.filter((i) => i.method === m).map((i) => ({ id: i.id, batch: i.batch, what: i.what })),
        }));
    }

    /**
     * The Settings rows: one switch per method, under Private Mode, after the living switch. Added
     * from here, not written into index.html (a row there moves the lines the parity harness pins).
     */
    const GROUP_ID = 'motion-provenance-settings';
    function mountSetting(doc) {
        const d = doc || (typeof document !== 'undefined' ? document : null);
        if (!d) return null;
        if (d.getElementById(GROUP_ID)) return d.getElementById(GROUP_ID);
        const spicy = d.getElementById('spicy-mode-toggle');
        const section = spicy && spicy.closest ? spicy.closest('.config-section') : null;
        if (!section) return null;
        const group = d.createElement('div');
        group.id = GROUP_ID;
        group.className = 'input-group';
        const title = d.createElement('p');
        title.style.cssText = 'font-size: 0.75rem; margin: 10px 0 4px; opacity: 0.9';
        title.textContent = 'Motion created by Claude — by how it was made';
        group.append(title);
        for (const s of summary()) {
            const label = d.createElement('label');
            label.className = 'spicy-toggle-label';
            const text = d.createElement('span');
            text.textContent = `${s.label} (${s.items.length})`;
            text.title = `${s.how}\n\n${s.items.map((i) => `${i.id} — ${i.what}`).join('\n')}`;
            const sw = d.createElement('div');
            sw.className = 'spicy-toggle-switch';
            const box = d.createElement('input');
            box.type = 'checkbox';
            box.dataset.motionMethod = s.method;
            box.checked = s.on;
            box.addEventListener('change', () => setMethodOn(s.method, box.checked));
            const slider = d.createElement('span');
            slider.className = 'spicy-toggle-slider';
            sw.append(box, slider);
            label.append(text, sw);
            group.append(label);
        }
        const note = d.createElement('p');
        note.style.cssText = 'font-size: 0.7rem; color: #888; margin: 6px 0 0';
        note.textContent =
            'Off hides it everywhere it is offered; nothing is deleted. Hover a row to see what it covers.';
        group.append(note);
        section.append(group);
        onChange((method, on) => {
            const box = group.querySelector(`[data-motion-method="${method}"]`);
            if (box) box.checked = on;
        });
        return group;
    }

    const api = {
        METHODS,
        ITEMS,
        STORAGE_KEY,
        isMethodOn,
        setMethodOn,
        onChange,
        find,
        allowed,
        presetAllowed,
        showAllowed,
        clipAllowed,
        summary,
        mountSetting,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_MOTION_PROVENANCE = api;
    // After DOMContentLoaded and a tick, so the rows come after the living switch (LM3), which
    // mounts on DOMContentLoaded; this file is imported by VRPoseSystem, which can run earlier.
    if (typeof document !== 'undefined' && typeof module === 'undefined') {
        const later = () => setTimeout(() => mountSetting(document), 0);
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', later, { once: true });
        else later();
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
