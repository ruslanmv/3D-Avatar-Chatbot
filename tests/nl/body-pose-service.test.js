/**
 * NL1. The lifecycle of a position asked for in words: requested → validated → started →
 * applied → confirmed, or blocked / failed / cancelled.
 *
 * Run against the real PrivatePoseController (the one Pose Studio's presets and Private use)
 * and a pose system whose rendered bones are separate from what it reports. The property every
 * test here turns on: nothing is `confirmed`, and the reply is never told it is, unless the
 * rendered skeleton shows the position and still shows it a moment later.
 */
/* global describe, test, expect */
const Poses = require('../../src/experiences/private/PrivatePoseController.js');
const Service = require('../../src/xr/BodyPoseService.js');
const Commands = require('../../src/xr/PoseCommands.js');
const { catalogue, poseSystem, manualClock, page } = require('./harness.js');

function world(options) {
    const sys = poseSystem(options);
    const clock = manualClock();
    const win = page(sys);
    const controller = Poses.create({ win });
    const events = [];
    const service = Service.create({
        win,
        controller,
        now: clock.now,
        wait: clock.wait,
        confirm: { wait: clock.wait },
        onChange: (snap) => events.push(`${snap.id}:${snap.state}`),
    });
    const ask = (said, lang) =>
        service.request(
            Commands.resolve(said, { catalogue: catalogue(), held: Boolean(service.held()), lang: lang || 'en' })
        );
    return { sys, clock, win, controller, service, events, ask };
}

describe('a position that is taken', () => {
    test('goes through every step, in order, and is confirmed from the rendered skeleton', async () => {
        const w = world();
        const done = await w.ask('Kneel down.');
        expect(done.history).toEqual(['requested', 'validated', 'started', 'applied', 'confirmed']);
        expect(done).toMatchObject({ state: 'confirmed', preset: 'kneeling', avatarId: 'avatar-1' });
        expect(done.id).toMatch(/^pose-/);
        expect(done.seen.hipsY).toBeLessThan(0.6);
        expect(w.sys.calls).toEqual(['claim', 'apply:kneeling']);
        expect(w.service.held()).toBe('preset:kneeling');
    });

    test.each([
        ['Sit with your legs crossed.', 'en', 'sittingCrossed'],
        ['Lie on your back.', 'en', 'lyingBack'],
        ['Inginocchiati.', 'it', 'kneeling'],
        ['Sdraiati sulla schiena.', 'it', 'lyingBack'],
    ])('%s (%s) → %s, confirmed', async (said, lang, preset) => {
        const w = world();
        expect(await w.ask(said, lang)).toMatchObject({ state: 'confirmed', preset });
        expect(w.sys.getCurrentPreset()).toBe(preset);
    });

    test('the reply is told "not yet" while it is under way and "confirmed" only afterwards', async () => {
        const w = world();
        w.sys.settling = true; // the pose system is still blending her
        const going = w.ask('Kneel down.');
        await Promise.resolve();
        expect(w.service.current().state).toBe('applied');
        expect(w.service.fact()).toMatch(/not confirmed on screen yet/);
        expect(w.service.fact()).not.toMatch(/confirmed on screen\./);
        w.sys.settling = false;
        expect((await going).state).toBe('confirmed');
        expect(w.service.fact()).toMatch(/confirmed on screen/);
        expect(w.service.fact()).not.toMatch(/not confirmed/);
    });
});

describe('a position that does not show', () => {
    test('reported by the pose system but not rendered: failed, never confirmed, and she is let go', async () => {
        const w = world({ renders: false });
        const done = await w.ask('Kneel down.');
        expect(done).toMatchObject({ state: 'failed', why: 'not-rendered' });
        expect(done.history).not.toContain('confirmed');
        expect(w.service.held()).toBeNull();
        expect(w.sys.calls.slice(-1)).toEqual(['release']);
        expect(w.service.fact()).toMatch(/did not show on your body/);
        expect(w.service.fact()).toMatch(/[Nn]ever say you are in it/);
    });

    test('an idle that takes the skeleton back inside the hold check is a failure, not a quiet undo', async () => {
        const w = world();
        // 300 ms after it first looks right, something else stands her back up.
        w.clock.after(300, () => {
            w.sys.rendered = null;
        });
        const done = await w.ask('Kneel down.');
        expect(done).toMatchObject({ state: 'failed', why: 'not-held' });
        expect(w.service.fact()).toMatch(/did not show on your body/);
    });

    test('seated with her legs up counts as sitting (hips stay high, feet come up); hips high with feet down does not', async () => {
        const shape = (hips, feet) => (bone) => {
            const at = {
                hips: { x: 0, y: hips, z: 0 },
                head: { x: 0, y: hips + 0.45, z: 0 },
                leftFoot: { x: -0.1, y: feet, z: 0.3 },
                rightFoot: { x: 0.1, y: feet, z: 0.3 },
            }[bone];
            return at ? { getWorldPosition: (t) => Object.assign(t || {}, at) } : null;
        };
        // Measured on AvatarSample_A: standing hips 0.894 m (0.805 above her feet); lounging hips
        // 0.791 m, 0.578 above her feet.
        for (const [feet, state] of [
            [0.21, 'confirmed'],
            [0.05, 'failed'],
        ]) {
            const w = world();
            const standing = w.sys.getVisualBone;
            w.sys.getVisualBone = (bone) =>
                w.sys.current === 'sittingLegsUp' ? shape(0.79, feet)(bone) : standing(bone);
            expect((await w.ask('Sit comfortably.')).state).toBe(state);
        }
    });

    test('the hold being dropped inside the check is a failure too', async () => {
        const w = world();
        w.clock.after(300, () => {
            w.sys.holding = false;
        });
        expect(await w.ask('Lie on your back.')).toMatchObject({ state: 'failed', why: 'not-held' });
    });

    test('a pose system that never stops moving her is not a position taken', async () => {
        const w = world();
        w.sys.settling = true;
        expect(await w.ask('Kneel down.')).toMatchObject({ state: 'failed', why: 'not-rendered' });
    });

    test('a position nobody can find, and one that could be two, both fail with the right question', async () => {
        const w = world();
        expect(await w.ask('Change your position to a handstand')).toMatchObject({
            state: 'failed',
            why: 'unsupported-pose',
        });
        expect(w.sys.calls).toEqual([]);
        expect(w.service.fact()).toMatch(/cannot take here/);
        expect(await w.ask('get into the relaxed pose')).toMatchObject({ state: 'failed', why: 'ambiguous-pose' });
        expect(w.service.fact()).toMatch(/Ask which one/);
        expect(w.sys.calls).toEqual([]);
    });

    test('a preset the pose system does not have is refused before her skeleton is touched', async () => {
        const w = world();
        w.sys.getPresetList = () => [{ name: 'lyingBack' }];
        const done = await w.service.request({ kind: 'pose', preset: 'kneeling', label: 'Kneeling' });
        expect(done).toMatchObject({ state: 'failed', why: 'unknown-pose' });
        expect(w.sys.calls.filter((c) => c.startsWith('apply:'))).toEqual([]);
    });

    test('an adult preset is refused here whatever asked for it', async () => {
        const w = world();
        w.win.NEXUS_POSE_STUDIO_PANEL = {
            catalogue: () =>
                catalogue().concat([{ name: 'wallLean', label: 'Wall Lean', category: 'Adult', adult: true }]),
        };
        const done = await w.service.request({ kind: 'pose', preset: 'wallLean', label: 'Wall Lean' });
        expect(done).toMatchObject({ state: 'failed', why: 'unknown-pose' });
        expect(w.sys.calls).toEqual([]);
    });

    test('with no pose system there is nothing to claim success from', async () => {
        const clock = manualClock();
        const service = Service.create({ win: page(null), now: clock.now, wait: clock.wait });
        expect(await service.request({ kind: 'pose', preset: 'kneeling', label: 'Kneeling' })).toMatchObject({
            state: 'failed',
            why: 'no-pose-system',
        });
    });
});

describe('one position after another', () => {
    test('a new position supersedes the one in flight, and only the newest reports', async () => {
        const w = world();
        w.sys.settling = true;
        const first = w.ask('Kneel down.');
        await Promise.resolve();
        const second = w.ask('Lie on your back.');
        w.sys.settling = false;
        const [a, b] = await Promise.all([first, second]);
        expect(a).toMatchObject({ state: 'cancelled', why: 'superseded', preset: 'kneeling' });
        expect(b).toMatchObject({ state: 'confirmed', preset: 'lyingBack' });
        expect(w.service.held()).toBe('preset:lyingBack');
        // The cancelled request said nothing after it was cancelled.
        const after = w.events.slice(w.events.indexOf(`${a.id}:cancelled`) + 1);
        expect(after.some((e) => e.startsWith(a.id + ':'))).toBe(false);
    });

    test('A → B → A fast: she ends in A, the two in between cancelled, nothing left half applied', async () => {
        const w = world();
        w.sys.settling = true;
        const one = w.ask('Kneel down.');
        await Promise.resolve();
        const two = w.ask('Lie on your back.');
        await Promise.resolve();
        const three = w.ask('Kneel down.');
        w.sys.settling = false;
        const done = await Promise.all([one, two, three]);
        expect(done.map((d) => d.state)).toEqual(['cancelled', 'cancelled', 'confirmed']);
        expect(w.sys.getCurrentPreset()).toBe('kneeling');
        expect(w.service.held()).toBe('preset:kneeling');
        expect(w.sys.isHoldingBones()).toBe(true);
        expect(new Set(done.map((d) => d.id)).size).toBe(3);
    });

    test('"the previous position" is the one before, and standing when there was none', async () => {
        const w = world();
        await w.ask('Kneel down.');
        await w.ask('Lie on your back.');
        expect(await w.ask('Go back to the previous position.')).toMatchObject({
            state: 'confirmed',
            preset: 'kneeling',
        });
        expect(w.sys.getCurrentPreset()).toBe('kneeling');
        expect(await w.ask('Go back to the previous position.')).toMatchObject({
            state: 'confirmed',
            label: 'standing',
        });
        expect(w.service.held()).toBeNull();
    });

    test('"stand up" lets go, is confirmed standing from her hips, and "previous" then brings the position back', async () => {
        const w = world();
        await w.ask('Kneel down.');
        const up = await w.ask('Stand up.');
        expect(up).toMatchObject({ state: 'confirmed', label: 'standing' });
        expect(up.seen.hipsY).toBeGreaterThan(0.8);
        expect(w.sys.isHoldingBones()).toBe(false);
        expect(w.service.fact()).toMatch(/standing again/);
        expect(await w.ask('Go back to the previous position.')).toMatchObject({
            state: 'confirmed',
            preset: 'kneeling',
        });
    });

    test('standing up that does not bring her hips back up is not reported as standing', async () => {
        const w = world();
        await w.ask('Kneel down.');
        const release = w.sys.releaseBones;
        w.sys.releaseBones = () => {
            release();
            w.sys.rendered = 'Kneeling'; // let go, and still on her knees
        };
        expect(await w.ask('Stand up.')).toMatchObject({ state: 'failed', why: 'not-rendered' });
    });
});

describe('the avatar, the session and the other owners of her body', () => {
    test('another avatar mid-transition: the request is cancelled and the old skeleton released', async () => {
        const w = world();
        w.sys.settling = true;
        const going = w.ask('Kneel down.');
        await Promise.resolve();
        w.sys.avatarRoot = { uuid: 'avatar-2' };
        w.service.onAvatarChanged();
        w.sys.settling = false;
        expect(await going).toMatchObject({ state: 'cancelled', why: 'avatar-changed', avatarId: 'avatar-1' });
        expect(w.service.held()).toBeNull();
        expect(w.sys.calls).toContain('release');
        expect(w.service.fact()).toBe('');
    });

    test('a pose on a skeleton that is no longer the one on screen is never confirmed', async () => {
        const w = world();
        // The avatar was swapped by a path that did not rebind the pose system: it still poses
        // the character that left, and reports her faithfully.
        w.win.NEXUS_VIEWER = { avatarManager: { currentRoot: { uuid: 'avatar-2' } } };
        const done = await w.ask('Kneel down.');
        expect(done).toMatchObject({ state: 'failed', why: 'not-rendered' });
        expect(w.service.held()).toBeNull();
        expect(w.service.fact()).toMatch(/did not show on your body/);
        // And with the pose system on the avatar that is drawn, the same request is confirmed.
        w.win.NEXUS_VIEWER = { avatarManager: { currentRoot: w.sys.avatarRoot } };
        expect((await w.ask('Kneel down.')).state).toBe('confirmed');
    });

    test('another avatar while a position is held: the hold is not carried over', async () => {
        const w = world();
        await w.ask('Kneel down.');
        w.sys.avatarRoot = { uuid: 'avatar-2' };
        w.service.onAvatarChanged();
        expect(w.service.held()).toBeNull();
        expect(w.sys.isHoldingBones()).toBe(false);
        // And "the previous position" does not reach back to the avatar that left.
        expect(await w.ask('Go back to the previous position.')).toMatchObject({ label: 'standing' });
        expect(w.sys.calls.filter((c) => c === 'apply:kneeling').length).toBe(1);
    });

    test('the session ending mid-transition: cancelled, released, and nothing reported afterwards', async () => {
        const w = world();
        w.sys.settling = true;
        const going = w.ask('Lie on your back.');
        await Promise.resolve();
        expect(w.service.release('session-ended')).toBe(true);
        w.sys.settling = false;
        expect(await going).toMatchObject({ state: 'cancelled', why: 'session-ended' });
        expect(w.sys.isHoldingBones()).toBe(false);
        expect(w.service.fact()).not.toMatch(/confirmed|moving into/);
    });

    test('while Private is running this stands aside: its own bridge owns her body', async () => {
        const w = world();
        w.win.NEXUS_PRIVATE_ACTIONS = { active: () => true };
        expect(await w.ask('Kneel down.')).toMatchObject({ state: 'blocked', why: 'private-owns-body' });
        expect(w.sys.calls).toEqual([]);
    });

    test('a position let go for an animation is no longer a fact the reply is given', async () => {
        const w = world();
        await w.ask('Kneel down.');
        expect(w.service.fact()).toMatch(/confirmed on screen/);
        w.service.release('animation');
        expect(w.service.fact()).not.toMatch(/Kneeling/);
    });

    test('the studio letting go of her skeleton behind this is not reported as still holding', async () => {
        const w = world();
        await w.ask('Kneel down.');
        w.sys.holding = false; // the panel closed and released the bones itself
        expect(w.service.fact()).not.toMatch(/confirmed on screen|holding/);
    });

    test('every request has its own id and carries the avatar and the session it was made for', async () => {
        const w = world();
        const a = await w.service.request(
            { kind: 'pose', preset: 'kneeling', label: 'Kneeling' },
            { sessionId: 's-7' }
        );
        const b = await w.service.request(
            { kind: 'pose', preset: 'lyingBack', label: 'Lying Back' },
            { sessionId: 's-7' }
        );
        expect(a.id).not.toBe(b.id);
        expect(a).toMatchObject({ avatarId: 'avatar-1', sessionId: 's-7' });
    });
});
