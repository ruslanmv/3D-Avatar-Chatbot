/**
 * WorldSpots — the measured places she can stand inside a world (LW2–LW3, Living Worlds).
 *
 * Why this exists. A place used to be one spot: `scene.at` and `turn` in worlds.json put one
 * measured point of the room under her, and that was the whole room as far as anything knew. So
 * "let's go to the kitchen" could only mean another world, and a conversation in the bedroom
 * described a bed, a blanket and a lamp that nothing had checked — while one stray activity tag
 * swapped the bedroom for a meadow (the LW1 regression). Living Worlds keeps the world and moves
 * her within it.
 *
 * A spot is data that a tool measured, never a coordinate somebody typed:
 * `tools/vr/measure-spots.mjs` raycasts the real GLB (floor under her, room for her body, a clear
 * view to the person, the thing really in the same room) and writes
 * `assets/vr-worlds/spots/<scene>.json`. This module is the only reader of those files, and it
 * is the trust boundary for them:
 *
 *   - `normalize` keeps a spot only if it is `verified` with finite numbers, a safe id, labels,
 *     known capabilities and a known rating. An unmeasured spot (`verified: false`) is dropped:
 *     a kitchen that was never measured is not offered, in the prompt or in the menu.
 *   - Spots belong to a physical SCENE FILE, not to a world id. `bedroom` (desktop) and
 *     `bedroom-light` (phone) are different models with different rooms; a phone and a desktop
 *     each get the spots of the model they actually show, and coordinates never cross.
 *   - `placementFor` turns a spot into the scene transform the world runtime applies — the same
 *     convention as `scene.at`/`turn`: she stays at the origin facing +z (the person is 1 m in
 *     front, VRWorlds.comfortProblem), and the room is turned and moved so the spot is under her.
 *   - `intentOf` reads a person's own words (English or Italian) for "go to <spot>". It needs a
 *     verb of going AND a spot word, so "the kitchen is lovely" never moves anyone.
 *
 * Pure apart from `load` (one fetch per scene file, cached). Exposes window.NEXUS_WORLD_SPOTS.
 */
(function (global) {
    'use strict';

    const SCHEMA = 1;
    const ROOT = 'assets/vr-worlds/';
    const SPOTS_DIR = 'spots/';
    const ID = /^[a-z0-9-]{1,30}$/;
    const CAN = Object.freeze(['stand-near', 'look-at']);
    const RATINGS = Object.freeze(['general', 'romantic']);

    /**
     * Words a person uses for each spot, by id. Language, not geometry, so it lives here and not in
     * the measured file; an id with no words can still be reached from the menu and from her tag.
     */
    const WORDS = Object.freeze({
        sofa: ['sofa', 'couch', 'divano', 'salotto', 'living room', 'soggiorno'],
        'record-player': ['record player', 'records', 'vinyl', 'music corner', 'giradischi', 'dischi', 'vinili'],
        kitchen: ['kitchen', 'cucina'],
        'dining-table': ['dining table', 'table', 'dinner table', 'tavolo', 'tavola', 'sala da pranzo'],
        bed: ['bed', 'bedroom', 'letto', 'camera da letto', 'camera'],
        desk: ['desk', 'study', 'computer', 'scrivania', 'studio'],
        bathroom: ['bathroom', 'bath', 'shower', 'bagno', 'doccia', 'vasca'],
        balcony: ['balcony', 'terrace', 'outside', 'balcone', 'terrazzo', 'terrazza', 'fuori'],
    });

    /** "Let's go", "take me", "andiamo", "portami"… — a request to move, not a remark. */
    const GO = new RegExp(
        [
            "\\blet'?s (?:go|move|head|sit|stand|hang out|be)\\b",
            '\\b(?:go|walk|move|head|come)(?:\\s+(?:back|over|out))?\\s+(?:to|into|in|on|onto|over to|by|near)\\b',
            '\\btake me\\b',
            '\\b(?:shall|can|could) we (?:go|move|head)\\b',
            '\\bandiamo\\b',
            '\\bspostiamoci\\b',
            '\\bportami\\b',
            '\\b(?:vai|va|vieni|venite|torniamo|torna)\\b',
            '\\b(?:possiamo|potremmo|vorrei) (?:andare|spostarci|stare)\\b',
            '\\bfacciamo un salto\\b',
            '\\bstiamo (?:sul|in|nel|al)\\b',
        ].join('|'),
        'i'
    );

    function num(v) {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    }

    function text(v, max) {
        const s = typeof v === 'string' ? v.replace(/[<>{}[\]`]/g, '').trim() : '';
        return s.slice(0, max || 80);
    }

    function labelOf(v) {
        if (typeof v === 'string') return { en: text(v, 60), it: text(v, 60) };
        const en = text(v && v.en, 60);
        const it = text(v && v.it, 60) || en;
        return en ? { en, it } : null;
    }

    /**
     * A measured spots file → { scene, sha256, title, floorY, spots: [...] } with only the spots
     * that may be offered, or null when the file is not a spots file at all. Pure.
     */
    function normalize(raw) {
        if (!raw || typeof raw !== 'object' || raw.schemaVersion !== SCHEMA) return null;
        const scene = typeof raw.scene === 'string' ? raw.scene : '';
        if (!/^scenes\/[a-z0-9-]+\.glb$/.test(scene)) return null;
        const spots = [];
        const seen = new Set();
        for (const s of Array.isArray(raw.spots) ? raw.spots : []) {
            if (!s || s.verified !== true || typeof s.id !== 'string' || !ID.test(s.id) || seen.has(s.id)) continue;
            const p = Array.isArray(s.position) ? s.position.map(num) : [];
            const facing = num(s.facingDeg);
            const label = labelOf(s.label);
            if (p.length !== 3 || p.some((v) => v === null) || facing === null || !label) continue;
            const can = (Array.isArray(s.can) ? s.can : []).filter((c) => CAN.includes(c));
            if (!can.length) continue;
            const rating = RATINGS.includes(s.rating) ? s.rating : null;
            if (!rating) continue;
            seen.add(s.id);
            spots.push({
                id: s.id,
                label,
                room: typeof s.room === 'string' && ID.test(s.room) ? s.room : null,
                sees: labelOf(s.sees),
                can,
                rating,
                position: p,
                facingDeg: facing,
                // How a screen must frame her here: 'mid' or 'bust' when the room is too small for
                // the full-body camera to see her past the walls (measured, never assumed).
                framing: s.framing === 'bust' || s.framing === 'mid' ? s.framing : 'fullBody',
            });
        }
        return {
            scene,
            sha256: typeof raw.sha256 === 'string' ? raw.sha256 : '',
            title: labelOf(raw.title),
            floorY: num(raw.floorY),
            spots,
        };
    }

    /**
     * The scene transform that puts `spot` under her, facing the person. Matches VRWorlds'
     * convention: built.rotation.y = turn, built.position = at, and she stands at the origin
     * looking along +z. With R the rotation by `turn` about +y, the spot's point p lands at
     * R·p + at = 0 and its facing (sin f, cos f) lands on +z, so turn = −f and at = −R·p. Pure.
     */
    function placementFor(spot, scale) {
        const s = num(scale) || 1;
        const turn = -spot.facingDeg;
        const a = (turn * Math.PI) / 180;
        const [x, y, z] = spot.position.map((v) => v * s);
        // three's rotation about y: x' = x cos a + z sin a ; z' = −x sin a + z cos a
        const rx = x * Math.cos(a) + z * Math.sin(a);
        const rz = -x * Math.sin(a) + z * Math.cos(a);
        return { turn: Math.round(turn * 1000) / 1000, at: [-rx, -y, -rz].map((v) => Math.round(v * 1000) / 1000) };
    }

    /** Which spot, if any, a world's own `scene.at`/`turn` already stands her on. Pure. */
    function spotAtPlacement(spots, scene, tolerance) {
        if (!scene || !Array.isArray(scene.at)) return null;
        const tol = tolerance || 0.05;
        for (const spot of spots || []) {
            const p = placementFor(spot, scene.scale);
            const dTurn = Math.abs(((((p.turn - num(scene.turn)) % 360) + 540) % 360) - 180);
            const dAt = Math.hypot(p.at[0] - scene.at[0], p.at[2] - scene.at[2]);
            if (dTurn < 1 && dAt < tol) return spot.id;
        }
        return null;
    }

    function norm(s) {
        return String(s || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/[’`]/g, "'");
    }

    /**
     * The person's own words → { spot } for a request to go to one of `spots`, { move: true }
     * for a request to move with no spot named, or null. A spot word alone is not a request
     * ("the kitchen is lovely"); a verb of going alone is { move: true }. The longest matching
     * word wins, so "camera da letto" beats "camera". Pure.
     */
    function intentOf(message, spots) {
        const t = norm(message);
        if (!t || !GO.test(t)) return null;
        let best = null;
        for (const spot of spots || []) {
            const words = (WORDS[spot.id] || []).concat([spot.label.en, spot.label.it].map(norm));
            for (const w of words) {
                const word = norm(w)
                    .replace(/^(?:by|at|in|on) the /, '')
                    .replace(/^(?:vicino al|vicino alla|alla|al|in|sul) /, '');
                if (!word || word.length < 3) continue;
                const re = new RegExp('(?:^|[^a-z])' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:$|[^a-z])');
                if (re.test(t) && (!best || word.length > best.len)) best = { spot: spot.id, len: word.length };
            }
        }
        return best ? { spot: best.spot } : { move: true };
    }

    /** The spots file a scene's spots live in: `scenes/x.glb` → `spots/x.json`. Pure. */
    function fileFor(sceneSrc) {
        const m = /^scenes\/([a-z0-9-]+)\.glb$/.exec(String(sceneSrc || ''));
        return m ? SPOTS_DIR + m[1] + '.json' : null;
    }

    const cache = new Map();
    /** Fetch (once) and normalize the spots for a scene file; null when there are none. */
    function load(sceneSrc, fetcher) {
        const file = fileFor(sceneSrc);
        if (!file) return Promise.resolve(null);
        if (!cache.has(file)) {
            const doFetch = fetcher || (global && global.fetch ? global.fetch.bind(global) : null);
            const p = doFetch
                ? Promise.resolve(doFetch(ROOT + file))
                      .then((r) => (r && r.ok ? r.json() : null))
                      .then((raw) => {
                          const n = normalize(raw);
                          return n && n.scene === sceneSrc ? n : null;
                      })
                      .catch(() => null)
                : Promise.resolve(null);
            cache.set(file, p);
        }
        return cache.get(file);
    }

    const api = {
        SCHEMA,
        CAN,
        RATINGS,
        WORDS,
        normalize,
        placementFor,
        spotAtPlacement,
        intentOf,
        fileFor,
        load,
        _resetCache: () => cache.clear(),
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_WORLD_SPOTS = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
