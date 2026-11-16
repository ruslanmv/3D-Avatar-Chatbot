/**
 * NL. Stand-ins for the natural-language pose tests: the Pose Studio catalogue as the app
 * ships it, a pose system whose "rendered skeleton" can be made to disagree with what it
 * reports, and a clock the tests move by hand.
 *
 * The pose system here is the point of the whole suite. The reported bug was a reply that said
 * a position was taken while the avatar stood; every guard against that reads the bones the
 * mesh is skinned to (`getVisualBone`), so the stand-in keeps its reported preset and its
 * rendered bones as two separate things, and a test can break either.
 */
const fs = require('fs');
const path = require('path');

/** The navigator's own list, read from the source so the tests cannot drift from the product. */
function navigatorPresets() {
    const src = fs.readFileSync(path.join(__dirname, '../../src/PoseStudioPanel.js'), 'utf8');
    const block = src.slice(src.indexOf('const NAV_PRESETS'), src.indexOf('];', src.indexOf('const NAV_PRESETS')));
    const out = [];
    const re = /\{\s*name:\s*'([^']+)',\s*label:\s*'([^']+)',\s*category:\s*'([^']+)'(?:,\s*adult:\s*(true|false))?/g;
    let m;
    while ((m = re.exec(block))) out.push({ name: m[1], label: m[2], category: m[3], adult: m[4] === 'true' });
    return out;
}

/** What the panel hands out with Spicy mode off: no adult presets at all. */
const catalogue = () => navigatorPresets().filter((p) => !p.adult);

/** Rendered hips height and trunk tilt per category, on an avatar whose standing hips are 0.9 m. */
const SHAPE = {
    Kneeling: { hips: 0.47, lying: false },
    Sitting: { hips: 0.5, lying: false },
    Lying: { hips: 0.1, lying: true },
    Ground: { hips: 0.4, lying: false },
};

function manualClock() {
    let t = 0;
    const due = [];
    return {
        now: () => t,
        /** Run `fn` once the clock has moved `ms` further. */
        after(ms, fn) {
            due.push({ at: t + ms, fn, done: false });
        },
        wait: async (ms) => {
            t += ms;
            for (const d of due) {
                if (!d.done && d.at <= t) {
                    d.done = true;
                    d.fn();
                }
            }
            await Promise.resolve();
        },
    };
}

/**
 * @param {object} [options]
 * @param {boolean} [options.renders=true]  false: the preset is reported, the bones never move
 */
function poseSystem(options) {
    const o = Object.assign({ renders: true }, options);
    const list = catalogue();
    const sys = {
        calls: [],
        avatarRoot: { uuid: 'avatar-1' },
        current: null,
        holding: false,
        settling: false,
        /** The category the mesh actually shows; `null` is standing. */
        rendered: null,
        /** A clip is moving her: her hands are somewhere else every time they are read. */
        animated: false,
        getPresetList: () => list.map((p) => ({ name: p.name, label: p.label })),
        claimBones() {
            sys.calls.push('claim');
            sys.holding = true;
        },
        releaseBones() {
            sys.calls.push('release');
            sys.holding = false;
            sys.current = null;
            sys.rendered = null;
        },
        applyPreset(name) {
            sys.calls.push('apply:' + name);
            sys.current = name;
            const entry = list.find((p) => p.name === name);
            if (o.renders) sys.rendered = entry ? entry.category : null;
        },
        getCurrentPreset: () => sys.current,
        isHoldingBones: () => sys.holding,
        isSettling: () => sys.settling,
        getVisualBone(bone) {
            const shape = SHAPE[sys.rendered] || { hips: 0.9, lying: false };
            const hips = { x: 0, y: shape.hips, z: 0 };
            const sway = sys.animated ? 0.2 * Math.sin(Date.now() / 150) : 0;
            const at = {
                hips,
                head: shape.lying ? { x: 0.45, y: shape.hips, z: 0 } : { x: 0, y: shape.hips + 0.45, z: 0 },
                leftFoot: { x: -0.1, y: 0.05, z: 0 },
                rightFoot: { x: 0.1, y: 0.05, z: 0 },
                leftHand: { x: -0.3, y: shape.hips + sway, z: 0 },
                rightHand: { x: 0.3, y: shape.hips - sway, z: 0 },
            }[bone];
            return at ? { getWorldPosition: (target) => Object.assign(target || {}, at) } : null;
        },
    };
    return sys;
}

/** A window-like object: the catalogue, the pose system, and nothing else the tests did not put there. */
function page(sys, extra) {
    return Object.assign(
        {
            vrPoseSystem: sys,
            NEXUS_POSE_STUDIO_PANEL: { catalogue },
            NEXUS_POSE_COMMANDS: require('../../src/xr/PoseCommands.js'),
            setTimeout,
        },
        extra || {}
    );
}

module.exports = { navigatorPresets, catalogue, poseSystem, manualClock, page, SHAPE };
