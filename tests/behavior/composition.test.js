/**
 * Composition — does boot actually wire what the units were tested against? (B31)
 *
 * Every other suite in this directory injects an activity's dependencies explicitly, which
 * is right for a unit test and is exactly how three defects survived twenty-eight batches:
 *
 *   * `src/behavior/modes/` was never added to `boot.js`'s module list, so `ModeManager` was
 *     constructed **zero times** and `blackboard.mode` was `undefined` at runtime;
 *   * `watch.js` therefore fell back to a null profile, and `CommentaryGate` ran with no
 *     openings and no initiative budget — B12's "her silence is the feature" held by
 *     accident rather than by the profile that documents it;
 *   * `boot.js` never passed `modes` to `ConsentFlow`, so B29's hard exit called
 *     `this.modes.activate('companion')` behind a null guard and did nothing.
 *
 * Not one unit test could see any of it, because each had been handed the dependency
 * production forgot. So this file reads `boot.js` as **text** — it is the only suite that
 * does — and asserts the wiring is present. A source-level check is the honest instrument
 * here: booting the real director needs a WebGL canvas, a manifest fetch and an embeddings
 * index, none of which belong in a unit run.
 *
 * The rule this encodes: **an injectable dependency with no global fallback must be passed
 * by boot, or it is null in the only build that matters.**
 */

/* global describe, test, expect */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const BOOT = fs.readFileSync(path.join(ROOT, 'src/behavior/boot.js'), 'utf8');
const codeOf = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
const BOOT_CODE = codeOf(BOOT);

/** The `MODULES` array, as boot will actually fetch it. */
function modules() {
    const block = BOOT_CODE.slice(BOOT_CODE.indexOf('MODULES = ['), BOOT_CODE.indexOf('];'));
    return [...block.matchAll(/'([^']+\.js)'/g)].map((m) => m[1]);
}

/** The arguments boot passes to one `attach`/`new`, as source text. */
function wiring(globalName) {
    const at = BOOT_CODE.indexOf(globalName);
    if (at === -1) return null;
    const open = BOOT_CODE.indexOf('{', at);
    if (open === -1) return null;
    let depth = 0;
    for (let i = open; i < BOOT_CODE.length; i++) {
        if (BOOT_CODE[i] === '{') depth++;
        else if (BOOT_CODE[i] === '}' && --depth === 0) return BOOT_CODE.slice(open, i + 1);
    }
    return null;
}

// ── every module that publishes a global is loaded ───────────────────────────

describe('boot loads every engine module that something reads', () => {
    /** Files under src/behavior and src/features that publish a `window.NEXUS_BD_*`. */
    function publishers(dir = path.join(ROOT, 'src')) {
        const out = [];
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) out.push(...publishers(full));
            else if (entry.name.endsWith('.js')) {
                const rel = path.relative(ROOT, full).split(path.sep).join('/');
                if (!/^src\/(behavior|features)\//.test(rel)) continue;
                const text = fs.readFileSync(full, 'utf8');
                const m = text.match(/window\.(NEXUS_BD_\w+)\s*=/);
                if (m && !/boot\.js$/.test(rel)) out.push({ rel, global: m[1] });
            }
        }
        return out;
    }

    test('nothing publishes a global that boot never loads', () => {
        // The check that would have caught the modes directory on the day B7 landed.
        const loaded = new Set(modules());
        const orphans = publishers()
            .filter((p) => !loaded.has(p.rel))
            .map((p) => p.rel);
        expect(orphans).toEqual([]);
    });

    test('and boot loads nothing that does not exist', () => {
        for (const rel of modules()) {
            expect(`${rel}: ${fs.existsSync(path.join(ROOT, rel))}`).toBe(`${rel}: true`);
        }
    });

    test('the mode system is among them', () => {
        const loaded = modules();
        for (const file of [
            'src/behavior/modes/ModeManager.js',
            'src/behavior/modes/companion.profile.js',
            'src/behavior/modes/together.profile.js',
            'src/behavior/modes/showcase.profile.js',
            'src/behavior/modes/play.profile.js',
            'src/behavior/modes/adult.profile.js',
        ]) {
            expect(`${file}: ${loaded.includes(file)}`).toBe(`${file}: true`);
        }
    });

    test('a profile loads before anything that reads it', () => {
        const loaded = modules();
        const before = (a, b) => loaded.indexOf(a) < loaded.indexOf(b);
        expect(before('src/behavior/modes/together.profile.js', 'src/features/together/activities/watch.js')).toBe(
            true
        );
        expect(before('src/behavior/modes/play.profile.js', 'src/features/together/activities/cohost.js')).toBe(true);
        expect(before('src/behavior/modes/adult.profile.js', 'src/behavior/ConsentFlow.js')).toBe(true);
        // And the publisher before the registry that merges its records at load.
        expect(before('src/behavior/registry/PosePublisher.js', 'src/behavior/registry/AnimationRegistry.js')).toBe(
            true
        );
    });
});

// ── the manager is constructed, not merely loaded ────────────────────────────

describe('the mode manager exists at runtime', () => {
    test('boot constructs it', () => {
        // It was loaded by nothing and constructed zero times until B31.
        expect(BOOT_CODE).toMatch(/new global\.NEXUS_BD_MODE_MANAGER\.Manager\(/);
    });

    test('it is given the blackboard, so `bb.mode` is a real profile', () => {
        const args = wiring('NEXUS_BD_MODE_MANAGER.Manager');
        expect(args).toContain('blackboard');
        expect(args).toContain('registry');
    });

    test('every profile is registered', () => {
        const block = BOOT_CODE.slice(BOOT_CODE.indexOf('NEXUS_BD_MODE_MANAGER'));
        for (const g of [
            'NEXUS_BD_PROFILE_COMPANION',
            'NEXUS_BD_PROFILE_TOGETHER',
            'NEXUS_BD_PROFILE_SHOWCASE',
            'NEXUS_BD_PROFILE_PLAY',
            'NEXUS_BD_PROFILE_ADULT',
        ]) {
            expect(`${g}: ${block.slice(0, 1200).includes(g)}`).toBe(`${g}: true`);
        }
    });

    test('companion is activated, so no frame runs with an undefined mode', () => {
        expect(BOOT_CODE).toContain("modes.activate('companion')");
    });

    test('it is constructed before the adapters that tick against it', () => {
        expect(BOOT_CODE.indexOf('NEXUS_BD_MODE_MANAGER')).toBeLessThan(BOOT_CODE.indexOf('const wiring = ['));
    });

    test('registering the adult profile does not enter it — `requires` does that', () => {
        // Registration is a listing, not an activation. The profile's own `requires` and
        // the ranker's triple gate are what keep it unreachable.
        const ModeManager = require('../../src/behavior/modes/ModeManager.js');
        const AdultProfile = require('../../src/behavior/modes/adult.profile.js');
        const board = { nsfwAllowed: false, adultVerified: false };
        const manager = new ModeManager.Manager({ blackboard: board });
        manager.register(AdultProfile);
        expect(manager.activate('adult')).toBe(false);
        expect(manager.activeId).toBeNull();
    });

    test('and it enters once both gates are satisfied', () => {
        const ModeManager = require('../../src/behavior/modes/ModeManager.js');
        const AdultProfile = require('../../src/behavior/modes/adult.profile.js');
        const board = { nsfwAllowed: true, adultVerified: true };
        const manager = new ModeManager.Manager({ blackboard: board });
        manager.register(AdultProfile);
        expect(manager.activate('adult')).toBe(true);
        expect(board.mode).toBe(AdultProfile);
    });
});

// ── injectable dependencies that boot must supply ────────────────────────────

describe('an injectable with no global fallback is passed by boot', () => {
    /**
     * `{module: [deps]}` — dependencies whose constructor default is `|| null` rather than
     * a `window.NEXUS_BD_*` lookup, so nothing supplies them if boot does not.
     */
    const REQUIRED = {
        NEXUS_BD_CONSENT_FLOW: ['blackboard', 'profile', 'recorder', 'modes'],
        NEXUS_BD_COACH: ['bus', 'blackboard', 'registry', 'insight'],
        NEXUS_BD_COPILOT: ['bus', 'blackboard', 'insight'],
        NEXUS_BD_COHOST: ['bus', 'blackboard', 'profile'],
        NEXUS_BD_FOCUS: ['bus', 'blackboard', 'gate'],
        NEXUS_BD_TOGETHER_LAUNCHER: ['panel'],
        NEXUS_BD_CLIP_BUTTON: ['bus', 'blackboard', 'recorder', 'cards'],
    };

    for (const [globalName, deps] of Object.entries(REQUIRED)) {
        test(`${globalName} receives ${deps.join(', ')}`, () => {
            const args = wiring(`${globalName}.attach`);
            expect(args).toBeTruthy();
            for (const dep of deps) {
                expect(`${globalName}.${dep}: ${new RegExp(`\\b${dep}\\b`).test(args)}`).toBe(
                    `${globalName}.${dep}: true`
                );
            }
        });
    }

    test('ConsentFlow gets `modes`, so its hard exit actually leaves the mode', () => {
        // The third consequence of the unloaded module list, and the one no test could see:
        // `this.modes.activate('companion')` sat behind a null guard.
        const ConsentFlow = require('../../src/behavior/ConsentFlow.js');
        const AdultProfile = require('../../src/behavior/modes/adult.profile.js');
        const activated = [];
        const flow = ConsentFlow.attach({
            blackboard: { adultVerified: true, nsfwAllowed: true, escalationLevel: 1 },
            profile: AdultProfile,
            modes: { activate: (id) => activated.push(id) },
            now: () => 0,
        });
        flow.enter(0);
        flow.exit('hard', 0);
        expect(activated).toEqual(['companion']);
        expect(wiring('NEXUS_BD_CONSENT_FLOW.attach')).toContain('modes');
    });
});

// ── the gate the null profile was quietly disabling ──────────────────────────

describe('the commentary gate gets a real profile', () => {
    test('together.profile carries the openings and the budget it documents', () => {
        const TogetherProfile = require('../../src/behavior/modes/together.profile.js');
        expect(TogetherProfile.commentaryOpenings.length).toBeGreaterThan(0);
        expect(TogetherProfile.initiative.budgetPerSession).toBe(4);
    });

    test('a null profile silences the gate for the wrong reason', () => {
        // Not a regression test — a demonstration of what was happening. With no profile
        // the gate has no openings to subscribe to, so it refuses everything: her silence
        // held by accident rather than by the rule that is supposed to produce it.
        const WatchActivity = require('../../src/features/together/activities/watch.js');
        const EventBus = require('../../src/behavior/EventBus.js');
        const Blackboard = require('../../src/behavior/ContextBlackboard.js');

        const bb = new Blackboard({});
        bb.attention = 0.9;
        const nulled = new WatchActivity.CommentaryGate({ bus: new EventBus(), blackboard: bb, profile: null });
        expect(nulled.stats.openings).toEqual([]);

        const real = new WatchActivity.CommentaryGate({
            bus: new EventBus(),
            blackboard: bb,
            profile: require('../../src/behavior/modes/together.profile.js'),
        });
        expect(real.stats.openings.length).toBeGreaterThan(0);
    });
});
