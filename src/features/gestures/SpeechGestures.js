/**
 * SG1. Co-speech gestures: her hands move with what she says, the way a person's do.
 *
 * ## The failure this replaces
 *
 * While she spoke, ProceduralAnimator's talk mode (`AnimationPresets.TALK_STYLES`) moved her
 * arms on continuous sine waves: the same swing at the same frequency for the whole reply,
 * whatever the words were. People do not gesture like that. Speech gestures are discrete
 * strokes (prepare, stroke, hold, retract) timed so the stroke lands on the word it goes with,
 * with the hands resting in between. A metronome reads as a robot within seconds, and in a
 * headset at arm's length it reads as one immediately.
 *
 * ## What this does
 *
 * `plan(text, …)` reads the reply she is about to speak and returns a short list of gestures,
 * each anchored to a word: an open palm towards "you", a hand to her chest on "I feel", a shrug
 * on "maybe", open arms on "everything", a hand to her chin on "I think", palms up at the end of
 * a question, a small wave on "hi", and plain beat strokes on sentence openings and stressed
 * words. It is rule-based on purpose — no model, no download, no server — so it runs the same
 * offline, on a phone and on a Quest.
 *
 * `start(text, rate)` plans and starts the clock (called from `NEXUS_LIP_SYNC.start`, on the
 * same 15 characters per second), `stop()` lets every gesture retract, and `sample(nowSec)`
 * returns the additive Euler offsets for this frame. `createLayer(THREE)` puts them on her bones
 * without accumulating; ProceduralAnimator runs it after its own frame, in talk mode only, and
 * releases it in Pose Studio, in pose mode (the VR puppet) and while a clip owns the bones.
 *
 * ## Budgets per device
 *
 * Desktop, phone and headset get different budgets (`PROFILES`): fewer, smaller, longer-spaced
 * strokes on a phone and in VR, where the screen is small or she is close, and no finger bones
 * there. `sample` allocates nothing per frame: it fills one reused object.
 *
 * ## Self-touch
 *
 * The natural, non-sexual adaptors people make while talking — a hand to the chin when
 * thinking, to the chest when sincere, tucking hair when shy — are gestures here like any other.
 * Nothing in this module is sexual, and nothing should be added to it that is.
 *
 * Words resolve against one table per language, never a mixed one (as for NL motion).
 *
 * Exposes: window.NEXUS_SPEECH_GESTURES
 */
(function (global) {
    'use strict';

    /** Characters per second at rate 1: the pace LipSyncEngine uses, so hands and mouth agree. */
    const CHARS_PER_SEC = 15;

    /**
     * Gesture budgets. `minGap` is the least time between two stroke peaks, `perSentence` the most
     * gestures in one sentence, `gain` scales every angle, `fingers` whether finger bones move.
     */
    const PROFILES = {
        desktop: { minGap: 1.1, perSentence: 3, gain: 1.0, fingers: true },
        mobile: { minGap: 1.6, perSentence: 2, gain: 0.9, fingers: false },
        vr: { minGap: 1.8, perSentence: 2, gain: 0.8, fingers: false },
    };

    /**
     * SG5. The poses below were found by tools/qa/gesture-tune.mjs, not written by hand: the first,
     * hand-written ones stopped low in front of her (a "wave" 29 cm below her shoulder) and two of
     * them crossed her front into her body on a phone. The tuner searched the angles against
     * tools/qa/GestureBodyCheck.js on both hands — reach the gesture's target, never a hand or
     * forearm inside her torso, never across her midline — and audits/gestures/run.mjs checks the
     * result in the renderer. Re-tune rather than hand-edit.
     *
     * Each gesture is its peak pose for the RIGHT side, as additive Euler offsets (radians) on her
     * raw bones, applied on top of her talking stance. `mirror()` gives the left side (x kept,
     * y and z negated), and the tuner scores both. Timings in seconds: prep (rise), hold
     * (at peak), rel (return). `osc` adds a small oscillation during the hold (a wave, a sweep).
     */
    const GESTURES = {
        beat: {
            prep: 0.16,
            hold: 0.08,
            rel: 0.32,
            pose: { rightUpperArm: [-0.12, 0.19, -0.16], rightLowerArm: [0, 1.08, -0.1], rightHand: [-0.01, 0, 0] },
        },
        palmToYou: {
            prep: 0.25,
            hold: 0.35,
            rel: 0.4,
            pose: { rightUpperArm: [-0.03, 0.9, -0.08], rightLowerArm: [0, 0.37, -0.03], rightHand: [0.19, 0, 0] },
        },
        handOnChest: {
            prep: 0.3,
            hold: 0.5,
            rel: 0.45,
            pose: {
                rightUpperArm: [-0.15, 0.24, -0.08],
                rightLowerArm: [0, 2.17, -0.02],
                rightHand: [0, 0, 0],
                head: [0.04, 0, 0],
            },
        },
        chinTouch: {
            prep: 0.32,
            hold: 0.55,
            rel: 0.45,
            pose: {
                rightUpperArm: [-0.1, 0.59, -0.1],
                rightLowerArm: [0, 2.07, -0.02],
                rightHand: [0.01, 0, 0],
                head: [0.06, 0, 0.04],
            },
        },
        hairTuck: {
            prep: 0.35,
            hold: 0.3,
            rel: 0.5,
            pose: {
                rightUpperArm: [0.48, 1.1, 0.57],
                rightLowerArm: [0, 2.12, 0.27],
                rightHand: [-0.01, 0, 0],
                head: [0, 0, -0.07],
            },
        },
        shrug: {
            both: true,
            prep: 0.22,
            hold: 0.3,
            rel: 0.4,
            pose: {
                rightShoulder: [0, 0, -0.1],
                rightUpperArm: [0.04, 0.08, 0.05],
                rightLowerArm: [0, 1.04, 0.12],
                rightHand: [-0.01, 0, 0],
                head: [0, 0, 0.06],
            },
        },
        openArms: {
            both: true,
            prep: 0.3,
            hold: 0.35,
            rel: 0.5,
            pose: { rightUpperArm: [0.12, 0.35, 0.44], rightLowerArm: [0, 0.45, 0.34], rightHand: [0, 0, 0] },
        },
        palmsUp: {
            both: true,
            prep: 0.25,
            hold: 0.3,
            rel: 0.4,
            pose: {
                rightUpperArm: [-0.03, 0.31, -0.05],
                rightLowerArm: [0, 0.96, 0],
                rightHand: [0, 0, 0],
                head: [0, 0, 0.05],
            },
        },
        negate: {
            prep: 0.2,
            hold: 0.3,
            rel: 0.35,
            pose: { rightUpperArm: [-0.05, 0.53, -0.14], rightLowerArm: [0, 0.85, -0.07], rightHand: [0, 0, 0] },
            osc: { bone: 'rightHand', axis: 1, amp: 0.25, freq: 9 },
        },
        wave: {
            prep: 0.3,
            hold: 0.7,
            rel: 0.45,
            pose: { rightUpperArm: [0.37, 0.79, 0.5], rightLowerArm: [0, 1.62, 0.31], rightHand: [0, 0, 0] },
            osc: { bone: 'rightLowerArm', axis: 2, amp: 0.22, freq: 9 },
        },
    };

    /** SG5. Gestures that must land somewhere on her or by her: never scaled. */
    const TARGETED = new Set(['wave', 'handOnChest', 'chinTouch', 'hairTuck']);

    /** The mirror of a right-side pose for the left: x kept, y and z negated, names swapped. */
    function mirror(pose) {
        const out = {};
        for (const bone of Object.keys(pose)) {
            const v = pose[bone];
            const left = bone.startsWith('right') ? 'left' + bone.slice(5) : null;
            if (left) out[left] = [v[0], -v[1], -v[2]];
            else out[bone] = v.slice(); // head, chest: shared
        }
        return out;
    }

    /** Word tables, one per language. Keys are lower-case words or short phrases. */
    const LEXICON = {
        en: {
            wave: ['hi', 'hello', 'hey', 'bye', 'goodbye'],
            handOnChest: ['i feel', 'my heart', 'honestly', 'i love', 'i care', 'myself'],
            chinTouch: ['i think', 'i wonder', 'hmm', 'let me think', 'interesting'],
            palmToYou: ['you', 'your', "you're", 'yours'],
            shrug: ['maybe', 'perhaps', 'not sure', "don't know", 'who knows', 'i guess'],
            openArms: ['everything', 'everyone', 'all of', 'so much', 'whole', 'welcome'],
            negate: ['no', 'not', 'never', "don't", "can't", "won't"],
            hairTuck: ['shy', 'blush', 'embarrass', 'oops', 'sorry'],
        },
        it: {
            wave: ['ciao', 'salve', 'ehi', 'arrivederci'],
            handOnChest: ['mi sento', 'il mio cuore', 'sinceramente', 'ti voglio bene', 'io stessa'],
            chinTouch: ['penso', 'credo', 'mi chiedo', 'vediamo', 'interessante'],
            palmToYou: ['tu', 'ti', 'te', 'tuo', 'tua', 'voi'],
            shrug: ['forse', 'non so', 'chissà', 'magari'],
            openArms: ['tutto', 'tutti', 'tantissimo', 'benvenuto', 'benvenuta'],
            negate: ['no', 'non', 'mai', 'nessuno'],
            hairTuck: ['timida', 'arrossire', 'imbarazz', 'scusa', 'ops'],
        },
    };

    /** Priority when one word matches several rules: the more meaningful gesture wins. */
    const PRIORITY = ['wave', 'handOnChest', 'chinTouch', 'shrug', 'openArms', 'hairTuck', 'negate', 'palmToYou'];

    /** Small deterministic generator, so a reply plans the same way every time (and in tests). */
    function seeded(text) {
        let h = 2166136261;
        for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
        let a = h >>> 0;
        return function () {
            a = (a + 0x6d2b79f5) >>> 0;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function languageOf(lang) {
        const code = String(lang || '')
            .slice(0, 2)
            .toLowerCase();
        return LEXICON[code] ? code : 'en';
    }

    /** The rule a phrase starting at `lower[i]` matches, word-bounded, or null. */
    function matchAt(lower, i, table) {
        if (i > 0 && /[\p{L}']/u.test(lower[i - 1])) return null;
        for (const kind of PRIORITY) {
            for (const phrase of table[kind] || []) {
                if (!lower.startsWith(phrase, i)) continue;
                const after = lower[i + phrase.length];
                const stem = kind === 'hairTuck'; // "embarrass" matches "embarrassed"
                if (!stem && after && /[\p{L}']/u.test(after)) continue;
                return kind;
            }
        }
        return null;
    }

    /**
     * The gestures for one reply. Pure: text in, a sorted list out.
     *
     * @returns {Array<{at:number,id:string,side:'right'|'left'|'both',gain:number}>}  `at` is the
     *          stroke's start in seconds from the start of speech.
     */
    function plan(text, { rate = 1, profile = 'desktop', lang = 'en' } = {}) {
        const budget = PROFILES[profile] || PROFILES.desktop;
        const source = String(text || '');
        if (!source.trim()) return [];
        const lower = source.toLowerCase();
        const table = LEXICON[languageOf(lang)];
        const cps = CHARS_PER_SEC * (Number(rate) > 0 ? Number(rate) : 1);
        const random = seeded(source);
        const out = [];
        let lastPeak = -Infinity;
        let side = random() < 0.5 ? 'right' : 'left';

        // Sentences, with their character offsets.
        const sentences = [];
        const re = /[^.!?…]+[.!?…]*/g;
        let m;
        while ((m = re.exec(source))) {
            if (m[0].trim()) sentences.push({ start: m.index, text: m[0] });
        }

        function add(id, charIndex, gainMul, forceSide) {
            const g = GESTURES[id];
            const peak = charIndex / cps; // the stroke peaks as the word is said
            if (peak - lastPeak < budget.minGap) return false;
            const at = Math.max(0, peak - g.prep);
            const s = g.both ? 'both' : forceSide || side;
            // SG5. A gesture with a place to reach (her chin, her chest, above her shoulder) plays at
            // full size always: scaled up by an exclamation it overshot ("Hello!" waved past her head),
            // scaled down on a phone or headset it fell short of her chin. Size is for the expressive
            // ones; devices still differ in how often gestures come (minGap, perSentence).
            out.push({ at, id, side: s, gain: TARGETED.has(id) ? 1 : budget.gain * gainMul });
            lastPeak = peak;
            if (!g.both && !forceSide) side = side === 'right' ? 'left' : 'right';
            return true;
        }

        for (const sentence of sentences) {
            let used = 0;
            const end = sentence.start + sentence.text.length;
            const question = /\?\s*$/.test(sentence.text);
            const exclaim = /!\s*$/.test(sentence.text);
            const emphasis = exclaim ? 1.25 : 1;

            // Meaningful words first: the first match of each kind in the sentence.
            const seen = new Set();
            for (let i = sentence.start; i < end && used < budget.perSentence; i += 1) {
                const kind = matchAt(lower, i, table);
                if (!kind || seen.has(kind)) continue;
                seen.add(kind);
                // A greeting waves only at the start of what she says, never mid-reply.
                if (kind === 'wave' && sentence.start !== sentences[0].start) continue;
                // Self-adaptors and greetings use her right hand: the hand people reach for first.
                const self = kind === 'handOnChest' || kind === 'chinTouch' || kind === 'hairTuck' || kind === 'wave';
                if (add(kind, i, emphasis, self ? 'right' : null)) used += 1;
            }
            // A question ends with open palms.
            if (question && used < budget.perSentence && add('palmsUp', Math.max(sentence.start, end - 2), 1)) {
                used += 1;
            }
            // Otherwise a beat on the sentence opening (and on a long one, a second beat).
            if (used === 0) {
                const opening = sentence.start + (sentence.text.length - sentence.text.trimStart().length);
                if (add('beat', opening + 1, emphasis)) used += 1;
                if (sentence.text.length > 70 && used < budget.perSentence) {
                    const comma = sentence.text.indexOf(',', 20);
                    if (comma > 0) add('beat', sentence.start + comma + 2, emphasis * 0.8);
                }
            }
        }
        return out.sort((a, b) => a.at - b.at);
    }

    function smooth(x) {
        const t = x < 0 ? 0 : x > 1 ? 1 : x;
        return t * t * (3 - 2 * t);
    }

    /** 0…1: rise over prep, hold, fall over rel. */
    function envelope(g, t) {
        if (t <= 0) return 0;
        if (t < g.prep) return smooth(t / g.prep);
        if (t < g.prep + g.hold) return 1;
        const r = (t - g.prep - g.hold) / g.rel;
        return r >= 1 ? 0 : 1 - smooth(r);
    }

    function duration(id) {
        const g = GESTURES[id];
        return g ? g.prep + g.hold + g.rel : 0;
    }

    // ── the running state ───────────────────────────────────────────────────

    const FINGER = /(Thumb|Index|Middle|Ring|Little)/;
    const state = { items: [], t0: 0, stopAt: Infinity, profile: 'desktop' };
    const output = {}; // reused every frame: no allocation in sample()

    function now() {
        return typeof performance !== 'undefined' && performance.now ? performance.now() / 1000 : Date.now() / 1000;
    }

    /** Which budget applies right now: a presenting headset, a touch screen, or a desktop. */
    function detectProfile(win) {
        const w = win || (typeof window !== 'undefined' ? window : null);
        if (!w) return 'desktop';
        try {
            const xr = w.NEXUS_VIEWER && w.NEXUS_VIEWER.renderer && w.NEXUS_VIEWER.renderer.xr;
            if (xr && xr.isPresenting) return 'vr';
        } catch (_) {
            /* fall through */
        }
        try {
            if (w.matchMedia && w.matchMedia('(pointer: coarse)').matches) return 'mobile';
        } catch (_) {
            /* fall through */
        }
        return 'desktop';
    }

    function speechLang(win) {
        const w = win || (typeof window !== 'undefined' ? window : null);
        try {
            const voice = w && w.SpeechSettings && w.SpeechSettings.lang;
            if (voice) return voice;
            if (w && w.document && w.document.documentElement && w.document.documentElement.lang) {
                return w.document.documentElement.lang;
            }
        } catch (_) {
            /* default below */
        }
        return 'en';
    }

    /** Plan this reply and start its clock. Called where lip sync starts. Never throws. */
    function start(text, rate) {
        try {
            state.profile = detectProfile();
            state.items = plan(text, { rate, profile: state.profile, lang: speechLang() });
            state.t0 = now();
            state.stopAt = Infinity;
        } catch (error) {
            console.warn('[SpeechGestures] could not plan this reply', error);
            state.items = [];
        }
        return state.items.length;
    }

    /** Speech ended or was cut: nothing new starts; what is in the air retracts on its own. */
    function stop() {
        state.stopAt = now() - state.t0;
    }

    function addPose(pose, w, mirrorIt) {
        const p = mirrorIt ? mirror(pose) : pose;
        for (const bone of Object.keys(p)) {
            if (!PROFILES[state.profile].fingers && FINGER.test(bone)) continue;
            const v = p[bone];
            const o = output[bone] || (output[bone] = [0, 0, 0]);
            o[0] += v[0] * w;
            o[1] += v[1] * w;
            o[2] += v[2] * w;
        }
    }

    /**
     * This frame's additive offsets, `{ boneName: [x, y, z] }`, or null when nothing is moving.
     * The same object is reused every call.
     */
    function sample(nowSec) {
        for (const k of Object.keys(output)) {
            output[k][0] = 0;
            output[k][1] = 0;
            output[k][2] = 0;
        }
        if (!state.items.length) return null;
        const t = (Number.isFinite(nowSec) ? nowSec : now()) - state.t0;
        let any = false;
        for (const item of state.items) {
            if (item.at > state.stopAt) continue; // planned after speech ended: never starts
            const g = GESTURES[item.id];
            const local = t - item.at;
            if (local <= 0 || local >= duration(item.id)) continue;
            const w = envelope(g, local) * item.gain;
            if (w <= 0) continue;
            any = true;
            const sides = item.side === 'both' ? ['right', 'left'] : [item.side];
            for (const s of sides) {
                addPose(g.pose, w, s === 'left');
                if (g.osc && local > g.prep && local < g.prep + g.hold) {
                    const bone = s === 'left' ? 'left' + g.osc.bone.slice(5) : g.osc.bone;
                    const o = output[bone] || (output[bone] = [0, 0, 0]);
                    const sign = s === 'left' && g.osc.axis !== 0 ? -1 : 1;
                    o[g.osc.axis] += sign * Math.sin((local - g.prep) * g.osc.freq) * g.osc.amp * w;
                }
            }
        }
        if (!any) {
            const last = state.items[state.items.length - 1];
            if (t > last.at + duration(last.id)) state.items = []; // the reply is done
            return null;
        }
        return output;
    }

    function active() {
        return state.items.length > 0;
    }

    /**
     * SG3. The additive layer that puts `sample()`'s offsets on her bones, with `THREE` injected.
     *
     * Each frame it first takes back its own previous offset, then applies this frame's, so it
     * never accumulates on a bone nobody else resets (VRoid arms, which ProceduralAnimator does
     * not hold). It takes back an offset only if the bone still holds exactly what it left there:
     * a bone something else rewrote this frame (a reset, a clip) has already lost the old offset,
     * and undoing it again would twist her arm. `release()` hands every bone back the same way.
     * A bone gets two quaternions the first time it moves; nothing is allocated per frame after.
     */
    function createLayer(THREE) {
        const EPS = 1e-6;
        const applied = new Map(); // node -> { inv, last }
        const euler = new THREE.Euler();
        const q = new THREE.Quaternion();
        let frame = 0;

        function untouched(node, rec) {
            const a = node.quaternion;
            const b = rec.last;
            return (
                Math.abs(a.x - b.x) < EPS &&
                Math.abs(a.y - b.y) < EPS &&
                Math.abs(a.z - b.z) < EPS &&
                Math.abs(a.w - b.w) < EPS
            );
        }

        function takeBack(node, rec) {
            if (untouched(node, rec)) node.quaternion.multiply(rec.inv);
        }

        function apply(offsets, resolve) {
            frame += 1;
            if (offsets) {
                for (const name of Object.keys(offsets)) {
                    const o = offsets[name];
                    if (o[0] === 0 && o[1] === 0 && o[2] === 0) continue;
                    const node = resolve(name);
                    if (!node || !node.quaternion) continue;
                    let rec = applied.get(node);
                    if (rec) takeBack(node, rec);
                    else {
                        rec = { inv: new THREE.Quaternion(), last: new THREE.Quaternion(), frame: 0 };
                        applied.set(node, rec);
                    }
                    euler.set(o[0], o[1], o[2]);
                    q.setFromEuler(euler);
                    node.quaternion.multiply(q);
                    rec.inv.copy(q).invert();
                    rec.last.copy(node.quaternion);
                    rec.frame = frame;
                }
            }
            // Bones that moved last frame and not this one go back to what was under them.
            for (const [node, rec] of applied) {
                if (rec.frame === frame) continue;
                takeBack(node, rec);
                applied.delete(node);
            }
        }

        function release() {
            for (const [node, rec] of applied) takeBack(node, rec);
            applied.clear();
        }

        return { apply, release, size: () => applied.size };
    }

    const api = {
        CHARS_PER_SEC,
        PROFILES,
        GESTURES,
        LEXICON,
        plan,
        envelope,
        duration,
        mirror,
        detectProfile,
        start,
        stop,
        sample,
        active,
        createLayer,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_SPEECH_GESTURES = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
