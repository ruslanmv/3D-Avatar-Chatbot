/**
 * Playground mood presets (PG1).
 *
 * A mood is a light for the world that is up — the same shape as a world's own `light` in
 * `assets/vr-worlds/worlds.json` — and nothing else. It does not move the camera, change the
 * picture behind her, play a sound or start an animation; it is the dimmer and the colour of the
 * bulbs. That is a deliberate ceiling: the request this answers ("make the pub warmer", "neon in
 * the club") is about light, and a preset that could also change the place would be a second way
 * to choose a world, which is the engine's decision alone (VW3).
 *
 * Why static colours and no animation of any kind: a club is where a strobe would be expected,
 * and a strobe is exactly what this must never draw. Flashing light between 3 and 60 Hz can
 * trigger seizures (WCAG 2.3.1 sets three flashes a second as the line), and in a headset there
 * is no looking away from it. A mood here is one light; going from one to another is a single
 * blend over `VRWorlds.MOOD_SECONDS`, or a cut under reduced motion. Nothing alternates.
 *
 * The floors that keep her face lit (hemi ≥ 0.4, fill ≥ 0.35) are applied again by
 * `VRWorlds.normalizeLight` when a mood is shown, so a preset cannot leave her in the dark —
 * `tests/playgrounds.test.js` checks the presets meet them on their own anyway.
 *
 * Exposes: window.NEXUS_PLAYGROUND_MOODS
 */
(function (global) {
    'use strict';

    const PRESETS = Object.freeze({
        'cozy-warm': Object.freeze({
            label: 'Cozy',
            light: Object.freeze({
                sky: '#ffe2c0',
                ground: '#4a3424',
                hemi: 0.85,
                key: '#ffc890',
                keyIntensity: 1.0,
                fill: '#ffd8b8',
                fillIntensity: 0.6,
                rim: '#ffcf9a',
                rimIntensity: 0.35,
                exposure: 1,
            }),
        }),
        'pub-amber': Object.freeze({
            label: 'Amber',
            light: Object.freeze({
                sky: '#ffd9a8',
                ground: '#4a3020',
                hemi: 0.8,
                key: '#ffb870',
                keyIntensity: 1.0,
                fill: '#ffd0a0',
                fillIntensity: 0.55,
                rim: '#ffc080',
                rimIntensity: 0.45,
                exposure: 1,
            }),
        }),
        'neon-blue-purple': Object.freeze({
            label: 'Neon',
            light: Object.freeze({
                sky: '#7a5cff',
                ground: '#120a24',
                hemi: 0.55,
                key: '#ff4fd8',
                keyIntensity: 0.9,
                fill: '#4fc8ff',
                fillIntensity: 0.6,
                rim: '#9a6bff',
                rimIntensity: 0.7,
                exposure: 1,
            }),
        }),
        'cabaret-gold': Object.freeze({
            label: 'Gold',
            light: Object.freeze({
                sky: '#ffd8a0',
                ground: '#3a1418',
                hemi: 0.7,
                key: '#ffc860',
                keyIntensity: 1.15,
                fill: '#ff9a8a',
                fillIntensity: 0.5,
                rim: '#ffd070',
                rimIntensity: 0.6,
                exposure: 1,
            }),
        }),
        'studio-soft': Object.freeze({
            label: 'Soft',
            light: Object.freeze({
                sky: '#f4f0ff',
                ground: '#3a3a48',
                hemi: 0.85,
                key: '#fff2e6',
                keyIntensity: 1.0,
                fill: '#d8e4ff',
                fillIntensity: 0.7,
                rim: '#c8a8ff',
                rimIntensity: 0.45,
                exposure: 1,
            }),
        }),
        'classroom-day': Object.freeze({
            label: 'Daylight',
            light: Object.freeze({
                sky: '#f4f8ff',
                ground: '#707078',
                hemi: 0.95,
                key: '#fff6e8',
                keyIntensity: 1.1,
                fill: '#e4eeff',
                fillIntensity: 0.65,
                rim: '#ffffff',
                rimIntensity: 0.25,
                exposure: 1,
            }),
        }),
        'romantic-evening': Object.freeze({
            label: 'Evening',
            light: Object.freeze({
                sky: '#ffc8d8',
                ground: '#3a2030',
                hemi: 0.65,
                key: '#ff9a7a',
                keyIntensity: 0.9,
                fill: '#c8a0ff',
                fillIntensity: 0.5,
                rim: '#ffb0c8',
                rimIntensity: 0.55,
                exposure: 0.95,
            }),
        }),
    });

    function ids() {
        return Object.keys(PRESETS);
    }

    /** A preset by id, or null. Returns a copy: callers cannot edit the table. Pure. */
    function get(id) {
        const preset = PRESETS[String(id || '')];
        return preset ? { id: String(id), label: preset.label, light: { ...preset.light } } : null;
    }

    const api = { PRESETS, ids, get };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_PLAYGROUND_MOODS = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
