/**
 * MotionClipMap — resolves motion command names ("wave", "sit", "handshake")
 * to real animation files and plays them through NEXUS_CLIP_LOADER.
 *
 * Every entry has a fallback chain, so the system degrades gracefully:
 * the app works out-of-the-box with the assets already shipped in
 * `vendor/animations/` and `addons/vrma-actions|dance/`, and automatically
 * upgrades when the optional pack in `addons/vrma-locomotion/` is generated
 * with `scripts/retarget_mixamo_to_vrma.py`.
 *
 * Additive module: does not modify any existing code.
 *
 * @module MotionClipMap
 */

const MotionClipMap = (() => {
    'use strict';

    const PACK = 'addons/vrma-locomotion/'; // optional generated pack
    const ACT = 'addons/vrma-actions/'; // ships with the repo
    const DANCE = 'addons/vrma-dance/'; // ships with the repo
    const VEND = 'vendor/animations/'; // ships with the repo

    // The eight Mixamo-origin clips that used to be here are excluded: every
    // one of them drives the upper legs through ~180 degrees, because Mixamo's
    // bone rest orientation differs from VRM's and the raw quaternions are
    // applied to the normalized rig as-is. On a VRM the legs invert and splay.
    // addons/vrma-dance/README.md flagged them "NOT production-ready" from the
    // start; the converted dance_* clips below cover the same ground correctly.
    // The files are still on disk — restore them here if the retarget ever
    // grows rest-pose conjugation for non-conformant sources.
    const DANCE_CLIPS = [
        DANCE + 'dance_gangnam_style.vrma',
        DANCE + 'dance_dab.vrma',
        DANCE + 'dance_northern_soul_spin.vrma',
        DANCE + 'dance_rumba.vrma',
        DANCE + 'dance_1.vrma',
        DANCE + 'dance_2.vrma',
        DANCE + 'dance_marachinostep.vrma',
    ];

    /**
     * The addons packs, which ship with the repo but have no manifest of
     * their own. Listed so the grounded index can reach every one of them —
     * two dance files were previously in no candidate list at all, so no
     * utterance could ever play them. Keep in sync when adding assets.
     */
    const ADDON_DANCE = [
        // Converted from the repo's own vendor/animations/dance BVH files with
        // the official vrm-c/bvh2vrma (MIT). Same motions, now in the format
        // that retargets to any VRM avatar — so they play with the BVH toggle
        // off, and no longer depend on the BVH pipeline at all.
        //
        // The Mixamo-origin clips (hipHopDancing, sambaDancing, dancingTwerk,
        // twistDance, sillyDancing, rumbaDancing, hipHopDance,
        // breakdanceUprock) are deliberately absent — see DANCE_CLIPS above.
        'dance_1.vrma',
        'dance_2.vrma',
        'dance_backup.vrma',
        'dance_dab.vrma',
        'dance_gangnam_style.vrma',
        'dance_headdrop.vrma',
        'dance_marachinostep.vrma',
        'dance_northern_soul_spin.vrma',
        'dance_ontop.vrma',
        'dance_pushback.vrma',
        'dance_rumba.vrma',
    ];

    const ADDON_ACTIONS = [
        'backflip.vrma',
        'bowing.vrma',
        'happyIdle.vrma',
        'jumpingJacks.vrma',
        'sadIdle.vrma',
        'shrugging.vrma',
        'singing.vrma',
        'standingClap.vrma',
        'standingGreeting.vrma',
        'talking.vrma',
        'victory.vrma',
        'victoryIdle.vrma',
        'waving.vrma',
    ];

    /**
     * name → { candidates, loop, sticky }
     *  loop   — clip loops until replaced
     *  sticky — do NOT auto-return to idle after playing (posture/state clips)
     */
    const ENTRIES = {
        // Idle is a POOL, drawn from at random, not a single clip.
        //
        // Two clips meant every return to rest looked the same, and since idle
        // is where she spends most of her time that is the animation people
        // actually watch. All six shipped neutral captures are listed, plus the
        // VRMA waiting loop — different pipeline, different feel, and it
        // retargets to any avatar including a plain GLB with no VRM humanoid.
        //
        // `curated` keeps the pool to exactly this list. Without it, resolve()
        // widens a `random` entry with the library index — and the index keys a
        // file by its basename minus the category prefix, so
        // `laying/laying_idle.bvh` is indexed under `idle`. She would lie down
        // on the floor when she was only meant to return to rest.
        //
        // `ambient` keeps a running idle from being swapped mid-loop — see the
        // idempotence guard in play(). Variety happens when she ENTERS idle,
        // not every time _scheduleIdle fires.
        idle: {
            candidates: [
                VEND + 'idle/neutral_idle.bvh',
                VEND + 'idle/neutral_idle2.bvh',
                VEND + 'idle/neutral.bvh',
                VEND + 'idle/neutral2.bvh',
                VEND + 'idle/neutral3.bvh',
                VEND + 'idle/neutral4.bvh',
                VEND + 'vrma/waiting-standard.vrma',
            ],
            loop: true,
            sticky: true,
            random: true,
            ambient: true,
            curated: true,
        },
        idle_happy: { candidates: [ACT + 'happyIdle.vrma'], loop: true, sticky: true },
        idle_sad: { candidates: [ACT + 'sadIdle.vrma'], loop: true, sticky: true },
        talking: { candidates: [ACT + 'talking.vrma'], loop: true, sticky: true },

        wave: { candidates: [ACT + 'waving.vrma', VEND + 'action/action_greeting.bvh'], loop: false },
        greeting: { candidates: [ACT + 'standingGreeting.vrma', VEND + 'action/action_greeting.bvh'], loop: false },
        bow: { candidates: [ACT + 'bowing.vrma'], loop: false },
        shrug: { candidates: [ACT + 'shrugging.vrma'], loop: false },
        clap: { candidates: [ACT + 'standingClap.vrma'], loop: false },
        victory: { candidates: [ACT + 'victory.vrma'], loop: false },
        sing: { candidates: [ACT + 'singing.vrma'], loop: true, sticky: true },
        backflip: { candidates: [ACT + 'backflip.vrma'], loop: false },
        jumping_jacks: { candidates: [ACT + 'jumpingJacks.vrma'], loop: false },

        // Posture — sit_down/stand_up come from the generated pack; the
        // shipped sit_idle/standup assets are the always-working fallback.
        //
        // sit_idle4 leads both entries. It is the only sitting capture that
        // opens ALREADY SEATED: the other three spend their first 3-6 frames
        // standing before the root drops onto the seated plane, so looping
        // them reads as a rhythmic stand/sit flicker. Root Y, frame 0 on:
        //
        //   sit_idle   11.68,  4.34, -3.00 -> -10.34   (3 standing frames)
        //   sit_idle2  11.68 ...    -1.75 ->  -4.44    (6 standing frames)
        //   sit_idle3  11.68,  6.31,  0.94 ->  -4.44   (3 standing frames)
        //   sit_idle4  -4.11 flat from frame 0          <- the clean one
        //
        // sit_idle is kept LAST. Its seated plane is -10.34, ~5.9 units below
        // its siblings, which drops the avatar through the seat — but it is a
        // manifest file and must stay reachable by name for the Animations
        // panel, so it is demoted rather than removed.
        sit: {
            // One looping state: with no real sit_down transition shipped,
            // 'sit' IS the seated loop. The old loop:false + then:'sit_idle'
            // chain replayed the SAME file from frame 0 — the visible
            // "sits down twice". A real transition clip can restore
            // loop:false + then later.
            candidates: [PACK + 'sit_down.vrma', VEND + 'sitting/sit_idle4.bvh'],
            loop: true,
            sticky: true,
        },
        sit_idle: {
            candidates: [
                VEND + 'sitting/sit_idle4.bvh',
                VEND + 'sitting/sit_idle3.bvh',
                VEND + 'sitting/sit_idle2.bvh',
                VEND + 'sitting/sit_idle.bvh',
            ],
            loop: true,
            sticky: true,
        },
        // Laying is a POSTURE, like sitting — not an idle. It was reachable
        // only by accident: "laying" fuzzy-matched laying_idle2.bvh as a
        // one-shot, and "lay"/"lie down" resolved to nothing at all.
        //
        // laying_idle leads, for the same reason sit_idle4 does. Hips as a
        // fraction of the avatar's rest height, frame 0 on:
        //
        //   laying_idle   0.129 flat, 309 frames   <- lying down, and stays
        //   laying_idle3  1.959 -> 0.129           a stand-to-lie TRANSITION;
        //                                          looping it stands her back up
        //   laying_idle2  1.075 flat, 25 frames    ABOVE standing height, and
        //                                          under a second long
        //
        // The other two are demoted rather than dropped: they are manifest
        // files and must stay reachable by name for the Animations panel.
        lay: {
            candidates: [
                VEND + 'laying/laying_idle.bvh',
                VEND + 'laying/laying_idle3.bvh',
                VEND + 'laying/laying_idle2.bvh',
            ],
            loop: true,
            sticky: true,
            curated: true,
        },
        lay_idle: {
            candidates: [
                VEND + 'laying/laying_idle.bvh',
                VEND + 'laying/laying_idle3.bvh',
                VEND + 'laying/laying_idle2.bvh',
            ],
            loop: true,
            sticky: true,
            curated: true,
        },
        stand: { candidates: [PACK + 'stand_up.vrma', VEND + 'action/action_standup.bvh'], loop: false },

        // Interaction — generated pack first, graceful procedural fallback is
        // handled by MotionIntegration when resolve() returns no playable clip.
        nod: { candidates: [PACK + 'nod.vrma'], loop: false, procedural: 'nod' },
        headshake: { candidates: [PACK + 'headshake.vrma'], loop: false, procedural: 'headshake' },
        point: { candidates: [PACK + 'point.vrma'], loop: false, procedural: 'reach' },
        offer_hand: { candidates: [PACK + 'offer_hand.vrma'], loop: true, sticky: true, procedural: 'reach' },
        high_five: {
            candidates: [PACK + 'high_five.vrma', PACK + 'offer_hand.vrma'],
            loop: true,
            sticky: true,
            procedural: 'reach_high',
        },
        handshake: { candidates: [PACK + 'handshake.vrma'], loop: false, procedural: 'shake' },
        // "raise your hand" — no clip ships for this yet, so the procedural
        // reach_high IK ramp does the work. It reads correctly with zero
        // assets, and upgrades automatically if the pack is ever generated.
        raise_hand: {
            candidates: [PACK + 'raise_hand.vrma', PACK + 'high_five.vrma'],
            loop: true,
            sticky: true,
            procedural: 'reach_high',
        },

        dance: { candidates: DANCE_CLIPS, loop: true, sticky: true, random: true },
    };

    const ALIASES = {
        hello: 'wave',
        hi: 'wave',
        greet: 'greeting',
        applaud: 'clap',
        applause: 'clap',
        sit_down: 'sit',
        // Every natural phrasing lands on the curated posture. Without these,
        // "lie down" resolved to null and "lay down" to the action_laydown
        // transition played as a one-shot.
        lie: 'lay',
        lie_down: 'lay',
        lay_down: 'lay',
        laydown: 'lay',
        laying: 'lay',
        lying: 'lay',
        lying_down: 'lay',
        laying_down: 'lay',
        stand_up: 'stand',
        get_up: 'stand',
        shake_hands: 'handshake',
        highfive: 'high_five',
        no: 'headshake',
        yes: 'nod',
        celebrate: 'victory',
    };

    /** Paths that failed to load once are skipped next time (missing pack). */
    const _unavailable = Object.create(null);

    function _loader() {
        return typeof window !== 'undefined' ? window.NEXUS_CLIP_LOADER : null;
    }

    /**
     * Resolve a command name to its entry.
     * @param {string} name
     * @returns {Object|null}
     */
    // ── Grounded selection (B5) ─────────────────────────────────────────
    //
    // The curated ENTRIES table covers ~20 names while the shipped library
    // holds 113 manifest files plus the addons packs. Everything below makes
    // the rest reachable, so "twerk" or "gangnam style" resolve instead of
    // silently doing nothing.

    /** Test seam: inject a manifest instead of reading the clip loader. */
    let _manifestOverride = null;
    function _setManifest(m) {
        _manifestOverride = m || null;
        _index = null; // rebuild lazily
    }

    function _manifest() {
        if (_manifestOverride) return _manifestOverride;
        if (typeof window === 'undefined') return null;
        const loader = window.NEXUS_CLIP_LOADER;
        return loader && loader.getManifest ? loader.getManifest() : null;
    }

    // ── Library-only mode (Settings → "Built-in animations only") ───────
    //
    // The Animations panel plays manifest files; the addon VRMA packs ship
    // with the repo in the avatar's native format. Together they are the set
    // the user has already SEEN working on the current character. When the
    // toggle is on (the default), motion commands are restricted to exactly
    // that set: no optional generated pack (PACK — usually absent, so every
    // attempt is a 404 before the fallback), and no categories the manifest
    // itself flags `experimental: true` (BVH retargeting — the documented
    // "strange behaviour" risk). Untick the toggle to allow everything.
    let _libraryOnlyOverride = null; // test seam
    function _setLibraryOnly(v) {
        _libraryOnlyOverride = v == null ? null : !!v;
    }

    // ── Animation-format policy (Settings → "BVH animations") ───────────
    //
    // Defaults to ON: the BVH retarget pipeline is fixed (it targets the
    // normalized rig, no longer bakes the avatar's live pose into every frame,
    // and applies the VRM 0.x flip — see docs/animation-system.md), so its
    // ~110 clips are part of the library like any other. The toggle stays as a
    // way to restrict playback to VRM Animation clips only, which is useful
    // when isolating whether a problem is format-specific.
    let _bvhAllowedOverride = null; // test seam
    function _setBvhAllowed(v) {
        _bvhAllowedOverride = v == null ? null : !!v;
    }
    function _bvhAllowed() {
        if (_bvhAllowedOverride != null) return _bvhAllowedOverride;
        try {
            if (typeof localStorage !== 'undefined') return localStorage.getItem('npc_bvh_anims') !== 'false';
        } catch (_e) {
            /* storage unavailable */
        }
        return true;
    }

    /**
     * Does the format policy apply at all?
     *
     * "VRMA retargets cleanly to any avatar" holds only where there is a VRM
     * humanoid to retarget ONTO. On a plain GLB the loader reports "No VRM
     * humanoid — cannot retarget" and every .vrma fails, so switching BVH off
     * would leave nothing that can play: measured on such an avatar, dance
     * dropped from 19 candidates to 8 unplayable ones, and idle / sit_idle /
     * sit / stand dropped to zero candidates each.
     *
     * Turning the toggle off is a preference; ending up with a mute avatar is
     * not what anyone means by it. So the policy applies only where VRMA is
     * genuinely an option.
     *
     * @private
     */
    function _formatPolicyApplies() {
        return _hasVrmHumanoid();
    }

    function _libraryOnly() {
        if (_libraryOnlyOverride != null) return _libraryOnlyOverride;
        try {
            if (typeof localStorage !== 'undefined') {
                return localStorage.getItem('npc_library_anims') !== 'false';
            }
        } catch (_e) {
            /* storage unavailable */
        }
        return true;
    }

    let _debugOverride = null; // test seam
    function _setDebug(v) {
        _debugOverride = v == null ? null : !!v;
    }
    function _debug() {
        if (_debugOverride != null) return _debugOverride;
        try {
            if (typeof localStorage !== 'undefined') return localStorage.getItem('npc_debug') === 'true';
        } catch (_e) {
            /* storage unavailable */
        }
        return false;
    }
    /** Verbose trace, gated by the "Verbose motion logs" setting. @private */
    function _trace() {
        if (_debug() && typeof console !== 'undefined')
            console.log.apply(console, ['[MotionClipMap]'].concat([].slice.call(arguments)));
    }

    /** Manifest paths from NON-experimental categories. @private */
    function _trustedManifestIds() {
        const ids = Object.create(null);
        const man = _manifest();
        if (man && man.categories) {
            for (const cat of Object.keys(man.categories)) {
                const entry = man.categories[cat];
                if (!entry || entry.experimental === true) continue;
                const files = entry.files || [];
                for (const file of files) ids[VEND + file] = 1;
            }
        }
        return ids;
    }

    /**
     * Which pipeline a clip path goes through. Reported on every play so a
     * misbehaving animation can be attributed to a format without reading the
     * source: BVH is retargeted at load time, VRMA is authored against the
     * normalized rig, and the two fail in completely different ways.
     *
     * @param {string} path
     * @returns {string} 'VRMA' | 'BVH' | 'unknown'
     * @private
     */
    function _formatOf(path) {
        const p = String(path || '').toLowerCase();
        if (p.endsWith('.vrma')) return 'VRMA';
        if (p.endsWith('.bvh')) return 'BVH';
        return 'unknown';
    }

    /** Compact "2 VRMA, 3 BVH" summary of a candidate list. @private */
    function _formatBreakdown(paths) {
        let v = 0,
            b = 0,
            o = 0;
        for (const p of paths || []) {
            const f = _formatOf(p);
            if (f === 'VRMA') v++;
            else if (f === 'BVH') b++;
            else o++;
        }
        const parts = [];
        if (v) parts.push(v + ' VRMA');
        if (b) parts.push(b + ' BVH');
        if (o) parts.push(o + ' other');
        return parts.join(', ') || 'none';
    }

    /** In library mode, keep only paths from the proven set. @private */
    function _restrict(paths) {
        // Format policy first, in EVERY mode. BVH is on by default; switching
        // it off leaves only VRMA — but only where a VRM humanoid exists for
        // those to retarget onto (see _formatPolicyApplies).
        const dropBvh = _formatPolicyApplies() && !_bvhAllowed();
        const byFormat = dropBvh ? paths.filter((p) => !/\.bvh$/i.test(p)) : paths;
        if (!_libraryOnly()) return byFormat;
        const trusted = _trustedManifestIds();
        return byFormat.filter(
            (p) =>
                p.indexOf(ACT) === 0 ||
                p.indexOf(DANCE) === 0 ||
                // The manifest flags its dance category `experimental`, which
                // dropped every shipped dance BVH from library mode and left
                // "dance" with nothing but VRMA. On a GLB avatar (no VRM
                // humanoid) those cannot retarget, so the toggle that promises
                // "only animations known to work" produced a silent no-op for
                // the single most-requested gesture. These files ship with the
                // repo and are exactly what the Animations panel plays.
                p.indexOf(VEND + 'dance/') === 0 ||
                trusted[p] === 1
        );
    }

    /**
     * Is a VRM humanoid available to retarget onto?
     *
     * VRMA clips are authored against the VRM normalized rig; with a plain GLB
     * avatar the loader reports "No VRM humanoid — cannot retarget" and every
     * VRMA candidate fails. Knowing this up front lets play() skip them and go
     * straight to the BVH that will actually work, instead of burning the whole
     * candidate list and reporting load_failed.
     *
     * @private
     * @returns {boolean}
     */
    function _hasVrmHumanoid() {
        try {
            const st = typeof window !== 'undefined' && window.__CLIP_ANIM_STATE__;
            if (st && st.avatarVRM && st.avatarVRM.humanoid) return true;
            const v = typeof window !== 'undefined' && window.NEXUS_VIEWER;
            return !!(v && v.avatarManager && v.avatarManager._currentVRM && v.avatarManager._currentVRM.humanoid);
        } catch (_e) {
            return false;
        }
    }

    /**
     * Canonical index key. camelCase is split FIRST, so "hipHopDance"
     * becomes hip_hop_dance and a request for "hip hop" matches it on real
     * tokens instead of having to guess at the substring "hiphopdance".
     * @private
     */
    function _norm(s) {
        return String(s || '')
            .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
            .toLowerCase()
            .replace(/[\s\-.]+/g, '_')
            .replace(/[^a-z0-9_]/g, '')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '');
    }

    /** name → [paths]; built once from the manifest. @private */
    let _index = null;

    /**
     * Names a manifest file should answer to.
     *
     * "dance/dance_gangnam_style.bvh" is reachable as its own basename, as
     * the basename minus its category prefix, and — with a trailing digit
     * stripped — as the group its variants share, so "admiration" naturally
     * covers admiration2 and admiration3.
     * @private
     */
    function _keysFor(category, file) {
        const base = _norm(
            String(file)
                .split('/')
                .pop()
                .replace(/\.(bvh|vrma|fbx|glb)$/i, '')
        );
        const keys = [base];
        const prefix = _norm(category) + '_';
        if (base.indexOf(prefix) === 0 && base.length > prefix.length) keys.push(base.slice(prefix.length));
        for (const k of keys.slice()) {
            const grouped = k.replace(/_?\d+$/, '');
            if (grouped && grouped !== k) keys.push(grouped);
        }
        return keys.filter(Boolean);
    }

    function _buildIndex() {
        const idx = Object.create(null);
        const add = (key, path) => {
            if (!key) return;
            if (!idx[key]) idx[key] = [];
            if (idx[key].indexOf(path) === -1) idx[key].push(path);
        };

        const man = _manifest();
        if (man && man.categories) {
            for (const cat of Object.keys(man.categories)) {
                const files = (man.categories[cat] && man.categories[cat].files) || [];
                for (const file of files) {
                    const path = VEND + file;
                    for (const key of _keysFor(cat, file)) add(key, path);
                    add(_norm(cat), path); // the category name itself
                }
            }
        }

        // The addons packs ship with the repo but are NOT in the manifest, so
        // they have to be declared here or they stay unreachable — which is
        // exactly how dancingTwerk and hipHopDance ended up invisible.
        for (const file of ADDON_DANCE) {
            const path = DANCE + file;
            for (const key of _keysFor('dance', file)) add(key, path);
            add('dance', path);
        }
        for (const file of ADDON_ACTIONS) {
            const path = ACT + file;
            for (const key of _keysFor('action', file)) add(key, path);
        }

        _index = idx;
        return idx;
    }

    function _idx() {
        return _index || _buildIndex();
    }

    /** Shuffle bags per name, so repeats do not come back-to-back. @private */
    const _bags = Object.create(null);
    function _drawFrom(key, paths) {
        if (paths.length === 1) return paths.slice();
        let bag = _bags[key];
        if (!bag || !bag.length) {
            bag = paths.slice();
            for (let i = bag.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                const t = bag[i];
                bag[i] = bag[j];
                bag[j] = t;
            }
            _bags[key] = bag;
        }
        const pick = bag.pop();
        // The pick first, then the rest as fallbacks if it fails to load.
        return [pick].concat(paths.filter((p) => p !== pick));
    }

    /**
     * Token-overlap match, for when the model is close but not exact:
     * "hip hop" → hipHopDancing, "northern soul" → dance_northern_soul_spin.
     * @private
     */
    function _fuzzy(key) {
        const idx = _idx();
        const wanted = key.split('_').filter((t) => t.length > 2);
        if (!wanted.length) return null;

        let best = null;
        let bestScore = 0;
        for (const candidate of Object.keys(idx)) {
            const tokens = candidate.split('_');
            let score = 0;
            for (const w of wanted) {
                if (tokens.indexOf(w) !== -1) score += 2;
                else if (candidate.indexOf(w) !== -1) score += 1;
            }
            if (score < 2) continue; // needs real evidence, not one weak hit
            // Rank by tightness so "dance" does not beat "twerk", but keep the
            // THRESHOLD on the raw score — penalising length then testing the
            // penalised value rejects good matches that are merely wordy.
            const ranked = score - Math.abs(tokens.length - wanted.length) * 0.1;
            if (ranked > bestScore) {
                bestScore = ranked;
                best = candidate;
            }
        }
        return best;
    }

    /**
     * Resolve a command name to a playable entry.
     *
     * Ladder: exact → alias → curated-with-library → manifest name → fuzzy.
     * Returns null only when nothing in the shipped library is even close,
     * and play() reports that rather than doing nothing.
     *
     * @param {string} name
     * @returns {Object|null}
     */
    function resolve(name) {
        const key = String(name || '')
            .toLowerCase()
            .replace(/[\s-]+/g, '_');

        const direct = ENTRIES[key] || ENTRIES[ALIASES[key]] || null;
        if (direct) {
            // A curated entry whose name also names a library category draws
            // from the whole library, not just its hand-written candidates:
            // "dance" reaches all 19 dances rather than the same six.
            const idx = _idx();
            const libraryKey = ENTRIES[key] ? key : ALIASES[key];
            // ...unless the entry says its pool is CURATED. The index keys a
            // file under its basename minus the category prefix, so
            // `laying/laying_idle.bvh` is indexed as `idle` — and widening
            // "idle" with the library meant she could lie down on the floor
            // when she was only meant to return to rest. An entry that
            // enumerates exactly what belongs in its pool opts out of the
            // merge; "dance", which genuinely wants every dance in the
            // library, does not.
            const extra = direct.curated ? [] : idx[libraryKey] || [];
            // The draw and the widening are separate decisions. A curated pool
            // still shuffles — it just shuffles its own list. Gating the draw on
            // `extra` (as this once did) silently turned "idle" back into a
            // fixed clip the moment it opted out of the merge.
            if (direct.random && (direct.candidates.length > 1 || extra.length)) {
                const pool = _restrict(
                    direct.candidates.concat(extra.filter((p) => direct.candidates.indexOf(p) === -1))
                );
                if (pool.length) {
                    return Object.assign({}, direct, { candidates: _drawFrom(libraryKey, pool) });
                }
                return Object.assign({}, direct, { candidates: [] });
            }
            const kept = _restrict(direct.candidates);
            if (kept.length === direct.candidates.length) return direct;
            return Object.assign({}, direct, { candidates: kept });
        }

        // Normalize from the ORIGINAL name, not the lowercased key: the
        // camelCase boundaries are the useful part and `key` has lost them.
        const idx = _idx();
        const normKey = _norm(name);
        const hit = _restrict(idx[key] || idx[normKey] || []);
        if (hit.length) {
            return { candidates: _drawFrom(key, hit), loop: false, source: 'manifest', name: key };
        }

        const near = _fuzzy(normKey);
        if (near) {
            const pool = _restrict(idx[near]);
            if (pool.length) {
                return { candidates: _drawFrom(near, pool), loop: false, source: 'fuzzy', name: near };
            }
        }

        return null;
    }

    /**
     * Category summary for the prompt: names the model can ask for by group,
     * with examples. Far cheaper than listing every file (~150 tokens vs
     * ~800), and models choose better from a taxonomy than a flat list.
     *
     * @returns {string}
     */
    function catalogLine() {
        const man = _manifest();
        if (!man || !man.categories) return '';
        const parts = [];
        const bvhOk = _bvhAllowed() || !_formatPolicyApplies();
        for (const cat of Object.keys(man.categories)) {
            let files = (man.categories[cat] && man.categories[cat].files) || [];
            if (!bvhOk) files = files.filter((f) => !/\.bvh$/i.test(f));
            if (!files.length) continue;
            const examples = files
                .slice(0, 3)
                .map((f) =>
                    _norm(
                        f
                            .split('/')
                            .pop()
                            .replace(/\.(bvh|vrma)$/i, '')
                    )
                )
                .join(', ');
            parts.push(cat + ' (' + files.length + '): ' + examples);
        }
        return parts.join(' | ');
    }

    /**
     * Play the best available clip for a command name.
     *
     * @param {string} name
     * @param {Object} [opts] - { fadeIn, fadeOut }
     * @returns {Promise<{ok:boolean, duration:number, loop:boolean, sticky:boolean, then:(string|null), procedural:(string|null)}>}
     */
    /**
     * The result an idempotent no-op reports: the state is already running, so
     * the mixer was not touched. `already` lets callers tell this apart from a
     * fresh start — tests assert on it, and the trace log reads better.
     *
     * @private
     */
    function _alreadyPlaying(path, entry) {
        return {
            ok: true,
            duration: 0,
            loop: true,
            sticky: !!(entry && entry.sticky),
            then: null,
            resolved: path
                .split('/')
                .pop()
                .replace(/\.(bvh|vrma)$/i, ''),
            procedural: null,
            already: true,
        };
    }

    async function play(name, opts) {
        const entry = resolve(name);
        const fail = {
            ok: false,
            duration: 0,
            loop: false,
            sticky: false,
            then: null,
            procedural: entry ? entry.procedural || null : null,
            // B5: a miss is REPORTED, never silent. Before this, an unknown
            // name returned quietly and playAnimation fell through every
            // branch — the chat said "watch this!" while the avatar stood
            // still, with nothing in the console to explain it.
            reason: entry ? null : 'unknown_clip',
            name: String(name || ''),
        };
        const loader = _loader();
        if (!entry) {
            if (typeof console !== 'undefined' && console.warn) {
                console.warn('[MotionClipMap] No clip for "' + name + '" — nothing in the library matched.');
            }
            return fail;
        }
        if (!loader) return Object.assign(fail, { reason: 'loader_unavailable' });

        let candidates = entry.candidates.slice();

        // Without a VRM humanoid, every .vrma is dead weight — try the
        // retargetable BVH first rather than failing the whole list. Kept as a
        // reorder, not a filter: if a VRM loads later the clips are still there.
        if (!_hasVrmHumanoid()) {
            const vrma = candidates.filter((p) => /\.vrma$/i.test(p));
            const rest = candidates.filter((p) => !/\.vrma$/i.test(p));
            if (rest.length) candidates = rest.concat(vrma);
        }

        if (entry.random && candidates.length > 1) {
            candidates = [candidates[Math.floor(Math.random() * candidates.length)]].concat(candidates);
        }

        _trace(
            'play "' + name + '"',
            'mode=' + (_libraryOnly() ? 'library' : 'advanced'),
            'source=' + (entry.source || 'entry'),
            'candidates=' + candidates.length + ' (' + _formatBreakdown(candidates) + ')',
            candidates.slice(0, 3)
        );

        // AAA idempotence, pool-wide: for an AMBIENT looping state, any member
        // of the pool counts as "already in this state".
        //
        // idle is a `random` entry, so every resolve() draws a different clip.
        // Without this, each _scheduleIdle — after a gesture, after speaking,
        // after the settle — would swap her to a different idle mid-loop, which
        // reads as a twitch. Variety belongs at state ENTRY, not on every tick.
        //
        // Only ambient states opt in. A re-requested `dance` still draws a new
        // one, because that is an explicit ask rather than an automatic
        // reschedule.
        if (entry.ambient && entry.loop) {
            const l0 = _loader();
            const st0 = l0 && l0.getCurrentPlaybackState ? l0.getCurrentPlaybackState() : null;
            if (st0 && st0.isPlaying && candidates.indexOf(st0.clip) !== -1) {
                _trace('already in ambient state', st0.clip, '— idempotent no-op');
                return _alreadyPlaying(st0.clip, entry);
            }
        }

        const tried = [];
        for (let i = 0; i < candidates.length; i++) {
            const path = candidates[i];
            if (_unavailable[path]) continue;
            // AAA idempotence: re-requesting the clip ALREADY playing with
            // the same loop intent is a no-op, never a restart (this is what
            // made sit_idle replay and dances restart mid-song).
            {
                const l2 = _loader();
                const st = l2 && l2.getCurrentPlaybackState ? l2.getCurrentPlaybackState() : null;
                if (st && st.isPlaying && st.clip === path && entry.loop) {
                    _trace('already playing', path, '— idempotent no-op');
                    return _alreadyPlaying(path, entry);
                }
            }
            tried.push(path);
            _trace('trying', path);
            try {
                const clip = await loader.loadClip(path);
                if (!clip) {
                    _unavailable[path] = true;
                    if (typeof console !== 'undefined' && console.warn) {
                        console.warn(
                            '[MotionClipMap] ' + _formatOf(path) + ' clip failed to load (skipped from now on): ' + path
                        );
                    }
                    continue;
                }
                // One call shape for both modes. playClip(path, loopOrOptions)
                // accepts either and normalises them into the same opts object
                // (ClipAnimationLoader.js:110-115), so a boolean is NOT a
                // different code path from the Animations panel — it just
                // throws away fadeIn/fadeOut and re-derives the same defaults.
                const ok = await loader.playClip(path, {
                    loop: !!entry.loop,
                    fadeIn: (opts && opts.fadeIn) != null ? opts.fadeIn : 0.3,
                    fadeOut: (opts && opts.fadeOut) != null ? opts.fadeOut : 0.25,
                });
                if (ok) {
                    // Always logged, not gated behind the verbose setting:
                    // knowing WHICH format played is the first question asked
                    // of any animation bug, and it is one line per gesture.
                    if (typeof console !== 'undefined' && console.log) {
                        console.log(
                            '[Motion] "' +
                                name +
                                '" → ' +
                                _formatOf(path) +
                                '  ' +
                                path +
                                '  (' +
                                (clip.duration || 0).toFixed(2) +
                                's' +
                                (entry.loop ? ', loop' : '') +
                                (i > 0 ? ', candidate ' + (i + 1) + '/' + candidates.length : '') +
                                ')'
                        );
                    }
                    return {
                        ok: true,
                        format: _formatOf(path),
                        path: path,
                        duration: clip.duration || 0,
                        loop: !!entry.loop,
                        sticky: !!entry.sticky,
                        then: entry.then || null,
                        procedural: null,
                    };
                }
            } catch (err) {
                _unavailable[path] = true;
                if (typeof console !== 'undefined' && console.warn) {
                    console.warn(
                        '[MotionClipMap] ' + _formatOf(path) + ' clip failed to load (skipped from now on): ' + path,
                        err && err.message
                    );
                }
            }
        }
        // Every candidate existed in the index but none would load. Say so
        // ONCE, loudly, with the exact list — this was the silent branch
        // behind "I ask dance and nothing plays".
        if (tried.length && typeof console !== 'undefined' && console.warn) {
            console.warn(
                '[MotionClipMap] "' +
                    name +
                    '": ALL ' +
                    tried.length +
                    ' candidates failed to load (' +
                    _formatBreakdown(tried) +
                    ') — ' +
                    tried.join(', ') +
                    '. If these files exist in the repo, the server is returning HTML for them ' +
                    '(missing from the deployment, or a catch-all rewrite intercepting /addons and ' +
                    '/assets — see vercel.json). Run NEXUS_MOTION.debugMotion() for a live probe.'
            );
        }
        return Object.assign(fail, { reason: fail.reason || 'load_failed', tried: tried });
    }

    /** Stop the current clip (crossfade handled by the loader). */
    function stop(opts) {
        const loader = _loader();
        if (loader && typeof loader.stopClip === 'function') loader.stopClip(opts || { fadeOut: 0.3 });
    }

    /** Paths that failed to load this session (for diagnostics). */
    /**
     * Forget the "this path failed, skip it" cache.
     *
     * The skip list is what stops a missing pack from costing an HTTP round
     * trip per gesture, but it also makes a fixed deployment look broken until
     * reload — and makes test ordering matter. Exposed so debugMotion() and
     * tests can retry from a clean slate.
     */
    function resetUnavailable() {
        for (const k of Object.keys(_unavailable)) delete _unavailable[k];
    }

    function getUnavailable() {
        return Object.keys(_unavailable);
    }

    /**
     * Representative asset URLs for a live deployment probe — one addon
     * dance, one addon action, one manifest file. debugMotion() fetches
     * these and reports status + content-type, which separates "file missing
     * or rewritten to HTML" from "clip loads but fails to retarget" in one
     * console line.
     */
    function probeCandidates() {
        const out = [DANCE + ADDON_DANCE[0], ACT + ADDON_ACTIONS[0]];
        const man = _manifest();
        if (man && man.categories) {
            for (const cat of Object.keys(man.categories)) {
                const files = (man.categories[cat] && man.categories[cat].files) || [];
                if (files.length) {
                    out.push(VEND + files[0]);
                    break;
                }
            }
        }
        return out;
    }

    /** Names to advertise to the LLM in the motion contract. */
    function availableNames() {
        // `sit_idle` / `lay_idle` are what _scheduleIdle re-issues to hold a
        // posture; the model asks for `sit` or `lay` and the posture handler
        // does the rest. Matching the `_idle` suffix rather than naming each
        // one keeps a future posture from leaking into the vocabulary the way
        // `lay_idle` just did.
        return Object.keys(ENTRIES).filter((n) => n.indexOf('idle') !== 0 && !/_idle$/.test(n));
    }

    return {
        resolve,
        play,
        stop,
        availableNames,
        catalogLine,
        _setManifest,
        _setLibraryOnly,
        _setBvhAllowed,
        _setDebug,
        getUnavailable,
        resetUnavailable,
        probeCandidates,
        _keysFor,
        ADDON_DANCE,
        ADDON_ACTIONS,
        ENTRIES,
        ALIASES,
    };
})();

if (typeof window !== 'undefined') window.NEXUS_MOTION_CLIPS = MotionClipMap;
if (typeof module !== 'undefined' && module.exports) module.exports = MotionClipMap;
